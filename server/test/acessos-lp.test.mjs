// A ÁREA DE ACESSOS: SENHA CRIPTOGRAFADA E COM TESTEMUNHA.
//
// Guardar a senha do Registro.br do cliente é necessário — e é a coisa mais
// perigosa que este sistema faz. Três garantias, e cada uma tem teste:
//
//  1. a senha NUNCA sai numa listagem, só quando alguém pede aquela senha;
//  2. no banco ela está criptografada, não em texto puro;
//  3. quem abriu fica registrado — sem testemunha, "mostrar senha" é um buraco
//     silencioso, e não dá para reagir se uma senha vazar.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-acessos-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const workspaceRoutes = (await import("../src/routes/workspace.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa dos Acessos',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katelyn','katy','k@a.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo','active',?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/workspace", workspaceRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/workspace`;
const token = jwt.sign({ id: uid, org_id: org, role: "admin" }, JWT_SECRET);
const auth = { "content-type": "application/json", authorization: `Bearer ${token}` };

const SENHA = "Registro#2026!doMarcelo";
let item;

test("guardar um acesso do cliente (Registro.br)", async () => {
  const r = await fetch(B, {
    method: "POST", headers: auth,
    body: JSON.stringify({
      client_id: cli, kind: "credential", title: "Registro.br",
      username: "040.096.640-96", secret: SENHA,
      url: "https://registro.br",
    }),
  });
  assert.equal(r.status, 201);
  item = await r.json();
});

test("a senha NÃO aparece na listagem — só o aviso de que existe", async () => {
  const lista = await (await fetch(`${B}?client_id=${cli}`, { headers: auth })).json();
  const achado = lista.find((i) => i.title === "Registro.br");
  assert.equal(achado.secret, null);
  assert.equal(achado.tem_senha, true);
  assert.equal(achado.username, "040.096.640-96", "o login pode aparecer; a senha não");
  assert.ok(!JSON.stringify(lista).includes(SENHA), "a senha não pode vazar em lugar nenhum da listagem");
});

test("no banco ela está criptografada, não em texto puro", () => {
  const linha = db.prepare("SELECT secret FROM workspace_items WHERE id = ?").get(item.id);
  assert.ok(linha.secret, "tem algo guardado");
  assert.ok(!linha.secret.includes(SENHA), "e esse algo NÃO é a senha legível");
  assert.match(linha.secret, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/, "iv:tag:dados — AES-GCM");
});

test("clicar em mostrar devolve a senha certa", async () => {
  const r = await fetch(`${B}/${item.id}/secret`, { headers: auth });
  assert.equal((await r.json()).secret, SENHA);
});

test("e quem viu fica registrado, com nome e hora", async () => {
  const hist = await (await fetch(`${B}/${item.id}/aberturas`, { headers: auth })).json();
  assert.ok(hist.length >= 1, "a abertura anterior foi registrada");
  assert.equal(hist[0].quem, "Katelyn");
  assert.match(hist[0].quando, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("cada abertura entra no histórico, não só a primeira", async () => {
  await fetch(`${B}/${item.id}/secret`, { headers: auth });
  const hist = await (await fetch(`${B}/${item.id}/aberturas`, { headers: auth })).json();
  assert.ok(hist.length >= 2);
});

test("acesso de outra casa não abre, nem o histórico dele", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const outroU = db.prepare(
    "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('V','v','v@a.com',?,'admin',1,?)"
  ).run(hashPassword("x"), outra).lastInsertRowid;
  const t = { authorization: `Bearer ${jwt.sign({ id: outroU, org_id: outra, role: "admin" }, JWT_SECRET)}` };
  assert.equal((await fetch(`${B}/${item.id}/secret`, { headers: t })).status, 404);
  assert.equal((await fetch(`${B}/${item.id}/aberturas`, { headers: t })).status, 404);
});

after(() => { srv.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
