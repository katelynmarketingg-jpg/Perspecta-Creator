// O briefing: o cliente responde por um link, sem conta, e as respostas viram
// a inteligência da IA daquele cliente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-brief-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { PERGUNTAS, BRIEFING, progresso, faltando, respostasParaPersona } = await import("../src/briefing.js");
const { PERSONA_FIELDS } = await import("../src/ai.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const briefingsRoutes = (await import("../src/routes/briefings.js")).default;
const { briefingPublicRouter } = await import("../src/routes/briefing-public.js");

const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES ('Agência', 0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,email,password_hash,role,active,org_id) VALUES ('K','k@x.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cliente = db.prepare(
  "INSERT INTO clients (name,status,ai_persona,org_id) VALUES ('Silva','active',?,?)"
).run(JSON.stringify({ tone: "escrito pela equipe" }), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/briefing", briefingPublicRouter);
app.use("/api/briefings", briefingsRoutes);
const servidor = app.listen(0);
await new Promise((r) => servidor.once("listening", r));
const B = `http://127.0.0.1:${servidor.address().port}/api`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: uid, org_id: org, role: "admin" }, JWT_SECRET)}` };
const J = { "content-type": "application/json" };
const req = (m, u, corpo, cab) => fetch(B + u, {
  method: m, headers: cab || J, body: corpo ? JSON.stringify(corpo) : undefined,
}).then(async (r) => ({ st: r.status, ...(await r.json().catch(() => ({}))) }));

const criado = await req("POST", "/briefings", { client_id: cliente }, H);

test("todo campo que uma pergunta preenche existe no perfil da IA", () => {
  const aceitos = new Set(PERSONA_FIELDS.map((f) => f.key));
  for (const p of PERGUNTAS) {
    if (p.campo) assert.ok(aceitos.has(p.campo), `a pergunta "${p.id}" aponta para o campo inexistente "${p.campo}"`);
  }
});

test("nenhuma pergunta tem id repetido (uma sobrescreveria a outra)", () => {
  const ids = PERGUNTAS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(BRIEFING.length >= 5, "o briefing precisa ser completo o bastante");
});

test("gerar o link duas vezes devolve o MESMO link", async () => {
  const outra = await req("POST", "/briefings", { client_id: cliente }, H);
  assert.equal(outra.token, criado.token);
  assert.match(criado.url, /\/briefing\//);
});

test("o cliente abre sem login e vê a marca da agência e o nome dele", async () => {
  const r = await req("GET", `/briefing/${criado.token}`);
  assert.equal(r.st, 200);
  assert.equal(r.client_name, "Silva");
  assert.equal(r.agency_name, "Agência");
  assert.equal(r.secoes.length, BRIEFING.length);
  // A logo vai junto: a página é aberta por quem não tem conta e não pode
  // buscar a marca pelas rotas da equipe.
  assert.ok("agency_logo" in r, "a logo precisa vir na resposta pública");
});

test("o que o cliente escreve fica salvo — ele pode fechar e voltar", async () => {
  await req("PUT", `/briefing/${criado.token}`, { respostas: { nome: "Silva Advogados" } });
  const volta = await req("GET", `/briefing/${criado.token}`);
  assert.equal(volta.respostas.nome, "Silva Advogados");
  assert.ok(volta.progresso > 0);
});

test("pergunta inventada não grava e resposta gigante é cortada", async () => {
  await req("PUT", `/briefing/${criado.token}`, { respostas: { extra: "x".repeat(99999), inventada: "lixo" } });
  const r = await req("GET", `/briefing/${criado.token}`);
  assert.equal(r.respostas.inventada, undefined);
  assert.equal(r.respostas.extra.length, 4000);
});

test("não dá para enviar sem as perguntas obrigatórias", async () => {
  const r = await req("POST", `/briefing/${criado.token}/enviar`);
  assert.equal(r.st, 400);
  assert.ok(r.faltando.length > 0);
});

test("link inventado não abre", async () => {
  assert.equal((await req("GET", "/briefing/nao-existe")).st, 404);
  assert.equal((await req("PUT", "/briefing/nao-existe", { respostas: {} })).st, 404);
});

test("enviado o briefing, a equipe é avisada", async () => {
  const tudo = {};
  for (const p of PERGUNTAS) tudo[p.id] = p.tipo === "escolhas" ? p.opcoes[0] : `resposta de ${p.id}`;
  tudo.cliente_ideal = "empresários donos de indústria";
  await req("PUT", `/briefing/${criado.token}`, { respostas: tudo });
  assert.deepEqual(faltando(BRIEFING, tudo), []);
  assert.equal(progresso(BRIEFING, tudo), 100);

  const env = await req("POST", `/briefing/${criado.token}/enviar`);
  assert.equal(env.st, 200);
  const aviso = db.prepare("SELECT message FROM notifications WHERE org_id = ? ORDER BY id DESC LIMIT 1").get(org);
  assert.match(aviso.message, /respondeu o briefing/);
});

test("aplicar preenche a inteligência SEM apagar o que a equipe escreveu", async () => {
  const r = await req("POST", `/briefings/${criado.id}/aplicar`, {}, H);
  assert.equal(r.st, 200);
  const persona = JSON.parse(db.prepare("SELECT ai_persona FROM clients WHERE id = ?").get(cliente).ai_persona);
  assert.equal(persona.tone, "escrito pela equipe", "o tom da equipe não podia ser trocado");
  assert.equal(persona.audience, "empresários donos de indústria");
  assert.ok(r.campos.length >= 10, `preencheu só ${r.campos.length} campos`);
});

test("com 'sobrescrever', o briefing manda", async () => {
  await req("POST", `/briefings/${criado.id}/aplicar`, { sobrescrever: true }, H);
  const persona = JSON.parse(db.prepare("SELECT ai_persona FROM clients WHERE id = ?").get(cliente).ai_persona);
  assert.notEqual(persona.tone, "escrito pela equipe");
});

test("duas perguntas no mesmo campo se somam, não se apagam", () => {
  const p = respostasParaPersona(BRIEFING, { resumo: "fazemos A", servicos: "vendemos B" });
  assert.match(p.services, /fazemos A/);
  assert.match(p.services, /vendemos B/);
});

test("briefing de outro escritório não é acessível", async () => {
  const outraOrg = db.prepare("INSERT INTO organizations (name, is_master) VALUES ('Outra', 0)").run().lastInsertRowid;
  const outroUid = db.prepare(
    "INSERT INTO users (name,email,password_hash,role,active,org_id) VALUES ('X','x@y.com',?,'admin',1,?)"
  ).run(hashPassword("x"), outraOrg).lastInsertRowid;
  const cab = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: outroUid, org_id: outraOrg, role: "admin" }, JWT_SECRET)}` };
  assert.equal((await req("GET", `/briefings/${criado.id}`, null, cab)).st, 404);
  assert.equal((await req("POST", `/briefings/${criado.id}/aplicar`, {}, cab)).st, 404);
  servidor.close();
});
