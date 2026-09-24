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

test("saldo atual é o que JÁ entrou menos o que JÁ saiu", async () => {
  lanc.run(org, "income", "Mensalidade A", 6200, "paid", "2026-09-10");
  lanc.run(org, "expense", "Salários", 2600, "paid", "2026-09-15");
  const p = await (await chamar("GET", `/projecao?month=${MES}`)).json();
  assert.equal(p.entrou, 6200);
  assert.equal(p.saiu, 2600);
  assert.equal(p.saldo_atual, 3600, "dinheiro de verdade, não previsão");
});

test("o que ainda não foi pago fica em 'falta pagar', fora do saldo", async () => {
  lanc.run(org, "expense", "Fornecedor", 400, "pending", "2026-09-28");
  const p = await (await chamar("GET", `/projecao?month=${MES}`)).json();
  assert.equal(p.saldo_atual, 3600, "o saldo não muda: esse dinheiro ainda não saiu");
  assert.equal(p.a_pagar_casa, 400);
  assert.equal(p.falta_pagar, 400);
  assert.equal(p.sobra_final, 3200, "3600 − 400");
});

test("as contas dela em aberto entram no que falta pagar", async () => {
  db.prepare(
    "INSERT INTO personal_finance (org_id,user_id,ym,name,amount,category,paid) VALUES (?,?,?,?,?,?,0)"
  ).run(org, uid, MES, "Mercado", 900, "Casa");
  db.prepare(
    "INSERT INTO personal_finance (org_id,user_id,ym,name,amount,category,paid) VALUES (?,?,?,?,?,?,0)"
  ).run(org, uid, MES, "Domínio", 60, "Perspectiva");

  const p = await (await chamar("GET", `/projecao?month=${MES}`)).json();
  assert.equal(p.meu_aberto, 900, "só o que NÃO é da Perspectiva — o resto já vive no Financeiro");
  assert.equal(p.saldo_atual, 3600, "nada saiu ainda");
  assert.equal(p.falta_pagar, 1300, "400 da casa + 900 dela");
  assert.equal(p.sobra_final, 2300, "3600 − 1300");
});

// A CONTA DOBRADA que ela sentiu: desde que o "Salário Katy" virou o total das
// contas dela, esse total está entre as despesas do Financeiro. Somar as contas
// dela outra vez por fora contaria a mesma coisa duas vezes.
test("a linha do Salário não é contada junto com as contas que a formam", async () => {
  const antes = await (await chamar("GET", `/projecao?month=${MES}`)).json();
  lanc.run(org, "expense", "Salário K", 900, "pending", "2026-09-30");
  db.prepare("UPDATE financial_entries SET category='Salário K' WHERE description='Salário K'").run();

  const p = await (await chamar("GET", `/projecao?month=${MES}`)).json();
  assert.equal(p.falta_pagar, antes.falta_pagar, "o espelho não soma de novo");
  assert.equal(p.sobra_final, antes.sobra_final);
});

test("marcar uma conta dela como paga desconta do saldo na hora", async () => {
  // É o pedido dela: "quando eu marcar algo como pago das minhas contas,
  // desconte aquele valor do valor que entrou".
  db.prepare(
    "INSERT INTO personal_finance (org_id,user_id,ym,name,amount,category,paid) VALUES (?,?,?,?,?,?,1)"
  ).run(org, uid, MES, "Luz (paga)", 200, "Casa");

  const p = await (await chamar("GET", `/projecao?month=${MES}`)).json();
  assert.equal(p.meu_pago, 200);
  assert.equal(p.saldo_atual, 3400, "3600 − 200: o dinheiro saiu de verdade");
  assert.equal(p.meu_aberto, 900, "e ela não aparece mais no que falta");
  assert.equal(p.falta_pagar, 1300);
  assert.equal(p.sobra_final, 2100, "3400 − 1300");
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
  assert.equal(p.entrou, 6200, "a conta do mês continua só com o que tem data");
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

test("e aí o dinheiro entra no saldo — uma vez só", async () => {
  const p = await (await chamar("GET", `/projecao?month=${MES}`)).json();
  assert.equal(p.entrou, 6700, "6200 + 500: a baixa vira receita paga");
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

// --- EDITAR A DÍVIDA -------------------------------------------------------
// Nome errado, valor digitado torto, nota vaga. Antes só dava para apagar e
// cadastrar de novo — e aí ia junto o histórico do que já tinha sido recebido.

test("dá para consertar o nome, o valor e a nota sem perder o histórico", async () => {
  const c = await (await chamar("POST", "/a-receber", { quem: "RAF", total: "1,80", nota: "Mensalidades atrasadas" })).json();
  await chamar("POST", `/a-receber/${c.id}/baixa`, { valor: "0,80" });

  const d = await (await chamar("PUT", `/a-receber/${c.id}`, { quem: "RAF Comunicação", total: "1.800,00" })).json();
  assert.equal(d.quem, "RAF Comunicação");
  assert.equal(d.total, 1800);
  assert.equal(d.nota, "Mensalidades atrasadas", "o que não veio no corpo fica como estava");
  assert.equal(d.recebido, 0.8, "o que já entrou continua contado");
  assert.equal(d.falta, 1799.2);
});

test("editar sem nome não passa", async () => {
  const c = await (await chamar("POST", "/a-receber", { quem: "Fulano", total: 100 })).json();
  assert.equal((await chamar("PUT", `/a-receber/${c.id}`, { quem: "   " })).status, 400);
  assert.equal((await chamar("PUT", "/a-receber/999999", { quem: "X" })).status, 404);
});

test("baixar o total pra menos do que já entrou dá a dívida por quitada", async () => {
  const c = await (await chamar("POST", "/a-receber", { quem: "Beltrano", total: 1000 })).json();
  await chamar("POST", `/a-receber/${c.id}/baixa`, { valor: 400 });
  const d = await (await chamar("PUT", `/a-receber/${c.id}`, { total: 300 })).json();
  assert.equal(d.quitado, true);
  const lista = await (await chamar("GET", "/a-receber")).json();
  assert.ok(!lista.some((x) => x.id === c.id));
});

test("dívida nova com total zerado continua na lista — é rascunho, não quitação", async () => {
  const c = await (await chamar("POST", "/a-receber", { quem: "A combinar", total: 0 })).json();
  const d = await (await chamar("PUT", `/a-receber/${c.id}`, { nota: "ver quanto é" })).json();
  assert.ok(!d.quitado);
  const lista = await (await chamar("GET", "/a-receber")).json();
  assert.ok(lista.some((x) => x.id === c.id));
});

test("o histórico mostra cada valor recebido", async () => {
  const c = await (await chamar("POST", "/a-receber", { quem: "Cicrano", total: 900 })).json();
  await chamar("POST", `/a-receber/${c.id}/baixa`, { valor: 300, recebido_em: "2026-09-10" });
  await chamar("POST", `/a-receber/${c.id}/baixa`, { valor: 200, recebido_em: "2026-09-18" });
  const h = await (await chamar("GET", `/a-receber/${c.id}/baixas`)).json();
  assert.equal(h.length, 2);
  assert.equal(h[0].valor, 200, "do mais novo pro mais velho");
  assert.equal(h[1].valor, 300);
});

test("desfazer um valor lançado tira o saldo E a entrada do Financeiro", async () => {
  const c = await (await chamar("POST", "/a-receber", { quem: "Enganei", total: 500 })).json();
  const baixa = await (await chamar("POST", `/a-receber/${c.id}/baixa`, { valor: 500 })).json();
  const entryId = baixa.lancamento_id;
  assert.ok(db.prepare("SELECT 1 FROM financial_entries WHERE id = ?").get(entryId), "a entrada existe");

  const h = await (await chamar("GET", `/a-receber/${c.id}/baixas`)).json();
  const d = await (await chamar("DELETE", `/a-receber/${c.id}/baixa/${h[0].id}`)).json();
  assert.equal(d.recebido, 0);
  assert.equal(d.falta, 500);
  assert.equal(db.prepare("SELECT 1 FROM financial_entries WHERE id = ?").get(entryId), undefined,
    "a entrada fantasma não fica no Financeiro");

  // tinha sumido por estar quitada: voltou a faltar, volta pra lista
  const lista = await (await chamar("GET", "/a-receber")).json();
  assert.ok(lista.some((x) => x.id === c.id));
});

test("dívida de outra casa não se edita nem se desfaz", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha 2',0)").run().lastInsertRowid;
  const alheia = db.prepare("INSERT INTO a_receber_solto (org_id, quem, total) VALUES (?, 'Outro', 50)").run(outra).lastInsertRowid;
  assert.equal((await chamar("PUT", `/a-receber/${alheia}`, { total: 1 })).status, 404);
  assert.equal((await chamar("GET", `/a-receber/${alheia}/baixas`)).status, 404);
  assert.equal((await chamar("DELETE", `/a-receber/${alheia}/baixa/1`)).status, 404);
});

after(() => { srv.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
