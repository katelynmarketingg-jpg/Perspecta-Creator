// IMPAGÁVEIS — "não vou conseguir pagar tudo este mês".
//
// Quando o mês aperta, a pergunta deixa de ser "quanto eu devo" e passa a ser
// "quanto disso eu consigo pagar agora". Marcar o que é impagável separa o que
// vai ficar para trás do que ainda dá para honrar — e os dois números que
// importam são: quanto falta pagar NO GERAL e quanto falta DOS IMPAGÁVEIS.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-impag-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const financeiro = (await import("../src/routes/financial.js")).default;
const pessoais = (await import("../src/routes/personal-finance.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Aperto',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katy','Katy','k@imp.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/financial", financeiro);
app.use("/api/personal-finance", pessoais);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const raiz = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

// ---- lado da EMPRESA (Financeiro) -----------------------------------------
async function despesa(desc, valor, status = "pending") {
  const r = await fetch(`${raiz}/financial`, { method: "POST", headers: H, body: JSON.stringify({
    type: "expense", description: desc, amount: valor, status, due_date: "2026-09-15" }) });
  return (await r.json());
}
const marcar = (id, v) => fetch(`${raiz}/financial/${id}/impagavel`, {
  method: "PUT", headers: H, body: JSON.stringify({ impagavel: v }) });
const resumo = () => fetch(`${raiz}/financial/summary?from=2026-09-01&to=2026-09-30`, { headers: H }).then((r) => r.json());
const listar = (q = "") => fetch(`${raiz}/financial?from=2026-09-01&to=2026-09-30${q}`, { headers: H }).then((r) => r.json());

test("marcar e desmarcar impagável é um clique, sem abrir a ficha", async () => {
  const d = await despesa("Aluguel da sala", 1800);
  const r = await marcar(d.id, true);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).impagavel, true);

  const lista = await listar();
  assert.equal(lista.find((x) => x.id === d.id).impagavel, 1);

  await marcar(d.id, false);
  assert.equal((await listar()).find((x) => x.id === d.id).impagavel, 0);
});

test("o botão 'só impagáveis' mostra só eles — e o resto fica separado", async () => {
  const a = await despesa("Energia", 400);
  const b = await despesa("Internet", 150);
  await despesa("Contador", 600);
  await marcar(a.id, true);
  await marcar(b.id, true);

  const so = await listar("&impagavel=1");
  assert.deepEqual(so.map((x) => x.description).sort(), ["Energia", "Internet"]);

  const oResto = await listar("&impagavel=0");
  assert.ok(oResto.some((x) => x.description === "Contador"));
  assert.ok(!oResto.some((x) => x.description === "Energia"), "impagável não aparece no outro balão");

  const tudo = await listar();
  assert.equal(tudo.length, so.length + oResto.length, "os dois balões somam o total, sem sobrar nem faltar");
});

test("o resumo diz quanto foi marcado E quanto disso ainda está em aberto", async () => {
  const paga = await despesa("Software já pago", 300, "paid");
  await marcar(paga.id, true);
  const s = await resumo();
  // Energia 400 + Internet 150 + Software 300 = 850 marcados
  assert.equal(s.impagavelTotal, 850, `deu ${s.impagavelTotal}`);
  // mas o software já foi pago: em aberto são 550
  assert.equal(s.impagavelAberto, 550, `deu ${s.impagavelAberto}`);
});

// ---- lado DELA (Minhas Finanças) -------------------------------------------
const gasto = (nome, valor, extra = {}) => fetch(`${raiz}/personal-finance`, {
  method: "POST", headers: H, body: JSON.stringify({ ym: "2026-09", name: nome, amount: valor, ...extra }),
}).then((r) => r.json());
const pessoal = () => fetch(`${raiz}/personal-finance?ym=2026-09`, { headers: H }).then((r) => r.json());

test("nas finanças dela, os dois números aparecem lado a lado", async () => {
  const luz = await gasto("Luz de casa", 220);
  const cartao = await gasto("Fatura do cartão", 900);
  await gasto("Mercado", 500, { paid: true });

  await fetch(`${raiz}/personal-finance/${luz.id}`, { method: "PUT", headers: H,
    body: JSON.stringify({ impagavel: true }) });
  await fetch(`${raiz}/personal-finance/${cartao.id}`, { method: "PUT", headers: H,
    body: JSON.stringify({ impagavel: true }) });

  const { summary, entries } = await pessoal();
  assert.equal(summary.total, 1620, "o mês inteiro");
  assert.equal(summary.aPagar, 1120, "o que falta pagar no geral");
  assert.equal(summary.impagavelTotal, 1120, "o que foi marcado como impagável");
  assert.equal(summary.impagavelAPagar, 1120, "e desses, o que ainda falta");
  assert.equal(summary.impagavelQuantos, 2);
  assert.equal(entries.find((e) => e.name === "Luz de casa").impagavel, true, "volta como sim/não, não como 1/0");
});

test("pagar um impagável tira ele do que falta, sem tirar a marca", async () => {
  const { entries } = await pessoal();
  const luz = entries.find((e) => e.name === "Luz de casa");
  await fetch(`${raiz}/personal-finance/${luz.id}`, { method: "PUT", headers: H, body: JSON.stringify({ paid: true }) });

  const { summary } = await pessoal();
  assert.equal(summary.impagavelTotal, 1120, "continua marcado — ela quis lembrar que era apertado");
  assert.equal(summary.impagavelAPagar, 900, "mas já não falta pagar");
});

test("gasto da empresa marcado como impagável chega no Financeiro já marcado", async () => {
  const conta = await gasto("Tráfego pago", 700, { category: "Casa" });
  await fetch(`${raiz}/personal-finance/${conta.id}`, { method: "PUT", headers: H,
    body: JSON.stringify({ impagavel: true }) });
  await fetch(`${raiz}/personal-finance/${conta.id}`, { method: "PUT", headers: H,
    body: JSON.stringify({ category: "Perspectiva" }) });

  const linha = db.prepare("SELECT impagavel FROM financial_entries WHERE description = ?").get("Tráfego pago");
  assert.ok(linha, "a conta foi para o Financeiro");
  assert.equal(linha.impagavel, 1, "e a marca foi junto — senão ela teria que marcar de novo do outro lado");
});
