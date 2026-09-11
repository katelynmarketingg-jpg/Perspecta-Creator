// ONDE OS ARQUIVOS ESTÃO: R2 ou disco. Existe para responder, sem abrir o
// Render, se o R2 está ligado e se está sendo usado de verdade — e para o
// endereço direto (assinado) não regredir para o repasse pelo servidor.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-arm-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { storageConfigured, isR2Path, r2Key, enderecoAssinado } = await import("../src/storage.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const { default: filesRoutes, sharedRouter } = await import("../src/routes/files.js");

const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES ('Casa do R2', 0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@r2.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cliente = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Cine','active',?)").run(org).lastInsertRowid;

const noDisco = join(dir, "arquivo-local");
writeFileSync(noDisco, Buffer.alloc(2048, 3));
const guarda = (nome, mime, caminho, tamanho) => db.prepare(
  `INSERT INTO files (client_id, original_name, mime, size, stored_path, stage, org_id)
   VALUES (?, ?, ?, ?, ?, 'editados', ?)`
).run(cliente, nome, mime, tamanho, caminho, org).lastInsertRowid;

guarda("foto-antiga.jpg", "image/jpeg", noDisco, 2048);
guarda("reel-antigo.mov", "video/quicktime", noDisco, 50_000_000);
guarda("reel-novo.mov", "video/quicktime", "r2:uploads/9/abc", 80_000_000);
guarda("foto-nova.jpg", "image/jpeg", "r2:uploads/9/def", 1_000_000);

const app = express();
app.use(express.json());
app.use("/api/files", sharedRouter);
app.use("/api/files", filesRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/files`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

test("a tela diz onde cada arquivo está — R2 e disco, separados", async () => {
  const r = await fetch(`${B}/armazenamento`, { headers: H }).then((x) => x.json());
  assert.equal(r.total, 4);
  assert.equal(r.no_r2, 2);
  assert.equal(r.no_disco, 2);
  assert.equal(r.videos_total, 2);
  assert.equal(r.videos_no_r2, 1, "o vídeo antigo ficou no disco: o R2 só vale do dia em que foi ligado");
  assert.equal(r.bytes_r2, 81_000_000);
  assert.equal(typeof r.r2_ligado, "boolean");
});

test("sem as variáveis do R2, o sistema diz que está desligado — e não finge", () => {
  // Neste ambiente de teste o R2 não está configurado; é o mesmo caminho de
  // quando alguém esquece de preencher as variáveis no Render.
  assert.equal(storageConfigured(), false);
});

test("sem R2 configurado não existe endereço direto — e quem chama não quebra", async () => {
  assert.equal(await enderecoAssinado("uploads/9/abc"), null,
    "tem que devolver null, e não derrubar a rota");
});

test("o caminho do arquivo diz sozinho onde ele está", () => {
  assert.equal(isR2Path("r2:uploads/9/abc"), true);
  assert.equal(isR2Path("/var/data/uploads/123"), false);
  assert.equal(r2Key("r2:uploads/9/abc"), "uploads/9/abc");
});

test("arquivo do disco continua sendo servido normalmente", async () => {
  const id = db.prepare("SELECT id FROM files WHERE stored_path = ? LIMIT 1").get(noDisco).id;
  const r = await fetch(`${B}/${id}/download`, { headers: H });
  assert.equal(r.status, 200);
  assert.equal((await r.arrayBuffer()).byteLength, 2048);
});
