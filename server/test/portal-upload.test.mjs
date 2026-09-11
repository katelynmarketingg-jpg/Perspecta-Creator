// O CLIENTE mandando material pela área dele: cai em "Originais", na pasta
// dele, e a equipe é avisada. É uma porta aberta por senha — então tem trava:
// só imagem, vídeo e PDF, e nada sem token do portal.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-pup-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword } = await import("../src/auth.js");
const express = (await import("express")).default;
const portalRoutes = (await import("../src/routes/portal.js")).default;

const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES ('Casa do Portal', 0)").run().lastInsertRowid;
const cliente = db.prepare(
  "INSERT INTO clients (name, status, org_id, portal_username, portal_password_hash) VALUES ('Padaria', 'active', ?, 'padaria', ?)"
).run(org, hashPassword("segredo123")).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/portal", portalRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/portal`;
after(() => srv.close());

const { token } = await fetch(`${B}/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "padaria", password: "segredo123" }),
}).then((r) => r.json());
assert.ok(token, "o cliente tem que conseguir entrar");

/** Um PNG 1x1 de verdade — o multer olha o tipo declarado, o teste olha o resto. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function envia(arquivos, comToken = token) {
  const form = new FormData();
  for (const a of arquivos) form.append("files", new Blob([a.buf], { type: a.mime }), a.nome);
  return fetch(`${B}/upload`, {
    method: "POST",
    headers: comToken ? { authorization: `Bearer ${comToken}` } : {},
    body: form,
  }).then(async (r) => ({ st: r.status, corpo: await r.json().catch(() => ({})) }));
}

test("sem token do portal, ninguém manda nada", async () => {
  const r = await envia([{ nome: "a.png", mime: "image/png", buf: PNG }], null);
  assert.equal(r.st, 401);
});

test("a foto do cliente cai em Originais, na pasta dele", async () => {
  const r = await envia([{ nome: "fachada da padaria.png", mime: "image/png", buf: PNG }]);
  assert.equal(r.st, 201);
  assert.equal(r.corpo.length, 1);

  const f = db.prepare("SELECT * FROM files WHERE client_id = ?").get(cliente);
  assert.equal(f.stage, "originais", "tem que chegar como original");
  assert.equal(f.original_name, "fachada da padaria.png", "o nome com acento e espaço tem que sobreviver");
  assert.equal(f.org_id, org);
  const pasta = db.prepare("SELECT name FROM folders WHERE id = ?").get(f.folder_id);
  assert.equal(pasta.name, "Enviado pelo cliente");
});

test("a equipe é avisada, com o nome do cliente", () => {
  const avisos = db.prepare("SELECT message FROM notifications WHERE audience = 'agency' AND client_id = ?").all(cliente);
  assert.ok(avisos.some((a) => /Padaria mandou/.test(a.message)), `avisos: ${JSON.stringify(avisos)}`);
});

test("mandar de novo reaproveita a mesma pasta, em vez de criar outra", async () => {
  await envia([{ nome: "vitrine.png", mime: "image/png", buf: PNG }]);
  const pastas = db.prepare("SELECT COUNT(*) n FROM folders WHERE client_id = ?").get(cliente).n;
  assert.equal(pastas, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM files WHERE client_id = ?").get(cliente).n, 2);
});

test("arquivo que não é foto, vídeo nem PDF não entra", async () => {
  const antes = db.prepare("SELECT COUNT(*) n FROM files WHERE client_id = ?").get(cliente).n;
  const r = await envia([{ nome: "virus.exe", mime: "application/x-msdownload", buf: Buffer.from("MZ") }]);
  assert.equal(r.st, 400, "tem que recusar, com recado");
  assert.match(r.corpo.error || "", /foto ou v/i);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM files WHERE client_id = ?").get(cliente).n, antes);
});

test("o cliente só mexe no que é dele: o arquivo nasce com o org e o client dele", () => {
  const outro = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Outro','active',?)").run(org).lastInsertRowid;
  const meus = db.prepare("SELECT COUNT(*) n FROM files WHERE client_id = ?").get(outro).n;
  assert.equal(meus, 0, "nada do outro cliente pode ter sido tocado");
});

test("PDF (uma referência escaneada, por exemplo) é aceito", async () => {
  const r = await envia([{ nome: "referencia.pdf", mime: "application/pdf", buf: Buffer.from("%PDF-1.4\n") }]);
  assert.equal(r.st, 201);
});

test("mandar sem escolher arquivo devolve recado, não erro cru", async () => {
  const r = await fetch(`${B}/upload`, {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: new FormData(),
  }).then(async (x) => ({ st: x.status, corpo: await x.json().catch(() => ({})) }));
  assert.equal(r.st, 400);
  assert.match(r.corpo.error || "", /Escolha ao menos/);
});
