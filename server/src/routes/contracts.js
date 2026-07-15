import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();
router.use(authRequired);

const SELECT = `
  SELECT ct.*, c.name AS client_name
  FROM contracts ct LEFT JOIN clients c ON c.id = ct.client_id`;

router.get("/", (req, res) => {
  res.json(db.prepare(`${SELECT} ORDER BY ct.created_at DESC`).all());
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: "Título é obrigatório." });
  const info = db
    .prepare(
      `INSERT INTO contracts (client_id, title, value, duration_months, start_date, first_due_date, status, notes)
       VALUES (@client_id, @title, @value, @duration_months, @start_date, @first_due_date, @status, @notes)`
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
    });
  res.status(201).json(db.prepare(`${SELECT} WHERE ct.id = ?`).get(info.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM contracts WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "Contrato não encontrado." });
  const merged = { ...cur, ...req.body, id: req.params.id };
  db.prepare(
    `UPDATE contracts SET client_id=@client_id, title=@title, value=@value,
     duration_months=@duration_months, start_date=@start_date, first_due_date=@first_due_date,
     status=@status, notes=@notes WHERE id=@id`
  ).run(merged);
  res.json(db.prepare(`${SELECT} WHERE ct.id = ?`).get(req.params.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM contracts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
