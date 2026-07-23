import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";
import { makeSignToken } from "./sign.js";

const router = Router();
router.use(authRequired, moduleAllowed("contratos"));

const SELECT = `
  SELECT ct.*, c.name AS client_name
  FROM contracts ct LEFT JOIN clients c ON c.id = ct.client_id`;

router.get("/", (req, res) => {
  res.json(db.prepare(`${SELECT} WHERE ct.org_id = ? ORDER BY ct.created_at DESC`).all(req.orgId));
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: "Título é obrigatório." });
  const info = db
    .prepare(
      `INSERT INTO contracts (client_id, title, value, duration_months, start_date, first_due_date, status, notes, org_id)
       VALUES (@client_id, @title, @value, @duration_months, @start_date, @first_due_date, @status, @notes, @org_id)`
    )
    .run({
      client_id: b.client_id ?? null,
      title: b.title,
      value: Number(b.value) || 0,
      duration_months: b.duration_months ? Number(b.duration_months) : null,
      start_date: b.start_date ?? null,
      first_due_date: b.first_due_date ?? null,
      status: b.status ?? "active",
      notes: b.notes ?? null,
      org_id: req.orgId,
    });
  res.status(201).json(db.prepare(`${SELECT} WHERE ct.id = ?`).get(info.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM contracts WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: "Contrato não encontrado." });
  const merged = { ...cur, ...req.body, id: req.params.id, org_id: req.orgId };
  db.prepare(
    `UPDATE contracts SET client_id=@client_id, title=@title, value=@value,
     duration_months=@duration_months, start_date=@start_date, first_due_date=@first_due_date,
     status=@status, notes=@notes WHERE id=@id AND org_id=@org_id`
  ).run(merged);
  res.json(db.prepare(`${SELECT} WHERE ct.id = ?`).get(req.params.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM contracts WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

// POST /api/contracts/:id/sign-link — gera o link público para o cliente assinar.
router.post("/:id/sign-link", (req, res) => {
  const c = db.prepare("SELECT * FROM contracts WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!c) return res.status(404).json({ error: "Contrato não encontrado." });
  const token = makeSignToken(c.id);
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.headers.host}`;
  res.json({ url: `${base}/assinar/${token}`, signed: Boolean(c.signed_at) });
});

export default router;
