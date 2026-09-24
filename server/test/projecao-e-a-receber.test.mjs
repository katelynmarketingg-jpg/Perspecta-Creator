// VAI SOBRAR OU VAI FALTAR? E QUEM ESTÁ ME DEVENDO?
//
// Os cartões do Financeiro diziam o que JÁ aconteceu ("lucro realizado").
// Faltava a pergunta que ela faz de verdade no fim do mês: com o que tenho para
// receber, eu consigo pagar tudo?
//
// E faltava o espelho de "o que eu devo": o que me devem, SEM data. Isso não
// tem mês — por isso fica fora da previsão, e vira lançamento só quando o
// dinheiro entra de verdade.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-proj-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const financialRoutes = (await import("../src/routes/financial.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Conta',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','k','k@p.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Fulano','active',?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/financial", financialRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/financial`;
const auth = { "content-type": "application/json",
               authorization: `Bearer ${jwt.sign({ id: uid, org_id: org, role: "admin" }, JWT_SECRET)}` };
const chamar = (m, c, corpo) => fetch(`${B}${c}`, {
  method: m, headers: auth, body: corpo ? JSON.stringify(corpo) : undefined });

const MES = "2026-09";
const lanc = db.prepare(
  "INSERT INTO financial_entries (org_id, type, description, amount, status, due_date) VALUES (?, ?, ?, ?, ?, ?)"
);

test("a projeção diz o que entra, o que sai, e o que sobra", async () => {
  lanc.run(org, "income", "Mensalidade A", 6200, "paid", "2026-09-10");
  lanc.run(org, "expense", "Salários", 2600, "paid", "2026-09-15");
  const p = await (await chamar("GET", `/projecao?month=${MES}`)).json();
  assert.equal(p.entra, 6200);
  assert.equal(p.sai, 2600);
  assert.equal(p.sobra, 3600);
});

test("o que ainda não foi pago aparece separado", async () => {
  lanc.run(org, "expense", "Fornecedor", 400, "pending", "2026-09-28");
  const p = await (await chamar("GET", `/projecao?month=${MES}`)).json();
  assert.equal(p.a_pagar, 400, "é o que ainda falta pagar");
  assert.equal(p.sobra, 3200, "e já entra na conta do que vai sobrar");
});

test("os gastos dela em Minhas Finanças entram como conta separada", async () => {
  db.prepare(
    "INSERT INTO personal_finance (org_id,user_id,ym,name,amount,category,paid) VALUES (?,?,?,?,?,?,0)"
  ).run(org, uid, MES, "Mercado", 900, "Casa");
  db.prepare(
    "INSERT INTO personal_finance (org_id,user_id,ym,name,amount,category,paid) VALUES (?,?,?,?,?,?,0)"
  ).run(org, uid, MES, "Domínio", 60, "Perspectiva");

  const p = await (await chamar("GET", `/projecao?month=${MES}`)).json();
  assert.equal(p.katelyn, 900, "só o que NÃO é da Perspectiva — o resto já vive no Financeiro");
  assert.equal(p.sobra_com_katelyn, 2300, "3200 − 900: o número que responde 'dá para pagar tudo?'");
});

test("gasto já pago dela não conta duas vezes", async () => {
  db.prepare(
    "INSERT INTO personal_finance (org_id,user_id,ym,name,amount,category,paid) VALUES (?,?,?,?,?,?,1)"
  ).run(org, uid, MES, "Luz (paga)", 200, "Casa");
  const p = await (await chamar("GET", `/projecao?month=${MES}`)).json();
  assert.equal(p.katelyn, 900, "o que já saiu não é mais 'a pagar'");
});

// ---------------------------------------------------------------------------
// O QUE ME DEVEM
// ---------------------------------------------------------------------------
let cobranca;

test("registrar quem está devendo, sem data nenhuma", async () => {
  const r = await chamar("POST", "/a-receber", { quem: "João do Score", total: "1.200,00",
                                                  client_id: cli, nota: "serviço de setembro" });
  assert.equal(r.status, 201);
  cobranca = await r.json();
  assert.equal(cobranca.total, 1200);
  assert.equal(cobranca.falta, 1200);
  assert.equal(cobranca.recebido, 0);
});

test("valor em português não vira zero", () => {
  // Com Number puro, "1.200,00" viraria 0 — e a cobrança nasceria valendo nada.
  assert.equal(cobranca.total, 1200);
});

test("sem nome, não registra", async () => {
  assert.equal((await chamar("POST", "/a-receber", { total: 500 })).status, 400);
});

test("isso NÃO entra na previsão do mês — não tem mês", async () => {
  const p = await (await chamar("GET", `/projecao?month=${MES}`)).json();
  assert.equal(p.entra, 6200, "a previsão continua só com o que tem data");
  assert.equal(p.me_devem, 1200, "mas ela vê o número na hora de decidir");
});

test("receber um pedaço abate o saldo E lança no Financeiro", async () => {
  const r = await chamar("POST", `/a-receber/${cobranca.id}/baixa`, { valor: "500", recebido_em: "2026-09-20" });
  assert.equal(r.status, 201);
  const d = await r.json();
  assert.equal(d.recebido, 500);
  assert.equal(d.falta, 700);

  const e = db.prepare("SELECT * FROM financial_entries WHERE id = ?").get(d.lancamento_id);
  assert.equal(e.type, "income");
  assert.equal(e.amount, 500);
  assert.equal(e.status, "paid");
  assert.match(e.description, /João do Score/);
  assert.equal(e.client_id, cli, "vai pendurado no cliente certo");
});

test("e aí o dinheiro aparece na previsão — uma vez só", async () => {
  const p = await (await chamar("GET", `/projecao?month=${MES}`)).json();
  assert.equal(p.entra, 6700, "6200 + 500");
  assert.equal(p.me_devem, 700, "e o saldo em aberto cai junto");
});

test("sem valor, não dá baixa", async () => {
  assert.equal((await chamar("POST", `/a-receber/${cobranca.id}/baixa`, {})).status, 400);
  assert.equal((await chamar("POST", `/a-receber/${cobranca.id}/baixa`, { valor: 0 })).status, 400);
});

test("quitou: some da lista sozinho, como a dívida faz", async () => {
  await chamar("POST", `/a-receber/${cobranca.id}/baixa`, { valor: 700 });
  const lista = await (await chamar("GET", "/a-receber")).json();
  assert.ok(!lista.some((x) => x.id === cobranca.id));
  const p = await (await chamar("GET", `/projecao?month=${MES}`)).json();
  assert.equal(p.me_devem, 0);
});

test("cobrança de outra casa não aparece", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  db.prepare("INSERT INTO a_receber_solto (org_id, quem, total) VALUES (?, 'Alguém', 999)").run(outra);
  const lista = await (await chamar("GET", "/a-receber")).json();
  assert.ok(!lista.some((x) => x.quem === "Alguém"));
});

after(() => { srv.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
