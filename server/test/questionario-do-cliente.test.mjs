// UM QUESTIONÁRIO PARA CADA CLIENTE — E UM JEITO DE FECHAR O ONBOARDING.
//
// O modelo da casa servia para todo mundo: um escritório de advocacia e uma
// pastelaria recebiam as mesmas 43 perguntas. Agora dá para montar o
// questionário de UM cliente, guardado com ele, sem tocar no padrão — e voltar
// ao padrão a qualquer momento.
//
// E o onboarding tinha um começo mas nenhum fim: ficava para sempre na lista
// como "aguardando resposta". Fechar tira da fila e faz o link parar de aceitar
// coisa nova, sem apagar nada do que já foi respondido.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-quest-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const briefingsRoutes = (await import("../src/routes/briefings.js")).default;
const { briefingPublicRouter } = await import("../src/routes/briefing-public.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa das Perguntas',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@q.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const advogado = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Dra. Ana','active',?)").run(org).lastInsertRowid;
const pastelaria = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Pastel do Zé','active',?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/briefings", briefingsRoutes);
app.use("/api/briefing", briefingPublicRouter);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;

const token = jwt.sign({ id: uid, org_id: org, role: "admin" }, JWT_SECRET);
const auth = { "content-type": "application/json", authorization: `Bearer ${token}` };
const chamar = (metodo, caminho, corpo) => fetch(`${B}${caminho}`, {
  method: metodo, headers: auth, body: corpo ? JSON.stringify(corpo) : undefined,
});

// Os dois onboardings.
const daAna = await (await chamar("POST", "/briefings", { client_id: advogado })).json();
const doZe = await (await chamar("POST", "/briefings", { client_id: pastelaria })).json();

const SO_DELA = [{
  id: "advocacia",
  titulo: "Sobre a banca",
  perguntas: [
    { id: "area", tipo: "texto", label: "Em que área você atua?", obrigatoria: true },
    { id: "oab", tipo: "texto", label: "Número da OAB" },
  ],
}];

test("um cliente pode ter um questionário só dele", async () => {
  const r = await chamar("PUT", `/briefings/${daAna.id}/perguntas`, { secoes: SO_DELA });
  assert.equal(r.status, 200);
  const dados = await r.json();
  assert.equal(dados.proprias, true);
  assert.equal(dados.total, 2);              // as duas dela, não as 40 e tantas da casa
  assert.equal(dados.perguntas_proprias, true);
});

test("o cliente vê as perguntas dele, não as da casa", async () => {
  const visto = await (await fetch(`${B}/briefing/${daAna.token}`)).json();
  assert.deepEqual(visto.secoes.map((s) => s.id), ["advocacia"]);
  assert.equal(visto.secoes[0].perguntas.length, 2);
});

test("e o resto da casa continua no padrão", async () => {
  const visto = await (await fetch(`${B}/briefing/${doZe.token}`)).json();
  assert.ok(visto.secoes.length > 1, "o Zé continua com o questionário padrão");
  assert.ok(visto.secoes.some((s) => s.id === "empresa"));
});

test("a resposta de uma pergunta própria é guardada", async () => {
  const r = await fetch(`${B}/briefing/${daAna.token}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ respostas: { area: "Direito de família", oab: "12345/SC" } }),
  });
  assert.equal(r.status, 200);
  const visto = await (await fetch(`${B}/briefing/${daAna.token}`)).json();
  assert.equal(visto.respostas.area, "Direito de família");
});

test("uma resposta que não é pergunta dela continua sendo recusada", async () => {
  await fetch(`${B}/briefing/${daAna.token}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ respostas: { pilares: "isto é do questionário da casa" } }),
  });
  const visto = await (await fetch(`${B}/briefing/${daAna.token}`)).json();
  assert.equal(visto.respostas.pilares, undefined);
});

test("voltar ao padrão devolve o questionário da casa, sem perder o modelo", async () => {
  const r = await chamar("DELETE", `/briefings/${daAna.id}/perguntas`);
  assert.equal(r.status, 200);
  const dados = await r.json();
  assert.equal(dados.proprias, false);
  const visto = await (await fetch(`${B}/briefing/${daAna.token}`)).json();
  assert.ok(visto.secoes.some((s) => s.id === "empresa"), "voltou para o padrão da casa");
});

// ---------------------------------------------------------------------------
// FECHAR O ONBOARDING
// ---------------------------------------------------------------------------
test("fechar o onboarding tira da fila e trava o link", async () => {
  const r = await chamar("POST", `/briefings/${doZe.id}/encerrar`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, "encerrado");

  const visto = await (await fetch(`${B}/briefing/${doZe.token}`)).json();
  assert.equal(visto.encerrado, true);
  assert.ok(visto.aviso_encerrado, "o cliente é avisado, em vez de ver um formulário mudo");
});

test("encerrado, o cliente não consegue mais responder nem enviar", async () => {
  const salvar = await fetch(`${B}/briefing/${doZe.token}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ respostas: { nome: "tarde demais" } }),
  });
  assert.equal(salvar.status, 409);

  const enviar = await fetch(`${B}/briefing/${doZe.token}/enviar`, { method: "POST" });
  assert.equal(enviar.status, 409);
});

test("o que ele já tinha respondido não se perde ao fechar", async () => {
  const linha = db.prepare("SELECT answers FROM briefings WHERE id = ?").get(doZe.id);
  assert.ok(linha.answers !== null);
});

test("reabrir devolve o link para o cliente", async () => {
  const r = await chamar("POST", `/briefings/${doZe.id}/reabrir`);
  assert.equal((await r.json()).status, "aberto");
  const visto = await (await fetch(`${B}/briefing/${doZe.token}`)).json();
  assert.equal(visto.encerrado, false);
});

test("abrir onboarding de novo, depois de fechado, cria um link novo", async () => {
  await chamar("POST", `/briefings/${doZe.id}/encerrar`);
  const novo = await (await chamar("POST", "/briefings", { client_id: pastelaria })).json();
  assert.notEqual(novo.token, doZe.token, "não reaproveita o link que ela fechou");
  assert.equal(novo.status, "aberto");
});

test("questionário vazio é recusado — senão o cliente abriria um link sem nada", async () => {
  const r = await chamar("PUT", `/briefings/${daAna.id}/perguntas`, { secoes: [] });
  assert.equal(r.status, 400);
});

after(() => { srv.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
