// O FORMULÁRIO É A JORNADA INTEIRA, NÃO SÓ AS PERGUNTAS.
//
// Depois de responder, o cliente via sempre os mesmos dois passos: assinar o
// contrato e criar o acesso à Área do Cliente. Mas nem todo onboarding termina
// assim — um orçamento não vira contrato, e um trabalho pontual não precisa de
// área nenhuma. E o texto de boas-vindas era um só para a casa toda: um convite
// de rebranding abria com as mesmas palavras de um onboarding mensal.
//
// Agora cada formulário diz onde começa e como termina. E quando um passo está
// desligado, não basta sumir da tela: a porta tem que estar fechada no servidor
// também, porque o link do briefing é endereço público.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-jornada-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const briefingsRoutes = (await import("../src/routes/briefings.js")).default;
const { briefingPublicRouter } = await import("../src/routes/briefing-public.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Jornada',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@j.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const orcamento = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Padaria Sol','active',?)").run(org).lastInsertRowid;
const mensal = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Clínica Vita','active',?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/briefings", briefingsRoutes);
app.use("/api/briefing", briefingPublicRouter);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;

const token = jwt.sign({ id: uid, org_id: org, role: "admin" }, JWT_SECRET);
const auth = { "content-type": "application/json", authorization: `Bearer ${token}` };
const chamar = (m, c, corpo) => fetch(`${B}${c}`, {
  method: m, headers: auth, body: corpo ? JSON.stringify(corpo) : undefined,
});

const PERGUNTAS = [{ id: "e", titulo: "Etapa", perguntas: [{ id: "q", tipo: "texto", label: "Uma pergunta" }] }];

let sondagem;

test("um formulário novo nasce com os dois passos ligados", async () => {
  const r = await chamar("POST", "/briefings/formularios", { nome: "Mensal", secoes: PERGUNTAS });
  const f = await r.json();
  assert.equal(f.gera_contrato, true);
  assert.equal(f.cria_acesso, true);
  assert.equal(f.welcome, null, "sem texto próprio, vale o da casa");
});

test("dá para criar um formulário que não gera contrato nem abre acesso", async () => {
  const r = await chamar("POST", "/briefings/formularios", {
    nome: "Sondagem", secoes: PERGUNTAS, gera_contrato: false, cria_acesso: false,
    welcome: { titulo: "Oi! Só algumas perguntas.", paragrafos: ["É rápido, prometo."], botao: "Começar" },
  });
  assert.equal(r.status, 201);
  sondagem = await r.json();
  assert.equal(sondagem.gera_contrato, false);
  assert.equal(sondagem.cria_acesso, false);
  assert.equal(sondagem.welcome.titulo, "Oi! Só algumas perguntas.");
});

test("o cliente vê o texto de boas-vindas do formulário dele", async () => {
  const b = await (await chamar("POST", "/briefings", { client_id: orcamento, form_id: sondagem.id })).json();
  const visto = await (await fetch(`${B}/briefing/${b.token}`)).json();
  assert.equal(visto.welcome.titulo, "Oi! Só algumas perguntas.");
  assert.deepEqual(visto.passos, { contrato: false, acesso: false });
});

test("quem está no padrão da casa continua vendo o texto da casa e os dois passos", async () => {
  const b = await (await chamar("POST", "/briefings", { client_id: mensal })).json();
  const visto = await (await fetch(`${B}/briefing/${b.token}`)).json();
  assert.ok(visto.welcome.titulo.includes("{agencia}") || visto.welcome.titulo.length > 0);
  assert.deepEqual(visto.passos, { contrato: true, acesso: true });
});

test("com o acesso desligado, criar acesso é RECUSADO — não basta sumir da tela", async () => {
  const b = (await (await chamar("GET", "/briefings")).json()).find((x) => x.client_id === orcamento);
  const r = await fetch(`${B}/briefing/${b.token}/acesso`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ usuario: "padaria", senha: "segredo123" }),
  });
  assert.equal(r.status, 403);
  const cliente = db.prepare("SELECT portal_password_hash FROM clients WHERE id = ?").get(orcamento);
  assert.equal(cliente.portal_password_hash, null, "ninguém entrou por uma porta que deveria estar fechada");
});

test("com o acesso ligado, o cliente cria o acesso normalmente", async () => {
  const b = (await (await chamar("GET", "/briefings")).json()).find((x) => x.client_id === mensal);
  const r = await fetch(`${B}/briefing/${b.token}/acesso`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ usuario: "vita", senha: "segredo123" }),
  });
  assert.equal(r.status, 201);
});

test("os próximos passos não oferecem o que o formulário desligou", async () => {
  const b = (await (await chamar("GET", "/briefings")).json()).find((x) => x.client_id === orcamento);
  const p = await (await fetch(`${B}/briefing/${b.token}/proximos-passos`)).json();
  assert.deepEqual(p.passos, { contrato: false, acesso: false });
  assert.equal(p.contrato, null);
});

test("com o contrato desligado, o envio não gera contrato nenhum", async () => {
  const { geraContratoDoOnboarding } = await import("../src/onboarding.js");
  const linha = db.prepare("SELECT * FROM briefings WHERE client_id = ?").get(orcamento);
  // Termos preenchidos de propósito: mesmo assim não sai contrato.
  db.prepare("UPDATE briefings SET terms = ? WHERE id = ?")
    .run(JSON.stringify({ template_id: 1, servico: "Consultoria" }), linha.id);
  const atual = db.prepare("SELECT * FROM briefings WHERE id = ?").get(linha.id);
  assert.equal(geraContratoDoOnboarding(atual), null);
});

test("renomear ou mexer nas perguntas não desliga os passos sem querer", async () => {
  const r = await chamar("PUT", `/briefings/formularios/${sondagem.id}`, { nome: "Sondagem rápida" });
  const f = await r.json();
  assert.equal(f.name, "Sondagem rápida");
  assert.equal(f.gera_contrato, false);
  assert.equal(f.cria_acesso, false);
  assert.equal(f.welcome.titulo, "Oi! Só algumas perguntas.");
  assert.equal(f.secoes[0].perguntas.length, 1, "as perguntas continuam lá");
});

test("voltar ao texto da casa é mandar welcome vazio", async () => {
  const r = await chamar("PUT", `/briefings/formularios/${sondagem.id}`, { welcome: null });
  const f = await r.json();
  assert.equal(f.welcome, null);
  const b = (await (await chamar("GET", "/briefings")).json()).find((x) => x.client_id === orcamento);
  const visto = await (await fetch(`${B}/briefing/${b.token}`)).json();
  assert.notEqual(visto.welcome.titulo, "Oi! Só algumas perguntas.");
});

test("a casa também decide o próprio fim, e a aba de boas-vindas não o desfaz", async () => {
  const padrao = await (await chamar("GET", "/briefings/template")).json();
  await chamar("PUT", "/briefings/template", {
    welcome: padrao.welcome, secoes: padrao.secoes, gera_contrato: false, cria_acesso: true,
  });
  let t = await (await chamar("GET", "/briefings/template")).json();
  assert.equal(t.gera_contrato, false);

  // Salvar SÓ as boas-vindas (a aba 1 não sabe dos passos do fim).
  await chamar("PUT", "/briefings/template", { welcome: padrao.welcome, secoes: padrao.secoes });
  t = await (await chamar("GET", "/briefings/template")).json();
  assert.equal(t.gera_contrato, false, "o passo desligado continua desligado");
  assert.equal(t.cria_acesso, true);
});

test("duplicar leva a jornada junto, não só as perguntas", async () => {
  const base = await (await chamar("POST", "/briefings/formularios", {
    nome: "Base", secoes: PERGUNTAS, gera_contrato: false, cria_acesso: true,
    welcome: { titulo: "Um título só dele", paragrafos: ["oi"], botao: "Vamos" },
  })).json();
  const copia = await (await chamar("POST", "/briefings/formularios", {
    nome: "Cópia da base", copiar_de: base.id,
  })).json();
  assert.equal(copia.gera_contrato, false);
  assert.equal(copia.cria_acesso, true);
  assert.equal(copia.welcome.titulo, "Um título só dele");
});

after(() => { srv.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
