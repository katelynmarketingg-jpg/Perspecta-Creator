// A ASSINATURA DA CASA NO CONTRATO.
//
// Pedido dela, no Onboarding: saber "se a minha assinatura já foi coletada ou
// falta assinar, e mesma coisa a dela". Não dava: o contrato só guardava a
// assinatura do CLIENTE — a da agência não existia em lugar nenhum.
//
// Escolha dela, entre três: "assino uma vez e o sistema reusa". A assinatura da
// casa já existia para os recibos (organizations.signature_img); aqui ela passa
// a valer no contrato também.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-casa-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const contracts = (await import("../src/routes/contracts.js")).default;

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Assinatura da Casa',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@c.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo','active',?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use("/api/contracts", contracts);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/contracts`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => { srv.close(); db.close(); });

const req = (m, u, corpo) => fetch(B + u, {
  method: m, headers: H, body: corpo ? JSON.stringify(corpo) : undefined,
}).then(async (r) => ({ st: r.status, corpo: await r.json().catch(() => ({})) }));

const novoContrato = (texto = "CONTRATANTE\n{{assinatura_cliente}}\nCONTRATADA\n{{assinatura_perspecta}}") =>
  db.prepare("INSERT INTO contracts (client_id,title,value,status,notes,org_id) VALUES (?,'Gestão',1500,'active',?,?)")
    .run(cli, texto, org).lastInsertRowid;
const ler = (id) => db.prepare("SELECT * FROM contracts WHERE id=?").get(id);

test("sem assinatura guardada, o sistema DIZ ONDE desenhar — não dá erro seco", async () => {
  const id = novoContrato();
  const r = await req("POST", `/${id}/assinar-como-casa`);
  assert.equal(r.st, 400);
  assert.equal(r.corpo.falta_assinatura, true);
  assert.match(r.corpo.error, /Recibos/, "o caminho exato, não um 'configure primeiro'");
  assert.equal(ler(id).agency_signed_at, null);
});

test("com a assinatura da casa guardada, assinar funciona", async () => {
  db.prepare("UPDATE organizations SET signature_img=?, signer_name=?, signer_document=? WHERE id=?")
    .run(PNG, "Katelyn Santos", "123.456.789-09", org);
  const id = novoContrato();
  const r = await req("POST", `/${id}/assinar-como-casa`);
  assert.equal(r.st, 200);
  const c = ler(id);
  assert.ok(c.agency_signed_at);
  assert.equal(c.agency_signer_name, "Katelyn Santos");
  assert.equal(c.agency_signature_img, PNG);
});

test("a assinatura é CÓPIA, não espelho: trocar a da casa não reescreve a firmada", async () => {
  const id = novoContrato();
  await req("POST", `/${id}/assinar-como-casa`);
  db.prepare("UPDATE organizations SET signature_img='data:image/png;base64,OUTRA', signer_name='Outro Nome' WHERE id=?").run(org);
  const c = ler(id);
  assert.equal(c.agency_signer_name, "Katelyn Santos", "o que foi firmado ontem fica como foi firmado");
  assert.equal(c.agency_signature_img, PNG);
  db.prepare("UPDATE organizations SET signature_img=?, signer_name=? WHERE id=?").run(PNG, "Katelyn Santos", org);
});

test("assinar duas vezes é recusado", async () => {
  const id = novoContrato();
  await req("POST", `/${id}/assinar-como-casa`);
  const r = await req("POST", `/${id}/assinar-como-casa`);
  assert.equal(r.st, 400);
  assert.match(r.corpo.error, /já tem a sua assinatura/i);
});

test("dá para tirar a assinatura de um contrato que o cliente ainda não assinou", async () => {
  const id = novoContrato();
  await req("POST", `/${id}/assinar-como-casa`);
  assert.equal((await req("DELETE", `/${id}/assinar-como-casa`)).st, 200);
  assert.equal(ler(id).agency_signed_at, null);
});

test("depois do cliente assinar, tirar a sua é RECUSADO — ficaria assinado por um lado só", async () => {
  const id = novoContrato();
  await req("POST", `/${id}/assinar-como-casa`);
  db.prepare("UPDATE contracts SET signed_at=datetime('now'), signer_name='Marcelo' WHERE id=?").run(id);
  const r = await req("DELETE", `/${id}/assinar-como-casa`);
  assert.equal(r.st, 400);
  assert.match(r.corpo.error, /assinado por um lado só/);
  assert.ok(ler(id).agency_signed_at, "continua assinada");
});

test("gerar o link de assinatura marca que mandamos", async () => {
  const id = novoContrato();
  assert.equal(ler(id).sent_at, null);
  await req("POST", `/${id}/sign-link`);
  assert.ok(ler(id).sent_at, "é esse o 'já mandamos?' do painel");
});

test("contrato de outra casa não aceita a assinatura daqui", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha da Assinatura',0)").run().lastInsertRowid;
  const id = db.prepare("INSERT INTO contracts (client_id,title,value,status,notes,org_id) VALUES (?,'X',1,'active','',?)")
    .run(cli, outra).lastInsertRowid;
  assert.equal((await req("POST", `/${id}/assinar-como-casa`)).st, 404);
});

// --- onde cada assinatura fica ---------------------------------------------------

const { comAssinaturas, temMarcadores } = await import("../../client/src/assinaturas-no-contrato.js");

test("sem assinatura, o marcador vira a linha de sempre — dá para imprimir e assinar à caneta", () => {
  const out = comAssinaturas("CONTRATANTE\n{{assinatura_cliente}}", {});
  assert.match(out, /_{10,}/);
  assert.doesNotMatch(out, /\{\{/, "o marcador não pode vazar para o papel");
});

test("com assinatura, o desenho entra no lugar marcado", () => {
  const out = comAssinaturas("{{assinatura_perspecta}}", {
    agency_signature_img: PNG, agency_signer_name: "Katelyn", agency_signed_at: "2026-10-23 12:00",
  });
  assert.match(out, /<img src="data:image\/png/);
  assert.match(out, /Katelyn/);
  assert.doesNotMatch(out, /\{\{/);
});

test("cada marcador pega a assinatura DELE, não a do outro", () => {
  const out = comAssinaturas("A:{{assinatura_cliente}} B:{{assinatura_perspecta}}", {
    signature_img: "data:image/png;base64,CLIENTE", signer_name: "Marcelo", signed_at: "2026-10-23 12:00",
    agency_signature_img: "data:image/png;base64,CASA", agency_signer_name: "Katelyn", agency_signed_at: "2026-10-23 13:00",
  });
  const [antes, depois] = out.split("B:");
  assert.match(antes, /Marcelo/);
  assert.doesNotMatch(antes, /Katelyn/);
  assert.match(depois, /Katelyn/);
});

test("o modelo da casa já vem com os dois lugares marcados", () => {
  const modelo = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../src/contract-model.js"), "utf8");
  assert.match(modelo, /\{\{assinatura_cliente\}\}/);
  assert.match(modelo, /\{\{assinatura_perspecta\}\}/);
  assert.ok(temMarcadores(modelo));
});

test("o marcador atravessa a GERAÇÃO do contrato — a assinatura chega depois", async () => {
  const { preencher } = await import("../src/contract-gen.js");
  const out = preencher("{{cidade}} {{assinatura_cliente}}", { cidade: "Curitiba" });
  assert.match(out, /Curitiba/);
  assert.match(out, /\{\{assinatura_cliente\}\}/, "quem troca este é a tela, na hora de mostrar");
});
