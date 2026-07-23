import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();
router.use(authRequired);

// Guarda a lista de itens do serviço como JSON limpo: [{label, unit}].
function normalizeItems(items) {
  if (!Array.isArray(items)) return null;
  const limpos = items
    .map((i) => ({ label: String(i.label || "").trim(), unit: String(i.unit || "").trim() }))
    .filter((i) => i.label);
  return limpos.length ? JSON.stringify(limpos) : null;
}

router.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM services WHERE org_id = ? ORDER BY name").all(req.orgId));
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "Nome do serviço é obrigatório." });
  const info = db
    .prepare("INSERT INTO services (name, default_price, contract_template, items_schema, org_id) VALUES (?, ?, ?, ?, ?)")
    .run(b.name, Number(b.default_price) || 0, b.contract_template ?? null, normalizeItems(b.items_schema), req.orgId);
  res.status(201).json(db.prepare("SELECT * FROM services WHERE id = ?").get(info.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM services WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: "Serviço não encontrado." });
  const b = req.body || {};
  db.prepare("UPDATE services SET name = ?, default_price = ?, contract_template = ?, items_schema = ? WHERE id = ? AND org_id = ?").run(
    b.name ?? cur.name,
    b.default_price !== undefined ? Number(b.default_price) || 0 : cur.default_price,
    b.contract_template !== undefined ? b.contract_template : cur.contract_template,
    b.items_schema !== undefined ? normalizeItems(b.items_schema) : cur.items_schema,
    req.params.id,
    req.orgId
  );
  res.json(db.prepare("SELECT * FROM services WHERE id = ?").get(req.params.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM services WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

export default router;
