// AUDITORIA DA ASSINATURA — a parte de risco jurídico.
//
// O achado grave: o contrato ASSINADO podia ser reescrito depois, e a tela
// continuava dizendo "assinado por Fulano em tal data" sobre um texto que
// Fulano nunca leu. O hash era gravado na assinatura e nunca mais conferido.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-ass-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const { signRouter, makeSignToken, conferirAssinatura } = await import("../src/routes/sign.js");
const contracts = (await import("../src/routes/contracts.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Assinatura',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@ass.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo','active',?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use("/api/sign", signRouter);
app.use("/api/contracts", contracts);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
const J = { "content-type": "application/json" };
after(() => srv.close());

const req = (m, u, corpo, cab) => fetch(B + u, {
  method: m, headers: cab || J, body: corpo ? JSON.stringify(corpo) : undefined,
}).then(async (r) => ({ st: r.status, ...(await r.json().catch(() => ({}))) }));

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function novoContrato(texto = "Cláusula primeira: o combinado é este.") {
  return db.prepare(
    "INSERT INTO contracts (client_id,title,value,status,notes,org_id) VALUES (?,'Gestão de redes',1500,'active',?,?)"
  ).run(cli, texto, org).lastInsertRowid;
}
const assinar = (id, extra = {}) => req("POST", `/sign/${makeSignToken(id)}`, {
  signer_name: "Marcelo Augusto", signer_document: "04009664096", agreed: true, signature_img: PNG, ...extra,
});

test("assinar grava nome, documento, data, IP e a impressão digital do texto", async () => {
  const id = novoContrato();
  assert.equal((await assinar(id)).st, 200);
  const c = db.prepare("SELECT * FROM contracts WHERE id = ?").get(id);
  assert.ok(c.signed_at, "data da assinatura");
  assert.equal(c.signer_name, "Marcelo Augusto");
  assert.equal(c.signer_document, "04009664096");
  assert.ok(c.signed_hash?.length === 64, "hash sha256 do documento assinado");
  assert.ok(c.signature_img?.startsWith("data:image/"), "o desenho da assinatura");
  assert.equal(conferirAssinatura(c), "ok");
});

test("assinar duas vezes não sobrescreve a primeira assinatura", async () => {
  const id = novoContrato();
  await assinar(id);
  const antes = db.prepare("SELECT signer_name, signed_at FROM contracts WHERE id = ?").get(id);
  const segunda = await assinar(id, { signer_name: "Outra Pessoa" });
  assert.equal(segunda.st, 400);
  const depois = db.prepare("SELECT signer_name, signed_at FROM contracts WHERE id = ?").get(id);
  assert.deepEqual(depois, antes, "nada pode ter mudado");
});

test("REESCREVER um contrato assinado é recusado — a assinatura viraria mentira", async () => {
  const id = novoContrato("O valor é de R$ 1.500,00 por mês.");
  await assinar(id);

  const r = await req("PUT", `/contracts/${id}`, { notes: "O valor é de R$ 5.000,00 por mês." }, H);
  assert.equal(r.st, 409, "tem que recusar");
  assert.match(r.error, /já foi assinado/);
  assert.deepEqual(r.campos, ["notes"]);

  const c = db.prepare("SELECT notes FROM contracts WHERE id = ?").get(id);
  assert.match(c.notes, /1\.500,00/, "o texto original tem que continuar intacto");
});

test("mudar o VALOR ou o TÍTULO de um assinado também é recusado", async () => {
  const id = novoContrato();
  await assinar(id);
  assert.equal((await req("PUT", `/contracts/${id}`, { value: 9999 }, H)).st, 409);
  assert.equal((await req("PUT", `/contracts/${id}`, { title: "Outro contrato" }, H)).st, 409);
  const c = db.prepare("SELECT value, title FROM contracts WHERE id = ?").get(id);
  assert.equal(c.value, 1500);
  assert.equal(c.title, "Gestão de redes");
});

test("o que NÃO foi assinado continua editável (status, datas de cobrança)", async () => {
  const id = novoContrato();
  await assinar(id);
  const r = await req("PUT", `/contracts/${id}`, { status: "ended", first_due_date: "2026-10-10" }, H);
  assert.equal(r.st, 200);
  assert.equal(r.status, "ended");
});

test("texto adulterado por fora é DENUNCIADO, não passa despercebido", async () => {
  const id = novoContrato("Texto original.");
  await assinar(id);
  // Alguém mexeu direto no banco — é o cenário de quem já tem um contrato
  // adulterado de antes desta trava existir.
  db.prepare("UPDATE contracts SET notes = ? WHERE id = ?").run("Texto TROCADO depois da assinatura.", id);

  const c = db.prepare("SELECT * FROM contracts WHERE id = ?").get(id);
  assert.equal(conferirAssinatura(c), "alterado");

  const lista = await fetch(`${B}/contracts`, { headers: H }).then((r) => r.json());
  assert.equal(lista.find((x) => x.id === id).integridade, "alterado",
    "a tela precisa mostrar isso — senão ninguém descobre");

  const publico = await req("GET", `/sign/${makeSignToken(id)}`);
  assert.equal(publico.integridade, "alterado", "quem abrir o link também tem que ver");
});

test("contrato não assinado não acusa nada", async () => {
  const id = novoContrato();
  const lista = await fetch(`${B}/contracts`, { headers: H }).then((r) => r.json());
  assert.equal(lista.find((x) => x.id === id).integridade, null);
  const r = await req("PUT", `/contracts/${id}`, { notes: "Ainda dá para ajustar." }, H);
  assert.equal(r.st, 200, "antes de assinar, editar é normal");
});

test("link inventado, expirado ou de outro fim não abre contrato nenhum", async () => {
  assert.equal((await req("GET", "/sign/token-falso")).st, 403);
  const outroFim = jwt.sign({ purpose: "outra-coisa", contract_id: novoContrato() }, JWT_SECRET);
  assert.equal((await req("GET", `/sign/${outroFim}`)).st, 403);
  const vencido = jwt.sign({ purpose: "sign", contract_id: novoContrato() }, JWT_SECRET, { expiresIn: "-1s" });
  assert.equal((await req("GET", `/sign/${vencido}`)).st, 403);
});

test("assinar sem nome, sem documento, sem concordar ou sem desenho é recusado", async () => {
  const id = novoContrato();
  const semNome = await assinar(id, { signer_name: "" });
  assert.equal(semNome.st, 400);
  assert.equal((await assinar(id, { agreed: false })).st, 400);
  assert.equal((await assinar(id, { signature_img: "" })).st, 400);
  assert.equal((await assinar(id, { signer_document: "123" })).st, 400, "documento de 3 dígitos não é CPF nem CNPJ");
  assert.equal(db.prepare("SELECT signed_at FROM contracts WHERE id = ?").get(id).signed_at, null);
});

test("desenho gigante é recusado, para não entupir o banco", async () => {
  const id = novoContrato();
  const enorme = "data:image/png;base64," + "A".repeat(400001);
  assert.equal((await assinar(id, { signature_img: enorme })).st, 400);
});
