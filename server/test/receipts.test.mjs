import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Banco temporário e segredo de teste ANTES de importar o app.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "pc-recibo-")), "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const {
  ensureReceiptForEntry, cancelReceiptForEntry, valorPorExtenso,
  entryPago, receiptHash, renderBody, receiptView,
} = await import("../src/receipts.js");

// --- Cenário: dois escritórios, cada um com seu cliente e sua cobrança -------
function criaOrg(nome) {
  const info = db.prepare("INSERT INTO organizations (name, is_master) VALUES (?, 0)").run(nome);
  db.prepare("UPDATE organizations SET document = ?, city = ?, signature_img = ?, signer_name = ? WHERE id = ?")
    .run("12345678000199", "Ponta Grossa", "data:image/png;base64,AAA", "Katelyn", info.lastInsertRowid);
  return info.lastInsertRowid;
}
function criaCliente(orgId, nome, doc) {
  const info = db.prepare("INSERT INTO clients (name, status, org_id, document) VALUES (?, 'active', ?, ?)")
    .run(nome, orgId, doc);
  return info.lastInsertRowid;
}
function lancamento(orgId, clientId, { valor = 500, status = "pending" } = {}) {
  const info = db.prepare(
    `INSERT INTO financial_entries (type, description, amount, client_id, status, due_date, paid_at, org_id)
     VALUES ('income', 'Mensalidade', ?, ?, ?, '2026-09-05', ?, ?)`
  ).run(valor, clientId, status, status === "paid" ? "2026-09-05T12:00:00.000Z" : null, orgId);
  return info.lastInsertRowid;
}
const pagar = (id) =>
  db.prepare("UPDATE financial_entries SET status='paid', paid_at='2026-09-05T12:00:00.000Z' WHERE id=?").run(id);

const orgA = criaOrg("Agência A");
const orgB = criaOrg("Agência B");
const clienteA = criaCliente(orgA, "Cliente A", "11122233344");
const clienteB = criaCliente(orgB, "Cliente B", "55566677788");

test("valor por extenso em português", () => {
  assert.equal(valorPorExtenso(1), "um real");
  assert.equal(valorPorExtenso(0.5), "cinquenta centavos");
  assert.equal(valorPorExtenso(100), "cem reais");
  assert.equal(valorPorExtenso(1250.9), "mil, duzentos e cinquenta reais e noventa centavos");
  assert.equal(valorPorExtenso(0), "zero real");
});

test("lançamento não pago não gera recibo", () => {
  const id = lancamento(orgA, clienteA);
  assert.equal(entryPago(db.prepare("SELECT * FROM financial_entries WHERE id=?").get(id)), false);
  assert.equal(ensureReceiptForEntry(id), null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM receipts WHERE entry_id=?").get(id).n, 0);
});

test("marcar como pago gera o recibo numerado, com os dados e a assinatura salva", () => {
  const id = lancamento(orgA, clienteA, { valor: 1250.9 });
  pagar(id);
  const r = ensureReceiptForEntry(id);
  assert.ok(r, "deve criar o recibo");
  assert.equal(r.status, "issued");
  assert.match(r.number, /^\d{4}\/2026$/);
  assert.equal(r.payer_name, "Cliente A");
  assert.equal(r.payer_document, "11122233344");
  assert.equal(r.emitter_document, "12345678000199");
  assert.equal(r.signer_name, "Katelyn", "a assinatura salva entra sozinha");
  assert.ok(r.signature_img, "a imagem da assinatura vem junto");
  assert.equal(r.amount_words, valorPorExtenso(1250.9));
  assert.ok(r.content_hash, "deve ter hash de verificação");
});

test("gerar duas vezes não duplica o recibo do mesmo lançamento", () => {
  const id = lancamento(orgA, clienteA, { status: "paid" });
  const a = ensureReceiptForEntry(id);
  const b = ensureReceiptForEntry(id);
  assert.equal(a.id, b.id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM receipts WHERE entry_id=?").get(id).n, 1);
});

test("a numeração é sequencial por escritório e por ano, sem repetir", () => {
  const numeros = [];
  for (let i = 0; i < 3; i++) {
    const id = lancamento(orgA, clienteA, { status: "paid" });
    numeros.push(ensureReceiptForEntry(id).seq);
  }
  const ordenados = [...numeros].sort((x, y) => x - y);
  assert.deepEqual(numeros, ordenados, "os números saem em ordem");
  assert.equal(new Set(numeros).size, numeros.length, "nenhum número repetido");

  // Outro escritório recomeça a própria contagem.
  const idB = lancamento(orgB, clienteB, { status: "paid" });
  assert.equal(ensureReceiptForEntry(idB).seq, 1);
});

test("voltar para pendente cancela o recibo (e não apaga o histórico)", () => {
  const id = lancamento(orgA, clienteA, { status: "paid" });
  const r = ensureReceiptForEntry(id);
  db.prepare("UPDATE financial_entries SET status='pending', paid_at=NULL WHERE id=?").run(id);
  const cancelado = cancelReceiptForEntry(id);
  assert.equal(cancelado.status, "canceled");
  assert.equal(cancelado.number, r.number, "o número continua registrado");
  // E o recibo volta a valer se ela marcar como pago de novo.
  pagar(id);
  assert.equal(ensureReceiptForEntry(id).status, "issued");
});

test("um escritório nunca alcança o recibo do outro", () => {
  const idB = lancamento(orgB, clienteB, { status: "paid" });
  const rB = ensureReceiptForEntry(idB);
  // É esta consulta (org_id no WHERE) que as rotas usam.
  const vistoPorA = db.prepare("SELECT * FROM receipts WHERE id = ? AND org_id = ?").get(rB.id, orgA);
  assert.equal(vistoPorA, undefined);
  assert.ok(db.prepare("SELECT * FROM receipts WHERE id = ? AND org_id = ?").get(rB.id, orgB));
});

test("o cliente só enxerga recibo emitido de cobrança paga, e só o dele", () => {
  const idPago = lancamento(orgA, clienteA, { status: "paid" });
  ensureReceiptForEntry(idPago);
  const idAberto = lancamento(orgA, clienteA);
  ensureReceiptForEntry(idAberto); // não deve criar nada

  // Mesma consulta do portal.
  const doPortal = db.prepare(`
    SELECT r.* FROM receipts r
    JOIN financial_entries f ON f.id = r.entry_id
    WHERE r.client_id = @client_id AND r.org_id = @org_id
      AND r.status = 'issued' AND f.status = 'paid'`).all({ client_id: clienteA, org_id: orgA });

  assert.ok(doPortal.some((r) => r.entry_id === idPago), "o pago aparece");
  assert.ok(!doPortal.some((r) => r.entry_id === idAberto), "o em aberto não aparece");
  assert.ok(!doPortal.some((r) => r.client_id !== clienteA), "nada de outro cliente");

  // E o cliente B não alcança o recibo do cliente A.
  const tentativa = db.prepare(`
    SELECT r.* FROM receipts r JOIN financial_entries f ON f.id = r.entry_id
    WHERE r.id = @id AND r.client_id = @client_id AND f.status = 'paid'`)
    .get({ id: doPortal[0].id, client_id: clienteB });
  assert.equal(tentativa, undefined);
});

test("editar o recibo muda o hash de verificação", () => {
  const id = lancamento(orgA, clienteA, { status: "paid" });
  const r = ensureReceiptForEntry(id);
  const antes = r.content_hash;
  const depois = receiptHash({ ...r, description: "Outro serviço" });
  assert.notEqual(antes, depois, "conteúdo diferente = hash diferente");
});

test("os marcadores do modelo viram os dados do pagamento", () => {
  const id = lancamento(orgA, clienteA, { valor: 300, status: "paid" });
  const r = ensureReceiptForEntry(id);
  const texto = renderBody("{{cliente}} pagou {{valor}} ({{valor_extenso}}) — nº {{numero}}", r);
  assert.match(texto, /Cliente A pagou R\$\s?300,00 \(trezentos reais\) — nº \d{4}\/2026/);
  // A visão pronta para a tela já traz o corpo com os marcadores trocados.
  const v = receiptView(r);
  assert.ok(v.body_rendered.includes("Cliente A"));
  assert.equal(typeof v.style, "object");
});
