// ---------------------------------------------------------------------------
// Recibos — regras de negócio.
//
// Em uma frase: quando uma receita é marcada como PAGA, nasce aqui o recibo
// daquele lançamento, já preenchido pelo modelo salvo do escritório, numerado
// e assinado com a assinatura guardada nas Configurações.
//
// Nada de biblioteca de PDF: o documento é HTML e o navegador imprime/salva.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import { db } from "./db.js";

// --- Valor por extenso (pt-BR) ---------------------------------------------
const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const DEZ_A_DEZENOVE = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

// Escreve um bloco de 0 a 999 ("cento e vinte e três").
function trioPorExtenso(n) {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const d = Math.floor((n % 100) / 10);
  const u = n % 10;
  const partes = [];
  if (c) partes.push(CENTENAS[c]);
  if (d === 1) partes.push(DEZ_A_DEZENOVE[u]);
  else {
    if (d) partes.push(DEZENAS[d]);
    if (u) partes.push(UNIDADES[u]);
  }
  return partes.join(" e ");
}

const ESCALAS = [
  { s: 1e9, um: "bilhão", muitos: "bilhões" },
  { s: 1e6, um: "milhão", muitos: "milhões" },
  { s: 1e3, um: "mil", muitos: "mil" },
];

// Parte inteira por extenso (sem "reais"), já com os "e" nos lugares certos.
function inteiroPorExtenso(n) {
  if (n === 0) return "zero";
  const partes = [];
  let resto = n;
  for (const { s, um, muitos } of ESCALAS) {
    const q = Math.floor(resto / s);
    if (q > 0) {
      // "mil" não leva "um" na frente: 1000 = "mil", não "um mil".
      const prefixo = s === 1e3 && q === 1 ? "" : `${trioPorExtenso(q)} `;
      partes.push(`${prefixo}${q === 1 ? um : muitos}`.trim());
      resto -= q * s;
    }
  }
  if (resto > 0) partes.push(trioPorExtenso(resto));
  // "e" antes do último bloco quando ele é pequeno (mil e duzentos / mil duzentos e dez).
  if (partes.length > 1) {
    const ultimo = n % 1000;
    const juntar = ultimo > 0 && (ultimo < 100 || ultimo % 100 === 0);
    const cabeca = partes.slice(0, -1).join(", ");
    return `${cabeca}${juntar ? " e " : ", "}${partes[partes.length - 1]}`;
  }
  return partes[0];
}

/** Valor em reais por extenso: 1234.5 -> "mil, duzentos e trinta e quatro reais e cinquenta centavos". */
export function valorPorExtenso(valor) {
  const v = Math.round((Number(valor) || 0) * 100);
  const reais = Math.floor(Math.abs(v) / 100);
  const centavos = Math.abs(v) % 100;
  const partes = [];
  if (reais > 0) partes.push(`${inteiroPorExtenso(reais)} ${reais === 1 ? "real" : "reais"}`);
  if (centavos > 0) partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  if (!partes.length) return "zero real";
  return partes.join(" e ");
}

// --- Formatações ------------------------------------------------------------
export function moeda(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function dataExtenso(iso) {
  const d = new Date(`${String(iso || "").slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

export function dataCurta(iso) {
  const s = String(iso || "").slice(0, 10);
  const [y, m, d] = s.split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
}

// CPF/CNPJ com máscara; se não tiver 11/14 dígitos, devolve como veio.
export function formataDocumento(doc) {
  const n = String(doc || "").replace(/\D/g, "");
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return String(doc || "").trim();
}

// --- Modelo padrão ----------------------------------------------------------
export const DEFAULT_BODY =
  `Recebi(emos) de {{cliente}}{{documento_cliente_paren}} a importância de ` +
  `{{valor}} ({{valor_extenso}}), referente a {{descricao}}{{competencia_frase}}.\n\n` +
  `Para maior clareza, firmo(amos) o presente recibo, dando plena e geral ` +
  `quitação do valor acima, nada mais tendo a reclamar.`;

export const DEFAULT_STYLE = {
  accent: "#EA580C",
  logo_height: 56,
  logo_align: "left",     // left | center | right
  header: "RECIBO DE PAGAMENTO",
  footer: "",
  show_signature: true,
};

export function parseStyle(raw) {
  try { return { ...DEFAULT_STYLE, ...(raw ? JSON.parse(raw) : {}) }; }
  catch { return { ...DEFAULT_STYLE }; }
}

/** Modelo padrão do escritório (ou um modelo "de fábrica" quando não há nenhum). */
export function defaultTemplate(orgId) {
  const t = db.prepare(
    `SELECT * FROM receipt_templates WHERE org_id = ?
     ORDER BY is_default DESC, id ASC LIMIT 1`
  ).get(orgId);
  if (t) return t;
  return { id: null, name: "Modelo padrão", body: DEFAULT_BODY, style: JSON.stringify(DEFAULT_STYLE), logo: null };
}

// --- Marcadores -------------------------------------------------------------
/** Valores dos {{marcadores}} a partir de um recibo já montado. */
export function marcadores(r) {
  const docCliente = formataDocumento(r.payer_document);
  const competencia = (r.reference || "").trim();
  return {
    numero: r.number || "—",
    cliente: r.payer_name || "",
    documento_cliente: docCliente,
    documento_cliente_paren: docCliente ? `, inscrito(a) no CPF/CNPJ sob o nº ${docCliente},` : "",
    endereco_cliente: r.payer_address || "",
    valor: moeda(r.amount),
    valor_extenso: r.amount_words || valorPorExtenso(r.amount),
    descricao: r.description || "",
    competencia,
    competencia_frase: competencia ? `, referente ao período de ${competencia}` : "",
    forma_pagamento: r.payment_method || "",
    data: dataCurta(r.receipt_date),
    data_extenso: dataExtenso(r.receipt_date),
    local: r.place || "",
    emitente: r.emitter_name || "",
    documento_emitente: formataDocumento(r.emitter_document),
    endereco_emitente: r.emitter_address || "",
  };
}

/** Troca os {{marcadores}} do corpo pelos valores do recibo. */
export function renderBody(body, r) {
  const vars = marcadores(r);
  return String(body || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, chave) => {
    const v = vars[String(chave).toLowerCase()];
    return v === undefined ? m : v;
  });
}

// --- Integridade ------------------------------------------------------------
/** Hash do conteúdo: muda se qualquer dado do documento mudar. */
export function receiptHash(r) {
  const base = [
    r.number, r.amount, r.description, r.reference, r.payment_method,
    r.receipt_date, r.emitter_name, r.emitter_document,
    r.payer_name, r.payer_document, r.notes, renderBody(r.body, r),
  ].join("|");
  return createHash("sha256").update(base).digest("hex");
}

// --- Emissão ----------------------------------------------------------------
/** Próximo número do ano, por escritório: 1, 2, 3… (sem buraco, sem repetir). */
function proximoSeq(orgId, ano) {
  const row = db.prepare(
    "SELECT COALESCE(MAX(seq), 0) AS ultimo FROM receipts WHERE org_id = ? AND year = ?"
  ).get(orgId, ano);
  return (row?.ultimo || 0) + 1;
}

export function formataNumero(seq, ano) {
  return `${String(seq).padStart(4, "0")}/${ano}`;
}

/** Só se pode ver/baixar recibo de lançamento PAGO — a regra vale no servidor. */
export function entryPago(entry) {
  return !!entry && entry.status === "paid";
}

/**
 * Cria (ou devolve) o recibo de um lançamento de receita PAGO.
 * Idempotente: chamar duas vezes não gera dois recibos.
 * Devolve null quando o lançamento não é receita, não está pago, ou já foi apagado.
 */
export function ensureReceiptForEntry(entryId, { userId = null, ip = null } = {}) {
  const entry = db.prepare("SELECT * FROM financial_entries WHERE id = ?").get(entryId);
  if (!entry || entry.type !== "income" || !entryPago(entry)) return null;

  const existente = db.prepare("SELECT * FROM receipts WHERE entry_id = ?").get(entryId);
  if (existente) {
    // Voltou a ser pago depois de cancelado: reativa o mesmo número.
    if (existente.status === "canceled") {
      db.prepare("UPDATE receipts SET status = 'issued', canceled_at = NULL, cancel_reason = NULL WHERE id = ?")
        .run(existente.id);
      return db.prepare("SELECT * FROM receipts WHERE id = ?").get(existente.id);
    }
    return existente;
  }

  const org = db.prepare("SELECT * FROM organizations WHERE id = ?").get(entry.org_id) || {};
  const cliente = entry.client_id
    ? db.prepare("SELECT * FROM clients WHERE id = ?").get(entry.client_id)
    : null;
  const modelo = defaultTemplate(entry.org_id);
  const hoje = new Date().toISOString().slice(0, 10);
  const dataRecibo = (entry.paid_at || hoje).slice(0, 10);
  const ano = Number(dataRecibo.slice(0, 4));

  // Numeração + gravação na mesma transação: dois cliques ao mesmo tempo não
  // conseguem pegar o mesmo número.
  const tx = db.transaction(() => {
    const seq = proximoSeq(entry.org_id, ano);
    const rec = {
      org_id: entry.org_id,
      entry_id: entry.id,
      client_id: entry.client_id || null,
      status: "issued",
      number: formataNumero(seq, ano),
      year: ano,
      seq,
      amount: entry.amount,
      amount_words: valorPorExtenso(entry.amount),
      description: entry.description || "",
      reference: entry.due_date ? entry.due_date.slice(0, 7).split("-").reverse().join("/") : "",
      payment_method: entry.card || "",
      place: org.city || "",
      receipt_date: dataRecibo,
      notes: "",
      emitter_name: org.name || "",
      emitter_document: org.document || "",
      emitter_address: org.address || "",
      payer_name: cliente?.company || cliente?.name || "",
      payer_document: cliente?.document || "",
      payer_address: cliente?.address || "",
      logo: modelo.logo || org.logo || null,
      signature_img: org.signature_img || null,
      signer_name: org.signer_name || "",
      signer_document: org.signer_document || "",
      signer_role: org.signer_role || "",
      template_id: modelo.id,
      body: modelo.body || DEFAULT_BODY,
      style: modelo.style || JSON.stringify(DEFAULT_STYLE),
      version: 1,
      issued_at: new Date().toISOString(),
      issued_by: userId,
      issued_ip: ip,
    };
    rec.content_hash = receiptHash(rec);
    const info = db.prepare(`
      INSERT INTO receipts (org_id, entry_id, client_id, status, number, year, seq, amount, amount_words,
        description, reference, payment_method, place, receipt_date, notes,
        emitter_name, emitter_document, emitter_address, payer_name, payer_document, payer_address,
        logo, signature_img, signer_name, signer_document, signer_role,
        template_id, body, style, content_hash, version, issued_at, issued_by, issued_ip)
      VALUES (@org_id, @entry_id, @client_id, @status, @number, @year, @seq, @amount, @amount_words,
        @description, @reference, @payment_method, @place, @receipt_date, @notes,
        @emitter_name, @emitter_document, @emitter_address, @payer_name, @payer_document, @payer_address,
        @logo, @signature_img, @signer_name, @signer_document, @signer_role,
        @template_id, @body, @style, @content_hash, @version, @issued_at, @issued_by, @issued_ip)
    `).run(rec);
    return info.lastInsertRowid;
  });

  const id = tx();
  return db.prepare("SELECT * FROM receipts WHERE id = ?").get(id);
}

/** Lançamento deixou de estar pago: o recibo fica cancelado (não some do histórico). */
export function cancelReceiptForEntry(entryId, motivo = "Lançamento deixou de estar pago.") {
  const r = db.prepare("SELECT * FROM receipts WHERE entry_id = ?").get(entryId);
  if (!r || r.status === "canceled") return null;
  db.prepare(
    "UPDATE receipts SET status = 'canceled', canceled_at = datetime('now'), cancel_reason = ? WHERE id = ?"
  ).run(motivo, r.id);
  return db.prepare("SELECT * FROM receipts WHERE id = ?").get(r.id);
}

/**
 * Recibo pronto para exibir/imprimir: corpo com os marcadores trocados e o
 * layout já resolvido. É o mesmo objeto para a equipe e para o cliente.
 */
export function receiptView(r) {
  return {
    ...r,
    style: parseStyle(r.style),
    body_rendered: renderBody(r.body, r),
    amount_words: r.amount_words || valorPorExtenso(r.amount),
    emitter_document_fmt: formataDocumento(r.emitter_document),
    payer_document_fmt: formataDocumento(r.payer_document),
    signer_document_fmt: formataDocumento(r.signer_document),
    receipt_date_fmt: dataCurta(r.receipt_date),
    receipt_date_long: dataExtenso(r.receipt_date),
    amount_fmt: moeda(r.amount),
  };
}
