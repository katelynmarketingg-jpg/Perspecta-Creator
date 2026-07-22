import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";

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
  res.json(hydrate(db.prepare(`${SELECT} WHERE t.id = ?`).get(req.params.id)));
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

  const completed_at = stage?.is_done ? new Date().toISOString() : null;
  db.prepare("UPDATE tasks SET stage_id = ?, position = ?, completed_at = ?, scheduled_at = ? WHERE id = ? AND org_id = ?").run(
    stage_id ?? null,
    position ?? 0,
    completed_at,
    finalScheduledAt ?? null,
    req.params.id,
    req.orgId
  );
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

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM tasks WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

export default router;
