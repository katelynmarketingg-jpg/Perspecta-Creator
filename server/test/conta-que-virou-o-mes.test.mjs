// "SE EU NÃO PAGAR EM UM MÊS, TEM COMO PASSAR DIRETO PARA O OUTRO?"
//
// Não tinha. O mês era uma janela fechada em cima do vencimento: a conta de
// setembro que ela não pagou ficava em setembro para sempre e, em outubro,
// simplesmente não existia. Para lembrar dela era preciso voltar o mês — ou
// seja, lembrar sozinha de uma coisa que o sistema já sabia.
//
// E mais duas coisas que ela pediu junto:
//   · "o que tá em vermelho é de mês anterior" — por isso cada linha diz DE
//     QUE MÊS veio, e o tópico (Riachuelo) soma quanto do "em aberto" é atraso;
//   · "do ladinho um botãozinho de + que abre uma caixa pra botar juros".
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-virada-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const financial = (await import("../src/routes/financial.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Virada',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@v.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
// Uma casa vizinha, para provar que o atraso de uma não vaza para a outra.
const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Vizinha',0)").run().lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/financial", financial);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/financial`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => { srv.close(); db.close(); });

const req = (m, u, corpo) => fetch(B + u, {
  method: m, headers: H, body: corpo ? JSON.stringify(corpo) : undefined,
}).then(async (r) => ({ st: r.status, corpo: await r.json().catch(() => ({})) }));

function conta({ descricao, valor = 200, vence, status = "pending", pago = 0, categoria = "Riachuelo", casa = org, tipo = "expense" }) {
  return db.prepare(
    `INSERT INTO financial_entries (type,description,amount,category,status,due_date,paid_amount,org_id)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(tipo, descricao, valor, categoria, status, vence, pago, casa).lastInsertRowid;
}

// Outubro é "o mês aberto"; setembro é o que ficou para trás.
const OUT = { from: "2026-10-01", to: "2026-10-31" };
const lista = (extra = "") => req("GET", `/?from=${OUT.from}&to=${OUT.to}${extra}`);

// --- a pergunta dela --------------------------------------------------------------

test("conta de setembro não paga APARECE em outubro", async () => {
  const setembro = conta({ descricao: "Riachuelo setembro", vence: "2026-09-10" });
  conta({ descricao: "Riachuelo outubro", vence: "2026-10-10" });

  const sem = await lista();
  assert.ok(!sem.corpo.some((r) => r.id === setembro), "sem pedir, o mês segue sendo só o mês");

  const com = await lista("&atrasados=1");
  const achada = com.corpo.find((r) => r.id === setembro);
  assert.ok(achada, "pedindo, a de setembro vem junto");
  assert.equal(achada.atrasado_de, "2026-09", "e diz de que mês veio — é o que pinta de vermelho");
  assert.equal(achada.due_date, "2026-09-10", "o vencimento NÃO é mexido: é ele que diz o tamanho do atraso");
  assert.ok(achada.dias_parada >= 21, `parada há ${achada.dias_parada} dias`);
});

test("conta de setembro JÁ PAGA não volta a aparecer", async () => {
  const paga = conta({ descricao: "Luz setembro", vence: "2026-09-05", status: "paid" });
  const r = await lista("&atrasados=1");
  assert.ok(!r.corpo.some((x) => x.id === paga), "o que foi pago ficou no mês dele");
});

test("pagamento PARCIAL continua atrasado — ainda falta", async () => {
  const meia = conta({ descricao: "Internet setembro", vence: "2026-09-08", status: "partial", pago: 50 });
  const r = await lista("&atrasados=1");
  assert.ok(r.corpo.some((x) => x.id === meia), "meio pago é dever o resto");
});

test("a conta do próprio mês NÃO vem marcada de vermelho", async () => {
  const r = await lista("&atrasados=1");
  const doMes = r.corpo.find((x) => x.description === "Riachuelo outubro");
  assert.equal(doMes.atrasado_de, null);
});

test("atraso da casa vizinha não entra aqui", async () => {
  const vizinha = conta({ descricao: "Conta da vizinha", vence: "2026-09-01", casa: outra });
  const r = await lista("&atrasados=1");
  assert.ok(!r.corpo.some((x) => x.id === vizinha), "atraso é por casa — isso não pode vazar");
});

test("as vermelhas vêm primeiro na lista", async () => {
  const r = await lista("&atrasados=1");
  const primeiraDoMes = r.corpo.findIndex((x) => !x.atrasado_de);
  const ultimaAtrasada = r.corpo.map((x, i) => (x.atrasado_de ? i : -1)).filter((i) => i >= 0).pop();
  assert.ok(ultimaAtrasada < primeiraDoMes, "o que está parado há mais tempo é o que ela precisa ver antes");
});

// --- o número bate com a tabela -----------------------------------------------------

test("os balões somam o mesmo que a lista mostra", async () => {
  const l = await lista("&atrasados=1");
  const s = await req("GET", `/summary?from=${OUT.from}&to=${OUT.to}&atrasados=1`);
  const despesasNaTela = l.corpo.filter((r) => r.type === "expense")
    .reduce((t, r) => t + Number(r.amount), 0);
  assert.equal(+s.corpo.expense.toFixed(2), +despesasNaTela.toFixed(2),
    "conferir um número contra o outro não pode dar duas verdades");
});

test("o resumo diz quanto e quantas contas ficaram para trás", async () => {
  const s = await req("GET", `/summary?from=${OUT.from}&to=${OUT.to}&atrasados=1`);
  assert.ok(s.corpo.atrasadoAnterior > 0);
  assert.ok(s.corpo.atrasadasAnteriores >= 2);
  // A parcial entra pelo que FALTA (200 − 50), não pelo valor cheio.
  assert.equal(s.corpo.atrasadoAnterior, 200 + 150);
});

// --- os juros -----------------------------------------------------------------------

test("o + lança juros: entra no valor e fica registrado", async () => {
  const id = conta({ descricao: "Riachuelo com juros", vence: "2026-09-12", valor: 200 });
  const r = await req("POST", `/${id}/juros`, { valor: "12,50" });
  assert.equal(r.st, 200);
  assert.equal(r.corpo.amount, 212.5, "vírgula vira centavo — com Number puro viraria 0");
  assert.equal(r.corpo.juros, 12.5);
});

test("juros somam a cada mês que a conta vira", async () => {
  const id = conta({ descricao: "Teima", vence: "2026-08-12", valor: 100 });
  await req("POST", `/${id}/juros`, { valor: "5" });
  const r = await req("POST", `/${id}/juros`, { valor: "5" });
  assert.equal(r.corpo.amount, 110);
  assert.equal(r.corpo.juros, 10, "dois meses, dois juros");
});

test("dá para tirar os juros e voltar ao valor de origem", async () => {
  const id = conta({ descricao: "Errei o juro", vence: "2026-09-12", valor: 300 });
  await req("POST", `/${id}/juros`, { valor: "40" });
  const r = await req("DELETE", `/${id}/juros`);
  assert.equal(r.corpo.amount, 300);
  assert.equal(r.corpo.juros, 0);
});

test("juros em conta já paga é recusado, com motivo", async () => {
  const id = conta({ descricao: "Já paguei", vence: "2026-09-12", status: "paid" });
  const r = await req("POST", `/${id}/juros`, { valor: "10" });
  assert.equal(r.st, 400);
  assert.match(r.corpo.error, /já está paga/i);
});

test("juros zerado ou sem sentido não passa", async () => {
  const id = conta({ descricao: "Zero", vence: "2026-09-12" });
  for (const valor of ["0", "", "abc", "-5"]) {
    const r = await req("POST", `/${id}/juros`, { valor });
    assert.equal(r.st, 400, `"${valor}" não podia passar`);
  }
  assert.equal(db.prepare("SELECT amount FROM financial_entries WHERE id = ?").get(id).amount, 200,
    "e o valor não foi tocado em nenhuma tentativa");
});

test("conta de outra casa não aceita juros daqui", async () => {
  const vizinha = conta({ descricao: "Da vizinha", vence: "2026-09-01", casa: outra });
  const r = await req("POST", `/${vizinha}/juros`, { valor: "10" });
  assert.equal(r.st, 404);
});

// --- o tópico (Riachuelo) ------------------------------------------------------------

const { agrupaEmTopicos } = await import("../../client/src/topicos.js");

test("o tópico soma quanto do 'em aberto' é de mês anterior", () => {
  const [g] = agrupaEmTopicos([
    { description: "Riachuelo set", category: "Riachuelo", amount: 200, status: "pending", atrasado_de: "2026-09" },
    { description: "Riachuelo out", category: "Riachuelo", amount: 150, status: "pending" },
    { description: "Riachuelo ago", category: "Riachuelo", amount: 100, status: "partial", paid_amount: 40, atrasado_de: "2026-08" },
  ]);
  assert.equal(g.aberto, 410, "total em aberto");
  assert.equal(g.atrasado, 260, "destes, 200 + (100−40) vieram de trás");
  assert.equal(g.atrasadas, 2);
});

test("sem nada atrasado, o tópico não inventa vermelho", () => {
  const [g] = agrupaEmTopicos([
    { description: "A", category: "Riachuelo", amount: 10, status: "pending" },
    { description: "B", category: "Riachuelo", amount: 20, status: "paid" },
  ]);
  assert.equal(g.atrasado, 0);
  assert.equal(g.atrasadas, 0);
});

// --- a tela ---------------------------------------------------------------------------

const tela = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/pages/Financial.jsx"), "utf8");

test("a tela pede o arrasto só no mês fechado", () => {
  assert.match(tela, /periodo === "mes" \? \{ atrasados: 1 \} : \{\}/,
    'em "Próximos 6 meses" não existe "mês anterior" que signifique alguma coisa');
});

test("linha de mês anterior fica VERMELHA, com o mês escrito", () => {
  assert.match(tela, /const atrasada = Boolean\(f\.atrasado_de\)/);
  assert.match(tela, /"& td": \{ color: "error\.main" \}/, "a linha inteira, não só um cantinho");
  assert.match(tela, /label=\{`de \$\{mesPorExtenso\(f\.atrasado_de\)\}`\}/);
});

test("o tópico fechado já mostra quanto é de mês anterior", () => {
  assert.match(tela, /g\.atrasado > 0 \? "error" : "warning"/, 'o "Falta ..." fica vermelho');
  assert.match(tela, /de meses anteriores/);
});

test('o "+" dos juros está na linha vermelha e abre a caixa', () => {
  assert.match(tela, /atrasada && f\.status !== "paid" && \(/);
  assert.match(tela, /Lançar juros nesta conta/);
  assert.match(tela, /<Dialog open=\{Boolean\(juros\)\}/);
  assert.match(tela, /label="Juros \(R\$\)"/);
});
