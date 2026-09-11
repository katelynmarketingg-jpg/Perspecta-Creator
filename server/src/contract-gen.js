import { db } from "./db.js";
import { valorPorExtenso, formataDocumento, dataExtenso, dataCurta } from "./receipts.js";

// ---------------------------------------------------------------------------
// Gerar o contrato a partir de um modelo.
//
// Vive fora da rota porque o briefing também gera: quando o cliente termina de
// responder, o contrato já nasce pronto para assinar, com os dados dele (do
// cadastro, que o briefing preencheu) e os termos comerciais que a agência
// definiu ao mandar o link.
// ---------------------------------------------------------------------------

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function hoje() {
  const d = new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

export function brl(v) {
  // Com separador de milhar: num contrato, "R$ 1500,00" fica amador ao lado de
  // "R$ 1.500,00" — e valores maiores ficam difíceis de ler.
  return `R$ ${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Troca {{marcador}} pelos valores. Marcador desconhecido fica como está. */
export function preencher(body, map) {
  return String(body || "").replace(/\{\{\s*([\wçãáéíóú]+)\s*\}\}/gi, (_, k) => {
    const key = k.toLowerCase();
    return map[key] !== undefined && map[key] !== null ? String(map[key]) : `{{${k}}}`;
  });
}

/** "Posts por mês" -> "posts_por_mes", para virar o marcador {{qtd_posts_por_mes}}. */
function slug(texto) {
  return String(texto || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** A quantidade da entrega cujo nome casa com o padrão ("Posts por mês" ~ /post/). */
function porNome(itens, padrao) {
  if (!Array.isArray(itens)) return undefined;
  const achado = itens.find((i) => padrao.test(slug(i.label)));
  return achado ? achado.quantidade : undefined;
}

/** "04 (quatro)" — como se escreve quantidade em contrato. */
function quantia(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  const extenso = valorPorExtenso(v).replace(/ reais.*/, "").replace(/^um$/, "um");
  return `${String(v).padStart(2, "0")} (${extenso})`;
}

/**
 * Quantos meses de serviço a vigência cobre — contando os dois extremos, que é
 * como se lê num contrato: de setembro a fevereiro são SEIS meses, não cinco.
 */
export function mesesDeVigencia(inicio, fim) {
  if (!inicio || !fim) return null;
  const a = new Date(`${inicio}T12:00:00`);
  const b = new Date(`${fim}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return null;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
}

/**
 * Monta o contrato e grava. `termos` é o que a AGÊNCIA define (valor, serviço,
 * quantidades, vigência e a data que deve constar); o resto vem do cadastro.
 */
/**
 * O texto-base do contrato. Vive em DOIS lugares, porque a casa escreve nos
 * dois: em Serviços (cada serviço tem o seu contrato) e em Modelos de contrato.
 * Aqui os dois valem — senão a pessoa escreve num lugar e o sistema procura no
 * outro, e o contrato nunca aparece.
 */
export function achaModelo(orgId, termos = {}) {
  if (termos.service_id) {
    const svc = db.prepare("SELECT id, name, contract_template FROM services WHERE id = ? AND org_id = ?")
      .get(termos.service_id, orgId);
    if (svc && String(svc.contract_template || "").trim()) {
      return { name: svc.name, body: svc.contract_template, origem: "servico", id: svc.id };
    }
    // O serviço existe mas está sem contrato escrito: dizer isso é mais útil do
    // que "modelo não encontrado".
    if (svc) { const e = new Error(`O serviço "${svc.name}" ainda não tem contrato escrito. Abra Serviços e escreva o modelo dele.`); e.code = "MODELO_VAZIO"; throw e; }
  }
  if (termos.template_id) {
    const tpl = db.prepare("SELECT id, name, body FROM contract_templates WHERE id = ? AND org_id = ?")
      .get(termos.template_id, orgId);
    if (tpl) return { ...tpl, origem: "modelo" };
  }
  const e = new Error("Modelo não encontrado."); e.code = "SEM_MODELO"; throw e;
}

/** Todos os modelos que a casa pode usar, dos dois lugares, numa lista só. */
export function modelosDisponiveis(orgId) {
  const servicos = db.prepare("SELECT id, name, contract_template, default_price, items_schema FROM services WHERE org_id = ? ORDER BY name").all(orgId);
  const modelos = db.prepare("SELECT id, name, body FROM contract_templates WHERE org_id = ? ORDER BY name").all(orgId);
  return [
    ...servicos.map((s) => ({
      origem: "servico", id: s.id, name: s.name,
      tem_contrato: Boolean(String(s.contract_template || "").trim()),
      valor_padrao: s.default_price || 0,
      itens: s.items_schema ? JSON.parse(s.items_schema) : [],
    })),
    ...modelos.map((m) => ({
      origem: "modelo", id: m.id, name: m.name,
      tem_contrato: Boolean(String(m.body || "").trim()), valor_padrao: 0, itens: [],
    })),
  ];
}

export function geraContrato(orgId, termos = {}) {
  const tpl = achaModelo(orgId, termos);

  const client = db.prepare("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(termos.client_id, orgId);
  if (!client) { const e = new Error("Cliente não encontrado."); e.code = "SEM_CLIENTE"; throw e; }

  const org = db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId) || {};
  const valor = Number(termos.value) || 0;
  const duracao = termos.duration_months
    ? Number(termos.duration_months)
    : mesesDeVigencia(termos.start_date, termos.end_date);
  const diaPgto = client.payment_day ? Number(client.payment_day) : null;

  const map = {
    cliente: client.name || "",
    empresa: client.company || "",
    email: client.email || "",
    telefone: client.phone || "",
    segmento: client.segment || "",
    endereco: client.address || "",
    valor: brl(valor),
    valor_extenso: valorPorExtenso(valor),
    duracao: duracao ? `${duracao} meses` : "prazo indeterminado",
    // A data que a agência quer que conste (senão, a de hoje).
    data: termos.contract_date ? dataExtenso(termos.contract_date) : hoje(),
    servico: termos.servico || tpl.name || "",
    // --- identificação da empresa contratante ---
    razao_social: client.legal_name || client.company || client.name || "",
    cnpj: client.document || "",
    documento: client.document || "",
    cnpj_formatado: formataDocumento(client.document || ""),
    // --- quem assina pela empresa ---
    representante: client.rep_name || "",
    documento_representante: client.rep_document || "",
    tipo_documento_representante: (client.rep_doc_type || "cpf").toUpperCase(),
    // --- cobrança ---
    dia_pagamento: diaPgto ? String(diaPgto) : "",
    vencimento: diaPgto ? `todo dia ${diaPgto} de cada mês` : "conforme combinado",
    // --- a agência (contratada) ---
    agencia: org.name || "",
    cnpj_agencia: formataDocumento(org.document || ""),
    endereco_agencia: org.address || "",
    representante_agencia: org.signer_name || "",
    documento_representante_agencia: org.signer_document || "",
    cargo_representante_agencia: org.signer_role || "",
    // --- lugar e prazos ---
    cidade: org.city || "",
    foro: org.city ? `foro da comarca de ${org.city}` : "foro da comarca da sede da CONTRATADA",
    inicio: termos.start_date ? dataExtenso(termos.start_date) : hoje(),
    inicio_curto: termos.start_date ? dataCurta(termos.start_date) : "",
    fim: termos.end_date ? dataExtenso(termos.end_date) : "prazo indeterminado",
    prazo: duracao ? quantia(duracao) + " meses" : "prazo indeterminado",
    // --- o que está contratado ---
    // Os três marcadores que o contrato da casa já usa saem das entregas que a
    // agência definiu ("Posts", "Vídeos", "Captações"), não importa como ela
    // tenha escrito o nome. Assim o mesmo modelo serve para pacotes diferentes.
    posts_mes: quantia(porNome(termos.itens, /post/) ?? termos.posts_per_month),
    videos_mes: quantia(porNome(termos.itens, /video|reel/) ?? termos.videos_per_month),
    captacoes_mes: quantia(porNome(termos.itens, /captac|gravac/) ?? termos.captures_per_month ?? 1),
  };

  // As quantidades que a casa definiu para ESTE serviço viram marcadores pelo
  // próprio nome: "Posts por mês" pode ser escrito no contrato como
  // {{qtd_posts_por_mes}}. Assim ela cria uma entrega nova sem mexer no código.
  for (const item of Array.isArray(termos.itens) ? termos.itens : []) {
    const chave = slug(item.label);
    if (!chave) continue;
    map[`qtd_${chave}`] = quantia(item.quantidade);
    map[`qtd_${chave}_numero`] = String(Number(item.quantidade) || 0);
  }

  const corpo = preencher(tpl.body, map);
  const titulo = termos.title || `${tpl.name} — ${client.name}`;

  const info = db.prepare(
    `INSERT INTO contracts (client_id, title, value, duration_months, start_date, first_due_date, status, notes, org_id)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(client.id, titulo, valor, duracao, termos.start_date ?? null, termos.first_due_date ?? null, corpo, orgId);

  return db.prepare(
    "SELECT ct.*, c.name AS client_name FROM contracts ct LEFT JOIN clients c ON c.id = ct.client_id WHERE ct.id = ?"
  ).get(info.lastInsertRowid);
}
