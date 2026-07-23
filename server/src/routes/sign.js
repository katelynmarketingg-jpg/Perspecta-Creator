import { Router } from "express";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import { db } from "../db.js";
import { JWT_SECRET } from "../auth.js";

// Assinatura por link público: qualquer pessoa com o link (que você manda no
// WhatsApp) abre e assina, sem precisar de conta. O link é um token assinado.
export const signRouter = Router();

function contractHash(c) {
  return createHash("sha256")
    .update(`${c.id}|${c.title}|${c.value}|${c.notes || ""}`)
    .digest("hex");
}

// GET /api/sign/:token — mostra o contrato para assinar.
signRouter.get("/:token", (req, res) => {
  let payload;
  try {
    payload = jwt.verify(req.params.token, JWT_SECRET);
  } catch {
    return res.status(403).json({ error: "Este link expirou ou é inválido." });
  }
  if (payload.purpose !== "sign") return res.status(403).json({ error: "Link inválido." });

  const c = db.prepare("SELECT * FROM contracts WHERE id = ?").get(payload.contract_id);
  if (!c) return res.status(404).json({ error: "Contrato não encontrado." });
  const org = db.prepare("SELECT name FROM organizations WHERE id = ?").get(c.org_id);

  res.json({
    title: c.title,
    notes: c.notes,
    value: c.value,
    client_name: c.client_name || null,
    agency_name: org?.name || "",
    signed_at: c.signed_at,
    signer_name: c.signer_name,
  });
});

// POST /api/sign/:token — registra a assinatura com validação.
signRouter.post("/:token", (req, res) => {
  let payload;
  try {
    payload = jwt.verify(req.params.token, JWT_SECRET);
  } catch {
    return res.status(403).json({ error: "Este link expirou ou é inválido." });
  }
  if (payload.purpose !== "sign") return res.status(403).json({ error: "Link inválido." });

  const c = db.prepare("SELECT * FROM contracts WHERE id = ?").get(payload.contract_id);
  if (!c) return res.status(404).json({ error: "Contrato não encontrado." });
  if (c.signed_at) return res.status(400).json({ error: "Este contrato já foi assinado." });

  const { signer_name, signer_document, agreed } = req.body || {};
  if (!signer_name || !signer_document || !agreed) {
    return res.status(400).json({ error: "Informe nome completo, CPF/CNPJ e marque que leu e concorda." });
  }
  // Validação básica de CPF/CNPJ: só dígitos, 11 ou 14.
  const doc = String(signer_document).replace(/\D/g, "");
  if (doc.length !== 11 && doc.length !== 14) {
    return res.status(400).json({ error: "CPF ou CNPJ inválido." });
  }

  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  db.prepare(
    `UPDATE contracts SET signed_at = datetime('now'), signer_name = ?, signer_document = ?,
     signer_ip = ?, signed_hash = ? WHERE id = ?`
  ).run(signer_name.trim(), signer_document.trim(), ip, contractHash(c), c.id);

  db.prepare(
    "INSERT INTO notifications (audience, client_id, message, org_id) VALUES ('agency', ?, ?, ?)"
  ).run(c.client_id, `✍️ ${signer_name} assinou "${c.title}" pelo link.`, c.org_id);

  res.json({ ok: true });
});

// Gera o token de assinatura (chamado pela rota autenticada de contratos).
export function makeSignToken(contractId) {
  return jwt.sign({ purpose: "sign", contract_id: contractId }, JWT_SECRET, { expiresIn: "30d" });
}
