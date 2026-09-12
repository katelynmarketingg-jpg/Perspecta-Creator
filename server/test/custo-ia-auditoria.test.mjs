// AUDITORIA DO CUSTO DA IA.
//
// O que interessa aqui é dinheiro saindo da conta dela sem ela ver. As
// perguntas: o limite mensal BARRA de verdade, ou só avisa depois que gastou?
// O gasto de um escritório pode estourar o limite de outro? Chamada que falhou
// cobra? Prompt gigante vai para a API assim mesmo?
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-custo-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { askAi, getBudget, saveBudget, saveAiConfig } = await import("../src/ai.js");

function casa(nome) {
  const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES (?, 0)").run(nome).lastInsertRowid;
  saveAiConfig(org, { provider: "openai", api_key: "sk-teste-nao-usada", model: null });
  return org;
}
const mes = () => new Date().toISOString().slice(0, 7);
function jaGastou(org, brl) {
  db.prepare(
    `INSERT INTO ai_usage_month (org_id, ym, calls, tokens_in, tokens_out, cost_brl, updated_at)
     VALUES (?, ?, 1, 0, 0, ?, datetime('now'))
     ON CONFLICT(org_id, ym) DO UPDATE SET cost_brl = excluded.cost_brl`
  ).run(org, mes(), brl);
}
async function tenta(org, texto = "oi") {
  try { await askAi(org, { system: "s", user: texto, feature: "teste" }); return { ok: true }; }
  catch (e) { return { ok: false, code: e.code, msg: e.message }; }
}

test("estourado o limite do mês, a chamada NÃO chega no provedor", async () => {
  const org = casa("Casa Estourada");
  saveBudget(org, { warn1: 50, warn2: 75, limit: 100 });
  jaGastou(org, 100);
  const r = await tenta(org);
  assert.equal(r.ok, false);
  assert.equal(r.code, "BUDGET", `barrou por outro motivo: ${r.code} — ${r.msg}`);
  assert.match(r.msg, /limite de R\$ 100,00|limite de R\$ 100\.00/);
});

test("abaixo do limite, a trava de gasto não atrapalha", async () => {
  const org = casa("Casa Folgada");
  saveBudget(org, { warn1: 50, warn2: 75, limit: 100 });
  jaGastou(org, 99.99);
  const r = await tenta(org);
  assert.notEqual(r.code, "BUDGET", "ainda não bateu o limite: não pode barrar");
});

test("o gasto de um escritório não tranca o outro", async () => {
  const gastadora = casa("Casa Gastadora");
  const vizinha = casa("Casa Vizinha");
  saveBudget(gastadora, { warn1: 50, warn2: 75, limit: 100 });
  saveBudget(vizinha, { warn1: 50, warn2: 75, limit: 100 });
  jaGastou(gastadora, 500);
  assert.equal((await tenta(gastadora)).code, "BUDGET");
  assert.notEqual((await tenta(vizinha)).code, "BUDGET", "o gasto de uma não pode trancar a outra");
  assert.equal(getBudget(vizinha).spent, 0);
});

test("prompt gigante é barrado ANTES de virar custo", async () => {
  const org = casa("Casa do Textão");
  saveBudget(org, { warn1: 50, warn2: 75, limit: 1000 });
  const r = await tenta(org, "x".repeat(30000));
  assert.equal(r.code, "TOO_BIG", `${r.code} — ${r.msg}`);
});

test("sem chave configurada, avisa em português em vez de chamar", async () => {
  const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES ('Casa Sem Chave', 0)").run().lastInsertRowid;
  const r = await tenta(org);
  assert.equal(r.code, "NO_KEY");
  assert.match(r.msg, /chave/i);
});

test("chamada que falhou não entra no gasto do mês", () => {
  const org = casa("Casa da Falha");
  const antes = getBudget(org).spent;
  db.prepare(
    `INSERT INTO ai_calls (org_id, feature, model, tokens_in, tokens_out, cost_brl, ok, error)
     VALUES (?, 'teste', 'gpt-x', 1000, 1000, 5.0, 0, 'deu erro')`
  ).run(org);
  assert.equal(getBudget(org).spent, antes, "erro do provedor não pode virar conta para ela pagar");
});

test("limite zero significa sem teto — não significa tudo barrado", async () => {
  const org = casa("Casa Sem Teto");
  saveBudget(org, { warn1: 0, warn2: 0, limit: 0 });
  jaGastou(org, 9999);
  const r = await tenta(org);
  assert.notEqual(r.code, "BUDGET", "limite 0 é 'sem limite'; barrar tudo travaria a IA inteira");
});

test("o limite guardado é o que ela digitou, e negativo não passa", () => {
  const org = casa("Casa do Limite");
  assert.equal(saveBudget(org, { warn1: 20, warn2: 40, limit: 60 }).limit, 60);
  assert.equal(saveBudget(org, { warn1: -5, warn2: -5, limit: -100 }).limit, 0);
});
