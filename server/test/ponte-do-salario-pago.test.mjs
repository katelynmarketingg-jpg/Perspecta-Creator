// O QUE ELA PAGA AQUI TEM DE MUDAR LÁ.
//
// "Lá no Financeiro quero que interligue a isso aqui, pra que quando eu pagar
// qualquer coisa aqui, além de mudar em cima, mudar lá também."
//
// A linha "Salário Katy" no Financeiro já carregava o TOTAL do mês dela. O que
// não andava era o quanto disso já tinha saído: cada check aqui não mexia em
// nada lá. Agora o paid_amount acompanha, e o Financeiro mostra o parcial.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-ponte-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const pf = (await import("../src/routes/personal-finance.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Ponte',0)").run().lastInsertRowid;
const katy = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katy','Katy','k@p.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/personal-finance", pf);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/personal-finance`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: katy }, JWT_SECRET)}` };
after(() => { srv.close(); db.close(); });

const req = (m, u, corpo) => fetch(B + u, {
  method: m, headers: H, body: corpo ? JSON.stringify(corpo) : undefined,
}).then(async (r) => ({ st: r.status, corpo: await r.json().catch(() => ({})) }));

const salario = () => db.prepare(
  "SELECT amount, paid_amount, status FROM financial_entries WHERE org_id=? AND category LIKE 'Sal%'"
).get(org);

// Liga a ponte — sem ela, nada do pessoal aparece no Financeiro.
await req("PUT", "/config", { salary: 0, ym: "2026-10", ponte_financeiro: true });
const a = (await req("POST", "/", { ym: "2026-10", name: "Mercado", amount: 400, method: "Pix" })).corpo;
const b = (await req("POST", "/", { ym: "2026-10", name: "Luz", amount: 100, method: "Pix" })).corpo;

test("a linha do Financeiro nasce com o total do mês e nada pago", () => {
  const l = salario();
  assert.equal(l.amount, 500);
  assert.equal(l.paid_amount, 0);
  assert.equal(l.status, "pending");
});

test("marcou uma conta aqui: lá vira PARCIAL, com o quanto já saiu", async () => {
  await req("PUT", `/${a.id}`, { paid: true });
  const l = salario();
  assert.equal(l.amount, 500, "o valor do salário é o mês inteiro — não encolhe");
  assert.equal(l.paid_amount, 400, "o que já saiu acompanha o check");
  assert.equal(l.status, "partial");
});

test("marcou tudo: lá fica pago", async () => {
  await req("PUT", `/${b.id}`, { paid: true });
  const l = salario();
  assert.equal(l.paid_amount, 500);
  assert.equal(l.status, "paid");
});

test("desmarcou: volta a faltar — o número anda nos dois sentidos", async () => {
  await req("PUT", `/${b.id}`, { paid: false });
  const l = salario();
  assert.equal(l.paid_amount, 400);
  assert.equal(l.status, "partial");
});

test("esta linha é um ESPELHO: o que manda é Minhas Finanças", async () => {
  // Cheguei a proteger um "pago" marcado à mão no Financeiro — e a regra se
  // contradizia com o caso acima: a linha não reabria ao desmarcar. A tela do
  // Financeiro já promete o contrário no selinho desta linha ("automático —
  // cada check de lá atualiza este valor"), então quem manda é daqui.
  db.prepare("UPDATE financial_entries SET status='paid', paid_amount=0 WHERE org_id=? AND category LIKE 'Sal%'").run(org);
  await req("PUT", `/${a.id}`, { paid: true });    // 400 de 500 marcados aqui
  const l = salario();
  assert.equal(l.status, "partial", "o espelho corrige o que foi marcado à mão");
  assert.equal(l.paid_amount, 400);
});

test("o lazer entra no VALOR, nunca no pago: é o que ela ainda vai pegar", async () => {
  // Neste ponto, dos 500 de contas ela marcou 400 (o caso acima).
  await req("PUT", "/config", { salary: 300, ym: "2026-10" });
  const l = salario();
  assert.equal(l.amount, 800, "500 de contas + 300 de lazer");
  assert.equal(l.paid_amount, 400, "só as contas marcadas — o lazer não saiu do caixa");
  assert.equal(l.status, "partial");
});
