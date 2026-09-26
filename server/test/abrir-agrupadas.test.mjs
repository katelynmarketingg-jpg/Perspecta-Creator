// TAREFA AGRUPADA SE ABRE EM PEÇAS NA DISTRIBUIÇÃO.
//
// Pedido dela: "quando chega na aba de Distribuição, tem que abrir todos os
// posts na aba de Distribuição."
//
// No quadro de Tarefas, um mês de conteúdo é UM cartão com um "×8". Na
// Distribuição, cada post é uma peça: tem a sua arte, a sua legenda, a sua
// data. A abertura existia — mas SÓ no arrastar do quadro. A tarefa que chegou
// à coluna por outro caminho ficava agrupada, e a Distribuição mostrava uma
// peça no lugar de oito. Era o "Preparar (1)" com um ×8 parado na coluna.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-abrir-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const distribution = (await import("../src/routes/distribution.js")).default;
const { abrirAgrupada, abrirAgrupadasDaEtapa, nomeDaPeca, ehDistribuicao } =
  await import("../src/abrir-agrupadas.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Abrir',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@a.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Diovana Carvalho','active',?)").run(org).lastInsertRowid;
const DISTRIB = db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Distribuição',3,0,?)")
  .run(org).lastInsertRowid;
const CRIACAO = db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Criações',2,0,?)")
  .run(org).lastInsertRowid;

const agrupada = (n, stageId = DISTRIB, titulo = "Post — Diovana Carvalho (Outubro/2026)") => db.prepare(
  `INSERT INTO tasks (title,stage_id,client_id,content_type,quantity,position,org_id)
   VALUES (?,?,?,'post',?,?,?)`
).run(titulo, stageId, cli, n, 0, org).lastInsertRowid;

const naEtapa = (stageId) => db.prepare(
  "SELECT id, title, quantity, position FROM tasks WHERE org_id = ? AND stage_id = ? ORDER BY position, id"
).all(org, stageId);

const app = express();
app.use(express.json());
app.use("/api/distribution", distribution);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

test("o nome de cada peça leva a contagem, sem perder cliente e mês", () => {
  assert.equal(nomeDaPeca("Post — Diovana Carvalho (Outubro/2026)", 3, 8),
    "Post 3/8 — Diovana Carvalho (Outubro/2026)");
  assert.equal(nomeDaPeca("Reel", 1, 2), "Reel 1/2");
  assert.equal(nomeDaPeca("", 1, 2), "1/2");
});

test("só a coluna de Distribuição abre as agrupadas", () => {
  assert.ok(ehDistribuicao("Distribuição"));
  assert.ok(ehDistribuicao("distribuicao"));
  assert.ok(!ehDistribuicao("Criações"));
  assert.ok(!ehDistribuicao(null));
});

test("um ×8 parado na coluna vira oito peças ao ABRIR a Distribuição", async () => {
  const t = agrupada(8);
  assert.equal(naEtapa(DISTRIB).length, 1, "antes: um cartão agrupado");

  const r = await fetch(`${B}/distribution?client_id=${cli}`, { headers: H });
  assert.equal(r.status, 200);
  const { items } = await r.json();

  const depois = naEtapa(DISTRIB);
  assert.equal(depois.length, 8, "oito peças na coluna");
  assert.deepEqual(depois.map((p) => p.title), Array.from({ length: 8 },
    (_, i) => `Post ${i + 1}/8 — Diovana Carvalho (Outubro/2026)`));
  assert.ok(depois.every((p) => p.quantity === 1), "cada peça é uma só");
  assert.equal(db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(t), undefined, "o cartão agrupado saiu");
  assert.equal(items.length, 8, "e a resposta já vem com as oito");
});

test("as peças nascem SEM ordem manual — não furam a fila do perfil", () => {
  // `position` tem dois trabalhos nesta coluna: ordenar o cartão no quadro e
  // marcar "arrumado à mão" na prévia do perfil. Numerando as peças de 1 a N,
  // as oito nasciam com cara de arrumadas à mão e passavam na frente de tudo.
  const t = agrupada(4, DISTRIB, "Reel — Diovana Carvalho (Novembro/2026)");
  abrirAgrupada(org, db.prepare("SELECT * FROM tasks WHERE id = ?").get(t));
  const novas = db.prepare("SELECT position FROM tasks WHERE org_id = ? AND title LIKE 'Reel %/4%'").all(org);
  assert.equal(novas.length, 4);
  assert.ok(novas.every((p) => p.position === 0), "todas com posição zero");
});

test("no quadro, as peças saem na ordem 1/8, 2/8, 3/8…", () => {
  // Com posição zero, o quadro ordena pelo id — que é a ordem em que nasceram.
  const titulos = naEtapa(DISTRIB).map((p) => p.title).filter((t) => /^Post \d+\/8/.test(t));
  assert.deepEqual(titulos, Array.from({ length: 8 }, (_, i) => `Post ${i + 1}/8 — Diovana Carvalho (Outubro/2026)`));
});

test("a peça herda cliente, tipo e bônus da tarefa agrupada", () => {
  const t = db.prepare(
    `INSERT INTO tasks (title,stage_id,client_id,content_type,quantity,bonus,ref_month,org_id)
     VALUES ('Post bônus — Diovana Carvalho',?,?,'carrossel',3,1,'2026-11',?)`
  ).run(DISTRIB, cli, org).lastInsertRowid;
  abrirAgrupada(org, db.prepare("SELECT * FROM tasks WHERE id = ?").get(t));
  const filhas = db.prepare("SELECT * FROM tasks WHERE org_id = ? AND title LIKE 'Post bônus %/3%'").all(org);
  assert.equal(filhas.length, 3);
  for (const f of filhas) {
    assert.equal(f.client_id, cli);
    assert.equal(f.content_type, "carrossel");
    assert.equal(f.bonus, 1, "post bônus continua bônus");
    assert.equal(f.ref_month, "2026-11");
  }
});

test("tarefa agrupada em OUTRA coluna fica como está", () => {
  const t = agrupada(5, CRIACAO, "Post — Diovana Carvalho (Dezembro/2026)");
  abrirAgrupadasDaEtapa(org, DISTRIB);
  assert.equal(db.prepare("SELECT quantity FROM tasks WHERE id = ?").get(t).quantity, 5,
    "ainda agrupada — só se abre ao chegar na Distribuição");
});

test("peça já aberta não se abre de novo", () => {
  const antes = naEtapa(DISTRIB).length;
  assert.equal(abrirAgrupadasDaEtapa(org, DISTRIB), 0);
  assert.equal(naEtapa(DISTRIB).length, antes, "nada se multiplica a cada abertura da tela");
});

test("quantidade 1 (ou torta) não vira nada", () => {
  const um = agrupada(1);
  assert.equal(abrirAgrupada(org, db.prepare("SELECT * FROM tasks WHERE id = ?").get(um)), 0);
  assert.ok(db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(um), "a tarefa continua lá, inteira");
});

test("abrir a coluna de outra casa não toca nas minhas", () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const antes = naEtapa(DISTRIB).length;
  assert.equal(abrirAgrupadasDaEtapa(outra, DISTRIB), 0);
  assert.equal(naEtapa(DISTRIB).length, antes);
});
