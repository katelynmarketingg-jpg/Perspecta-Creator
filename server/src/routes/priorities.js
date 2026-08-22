import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";

// ---------------------------------------------------------------------------
// Prioridades / recados internos — o canal da equipe.
//
// A chefia diz, por cliente, o que é prioridade e por quê, escolhe para quem
// vai (Rafa, Bruno, você...) e o recado anda num quadrinho: Pendente → Em
// andamento → Concluído. É interno (não aparece para o cliente).
// ---------------------------------------------------------------------------
const router = Router();
router.use(authRequired, moduleAllowed("tarefas"));

const LEVELS = ["alta", "media", "baixa"];
const STATUSES = ["pending", "doing", "done"];

const SELECT = `
  SELECT p.id, p.client_id, p.message, p.level, p.assignee_id, p.created_by,
         p.status, p.position, p.created_at, p.done_at,
         c.name AS client_name,
         ua.name AS assignee_name,
         uc.name AS creator_name
  FROM priorities p
  LEFT JOIN clients c ON c.id = p.client_id
  LEFT JOIN users ua ON ua.id = p.assignee_id
  LEFT JOIN users uc ON uc.id = p.created_by`;

// GET /api/priorities?assignee_id=&status= — recados do escritório.
router.get("/", (req, res) => {
  const where = ["p.org_id = @org_id"];
  const params = { org_id: req.orgId };
  if (req.query.assignee_id) { where.push("p.assignee_id = @assignee_id"); params.assignee_id = req.query.assignee_id; }
  if (req.query.status) { where.push("p.status = @status"); params.status = req.query.status; }
  const rows = db.prepare(
    `${SELECT} WHERE ${where.join(" AND ")}
     ORDER BY CASE p.level WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
              p.position, p.created_at`
  ).all(params);
  res.json(rows);
});

// POST /api/priorities { client_id, message, level, assignee_id }
router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.message?.trim()) return res.status(400).json({ error: "Escreva o recado." });
  const level = LEVELS.includes(b.level) ? b.level : "media";
  const info = db.prepare(
    `INSERT INTO priorities (org_id, client_id, message, level, assignee_id, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`
  ).run(req.orgId, b.client_id || null, b.message.trim(), level, b.assignee_id || null, req.user?.id || null);

  // Avisa a equipe (ainda sem mira por pessoa): mostra pra quem é.
  const alvo = b.assignee_id ? db.prepare("SELECT name FROM users WHERE id = ?").get(b.assignee_id)?.name : null;
  const cli = b.client_id ? db.prepare("SELECT name FROM clients WHERE id = ?").get(b.client_id)?.name : null;
  db.prepare("INSERT INTO notifications (audience, client_id, message, org_id) VALUES ('agency', ?, ?, ?)")
    .run(b.client_id || null,
      `📌 Nova prioridade${alvo ? ` para ${alvo}` : ""}${cli ? ` — ${cli}` : ""}: ${b.message.trim().slice(0, 80)}`,
      req.orgId);

  res.status(201).json(db.prepare(`${SELECT} WHERE p.id = ?`).get(info.lastInsertRowid));
});

// PUT /api/priorities/:id — edita recado, nível, responsável, cliente.
router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM priorities WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: "Recado não encontrado." });
  const b = req.body || {};
  const level = b.level !== undefined ? (LEVELS.includes(b.level) ? b.level : cur.level) : cur.level;
  db.prepare(
    `UPDATE priorities SET
       client_id   = ?,
       message     = ?,
       level       = ?,
       assignee_id = ?
     WHERE id = ? AND org_id = ?`
  ).run(
    b.client_id !== undefined ? (b.client_id || null) : cur.client_id,
    b.message !== undefined ? (b.message?.trim() || cur.message) : cur.message,
    level,
    b.assignee_id !== undefined ? (b.assignee_id || null) : cur.assignee_id,
    req.params.id, req.orgId
  );
  res.json(db.prepare(`${SELECT} WHERE p.id = ?`).get(req.params.id));
});

// PUT /api/priorities/:id/status { status, position } — move de coluna.
router.put("/:id/status", (req, res) => {
  const status = STATUSES.includes(req.body?.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: "Status inválido." });
  const done_at = status === "done" ? new Date().toISOString() : null;
  db.prepare("UPDATE priorities SET status = ?, position = ?, done_at = ? WHERE id = ? AND org_id = ?")
    .run(status, Number(req.body?.position) || 0, done_at, req.params.id, req.orgId);
  res.json(db.prepare(`${SELECT} WHERE p.id = ?`).get(req.params.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM priorities WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

export default router;
