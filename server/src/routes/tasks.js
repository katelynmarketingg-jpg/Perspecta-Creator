import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";
import { stopTimersForTask } from "./time.js";
import { syncTaskMediaToStage } from "../gallery-sync.js";

const router = Router();
router.use(authRequired, moduleAllowed("tarefas"));

const SELECT = `
  SELECT t.*, c.name AS client_name, p.name AS project_name, u.name AS assignee_name,
         (SELECT COUNT(*) FROM task_attachments ta WHERE ta.task_id = t.id) AS attachment_count
  FROM tasks t
  LEFT JOIN clients c ON c.id = t.client_id
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN users u ON u.id = t.assignee_id`;

function hydrate(row) {
  if (!row) return row;
  return { ...row, tags: JSON.parse(row.tags || "[]") };
}

// Liga captação/reunião à AGENDA: quando uma tarefa desse tipo ganha data, cria
// (ou atualiza) um compromisso que aparece na agenda da equipe (do responsável)
// e na agenda do cliente. Se perder a data/tipo, remove o compromisso ligado.
function syncCaptureEvent(taskId, orgId) {
  const t = db.prepare("SELECT * FROM tasks WHERE id = ? AND org_id = ?").get(taskId, orgId);
  if (!t) return;
  const agendavel = t.content_type === "captacao" || t.content_type === "reuniao";
  const existing = db.prepare("SELECT id FROM events WHERE task_id = ? AND org_id = ?").get(taskId, orgId);

  if (!agendavel || !t.scheduled_at) {
    if (existing) db.prepare("DELETE FROM events WHERE id = ?").run(existing.id);
    return;
  }
  const label = t.content_type === "captacao" ? "Captação" : "Reunião";
  const type = db.prepare("SELECT id FROM event_types WHERE org_id = ? AND name LIKE ? LIMIT 1").get(orgId, `%${label}%`);
  if (existing) {
    db.prepare(
      `UPDATE events SET title = ?, start_at = ?, client_id = ?, owner_id = ?, type_id = ?, visible_to_client = 1 WHERE id = ?`
    ).run(t.title, t.scheduled_at, t.client_id, t.assignee_id, type?.id ?? null, existing.id);
  } else {
    db.prepare(
      `INSERT INTO events (title, type_id, client_id, start_at, owner_id, visible_to_client, task_id, org_id)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(t.title, type?.id ?? null, t.client_id, t.scheduled_at, t.assignee_id, taskId, orgId);
    const cli = t.client_id ? db.prepare("SELECT name FROM clients WHERE id = ?").get(t.client_id)?.name : null;
    // Mirada no responsável pela captação/reunião (ex.: a Katy). Sem responsável, vai pra equipe.
    db.prepare("INSERT INTO notifications (audience, client_id, task_id, message, org_id, user_id) VALUES ('agency', ?, ?, ?, ?, ?)")
      .run(t.client_id, taskId, `📅 ${label} agendada: "${t.title}"${cli ? " — " + cli : ""}.`, orgId, t.assignee_id || null);
  }
}

// ---- Etapas do Kanban ---------------------------------------------------
router.get("/stages", (req, res) => {
  res.json(db.prepare("SELECT * FROM kanban_stages WHERE org_id = ? ORDER BY position, id").all(req.orgId));
});

router.post("/stages", (req, res) => {
  const { name, is_done = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: "Nome da etapa é obrigatório." });
  const pos = db
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM kanban_stages WHERE org_id = ?")
    .get(req.orgId).p;
  const info = db
    .prepare("INSERT INTO kanban_stages (name, position, is_done, org_id) VALUES (?, ?, ?, ?)")
    .run(name, pos, is_done ? 1 : 0, req.orgId);
  res.status(201).json(db.prepare("SELECT * FROM kanban_stages WHERE id = ?").get(info.lastInsertRowid));
});

router.put("/stages/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM kanban_stages WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: "Etapa não encontrada." });
  const merged = {
    ...cur, ...req.body, id: req.params.id, org_id: req.orgId,
    is_done: (req.body.is_done ?? cur.is_done) ? 1 : 0,
  };
  db.prepare("UPDATE kanban_stages SET name=@name, position=@position, is_done=@is_done WHERE id=@id AND org_id=@org_id").run(merged);
  res.json(db.prepare("SELECT * FROM kanban_stages WHERE id = ?").get(req.params.id));
});

router.delete("/stages/:id", (req, res) => {
  db.prepare("DELETE FROM kanban_stages WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

// ---- Tarefas ------------------------------------------------------------
router.get("/", (req, res) => {
  const { assignee_id, client_id, project_id } = req.query;
  const where = ["t.org_id = @org_id"];
  const params = { org_id: req.orgId };
  if (assignee_id) { where.push("t.assignee_id = @assignee_id"); params.assignee_id = assignee_id; }
  if (client_id) { where.push("t.client_id = @client_id"); params.client_id = client_id; }
  if (project_id) { where.push("t.project_id = @project_id"); params.project_id = project_id; }
  const sql = `${SELECT} WHERE ${where.join(" AND ")} ORDER BY t.position, t.id`;
  res.json(db.prepare(sql).all(params).map(hydrate));
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: "Título é obrigatório." });
  // criação em lote: cria N tarefas idênticas (máx 100)
  const count = Math.min(Math.max(Number(b.quantity) || 1, 1), 100);
  const stmt = db.prepare(
    `INSERT INTO tasks (title, description, client_id, project_id, assignee_id, stage_id, priority, tags, due_date, content_type, caption, scheduled_at, org_id)
     VALUES (@title, @description, @client_id, @project_id, @assignee_id, @stage_id, @priority, @tags, @due_date, @content_type, @caption, @scheduled_at, @org_id)`
  );
  const base = {
    title: b.title,
    description: b.description ?? null,
    client_id: b.client_id ?? null,
    project_id: b.project_id ?? null,
    assignee_id: b.assignee_id ?? null,
    stage_id: b.stage_id ??
      db.prepare("SELECT id FROM kanban_stages WHERE org_id = ? ORDER BY position LIMIT 1").get(req.orgId)?.id ?? null,
    priority: b.priority ?? "medium",
    tags: JSON.stringify(b.tags ?? []),
    due_date: b.due_date ?? null,
    content_type: b.content_type ?? null,
    caption: b.caption ?? null,
    scheduled_at: b.scheduled_at ?? null,
    org_id: req.orgId,
  };
  const created = [];
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const info = stmt.run(base);
      created.push(info.lastInsertRowid);
    }
  });
  tx();
  created.forEach((id) => syncCaptureEvent(id, req.orgId));
  const rows = created.map((id) => hydrate(db.prepare(`${SELECT} WHERE t.id = ?`).get(id)));
  res.status(201).json(count === 1 ? rows[0] : rows);
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM tasks WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: "Tarefa não encontrada." });
  const merged = {
    ...cur,
    ...req.body,
    tags: JSON.stringify(req.body.tags ?? JSON.parse(cur.tags || "[]")),
    id: req.params.id,
    org_id: req.orgId,
  };
  db.prepare(
    `UPDATE tasks SET title=@title, description=@description, client_id=@client_id,
     project_id=@project_id, assignee_id=@assignee_id, stage_id=@stage_id, priority=@priority,
     tags=@tags, due_date=@due_date, completed_at=@completed_at, position=@position,
     content_type=@content_type, caption=@caption, scheduled_at=@scheduled_at
     WHERE id=@id AND org_id=@org_id`
  ).run(merged);
  syncCaptureEvent(req.params.id, req.orgId);
  res.json(hydrate(db.prepare(`${SELECT} WHERE t.id = ?`).get(req.params.id)));
});

// POST /api/tasks/bulk-rename { from, to } — troca um texto no título de TODAS
// as tarefas do escritório (ex.: "Julho" → "Agosto"). Não mexe nas datas.
router.post("/bulk-rename", (req, res) => {
  const { from, to } = req.body || {};
  if (!from) return res.status(400).json({ error: "Informe o texto a trocar." });
  const info = db
    .prepare("UPDATE tasks SET title = REPLACE(title, ?, ?) WHERE org_id = ? AND title LIKE ?")
    .run(from, to ?? "", req.orgId, `%${from}%`);
  res.json({ updated: info.changes });
});

// PUT /api/tasks/:id/status — move de etapa (drag do kanban)
// Ao mover para a etapa de conclusão, a data de programação é obrigatória.
router.put("/:id/status", (req, res) => {
  const { stage_id, position, scheduled_at } = req.body || {};
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!task) return res.status(404).json({ error: "Tarefa não encontrada." });
  const stage = db.prepare("SELECT * FROM kanban_stages WHERE id = ? AND org_id = ?").get(stage_id, req.orgId);

  const finalScheduledAt = scheduled_at ?? task.scheduled_at;
  if (stage?.is_done && !finalScheduledAt) {
    return res.status(400).json({ error: "Informe a data de programação para concluir.", needs_schedule: true });
  }

  // Ao entrar na DISTRIBUIÇÃO, uma tarefa agrupada (quantity > 1) se abre em N
  // peças individuais (quantity = 1), prontas para programar uma a uma.
  if (stage && /Distribui/i.test(stage.name || "") && Number(task.quantity) > 1) {
    const n = Number(task.quantity);
    const base = (task.title || "").replace(/\s+—.*$/, "");   // "Post — Cliente (Mês)" -> "Post"
    const suffix = (task.title || "").match(/—.*$/)?.[0] || ""; // "— Cliente (Mês)"
    const insPiece = db.prepare(
      `INSERT INTO tasks (title, description, client_id, project_id, assignee_id, stage_id, priority,
         tags, due_date, ref_month, content_type, caption, quantity, position, org_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    );
    const split = db.transaction(() => {
      for (let i = 1; i <= n; i++) {
        insPiece.run(
          `${base} ${i}/${n}${suffix ? " " + suffix : ""}`.trim(),
          task.description, task.client_id, task.project_id, task.assignee_id, stage_id,
          task.priority, task.tags, task.due_date, task.ref_month, task.content_type, task.caption, i, req.orgId
        );
      }
      db.prepare("DELETE FROM tasks WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
    });
    split();
    return res.json({ split: true, count: n });
  }

  const completed_at = stage?.is_done ? new Date().toISOString() : null;
  // Ao entrar na aprovação, marca o relógio: é o que dispara o lembrete
  // se o cliente deixar parado. Sair da etapa zera o contador.
  const entrouNaAprovacao = /Aprova/i.test(stage?.name || "");
  const approvalSentAt = entrouNaAprovacao
    ? (task.approval_sent_at ?? new Date().toISOString())
    : null;

  db.prepare(
    `UPDATE tasks SET stage_id = ?, position = ?, completed_at = ?, scheduled_at = ?,
     approval_sent_at = ?, last_reminder_at = CASE WHEN ? IS NULL THEN NULL ELSE last_reminder_at END
     WHERE id = ? AND org_id = ?`
  ).run(
    stage_id ?? null,
    position ?? 0,
    completed_at,
    finalScheduledAt ?? null,
    approvalSentAt,
    approvalSentAt,
    req.params.id,
    req.orgId
  );
  // Mudou de etapa → finaliza qualquer cronômetro em andamento nesta tarefa.
  if (stage_id != null && String(stage_id) !== String(task.stage_id)) {
    stopTimersForTask(req.params.id, req.orgId);
  }
  // A mídia acompanha a peça pela Galeria conforme a etapa do quadro.
  if (stage?.is_done) syncTaskMediaToStage(req.orgId, req.params.id, "programados");
  else if (entrouNaAprovacao) syncTaskMediaToStage(req.orgId, req.params.id, "aprovacao");
  syncCaptureEvent(req.params.id, req.orgId);
  res.json(hydrate(db.prepare(`${SELECT} WHERE t.id = ?`).get(req.params.id)));
});

// GET /api/tasks/:id/attachments — arquivos anexados (a arte do post)
router.get("/:id/attachments", (req, res) => {
  const rows = db
    .prepare(
      `SELECT f.id, f.original_name, f.mime, f.size
       FROM task_attachments ta
       JOIN files f ON f.id = ta.file_id
       JOIN tasks t ON t.id = ta.task_id
       WHERE ta.task_id = ? AND t.org_id = ?`
    )
    .all(req.params.id, req.orgId);
  res.json(rows);
});

// PUT /api/tasks/:id/attachments — substitui a lista de anexos
router.put("/:id/attachments", (req, res) => {
  const task = db.prepare("SELECT id FROM tasks WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!task) return res.status(404).json({ error: "Tarefa não encontrada." });
  const ids = Array.isArray(req.body?.file_ids) ? req.body.file_ids : [];
  // Só anexa arquivos do próprio escritório.
  const owned = ids.filter((fid) =>
    db.prepare("SELECT 1 FROM files WHERE id = ? AND org_id = ?").get(fid, req.orgId)
  );
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM task_attachments WHERE task_id = ?").run(req.params.id);
    const ins = db.prepare("INSERT OR IGNORE INTO task_attachments (task_id, file_id) VALUES (?, ?)");
    owned.forEach((fid) => ins.run(req.params.id, fid));
  });
  tx();
  res.json({ ok: true, count: owned.length });
});

// PUT /api/tasks/:id/tags
router.put("/:id/tags", (req, res) => {
  const tags = Array.isArray(req.body?.tags) ? req.body.tags : [];
  db.prepare("UPDATE tasks SET tags = ? WHERE id = ? AND org_id = ?")
    .run(JSON.stringify(tags), req.params.id, req.orgId);
  res.json(hydrate(db.prepare(`${SELECT} WHERE t.id = ?`).get(req.params.id)));
});

// DELETE /api/tasks/all — apaga TODAS as tarefas do escritório (recomeçar do
// zero para testar). Só admin. Remove também os eventos que vieram de tarefas
// (captação/reunião) e os anexos (por cascade). Definido ANTES de /:id.
router.delete("/all", (req, res) => {
  if (req.user?.role !== "admin" && req.user?.role !== "superadmin") {
    return res.status(403).json({ error: "Apenas administradores podem limpar as tarefas." });
  }
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM events WHERE org_id = ? AND task_id IS NOT NULL").run(req.orgId);
    const info = db.prepare("DELETE FROM tasks WHERE org_id = ?").run(req.orgId);
    return info.changes;
  });
  const deleted = tx();
  res.json({ deleted });
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM tasks WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

export default router;
