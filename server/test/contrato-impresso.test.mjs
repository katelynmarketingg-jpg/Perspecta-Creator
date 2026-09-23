// O LOGO PRECISA CHEGAR NO CONTRATO DE VERDADE.
//
// O logo do contrato vivia só na prévia do modelo, na aba Serviços. O contrato
// que o cliente assina e que ela imprime saía sem marca nenhuma — a tela de
// contratos nunca soube que existia um logo.
//
// Agora o estilo (o logo e onde ele fica) é COPIADO para o contrato no momento
// em que ele é gerado. Copiado, e não lido do serviço na hora de imprimir: se
// ela trocar o logo do modelo amanhã, um contrato já assinado não pode mudar
// de cara.
//
// E o logo é uma imagem inteira em texto: ele não pode viajar na listagem de
// contratos, senão trinta contratos viram dezenas de megabytes por tela aberta.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-contrato-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { geraContrato } = await import("../src/contract-gen.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const contractsRoutes = (await import("../src/routes/contracts.js")).default;
const servicesRoutes = (await import("../src/routes/services.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Contrato',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@c.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare(
  "INSERT INTO clients (name,status,org_id,document,address,rep_name,rep_document) VALUES ('Padaria Sol','active',?,'12.345.678/0001-90','Rua A, 1','Zé','000')"
).run(org).lastInsertRowid;

// Um "logo" pequeno de verdade (PNG 1x1), como data URI.
const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const ESTILO = JSON.stringify({
  logo: LOGO,
  topo: { ativo: true, x: null, y: 16, w: 220 },
  rodape: { ativo: true, x: null, y: 8, w: 140 },
});

const svc = db.prepare(
  "INSERT INTO services (name, default_price, contract_template, contract_style, org_id) VALUES ('Gestão', 1500, ?, ?, ?)"
).run("<p>Contrato de {{servico}} para {{cliente}}.</p>", ESTILO, org).lastInsertRowid;

const app = express();
app.use(express.json({ limit: "15mb" }));
app.use("/api/contracts", contractsRoutes);
app.use("/api/services", servicesRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const token = jwt.sign({ id: uid, org_id: org, role: "admin" }, JWT_SECRET);
const auth = { "content-type": "application/json", authorization: `Bearer ${token}` };
const chamar = (m, c, corpo) => fetch(`${B}${c}`, {
  method: m, headers: auth, body: corpo ? JSON.stringify(corpo) : undefined,
});

let contrato;

test("o contrato gerado leva o estilo do serviço junto", () => {
  contrato = geraContrato(org, { client_id: cli, service_id: svc, servico: "Gestão", value: 1500 });
  const linha = db.prepare("SELECT style FROM contracts WHERE id = ?").get(contrato.id);
  assert.ok(linha.style, "sem isto o contrato assinado sai sem logo nenhum");
  const st = JSON.parse(linha.style);
  assert.equal(st.logo, LOGO);
  assert.equal(st.rodape.ativo, true);
});

test("o logo NÃO vem na listagem de contratos", async () => {
  const lista = await (await chamar("GET", "/contracts")).json();
  const c = lista.find((x) => x.id === contrato.id);
  assert.equal(c.style, undefined, "o logo inteiro em toda listagem seria megabytes por tela");
  assert.equal(c.tem_estilo, true, "mas a tela precisa saber que ele existe");
});

test("e vem quando a tela busca aquele contrato para imprimir", async () => {
  const c = await (await chamar("GET", `/contracts/${contrato.id}`)).json();
  assert.equal(JSON.parse(c.style).logo, LOGO);
});

test("contrato de outra casa não abre", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const outroU = db.prepare(
    "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('V','V','v@c.com',?,'admin',1,?)"
  ).run(hashPassword("x"), outra).lastInsertRowid;
  const t = jwt.sign({ id: outroU, org_id: outra, role: "admin" }, JWT_SECRET);
  const r = await fetch(`${B}/contracts/${contrato.id}`, { headers: { authorization: `Bearer ${t}` } });
  assert.equal(r.status, 404);
});

test("trocar o logo do modelo NÃO muda um contrato já gerado", async () => {
  await chamar("PUT", `/services/${svc}`, {
    contract_style: JSON.stringify({ logo: null, topo: { ativo: false }, rodape: { ativo: false } }),
  });
  const c = await (await chamar("GET", `/contracts/${contrato.id}`)).json();
  assert.equal(JSON.parse(c.style).logo, LOGO, "o contrato guarda a cara que tinha quando foi assinado");
});

test("logo grande demais é recusado, com o motivo", async () => {
  const gigante = JSON.stringify({ logo: `data:image/png;base64,${"A".repeat(600 * 1024)}` });
  const r = await chamar("PUT", `/services/${svc}`, { contract_style: gigante });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /grande demais/i);
});

test("serviço sem estilo nenhum continua gerando contrato, sem quebrar", () => {
  const simples = db.prepare(
    "INSERT INTO services (name, default_price, contract_template, org_id) VALUES ('Avulso', 500, ?, ?)"
  ).run("<p>Texto simples.</p>", org).lastInsertRowid;
  const c = geraContrato(org, { client_id: cli, service_id: simples, servico: "Avulso", value: 500 });
  const linha = db.prepare("SELECT style FROM contracts WHERE id = ?").get(c.id);
  assert.equal(linha.style, null);
});

after(() => { srv.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
