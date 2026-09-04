// A prévia do feed (aba do cliente) mostrava "sem arte" no lugar das fotos.
// Motivo: o arquivo é gravado SEM extensão, então o portal servia tudo como
// "application/octet-stream" — e o navegador se recusa a desenhar um blob desse
// tipo dentro de <img>. Estes testes sobem o router do portal de verdade e
// conferem o que a prévia recebe.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-feed-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword } = await import("../src/auth.js");
const express = (await import("express")).default;
const portal = (await import("../src/routes/portal.js")).default;

const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES ('Feed', 0)").run().lastInsertRowid;
const cliente = db.prepare(
  `INSERT INTO clients (name, status, portal_username, portal_password_hash, org_id)
   VALUES ('Cliente', 'active', 'cliente', ?, ?)`
).run(hashPassword("segredo"), org).lastInsertRowid;

// Grava o arquivo com nome SEM extensão, exatamente como o upload faz.
let n = 0;
function arquivo(nomeOriginal, mime, bytes, thumb = null) {
  const caminho = join(dir, `arq-${++n}`);
  writeFileSync(caminho, bytes);
  return db.prepare(
    `INSERT INTO files (client_id, original_name, mime, size, stored_path, stage, thumb, org_id)
     VALUES (?, ?, ?, ?, ?, 'originais', ?, ?)`
  ).run(cliente, nomeOriginal, mime, bytes.length, caminho, thumb, org).lastInsertRowid;
}
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const foto = arquivo("arte.png", "image/png", PNG, "data:image/jpeg;base64,QUJD");
const video = arquivo("reel.mov", "video/quicktime", Buffer.from("00000018667479706d703432", "hex"));

const etapa = db.prepare("INSERT INTO kanban_stages (name, position, org_id) VALUES ('Feito', 1, ?)").run(org).lastInsertRowid;
function post(titulo, tipo, anexo, capa = null) {
  const t = db.prepare(
    `INSERT INTO tasks (title, client_id, stage_id, content_type, scheduled_at, cover_file_id, org_id)
     VALUES (?, ?, ?, ?, '2026-09-10 10:00', ?, ?)`
  ).run(titulo, cliente, etapa, tipo, capa, org).lastInsertRowid;
  db.prepare("INSERT INTO task_attachments (task_id, file_id) VALUES (?, ?)").run(t, anexo);
  return t;
}
post("Post foto", "feed", foto);
post("Carrossel", "carousel", video, foto);   // 1º anexo é vídeo, mas a capa é a foto
post("Reel", "reel", video);

const app = express();
app.use(express.json());
app.use("/api/portal", portal);
const servidor = app.listen(0);
await new Promise((r) => servidor.once("listening", r));
const base = `http://127.0.0.1:${servidor.address().port}/api/portal`;
after(() => { servidor.close(); });

const entrada = await fetch(`${base}/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "cliente", password: "segredo" }),
});
const { token } = await entrada.json();
const auth = { authorization: `Bearer ${token}` };
const feed = await (await fetch(`${base}/feed`, { headers: auth })).json();
const acha = (t) => feed.find((p) => p.title === t);

test("a foto sai com o tipo de imagem — sem isso o <img> não desenha nada", async () => {
  const r = await fetch(`${base}/files/${foto}/download`, { headers: auth });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
});

test("o vídeo sai como mp4, que o navegador toca (o .mov não)", async () => {
  const r = await fetch(`${base}/files/${video}/download`, { headers: auth });
  assert.equal(r.headers.get("content-type"), "video/mp4");
});

test("a grade usa a CAPA escolhida, não o primeiro anexo", () => {
  assert.equal(acha("Carrossel").file_id, foto);
  assert.equal(acha("Reel").file_id, video);
});

test("o feed já traz a miniatura e o tipo, para a grade sair leve", () => {
  assert.equal(acha("Post foto").thumb, "data:image/jpeg;base64,QUJD");
  assert.equal(acha("Post foto").mime, "image/png");
  assert.equal(acha("Reel").thumb, null);
  assert.equal(acha("Reel").mime, "video/quicktime");
});

test("arquivo de outro cliente continua barrado", async () => {
  const vizinho = db.prepare(
    "INSERT INTO clients (name, status, org_id) VALUES ('Vizinho', 'active', ?)"
  ).run(org).lastInsertRowid;
  const outro = db.prepare(
    `INSERT INTO files (client_id, original_name, mime, size, stored_path, stage, org_id)
     VALUES (?, 'x.png', 'image/png', 1, ?, 'originais', ?)`
  ).run(vizinho, join(dir, "arq-1"), org).lastInsertRowid;
  const r = await fetch(`${base}/files/${outro}/download`, { headers: auth });
  assert.equal(r.status, 404);
});

test("a galeria do cliente traz a miniatura junto (não baixa a arte inteira)", async () => {
  const g = await (await fetch(`${base}/gallery`, { headers: auth })).json();
  const todos = Object.values(g).flat();            // vem agrupado por etapa
  const item = todos.find((x) => x.id === foto);
  assert.equal(item.thumb, "data:image/jpeg;base64,QUJD");
});
