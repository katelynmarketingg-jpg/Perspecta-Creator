import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();

/**
 * O estilo do contrato (logo e onde ele fica) chega como texto JSON e, dentro
 * dele, o logo vai inteiro, em base64. Sem um teto aqui, uma foto de 5 MB vira
 * texto no banco e volta em toda leitura do serviço.
 *
 * 500 KB é folgado para um logo de 800 px — a tela já reduz antes de mandar.
 */
const LIMITE_ESTILO = 500 * 1024;
function confereEstilo(bruto) {
  if (bruto === undefined || bruto === null) return null;
  const texto = typeof bruto === "string" ? bruto : JSON.stringify(bruto);
  if (texto.length > LIMITE_ESTILO) {
    const e = new Error("Esse logo ficou grande demais. Use uma imagem menor ou mais simples.");
    e.code = "ESTILO_GRANDE";
    throw e;
  }
  return texto;
}
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
  let estilo;
  try { estilo = confereEstilo(b.contract_style); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const info = db
    .prepare("INSERT INTO services (name, default_price, contract_template, items_schema, category, contract_style, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(b.name, Number(b.default_price) || 0, b.contract_template ?? null, normalizeItems(b.items_schema), b.category ?? null, estilo, req.orgId);
  res.status(201).json(db.prepare("SELECT * FROM services WHERE id = ?").get(info.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM services WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: "Serviço não encontrado." });
  const b = req.body || {};
  let estilo;
  try { estilo = b.contract_style !== undefined ? confereEstilo(b.contract_style) : undefined; }
  catch (e) { return res.status(400).json({ error: e.message }); }
  db.prepare("UPDATE services SET name = ?, default_price = ?, contract_template = ?, items_schema = ?, category = ?, contract_style = ? WHERE id = ? AND org_id = ?").run(
    b.name ?? cur.name,
    b.default_price !== undefined ? Number(b.default_price) || 0 : cur.default_price,
    b.contract_template !== undefined ? b.contract_template : cur.contract_template,
    b.items_schema !== undefined ? normalizeItems(b.items_schema) : cur.items_schema,
    b.category !== undefined ? (b.category || null) : cur.category,
    estilo !== undefined ? estilo : cur.contract_style,
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
