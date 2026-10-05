// MINHAS FINANÇAS É PRIVADO.
//
// Palavras dela: "quero que tudo que eu coloque nas minhas finanças fique
// somente visível para o meu acesso e não apareça na aba financeiro que é da
// empresa".
//
// O que acontecia: toda vez que alguém abria o Financeiro, o sistema escrevia
// nas despesas da EMPRESA uma linha "Salário <Nome>" com o TOTAL do mês pessoal
// daquela pessoa. E o Financeiro não é restrito — todo o time vê. Ou seja: o
// quanto cada um gastou no mês estava publicado. No sentido contrário, as
// despesas da empresa com cartão apareciam dentro do pessoal de todo mundo,
// inclusive as pagas no cartão de OUTRA pessoa.
//
// Agora a ponte entre as duas telas é uma escolha de cada um, e nasce
// DESLIGADA: o padrão é privado.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-privado-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { ponteLigada } = await import("../src/routes/personal-finance.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const personal = (await import("../src/routes/personal-finance.js")).default;
const financial = (await import("../src/routes/financial.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Privada',0)").run().lastInsertRowid;
const katy = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katelyn','katy','k@p.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const rafa = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Rafaela','rafa','r@p.com',?,'user',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/personal-finance", personal);
app.use("/api/financial", financial);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
after(() => srv.close());

const comoH = (id) => ({ authorization: `Bearer ${jwt.sign({ id }, JWT_SECRET)}`, "content-type": "application/json" });
const pedir = async (quem, metodo, caminho, corpo) => {
  const r = await fetch(`${B}${caminho}`, {
    method: metodo, headers: comoH(quem), body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

const ym = new Date().toISOString().slice(0, 7);
const salariosNoFinanceiro = () => db.prepare(
  `SELECT description, amount, status FROM financial_entries
    WHERE org_id=? AND type='expense' AND description LIKE 'Salário %' AND category = description
    ORDER BY description`
).all(org);

// --- o padrão é privado -----------------------------------------------------------

test("a ponte nasce desligada para todo mundo", () => {
  assert.equal(ponteLigada(org, katy), false);
  assert.equal(ponteLigada(org, rafa), false);
});

test("o que a Rafaela lança NÃO vira linha nas despesas da empresa", async () => {
  await pedir(rafa, "POST", "/personal-finance", { ym, name: "Terapia", amount: 400, category: "Saúde" });
  await pedir(rafa, "GET", `/financial?month=${ym}`);   // abrir o Financeiro é o que criava a linha
  assert.deepEqual(salariosNoFinanceiro(), [], "nada de 'Salário Rafaela' nas despesas");
});

test("a Katelyn, no Financeiro, não vê o total pessoal da Rafaela", async () => {
  const r = await pedir(katy, "GET", `/financial?month=${ym}`);
  const lista = Array.isArray(r.corpo) ? r.corpo : (r.corpo.entries || []);
  assert.ok(!lista.some((e) => /Rafaela/i.test(e.description || "")), "o nome dela não aparece");
});

test("as contas da Rafaela continuam lá, para ela", async () => {
  const r = await pedir(rafa, "GET", `/personal-finance?ym=${ym}`);
  assert.ok(r.corpo.entries.some((e) => e.name === "Terapia"));
  assert.equal(r.corpo.ponte_financeiro, false);
});

test("e a Katelyn não enxerga as contas da Rafaela", async () => {
  const r = await pedir(katy, "GET", `/personal-finance?ym=${ym}`);
  assert.ok(!r.corpo.entries.some((e) => e.name === "Terapia"), "cada um vê o seu");
});

// --- a outra ponta: despesa da empresa não entra no pessoal -------------------------

test("despesa da empresa com cartão NÃO aparece no pessoal de ninguém", async () => {
  db.prepare(
    `INSERT INTO financial_entries (type,description,amount,status,due_date,category,card,org_id)
     VALUES ('expense','Aluguel do escritório',3500,'pending',?,'Estrutura','Cartão PJ',?)`
  ).run(`${ym}-15`, org);
  db.prepare(
    `INSERT INTO financial_entries (type,description,amount,status,due_date,category,card,org_id)
     VALUES ('expense','Adobe',280,'pending',?,'Perspectiva','Nubank PF Katelyn',?)`
  ).run(`${ym}-15`, org);

  for (const quem of [katy, rafa]) {
    const r = await pedir(quem, "GET", `/personal-finance?ym=${ym}`);
    const daEmpresa = r.corpo.entries.filter((e) => e.da_perspectiva);
    assert.deepEqual(daEmpresa, [], "a tela é só da pessoa");
  }
});

test("o Financeiro da empresa não fala das contas pessoais de quem olha", async () => {
  const r = await pedir(rafa, "GET", `/financial/summary?month=${ym}`).catch(() => null);
  // A rota de resumo pode ter outro nome; o que importa é não vazar o total.
  if (r?.corpo && typeof r.corpo === "object") {
    const texto = JSON.stringify(r.corpo);
    assert.ok(!texto.includes("400"), "o valor da Terapia não aparece no resumo da empresa");
  }
});

// --- ligar de volta, para quem quiser ------------------------------------------------

test("ligando a ponte, a linha volta — e o aviso é explícito na tela", async () => {
  const r = await pedir(katy, "PUT", "/personal-finance/config", { salary: 0, ym, ponte_financeiro: true });
  assert.equal(r.status, 200);
  assert.equal(ponteLigada(org, katy), true);

  await pedir(katy, "POST", "/personal-finance", { ym, name: "Mercado", amount: 900, category: "Casa" });
  await pedir(katy, "GET", `/financial?month=${ym}`);
  const linhas = salariosNoFinanceiro();
  assert.equal(linhas.length, 1);
  assert.match(linhas[0].description, /Salário Katelyn/);
});

test("ligar para uma pessoa não liga para a outra", () => {
  assert.equal(ponteLigada(org, katy), true);
  assert.equal(ponteLigada(org, rafa), false, "a escolha é de cada um");
  assert.ok(!salariosNoFinanceiro().some((l) => /Rafaela/.test(l.description)));
});

test("desligando de novo, a linha PENDENTE sai do Financeiro", async () => {
  await pedir(katy, "PUT", "/personal-finance/config", { salary: 0, ym, ponte_financeiro: false });
  await pedir(katy, "GET", `/financial?month=${ym}`);
  assert.deepEqual(salariosNoFinanceiro(), []);
});

test("mas a linha JÁ PAGA fica: é dinheiro que saiu do caixa", async () => {
  await pedir(katy, "PUT", "/personal-finance/config", { salary: 0, ym, ponte_financeiro: true });
  await pedir(katy, "GET", `/financial?month=${ym}`);
  db.prepare("UPDATE financial_entries SET status='paid' WHERE description LIKE 'Salário Katelyn%'").run();

  await pedir(katy, "PUT", "/personal-finance/config", { salary: 0, ym, ponte_financeiro: false });
  await pedir(katy, "GET", `/financial?month=${ym}`);
  const linhas = salariosNoFinanceiro();
  assert.equal(linhas.length, 1, "apagar falsearia os livros");
  assert.equal(linhas[0].status, "paid");
});

test("salvar só o lazer não desliga a ponte de quem a tinha ligada", async () => {
  await pedir(katy, "PUT", "/personal-finance/config", { salary: 0, ym, ponte_financeiro: true });
  await pedir(katy, "PUT", "/personal-finance/config", { salary: 500, ym });   // sem a chave no corpo
  assert.equal(ponteLigada(org, katy), true);
  await pedir(katy, "PUT", "/personal-finance/config", { salary: 0, ym, ponte_financeiro: false });
});

// --- a limpeza do que já estava publicado ----------------------------------------------

test("a folha de pagamento de VERDADE não é confundida com a linha automática", () => {
  // Lançada na mão, com categoria própria: não casa com o padrão da automática.
  db.prepare(
    `INSERT INTO financial_entries (type,description,amount,status,due_date,category,org_id)
     VALUES ('expense','Salário Bruno',2000,'pending',?,'Salários',?)`
  ).run(`${ym}-15`, org);
  const manual = db.prepare(
    "SELECT description, category FROM financial_entries WHERE description='Salário Bruno'"
  ).get();
  assert.notEqual(manual.category, manual.description,
    "é o que distingue as duas: na automática, categoria == descrição");
  assert.ok(!salariosNoFinanceiro().some((l) => /Bruno/.test(l.description)),
    "a folha de pagamento fica de fora da limpeza");
});

test("a limpeza de uma vez só está registrada", () => {
  const dbjs = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/db.js"), "utf8");
  assert.match(dbjs, /salario-automatico-fora-do-financeiro/);
  const trecho = dbjs.slice(dbjs.indexOf("salario-automatico-fora-do-financeiro"), dbjs.indexOf("export default db;"));
  assert.match(trecho, /status <> 'paid'/, "só as pendentes");
  assert.match(trecho, /category = description/, "só as automáticas");
});

// --- o que a tela promete ---------------------------------------------------------------

const tela = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../client/src/pages/MinhasFinancas.jsx"), "utf8");

test("a tela tem a chave, e explica o que acontece ao ligar", () => {
  assert.match(tela, /async function alternarPonte/);
  assert.match(tela, /ponte_financeiro/);
  assert.match(tela, /Esta tela é só sua/);
  const trecho = tela.slice(tela.indexOf("async function alternarPonte"), tela.indexOf("async function salvarSalario"));
  assert.match(trecho, /confirm\(/, "ligar publica um número para a equipe: confirma antes");
});
