import { Router } from "express";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import { db } from "../db.js";
import { JWT_SECRET } from "../auth.js";

// Assinatura por link público: qualquer pessoa com o link (que você manda no
// WhatsApp) abre e assina, sem precisar de conta. O link é um token assinado.
export const signRouter = Router();

// A impressão digital do que foi assinado: id, título, valor e o TEXTO. Se
// qualquer um mudar depois, a conta dá diferente — e é assim que se prova que
// o documento não é mais o que a pessoa leu.
export function contractHash(c) {
  return createHash("sha256")
    .update(`${c.id}|${c.title}|${c.value}|${c.notes || ""}`)
    .digest("hex");
}

/**
 * O contrato assinado ainda é o mesmo que a pessoa assinou?
 *
 * O hash era gravado na assinatura e NUNCA MAIS conferido. Bastava alguém
 * editar o texto depois para a tela continuar dizendo "assinado por Fulano em
 * tal data" sobre um documento que Fulano nunca viu. Agora a conferência é
 * feita toda vez que o contrato é lido.
 *
 * Devolve: "ok" | "alterado" | null (não assinado / assinado antes desta
 * verificação existir, quando não há hash guardado).
 */
export function conferirAssinatura(c) {
  if (!c?.signed_at) return null;
  if (!c.signed_hash) return null;
  return contractHash(c) === c.signed_hash ? "ok" : "alterado";
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
    integridade: conferirAssinatura(c),
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

  const { signer_name, signer_document, agreed, signature_img } = req.body || {};
  if (!signer_name || !signer_document || !agreed) {
    return res.status(400).json({ error: "Informe nome completo, CPF/CNPJ e marque que leu e concorda." });
  }
  // Validação básica de CPF/CNPJ: só dígitos, 11 ou 14.
  const doc = String(signer_document).replace(/\D/g, "");
  if (doc.length !== 11 && doc.length !== 14) {
    return res.status(400).json({ error: "CPF ou CNPJ inválido." });
  }
  // Exige o desenho da assinatura (data URI de imagem), com tamanho sensato.
  if (!signature_img || !/^data:image\//.test(signature_img)) {
    return res.status(400).json({ error: "Desenhe sua assinatura no quadro antes de confirmar." });
  }
  if (signature_img.length > 400000) {
    return res.status(400).json({ error: "Assinatura muito grande. Tente novamente." });
  }

  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  db.prepare(
    `UPDATE contracts SET signed_at = datetime('now'), signer_name = ?, signer_document = ?,
     signer_ip = ?, signed_hash = ?, signature_img = ? WHERE id = ?`
  ).run(signer_name.trim(), signer_document.trim(), ip, contractHash(c), signature_img, c.id);

  db.prepare(
    "INSERT INTO notifications (audience, client_id, message, org_id) VALUES ('agency', ?, ?, ?)"
  ).run(c.client_id, `✍️ ${signer_name} assinou "${c.title}" pelo link.`, c.org_id);

  res.json({ ok: true });
});

// Gera o token de assinatura (chamado pela rota autenticada de contratos).
export function makeSignToken(contractId) {
  return jwt.sign({ purpose: "sign", contract_id: contractId }, JWT_SECRET, { expiresIn: "30d" });
}
