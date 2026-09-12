// AUDITORIA DA MÍDIA PENDURADA NA PEÇA.
//
// A varredura de vazamento entre agências troca o :id do endereço. Este é o
// ponto cego dela: o id que vai no CORPO do pedido. Ao salvar uma peça da
// Distribuição, a agência manda file_id, cover_file_id e media_ids — e nenhum
// era conferido contra a casa dela.
//
// Medido antes de corrigir: dava para gravar o id de um arquivo de OUTRA
// agência. Não vazava nada (toda rota que serve mídia confere o org_id — três
// caminhos conferidos, todos negaram 404/403, inclusive pela área do cliente).
// O estrago era outro: a peça ficava com uma mídia que nunca desenha.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-midia-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const distribution = (await import("../src/routes/distribution.js")).default;
const { default: filesRoutes, sharedRouter } = await import("../src/routes/files.js");

function monta(nome, conteudo) {
  const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES (?,0)").run(nome).lastInsertRowid;
  const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES (?,?,?,?,'admin',1,?)")
    .run(nome, nome, `${nome}@x.com`, hashPassword("SenhaBoa#1"), org).lastInsertRowid;
  const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES (?,'active',?)").run(`Cli ${nome}`, org).lastInsertRowid;
  const caminho = join(dir, `${nome}.png`);
  writeFileSync(caminho, Buffer.from(conteudo));
  const file = db.prepare("INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id) VALUES (?,?,'image/png',?,?,'editados',?)")
    .run(cli, `${nome}.png`, Buffer.from(conteudo).length, caminho, org).lastInsertRowid;
  db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Distribuição',4,0,?)").run(org);
  const etapa = db.prepare("SELECT id FROM kanban_stages WHERE org_id=?").get(org).id;
  const task = db.prepare("INSERT INTO tasks (title,content_type,client_id,org_id,approval_status,stage_id,scheduled_at) VALUES (?,'post',?,?,'pending',?,'2026-10-15 10:00')")
    .run(`Peça ${nome}`, cli, org, etapa).lastInsertRowid;
  return { org, cli, file, task, H: { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" } };
}

const app = express();
app.use(express.json());
app.use("/api/distribution", distribution);
app.use("/api/files", sharedRouter);
app.use("/api/files", filesRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
after(() => srv.close());

const A = monta("AgenciaA", "arte-da-A");
const V = monta("AgenciaB", "SEGREDO-DA-B");

const salvar = (task, corpo, H) => fetch(`${B}/distribution/${task}`, { method: "PUT", headers: H, body: JSON.stringify(corpo) });

test("não dá para pendurar o arquivo de outra agência como mídia", async () => {
  const r = await salvar(A.task, { file_id: V.file }, A.H);
  assert.equal(r.status, 400);
  const anexo = db.prepare("SELECT file_id FROM task_attachments WHERE task_id=?").get(A.task);
  assert.equal(anexo, undefined, "não pode nem ficar gravado como referência morta");
});

test("nem como capa do perfil", async () => {
  const r = await salvar(A.task, { cover_file_id: V.file }, A.H);
  assert.equal(r.status, 400);
  assert.equal(db.prepare("SELECT cover_file_id FROM tasks WHERE id=?").get(A.task).cover_file_id, null);
});

test("nem no meio dos slides do carrossel", async () => {
  const r = await salvar(A.task, { media_ids: [A.file, V.file] }, A.H);
  assert.equal(r.status, 400, "um slide estranho no meio já reprova o pedido inteiro");
  assert.equal(db.prepare("SELECT media_ids FROM tasks WHERE id=?").get(A.task).media_ids, null);
});

test("com a mídia da própria casa, salvar continua funcionando", async () => {
  const r = await salvar(A.task, { file_id: A.file, caption: "legenda" }, A.H);
  assert.equal(r.status, 200);
  assert.equal(db.prepare("SELECT file_id FROM task_attachments WHERE task_id=?").get(A.task).file_id, A.file);
  assert.equal(db.prepare("SELECT caption FROM tasks WHERE id=?").get(A.task).caption, "legenda");
});

test("carrossel da própria casa funciona e a 1ª slide vira a capa", async () => {
  const r = await salvar(A.task, { media_ids: [A.file] }, A.H);
  assert.equal(r.status, 200);
  const t = db.prepare("SELECT cover_file_id, media_ids FROM tasks WHERE id=?").get(A.task);
  assert.equal(t.cover_file_id, A.file, "a capa é sempre a primeira parte do carrossel");
  assert.deepEqual(JSON.parse(t.media_ids), [A.file]);
});

test("limpar a capa (null) continua permitido — não é id estranho", async () => {
  const r = await salvar(A.task, { cover_file_id: null }, A.H);
  assert.equal(r.status, 200);
});

test("e o arquivo da outra agência segue ilegível por todo caminho", async () => {
  for (const rota of [`/files/${V.file}/download`, `/files/${V.file}/media`, `/files/${V.file}/thumb`]) {
    const x = await fetch(B + rota, { headers: A.H });
    const corpo = await x.text();
    assert.ok(!corpo.includes("SEGREDO-DA-B"), `vazou por ${rota}`);
    assert.ok(x.status === 404 || x.status === 403, `${rota} devolveu ${x.status}`);
  }
});
