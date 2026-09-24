// LANDING PAGES: A LP SEMPRE TEM RENOVAÇÃO AGENDADA.
//
// É a garantia que sustenta o módulo. Uma LP publicada sem renovação agendada
// é um cliente que ninguém vai cobrar e um site que cai sozinho no aniversário
// — o pior jeito de descobrir um esquecimento.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-lp-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { rodaAvisosDeRenovacao } = await import("../src/lp-alertas.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const landingRoutes = (await import("../src/routes/landing.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa das LPs',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','k','k@lp.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const marcelo = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo Lemos','active',?)").run(org).lastInsertRowid;
const ana = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Dra. Ana','active',?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/landing", landingRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/landing`;
const auth = { "content-type": "application/json",
               authorization: `Bearer ${jwt.sign({ id: uid, org_id: org, role: "admin" }, JWT_SECRET)}` };
const chamar = (m, c, corpo) => fetch(`${B}${c}`, {
  method: m, headers: auth, body: corpo ? JSON.stringify(corpo) : undefined });

let lp;

test("cadastrar a venda já agenda a renovação do primeiro ano", async () => {
  const r = await chamar("POST", "", {
    client_id: marcelo, nicho: "Advocacia", valor: 1000, forma_pagamento: "Pix", parcelas: 2,
    status_pagamento: "parcial", contrato_assinado_em: "2026-02-10",
    publicado_em: "2026-03-01", endereco: "advogadomarcelolemos.com.br",
  });
  assert.equal(r.status, 201);
  lp = await r.json();
  assert.equal(lp.vence_em, "2027-03-01", "publicação + 12 meses");
  assert.equal(lp.renovacoes.length, 1);
  assert.equal(lp.renovacoes[0].valor, 300, "o padrão da renovação");
});

test("o valor padrão da venda é R$ 1.000 quando ela não diz", async () => {
  const r = await (await chamar("POST", "", { client_id: ana, publicado_em: "2026-05-20" })).json();
  assert.equal(r.valor, 1000);
  assert.equal(r.vence_em, "2027-05-20");
});

test("sem data de publicação não inventa renovação", async () => {
  const outro = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Sem site','active',?)").run(org).lastInsertRowid;
  const r = await (await chamar("POST", "", { client_id: outro, nicho: "Odontologia" })).json();
  assert.equal(r.vence_em, null);
  assert.equal(r.renovacoes.length, 0, "nada a cobrar enquanto o site não foi ao ar");
});

test("corrigir a data de publicação move o vencimento junto", async () => {
  const r = await (await chamar("PUT", `/${lp.id}`, { publicado_em: "2026-03-15" })).json();
  assert.equal(r.vence_em, "2027-03-15", "a cobrança sairia no dia errado se não acompanhasse");
  assert.equal(r.renovacoes.length, 1, "e não cria uma segunda renovação");
});

test("marcar a renovação como paga já agenda a do ano seguinte", async () => {
  const atual = (await (await chamar("GET", `/${lp.id}`)).json()).proxima_renovacao;
  const r = await (await chamar("PUT", `/${lp.id}/renovacao/${atual.id}`,
    { status: "pago", pago_em: "2027-03-10" })).json();
  assert.equal(r.vence_em, "2028-03-15", "o ciclo continua sozinho");
  assert.equal(r.renovacoes.length, 2);
  const paga = r.renovacoes.find((x) => x.ano === 1);
  assert.equal(paga.status, "pago");
  assert.equal(paga.pago_em, "2027-03-10");
});

test("o histórico guarda ano, valor e data do pagamento", async () => {
  const r = await (await chamar("GET", `/${lp.id}`)).json();
  const ano1 = r.renovacoes.find((x) => x.ano === 1);
  assert.deepEqual(
    { ano: ano1.ano, valor: ano1.valor, pago_em: ano1.pago_em },
    { ano: 1, valor: 300, pago_em: "2027-03-10" },
  );
});

test("o domínio no Registro.br pode vencer em data diferente da publicação", async () => {
  const r = await (await chamar("PUT", `/${lp.id}`, { dominio_vence_em: "2027-04-02" })).json();
  assert.equal(r.dominio_vence_em, "2027-04-02");
  assert.equal(r.vence_em, "2028-03-15", "e uma coisa não mexe na outra");
});

test("a lista vem do vencimento mais próximo para o mais longe, e quem não publicou vai para o fim", async () => {
  const lista = await (await chamar("GET", "")).json();
  const comData = lista.filter((l) => l.vence_em);
  const ordenada = [...comData].sort((a, b) => a.vence_em.localeCompare(b.vence_em));
  assert.deepEqual(comData.map((l) => l.id), ordenada.map((l) => l.id));
  assert.equal(lista[lista.length - 1].vence_em, null);
});

test("a mensagem de renovação sai pronta, com o nome do cliente e o site", async () => {
  const { mensagem } = await (await chamar("GET", `/${lp.id}/mensagem`)).json();
  assert.match(mensagem, /Marcelo Lemos/);
  assert.match(mensagem, /advogadomarcelolemos\.com\.br/);
  assert.match(mensagem, /R\$ 300,00/);
  assert.match(mensagem, /Casa das LPs/);
});

test("pedidos de alteração ficam registrados com o valor cobrado", async () => {
  await chamar("POST", `/${lp.id}/alteracoes`, { descricao: "Trocar o telefone do rodapé", valor: 80, cobrado: true });
  const r = await (await chamar("GET", `/${lp.id}`)).json();
  assert.equal(r.alteracoes.length, 1);
  assert.equal(r.alteracoes[0].valor, 80);
  assert.equal(r.alteracoes[0].cobrado, 1);
});

test("alteração sem descrição é recusada", async () => {
  const r = await chamar("POST", `/${lp.id}/alteracoes`, { valor: 50 });
  assert.equal(r.status, 400);
});

// ---------------------------------------------------------------------------
// O RELATÓRIO
// ---------------------------------------------------------------------------
test("o relatório mostra o que vence, o que atrasou e quanto vem pela frente", async () => {
  // Uma LP que já venceu e não foi paga.
  const atrasado = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Atrasadinho','active',?)").run(org).lastInsertRowid;
  const velha = await (await chamar("POST", "", {
    client_id: atrasado, nicho: "Odontologia", valor: 1200, publicado_em: "2020-01-10",
    endereco: "clinicavelha.com.br",
  })).json();

  const rel = await (await chamar("GET", "/relatorio")).json();
  assert.ok(rel.atrasadas.some((l) => l.id === velha.id), "quem passou do vencimento aparece em atrasadas");
  assert.ok(rel.receita_prevista_12m >= 300, "soma o que vai vencer nos próximos 12 meses");
  assert.ok(rel.no_ar >= 4);
  assert.ok(rel.nichos.includes("Advocacia") && rel.nichos.includes("Odontologia"));
});

test("o filtro por nicho separa de verdade", async () => {
  const rel = await (await chamar("GET", "/relatorio?nicho=Advocacia")).json();
  assert.ok(!rel.atrasadas.some((l) => l.nicho === "Odontologia"));
});

test("LP cancelada sai da conta do que está no ar", async () => {
  const r = await (await chamar("PUT", `/${lp.id}`, { status: "cancelada" })).json();
  assert.equal(r.status, "cancelada");
  const rel = await (await chamar("GET", "/relatorio")).json();
  assert.equal(rel.canceladas, 1);
  assert.ok(!rel.proximas.some((l) => l.id === lp.id), "cancelada não entra na fila de cobrança");
});

// ---------------------------------------------------------------------------
// OS AVISOS
// ---------------------------------------------------------------------------
test("o aviso sai sozinho na hora certa, e não sai de novo no dia seguinte", async () => {
  const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Vence Já','active',?)").run(org).lastInsertRowid;
  // Publicada de modo que a renovação vença daqui a 30 dias.
  const hoje = new Date();
  const em30 = new Date(hoje.getTime() + 30 * 86400000);
  const publicado = `${em30.getUTCFullYear() - 1}-${String(em30.getUTCMonth() + 1).padStart(2, "0")}-${String(em30.getUTCDate()).padStart(2, "0")}`;
  await chamar("POST", "", { client_id: cli, publicado_em: publicado, endereco: "vencejá.com.br" });

  const antes = db.prepare("SELECT COUNT(*) n FROM notifications WHERE org_id = ?").get(org).n;
  const r1 = rodaAvisosDeRenovacao();
  assert.ok(r1.avisos >= 1, "criou o aviso");
  const depois = db.prepare("SELECT COUNT(*) n FROM notifications WHERE org_id = ?").get(org).n;
  assert.ok(depois > antes);

  const r2 = rodaAvisosDeRenovacao();
  assert.equal(r2.avisos, 0, "rodar de novo não repete o mesmo aviso");
});

test("o aviso fala com ela: diz quem, qual site e o que fazer", () => {
  const aviso = db.prepare(
    "SELECT message FROM notifications WHERE org_id = ? ORDER BY id DESC LIMIT 1"
  ).get(org);
  assert.match(aviso.message, /Vence Já/);
  assert.match(aviso.message, /cobran/i);
});

test("LP de outra casa não aparece nem abre", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const outroU = db.prepare(
    "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('V','v','v@lp.com',?,'admin',1,?)"
  ).run(hashPassword("x"), outra).lastInsertRowid;
  const t = { authorization: `Bearer ${jwt.sign({ id: outroU, org_id: outra, role: "admin" }, JWT_SECRET)}` };
  assert.deepEqual(await (await fetch(B, { headers: t })).json(), []);
  assert.equal((await fetch(`${B}/${lp.id}`, { headers: t })).status, 404);
});

test("não dá para pendurar uma LP num cliente de outra casa", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Outra',0)").run().lastInsertRowid;
  const dela = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Dela','active',?)").run(outra).lastInsertRowid;
  const r = await chamar("POST", "", { client_id: dela, publicado_em: "2026-01-01" });
  assert.equal(r.status, 400);
});

after(() => { srv.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
