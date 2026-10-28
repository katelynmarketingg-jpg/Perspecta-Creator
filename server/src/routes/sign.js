import { Router } from "express";
import jwt from "jsonwebtoken";
import { createHash, randomInt } from "node:crypto";
import { db } from "../db.js";
import { JWT_SECRET } from "../auth.js";
import { enviarEmail, emailConfigured, mascararEmail } from "../email.js";
import { garanteCodigoDeVerificacao } from "./verificar.js";

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

// Abre o contrato pelo token (ou null). Centraliza a verificação do link.
function contratoPorToken(token) {
  let payload;
  try { payload = jwt.verify(token, JWT_SECRET); } catch { return { erro: "Este link expirou ou é inválido." }; }
  if (payload.purpose !== "sign") return { erro: "Link inválido." };
  const c = db.prepare("SELECT * FROM contracts WHERE id = ?").get(payload.contract_id);
  if (!c) return { erro: "Contrato não encontrado.", status: 404 };
  return { c };
}

// E-mail para onde vai o código: o cadastrado no cliente do contrato.
function emailDoContrato(c) {
  if (!c.client_id) return null;
  const cli = db.prepare("SELECT email FROM clients WHERE id = ?").get(c.client_id);
  return (cli?.email || "").trim() || null;
}

// Um e-mail que dá para enviar de verdade. "kakakakaka" é truthy, mas o envio
// falha lá no provedor com um erro genérico — então a conferência é aqui, com
// um aviso que diz o que fazer (corrigir o cadastro).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailValido = (e) => Boolean(e) && EMAIL_RE.test(String(e).trim());

const hashCodigo = (codigo, contractId) =>
  createHash("sha256").update(`${codigo}|${contractId}|${JWT_SECRET}`).digest("hex");

// GET /api/sign/:token — mostra o contrato para assinar.
signRouter.get("/:token", (req, res) => {
  const { c, erro, status } = contratoPorToken(req.params.token);
  if (erro) return res.status(status || 403).json({ error: erro });
  const org = db.prepare("SELECT name FROM organizations WHERE id = ?").get(c.org_id);
  const email = emailDoContrato(c);

  res.json({
    title: c.title,
    notes: c.notes,
    value: c.value,
    client_name: c.client_name || null,
    agency_name: org?.name || "",
    signed_at: c.signed_at,
    signer_name: c.signer_name,
    // A ASSINATURA DA CASA VAI JUNTO. Quem abre o link para assinar precisa
    // ver que a Perspectiva já assinou — um contrato onde só o cliente assina
    // pede confiança sem dar nenhuma. (Vai só o que aparece no papel: o
    // desenho e o nome, nada do resto da casa.)
    agency_signed_at: c.agency_signed_at,
    agency_signer_name: c.agency_signer_name,
    agency_signer_document: c.agency_signer_document,
    agency_signature_img: c.agency_signature_img,
    integridade: conferirAssinatura(c),
    // Verificação por e-mail (código):
    verify_method: "email",
    email_mascarado: email ? mascararEmail(email) : null,
    email_no_cadastro: Boolean(email),
    email_valido: emailValido(email),
    email_ativo: emailConfigured(),
    verificado: Boolean(c.sign_verified_at),
    // Prova reforçada que a agência pediu para ESTE contrato (a tela mostra a
    // câmera e exige antes de assinar).
    require_selfie: Boolean(c.require_selfie),
    require_doc_photo: Boolean(c.require_doc_photo),
  });
});

// POST /api/sign/:token/send-code — envia um código de 6 dígitos para o e-mail
// do cliente. Reenviar substitui o código anterior (limite de 1 a cada 45s).
signRouter.post("/:token/send-code", async (req, res) => {
  const { c, erro, status } = contratoPorToken(req.params.token);
  if (erro) return res.status(status || 403).json({ error: erro });
  if (c.signed_at) return res.status(400).json({ error: "Este contrato já foi assinado." });
  if (!emailConfigured()) return res.status(503).json({ error: "O envio de e-mail ainda não foi configurado pela agência." });
  const email = emailDoContrato(c);
  if (!email) return res.status(400).json({ error: "Não há e-mail cadastrado para este cliente. Avise a agência." });
  if (!emailValido(email)) {
    return res.status(400).json({
      error: `O e-mail do cadastro (${email}) não é um e-mail válido. Peça para a agência corrigir o e-mail no seu cadastro.`,
      email_invalido: true,
    });
  }

  // Anti-spam: não reenvia se o último código tem menos de 45s.
  const atual = db.prepare("SELECT created_at FROM sign_codes WHERE contract_id = ?").get(c.id);
  if (atual) {
    const idade = (Date.now() - new Date(atual.created_at.replace(" ", "T") + "Z").getTime()) / 1000;
    if (idade < 45) return res.status(429).json({ error: `Aguarde ${Math.ceil(45 - idade)}s para pedir outro código.` });
  }

  const codigo = String(randomInt(0, 1000000)).padStart(6, "0");
  db.prepare(
    `INSERT INTO sign_codes (contract_id, code_hash, email, expires_at, attempts, verified, created_at)
     VALUES (@id, @hash, @email, datetime('now','+10 minutes'), 0, 0, datetime('now'))
     ON CONFLICT(contract_id) DO UPDATE SET
       code_hash = @hash, email = @email, expires_at = datetime('now','+10 minutes'),
       attempts = 0, verified = 0, created_at = datetime('now')`
  ).run({ id: c.id, hash: hashCodigo(codigo, c.id), email });

  const org = db.prepare("SELECT name FROM organizations WHERE id = ?").get(c.org_id);
  try {
    await enviarEmail({
      to: email,
      subject: `Código para assinar o contrato — ${org?.name || "Perspecta"}`,
      text: `Seu código para assinar "${c.title}" é: ${codigo}\n\nEle vale por 10 minutos. Se você não pediu, ignore este e-mail.`,
      html: `<p>Seu código para assinar <b>${c.title}</b> é:</p>`
          + `<p style="font-size:28px;font-weight:700;letter-spacing:4px">${codigo}</p>`
          + `<p>Ele vale por 10 minutos. Se você não pediu, ignore este e-mail.</p>`,
    });
  } catch {
    return res.status(502).json({ error: "Não foi possível enviar o e-mail agora. Tente de novo em instantes." });
  }
  res.json({ ok: true, email_mascarado: mascararEmail(email) });
});

// POST /api/sign/:token/verify-code — confere o código digitado.
signRouter.post("/:token/verify-code", (req, res) => {
  const { c, erro, status } = contratoPorToken(req.params.token);
  if (erro) return res.status(status || 403).json({ error: erro });
  if (c.signed_at) return res.status(400).json({ error: "Este contrato já foi assinado." });

  const codigo = String(req.body?.code || "").replace(/\D/g, "");
  const row = db.prepare("SELECT * FROM sign_codes WHERE contract_id = ?").get(c.id);
  if (!row) return res.status(400).json({ error: "Peça um código primeiro." });
  const expirado = new Date(row.expires_at.replace(" ", "T") + "Z").getTime() < Date.now();
  if (expirado) return res.status(400).json({ error: "O código expirou. Peça um novo." });
  if (row.attempts >= 5) return res.status(429).json({ error: "Muitas tentativas. Peça um novo código." });

  if (hashCodigo(codigo, c.id) !== row.code_hash) {
    db.prepare("UPDATE sign_codes SET attempts = attempts + 1 WHERE contract_id = ?").run(c.id);
    return res.status(400).json({ error: "Código incorreto." });
  }
  db.prepare("UPDATE sign_codes SET verified = 1 WHERE contract_id = ?").run(c.id);
  res.json({ ok: true });
});

// POST /api/sign/:token — registra a assinatura com validação.
signRouter.post("/:token", (req, res) => {
  const { c, erro, status } = contratoPorToken(req.params.token);
  if (erro) return res.status(status || 403).json({ error: erro });
  if (c.signed_at) return res.status(400).json({ error: "Este contrato já foi assinado." });

  // Exige a verificação por código feita e ainda válida.
  const row = db.prepare("SELECT * FROM sign_codes WHERE contract_id = ?").get(c.id);
  const verifExpirado = row && new Date(row.expires_at.replace(" ", "T") + "Z").getTime() < Date.now();
  if (!row || !row.verified || verifExpirado) {
    return res.status(400).json({ error: "Confirme o código enviado para o seu e-mail antes de assinar.", precisa_verificar: true });
  }

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

  // Selfie e foto do documento: exigidas só quando a agência pediu neste
  // contrato. Cada uma é uma imagem (data URI), limitada em tamanho.
  const { selfie, doc_photo } = req.body || {};
  const imagemOk = (v) => typeof v === "string" && /^data:image\//.test(v) && v.length <= 900000;
  if (c.require_selfie && !imagemOk(selfie)) {
    return res.status(400).json({ error: "Tire a selfie pedida antes de assinar.", precisa_selfie: true });
  }
  if (c.require_doc_photo && !imagemOk(doc_photo)) {
    return res.status(400).json({ error: "Envie a foto do seu documento antes de assinar.", precisa_doc: true });
  }
  // Só guarda o que veio válido (e só se foi pedido).
  const selfieGravar = c.require_selfie && imagemOk(selfie) ? selfie : null;
  const docGravar = c.require_doc_photo && imagemOk(doc_photo) ? doc_photo : null;

  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  // O navegador/dispositivo faz parte da trilha de auditoria (vai no termo de
  // veracidade). Limitado em tamanho por segurança.
  const userAgent = String(req.headers["user-agent"] || "").slice(0, 400);
  db.prepare(
    `UPDATE contracts SET signed_at = datetime('now'), signer_name = ?, signer_document = ?,
     signer_ip = ?, signer_user_agent = ?, signed_hash = ?, signature_img = ?,
     signer_email = ?, sign_verified_at = datetime('now'), sign_verify_method = 'email', sign_verify_dest = ?,
     signer_selfie = ?, signer_doc_photo = ?
     WHERE id = ?`
  ).run(signer_name.trim(), signer_document.trim(), ip, userAgent, contractHash(c), signature_img,
        row.email, mascararEmail(row.email), selfieGravar, docGravar, c.id);
  db.prepare("DELETE FROM sign_codes WHERE contract_id = ?").run(c.id);
  // A partir daqui o documento pode ser conferido por qualquer um, com o
  // código que vai impresso no termo.
  garanteCodigoDeVerificacao(c.id);

  db.prepare(
    "INSERT INTO notifications (audience, client_id, message, org_id) VALUES ('agency', ?, ?, ?)"
  ).run(c.client_id, `✍️ ${signer_name} assinou "${c.title}" pelo link (verificado por e-mail).`, c.org_id);

  res.json({ ok: true });
});

// Gera o token de assinatura (chamado pela rota autenticada de contratos).
export function makeSignToken(contractId) {
  return jwt.sign({ purpose: "sign", contract_id: contractId }, JWT_SECRET, { expiresIn: "30d" });
}
