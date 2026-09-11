// VÍDEO: o navegador só consegue tocar (e arrastar a barrinha) quando o
// servidor responde por TRECHOS — Range: bytes=... Sem isso ele precisa baixar
// o arquivo inteiro antes de desenhar qualquer coisa; num reel de 200 MB,
// parece que o vídeo "não carrega".
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-vid-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const portalRoutes = (await import("../src/routes/portal.js")).default;
const { default: filesRoutes, sharedRouter } = await import("../src/routes/files.js");
const distribution = (await import("../src/routes/distribution.js")).default;

const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES ('Casa do Vídeo', 0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@vid.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cliente = db.prepare(
  "INSERT INTO clients (name,status,org_id,portal_username,portal_password_hash) VALUES ('Cine','active',?,'cine',?)"
).run(org, hashPassword("segredo123")).lastInsertRowid;

// Um "vídeo" de 1 MB no disco — o suficiente para pedir um trecho dele.
const caminho = join(dir, "reel-bruto");
const CONTEUDO = Buffer.alloc(1024 * 1024, 7);
writeFileSync(caminho, CONTEUDO);
const arquivo = db.prepare(
  `INSERT INTO files (client_id, original_name, mime, size, stored_path, stage, org_id)
   VALUES (?, 'reel de setembro.mov', 'video/quicktime', ?, ?, 'editados', ?)`
).run(cliente, CONTEUDO.length, caminho, org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/portal", portalRoutes);
// O link assinado vem ANTES do login, igual ao index.js.
app.use("/api/files", sharedRouter);
app.use("/api/files", filesRoutes);
app.use("/api/distribution", distribution);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

const { token: portalToken } = await fetch(`${B}/portal/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "cine", password: "segredo123" }),
}).then((r) => r.json());

test("a área do cliente entrega o vídeo por trechos, não inteiro", async () => {
  const r = await fetch(`${B}/portal/files/${arquivo}/download`, {
    headers: { authorization: `Bearer ${portalToken}`, range: "bytes=0-1023" },
  });
  assert.equal(r.status, 206, "tem que responder 206 (trecho), não 200 (arquivo todo)");
  assert.equal(r.headers.get("accept-ranges"), "bytes");
  const corpo = Buffer.from(await r.arrayBuffer());
  assert.equal(corpo.length, 1024, "veio só o pedaço pedido");
});

test("o .mov sai rotulado como mp4 — é assim que o Chrome toca vídeo de iPhone", async () => {
  const r = await fetch(`${B}/portal/files/${arquivo}/download`, {
    headers: { authorization: `Bearer ${portalToken}` },
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /video\/mp4/);
});

test("a Distribuição manda o endereço de streaming junto da peça", async () => {
  db.prepare("INSERT INTO kanban_stages (name, position, is_done, org_id) VALUES ('Distribuição', 4, 0, ?)").run(org);
  const etapa = db.prepare("SELECT id FROM kanban_stages WHERE name = 'Distribuição' AND org_id = ?").get(org).id;
  const peca = db.prepare(
    "INSERT INTO tasks (title, content_type, client_id, org_id, approval_status, stage_id) VALUES ('Reel de setembro','reel',?,?,'pending',?)"
  ).run(cliente, org, etapa).lastInsertRowid;
  db.prepare("INSERT INTO task_attachments (task_id, file_id) VALUES (?, ?)").run(peca, arquivo);

  const d = await fetch(`${B}/distribution`, { headers: H }).then((r) => r.json());
  const item = (d.items || []).find((i) => i.id === peca);
  assert.ok(item, "a peça tem que estar na lista");
  assert.match(item.media_url || "", /^\/api\/files\/shared\//,
    "sem o endereço de streaming, a tela baixa o vídeo inteiro antes de mostrar o 1º quadro");
});

test("o endereço de streaming funciona sem login e também responde por trechos", async () => {
  const d = await fetch(`${B}/distribution`, { headers: H }).then((r) => r.json());
  const url = d.items.find((i) => i.media_url)?.media_url;
  // Sem cabeçalho de autenticação: é assim que a tag <video> carrega.
  const r = await fetch(`${B.replace("/api", "")}${url}`, { headers: { range: "bytes=0-99" } });
  assert.equal(r.status, 206);
  assert.equal((await r.arrayBuffer()).byteLength, 100);
});

test("endereço de streaming inventado não abre nada", async () => {
  const r = await fetch(`${B}/files/shared/token-falso`);
  assert.equal(r.status, 403);
});
