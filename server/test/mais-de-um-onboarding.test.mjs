// "QUERO QUE EU POSSA CRIAR MAIS DE UM FORMULÁRIO POR CLIENTE, NÃO TEM QUE
//  APARECER QUE JÁ RECEBEMOS A RESPOSTA, SE EU FIZ OUTRO LINK TEM QUE ABRIR E
//  TEM QUE DAR PRA RESPONDER."
//
// O mesmo cliente volta — agora para uma landing page, depois de já ter
// respondido o onboarding do social. Ela abria o segundo onboarding, o sistema
// devolvia o link VELHO (qualquer briefing que não estivesse aplicado ou
// encerrado era reaproveitado, inclusive o já respondido), e o cliente caía
// numa tela escrita "Recebemos. Obrigado!", sem um campo sequer. O segundo
// trabalho não tinha como começar.
//
// Agora só se reaproveita o link que está de pé, em branco e com as mesmas
// perguntas. O resto nasce link novo — e o antigo continua inteiro, com as
// respostas que o cliente já deu.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-dois-onb-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const briefingsRoutes = (await import("../src/routes/briefings.js")).default;
const { briefingPublicRouter } = await import("../src/routes/briefing-public.js");
const { BRIEFING, perguntasDe } = await import("../src/briefing.js");

// Uma pergunta de verdade do formulário padrão: o salvamento só aceita id que exista.
const PERGUNTA = perguntasDe(BRIEFING)[0].id;

const org = db.prepare(
  "INSERT INTO organizations (name, is_master) VALUES ('Perspectiva Dois Onboardings', 0)"
).run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@dois.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/briefing", briefingPublicRouter);
app.use("/api/briefings", briefingsRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
const J = { "content-type": "application/json" };
after(() => srv.close());

const req = (m, u, corpo, cab) => fetch(B + u, {
  method: m, headers: cab || J, body: corpo ? JSON.stringify(corpo) : undefined,
}).then(async (r) => ({ st: r.status, ...(await r.json().catch(() => ({}))) }));

const novoCliente = (nome) =>
  db.prepare("INSERT INTO clients (name,status,org_id) VALUES (?, 'active', ?)").run(nome, org).lastInsertRowid;

/** O que o cliente fez: respondeu e mandou. (A rota pública já é testada à parte.) */
const marcaRespondido = (id) =>
  db.prepare("UPDATE briefings SET status = 'respondido', answered_at = datetime('now') WHERE id = ?").run(id);

const token = (id) => db.prepare("SELECT token FROM briefings WHERE id = ?").get(id).token;

test("clicar duas vezes não espalha dois links para a mesma pessoa", async () => {
  const cli = novoCliente("Clínica do clique duplo");
  const a = await req("POST", "/briefings", { client_id: cli }, H);
  const b = await req("POST", "/briefings", { client_id: cli }, H);
  assert.equal(a.st, 201);
  assert.equal(b.id, a.id, "o link ainda está de pé e em branco: é o mesmo");
});

test("depois de respondido, pedir outro onboarding dá um link NOVO", async () => {
  const cli = novoCliente("Advocacia que voltou");
  const primeiro = await req("POST", "/briefings", { client_id: cli }, H);
  marcaRespondido(primeiro.id);

  const segundo = await req("POST", "/briefings", { client_id: cli }, H);
  assert.equal(segundo.st, 201, "é um onboarding novo, não o velho de volta");
  assert.notEqual(segundo.id, primeiro.id);
  assert.notEqual(token(segundo.id), token(primeiro.id), "link novo, token novo");
});

test("o link novo ABRE e dá para responder", async () => {
  const cli = novoCliente("Cliente da segunda rodada");
  const primeiro = await req("POST", "/briefings", { client_id: cli }, H);
  marcaRespondido(primeiro.id);
  const segundo = await req("POST", "/briefings", { client_id: cli }, H);

  const tela = await req("GET", `/briefing/${token(segundo.id)}`);
  assert.equal(tela.st, 200);
  assert.equal(tela.status, "aberto", 'nada de "Recebemos. Obrigado!" num formulário que ninguém respondeu');
  assert.ok(!tela.answered_at);

  const salvou = await req("PUT", `/briefing/${token(segundo.id)}`, { respostas: { [PERGUNTA]: "Faço landing pages." } });
  assert.equal(salvou.st, 200, "tem que dar pra responder");
  const conferindo = await req("GET", `/briefing/${token(segundo.id)}`);
  assert.equal(conferindo.respostas[PERGUNTA], "Faço landing pages.");
});

test("o onboarding antigo não é mexido: as respostas dele ficam onde estavam", async () => {
  const cli = novoCliente("Cliente com histórico");
  const primeiro = await req("POST", "/briefings", { client_id: cli }, H);
  await req("PUT", `/briefing/${token(primeiro.id)}`, { respostas: { [PERGUNTA]: "Advocacia criminal." } });
  marcaRespondido(primeiro.id);
  await req("POST", "/briefings", { client_id: cli }, H);

  const velho = await req("GET", `/briefing/${token(primeiro.id)}`);
  assert.equal(velho.status, "respondido");
  assert.equal(velho.respostas[PERGUNTA], "Advocacia criminal.");
});

test("formulário diferente é onboarding diferente — link aberto não é reprogramado por baixo", async () => {
  const cli = novoCliente("Cliente de dois serviços");
  const social = await req("POST", "/briefings/formularios", { nome: "Social" }, H);
  const lp = await req("POST", "/briefings/formularios", { nome: "Landing page" }, H);

  const um = await req("POST", "/briefings", { client_id: cli, form_id: social.id }, H);
  const dois = await req("POST", "/briefings", { client_id: cli, form_id: lp.id }, H);
  assert.notEqual(dois.id, um.id,
    "o link do social já pode estar na mão do cliente: trocar as perguntas dele seria puxar o tapete");

  // E o mesmo formulário, de novo, continua devolvendo o mesmo link.
  const outraVez = await req("POST", "/briefings", { client_id: cli, form_id: lp.id }, H);
  assert.equal(outraVez.id, dois.id);
});

test("os dois onboardings aparecem na lista da agência", async () => {
  const cli = novoCliente("Cliente que aparece duas vezes");
  const um = await req("POST", "/briefings", { client_id: cli }, H);
  marcaRespondido(um.id);
  const dois = await req("POST", "/briefings", { client_id: cli }, H);

  const lista = await fetch(`${B}/briefings`, { headers: H }).then((r) => r.json());
  const dele = lista.filter((b) => b.client_id === cli).map((b) => b.id);
  assert.equal(dele[0], dois.id,
    "o mais novo vem primeiro: é o que ela acabou de criar e vai mandar agora");
  assert.deepEqual([...dele].sort(), [um.id, dois.id].sort(),
    "guardar só um escondia o segundo link — e sem link não há o que mandar");
});

// ---------------------------------------------------------------------------
// E NA TELA DELA. Dois onboardings no banco não servem de nada se a tela só
// mostra um: sem o link à vista, não há o que mandar para o cliente.
// ---------------------------------------------------------------------------
const { readFileSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");
const { dirname } = await import("node:path");
const tela = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/pages/Onboarding.jsx"), "utf8",
);

test("a lista guarda TODOS os onboardings de cada cliente", () => {
  assert.match(tela, /\(porCliente\[b\.client_id\] \|\|= \[\]\)\.push\(b\)/,
    "guardar só o primeiro escondia o segundo link");
  assert.match(tela, /\$\{todos\.length\} onboardings/);
});

test("o painel do cliente deixa trocar entre os onboardings dele", () => {
  const painel = tela.slice(tela.indexOf("function PainelDoCliente"));
  assert.match(painel, /const todos = alvo\.todos\?\.length \? alvo\.todos : \[b\];/);
  assert.match(painel, /onClick=\{\(\) => setB\(x\)\}/, "cada um com o seu link e as suas respostas");
});

test("dá para abrir outro onboarding sem fechar o anterior", () => {
  const painel = tela.slice(tela.indexOf("function PainelDoCliente"));
  assert.match(painel, /Abrir outro onboarding/);
  assert.match(tela, /onOutro=\{\(cliente\) => \{ setVendoCliente\(null\); setAbrindo\(\{ cliente \}\); \}\}/);
});
