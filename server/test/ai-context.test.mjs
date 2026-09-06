// O que a IA recebe (e o que NÃO recebe) em cada geração, e como os erros do
// provedor chegam para quem está usando.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-ai-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const {
  personaSystem, temasRecentes, traduzErroProvedor, limpaChave,
  getAiConfig, saveAiConfig, CONTEXT_BUDGET, PERSONA_FIELDS,
} = await import("../src/ai.js");

const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES ('IA', 0)").run().lastInsertRowid;

// Perfil com TODOS os campos preenchidos — o caso em que mandar tudo seria caro.
const perfil = Object.fromEntries(PERSONA_FIELDS.map((f) => [f.key, `${f.label} do cliente `.repeat(12)]));
const cliente = { id: 1, name: "Silva", company: "Silva Advogados", segment: "Advocacia" };

test("a legenda não recebe o perfil inteiro — só o que muda a legenda", () => {
  const sys = personaSystem(cliente, perfil, "caption");
  assert.ok(sys.includes("Tom:"), "o tom de voz é essencial e tem que ir");
  assert.ok(sys.includes("Público:"));
  // Segmento/serviços/diferenciais não mudam uma legenda: ficam de fora.
  assert.ok(!sys.includes("Serviços:"), "serviços não pertencem à legenda");
  assert.ok(!sys.includes("Diferenciais:"), "diferenciais não pertencem à legenda");
});

test("ideias recebem os campos de estratégia, não os de escrita", () => {
  const sys = personaSystem(cliente, perfil, "ideas");
  assert.ok(sys.includes("Pilares:"));
  assert.ok(sys.includes("Serviços:"));
  assert.ok(!sys.includes("CTA preferido:"), "o CTA é para a hora de escrever");
});

test("o contexto respeita o orçamento da tarefa (legenda < planejamento)", () => {
  const legenda = personaSystem(cliente, perfil, "caption");
  const plano = personaSystem(cliente, perfil, "plan");
  const estrategia = personaSystem(cliente, perfil, "strategy");
  // Cada um cabe no seu teto (mais o prefixo fixo da plataforma, ~155 ch).
  assert.ok(legenda.length < CONTEXT_BUDGET.fast + 400, `legenda ${legenda.length}`);
  assert.ok(plano.length < CONTEXT_BUDGET.standard + 400, `plano ${plano.length}`);
  assert.ok(legenda.length < plano.length, "legenda tem que ser mais enxuta que o plano");
  assert.ok(plano.length <= estrategia.length, "estratégia pode levar mais contexto");
});

test("a memória entra quando existe, e cabe no orçamento", () => {
  const com = personaSystem(cliente, { tone: "seco" }, "caption", "prefere legendas curtas; poucos emojis");
  const sem = personaSystem(cliente, { tone: "seco" }, "caption", null);
  assert.ok(com.includes("Preferências já combinadas:"));
  assert.ok(!sem.includes("Preferências já combinadas:"));
});

test("um campo escrito à vontade não estoura o prompt", () => {
  const sys = personaSystem(cliente, { tone: "x".repeat(5000) }, "caption");
  assert.ok(sys.length < CONTEXT_BUDGET.fast + 400, `ficou com ${sys.length} caracteres`);
  assert.ok(sys.includes("…"), "o campo longo foi aparado, não jogado fora");
});

test("para não repetir assunto vão só os TÍTULOS, nunca os posts inteiros", () => {
  const cli = db.prepare("INSERT INTO clients (name, status, org_id) VALUES ('Silva','active',?)").run(org).lastInsertRowid;
  const etapa = db.prepare("INSERT INTO kanban_stages (name, position, org_id) VALUES ('Feito',1,?)").run(org).lastInsertRowid;
  const textao = "corpo enorme do post ".repeat(200);
  for (let i = 1; i <= 40; i++) {
    db.prepare(
      "INSERT INTO tasks (title, description, client_id, stage_id, scheduled_at, org_id) VALUES (?,?,?,?,date('now',?),?)"
    ).run(`Assunto ${i}`, textao, cli, etapa, `-${i} days`, org);
  }
  const temas = temasRecentes(org, cli, { dias: 60, max: 20 });
  assert.equal(temas.length, 20, "traz no máximo o que foi pedido");
  assert.ok(temas.every((t) => !t.includes("corpo enorme")), "nenhum texto de post foi junto");
  assert.ok(temas.join("; ").length < 1000, "o bloco inteiro tem teto");
});

test("post fora da janela de dias não entra", () => {
  const cli = db.prepare("INSERT INTO clients (name, status, org_id) VALUES ('Antigo','active',?)").run(org).lastInsertRowid;
  db.prepare("INSERT INTO tasks (title, client_id, scheduled_at, org_id) VALUES ('Velho', ?, date('now','-200 days'), ?)").run(cli, org);
  assert.deepEqual(temasRecentes(org, cli, { dias: 60 }), []);
});

test("a chave colada com espaço, aspas ou quebra de linha é limpa", () => {
  assert.equal(limpaChave('  "sk-proj-ABC"\n'), "sk-proj-ABC");
  assert.equal(limpaChave("sk-proj\n-ABC"), "sk-proj-ABC");   // \n no meio impediria o pedido de sair
  assert.equal(limpaChave("   "), null);
});

test("chave que não pode mais ser lida não passa por configurada", () => {
  saveAiConfig(org, { provider: "openai", api_key: "sk-teste" });
  assert.equal(getAiConfig(org).configured, true);
  db.prepare("UPDATE org_ai SET api_key = 'lixo:que:nao:decifra' WHERE org_id = ?").run(org);
  const cfg = getAiConfig(org);
  assert.equal(cfg.configured, false, "não pode dizer que está ligada");
  assert.equal(cfg.key_unreadable, true, "e tem que dizer por quê");
});

test("os erros do provedor viram frases que apontam o conserto", () => {
  const semCredito = traduzErroProvedor(429, { error: { type: "insufficient_quota", message: "You exceeded your current quota" } });
  assert.equal(semCredito.code, "SEM_CREDITO");
  assert.match(semCredito.message, /créditos/);
  assert.match(semCredito.message, /ChatGPT Plus/, "a confusão mais comum tem que ser desfeita");

  assert.equal(traduzErroProvedor(401, { error: { code: "invalid_api_key" } }).code, "CHAVE_INVALIDA");
  // Mensagem real da OpenAI quando a conta não tem acesso ao modelo:
  assert.equal(
    traduzErroProvedor(404, { error: { message: "The model `gpt-4o` does not exist or you do not have access to it." } }).code,
    "SEM_ACESSO_MODELO");
  // 404 sem explicação vira "o modelo configurado não existe".
  assert.equal(traduzErroProvedor(404, {}).code, "MODELO_INEXISTENTE");
  assert.equal(traduzErroProvedor(500, {}).code, "PROVEDOR_FORA");
  // Seja qual for o status, a frase que aparece é NOSSA — a do provedor nunca
  // é repetida crua na tela (ela fica só em `raw`, para o log).
  const cru = "Something went terribly wrong on our side, please retry.";
  for (const st of [400, 401, 403, 404, 429, 500, 503]) {
    const t = traduzErroProvedor(st, { error: { message: cru } });
    assert.ok(t.message.length > 20, `status ${st} sem mensagem`);
    // A frase SEMPRE começa com a nossa explicação. Quando o erro é
    // desconhecido o texto do provedor pode vir depois (ajuda a diagnosticar),
    // mas nunca sozinho e nunca na frente.
    const ondeEstaOCru = t.message.indexOf(cru);
    assert.ok(ondeEstaOCru === -1 || ondeEstaOCru > 20,
      `status ${st} jogou o texto do provedor na frente: ${t.message}`);
    assert.equal(t.raw, cru, "o texto original fica guardado para diagnóstico");
  }
});
