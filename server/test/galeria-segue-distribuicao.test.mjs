// A GALERIA ACOMPANHA A DISTRIBUIÇÃO.
//
// Pedido dela: "quando a gente interliga uma imagem da galeria a um post da
// distribuição e esse post é colocado como programado, aquele conteúdo passa
// para outra pasta da galeria. Vai acompanhar a distribuição. E isso não está
// funcionando: tem post que já foi programado e a arte está aqui ainda. Daí,
// quando a gente for selecionar da galeria, não pode mais aparecer naquela
// outra pasta."
//
// Existia um começo disso, e três buracos faziam parecer que não existia:
//
//   1. só o PRIMEIRO arquivo se mexia (a conta lia o anexo com LIMIT 1). Num
//      carrossel de sete lâminas, seis ficavam para trás;
//   2. ANEXAR A ARTE DEPOIS não movia nada — e esse é o caminho comum: a peça
//      já está programada e a arte é escolhida em seguida;
//   3. lâmina de um post unido na Galeria ia sozinha, partindo o post.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-segue-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const distribution = (await import("../src/routes/distribution.js")).default;
const { syncTaskMediaToStage, syncTaskMediaToCurrentStage, etapaDaPeca, arquivosDaPeca,
        arrumarPastasAtrasadas } = await import("../src/gallery-sync.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Segue',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@s.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Karen','active',?)").run(org).lastInsertRowid;

const etapa = (nome, pos, done = 0) =>
  db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES (?,?,?,?)").run(nome, pos, done, org).lastInsertRowid;
const DISTRIB = etapa("Distribuição", 3);
const APROVACAO = etapa("Aprovação", 4);
const PROGRAMADOS = etapa("Programados", 5, 1);

const pastaDe = (nome) => db.prepare(
  "SELECT id FROM folders WHERE org_id=? AND client_id=? AND parent_id IS NULL AND name=?"
).get(org, cli, nome)?.id ?? null;
const EDITADOS = db.prepare("INSERT INTO folders (name,client_id,org_id) VALUES ('Editados',?,?)").run(cli, org).lastInsertRowid;

const arte = join(dir, "a.png");
writeFileSync(arte, Buffer.alloc(32, 1));
const novoArquivo = (nome, pasta = EDITADOS) => db.prepare(
  `INSERT INTO files (folder_id,client_id,original_name,mime,size,stored_path,stage,org_id)
   VALUES (?,?,?,'image/png',32,?,'editados',?)`
).run(pasta, cli, nome, arte, org).lastInsertRowid;

const novaPeca = (stageId, titulo = "Post 1/6") => db.prepare(
  "INSERT INTO tasks (title,stage_id,client_id,org_id) VALUES (?,?,?,?)"
).run(titulo, stageId, cli, org).lastInsertRowid;

const anexar = (taskId, fileId) =>
  db.prepare("INSERT OR IGNORE INTO task_attachments (task_id,file_id) VALUES (?,?)").run(taskId, fileId);
const lerArquivo = (id) => db.prepare("SELECT folder_id, stage FROM files WHERE id = ?").get(id);
const nomeDaPasta = (id) => db.prepare("SELECT name FROM folders WHERE id = ?").get(id)?.name ?? null;
const ondeEsta = (fileId) => nomeDaPasta(lerArquivo(fileId).folder_id);

const app = express();
app.use(express.json({ limit: "8mb" }));
app.use("/api/distribution", distribution);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

// --- o buraco nº 1: o carrossel inteiro tem de ir junto -----------------------

test("TODAS as lâminas do carrossel mudam de pasta, não só a primeira", () => {
  const peca = novaPeca(PROGRAMADOS);
  const ids = [novoArquivo("l1.png"), novoArquivo("l2.png"), novoArquivo("l3.png")];
  anexar(peca, ids[0]);
  db.prepare("UPDATE tasks SET media_ids = ?, cover_file_id = ? WHERE id = ?")
    .run(JSON.stringify(ids), ids[0], peca);

  syncTaskMediaToStage(org, peca, "programados");
  for (const id of ids) assert.equal(ondeEsta(id), "Programados", `lâmina ${id}`);
  for (const id of ids) assert.equal(lerArquivo(id).stage, "programados");
});

test("a capa do perfil também acompanha", () => {
  const peca = novaPeca(PROGRAMADOS);
  const capa = novoArquivo("capa.png");
  db.prepare("UPDATE tasks SET cover_file_id = ? WHERE id = ?").run(capa, peca);
  assert.deepEqual(arquivosDaPeca(org, peca), [capa]);
  syncTaskMediaToStage(org, peca, "programados");
  assert.equal(ondeEsta(capa), "Programados");
});

// --- o buraco nº 2: anexar DEPOIS de programar --------------------------------

test("escolher a arte numa peça JÁ programada leva a arte para Programados", async () => {
  const peca = novaPeca(PROGRAMADOS);
  const f = novoArquivo("depois.png");
  assert.equal(ondeEsta(f), "Editados", "antes, está onde a pessoa deixou");

  const r = await fetch(`${B}/distribution/${peca}`, {
    method: "PUT", headers: H, body: JSON.stringify({ file_id: f }),
  });
  assert.equal(r.status, 200);
  assert.equal(ondeEsta(f), "Programados", "e a Galeria acompanhou na hora");
});

test("o mesmo vale para o carrossel escolhido numa peça em aprovação", async () => {
  const peca = novaPeca(APROVACAO);
  const ids = [novoArquivo("a1.png"), novoArquivo("a2.png")];
  await fetch(`${B}/distribution/${peca}`, {
    method: "PUT", headers: H, body: JSON.stringify({ media_ids: ids }),
  });
  for (const id of ids) assert.equal(ondeEsta(id), "Para aprovação", `lâmina ${id}`);
});

test("peça em preparação não mexe na arte — ela fica onde a pessoa deixou", async () => {
  const peca = novaPeca(DISTRIB);
  const f = novoArquivo("parada.png");
  assert.equal(etapaDaPeca(org, peca), null);
  await fetch(`${B}/distribution/${peca}`, {
    method: "PUT", headers: H, body: JSON.stringify({ file_id: f }),
  });
  assert.equal(ondeEsta(f), "Editados");
});

// --- o buraco nº 3: post unido na Galeria não se parte -----------------------

test("post unido na Galeria vai inteiro, mesmo com uma lâmina só na peça", () => {
  const capa = novoArquivo("u1.png"), b = novoArquivo("u2.png"), c = novoArquivo("u3.png");
  const marcar = db.prepare("UPDATE files SET carrossel_id = ?, carrossel_pos = ? WHERE id = ?");
  [capa, b, c].forEach((id, i) => marcar.run(capa, i + 1, id));

  const peca = novaPeca(PROGRAMADOS);
  anexar(peca, capa);                       // só a capa está amarrada à peça
  assert.deepEqual(arquivosDaPeca(org, peca).sort(), [capa, b, c].sort(),
    "as outras lâminas vêm junto");
  syncTaskMediaToStage(org, peca, "programados");
  for (const id of [capa, b, c]) assert.equal(ondeEsta(id), "Programados");
});

// --- que etapa manda em que pasta --------------------------------------------

test("a etapa da peça decide a pasta", () => {
  const emAprovacao = novaPeca(APROVACAO);
  assert.equal(etapaDaPeca(org, emAprovacao), "aprovacao");

  const programada = novaPeca(PROGRAMADOS);
  assert.equal(etapaDaPeca(org, programada), "programados");

  const aprovada = novaPeca(DISTRIB);
  db.prepare("UPDATE tasks SET approval_status = 'approved' WHERE id = ?").run(aprovada);
  assert.equal(etapaDaPeca(org, aprovada), "aprovados");

  assert.equal(etapaDaPeca(org, novaPeca(DISTRIB)), null, "em preparação, ninguém mexe");
});

test("a pasta da etapa é criada se ainda não existir", () => {
  assert.ok(pastaDe("Programados"), "Programados nasceu no primeiro uso");
  assert.ok(pastaDe("Para aprovação"), "Para aprovação também");
});

// --- e o que já estava no ar ---------------------------------------------------

test("o conserto de uma vez leva a arte atrasada para a pasta certa", () => {
  // Uma peça programada de antes, com a arte parada em "Editados" — é o caso
  // dela: "tem post que já foi programado e a arte está aqui ainda".
  const peca = novaPeca(PROGRAMADOS, "Post antigo");
  const ids = [novoArquivo("v1.png"), novoArquivo("v2.png")];
  anexar(peca, ids[0]);
  db.prepare("UPDATE tasks SET media_ids = ? WHERE id = ?").run(JSON.stringify(ids), peca);
  for (const id of ids) assert.equal(ondeEsta(id), "Editados");

  const mexidas = arrumarPastasAtrasadas();
  assert.ok(mexidas >= 1, "consertou pelo menos esta");
  for (const id of ids) assert.equal(ondeEsta(id), "Programados");
});

test("o conserto roda UMA vez: depois a pessoa é dona das pastas", () => {
  const peca = novaPeca(PROGRAMADOS, "Post de depois");
  const f = novoArquivo("minha.png");
  anexar(peca, f);
  // Segunda chamada não faz nada — quem mover à mão não é puxado de volta.
  assert.equal(arrumarPastasAtrasadas(), 0);
  assert.equal(ondeEsta(f), "Editados");
});

// --- nada atravessa a parede entre escritórios --------------------------------

test("arte de outra casa não é movida", () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const alheio = db.prepare(
    `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
     VALUES (NULL,'alheia.png','image/png',32,?,'editados',?)`).run(arte, outra).lastInsertRowid;
  const peca = novaPeca(PROGRAMADOS);
  anexar(peca, alheio);
  assert.deepEqual(arquivosDaPeca(org, peca), [], "o arquivo da vizinha não entra na conta");
  syncTaskMediaToStage(org, peca, "programados");
  assert.equal(db.prepare("SELECT folder_id FROM files WHERE id = ?").get(alheio).folder_id, null);
});

test("sem arte e sem cliente, não acontece nada", () => {
  const semArte = novaPeca(PROGRAMADOS);
  assert.equal(syncTaskMediaToStage(org, semArte, "programados"), 0);
  assert.equal(syncTaskMediaToCurrentStage(org, semArte), 0);
});

// --- os pontos da tela que precisam avisar ------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const aqui = dirname(fileURLToPath(import.meta.url));
const ler = (rel) => readFileSync(join(aqui, rel), "utf8");

test("salvar a arte da peça avisa a Galeria", () => {
  const fonte = ler("../src/routes/distribution.js");
  const trecho = fonte.slice(fonte.indexOf("// PUT /api/distribution/:id"),
                             fonte.indexOf("// POST /api/distribution/:id/send"));
  assert.match(trecho, /syncTaskMediaToCurrentStage\(req\.orgId, req\.params\.id\)/);
});

test("arrastar a peça no quadro avisa a Galeria, seja para que coluna for", () => {
  const fonte = ler("../src/routes/tasks.js");
  assert.match(fonte, /syncTaskMediaToCurrentStage\(req\.orgId, req\.params\.id\)/);
  // A regra antiga só cobria dois casos; arrastar de volta deixava a arte errada.
  assert.ok(!/if \(stage\?\.is_done\) syncTaskMediaToStage/.test(fonte));
});

test("mover a arte avisa as telas abertas da Galeria", () => {
  const fonte = ler("../src/gallery-sync.js");
  assert.match(fonte, /broadcast\(orgId, "files"\)/);
  // E só avisa quando algo REALMENTE saiu do lugar.
  assert.match(fonte, /if \(!mexer\) return 0;/);
});
