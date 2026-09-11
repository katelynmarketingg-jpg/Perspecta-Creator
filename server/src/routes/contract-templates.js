import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";
import { MODELO_REDES } from "../contract-model.js";
import { geraContrato } from "../contract-gen.js";

// Modelos de contrato: a equipe cadastra um texto-base com marcadores e, ao
// gerar, o sistema preenche com os dados do cliente e cria um contrato pronto
// para assinatura (usa o mesmo fluxo de assinatura já existente).
const router = Router();
router.use(authRequired, moduleAllowed("contratos"));

router.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM contract_templates WHERE org_id = ? ORDER BY name").all(req.orgId));
});

// POST /api/contract-templates/pronto — cria o modelo de gestão de redes
// sociais já escrito, com os marcadores e as cláusulas de proteção. É um ponto
// de partida para a equipe ajustar, não um parecer jurídico.
router.post("/pronto", (req, res) => {
  const info = db.prepare("INSERT INTO contract_templates (org_id, name, body) VALUES (?, ?, ?)")
    .run(req.orgId, MODELO_REDES.name, MODELO_REDES.body);
  res.status(201).json(db.prepare("SELECT * FROM contract_templates WHERE id = ?").get(info.lastInsertRowid));
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "Dê um nome ao modelo." });
  const info = db.prepare("INSERT INTO contract_templates (org_id, name, body, service_id) VALUES (?, ?, ?, ?)")
    .run(req.orgId, b.name, b.body ?? "", b.service_id || null);
  res.status(201).json(db.prepare("SELECT * FROM contract_templates WHERE id = ?").get(info.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM contract_templates WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: "Modelo não encontrado." });
  const b = req.body || {};
  db.prepare("UPDATE contract_templates SET name = ?, body = ?, service_id = ? WHERE id = ? AND org_id = ?")
    .run(b.name ?? cur.name, b.body ?? cur.body,
      b.service_id !== undefined ? (b.service_id || null) : cur.service_id, req.params.id, req.orgId);
  res.json(db.prepare("SELECT * FROM contract_templates WHERE id = ?").get(req.params.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM contract_templates WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

// POST /api/contract-templates/:id/generate — cria um contrato a partir do
// modelo, preenchido com os dados do cliente. Devolve o contrato criado.
//
// O preenchimento em si mora em contract-gen.js: o onboarding também gera
// contrato (sozinho, quando o cliente termina de responder) e os dois precisam
// sair idênticos.
router.post("/:id/generate", (req, res) => {
  const b = req.body || {};
  if (!b.client_id) return res.status(400).json({ error: "Escolha o cliente." });
  try {
    res.status(201).json(geraContrato(req.orgId, { ...b, service_id: null, template_id: req.params.id }));
  } catch (e) {
    const codigo = e.code === "SEM_MODELO" || e.code === "SEM_CLIENTE" ? 404 : 400;
    res.status(codigo).json({ error: e.message });
  }
});

export default router;
