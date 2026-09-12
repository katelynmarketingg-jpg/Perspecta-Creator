// AUDITORIA — Etapa 7: o dinheiro. A cobrança nasce na data que o cliente
// escolheu? O recibo sai com os dados certos? Um mês sem dia 30 quebra?
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-cob-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { valorPorExtenso, formataDocumento, dataExtenso, moeda } = await import("../src/receipts.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const financial = (await import("../src/routes/financial.js")).default;

const org = db.prepare(
  "INSERT INTO organizations (name,is_master,document) VALUES ('Casa do Dinheiro',0,'52622307000128')"
).run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@din.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/financial", financial);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/financial`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

const req = (m, u, corpo) => fetch(B + u, {
  method: m, headers: H, body: corpo ? JSON.stringify(corpo) : undefined,
}).then(async (r) => ({ st: r.status, ...(await r.json().catch(() => ({}))) }));

let n = 0;
const novoCliente = (dia) => db.prepare(
  "INSERT INTO clients (name,status,org_id,payment_day) VALUES (?, 'active', ?, ?)"
).run(`Cliente ${++n}`, org, dia).lastInsertRowid;

test("número por extenso: o que aparece no recibo e no contrato", () => {
  assert.equal(valorPorExtenso(1500), "mil e quinhentos reais");
  assert.equal(valorPorExtenso(1), "um real");
  assert.equal(valorPorExtenso(0), "zero real");
  assert.equal(valorPorExtenso(1000), "mil reais");
  assert.equal(valorPorExtenso(1500.5), "mil e quinhentos reais e cinquenta centavos");
  assert.equal(valorPorExtenso(0.01), "um centavo");
  // "de" obrigatório depois de milhão/bilhão.
  assert.equal(valorPorExtenso(2000000), "dois milhões de reais");
  assert.equal(valorPorExtenso(1000000), "um milhão de reais");
  assert.equal(valorPorExtenso(2500000), "dois milhões, quinhentos mil reais", "com resto, não leva 'de'");
});

test("centavos não somem nem viram outro valor", () => {
  assert.match(valorPorExtenso(1234.56), /mil.*duzentos.*trinta e quatro reais.*cinquenta e seis centavos/);
  // O separador entre "R$" e o número é um espaço NÃO-SEPARÁVEL (é o padrão
  // pt-BR do navegador) — comparar com espaço comum falha sem motivo.
  const semNbsp = (v) => moeda(v).replace(/\u00a0/g, " ");
  assert.equal(semNbsp(1234.56), "R$ 1.234,56");
  // arredondamento: 0,005 não pode virar 0,01 num lugar e 0,00 no outro
  assert.equal(semNbsp(0.005), "R$ 0,01");
});

test("CPF e CNPJ saem formatados; documento torto sai como veio", () => {
  assert.equal(formataDocumento("04009664096"), "040.096.640-96");
  assert.equal(formataDocumento("52622307000128"), "52.622.307/0001-28");
  assert.equal(formataDocumento("123"), "123");
  assert.equal(formataDocumento(""), "");
  assert.equal(formataDocumento(null), "");
});

test("data por extenso, inclusive em mês com acento e no 1º", () => {
  assert.equal(dataExtenso("2026-03-01"), "1º de março de 2026");
  assert.equal(dataExtenso("2026-12-31"), "31 de dezembro de 2026");
  assert.equal(dataExtenso("lixo"), "");
  assert.equal(dataExtenso(""), "");
});

test("a mensalidade nasce no dia que o cliente escolheu", async () => {
  const cli = novoCliente(10);
  const r = await req("POST", "/", {
    type: "income", description: "Mensalidade de outubro", amount: 1500,
    client_id: cli, category: "Mensalidade", status: "pending", due_date: "2026-10-10",
  });
  assert.equal(r.st, 201);
  assert.equal(r.due_date.slice(0, 10), "2026-10-10");
  assert.equal(r.status, "pending");
});

test("recorrência mensal: cada parcela cai no mesmo dia, mês a mês", async () => {
  const cli = novoCliente(10);
  const r = await req("POST", "/", {
    type: "income", description: "Mensalidade", amount: 1500, client_id: cli,
    category: "Mensalidade", status: "pending", due_date: "2026-10-10",
    recurring: true, months: 6, recurring_day: 10,
  });
  assert.equal(r.st, 201);
  assert.equal(r.count, 6, "seis parcelas");
  const datas = db.prepare(
    "SELECT due_date FROM financial_entries WHERE client_id = ? ORDER BY due_date"
  ).all(cli).map((x) => x.due_date.slice(0, 10));
  assert.deepEqual(datas, ["2026-10-10", "2026-11-10", "2026-12-10", "2027-01-10", "2027-02-10", "2027-03-10"]);
});

test("dia 31 na recorrência não pula fevereiro nem gera data inválida", async () => {
  const cli = novoCliente(31);
  await req("POST", "/", {
    type: "income", description: "Mensalidade dia 31", amount: 1000, client_id: cli,
    category: "Mensalidade", status: "pending", due_date: "2026-12-31",
    recurring: true, months: 4, recurring_day: 31,
  });
  const datas = db.prepare("SELECT due_date FROM financial_entries WHERE client_id = ? ORDER BY due_date")
    .all(cli).map((x) => x.due_date.slice(0, 10));
  assert.equal(datas.length, 4, "nenhuma parcela pode sumir");
  for (const d of datas) {
    const [a, m, dia] = d.split("-").map(Number);
    const ultimoDoMes = new Date(a, m, 0).getDate();
    assert.ok(dia <= ultimoDoMes, `data impossível: ${d}`);
    assert.ok(!Number.isNaN(new Date(`${d}T12:00:00`).getTime()), `data inválida: ${d}`);
  }
  assert.ok(datas.some((d) => d.startsWith("2027-02")), `fevereiro tem que estar na lista: ${datas.join(", ")}`);
});

test("só a 1ª parcela pode nascer paga — as futuras nascem pendentes", async () => {
  const cli = novoCliente(5);
  await req("POST", "/", {
    type: "income", description: "Pago à vista", amount: 900, client_id: cli,
    category: "Mensalidade", status: "paid", due_date: "2026-10-05",
    recurring: true, months: 3, recurring_day: 5,
  });
  const st = db.prepare("SELECT status FROM financial_entries WHERE client_id = ? ORDER BY due_date").all(cli).map((x) => x.status);
  assert.deepEqual(st, ["paid", "pending", "pending"]);
});

test("pagamento parcial fica como 'partial' e guarda quanto entrou", async () => {
  const cli = novoCliente(10);
  const e = await req("POST", "/", {
    type: "income", description: "Rachada", amount: 1000, client_id: cli,
    category: "Mensalidade", status: "pending", due_date: "2026-10-10",
  });
  const r = await req("PUT", `/${e.id}`, { pay: 400 });
  assert.equal(r.status, "partial");
  assert.equal(r.paid_amount, 400);
  const quita = await req("PUT", `/${e.id}`, { pay: 600 });
  assert.equal(quita.status, "paid", "completar o valor quita sozinho");
  assert.equal(quita.paid_amount, 1000);
});

test("pagar mais do que o devido não deixa o saldo negativo", async () => {
  const cli = novoCliente(10);
  const e = await req("POST", "/", {
    type: "income", description: "Pagou a mais", amount: 500, client_id: cli,
    category: "Mensalidade", status: "pending", due_date: "2026-10-10",
  });
  const r = await req("PUT", `/${e.id}`, { pay: 900 });
  assert.equal(r.paid_amount, 500, "o pago não passa do valor da cobrança");
  assert.equal(r.status, "paid");
});

test("voltar para pendente zera o que estava pago e some a data", async () => {
  const cli = novoCliente(10);
  const e = await req("POST", "/", {
    type: "income", description: "Estornada", amount: 700, client_id: cli,
    category: "Mensalidade", status: "paid", due_date: "2026-10-10",
  });
  const r = await req("PUT", `/${e.id}`, { status: "pending" });
  assert.equal(r.status, "pending");
  assert.equal(r.paid_amount, 0);
  assert.equal(r.paid_at, null);
});
