// FORMULÁRIOS COM NOME.
//
// A casa atende ramos diferentes: advocacia, alimentação, estética. Antes, ou
// todo mundo respondia o mesmo padrão, ou ela reescrevia as perguntas cliente
// por cliente — e no segundo caso o trabalho não servia para mais ninguém.
//
// Agora ela monta um formulário COM NOME e manda o certo para cada um. O nome é
// o que ela procura depois, então é obrigatório. E o padrão da casa continua
// existindo, intocado, como o que vale quando ela não escolhe nada.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-forms-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const briefingsRoutes = (await import("../src/routes/briefings.js")).default;
const { briefingPublicRouter } = await import("../src/routes/briefing-public.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa dos Formulários',0)").run().lastInsertRowid;
const outraCasa = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Vizinha',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@f.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
// A vizinha tem o usuário DELA: o escritório de cada chamada sai do cadastro
// de quem está logado, não do token.
const uidVizinha = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('V','V','v@f.com',?,'admin',1,?)"
).run(hashPassword("x"), outraCasa).lastInsertRowid;
const ana = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Dra. Ana','active',?)").run(org).lastInsertRowid;
const ze = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Pastel do Zé','active',?)").run(org).lastInsertRowid;

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

const ADVOCACIA = [{
  id: "banca", titulo: "Sobre a banca",
  perguntas: [
    { id: "area", tipo: "texto", label: "Em que área você atua?", obrigatoria: true },
    { id: "oab", tipo: "texto", label: "Número da OAB" },
    // O tipo em imagem funciona aqui igual: é o mesmo editor de perguntas.
    { id: "clima", tipo: "visual", label: "Qual destas fotos combina com a banca?",
      opcoes_visuais: [{ token: "img1", legenda: "Sóbrio" }, { token: "img2", legenda: "Acolhedor" }],
      pede_porque: true },
  ],
}];

let advocacia;

test("um formulário sem nome é recusado — é pelo nome que ela acha depois", async () => {
  const r = await chamar("POST", "/briefings/formularios", { nome: "   ", secoes: ADVOCACIA });
  assert.equal(r.status, 400);
});

test("criar um formulário com nome e perguntas próprias", async () => {
  const r = await chamar("POST", "/briefings/formularios", { nome: "Advocacia", secoes: ADVOCACIA });
  assert.equal(r.status, 201);
  advocacia = await r.json();
  assert.equal(advocacia.name, "Advocacia");
  assert.equal(advocacia.secoes[0].perguntas.length, 3);
});

test("o tipo em imagem sobrevive dentro de um formulário com nome", () => {
  const visual = advocacia.secoes[0].perguntas.find((p) => p.tipo === "visual");
  assert.ok(visual, "a pergunta em imagem continua lá");
  assert.equal(visual.opcoes_visuais.length, 2);
  assert.equal(visual.pede_porque, true);
});

test("criado sem perguntas, nasce igual ao padrão da casa", async () => {
  const r = await chamar("POST", "/briefings/formularios", { nome: "Alimentação" });
  const f = await r.json();
  assert.ok(f.secoes.length > 1, "veio com as etapas do padrão, para ela só ajustar");
  assert.ok(f.secoes.some((s) => s.id === "empresa"));
});

test("a estante lista os formulários e o padrão junto", async () => {
  const { padrao, formularios } = await (await chamar("GET", "/briefings/formularios")).json();
  assert.equal(padrao.id, null);
  assert.ok(padrao.perguntas > 0);
  assert.deepEqual(formularios.map((f) => f.name), ["Advocacia", "Alimentação"]);
  assert.equal(formularios.find((f) => f.name === "Advocacia").perguntas, 3);
});

test("o cliente com formulário escolhido responde o formulário, não o padrão", async () => {
  const b = await (await chamar("POST", "/briefings", { client_id: ana, form_id: advocacia.id })).json();
  assert.equal(b.form_id, advocacia.id);
  assert.equal(b.origem.nome, "Advocacia");
  assert.equal(b.total, 3);

  const visto = await (await fetch(`${B}/briefing/${b.token}`)).json();
  assert.deepEqual(visto.secoes.map((s) => s.id), ["banca"]);
});

test("quem não escolheu nada continua no padrão da casa", async () => {
  const b = await (await chamar("POST", "/briefings", { client_id: ze })).json();
  assert.equal(b.form_id, null);
  assert.equal(b.origem.tipo, "padrao");
  assert.ok(b.total > 3);
});

test("dá para trocar o formulário de quem já tem link, sem trocar o link", async () => {
  const antes = (await (await chamar("GET", "/briefings")).json()).find((x) => x.client_id === ze);
  const r = await chamar("PUT", `/briefings/${antes.id}/formulario`, { form_id: advocacia.id });
  const depois = await r.json();
  assert.equal(depois.token, antes.token, "o link que ela já mandou continua valendo");
  assert.equal(depois.origem.nome, "Advocacia");
  assert.equal(depois.total, 3);
});

test("renomear não mexe nas perguntas", async () => {
  const r = await chamar("PUT", `/briefings/formularios/${advocacia.id}`, { nome: "Advocacia criminal" });
  const f = await r.json();
  assert.equal(f.name, "Advocacia criminal");
  assert.equal(f.secoes[0].perguntas.length, 3);
});

test("editar o formulário muda quem o recebe — e não mexe no padrão da casa", async () => {
  await chamar("PUT", `/briefings/formularios/${advocacia.id}`, {
    secoes: [{ id: "banca", titulo: "Sobre a banca",
      perguntas: [{ id: "area", tipo: "texto", label: "Em que área você atua?" }] }],
  });
  const lista = await (await chamar("GET", "/briefings")).json();
  assert.equal(lista.find((x) => x.client_id === ana).total, 1);

  const { padrao } = await (await chamar("GET", "/briefings/formularios")).json();
  assert.ok(padrao.perguntas > 1, "o padrão da casa continua inteiro");
});

test("perguntas escritas só para um cliente vencem o formulário", async () => {
  const b = (await (await chamar("GET", "/briefings")).json()).find((x) => x.client_id === ana);
  await chamar("PUT", `/briefings/${b.id}/perguntas`, {
    secoes: [{ id: "so_dela", titulo: "Só dela",
      perguntas: [{ id: "a", tipo: "texto", label: "A" }, { id: "c", tipo: "texto", label: "C" }] }],
  });
  const depois = (await (await chamar("GET", "/briefings")).json()).find((x) => x.client_id === ana);
  assert.equal(depois.origem.tipo, "proprio");
  assert.equal(depois.total, 2);
});

test("escolher um formulário descarta a cópia solta — senão a escolha não faria nada", async () => {
  const b = (await (await chamar("GET", "/briefings")).json()).find((x) => x.client_id === ana);
  const r = await chamar("PUT", `/briefings/${b.id}/formulario`, { form_id: advocacia.id });
  const depois = await r.json();
  assert.equal(depois.origem.nome, "Advocacia criminal");
  assert.equal(depois.perguntas_proprias, false);
});

test("apagar um formulário devolve quem o usava ao padrão, sem perder resposta", async () => {
  const antes = (await (await chamar("GET", "/briefings")).json()).find((x) => x.client_id === ana);
  await fetch(`${B}/briefing/${antes.token}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ respostas: { area: "Família" } }),
  });

  const r = await chamar("DELETE", `/briefings/formularios/${advocacia.id}`);
  const saida = await r.json();
  assert.equal(saida.apagado, true);
  assert.equal(saida.clientes, 2, "a Ana e o Zé estavam nele");

  const depois = (await (await chamar("GET", "/briefings")).json()).find((x) => x.client_id === ana);
  assert.equal(depois.origem.tipo, "padrao");
  const visto = await (await fetch(`${B}/briefing/${depois.token}`)).json();
  assert.equal(visto.respostas.area, "Família", "o que ele já respondeu continua lá");
});

test("o formulário de uma casa não aparece nem abre na outra", async () => {
  const outroToken = jwt.sign({ id: uidVizinha, org_id: outraCasa, role: "admin" }, JWT_SECRET);
  const r = await fetch(`${B}/briefings/formularios`, { headers: { authorization: `Bearer ${outroToken}` } });
  const { formularios } = await r.json();
  assert.deepEqual(formularios, []);

  const alimentacao = (await (await chamar("GET", "/briefings/formularios")).json())
    .formularios.find((f) => f.name === "Alimentação");
  const espiando = await fetch(`${B}/briefings/formularios/${alimentacao.id}`, {
    headers: { authorization: `Bearer ${outroToken}` },
  });
  assert.equal(espiando.status, 404);
});

test("mandar um formulário que não existe é recusado, não vira onboarding vazio", async () => {
  const r = await chamar("POST", "/briefings", { client_id: ze, form_id: 99999 });
  assert.equal(r.status, 400);
});

after(() => { srv.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
