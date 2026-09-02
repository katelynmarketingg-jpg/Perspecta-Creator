import { Router } from "express";
import { db } from "../db.js";
import { authRequired, adminRequired, moduleAllowed } from "../auth.js";
import {
  ensureReceiptForEntry, receiptView, receiptHash, valorPorExtenso, entryPago,
  defaultTemplate, DEFAULT_BODY, DEFAULT_STYLE, parseStyle, mesExtenso,
} from "../receipts.js";

const router = Router();
router.use(authRequired, moduleAllowed("financeiro"));

// Imagens vêm como data URI (logo/assinatura). Mesmo limite defensivo do branding.
const LIMITE_IMG = 700 * 1024;
function imagemGrande(v) {
  return typeof v === "string" && v.length > LIMITE_IMG;
}

// O recibo só existe de verdade se o lançamento estiver PAGO. A regra mora
// aqui (servidor), não só no botão da tela.
function carregaRecibo(req, res) {
  const r = db.prepare("SELECT * FROM receipts WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!r) { res.status(404).json({ error: "Recibo não encontrado." }); return null; }
  const entry = db.prepare("SELECT * FROM financial_entries WHERE id = ? AND org_id = ?").get(r.entry_id, req.orgId);
  if (!entryPago(entry)) {
    res.status(403).json({ error: "O recibo só fica disponível quando o lançamento está marcado como pago." });
    return null;
  }
  return r;
}

// ---------------------------------------------------------------------------
// Dados do emitente + assinatura salva
// ---------------------------------------------------------------------------
router.get("/settings", (req, res) => {
  const o = db.prepare(
    `SELECT name, document, address, city, logo,
            signature_img, signer_name, signer_document, signer_role
     FROM organizations WHERE id = ?`
  ).get(req.orgId) || {};
  res.json({
    emitter_name: o.name || "",
    document: o.document || "",
    address: o.address || "",
    city: o.city || "",
    logo: o.logo || null,
    signature_img: o.signature_img || null,
    signer_name: o.signer_name || "",
    signer_document: o.signer_document || "",
    signer_role: o.signer_role || "",
  });
});

router.put("/settings", adminRequired, (req, res) => {
  const b = req.body || {};
  if (imagemGrande(b.signature_img)) {
    return res.status(400).json({ error: "Imagem da assinatura muito grande. Use um arquivo menor." });
  }
  const atual = db.prepare("SELECT signature_img FROM organizations WHERE id = ?").get(req.orgId) || {};
  db.prepare(
    `UPDATE organizations SET document = @document, address = @address, city = @city,
       signature_img = @signature_img, signer_name = @signer_name,
       signer_document = @signer_document, signer_role = @signer_role
     WHERE id = @id`
  ).run({
    id: req.orgId,
    document: String(b.document || "").trim() || null,
    address: String(b.address || "").trim() || null,
    city: String(b.city || "").trim() || null,
    // Campo ausente = mantém o que já estava; null explícito = apaga.
    signature_img: b.signature_img === undefined ? (atual.signature_img || null) : (b.signature_img || null),
    signer_name: String(b.signer_name || "").trim() || null,
    signer_document: String(b.signer_document || "").trim() || null,
    signer_role: String(b.signer_role || "").trim() || null,
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Modelos de recibo
// ---------------------------------------------------------------------------
router.get("/templates", (req, res) => {
  const rows = db.prepare("SELECT * FROM receipt_templates WHERE org_id = ? ORDER BY is_default DESC, name")
    .all(req.orgId);
  res.json(rows.map((t) => ({ ...t, style: parseStyle(t.style) })));
});

// Modelo "de fábrica" para começar (quando o escritório ainda não criou nenhum).
router.get("/templates/default", (req, res) => {
  const t = defaultTemplate(req.orgId);
  res.json({ ...t, style: parseStyle(t.style), body: t.body || DEFAULT_BODY });
});

function corpoModelo(b) {
  return {
    name: String(b.name || "").trim() || "Modelo de recibo",
    body: String(b.body ?? DEFAULT_BODY),
    style: JSON.stringify({ ...DEFAULT_STYLE, ...(b.style || {}) }),
    logo: b.logo || null,
  };
}

router.post("/templates", adminRequired, (req, res) => {
  const b = req.body || {};
  if (imagemGrande(b.logo)) return res.status(400).json({ error: "Logo muito grande. Use um arquivo menor." });
  const dados = corpoModelo(b);
  const tx = db.transaction(() => {
    const padrao = b.is_default ? 1 : 0;
    if (padrao) db.prepare("UPDATE receipt_templates SET is_default = 0 WHERE org_id = ?").run(req.orgId);
    const info = db.prepare(
      `INSERT INTO receipt_templates (org_id, name, body, style, logo, is_default)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(req.orgId, dados.name, dados.body, dados.style, dados.logo, padrao);
    return info.lastInsertRowid;
  });
  const id = tx();
  const t = db.prepare("SELECT * FROM receipt_templates WHERE id = ?").get(id);
  res.status(201).json({ ...t, style: parseStyle(t.style) });
});

router.put("/templates/:id", adminRequired, (req, res) => {
  const cur = db.prepare("SELECT * FROM receipt_templates WHERE id = ? AND org_id = ?")
    .get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: "Modelo não encontrado." });
  const b = req.body || {};
  if (imagemGrande(b.logo)) return res.status(400).json({ error: "Logo muito grande. Use um arquivo menor." });
  const dados = corpoModelo({
    name: b.name ?? cur.name,
    body: b.body ?? cur.body,
    style: { ...parseStyle(cur.style), ...(b.style || {}) },
    logo: b.logo === undefined ? cur.logo : b.logo,
  });
  const tx = db.transaction(() => {
    const padrao = b.is_default === undefined ? cur.is_default : (b.is_default ? 1 : 0);
    if (padrao) db.prepare("UPDATE receipt_templates SET is_default = 0 WHERE org_id = ?").run(req.orgId);
    db.prepare(
      `UPDATE receipt_templates SET name = ?, body = ?, style = ?, logo = ?, is_default = ?
       WHERE id = ? AND org_id = ?`
    ).run(dados.name, dados.body, dados.style, dados.logo, padrao, cur.id, req.orgId);
  });
  tx();
  const t = db.prepare("SELECT * FROM receipt_templates WHERE id = ?").get(cur.id);
  res.json({ ...t, style: parseStyle(t.style) });
});

router.delete("/templates/:id", adminRequired, (req, res) => {
  db.prepare("DELETE FROM receipt_templates WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

// Prévia do modelo com dados de exemplo — não grava nada.
router.post("/templates/preview", (req, res) => {
  const b = req.body || {};
  const o = db.prepare("SELECT name, document, address, city, logo, signature_img, signer_name, signer_document, signer_role FROM organizations WHERE id = ?")
    .get(req.orgId) || {};
  const exemplo = {
    id: 0, status: "issued", number: "0001/" + new Date().getFullYear(),
    amount: 1250.9, amount_words: valorPorExtenso(1250.9),
    description: "Serviços de social media",
    reference: new Date().toISOString().slice(0, 7).split("-").reverse().join("/"),
    payment_method: "PIX", place: o.city || "Sua cidade",
    receipt_date: new Date().toISOString().slice(0, 10),
    notes: "",
    emitter_name: o.name || "", emitter_document: o.document || "", emitter_address: o.address || "",
    payer_name: "Empresa Exemplo LTDA", payer_document: "12345678000199",
    payer_address: "Rua Exemplo, 100",
    logo: b.logo === undefined ? (o.logo || null) : b.logo,
    signature_img: o.signature_img || null, signer_name: o.signer_name || "",
    signer_document: o.signer_document || "", signer_role: o.signer_role || "",
    body: b.body ?? DEFAULT_BODY,
    style: JSON.stringify({ ...DEFAULT_STYLE, ...(b.style || {}) }),
    content_hash: "previa-sem-validade", version: 1, issued_at: new Date().toISOString(),
  };
  res.json({ ...receiptView(exemplo), preview: true });
});

// ---------------------------------------------------------------------------
// Recibos
// ---------------------------------------------------------------------------
router.get("/", (req, res) => {
  const where = ["r.org_id = @org_id"];
  const params = { org_id: req.orgId };
  if (req.query.client_id) { where.push("r.client_id = @client_id"); params.client_id = req.query.client_id; }
  if (req.query.status) { where.push("r.status = @status"); params.status = req.query.status; }
  const rows = db.prepare(
    `SELECT r.*, c.name AS client_name, f.status AS entry_status
     FROM receipts r
     LEFT JOIN clients c ON c.id = r.client_id
     LEFT JOIN financial_entries f ON f.id = r.entry_id
     WHERE ${where.join(" AND ")} ORDER BY r.year DESC, r.seq DESC`
  ).all(params);
  res.json(rows);
});

// O recibo de um lançamento (ou null, se ainda não existe).
router.get("/entry/:entryId", (req, res) => {
  const entry = db.prepare("SELECT * FROM financial_entries WHERE id = ? AND org_id = ?")
    .get(req.params.entryId, req.orgId);
  if (!entry) return res.status(404).json({ error: "Lançamento não encontrado." });
  const r = db.prepare("SELECT * FROM receipts WHERE entry_id = ?").get(entry.id);
  res.json(r ? receiptView(r) : null);
});

// Gera o recibo do lançamento (ou devolve o que já existe). Só se estiver pago.
router.post("/entry/:entryId", (req, res) => {
  const entry = db.prepare("SELECT * FROM financial_entries WHERE id = ? AND org_id = ?")
    .get(req.params.entryId, req.orgId);
  if (!entry) return res.status(404).json({ error: "Lançamento não encontrado." });
  if (entry.type !== "income") return res.status(400).json({ error: "Recibo só vale para receitas." });
  if (!entryPago(entry)) {
    return res.status(403).json({ error: "Marque o lançamento como pago para gerar o recibo." });
  }
  const r = ensureReceiptForEntry(entry.id, { userId: req.user?.id || null, ip: req.ip });
  res.status(201).json(receiptView(r));
});

router.get("/:id", (req, res) => {
  const r = carregaRecibo(req, res);
  if (!r) return;
  res.json(receiptView(r));
});

// Editar o recibo: gera uma versão nova, com hash novo — o documento antigo
// deixa de conferir, e isso fica registrado.
router.put("/:id", (req, res) => {
  const cur = carregaRecibo(req, res);
  if (!cur) return;
  const b = req.body || {};
  const editaveis = [
    "description", "reference", "payment_method", "place", "receipt_date", "notes",
    "emitter_name", "emitter_document", "emitter_address",
    "payer_name", "payer_document", "payer_address",
    "signer_name", "signer_document", "signer_role", "body",
  ];
  const merged = { ...cur };
  for (const campo of editaveis) if (b[campo] !== undefined) merged[campo] = b[campo];
  if (b.style !== undefined) merged.style = JSON.stringify({ ...parseStyle(cur.style), ...(b.style || {}) });
  if (b.logo !== undefined) {
    if (imagemGrande(b.logo)) return res.status(400).json({ error: "Logo muito grande. Use um arquivo menor." });
    merged.logo = b.logo || null;
  }
  if (b.signature_img !== undefined) {
    if (imagemGrande(b.signature_img)) return res.status(400).json({ error: "Assinatura muito grande. Use um arquivo menor." });
    merged.signature_img = b.signature_img || null;
  }
  // O valor acompanha o lançamento; se mudar por lá, o extenso é recalculado.
  const entry = db.prepare("SELECT amount FROM financial_entries WHERE id = ?").get(cur.entry_id);
  merged.amount = entry?.amount ?? cur.amount;
  merged.amount_words = b.amount_words !== undefined ? b.amount_words : valorPorExtenso(merged.amount);
  merged.version = (cur.version || 1) + 1;
  merged.content_hash = receiptHash(merged);

  db.prepare(`
    UPDATE receipts SET amount = @amount, amount_words = @amount_words, description = @description,
      reference = @reference, payment_method = @payment_method, place = @place,
      receipt_date = @receipt_date, notes = @notes,
      emitter_name = @emitter_name, emitter_document = @emitter_document, emitter_address = @emitter_address,
      payer_name = @payer_name, payer_document = @payer_document, payer_address = @payer_address,
      logo = @logo, signature_img = @signature_img, signer_name = @signer_name,
      signer_document = @signer_document, signer_role = @signer_role,
      body = @body, style = @style, content_hash = @content_hash, version = @version
    WHERE id = @id AND org_id = @org_id
  `).run({ ...merged, id: cur.id, org_id: req.orgId });

  res.json(receiptView(db.prepare("SELECT * FROM receipts WHERE id = ?").get(cur.id)));
});

// POST /api/receipts/:id/refresh — refaz o recibo com o modelo atual e com os
// dados de hoje do cliente e do escritório, mantendo o mesmo número. É o que
// atualiza os recibos antigos depois de mexer no modelo em Serviços.
router.post("/:id/refresh", (req, res) => {
  const cur = carregaRecibo(req, res);
  if (!cur) return;
  const entry = db.prepare("SELECT * FROM financial_entries WHERE id = ? AND org_id = ?")
    .get(cur.entry_id, req.orgId);
  const org = db.prepare("SELECT * FROM organizations WHERE id = ?").get(req.orgId) || {};
  const cliente = entry?.client_id
    ? db.prepare("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(entry.client_id, req.orgId)
    : null;
  const modelo = defaultTemplate(req.orgId);

  const novo = {
    ...cur,
    amount: entry?.amount ?? cur.amount,
    amount_words: valorPorExtenso(entry?.amount ?? cur.amount),
    description: entry?.description || cur.description,
    reference: mesExtenso(entry?.due_date || cur.receipt_date),
    place: org.city || cur.place,
    emitter_name: org.name || cur.emitter_name,
    emitter_document: org.document || "",
    emitter_address: org.address || "",
    payer_name: cliente?.company || cliente?.name || cur.payer_name,
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
    version: (cur.version || 1) + 1,
  };
  novo.content_hash = receiptHash(novo);

  db.prepare(`
    UPDATE receipts SET amount=@amount, amount_words=@amount_words, description=@description,
      reference=@reference, place=@place,
      emitter_name=@emitter_name, emitter_document=@emitter_document, emitter_address=@emitter_address,
      payer_name=@payer_name, payer_document=@payer_document, payer_address=@payer_address,
      logo=@logo, signature_img=@signature_img, signer_name=@signer_name,
      signer_document=@signer_document, signer_role=@signer_role,
      template_id=@template_id, body=@body, style=@style, content_hash=@content_hash, version=@version
    WHERE id=@id AND org_id=@org_id
  `).run({ ...novo, id: cur.id, org_id: req.orgId });

  res.json(receiptView(db.prepare("SELECT * FROM receipts WHERE id = ?").get(cur.id)));
});

router.post("/:id/cancel", (req, res) => {
  const r = db.prepare("SELECT * FROM receipts WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!r) return res.status(404).json({ error: "Recibo não encontrado." });
  db.prepare(
    "UPDATE receipts SET status = 'canceled', canceled_at = datetime('now'), cancel_reason = ? WHERE id = ? AND org_id = ?"
  ).run(String(req.body?.reason || "Cancelado pelo escritório."), r.id, req.orgId);
  res.json(receiptView(db.prepare("SELECT * FROM receipts WHERE id = ?").get(r.id)));
});

export default router;
