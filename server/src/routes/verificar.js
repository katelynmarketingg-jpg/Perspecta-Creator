import { Router } from "express";
import { randomInt } from "node:crypto";
import { db } from "../db.js";
import { conferirAssinatura } from "./sign.js";
import { chaveDaPorta, trancada, registraErro, registraAcerto } from "../tranca.js";

// ---------------------------------------------------------------------------
// VERIFICAÇÃO PÚBLICA DE UM CONTRATO ASSINADO.
//
// O Termo de Veracidade diz "o hash deste documento é X". Sozinho, isso é uma
// AFIRMAÇÃO: quem recebe o PDF — o cliente, um advogado, um juiz — não tem
// como conferir se é verdade. Esta é a outra metade: um endereço público onde
// se digita o código impresso no termo (ou se aponta a câmera para o QR) e o
// sistema responde se aquele documento é mesmo o que foi assinado, por quem e
// quando — e se o texto foi alterado depois.
//
// O que NÃO sai daqui: o texto do contrato, o valor, o e-mail inteiro, o CPF
// inteiro. Verificar é confirmar que o documento é autêntico, não ler o
// contrato dos outros.
// ---------------------------------------------------------------------------

// Sem 0/O, 1/I/L: o código é ditado no telefone e digitado de um papel.
const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const TAMANHO = 6;

/** Um código novo, no formato ABC-K7M (o traço é só para a leitura). */
export function geraCodigo() {
  let s = "";
  for (let i = 0; i < TAMANHO; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return s;
}

/** Como o código é digitado vira como ele é guardado: maiúsculas, sem traço. */
export const normalizaCodigo = (bruto) =>
  String(bruto || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 12);

/** Com traço no meio, que é como ele aparece impresso. */
export const codigoLegivel = (c) =>
  (c || "").length === 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : (c || "");

/**
 * O contrato ganha o código na PRIMEIRA assinatura (a da casa ou a do
 * cliente) e fica com ele para sempre: é o que vai impresso no termo. Chamar
 * de novo não troca o código — um papel já entregue continuaria valendo um
 * código que não existe mais.
 */
export function garanteCodigoDeVerificacao(contratoId) {
  const c = db.prepare("SELECT id, verify_code FROM contracts WHERE id = ?").get(contratoId);
  if (!c) return null;
  if (c.verify_code) return c.verify_code;
  const existe = db.prepare("SELECT 1 FROM contracts WHERE verify_code = ?");
  for (let i = 0; i < 25; i++) {
    const codigo = geraCodigo();
    if (existe.get(codigo)) continue;
    db.prepare("UPDATE contracts SET verify_code = ? WHERE id = ?").run(codigo, contratoId);
    return codigo;
  }
  return null;
}

/** CPF/CNPJ com o meio à mostra e as pontas escondidas. */
function mascaraDocumento(doc) {
  const d = String(doc || "").replace(/\D/g, "");
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-**`;
  return d ? `${"*".repeat(Math.max(0, d.length - 4))}${d.slice(-4)}` : "";
}

export const verificarRouter = Router();

// GET /api/verificar/:codigo — público, sem login.
verificarRouter.get("/:codigo", (req, res) => {
  // Um código de 6 letras tem ~900 milhões de combinações, mas ninguém
  // precisa tentar milhares por minuto para conferir um papel na mão.
  const porta = chaveDaPorta(req, "verificar");
  if (trancada(req, res, porta)) return;

  const codigo = normalizaCodigo(req.params.codigo);
  if (codigo.length !== TAMANHO) {
    registraErro(porta);
    return res.status(404).json({ encontrado: false, error: "Código inválido. Confira as 6 letras e números do termo." });
  }

  const c = db.prepare("SELECT * FROM contracts WHERE verify_code = ?").get(codigo);
  if (!c) {
    registraErro(porta);
    return res.status(404).json({ encontrado: false, error: "Não encontrei nenhum documento com esse código." });
  }
  registraAcerto(porta);

  const org = db.prepare("SELECT name FROM organizations WHERE id = ?").get(c.org_id);
  const integridade = conferirAssinatura(c);   // "ok" | "alterado" | null
  const assinaturas = [];
  if (c.signed_at) {
    assinaturas.push({
      papel: "CONTRATANTE",
      nome: c.signer_name || "—",
      documento: mascaraDocumento(c.signer_document),
      quando: c.signed_at,
      // sign_verify_dest já é o e-mail mascarado (k****@gmail.com).
      verificacao: c.sign_verify_method === "email"
        ? `Código único enviado por e-mail${c.sign_verify_dest ? ` (${c.sign_verify_dest})` : ""}`
        : "",
    });
  }
  if (c.agency_signed_at) {
    assinaturas.push({
      papel: "CONTRATADA",
      nome: c.agency_signer_name || org?.name || "—",
      documento: mascaraDocumento(c.agency_signer_document),
      quando: c.agency_signed_at,
      verificacao: "Assinatura da agência",
    });
  }

  res.json({
    encontrado: true,
    codigo: codigoLegivel(codigo),
    // "alterado" é o caso que importa: o papel na mão não é mais o documento
    // que foi assinado. Dizer isso é a razão de esta página existir.
    status: integridade === "alterado" ? "alterado" : "assinado",
    documento: {
      numero: `#${c.id}`,
      titulo: c.title,
      emitido_por: org?.name || "",
      criado_em: c.created_at || null,
    },
    assinaturas,
    // Só o fim do hash: confere com o que está impresso no termo sem servir de
    // atalho para adivinhar o documento.
    hash_final: c.signed_hash ? c.signed_hash.slice(-12) : null,
    conferido_em: new Date().toISOString(),
  });
});
