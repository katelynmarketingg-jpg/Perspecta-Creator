import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";
import { syncTaskMediaToStage } from "../gallery-sync.js";

// ---------------------------------------------------------------------------
// Distribuição — a mesa de trabalho de quem programa (ex.: a Rafa).
//
// Depois que a peça é produzida/editada e cai na etapa "Programação", ela
// aparece aqui como item INDIVIDUAL, por cliente. Aqui se anexa a foto/vídeo,
// escreve a legenda + observação e escolhe a data/hora. Ao "Enviar para
// aprovação", a peça vai para a etapa de Aprovação (que a Área do Cliente já
// lê) e o cliente recebe o aviso para aprovar.
// ---------------------------------------------------------------------------
const router = Router();
router.use(authRequired, moduleAllowed("tarefas"));

// Acha a etapa pelo nome (mesmo padrão usado no resto do sistema).
function stageByName(pattern, orgId) {
  return db
    .prepare("SELECT * FROM kanban_stages WHERE org_id = ? AND name LIKE ? ORDER BY position LIMIT 1")
    .get(orgId, pattern);
}

// GET /api/distribution?client_id= — peças prontas para distribuir/programar.
router.get("/", (req, res) => {
  const stage = stageByName("%Distribui%", req.orgId);
  if (!stage) return res.json({ stage: null, items: [] });

  const where = [
    "t.org_id = @org_id",
    "t.stage_id = @stage_id",
    "(t.approval_status IS NULL OR t.approval_status IN ('pending','changes_requested'))",
  ];
  const params = { org_id: req.orgId, stage_id: stage.id };
  if (req.query.client_id) {
    where.push("t.client_id = @client_id");
    params.client_id = req.query.client_id;
  }

  const items = db
    .prepare(
      `SELECT t.id, t.title, t.content_type, t.caption, t.description, t.scheduled_at,
              t.approval_status, t.client_note, t.client_id, t.cover_file_id,
              c.name AS client_name, c.phone AS client_phone,
              (SELECT ta.file_id FROM task_attachments ta WHERE ta.task_id = t.id LIMIT 1) AS file_id
       FROM tasks t
       LEFT JOIN clients c ON c.id = t.client_id
       WHERE ${where.join(" AND ")}
       ORDER BY c.name, t.scheduled_at, t.id`
    )
    .all(params);

  // Panorama completo (o "calendário"): TODOS os posts com data marcada do
  // escritório (ou do cliente filtrado) — para as visões Lista/Perfil/Calendário.
  const swhere = ["t.org_id = @org_id", "t.scheduled_at IS NOT NULL"];
  if (req.query.client_id) swhere.push("t.client_id = @client_id");
  const scheduled = db
    .prepare(
      `SELECT t.id, t.title, t.content_type, t.caption, t.scheduled_at,
              t.approval_status, t.client_id, t.cover_file_id,
              c.name AS client_name, s.is_done AS stage_done,
              (SELECT ta.file_id FROM task_attachments ta WHERE ta.task_id = t.id LIMIT 1) AS file_id
       FROM tasks t
       LEFT JOIN clients c ON c.id = t.client_id
       LEFT JOIN kanban_stages s ON s.id = t.stage_id
       WHERE ${swhere.join(" AND ")}
       ORDER BY t.scheduled_at DESC`
    )
    .all(params);

  // Conteúdos APROVADOS pelo cliente e ainda não programados — a fila da Rafa
  // para agendar. (Filtra por empresa se pedido.)
  const awhere = ["t.org_id = @org_id", "t.approval_status = 'approved'", "(s.is_done IS NULL OR s.is_done = 0)"];
  if (req.query.client_id) awhere.push("t.client_id = @client_id");
  const approved = db
    .prepare(
      `SELECT t.id, t.title, t.content_type, t.caption, t.description, t.scheduled_at,
              t.client_id, t.cover_file_id, c.name AS client_name, c.phone AS client_phone,
              (SELECT ta.file_id FROM task_attachments ta WHERE ta.task_id = t.id LIMIT 1) AS file_id
       FROM tasks t
       LEFT JOIN clients c ON c.id = t.client_id
       LEFT JOIN kanban_stages s ON s.id = t.stage_id
       WHERE ${awhere.join(" AND ")}
       ORDER BY t.scheduled_at, t.id`
    )
    .all(params);

  res.json({ stage: { id: stage.id, name: stage.name }, items, scheduled, approved });
});

// POST /api/distribution/:id/schedule — programa (manda para "Programados").
// Publicação automática no Instagram depende do app Meta; por ora, organiza aqui.
router.post("/:id/schedule", (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!task) return res.status(404).json({ error: "Peça não encontrada." });
  const when = req.body?.scheduled_at || task.scheduled_at;
  if (!when) return res.status(400).json({ error: "Defina a data/hora antes de programar." });
  const done = db.prepare("SELECT id FROM kanban_stages WHERE org_id = ? AND is_done = 1 ORDER BY position LIMIT 1").get(req.orgId);
  if (!done) return res.status(400).json({ error: "Crie a etapa 'Programados' primeiro." });
  db.prepare(
    "UPDATE tasks SET stage_id = ?, scheduled_at = ?, completed_at = ? WHERE id = ? AND org_id = ?"
  ).run(done.id, when, new Date().toISOString(), req.params.id, req.orgId);
  // A mídia acompanha: vai para a pasta "Programados" da Galeria do cliente.
  syncTaskMediaToStage(req.orgId, req.params.id, "programados");
  res.json({ ok: true });
});

// POST /api/distribution/reorder — reordena o feed: recebe a nova data/hora de
// cada peça (as peças assumem os "slots" de data na nova ordem). Em lote.
router.post("/reorder", (req, res) => {
  const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
  const upd = db.prepare("UPDATE tasks SET scheduled_at = ? WHERE id = ? AND org_id = ?");
  const tx = db.transaction(() => {
    changes.forEach((c) => {
      if (c && c.id) upd.run(c.scheduled_at || null, c.id, req.orgId);
    });
  });
  tx();
  res.json({ ok: true, updated: changes.length });
});

// PUT /api/distribution/:id — salva mídia (file_id), legenda, observação e data.
router.put("/:id", (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!task) return res.status(404).json({ error: "Peça não encontrada." });

  const { caption, description, scheduled_at, file_id, cover_file_id } = req.body || {};
  db.prepare(
    `UPDATE tasks SET
       caption      = COALESCE(?, caption),
       description  = COALESCE(?, description),
       scheduled_at = COALESCE(?, scheduled_at)
     WHERE id = ? AND org_id = ?`
  ).run(caption ?? null, description ?? null, scheduled_at ?? null, req.params.id, req.orgId);

  // Capa do perfil: cover_file_id === null limpa; undefined não mexe.
  if (cover_file_id !== undefined) {
    db.prepare("UPDATE tasks SET cover_file_id = ? WHERE id = ? AND org_id = ?")
      .run(cover_file_id || null, req.params.id, req.orgId);
  }

  // Mídia: substitui o anexo (a arte do post). file_id null = remove.
  if (file_id !== undefined) {
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM task_attachments WHERE task_id = ?").run(req.params.id);
      if (file_id) {
        db.prepare("INSERT OR IGNORE INTO task_attachments (task_id, file_id) VALUES (?, ?)")
          .run(req.params.id, file_id);
      }
    });
    tx();
  }
  res.json({ ok: true });
});

// POST /api/distribution/:id/send — envia para a Área do Cliente aprovar.
router.post("/:id/send", (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!task) return res.status(404).json({ error: "Peça não encontrada." });
  if (!task.scheduled_at) return res.status(400).json({ error: "Defina a data/hora antes de enviar." });

  const hasMedia = db.prepare("SELECT 1 FROM task_attachments WHERE task_id = ? LIMIT 1").get(req.params.id);
  if (!hasMedia) return res.status(400).json({ error: "Anexe a foto ou o vídeo antes de enviar." });

  const stage = stageByName("%Aprova%", req.orgId);
  if (!stage) return res.status(400).json({ error: "Crie uma etapa de Aprovação primeiro." });

  db.prepare(
    `UPDATE tasks SET stage_id = ?, approval_status = 'sent',
       approval_sent_at = COALESCE(approval_sent_at, ?) WHERE id = ? AND org_id = ?`
  ).run(stage.id, new Date().toISOString(), req.params.id, req.orgId);

  // A mídia acompanha: vai para a pasta "Para aprovação" da Galeria do cliente.
  syncTaskMediaToStage(req.orgId, req.params.id, "aprovacao");

  // Avisa o cliente que tem conteúdo novo para aprovar.
  db.prepare(
    "INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('client', ?, ?, ?, ?)"
  ).run(task.client_id, task.id, `🆕 Novo conteúdo para você aprovar: "${task.title}".`, req.orgId);

  res.json({ ok: true });
});

export default router;
