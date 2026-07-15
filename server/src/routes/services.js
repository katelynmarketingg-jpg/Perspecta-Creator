import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();
router.use(authRequired);

router.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM services ORDER BY name").all());
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "Nome do serviço é obrigatório." });
  const info = db
    .prepare("INSERT INTO services (name, default_price, contract_template) VALUES (?, ?, ?)")
    .run(b.name, Number(b.default_price) || 0, b.contract_template ?? null);
  res.status(201).json(db.prepare("SELECT * FROM services WHERE id = ?").get(info.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM services WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "Serviço não encontrado." });
  const b = req.body || {};
  db.prepare("UPDATE services SET name = ?, default_price = ?, contract_template = ? WHERE id = ?").run(
    b.name ?? cur.name,
    b.default_price !== undefined ? Number(b.default_price) || 0 : cur.default_price,
    b.contract_template !== undefined ? b.contract_template : cur.contract_template,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM services WHERE id = ?").get(req.params.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM services WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
