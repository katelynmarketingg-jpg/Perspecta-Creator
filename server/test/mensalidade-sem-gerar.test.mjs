// "ESSE NEGÓCIO DE GERAR MENSALIDADES NEM PRECISA."
//
// Palavras dela: "já pode aparecer tudo ali, eu marco quando a pessoa pagar,
// mas ja fica a previsão, quero que tenha como marcar pago parcialmente e eu
// coloco o valor".
//
// A previsão NÃO é gravada ao abrir a tela. Se fosse, uma mensalidade apagada
// voltaria sozinha na visita seguinte e não haveria como entender por quê. Ela
// é calculada com a mesma regra do gerador e vira lançamento de verdade no
// instante em que alguém mexe na linha.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-mensalidade-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const financeiro = (await import("../src/routes/financial.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Mensalidade',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katy','Katy','k@mens.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;

const servico = db.prepare("INSERT INTO services (org_id,name) VALUES (?, 'Social media')").run(org).lastInsertRowid;

function cliente(nome, valor, dia, extra = {}) {
  const id = db.prepare(
    "INSERT INTO clients (org_id,name,status,billing_type,payment_day,archived_at,pagamento_ate) VALUES (?,?,?,?,?,?,?)"
  ).run(org, nome, extra.status || "active", extra.billing_type || "pagante", dia,
    extra.archived_at || null, extra.pagamento_ate || null).lastInsertRowid;
  if (valor > 0) db.prepare("INSERT INTO client_services (client_id,service_id,price) VALUES (?,?,?)").run(id, servico, valor);
  return id;
}

const vonId = cliente("Von Haus", 1500, 10);
cliente("Permuta Café", 900, 5, { billing_type: "permuta" });

const app = express();
app.use(express.json());
app.use("/api/financial", financeiro);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/financial`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

const MES = { from: "2026-11-01", to: "2026-11-30" };
const q = (extra = {}) => new URLSearchParams({ ...MES, ...extra }).toString();
const lancadas = () => db.prepare("SELECT COUNT(*) n FROM financial_entries WHERE org_id=?").get(org).n;

test("a mensalidade aparece sozinha, sem ninguém clicar em gerar", async () => {
  const r = await fetch(`${B}?${q({ previstas: 1 })}`, { headers: H });
  const linhas = await r.json();
  const von = linhas.find((l) => l.client_id === vonId);
  assert.ok(von, "a mensalidade da Von Haus tinha que aparecer");
  assert.equal(von.previsto, true);
  assert.equal(von.amount, 1500);
  assert.equal(von.due_date, "2026-11-10", "no dia de pagamento cadastrado");
  assert.equal(von.status, "pending");
  // Quem não é pagante continua de fora — é a mesma regra do gerador.
  assert.ok(!linhas.some((l) => l.client_name === "Permuta Café"), "permuta não gera mensalidade");
});

test("ver a tela não grava nada", () => {
  assert.equal(lancadas(), 0,
    "a previsão virou lançamento só de abrir — assim uma conta apagada voltaria sozinha");
});

test("quem não pede previsão continua vendo só o que está gravado", async () => {
  const r = await fetch(`${B}?${q()}`, { headers: H });
  assert.deepEqual(await r.json(), []);
});

test("os balões somam o mesmo que a tabela mostra", async () => {
  const r = await fetch(`${B}/summary?${q({ previstas: 1 })}`, { headers: H });
  const s = await r.json();
  assert.equal(s.income, 1500, "sem isso a lista mostra 1.500 e a soma mostra zero");
  assert.equal(s.pending, 1500);
  assert.equal(s.previsto, 1500);
  assert.equal(s.previstas, 1);
});

test("o 'vai sobrar' do mês conta a mensalidade prevista", async () => {
  const r = await fetch(`${B}/projecao?month=2026-11`, { headers: H });
  const p = await r.json();
  assert.equal(p.mensalidades_previstas, 1500);
  assert.equal(p.a_receber, 1500);
});

test("mexer na linha é o que cria o lançamento — e duas vezes não duplica", async () => {
  const r = await fetch(`${B}/mensalidade`, {
    method: "POST", headers: H, body: JSON.stringify({ client_id: vonId, month: "2026-11" }) });
  assert.equal(r.status, 201);
  const criada = await r.json();
  assert.equal(criada.amount, 1500);
  assert.equal(criada.category, "Mensalidade");
  assert.equal(criada.due_date, "2026-11-10");
  assert.equal(lancadas(), 1);

  const outra = await fetch(`${B}/mensalidade`, {
    method: "POST", headers: H, body: JSON.stringify({ client_id: vonId, month: "2026-11" }) });
  assert.equal((await outra.json()).id, criada.id, "o segundo clique devolve a mesma, não cria outra");
  assert.equal(lancadas(), 1);

  // E agora ela sai da previsão: senão apareceria duas vezes na tela.
  const lista = await (await fetch(`${B}?${q({ previstas: 1 })}`, { headers: H })).json();
  assert.equal(lista.filter((l) => l.client_id === vonId).length, 1);
  assert.ok(!lista.find((l) => l.client_id === vonId).previsto);
});

test("pagar um pedaço da mensalidade", async () => {
  const atual = db.prepare("SELECT id FROM financial_entries WHERE org_id=? LIMIT 1").get(org);
  const r = await fetch(`${B}/${atual.id}`, {
    method: "PUT", headers: H, body: JSON.stringify({ pay: 500 }) });
  const linha = await r.json();
  assert.equal(linha.status, "partial");
  assert.equal(linha.paid_amount, 500);

  const s = await (await fetch(`${B}/summary?${q({ previstas: 1 })}`, { headers: H })).json();
  assert.equal(s.pending, 1000, "o que falta é o que ainda não entrou");
});

test("cliente que não tem mensalidade no mês diz por quê", async () => {
  const permuta = db.prepare("SELECT id FROM clients WHERE name='Permuta Café'").get().id;
  const r = await fetch(`${B}/mensalidade`, {
    method: "POST", headers: H, body: JSON.stringify({ client_id: permuta, month: "2026-11" }) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /não é cliente pagante/);
});

// O PEDAÇO JÁ PAGO CONTA DOS DOIS LADOS NA PROJEÇÃO.
//
// Antes, uma conta paga pela metade entrava INTEIRA em "a receber" e o pedaço
// recebido não aparecia em "entrou": o balão dizia um número e o "vai sobrar"
// dizia outro para a mesma pergunta. Com a mensalidade podendo ser paga aos
// poucos — que é o que ela pediu — isso apareceria todo mês.
test("na projeção, a conta paga pela metade conta metade de cada lado", async () => {
  const p = await (await fetch(`${B}/projecao?month=2026-11`, { headers: H })).json();
  assert.equal(p.entrou, 500, "os R$ 500 que já entraram têm que aparecer");
  // Falta receber: os 1.000 da Von Haus + as outras mensalidades previstas.
  assert.equal(p.a_receber, 1000 + p.mensalidades_previstas);
});
