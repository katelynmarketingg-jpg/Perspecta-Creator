import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";

// ---------------------------------------------------------------------------
// Planejamento — datas importantes por empresa.
//
// Não é sobre posts (isso é a Distribuição). Aqui a equipe marca as datas-chave
// de cada cliente (campanhas, sazonalidades, prazos, lançamentos) e escreve o
// que é cada uma. As telas mostram por mês/trimestre/semestre/ano e em documento.
// ---------------------------------------------------------------------------
const router = Router();
router.use(authRequired, moduleAllowed("calendario"));

const SELECT = `
  SELECT p.id, p.client_id, p.date, p.title, p.notes, p.created_at,
         c.name AS client_name
  FROM planning_dates p LEFT JOIN clients c ON c.id = p.client_id`;

// GET /api/planning?client_id=&from=&to=
router.get("/", (req, res) => {
  const where = ["p.org_id = @org_id"];
  const params = { org_id: req.orgId };
  if (req.query.client_id) { where.push("p.client_id = @client_id"); params.client_id = req.query.client_id; }
  if (req.query.from) { where.push("p.date >= @from"); params.from = req.query.from; }
  if (req.query.to) { where.push("p.date <= @to"); params.to = req.query.to; }
  const rows = db.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY p.date, p.id`).all(params);
  res.json(rows);
});

// --- Documento de planejamento (texto rico) por cliente e mês -------------
// (definido ANTES de /:id para não colidir com PUT /:id)

// GET /api/planning/doc?client_id=&ym=
router.get("/doc", (req, res) => {
  const { client_id, ym } = req.query;
  if (!client_id || !ym) return res.status(400).json({ error: "Informe o cliente e o mês." });
  const row = db.prepare("SELECT content, updated_at FROM planning_docs WHERE org_id=? AND client_id=? AND ym=?")
    .get(req.orgId, client_id, ym);
  res.json({ content: row?.content || null, updated_at: row?.updated_at || null });
});

// PUT /api/planning/doc { client_id, ym, content } — cria/atualiza (upsert).
router.put("/doc", (req, res) => {
  const { client_id, ym, content } = req.body || {};
  if (!client_id || !ym) return res.status(400).json({ error: "Informe o cliente e o mês." });
  db.prepare(
    `INSERT INTO planning_docs (org_id, client_id, ym, content, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(org_id, client_id, ym)
       DO UPDATE SET content = excluded.content, updated_at = datetime('now')`
  ).run(req.orgId, client_id, ym, content ?? null);
  res.json({ ok: true });
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.date || !b.title) return res.status(400).json({ error: "Data e título são obrigatórios." });
  const info = db
    .prepare(
      `INSERT INTO planning_dates (org_id, client_id, date, title, notes)
       VALUES (@org_id, @client_id, @date, @title, @notes)`
    )
    .run({
      org_id: req.orgId,
      client_id: b.client_id || null,
      date: b.date,
      title: b.title,
      notes: b.notes ?? null,
    });
  res.status(201).json(db.prepare(`${SELECT} WHERE p.id = ?`).get(info.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM planning_dates WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: "Data não encontrada." });
  const merged = {
    ...cur, ...req.body,
    client_id: req.body.client_id === undefined ? cur.client_id : (req.body.client_id || null),
    id: req.params.id, org_id: req.orgId,
  };
  db.prepare(
    `UPDATE planning_dates SET client_id=@client_id, date=@date, title=@title, notes=@notes
     WHERE id=@id AND org_id=@org_id`
  ).run(merged);
  res.json(db.prepare(`${SELECT} WHERE p.id = ?`).get(req.params.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM planning_dates WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

export default router;
