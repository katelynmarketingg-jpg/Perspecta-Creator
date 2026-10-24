// OS DOIS ÍCONES DA LINHA, E O OUTRO LADO DA CONTA.
//
// Pedidos dela, em Minhas Finanças:
//   · "coloque aqui mais dois botões: pagar parcial e acréscimo... pode ser
//      ícones só, um vai dar baixa no valor parcial que eu colocar e o outro
//      acrescenta como juros";
//   · "acrescenta aqui embaixo quem me deve e pelo quê".
//
// O check de pago sempre foi tudo-ou-nada: ou a conta estava quitada ou não.
// Pagar metade do cartão não tinha onde ser registrado. E a lista de dívidas
// existia só para um lado — "o que eu devo".
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-parcial-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const pf = (await import("../src/routes/personal-finance.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Parcial',0)").run().lastInsertRowid;
const katy = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katy','Katy','k@pj.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const bruno = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Bruno','Bruno','b@pj.com',?,'editor',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/personal-finance", pf);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/personal-finance`;
const como = (id) => ({ "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id }, JWT_SECRET)}` });
const req = (m, u, corpo, quem = katy) => fetch(B + u, {
  method: m, headers: como(quem), body: corpo ? JSON.stringify(corpo) : undefined,
}).then(async (r) => ({ st: r.status, corpo: await r.json().catch(() => ({})) }));
after(() => { srv.close(); db.close(); });

const gasto = (valor, quem = katy) => db.prepare(
  `INSERT INTO personal_finance (org_id,user_id,ym,name,amount,method,category,paid,position)
   VALUES (?,?,'2026-10','Riachuelo',?,'Riachuelo','Roupas',0,0)`
).run(org, quem, valor).lastInsertRowid;
const ler = (id) => db.prepare("SELECT * FROM personal_finance WHERE id=?").get(id);

// --- pagar um pedaço -----------------------------------------------------------

test("dá baixa no pedaço que ela colocar, sem quitar a conta", async () => {
  const id = gasto(200);
  const r = await req("POST", `/${id}/parcial`, { valor: "50,00" });
  assert.equal(r.st, 200);
  const l = ler(id);
  assert.equal(l.pago_parcial, 50, "vírgula vira centavo — com Number puro viraria 0");
  assert.equal(l.paid, 0, "metade paga não é conta quitada");
});

test("os pedaços somam", async () => {
  const id = gasto(200);
  await req("POST", `/${id}/parcial`, { valor: "50" });
  await req("POST", `/${id}/parcial`, { valor: "30" });
  assert.equal(ler(id).pago_parcial, 80);
});

test("cobriu o valor, a conta é marcada como paga sozinha", async () => {
  // Deixar a conta "parcial em 100%" mentiria para ela na soma do mês.
  const id = gasto(100);
  await req("POST", `/${id}/parcial`, { valor: "60" });
  const r = await req("POST", `/${id}/parcial`, { valor: "40" });
  assert.equal(r.corpo.quitou, true);
  const l = ler(id);
  assert.equal(l.paid, 1);
  assert.equal(l.pago_parcial, 100);
});

test("pagar mais do que deve não passa do valor da conta", async () => {
  const id = gasto(100);
  await req("POST", `/${id}/parcial`, { valor: "500" });
  assert.equal(ler(id).pago_parcial, 100, "não existe pagar 500 numa conta de 100");
});

test("dá para desfazer as baixas", async () => {
  const id = gasto(200);
  await req("POST", `/${id}/parcial`, { valor: "50" });
  await req("DELETE", `/${id}/parcial`);
  assert.equal(ler(id).pago_parcial, 0);
});

test("conta já quitada não aceita baixa parcial", async () => {
  const id = gasto(100);
  db.prepare("UPDATE personal_finance SET paid=1 WHERE id=?").run(id);
  const r = await req("POST", `/${id}/parcial`, { valor: "10" });
  assert.equal(r.st, 400);
  assert.match(r.corpo.error, /já está quitada/i);
});

test("valor sem sentido não passa, e não toca na conta", async () => {
  const id = gasto(200);
  for (const valor of ["0", "", "abc", "-5"]) {
    assert.equal((await req("POST", `/${id}/parcial`, { valor })).st, 400, `"${valor}" não podia passar`);
  }
  assert.equal(ler(id).pago_parcial, 0);
});

// --- acréscimo (juros) ----------------------------------------------------------

test("o acréscimo entra no valor da conta e fica registrado como juros", async () => {
  const id = gasto(200);
  await req("POST", `/${id}/juros`, { valor: "12,50" });
  const l = ler(id);
  assert.equal(l.amount, 212.5);
  assert.equal(l.juros, 12.5, "para a tela poder dizer quanto do valor é juro");
});

test("juros somam a cada mês que a conta vira", async () => {
  const id = gasto(100);
  await req("POST", `/${id}/juros`, { valor: "5" });
  await req("POST", `/${id}/juros`, { valor: "5" });
  const l = ler(id);
  assert.equal(l.amount, 110);
  assert.equal(l.juros, 10);
});

test("tirar os juros devolve a conta ao valor de origem", async () => {
  const id = gasto(300);
  await req("POST", `/${id}/juros`, { valor: "40" });
  await req("DELETE", `/${id}/juros`);
  const l = ler(id);
  assert.equal(l.amount, 300);
  assert.equal(l.juros, 0);
});

test("conta paga não aceita juros", async () => {
  const id = gasto(100);
  db.prepare("UPDATE personal_finance SET paid=1 WHERE id=?").run(id);
  assert.equal((await req("POST", `/${id}/juros`, { valor: "10" })).st, 400);
});

test("conta de outra pessoa não aceita nem baixa nem juros", async () => {
  const doBruno = gasto(100, bruno);
  assert.equal((await req("POST", `/${doBruno}/parcial`, { valor: "10" })).st, 404);
  assert.equal((await req("POST", `/${doBruno}/juros`, { valor: "10" })).st, 404);
});

test("a baixa parcial chega ao Financeiro — os dois lados andam juntos", async () => {
  await req("PUT", "/config", { salary: 0, ym: "2026-10", ponte_financeiro: true });
  const id = gasto(400);
  await req("POST", `/${id}/parcial`, { valor: "100" });
  const linha = db.prepare("SELECT amount, paid_amount, status FROM financial_entries WHERE org_id=? AND category LIKE 'Sal%'").get(org);
  assert.ok(linha, "a linha do salário existe");
  assert.ok(linha.paid_amount >= 100, `o pedaço pago chegou lá — veio ${linha.paid_amount}`);
});

// --- quem me deve ----------------------------------------------------------------

const creditos = (quem = katy) => req("GET", "/credits", null, quem).then((r) => r.corpo);

test("registra quem me deve e pelo quê", async () => {
  const r = await req("POST", "/credits", { name: "Bruno", total: 500, note: "emprestei pro conserto do carro" });
  assert.equal(r.st, 201);
  assert.equal(r.corpo.name, "Bruno");
  assert.equal(r.corpo.note, "emprestei pro conserto do carro");
  assert.equal(r.corpo.saldo, 500);
  assert.equal(r.corpo.quitada, false);
});

test("sem dizer quem, não registra", async () => {
  const r = await req("POST", "/credits", { total: 100 });
  assert.equal(r.st, 400);
  assert.match(r.corpo.error, /quem está te devendo/i);
});

test("ele me pagou um pedaço: o saldo baixa", async () => {
  const { corpo: c } = await req("POST", "/credits", { name: "Rafaela", total: 300 });
  const r = await req("POST", `/credits/${c.id}/payments`, { amount: 120, note: "pix" });
  assert.equal(r.corpo.pago, 120);
  assert.equal(r.corpo.saldo, 180);
  assert.equal(r.corpo.payments.length, 1);
});

test("pagou tudo: fica quitada", async () => {
  const { corpo: c } = await req("POST", "/credits", { name: "Vó", total: 100 });
  const r = await req("POST", `/credits/${c.id}/payments`, { amount: 100 });
  assert.equal(r.corpo.saldo, 0);
  assert.equal(r.corpo.quitada, true);
});

test("dá para desfazer um abatimento lançado errado", async () => {
  const { corpo: c } = await req("POST", "/credits", { name: "Zé", total: 200 });
  const { corpo: comPgto } = await req("POST", `/credits/${c.id}/payments`, { amount: 50 });
  const r = await req("DELETE", `/credits/${c.id}/payments/${comPgto.payments[0].id}`);
  assert.equal(r.corpo.pago, 0);
  assert.equal(r.corpo.saldo, 200);
});

test("o que eu devo e quem me deve são listas SEPARADAS", async () => {
  await req("POST", "/debts", { name: "Mãe", total: 900 });
  const meus = await creditos();
  assert.ok(!meus.some((c) => c.name === "Mãe"), "dívida minha não aparece como crédito");
  const dividas = (await req("GET", "/debts")).corpo;
  assert.ok(!dividas.some((d) => d.name === "Bruno"), "nem o contrário");
});

test("quem me deve é de cada pessoa — não vaza entre as abas", async () => {
  const { corpo: c } = await req("POST", "/credits", { name: "Alguém da Katy", total: 10 });
  assert.ok(!(await creditos(bruno)).some((x) => x.id === c.id));
});

test("apagar leva os abatimentos junto", async () => {
  const { corpo: c } = await req("POST", "/credits", { name: "Some", total: 50 });
  await req("POST", `/credits/${c.id}/payments`, { amount: 10 });
  await req("DELETE", `/credits/${c.id}`);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM personal_credit_payments WHERE credit_id=?").get(c.id).n, 0);
});

// --- a tela ------------------------------------------------------------------------

const ler_ = (p) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), p), "utf8");

test("os dois ícones estão na linha, e só em conta não quitada", () => {
  const tela = ler_("../../client/src/pages/MinhasFinancas.jsx");
  assert.match(tela, /!e\.paid && !e\.da_perspectiva && \(/,
    "lançar juros numa conta paga não quer dizer nada; a da Perspectiva vive no Financeiro");
  assert.match(tela, /Pagar um pedaço: dá baixa no valor que você colocar/);
  assert.match(tela, /Acréscimo: entra no valor da conta como juros/);
  assert.match(tela, /<Dialog open=\{Boolean\(caixa\)\}/);
});

test("a linha mostra o que já foi pago e o que é juro", () => {
  const tela = ler_("../../client/src/pages/MinhasFinancas.jsx");
  assert.match(tela, /pago \$\{currency\(e\.pago_parcial\)\} de \$\{currency\(e\.amount\)\}/);
  assert.match(tela, /\$\{currency\(e\.juros\)\} de juros/);
});

test("o cartão é UM só, com as palavras de cada lado", () => {
  // Duas cópias de 165 linhas iam divergir no primeiro conserto feito num lado
  // e esquecido no outro.
  const card = ler_("../../client/src/components/DebtsCard.jsx");
  assert.match(card, /const LADOS = \{/);
  assert.match(card, /Quem me deve — e pelo quê/);
  assert.match(card, /rota: "credits"/);
  assert.match(card, /export default function DebtsCard\(\{ lado = "devo" \}\)/);
  const tela = ler_("../../client/src/pages/MinhasFinancas.jsx");
  assert.match(tela, /<DebtsCard lado="medevem" \/>/);
});

// --- o botão de confirmar no seletor da galeria -------------------------------------
//
// "Tem que ter um botão de continuar ou selecionar, algo pra confirmar, depois
// que eu seleciono qual imagem quero vincular ao post."
//
// A confusão era nossa: CLICAR no cartão já vinculava e fechava, enquanto os
// checkboxes serviam só para apagar/mover. Dois mecanismos com a mesma cara —
// ela marcava quatro, lia "4 marcados" e não achava como dizer "usa essas",
// porque o rodapé só tinha "Fechar".

test("marcar passa a servir para vincular, e há onde confirmar", () => {
  const tela = ler_("../../client/src/pages/Distribution.jsx");
  assert.match(tela, /function usarMarcados\(\) \{/);
  assert.match(tela, /onPick\(marcados\[0\], umSo \? null : marcados\);/,
    "quem aceita vários recebe a lista inteira, como no clique de um post unido");
  // Em cima (junto da contagem) E no rodapé, que é onde ela foi procurar.
  assert.ok(tela.split(/Usar \$\{?/).length - 1 >= 2 || /Usar \{umSo/.test(tela),
    "o botão aparece nos dois lugares");
  assert.match(tela, /Marque no quadradinho e confirme, ou clique direto numa arte\./,
    "e o rodapé explica os dois caminhos, em vez de só 'Fechar'");
});

test("a capa do perfil aceita UMA — marcar várias ali não quer dizer nada", () => {
  const tela = ler_("../../client/src/pages/Distribution.jsx");
  assert.match(tela, /onPick=\{setCover\} umSo titulo="Escolher a capa do perfil \(uma foto\)"/);
});
