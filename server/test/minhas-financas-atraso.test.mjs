// A CONTA QUE ELA NÃO MARCOU, EM MINHAS FINANÇAS.
//
// Nas palavras dela: "tem a conta da Riachuelo, que é 151. Como eu não paguei,
// vai ela para o próximo mês. Ela soma naquela mesma abinha da Riachuelo o
// valor que eu não paguei e daí fica em vermelho. Quando eu clico na setinha
// para baixo, vai aparecer o valor em vermelho e que é do mês anterior."
//
// O que já existia: o mês novo se preenche sozinho com a parcela SEGUINTE
// (3/8 vira 4/8). O que faltava: a de setembro que ficou sem marcar sumia de
// vista — ficava parada em setembro, e ela só a veria voltando o mês.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-mf-atraso-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const pf = (await import("../src/routes/personal-finance.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Katy',0)").run().lastInsertRowid;
const katy = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katy','Katy','k@mf.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
// Outra pessoa na mesma casa: o atraso dela não pode aparecer no de ninguém.
const bruno = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Bruno','Bruno','b@mf.com',?,'editor',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/personal-finance", pf);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/personal-finance`;
const como = (id) => ({ "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id }, JWT_SECRET)}` });
after(() => { srv.close(); db.close(); });

// INCORPORAR O ATRASO VIROU BOTÃO — e desligado por padrão, como ela pediu:
// "quero ver novembro limpo, sem esses em atraso, porque vou pagar em outubro;
// se eu quiser vê-los em novembro, eu ativo". Estes casos são sobre o atraso em
// si, então pedem o arrasto de propósito; o caso do mês limpo está logo abaixo.
const mes = (ym, quem = katy) =>
  fetch(`${B}/?ym=${ym}&incorporar=1`, { headers: como(quem) }).then((r) => r.json());
const mesLimpo = (ym, quem = katy) =>
  fetch(`${B}/?ym=${ym}`, { headers: como(quem) }).then((r) => r.json());

function gasto({ ym, nome, valor, pago = 0, metodo = "Riachuelo", parcela = null, cat = "Roupas", quem = katy }) {
  return db.prepare(
    `INSERT INTO personal_finance (org_id,user_id,ym,name,parcela,amount,method,category,paid,position)
     VALUES (?,?,?,?,?,?,?,?,?,0)`
  ).run(org, quem, ym, nome, parcela, valor, metodo, cat, pago).lastInsertRowid;
}

// --- o caso dela -------------------------------------------------------------------

test("a Riachuelo de 151 que ela não marcou aparece no mês seguinte", async () => {
  const setembro = gasto({ ym: "2026-09", nome: "Riachuelo", valor: 151, parcela: "3/8" });
  gasto({ ym: "2026-10", nome: "Riachuelo", valor: 151, parcela: "4/8" });

  const out = await mes("2026-10");
  const atrasada = out.atrasadas.find((r) => r.id === setembro);
  assert.ok(atrasada, "a de setembro vem junto");
  assert.equal(atrasada.atrasado_de, "2026-09", "e diz de que mês veio — é o que pinta de vermelho");
  assert.equal(atrasada.amount, 151);
  assert.equal(atrasada.method, "Riachuelo", "pelo método, que é a abinha onde ela soma");
  assert.equal(out.entries.length, 1, "a parcela 4/8 segue sendo a conta do mês");
});

test("o total do atraso vem contado, para o aviso de cima", async () => {
  const out = await mes("2026-10");
  assert.equal(out.summary.atrasado, 151);
  assert.equal(out.summary.atrasadas, 1);
});

test("a LINHA DO SALÁRIO nunca leva o atraso — senão a empresa paga duas vezes", async () => {
  // Esta é a regra que não pode cair. Com o atraso incorporado, os cartões da
  // tela passam a contá-lo DE PROPÓSITO (para fecharem com a lista) — mas a
  // linha que vai para o Financeiro é sempre do MÊS: a conta de setembro já
  // entrou no salário de setembro, e entrar de novo em outubro seria a empresa
  // pagar duas vezes a mesma conta.
  await fetch(`${B}/config`, {
    method: "PUT", headers: como(katy),
    body: JSON.stringify({ salary: 0, ym: "2026-10", ponte_financeiro: true }),
  });
  await mes("2026-10");   // abre o mês COM o atraso incorporado
  const linha = db.prepare(
    "SELECT amount FROM financial_entries WHERE org_id=? AND category LIKE 'Sal%' AND strftime('%Y-%m', due_date)='2026-10'"
  ).get(org);
  const doMes = db.prepare(
    "SELECT COALESCE(SUM(amount),0) v FROM personal_finance WHERE org_id=? AND user_id=? AND ym='2026-10'"
  ).get(org, katy).v;
  assert.equal(linha.amount, doMes, "o salário é o mês dela, nem mais nem menos");
});

test("marcou como paga, some do mês seguinte", async () => {
  const setembro = gasto({ ym: "2026-09", nome: "Luz", valor: 90, metodo: "Pix" });
  assert.ok((await mes("2026-10")).atrasadas.some((r) => r.id === setembro));
  await fetch(`${B}/${setembro}`, { method: "PUT", headers: como(katy), body: JSON.stringify({ paid: true }) });
  assert.ok(!(await mes("2026-10")).atrasadas.some((r) => r.id === setembro), "marcou, saiu");
});

test("em novembro vêm as de setembro E as de outubro", async () => {
  const outubro = gasto({ ym: "2026-10", nome: "Farmácia", valor: 40, metodo: "Pix" });
  const nov = await mes("2026-11");
  const meses = nov.atrasadas.map((r) => r.atrasado_de);
  assert.ok(meses.includes("2026-09"), "a de setembro continua cobrando");
  assert.ok(meses.includes("2026-10"), "e a de outubro entrou na fila");
  assert.ok(nov.atrasadas.some((r) => r.id === outubro));
});

test("o atraso é de cada pessoa — não vaza entre as abas", async () => {
  const doBruno = gasto({ ym: "2026-09", nome: "Conta do Bruno", valor: 500, quem: bruno });
  const daKaty = await mes("2026-10");
  assert.ok(!daKaty.atrasadas.some((r) => r.id === doBruno), "Minhas Finanças é de quem abriu");
  const doBrunoEmOutubro = await mes("2026-10", bruno);
  assert.ok(doBrunoEmOutubro.atrasadas.some((r) => r.id === doBruno));
});

test("gasto da Perspectiva não vira atraso aqui — ele vive no Financeiro", async () => {
  const daCasa = gasto({ ym: "2026-09", nome: "Adobe", valor: 119, cat: "Perspectiva" });
  const out = await mes("2026-10");
  assert.ok(!out.atrasadas.some((r) => r.id === daCasa),
    "a mesma regra do rollForward: Perspectiva é do Financeiro");
});

test("mês antigo não mostra o que ainda nem venceu", async () => {
  const set = await mes("2026-09");
  assert.ok(set.atrasadas.every((r) => r.atrasado_de < "2026-09"),
    "olhando setembro, só o que ficou de antes de setembro");
});

// --- a tela -------------------------------------------------------------------------

const tela = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/pages/MinhasFinancas.jsx"), "utf8");

test("as atrasadas entram na MESMA abinha, somando no total dela", () => {
  assert.match(tela, /\[\.\.\.\(data\?\.entries \|\| \[\]\), \.\.\.\(data\?\.atrasadas \|\| \[\]\)\]/);
  assert.match(tela, /if \(e\.atrasado_de\) \{ map\[k\]\.atrasado \+= Number\(e\.amount\) \|\| 0; map\[k\]\.atrasadas\+\+; \}/);
});

test("a abinha fechada já diz quanto é de mês anterior", () => {
  assert.match(tela, /g\.atrasado > 0 && \(/);
  assert.match(tela, /de \{g\.atrasadas === 1 \? "mês anterior" : "meses anteriores"\}/);
});

test("aberta, a linha é vermelha e diz o mês", () => {
  assert.match(tela, /e\.atrasado_de \? \{ bgcolor: \(t\) => alpha\(t\.palette\.error\.main, 0\.08\) \} : \{\}/);
  assert.match(tela, /color: e\.atrasado_de \? "error\.main" : undefined/);
  assert.match(tela, /label=\{`de \$\{mesPorExtenso\(e\.atrasado_de\)\}`\}/);
});

test('"fatura paga" continua sendo a fatura DO MÊS', () => {
  // Se o atraso entrasse nesta conta, o check nunca mais ficaria marcado e ela
  // acharia que o botão quebrou.
  assert.match(tela, /allPaid: g\.doMes > 0 && g\.pagos === g\.doMes/);
  assert.match(tela, /\{g\.doMes\} item\(ns\) · \{g\.pagos\}\/\{g\.doMes\} pagos/);
});

test("o botão de incorporar manda nos DOIS: nas abinhas e nos cartões", () => {
  // Era aqui que a conta "não batia": as abinhas somavam o atraso e os cartões
  // de cima não — a diferença era exatamente o atraso (R$ 588,69 na tela dela).
  assert.match(tela, /s\?\.atrasadas > 0 && \(/);
  assert.match(tela, /incorporar \? "Tirar daqui" : "Incorporar"/);
  assert.match(tela, /localStorage\.setItem\("mf:incorporar"/, "lembra a escolha dela");
  assert.match(tela, /Este mês está <b>limpo<\/b>/, "desligado, o mês aparece limpo");
});

test("por padrão o mês vem LIMPO — o atraso só entra se ela pedir", async () => {
  const limpo = await mesLimpo("2026-10");
  assert.deepEqual(limpo.atrasadas, [], "nada de mês anterior sem ela clicar");
  assert.ok(limpo.summary.atrasado > 0, "mas o total continua vindo, senão o botão não saberia o que dizer");
  assert.equal(limpo.summary.incorporado, false);
});

test("incorporado, a soma das abinhas FECHA com o total de cima", async () => {
  const com = await mes("2026-10");
  const naTela = [...com.entries, ...com.atrasadas]
    .filter((e) => !e.da_perspectiva)
    .reduce((t, e) => t + Number(e.amount), 0);
  assert.equal(+com.summary.total.toFixed(2), +naTela.toFixed(2),
    "conferir um número contra o outro não pode dar duas verdades");
  assert.equal(com.summary.incorporado, true);
});
