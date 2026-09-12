// CARROSSEL DE SLIDES SEPARADAS — um arquivo por slide.
//
// A tela de "Editar peça" mostra a slide grande e desliza entre elas. Ela não
// tinha endereço direto NENHUM para essas slides: caía no download da arte
// inteira de cada uma e, com arte de vários MB, ficava rodando sem fim — o
// diálogo abria e nunca carregava.
//
// O servidor já mandava media_url (a arte anexada) e cover_url (a capa), mas
// nada para as slides do meio. Agora manda media_urls: um endereço por slide,
// na mesma ordem em que o cliente vai deslizar.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-slides-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const distribution = (await import("../src/routes/distribution.js")).default;
const { default: filesRoutes, sharedRouter } = await import("../src/routes/files.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa das Slides',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@s.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo','active',?)").run(org).lastInsertRowid;
db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Distribuição',4,0,?)").run(org);
const etapa = db.prepare("SELECT id FROM kanban_stages WHERE org_id=?").get(org).id;

const slides = [];
for (let i = 1; i <= 4; i++) {
  const caminho = join(dir, `slide${i}.png`);
  writeFileSync(caminho, Buffer.alloc(64, i));
  slides.push(db.prepare(
    `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
     VALUES (?,?,'image/png',64,?,'aprovacao',?)`
  ).run(cli, `slide${i}.png`, caminho, org).lastInsertRowid);
}
const peca = db.prepare(
  `INSERT INTO tasks (title,content_type,client_id,org_id,approval_status,stage_id,scheduled_at,cover_file_id,media_ids)
   VALUES ('Carrossel de 4 slides','carrossel',?,?,'pending',?,'2026-10-15 10:00',?,?)`
).run(cli, org, etapa, slides[0], JSON.stringify(slides)).lastInsertRowid;
db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)").run(peca, slides[0]);

const app = express();
app.use(express.json());
app.use("/api/distribution", distribution);
app.use("/api/files", sharedRouter);
app.use("/api/files", filesRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

const achar = async () => {
  const d = await fetch(`${B}/api/distribution`, { headers: H }).then((r) => r.json());
  return [...(d.items || []), ...(d.waiting || []), ...(d.approved || [])].find((x) => x.id === peca);
};

test("vem um endereço para CADA slide, na ordem de deslizar", async () => {
  const p = await achar();
  assert.ok(p, "a peça tem que aparecer na Distribuição");
  assert.deepEqual(p.media_ids, slides, "a ordem das slides é a ordem do carrossel");
  assert.ok(Array.isArray(p.media_urls), "media_urls não veio — a tela de editar fica rodando sem fim");
  assert.equal(p.media_urls.length, slides.length, "falta endereço para alguma slide");
  for (const u of p.media_urls) assert.match(u, /^\/api\/files\/shared\//);
});

test("cada endereço serve a slide CERTA, e não outra", async () => {
  const p = await achar();
  for (let i = 0; i < slides.length; i++) {
    const r = await fetch(B + p.media_urls[i]);
    assert.equal(r.status, 200, `slide ${i + 1} não abriu`);
    const corpo = Buffer.from(await r.arrayBuffer());
    assert.equal(corpo[0], i + 1, `o endereço da slide ${i + 1} entregou outro arquivo`);
  }
});

test("peça sem carrossel não ganha lista de slides à toa", async () => {
  const post = db.prepare(
    `INSERT INTO tasks (title,content_type,client_id,org_id,approval_status,stage_id,scheduled_at)
     VALUES ('Post simples','post',?,?,'pending',?,'2026-10-16 10:00')`
  ).run(cli, org, etapa).lastInsertRowid;
  const d = await fetch(`${B}/api/distribution`, { headers: H }).then((r) => r.json());
  const p = [...(d.items || []), ...(d.waiting || [])].find((x) => x.id === post);
  assert.deepEqual(p.media_urls, []);
});

test("o endereço da slide não serve para outra agência", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const outroU = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('V','V','v@s.com',?,'admin',1,?)")
    .run(hashPassword("SenhaBoa#1"), outra).lastInsertRowid;
  const d = await fetch(`${B}/api/distribution`, {
    headers: { authorization: `Bearer ${jwt.sign({ id: outroU }, JWT_SECRET)}` },
  }).then((r) => r.json());
  const todas = [...(d.items || []), ...(d.waiting || []), ...(d.approved || [])];
  assert.ok(!todas.some((x) => x.id === peca), "a peça de outra agência não pode aparecer");
});
