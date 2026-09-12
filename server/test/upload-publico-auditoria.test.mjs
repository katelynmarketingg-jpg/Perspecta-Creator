// AUDITORIA — Etapa 8: a porta MAIS aberta do sistema. Qualquer pessoa com o
// link do briefing envia arquivo, sem login. Se ela não tiver trava, o link
// vira hospedagem grátis — ou pior.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-upl-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const { briefingPublicRouter } = await import("../src/routes/briefing-public.js");
const briefings = (await import("../src/routes/briefings.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Upload',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@upl.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo','active',?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/briefing", briefingPublicRouter);
app.use("/api/briefings", briefings);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

const { token } = await fetch(`${B}/briefings`, {
  method: "POST", headers: H, body: JSON.stringify({ client_id: cli }),
}).then((r) => r.json());

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function manda(arquivos, alvo = token) {
  const form = new FormData();
  for (const a of arquivos) form.append("files", new Blob([a.buf], { type: a.mime }), a.nome);
  return fetch(`${B}/briefing/${alvo}/arquivos`, { method: "POST", body: form })
    .then(async (r) => ({ st: r.status, corpo: await r.json().catch(() => ({})) }));
}
const quantos = () => db.prepare("SELECT COUNT(*) n FROM files WHERE client_id = ?").get(cli).n;

test("foto e vídeo do cliente entram, na pasta dele", async () => {
  const r = await manda([{ nome: "foto da loja.png", mime: "image/png", buf: PNG }]);
  assert.equal(r.st, 201);
  const f = db.prepare("SELECT * FROM files WHERE client_id = ? ORDER BY id DESC LIMIT 1").get(cli);
  assert.equal(f.original_name, "foto da loja.png", "nome com espaço e acento sobrevive");
  assert.equal(f.org_id, org);
  const pasta = db.prepare("SELECT name FROM folders WHERE id = ?").get(f.folder_id);
  assert.equal(pasta.name, "Enviado pelo cliente");
});

test("executável, HTML e script NÃO entram", async () => {
  const antes = quantos();
  for (const a of [
    { nome: "virus.exe", mime: "application/x-msdownload", buf: Buffer.from("MZ") },
    { nome: "pagina.html", mime: "text/html", buf: Buffer.from("<script>alert(1)</script>") },
    { nome: "script.js", mime: "application/javascript", buf: Buffer.from("alert(1)") },
    { nome: "planilha.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf: Buffer.from("PK") },
  ]) {
    await manda([a]);
  }
  assert.equal(quantos(), antes, "nenhum deles pode ter entrado");
});

test("PDF entra — é referência escaneada, caso legítimo", async () => {
  const antes = quantos();
  const r = await manda([{ nome: "referencia.pdf", mime: "application/pdf", buf: Buffer.from("%PDF-1.4\n") }]);
  assert.equal(r.st, 201);
  assert.equal(quantos(), antes + 1);
});

test("nome de arquivo com caminho não escapa da pasta de uploads", async () => {
  await manda([{ nome: "../../../etc/passwd.png", mime: "image/png", buf: PNG }]);
  const f = db.prepare("SELECT stored_path, original_name FROM files WHERE client_id = ? ORDER BY id DESC LIMIT 1").get(cli);
  assert.ok(f.stored_path.startsWith(process.env.UPLOADS_DIR),
    `o arquivo foi parar fora da pasta: ${f.stored_path}`);
  assert.ok(!f.stored_path.includes(".."), "nenhum '..' no caminho guardado");
  // No disco, o nome é gerado pelo sistema — o que a pessoa mandou vira só rótulo.
  const noDisco = readdirSync(process.env.UPLOADS_DIR);
  assert.ok(!noDisco.some((n) => n.includes("passwd")), "o nome enviado não vira nome de arquivo");
});

test("mais de 10 de uma vez não passa", async () => {
  const antes = quantos();
  const muitos = Array.from({ length: 15 }, (_, i) => ({ nome: `f${i}.png`, mime: "image/png", buf: PNG }));
  await manda(muitos);
  assert.ok(quantos() - antes <= 10, `entraram ${quantos() - antes} de uma vez`);
});

test("link inventado não sobe nada", async () => {
  const antes = quantos();
  const r = await manda([{ nome: "a.png", mime: "image/png", buf: PNG }], "token-que-nao-existe");
  assert.equal(r.st, 404);
  assert.equal(quantos(), antes);
});

test("o que o cliente mandou aparece para ele — e só o dele", async () => {
  const lista = await fetch(`${B}/briefing/${token}/arquivos`).then((r) => r.json());
  assert.ok(Array.isArray(lista) && lista.length > 0);
  assert.ok(lista.every((f) => f.original_name), "cada item com nome");
  // A listagem pública não pode devolver o caminho do arquivo no servidor.
  assert.ok(!JSON.stringify(lista).includes(process.env.UPLOADS_DIR),
    "o caminho no disco não pode vazar para uma página pública");
});

test("o teto por briefing existe — o link não vira hospedagem grátis", async () => {
  const pasta = db.prepare("SELECT id FROM folders WHERE client_id = ? AND name = 'Enviado pelo cliente'").get(cli).id;
  // Enche até o teto, por dentro, e tenta passar por fora.
  const faltam = 200 - db.prepare("SELECT COUNT(*) n FROM files WHERE folder_id = ?").get(pasta).n;
  const ins = db.prepare(
    `INSERT INTO files (folder_id, client_id, original_name, mime, size, stored_path, stage, org_id)
     VALUES (?, ?, 'enchendo.png', 'image/png', 10, '/tmp/x', 'originais', ?)`
  );
  for (let i = 0; i < faltam; i++) ins.run(pasta, cli, org);
  const r = await manda([{ nome: "passou-do-teto.png", mime: "image/png", buf: PNG }]);
  assert.equal(r.st, 400);
  assert.match(r.corpo.error || "", /bastante coisa|equipe/i, "e com recado, não erro cru");
});
