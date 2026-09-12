// AUDITORIA — o RECIBO: documento de dinheiro, mesma classe do contrato.
// Numeração única, valor por extenso, cancelamento, e o que acontece quando
// dois cliques caem ao mesmo tempo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-rec-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { ensureReceiptForEntry, cancelReceiptForEntry, receiptView, valorPorExtenso } =
  await import("../src/receipts.js");

const org = db.prepare(
  `INSERT INTO organizations (name,is_master,document,address,city,signer_name,signer_document)
   VALUES ('Casa do Recibo',0,'52622307000128','Rua Iraci, 93','Santo Antônio da Patrulha','Katelyn','04009664096')`
).run().lastInsertRowid;
const cli = db.prepare(
  "INSERT INTO clients (name,legal_name,document,status,org_id) VALUES ('Marcelo','MARCELO ADVOCACIA LTDA','55514449000160','active',?)"
).run(org).lastInsertRowid;

let n = 0;
const cobranca = (valor, status = "paid", quando = "2026-10-10") => db.prepare(
  `INSERT INTO financial_entries (type,description,amount,client_id,category,status,due_date,paid_at,org_id)
   VALUES ('income', ?, ?, ?, 'Mensalidade', ?, ?, ?, ?)`
).run(`Mensalidade ${++n}`, valor, cli, status, quando, status === "paid" ? `${quando}T12:00:00` : null, org).lastInsertRowid;

test("cobrança PAGA gera recibo; pendente não gera", () => {
  const paga = cobranca(1500, "paid");
  const r = ensureReceiptForEntry(paga);
  assert.ok(r, "a paga gera");
  assert.equal(r.status, "issued");

  const pendente = cobranca(900, "pending");
  assert.equal(ensureReceiptForEntry(pendente), null, "a pendente NÃO gera");
});

test("o número do recibo é único e não se repete", () => {
  const numeros = [];
  for (let i = 0; i < 8; i++) numeros.push(ensureReceiptForEntry(cobranca(100 + i)).number);
  assert.equal(new Set(numeros).size, numeros.length, `número repetido: ${numeros.join(", ")}`);
});

test("chamar duas vezes para a MESMA cobrança devolve o mesmo recibo", () => {
  const e = cobranca(1200);
  const a = ensureReceiptForEntry(e);
  const b = ensureReceiptForEntry(e);
  assert.equal(a.id, b.id, "não pode criar dois recibos para a mesma cobrança");
  assert.equal(a.number, b.number);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM receipts WHERE entry_id = ?").get(e).n, 1);
});

test("voltar para pendente CANCELA o recibo — mas o número não some", () => {
  const e = cobranca(800);
  const r = ensureReceiptForEntry(e);
  cancelReceiptForEntry(e);
  const depois = db.prepare("SELECT * FROM receipts WHERE id = ?").get(r.id);
  assert.equal(depois.status, "canceled", "cancelado, não apagado — é documento fiscal");
  assert.equal(depois.number, r.number, "o número fica registrado");
  // E se voltar a ser pago, reativa o MESMO número.
  const denovo = ensureReceiptForEntry(e);
  assert.equal(denovo.number, r.number);
  assert.equal(denovo.status, "issued");
});

test("o recibo guarda os dados de QUEM pagou e de QUEM recebeu", () => {
  const r = ensureReceiptForEntry(cobranca(1500));
  const v = receiptView(r);
  assert.match(v.payer_name || "", /MARCELO ADVOCACIA|Marcelo/);
  assert.equal(v.payer_document_fmt, "55.514.449/0001-60", "CNPJ de quem pagou, formatado");
  assert.equal(v.emitter_document_fmt, "52.622.307/0001-28", "CNPJ de quem recebeu, formatado");
  assert.equal(v.signer_document_fmt, "040.096.640-96", "CPF de quem assina, formatado");
});

test("o valor sai em número E por extenso, batendo um com o outro", () => {
  for (const valor of [1500, 1, 0.5, 1234.56, 999999]) {
    const v = receiptView(ensureReceiptForEntry(cobranca(valor)));
    assert.equal(v.amount_fmt.replace(/ /g, " "),
      valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " "));
    assert.equal(v.amount_words, valorPorExtenso(valor), "o extenso tem que bater com o número");
    assert.ok(!/undefined|NaN/.test(v.amount_words), `extenso quebrado: ${v.amount_words}`);
  }
});

test("o corpo do recibo não deixa marcador sobrando", () => {
  const v = receiptView(ensureReceiptForEntry(cobranca(1500)));
  const sobrando = [...new Set((v.body_rendered || "").match(/\{\{\s*\w+\s*\}\}/g) || [])];
  assert.deepEqual(sobrando, [], `sobrou: ${sobrando.join(", ")}`);
  assert.ok(!/undefined|null|NaN/.test(v.body_rendered), `texto quebrado: ${v.body_rendered}`);
});

test("cliente sem CNPJ não quebra o recibo", () => {
  const semDoc = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Sem documento','active',?)").run(org).lastInsertRowid;
  const e = db.prepare(
    `INSERT INTO financial_entries (type,description,amount,client_id,category,status,due_date,paid_at,org_id)
     VALUES ('income','Avulso',300,?,'Serviço','paid','2026-10-10','2026-10-10T12:00:00',?)`
  ).run(semDoc, org).lastInsertRowid;
  const v = receiptView(ensureReceiptForEntry(e));
  assert.equal(v.payer_document_fmt, "", "documento vazio sai vazio, não 'undefined'");
  assert.ok(!/undefined|null/.test(v.body_rendered));
});

test("despesa (saída) não gera recibo de recebimento", () => {
  const saida = db.prepare(
    `INSERT INTO financial_entries (type,description,amount,category,status,due_date,paid_at,org_id)
     VALUES ('expense','Aluguel',2000,'Custo','paid','2026-10-10','2026-10-10T12:00:00',?)`
  ).run(org).lastInsertRowid;
  assert.equal(ensureReceiptForEntry(saida), null);
});

test("o recibo pertence ao escritório certo", () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha do recibo',0)").run().lastInsertRowid;
  const r = ensureReceiptForEntry(cobranca(500));
  assert.equal(r.org_id, org);
  assert.notEqual(r.org_id, outra);
});
