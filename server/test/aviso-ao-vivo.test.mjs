// O AVISO AO VIVO QUE MANDAVA TODO MUNDO RECARREGAR À TOA.
//
// Depois de qualquer gravação, um aviso sai pelo canal ao vivo e as telas
// abertas recarregam a lista. A regra é automática (vale para as ~30 rotas de
// uma vez), e por isso pegava também rotas que NÃO gravam nada:
//
//   - a que garante as pastas padrão, chamada toda vez que alguém abre um
//     cliente na Galeria (é um POST, então avisava sempre);
//   - a que guarda a miniatura e a prévia — conserto interno, disparado por
//     CADA quadradinho da grade.
//
// Medido ao abrir um cliente com 120 arquivos: a lista de 1,25 MB era pedida
// três vezes, 3,75 MB para desenhar uma tela só. E o aviso vai para TODO MUNDO
// do escritório, não só para quem clicou.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-live-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { liveNotifier } = await import("../src/live.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const { default: filesRoutes } = await import("../src/routes/files.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Canal',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@canal.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Silva','active',?)").run(org).lastInsertRowid;
const arquivo = db.prepare(
  `INSERT INTO files (client_id, original_name, mime, size, stored_path, stage, org_id)
   VALUES (?, 'arte.png', 'image/png', 900, 'x', 'editados', ?)`
).run(cli, org).lastInsertRowid;

// Escuta o canal sem abrir socket: a mesma checagem que o liveNotifier faz.
const avisos = [];
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(liveNotifier);
app.use((req, res, next) => { res.on("finish", () => { if (!res.locals?.semAviso && req.method !== "GET") avisos.push(req.originalUrl); }); next(); });
app.use("/api/files", filesRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

test("a primeira vez cria as pastas padrão — e avisa, porque mudou de verdade", async () => {
  avisos.length = 0;
  const r = await fetch(`${B}/files/folders/ensure-defaults`, { method: "POST", headers: H, body: JSON.stringify({ client_id: cli }) });
  assert.equal(r.status, 200);
  assert.equal(avisos.length, 1, "criou pastas: avisar está certo");
});

test("da segunda vez em diante não cria nada — e não avisa ninguém", async () => {
  avisos.length = 0;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${B}/files/folders/ensure-defaults`, { method: "POST", headers: H, body: JSON.stringify({ client_id: cli }) });
    assert.equal(r.status, 200);
  }
  assert.deepEqual(avisos, [], "abrir um cliente não pode mandar o escritório inteiro recarregar");
});

test("guardar miniatura e prévia é conserto interno: não avisa", async () => {
  avisos.length = 0;
  const t = await fetch(`${B}/files/${arquivo}/thumb`, { method: "PUT", headers: H, body: JSON.stringify({ thumb: JPEG }) });
  assert.equal(t.status, 200);
  const p = await fetch(`${B}/files/${arquivo}/previa`, { method: "PUT", headers: H, body: JSON.stringify({ previa: JPEG }) });
  assert.equal(p.status, 200);
  // E a segunda tentativa (já tinha) também não.
  await fetch(`${B}/files/${arquivo}/thumb`, { method: "PUT", headers: H, body: JSON.stringify({ thumb: JPEG }) });
  await fetch(`${B}/files/${arquivo}/previa`, { method: "PUT", headers: H, body: JSON.stringify({ previa: JPEG }) });
  assert.deepEqual(avisos, [], "uma grade com 120 quadros mandaria 120 avisos");
});

test("mexer de verdade num arquivo continua avisando", async () => {
  avisos.length = 0;
  const r = await fetch(`${B}/files/${arquivo}`, { method: "PUT", headers: H, body: JSON.stringify({ original_name: "arte nova.png" }) });
  assert.equal(r.status, 200);
  assert.equal(avisos.length, 1, "renomear é mudança: as telas têm que saber");
});
