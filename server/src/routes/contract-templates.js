import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";
import { valorPorExtenso, formataDocumento, dataExtenso, dataCurta } from "../receipts.js";
import { MODELO_REDES } from "../contract-model.js";

// Modelos de contrato: a equipe cadastra um texto-base com marcadores e, ao
// gerar, o sistema preenche com os dados do cliente e cria um contrato pronto
// para assinatura (usa o mesmo fluxo de assinatura já existente).
const router = Router();
router.use(authRequired, moduleAllowed("contratos"));

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function hoje() {
  const d = new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}
function brl(v) {
  // Com separador de milhar: num contrato, "R$ 1500,00" fica amador ao lado de
  // "R$ 1.500,00" — e valores maiores ficam difíceis de ler.
  return `R$ ${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Troca {{marcador}} pelos valores. Marcador desconhecido fica como está.
function preencher(body, map) {
  return String(body || "").replace(/\{\{\s*([\wçãáéíóú]+)\s*\}\}/gi, (_, k) => {
    const key = k.toLowerCase();
    return map[key] !== undefined && map[key] !== null ? String(map[key]) : `{{${k}}}`;
  });
}

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
router.post("/:id/generate", (req, res) => {
  const tpl = db.prepare("SELECT * FROM contract_templates WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!tpl) return res.status(404).json({ error: "Modelo não encontrado." });
  const b = req.body || {};
  if (!b.client_id) return res.status(400).json({ error: "Escolha o cliente." });
  const client = db.prepare("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(b.client_id, req.orgId);
  if (!client) return res.status(404).json({ error: "Cliente não encontrado." });

  const valor = Number(b.value) || 0;
  const duration = b.duration_months ? Number(b.duration_months) : null;
  // Os dados da AGÊNCIA (a contratada). Já existiam para o recibo — o contrato
  // passa a usar os mesmos, então basta preencher uma vez, em Configurações.
  const org = db.prepare("SELECT * FROM organizations WHERE id = ?").get(req.orgId) || {};
  // Os marcadores que o modelo pode usar. Os de identificação e cobrança vêm do
  // cadastro do cliente — que o briefing preenche sozinho quando o cliente
  // responde. Assim o contrato sai pronto, sem redigitar nada.
  const diaPgto = client.payment_day ? Number(client.payment_day) : null;
  const map = {
    cliente: client.name || "",
    empresa: client.company || "",
    email: client.email || "",
    telefone: client.phone || "",
    segmento: client.segment || "",
    endereco: client.address || "",
    valor: brl(valor),
    duracao: duration ? `${duration} meses` : "prazo indeterminado",
    data: hoje(),
    servico: b.servico || tpl.name || "",
    // --- identificação da empresa contratante ---
    razao_social: client.legal_name || client.company || client.name || "",
    cnpj: client.document || "",
    documento: client.document || "",
    // --- quem assina pela empresa ---
    representante: client.rep_name || "",
    documento_representante: client.rep_document || "",
    tipo_documento_representante: (client.rep_doc_type || "cpf").toUpperCase(),
    // --- cobrança ---
    dia_pagamento: diaPgto ? String(diaPgto) : "",
    vencimento: diaPgto ? `todo dia ${diaPgto} de cada mês` : "conforme combinado",
    valor_extenso: valorPorExtenso(valor),
    cnpj_formatado: formataDocumento(client.document || ""),
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
    inicio: b.start_date ? dataExtenso(b.start_date) : hoje(),
    inicio_curto: b.start_date ? dataCurta(b.start_date) : "",
    prazo: duration ? `${duration} (${valorPorExtenso(duration).replace(/ reais.*/, "")}) meses` : "prazo indeterminado",
  };
  const corpo = preencher(tpl.body, map);
  const titulo = b.title || `${tpl.name} — ${client.name}`;

  const info = db.prepare(
    `INSERT INTO contracts (client_id, title, value, duration_months, start_date, first_due_date, status, notes, org_id)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(client.id, titulo, valor, duration, b.start_date ?? null, b.first_due_date ?? null, corpo, req.orgId);

  const created = db.prepare(
    "SELECT ct.*, c.name AS client_name FROM contracts ct LEFT JOIN clients c ON c.id = ct.client_id WHERE ct.id = ?"
  ).get(info.lastInsertRowid);
  res.status(201).json(created);
});

export default router;
