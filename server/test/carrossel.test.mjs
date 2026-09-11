// CARROSSEL na Distribuição: a 1ª slide é a capa que aparece no perfil, e a
// ordem das slides é o próprio post. As slides precisam voltar em TODAS as
// listas da tela — quando não voltavam, abrir a peça pela fila de aprovados
// mostrava o carrossel vazio e a slide seguinte apagava as que já existiam.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-car-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const distribution = (await import("../src/routes/distribution.js")).default;

const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES ('Casa do Carrossel', 0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('R','R','r@x.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cliente = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo','active',?)").run(org).lastInsertRowid;

// Cinco artes na galeria do cliente — as slides do carrossel.
const arte = (nome) => db.prepare(
  "INSERT INTO files (client_id, original_name, mime, size, stored_path, stage, org_id) VALUES (?, ?, 'image/png', 10, ?, 'editados', ?)"
).run(cliente, nome, `/tmp/${nome}`, org).lastInsertRowid;
const S = [arte("s1.png"), arte("s2.png"), arte("s3.png"), arte("s4.png"), arte("s5.png")];

// A tela só abre quando existe a coluna "Distribuição" no quadro.
db.prepare("INSERT INTO kanban_stages (name, position, is_done, org_id) VALUES ('Distribuição', 4, 0, ?)").run(org);
const etapaDistribuicao = db.prepare("SELECT id FROM kanban_stages WHERE name = 'Distribuição' AND org_id = ?").get(org).id;

const etapaPronta = db.prepare(
  "INSERT INTO kanban_stages (name, position, is_done, org_id) VALUES ('Programados', 9, 1, ?)"
).run(org).lastInsertRowid;

const novaPeca = (titulo, extra = {}) => db.prepare(
  `INSERT INTO tasks (title, content_type, client_id, org_id, approval_status, stage_id, scheduled_at)
   VALUES (?, 'carrossel', ?, ?, ?, ?, ?)`
).run(titulo, cliente, org, extra.approval_status ?? 'pending', extra.stage_id ?? etapaDistribuicao, extra.scheduled_at ?? null).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/distribution", distribution);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/distribution`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

const put = (id, corpo) => fetch(`${B}/${id}`, { method: "PUT", headers: H, body: JSON.stringify(corpo) })
  .then(async (r) => ({ st: r.status, ...(await r.json().catch(() => ({}))) }));
const listar = () => fetch(B, { headers: H }).then((r) => r.json());
const achar = (lista, id) => (lista || []).find((x) => x.id === id);

test("a 1ª slide vira a capa do perfil sozinha, sem ninguém escolher", async () => {
  const peca = novaPeca("Carrossel lavagem de dinheiro");
  assert.equal((await put(peca, { media_ids: [S[0], S[1], S[2]] })).st, 200);

  const t = db.prepare("SELECT cover_file_id, media_ids FROM tasks WHERE id = ?").get(peca);
  assert.equal(t.cover_file_id, S[0], "a capa tem que ser a primeira slide");
  assert.deepEqual(JSON.parse(t.media_ids), [S[0], S[1], S[2]]);
  // E a arte da peça (o que a prévia do feed desenha) é essa mesma.
  const anexo = db.prepare("SELECT file_id FROM task_attachments WHERE task_id = ?").get(peca);
  assert.equal(anexo.file_id, S[0]);
});

test("escolher outra slide de capa a traz para a frente, sem perder as outras", async () => {
  const peca = novaPeca("Carrossel presunção de culpa");
  await put(peca, { media_ids: [S[0], S[1], S[2], S[3]] });
  // é o que o botão "usar de capa" manda: a escolhida na frente, o resto na ordem
  await put(peca, { media_ids: [S[2], S[0], S[1], S[3]] });

  const t = db.prepare("SELECT cover_file_id, media_ids FROM tasks WHERE id = ?").get(peca);
  assert.equal(t.cover_file_id, S[2]);
  assert.deepEqual(JSON.parse(t.media_ids), [S[2], S[0], S[1], S[3]], "nenhuma slide pode sumir na troca");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM task_attachments WHERE task_id = ?").get(peca).n, 1);
});

test("as slides voltam em TODAS as listas da tela, não só na primeira", async () => {
  const naMesa = novaPeca("Esperando a arte");            // continua na Distribuição
  const naFila = novaPeca("Aprovado esperando data", { approval_status: "approved" });
  const programado = novaPeca("Já programado", { stage_id: etapaPronta, scheduled_at: "2026-10-01 09:00" });
  await put(naMesa, { media_ids: [S[1], S[2]] });
  await put(naFila, { media_ids: [S[0], S[1], S[2]] });
  await put(programado, { media_ids: [S[3], S[4]] });

  const r = await listar();
  assert.deepEqual(achar(r.approved, naFila)?.media_ids, [S[0], S[1], S[2]],
    "sem isto a peça abre 'sem slides' e a próxima slide apaga as que existiam");
  assert.deepEqual(achar(r.programmed, programado)?.media_ids, [S[3], S[4]]);
  assert.deepEqual(achar(r.scheduled, programado)?.media_ids, [S[3], S[4]]);
  assert.deepEqual(achar(r.items, naMesa)?.media_ids, [S[1], S[2]]);
});

test("mexer na legenda não apaga o carrossel", async () => {
  const peca = novaPeca("Carrossel com legenda");
  await put(peca, { media_ids: [S[0], S[1]] });
  await put(peca, { caption: "Defesa técnica não é inventar narrativa." });

  const t = db.prepare("SELECT cover_file_id, media_ids, caption FROM tasks WHERE id = ?").get(peca);
  assert.deepEqual(JSON.parse(t.media_ids), [S[0], S[1]]);
  assert.equal(t.cover_file_id, S[0]);
  assert.match(t.caption, /Defesa técnica/);
});

test("tirar todas as slides limpa o carrossel sem deixar lixo", async () => {
  const peca = novaPeca("Carrossel esvaziado");
  await put(peca, { media_ids: [S[0], S[1]] });
  await put(peca, { media_ids: [] });
  const t = db.prepare("SELECT media_ids FROM tasks WHERE id = ?").get(peca);
  assert.equal(t.media_ids, null);
});

