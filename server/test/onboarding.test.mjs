// ONBOARDING: a agência preenche o que só ela sabe (serviço, quantidades,
// valor, vigência e a data do contrato) ANTES de gerar o link. Quando o cliente
// termina de responder, o contrato já nasce pronto para assinar — sem ninguém
// clicar em nada.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-onb-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { BRIEFING, perguntasDe } = await import("../src/briefing.js");
const { mesesDeVigencia, brl, modelosDisponiveis, achaModelo } = await import("../src/contract-gen.js");
const { MODELO_REDES } = await import("../src/contract-model.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const briefingsRoutes = (await import("../src/routes/briefings.js")).default;
const { briefingPublicRouter } = await import("../src/routes/briefing-public.js");

const org = db.prepare(
  `INSERT INTO organizations (name, is_master, document, address, city, signer_name, signer_document)
   VALUES ('Perspectiva Onboarding', 0, '52622307000128', 'Rua Iraci Pinheiro Pedroso, 93', 'Santo Antônio da Patrulha', 'Katelyn dos Santos Oliveira', '040.096.640-96')`
).run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@x.com',?,'admin',1,?)"
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

/** Responde tudo o que o briefing pede, com os dados do contrato de verdade. */
function respostasCompletas() {
  const r = {};
  for (const p of perguntasDe(BRIEFING)) r[p.id] = p.tipo === "escolhas" ? p.opcoes[0] : `resposta de ${p.id}`;
  return Object.assign(r, {
    cnpj: "55.514.449/0001-60",
    razao_social: "MARCELO AUGUSTO RODRIGUES DE LEMOS SOCIEDADE INDIVIDUAL DE ADVOCACIA",
    endereco: "Av. Borges de Medeiros, 500 — Porto Alegre/RS",
    rep_nome: "Marcelo Augusto Rodrigues de Lemos",
    rep_tipo_doc: "OAB", rep_documento: "RS 98.765", dia_pagamento: "10",
  });
}

test("de setembro a fevereiro são SEIS meses — os dois extremos contam", () => {
  assert.equal(mesesDeVigencia("2026-09-01", "2027-02-28"), 6);
  assert.equal(mesesDeVigencia("2026-09-15", "2026-09-30"), 1);
  assert.equal(mesesDeVigencia("2026-09-01", "2027-08-31"), 12);
  assert.equal(mesesDeVigencia("2027-01-01", "2026-01-01"), null, "fim antes do início não vale");
  assert.equal(mesesDeVigencia("", "2027-02-28"), null);
});

test("o valor sai com separador de milhar, como num contrato", () => {
  assert.equal(brl(1500), "R$ 1.500,00");
  assert.equal(brl(12500.5), "R$ 12.500,50");
});

test("o modelo escrito em SERVIÇOS vale — é onde a casa escreve", () => {
  const svc = db.prepare("INSERT INTO services (name, default_price, contract_template, org_id) VALUES (?, ?, ?, ?)")
    .run("Gestão de rede social", 1500, "<p>Contrato de {{razao_social}}</p>", org).lastInsertRowid;
  const achado = achaModelo(org, { service_id: svc });
  assert.equal(achado.origem, "servico");
  assert.match(achado.body, /razao_social/);

  const lista = modelosDisponiveis(org);
  assert.ok(lista.some((m) => m.origem === "servico" && m.tem_contrato), "o serviço com contrato tem que aparecer");
});

test("serviço sem contrato escrito diz o que fazer, em vez de 'não encontrado'", () => {
  const vazio = db.prepare("INSERT INTO services (name, org_id) VALUES ('Tráfego pago', ?)").run(org).lastInsertRowid;
  assert.throws(() => achaModelo(org, { service_id: vazio }), /ainda não tem contrato escrito/);
});

test("respondido o onboarding, o contrato nasce pronto com os termos da agência", async () => {
  const cliente = novoCliente("Marcelo Advocacia");
  const modelo = db.prepare("INSERT INTO contract_templates (org_id, name, body) VALUES (?, ?, ?)")
    .run(org, MODELO_REDES.name, MODELO_REDES.body).lastInsertRowid;

  const criado = await req("POST", "/briefings", {
    client_id: cliente,
    termos: {
      template_id: modelo, servico: "Gestão de rede social", value: 1500,
      itens: [{ label: "Posts", unit: "por mês", quantidade: 4 }, { label: "Vídeos", unit: "por mês", quantidade: 4 }],
      start_date: "2026-09-01", end_date: "2027-02-28", contract_date: "2026-08-20",
    },
  }, H);
  assert.equal(criado.st, 201);
  assert.equal(criado.termos.duration_months, 6, "a vigência tem que sair calculada");

  await req("PUT", `/briefing/${criado.token}`, { respostas: respostasCompletas() });
  const enviado = await req("POST", `/briefing/${criado.token}/enviar`);
  assert.equal(enviado.st, 200);
  assert.equal(enviado.contrato, true, "o contrato tinha que ter sido gerado sozinho");

  const contrato = db.prepare("SELECT * FROM contracts WHERE client_id = ?").get(cliente);
  assert.ok(contrato, "tem que existir um contrato esperando assinatura");
  assert.equal(contrato.duration_months, 6);
  assert.equal(contrato.value, 1500);

  const texto = contrato.notes;
  assert.match(texto, /MARCELO AUGUSTO RODRIGUES DE LEMOS/, "a razão social do briefing tem que entrar");
  assert.match(texto, /55\.514\.449\/0001-60/, "o CNPJ formatado");
  assert.match(texto, /OAB sob o n\.º RS 98\.765/, "o tipo de documento respondido, não o padrão CPF");
  assert.match(texto, /R\$ 1\.500,00/, "o valor com separador de milhar");
  assert.match(texto, /até o dia 10 de cada mês/, "o dia que o cliente escolheu");
  assert.match(texto, /vigência de 06 \(seis\) meses/, "o prazo por extenso");
  assert.match(texto, /20 de agosto de 2026/, "a data que a agência mandou constar");
  assert.match(texto, /Santo Antônio da Patrulha/, "a cidade da agência, para a data e o foro");
  assert.ok(!/\{\{/.test(texto), `sobrou marcador sem preencher: ${(texto.match(/\{\{\w+\}\}/g) || []).join(", ")}`);
});

test("as quantidades da agência entram no contrato por extenso", async () => {
  const cliente = novoCliente("Padaria do Bairro");
  const modelo = db.prepare("INSERT INTO contract_templates (org_id, name, body) VALUES (?, ?, ?)")
    .run(org, "Pacote", "Entregamos {{posts_mes}} posts, {{videos_mes}} vídeos e {{qtd_stories}} stories.").lastInsertRowid;

  const criado = await req("POST", "/briefings", {
    client_id: cliente,
    termos: {
      template_id: modelo, value: 900,
      itens: [{ label: "Posts", quantidade: 8 }, { label: "Vídeos", quantidade: 2 }, { label: "Stories", quantidade: 12 }],
      start_date: "2026-10-01", end_date: "2027-03-31",
    },
  }, H);
  await req("PUT", `/briefing/${criado.token}`, { respostas: respostasCompletas() });
  await req("POST", `/briefing/${criado.token}/enviar`);

  const texto = db.prepare("SELECT notes FROM contracts WHERE client_id = ?").get(cliente).notes;
  assert.match(texto, /08 \(oito\) posts/);
  assert.match(texto, /02 \(dois\) vídeos/);
  assert.match(texto, /12 \(doze\) stories/, "a entrega criada por ela vira marcador pelo próprio nome");
});

test("sem termos definidos, o briefing continua funcionando — só não gera contrato", async () => {
  const cliente = novoCliente("Sem termos");
  const criado = await req("POST", "/briefings", { client_id: cliente }, H);
  await req("PUT", `/briefing/${criado.token}`, { respostas: respostasCompletas() });
  const enviado = await req("POST", `/briefing/${criado.token}/enviar`);
  assert.equal(enviado.st, 200);
  assert.equal(enviado.contrato, false);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM contracts WHERE client_id = ?").get(cliente).n, 0);
});

test("modelo apagado não derruba o envio do cliente — a agência é avisada", async () => {
  const cliente = novoCliente("Modelo sumiu");
  const criado = await req("POST", "/briefings", {
    client_id: cliente, termos: { template_id: 999999, value: 500 },
  }, H);
  await req("PUT", `/briefing/${criado.token}`, { respostas: respostasCompletas() });
  const enviado = await req("POST", `/briefing/${criado.token}/enviar`);
  assert.equal(enviado.st, 200, "o cliente já respondeu tudo: não pode levar erro na cara");
  assert.equal(enviado.contrato, false);
  const avisos = db.prepare("SELECT message FROM notifications WHERE client_id = ?").all(cliente).map((a) => a.message);
  assert.ok(avisos.some((m) => /Não deu para gerar o contrato/.test(m)), `avisos: ${avisos.join(" | ")}`);
});

test("reenviar não cria um segundo contrato para o mesmo cliente", async () => {
  const cliente = novoCliente("Clicou duas vezes");
  const modelo = db.prepare("INSERT INTO contract_templates (org_id, name, body) VALUES (?, ?, ?)")
    .run(org, "Simples", "Contrato de {{cliente}} por {{valor}}.").lastInsertRowid;
  const criado = await req("POST", "/briefings", {
    client_id: cliente, termos: { template_id: modelo, value: 700, start_date: "2026-09-01", end_date: "2026-12-31" },
  }, H);
  await req("PUT", `/briefing/${criado.token}`, { respostas: respostasCompletas() });
  await req("POST", `/briefing/${criado.token}/enviar`);
  await req("POST", `/briefing/${criado.token}/enviar`);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM contracts WHERE client_id = ?").get(cliente).n, 1);
});

test("a agência corrige os termos depois, sem trocar o link do cliente", async () => {
  const cliente = novoCliente("Corrigiu o valor");
  const criado = await req("POST", "/briefings", {
    client_id: cliente, termos: { value: 1000, servico: "Gestão" },
  }, H);
  const corrigido = await req("PUT", `/briefings/${criado.id}/termos`, {
    termos: { value: 1800, servico: "Gestão completa", start_date: "2026-09-01", end_date: "2027-02-28" },
  }, H);
  assert.equal(corrigido.st, 200);
  assert.equal(corrigido.termos.value, 1800);
  assert.equal(corrigido.termos.duration_months, 6);
  assert.equal(corrigido.token, criado.token, "o link mandado para o cliente continua o mesmo");
});

test("data e número tortos não entram nos termos", async () => {
  const cliente = novoCliente("Digitou errado");
  const criado = await req("POST", "/briefings", {
    client_id: cliente,
    termos: { value: "mil reais", start_date: "01/09/2026", end_date: "2027-02-28", itens: [{ label: "", quantidade: 3 }] },
  }, H);
  assert.equal(criado.termos.start_date, null, "data fora do formato não vale");
  assert.equal(criado.termos.value, 0);
  assert.deepEqual(criado.termos.itens, [], "entrega sem nome não vira marcador");
});
