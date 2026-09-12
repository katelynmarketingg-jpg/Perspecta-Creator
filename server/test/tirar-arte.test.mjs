// TIRAR A ARTE DE UMA PEÇA.
//
// Dava para trocar a arte e para tirar uma slide, mas não para deixar a peça
// SEM arte nenhuma. Quem tinha uma tira errada pendurada — carrossel medido
// errado, arte trocada, upload enganado — ficava preso com ela.
//
// E o pedido de limpar não funcionava por um detalhe: quando o pedido traz a
// lista de slides, a regra que apaga o anexo não roda (ela existe para o
// carrossel não perder a slide inicial). Então limpar deixava o anexo lá.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-tirar-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const distribution = (await import("../src/routes/distribution.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa de Tirar',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@t.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo','active',?)").run(org).lastInsertRowid;
db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Distribuição',4,0,?)").run(org);
const etapa = db.prepare("SELECT id FROM kanban_stages WHERE org_id=?").get(org).id;

const arte = join(dir, "a.png");
writeFileSync(arte, Buffer.alloc(32, 1));
const novoArquivo = (nome) => db.prepare(
  `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
   VALUES (?,?,'image/png',32,?,'editados',?)`
).run(cli, nome, arte, org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/distribution", distribution);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/distribution`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

const salvar = (id, corpo) => fetch(`${B}/${id}`, { method: "PUT", headers: H, body: JSON.stringify(corpo) });
const estado = (id) => ({
  ...db.prepare("SELECT media_ids, cover_file_id FROM tasks WHERE id = ?").get(id),
  anexos: db.prepare("SELECT COUNT(*) n FROM task_attachments WHERE task_id = ?").get(id).n,
});

function pecaComCarrossel() {
  const a = novoArquivo("s1.png"), b = novoArquivo("s2.png");
  const id = db.prepare(
    `INSERT INTO tasks (title,content_type,client_id,org_id,approval_status,stage_id,scheduled_at,cover_file_id,media_ids)
     VALUES ('Peça','carrossel',?,?,'pending',?,'2026-10-15 10:00',?,?)`
  ).run(cli, org, etapa, a, JSON.stringify([a, b])).lastInsertRowid;
  db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)").run(id, a);
  return id;
}

test("tirar a arte deixa a peça limpa: sem slides, sem capa, sem anexo", async () => {
  const id = pecaComCarrossel();
  assert.equal(estado(id).anexos, 1, "começa com anexo");
  const r = await salvar(id, { file_id: null, media_ids: [], cover_file_id: null });
  assert.equal(r.status, 200);
  const e = estado(id);
  assert.equal(e.media_ids, null, "as slides saem");
  assert.equal(e.cover_file_id, null, "a capa sai");
  assert.equal(e.anexos, 0, "e o ANEXO sai — era isso que sobrava e prendia a arte errada");
});

test("os arquivos continuam na Galeria — só desamarram da peça", async () => {
  const antes = db.prepare("SELECT COUNT(*) n FROM files WHERE org_id = ?").get(org).n;
  const id = pecaComCarrossel();
  await salvar(id, { file_id: null, media_ids: [], cover_file_id: null });
  const depois = db.prepare("SELECT COUNT(*) n FROM files WHERE org_id = ?").get(org).n;
  assert.ok(depois >= antes, "tirar a arte da peça não pode apagar arquivo da Galeria");
});

test("depois de limpar, dá para pôr outra arte", async () => {
  const id = pecaComCarrossel();
  await salvar(id, { file_id: null, media_ids: [], cover_file_id: null });
  const nova = novoArquivo("nova.png");
  const r = await salvar(id, { media_ids: [nova] });
  assert.equal(r.status, 200);
  const e = estado(id);
  assert.deepEqual(JSON.parse(e.media_ids), [nova]);
  assert.equal(e.cover_file_id, nova, "a 1ª slide vira a capa");
  assert.equal(e.anexos, 1);
});

test("montar carrossel normal NÃO apaga o anexo por engano", async () => {
  const id = pecaComCarrossel();
  const a = novoArquivo("x.png"), b = novoArquivo("y.png");
  await salvar(id, { media_ids: [a, b] });
  const e = estado(id);
  assert.equal(e.anexos, 1, "a slide inicial continua sendo o anexo da peça");
  assert.deepEqual(JSON.parse(e.media_ids), [a, b]);
});
