// SALÁRIO KATY — o dinheiro que ela tira da empresa aos poucos.
//
// Ela não retira o salário de uma vez: vai pagando as contas pessoais uma a
// uma, e cada conta paga é dinheiro que já saiu do caixa. Antes, quando isso
// chegava no Financeiro, chegava picado — MacBook, monitor, Adobe, celular,
// cada um numa linha. O pedido foi juntar tudo em UM tópico só, que engorda a
// cada check.
//
// E, em cima das Minhas Finanças, responder a pergunta dela: "o que falta pagar
// do meu?" — que, nas palavras dela, é "os valores que tenho em aberto, mais o
// valor que eu colocar ali de salário".
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  topicoDoSalario, quantoJaPeguei, quantoFaltaPagar, oQueFaltaDoMeu,
  ultimoDiaDoMes, souDaPerspectiva,
} from "../src/salario-katy.js";
// A tela do Financeiro é quem junta as despesas em tópicos.
import { agrupaEmTopicos, valeAPenaAgrupar, nomesDoTopico } from "../../client/src/topicos.js";

// --- a conta, sem banco nenhum ---------------------------------------------

test("o tópico leva o primeiro nome de quem é o salário", () => {
  assert.equal(topicoDoSalario("Katy Marketing"), "Salário Katy");
  assert.equal(topicoDoSalario("  Bruna  "), "Salário Bruna");
  assert.equal(topicoDoSalario(""), "Salário Katy");
  assert.equal(topicoDoSalario(null), "Salário Katy");
});

test("gasto da Perspectiva é da empresa — não conta como salário dela", () => {
  assert.ok(souDaPerspectiva("Perspectiva"));
  assert.ok(souDaPerspectiva("perspec"));
  assert.ok(!souDaPerspectiva("Casa"));
  assert.ok(!souDaPerspectiva(null));

  const linhas = [
    { amount: 300, paid: true, category: "Casa" },
    { amount: 900, paid: true, category: "Perspectiva" }, // da empresa: fora
    { amount: 200, paid: false, category: "Mercado" },
  ];
  assert.equal(quantoJaPeguei(linhas), 300);
  assert.equal(quantoFaltaPagar(linhas), 200);
});

test("o que falta pagar do meu = o que está em aberto + o salário que falta pegar", () => {
  const linhas = [
    { amount: 400, paid: true, category: "Casa" },     // já peguei
    { amount: 600, paid: false, category: "Mercado" }, // em aberto
  ];
  const m = oQueFaltaDoMeu(linhas, 2000);
  assert.equal(m.emAberto, 600);
  assert.equal(m.jaPeguei, 400);
  assert.equal(m.salario, 2000);
  assert.equal(m.salarioAindaAPegar, 1600); // o salário já não é o cheio
  assert.equal(m.total, 2200);
});

test("sem salário digitado, a conta é só o que está em aberto", () => {
  const m = oQueFaltaDoMeu([{ amount: 750, paid: false, category: "Casa" }], 0);
  assert.equal(m.salarioAindaAPegar, 0);
  assert.equal(m.total, 750);
});

test("se ela já pegou mais que o salário, o que falta não fica negativo", () => {
  const m = oQueFaltaDoMeu([{ amount: 3000, paid: true, category: "Casa" }], 1000);
  assert.equal(m.jaPeguei, 3000);
  assert.equal(m.salarioAindaAPegar, 0);
  assert.equal(m.total, 0);
});

test("o vencimento do salário é o último dia do mês, inclusive em fevereiro", () => {
  assert.equal(ultimoDiaDoMes("2026-09"), "2026-09-30");
  assert.equal(ultimoDiaDoMes("2026-02"), "2026-02-28");
  assert.equal(ultimoDiaDoMes("2028-02"), "2028-02-29");
});

test("as despesas se juntam em tópicos, com total, pago e em aberto", () => {
  const g = agrupaEmTopicos([
    { id: 1, category: "Perspectiva", amount: 100, status: "paid" },
    { id: 2, category: "Perspectiva", amount: 400, status: "pending", impagavel: 1 },
    { id: 3, category: "Perspectiva", amount: 200, status: "partial", paid_amount: 50 },
    { id: 4, category: "Salário Katy", amount: 900, status: "paid" },
    { id: 5, category: null, amount: 30, status: "pending" },
  ]);
  // do maior pro menor: o tópico mais pesado do mês encabeça a lista
  assert.deepEqual(g.map((x) => x.topico), ["Salários", "Custos Perspectiva"]);
  const p = g.find((x) => x.topico === "Custos Perspectiva");
  assert.equal(p.total, 730, "os 700 da Perspectiva + os 30 sem categoria");
  assert.equal(p.pago, 150);   // 100 pago + 50 do parcial
  assert.equal(p.aberto, 580);
  assert.equal(p.impagaveis, 1);
  assert.equal(p.itens.length, 4);
});

test("despesa sem categoria é conta da casa — cai em Custos Perspectiva", () => {
  // Era exatamente a tela dela: dez assinaturas soltas, nenhuma com categoria.
  const g = agrupaEmTopicos([
    { id: 1, description: "Netcomet", amount: 119.9, status: "pending" },
    { id: 2, description: "Adobe", amount: 55, status: "pending", category: "" },
    { id: 3, description: "Claude+ chat+ dropbox+ apple", amount: 530, status: "pending", category: null },
    { id: 4, description: "Apple + Canva", amount: 85, status: "pending", category: "  " },
  ]);
  assert.equal(g.length, 1, "vira uma linha só");
  assert.equal(g[0].topico, "Custos Perspectiva");
  assert.equal(g[0].total, 789.9);
  assert.equal(g[0].itens.length, 4, "e o detalhe continua guardado, pra abrir");
});

test("com pouca coisa na tela, juntar em tópicos só atrapalha", () => {
  const poucas = [{ category: "Perspectiva", amount: 10 }, { category: "Casa", amount: 20 }];
  assert.ok(!valeAPenaAgrupar(poucas));
  const muitas = Array.from({ length: 8 }, (_, i) => ({ category: i % 2 ? "Perspectiva" : "Salário Katy", amount: 10 }));
  assert.ok(valeAPenaAgrupar(muitas));
  // oito linhas, oito tópicos diferentes: agrupar não junta nada
  const espalhadas = Array.from({ length: 8 }, (_, i) => ({ category: `Tópico ${i}`, amount: 10 }));
  assert.ok(!valeAPenaAgrupar(espalhadas));
});

test("os salários ficam num tópico só, escritos como forem", () => {
  // Na tela dela havia três linhas em dois tópicos ("Salário" e "Salários"),
  // separadas só pela letra final, e o "Salário Katy" num terceiro.
  const g = agrupaEmTopicos([
    { id: 1, description: "Salário Bruno", category: "Salário", amount: 2000, status: "paid" },
    { id: 2, description: "Salário Rafaela", category: "Salários", amount: 600, status: "paid" },
    { id: 3, description: "Salário Katy", category: "Salário Katy", amount: 1600, status: "paid" },
    { id: 4, description: "Netcomet", amount: 119.9, status: "pending" },
    { id: 5, description: "Registro.br", category: "Perspectiva", amount: 89, status: "pending" },
  ]);
  assert.deepEqual(g.map((x) => x.topico), ["Salários", "Custos Perspectiva"]);
  assert.equal(g[0].total, 4200, "os três salários somados");
  assert.equal(g[1].total, 208.9, "e a casa continua separada");
});

test("o título do tópico diz o que tem dentro", () => {
  const g = agrupaEmTopicos([
    { id: 1, description: "Salário Bruno", category: "Salário", amount: 2000, status: "paid" },
    { id: 2, description: "Salário Rafaela", category: "Salários", amount: 600, status: "paid" },
    { id: 3, description: "Salário Katy", category: "Salário Katy", amount: 1600, status: "paid" },
  ]);
  assert.equal(g[0].nomes, "Salário Bruno, Salário Rafaela, Salário Katy");
});

test("com muita coisa dentro, o título mostra os primeiros e conta o resto", () => {
  const itens = ["Netcomet", "Adobe", "Celular", "Curso", "Canva"].map((d) => ({ description: d }));
  assert.equal(nomesDoTopico(itens), "Netcomet, Adobe, Celular +2");
  assert.equal(nomesDoTopico([]), "");
});

// --- a ponte de verdade, com banco e rotas ---------------------------------

const dir = mkdtempSync(join(tmpdir(), "pc-salario-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const pessoaisRoutes = (await import("../src/routes/personal-finance.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Salário',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katy Souza','katy','katy@p.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/personal-finance", pessoaisRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/personal-finance`;
const auth = { "content-type": "application/json",
               authorization: `Bearer ${jwt.sign({ id: uid, org_id: org, role: "admin" }, JWT_SECRET)}` };
const chamar = (m, c, corpo) => fetch(`${B}${c}`, {
  method: m, headers: auth, body: corpo ? JSON.stringify(corpo) : undefined });

const MES = "2026-09";
const linhaDoSalario = () => db.prepare(
  `SELECT * FROM financial_entries
    WHERE org_id=? AND type='expense' AND category='Salário Katy'
      AND strftime('%Y-%m', due_date)=?`
).get(org, MES);

// O SALÁRIO DELA é o mês inteiro mais o lazer — não "o que já saiu".
// Palavras dela: "o meu vai ser o que está lá nas minhas finanças de gastos,
// mais o que eu colocar de lazer. E daí, se eu mudar lá, muda aqui."

test("lançar um gasto já cria a linha do salário, mesmo sem check nenhum", async () => {
  const mac = await (await chamar("POST", "/", { ym: MES, name: "MacBook", amount: 800, category: "Equipamento" })).json();
  const l = linhaDoSalario();
  assert.ok(l, "a conta existe, então já faz parte do salário");
  assert.equal(l.description, "Salário Katy");
  assert.equal(l.amount, 800);
  assert.equal(l.status, "pending", "é o que a empresa ainda deve pagar a ela");
  return mac;
});

test("outro gasto engorda a MESMA linha — não cria outra", async () => {
  await chamar("POST", "/", { ym: MES, name: "Mercado", amount: 500, category: "Casa" });
  const todas = db.prepare("SELECT * FROM financial_entries WHERE org_id=? AND category='Salário Katy'").all(org);
  assert.equal(todas.length, 1, "continua sendo uma linha só");
  assert.equal(todas[0].amount, 1300, "800 + 500");
});

test("dar ou tirar o check NÃO mexe no salário — a conta já estava contada", async () => {
  const linhas = db.prepare("SELECT * FROM personal_finance WHERE org_id=? AND ym=? ORDER BY id").all(org, MES);
  const mac = linhas.find((l) => l.name === "MacBook");
  await chamar("PUT", `/${mac.id}`, { paid: true });
  assert.equal(linhaDoSalario().amount, 1300);
  await chamar("PUT", `/${mac.id}`, { paid: false });
  assert.equal(linhaDoSalario().amount, 1300);
});

test("o lazer entra no salário, e mudar o lazer muda a linha na hora", async () => {
  await chamar("PUT", "/config", { salary: 700, ym: MES });
  assert.equal(linhaDoSalario().amount, 2000, "1.300 de contas + 700 de lazer");

  await chamar("PUT", "/config", { salary: 0, ym: MES });
  assert.equal(linhaDoSalario().amount, 1300, "tirou o lazer, a linha encolhe");
});

test("mudar o valor de um gasto muda a linha junto", async () => {
  const mercado = db.prepare("SELECT * FROM personal_finance WHERE org_id=? AND ym=? AND name='Mercado'").get(org, MES);
  await chamar("PUT", `/${mercado.id}`, { amount: 900 });
  assert.equal(linhaDoSalario().amount, 1700, "800 + 900");
});

test("se ela marcar o salário como pago lá, continua pago quando a linha muda", async () => {
  db.prepare("UPDATE financial_entries SET status='paid' WHERE id=?").run(linhaDoSalario().id);
  await chamar("POST", "/", { ym: MES, name: "Farmácia", amount: 100, category: "Casa" });
  const l = linhaDoSalario();
  assert.equal(l.amount, 1800);
  assert.equal(l.status, "paid", "o que ela marcou é dela e fica");
  db.prepare("UPDATE financial_entries SET status='pending' WHERE id=?").run(l.id);
});

test("gasto da Perspectiva vai pro Financeiro e não entra no salário dela", async () => {
  const antes = linhaDoSalario().amount;
  await chamar("POST", "/", { ym: MES, name: "Registro.br", amount: 90, category: "Perspectiva", paid: true });
  assert.equal(linhaDoSalario().amount, antes, "o salário não mexeu");
  const dela = db.prepare(
    "SELECT * FROM financial_entries WHERE org_id=? AND category='Perspectiva' AND description='Registro.br'"
  ).get(org);
  assert.ok(dela, "a despesa da empresa foi pro Financeiro, no tópico Perspectiva");
});

test("apagar os gastos e zerar o lazer faz a linha sumir", async () => {
  for (const l of db.prepare("SELECT id FROM personal_finance WHERE org_id=? AND ym=?").all(org, MES)) {
    await chamar("DELETE", `/${l.id}`);
  }
  await chamar("PUT", "/config", { salary: 0, ym: MES });
  assert.equal(linhaDoSalario(), undefined, "sem nada, não há salário a pagar");
});

// A VOLTA: marcar a conta da Perspectiva como paga AQUI marca lá no Financeiro.
test("marcar a Perspectiva como paga aqui marca como paga no Financeiro", async () => {
  const entry = db.prepare(
    `INSERT INTO financial_entries (org_id, type, description, amount, category, status, due_date, card, impagavel)
     VALUES (?, 'expense', 'Adobe', 55, 'Perspectiva', 'pending', ?, 'Nubank PJ', 0)`
  ).run(org, `${MES}-10`).lastInsertRowid;

  // ela aparece na fatura daqui, marcada
  const antes = await (await chamar("GET", `/?ym=${MES}`)).json();
  const naFatura = antes.entries.find((e) => e.name === "Adobe");
  assert.ok(naFatura?.da_perspectiva, "está na lista, marcada como da Perspectiva");
  assert.equal(naFatura.paid, false);

  await chamar("PUT", `/perspectiva/${entry}`, { paid: true });
  assert.equal(db.prepare("SELECT status FROM financial_entries WHERE id=?").get(entry).status, "paid",
    "o lançamento do Financeiro ficou pago");

  const depois = await (await chamar("GET", `/?ym=${MES}`)).json();
  assert.equal(depois.entries.find((e) => e.name === "Adobe").paid, true, "e a fatura daqui mostra pago");

  // e desmarcar volta atrás, dos dois lados
  await chamar("PUT", `/perspectiva/${entry}`, { paid: false });
  assert.equal(db.prepare("SELECT status FROM financial_entries WHERE id=?").get(entry).status, "pending");
});

test("a conta da Perspectiva não vira salário dela nem some do Financeiro", async () => {
  assert.equal(linhaDoSalario(), undefined, "ela não tem gasto próprio neste mês");
  assert.ok(db.prepare("SELECT 1 FROM financial_entries WHERE org_id=? AND description='Adobe'").get(org),
    "a despesa da empresa continua lá, inteira");
});

after(() => { srv.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
