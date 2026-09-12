// AUDITORIA DO DINHEIRO (Etapa 7).
//
// As perguntas: a cobrança nasce na data escolhida? marcar como paga tira o
// aviso de "em aberto" da área do cliente? pagamento PARCIAL conta como pago?
// sai recibo de pagamento parcial? (não pode: recibo é de valor recebido em
// quitação — meia mensalidade não quita a mensalidade).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-parcial-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { quantasEmAberto } = await import("../src/overdue.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const { default: financialRoutes } = await import("../src/routes/financial.js");

const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES ('Casa do Dinheiro', 0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katy','katy','k@d.com',?,'admin',1,?)"
).run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cliente = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo','active',?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/financial", financialRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/financial`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

const put = (id, c) => fetch(`${B}/${id}`, { method: "PUT", headers: H, body: JSON.stringify(c) }).then(async (r) => ({ s: r.status, d: await r.json().catch(() => null) }));

// Uma mensalidade de 1500 vencida ontem.
function mensalidade() {
  const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return db.prepare(
    `INSERT INTO financial_entries (type, description, amount, client_id, category, status, due_date, org_id)
     VALUES ('income','Mensalidade',1500,?,'Mensalidade','pending',?,?)`
  ).run(cliente, ontem, org).lastInsertRowid;
}
const lerRecibo = (id) => db.prepare("SELECT * FROM receipts WHERE entry_id = ?").get(id);

test("pagamento PARCIAL não vira 'pago'", async () => {
  const id = mensalidade();
  const r = await put(id, { pay: 500 });
  assert.equal(r.s, 200);
  assert.equal(r.d.status, "partial", "meia mensalidade não é mensalidade paga");
  assert.equal(r.d.paid_amount, 500);
});

test("pagamento parcial NÃO gera recibo", async () => {
  const id = mensalidade();
  await put(id, { pay: 500 });
  assert.equal(lerRecibo(id), undefined, "recibo é de quitação; parcial não quita");
});

test("parcial continua contando como em aberto para o cliente", async () => {
  const id = mensalidade();
  const antes = quantasEmAberto(org, cliente);
  await put(id, { pay: 500 });
  assert.equal(quantasEmAberto(org, cliente), antes, "pagar metade não tira a cobrança de aberto");
});

test("completar o valor vira 'pago', gera recibo e sai de aberto", async () => {
  const id = mensalidade();
  const aberto = quantasEmAberto(org, cliente);
  await put(id, { pay: 500 });
  const r = await put(id, { pay: 1000 });
  assert.equal(r.d.status, "paid");
  assert.equal(r.d.paid_amount, 1500);
  assert.ok(lerRecibo(id), "quitou: o recibo nasce");
  assert.equal(quantasEmAberto(org, cliente), aberto - 1, "quitada, sai do 'em aberto'");
});

test("pagar mais que o devido não guarda valor a maior", async () => {
  const id = mensalidade();
  const r = await put(id, { pay: 9999 });
  assert.equal(r.d.paid_amount, 1500, "trava no valor da cobrança");
  assert.equal(r.d.status, "paid");
});

test("marcar como paga de uma vez zera o saldo e gera recibo", async () => {
  const id = mensalidade();
  const r = await put(id, { status: "paid" });
  assert.equal(r.d.paid_amount, 1500);
  assert.ok(lerRecibo(id));
});

test("voltar para pendente zera o pago, cancela o recibo e volta para aberto", async () => {
  const id = mensalidade();
  await put(id, { status: "paid" });
  const aberto = quantasEmAberto(org, cliente);
  const r = await put(id, { status: "pending" });
  assert.equal(r.d.status, "pending");
  assert.equal(r.d.paid_amount, 0);
  assert.equal(r.d.paid_at, null);
  assert.equal(lerRecibo(id).status, "canceled", "o recibo é cancelado, não apagado");
  assert.equal(quantasEmAberto(org, cliente), aberto + 1);
});

test("pagar em três vezes chega em pago, sem recibo no meio do caminho", async () => {
  const id = mensalidade();
  await put(id, { pay: 500 });
  assert.equal(lerRecibo(id), undefined);
  await put(id, { pay: 500 });
  assert.equal(lerRecibo(id), undefined);
  const r = await put(id, { pay: 500 });
  assert.equal(r.d.status, "paid");
  assert.ok(lerRecibo(id));
});
