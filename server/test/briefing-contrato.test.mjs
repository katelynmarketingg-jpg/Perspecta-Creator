// O briefing preenche o CADASTRO (razão social, CNPJ, quem assina, dia do
// pagamento) — e é isso que faz o contrato sair pronto para assinar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

const dir = mkdtempSync(join(tmpdir(), "pc-brf-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

// "Receita Federal" de mentira, para o teste não depender da internet.
const receita = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (!req.url.endsWith("19131243000197")) { res.statusCode = 404; return res.end("{}"); }
  res.end(JSON.stringify({
    razao_social: "KN ADVOCACIA CRIMINAL LTDA", logradouro: "Rua dos Andradas", numero: "1234",
    bairro: "Centro", municipio: "Porto Alegre", uf: "RS", cep: "90020008",
    email: "contato@kn.com.br", descricao_situacao_cadastral: "ATIVA",
    qsa: [{ nome_socio: "KAREN NUNES", qualificacao_socio: "Sócio-Administrador" }],
  }));
});
await new Promise((r) => receita.listen(0, r));
process.env.CNPJ_API_URL = `http://127.0.0.1:${receita.address().port}/cnpj`;

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const {
  BRIEFING, getTemplate, saveTemplate, resetTemplate, saneiaSecoes,
  respostasParaCliente, perguntasDe,
} = await import("../src/briefing.js");
const { cnpjValido, formataCnpj, buscaCnpj } = await import("../src/cnpj.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const briefingsRoutes = (await import("../src/routes/briefings.js")).default;
const { briefingPublicRouter } = await import("../src/routes/briefing-public.js");
const contractTemplates = (await import("../src/routes/contract-templates.js")).default;

const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES ('Agência', 0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@x.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cliente = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('KN','active',?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/briefing", briefingPublicRouter);
app.use("/api/briefings", briefingsRoutes);
app.use("/api/contract-templates", contractTemplates);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
const J = { "content-type": "application/json" };
const req = (m, u, corpo, cab) => fetch(B + u, {
  method: m, headers: cab || J, body: corpo ? JSON.stringify(corpo) : undefined,
}).then(async (r) => ({ st: r.status, ...(await r.json().catch(() => ({}))) }));

const criado = await req("POST", "/briefings", { client_id: cliente }, H);

test("o CNPJ é conferido antes de gastar uma consulta", () => {
  assert.equal(cnpjValido("19.131.243/0001-97"), true);
  assert.equal(cnpjValido("11.111.111/1111-11"), false);
  assert.equal(cnpjValido("123"), false);
  assert.equal(formataCnpj("19131243000197"), "19.131.243/0001-97");
});

test("consulta de CNPJ traz razão social, endereço e quem assina", async () => {
  const r = await buscaCnpj("19131243000197");
  assert.equal(r.ok, true);
  assert.equal(r.razao_social, "KN ADVOCACIA CRIMINAL LTDA");
  assert.match(r.endereco, /Rua dos Andradas, 1234/);
  assert.match(r.endereco, /Porto Alegre - RS/);
  assert.equal(r.representante, "KAREN NUNES");
});

test("CNPJ inexistente e inválido não quebram o briefing", async () => {
  assert.equal((await buscaCnpj("11222333000181")).ok, false);   // válido, mas não existe na base
  const ruim = await buscaCnpj("12345");
  assert.equal(ruim.ok, false);
  assert.match(ruim.message, /14 números/);
});

test("a consulta pública exige um link de briefing válido", async () => {
  const bom = await req("GET", `/briefing/${criado.token}/cnpj/19131243000197`);
  assert.equal(bom.ok, true);
  const ruim = await req("GET", "/briefing/link-inventado/cnpj/19131243000197");
  assert.equal(ruim.ok, false);
});

test("o escritório edita as perguntas e o cliente passa a ver as dele", async () => {
  const minhas = [{
    id: "meu", titulo: "Do meu jeito", intro: "oi",
    perguntas: [{ id: "cor", tipo: "texto", label: "Qual a cor da marca?", obrigatoria: true }],
  }];
  const salvo = await req("PUT", "/briefings/template",
    { welcome: { titulo: "Olá, {cliente}!", paragrafos: ["Vamos lá."], botao: "Bora" }, secoes: minhas }, H);
  assert.equal(salvo.st, 200);

  const doCliente = await req("GET", `/briefing/${criado.token}`);
  assert.equal(doCliente.secoes.length, 1);
  assert.equal(doCliente.secoes[0].perguntas[0].label, "Qual a cor da marca?");
  assert.equal(doCliente.welcome.titulo, "Olá, {cliente}!");

  // e as respostas passam a valer pelas perguntas NOVAS
  await req("PUT", `/briefing/${criado.token}`, { respostas: { cor: "laranja", resumo: "não existe mais" } });
  const volta = await req("GET", `/briefing/${criado.token}`);
  assert.equal(volta.respostas.cor, "laranja");
  assert.equal(volta.respostas.resumo, undefined, "pergunta que não existe mais não grava");

  resetTemplate(org);
  assert.equal(getTemplate(org).secoes.length, BRIEFING.length, "dá para voltar ao de fábrica");
});

test("pergunta sem id, id repetido e briefing vazio não passam", () => {
  const limpo = saneiaSecoes([
    { titulo: "A", perguntas: [{ label: "Um" }, { label: "Dois" }] },
    { titulo: "B", perguntas: [{ id: "x", label: "Três" }, { id: "x", label: "Quatro" }] },
  ]);
  const ids = perguntasDe(limpo).map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "nenhum id pode repetir");
  assert.ok(ids.every(Boolean), "nenhuma pergunta pode ficar sem id");
  assert.throws(() => saveTemplate(org, { secoes: [] }), /pelo menos uma pergunta/);
});

test("as respostas viram os campos do cadastro, com o dia como número", () => {
  const c = respostasParaCliente(BRIEFING, {
    cnpj: "19.131.243/0001-97", razao_social: "KN LTDA", dia_pagamento: "10",
    rep_tipo_doc: "OAB", rep_nome: "Karen",
  });
  assert.equal(c.legal_name, "KN LTDA");
  assert.equal(c.payment_day, 10, "o dia tem que virar número");
  assert.equal(c.rep_doc_type, "oab");
  // Um dia impossível não entra no cadastro.
  assert.equal(respostasParaCliente(BRIEFING, { dia_pagamento: "45" }).payment_day, undefined);
});

test("do briefing ao contrato: sai preenchido, sem marcador sobrando", async () => {
  const respostas = {};
  for (const p of perguntasDe(BRIEFING)) {
    respostas[p.id] = p.tipo === "escolhas" ? p.opcoes[0] : `resposta de ${p.id}`;
  }
  Object.assign(respostas, {
    cnpj: "19.131.243/0001-97", razao_social: "KN ADVOCACIA CRIMINAL LTDA",
    endereco: "Rua dos Andradas, 1234 — Porto Alegre - RS", rep_nome: "Karen Nunes",
    rep_tipo_doc: "OAB", rep_documento: "RS 123.456", dia_pagamento: "10",
    email_nota: "financeiro@kn.com.br", cliente_ideal: "empresários",
  });
  await req("PUT", `/briefing/${criado.token}`, { respostas });
  assert.equal((await req("POST", `/briefing/${criado.token}/enviar`)).st, 200);

  const ap = await req("POST", `/briefings/${criado.id}/aplicar`, {}, H);
  assert.equal(ap.st, 200);
  // O TIPO do documento tem que virar OAB: a coluna nasce com 'cpf' por padrão,
  // e o padrão não pode vencer a resposta do cliente — um contrato dizendo CPF
  // onde é OAB está errado.
  assert.ok(ap.cadastro.includes("rep_doc_type"), `não gravou o tipo do documento: ${ap.cadastro}`);
  const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(cliente);
  assert.equal(c.rep_doc_type, "oab");
  assert.equal(c.payment_day, 10);
  assert.equal(c.legal_name, "KN ADVOCACIA CRIMINAL LTDA");

  const modelo = await req("POST", "/contract-templates", {
    name: "Prestação",
    body: "Contratante: {{razao_social}}, CNPJ {{cnpj}}, sede {{endereco}}, representada por "
        + "{{representante}}, {{tipo_documento_representante}} {{documento_representante}}. "
        + "Valor {{valor}}, {{vencimento}}.",
  }, H);
  const contrato = await req("POST", `/contract-templates/${modelo.id}/generate`, { client_id: cliente, value: 1500 }, H);
  assert.equal(contrato.st, 201);
  assert.match(contrato.notes, /KN ADVOCACIA CRIMINAL LTDA/);
  assert.match(contrato.notes, /19\.131\.243\/0001-97/);
  assert.match(contrato.notes, /OAB RS 123\.456/);
  assert.match(contrato.notes, /todo dia 10 de cada mês/);
  assert.ok(!/\{\{/.test(contrato.notes), `sobrou marcador: ${contrato.notes}`);

  srv.close(); receita.close();
});
