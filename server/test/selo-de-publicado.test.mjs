// O SELO DO QUE JÁ SAIU.
//
// Pergunta dela: "tem como ao ser postado, confirmado, o botão de confirmar que
// tem lá na visão de perfil ser marcado?" E logo depois: "não precisa sair de
// lá, só outro botão confirmando que postou".
//
// Até aqui, publicar (pelo sistema ou na mão) tirava a peça da grade do perfil.
// Para o que ela marcava à mão isso era o pedido dela — mas para o que o robô
// publicava sozinho, sumir era a ÚNICA notícia de que tinha dado certo.
//
// Agora são dois certinhos, e a cor é a notícia: laranja = "eu postei, pode
// sair"; verde = "o sistema publicou, está aqui para você ver". O verde nasce
// marcado, e clicar nele é só o "já vi".
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-selo-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const distribution = (await import("../src/routes/distribution.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Selo',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@s.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Von Saltiel','active',?)").run(org).lastInsertRowid;
const etapa = db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Distribuição',3,0,?)")
  .run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/distribution", distribution);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

const pedir = async (metodo, caminho, corpo) => {
  const r = await fetch(`${B}${caminho}`, {
    method: metodo, headers: H, body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

const peca = (titulo) => db.prepare(
  "INSERT INTO tasks (title,stage_id,client_id,content_type,org_id) VALUES (?,?,?,'post',?)"
).run(titulo, etapa, cli, org).lastInsertRowid;
const ler = (id) => db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);

test("conferir uma peça que nem foi publicada é recusado", async () => {
  const id = peca("Ainda não saiu");
  const r = await pedir("POST", `/distribution/${id}/conferir`, {});
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /ainda não foi publicada/);
  assert.equal(ler(id).conferido_em, null);
});

test("conferir NÃO apaga o id do post lá no Instagram", async () => {
  const id = peca("Publicada pelo robô");
  db.prepare("UPDATE tasks SET published_at = '2026-10-05 15:25', external_post_id = '17900000001' WHERE id = ?").run(id);

  const r = await pedir("POST", `/distribution/${id}/conferir`, { conferido: true });
  assert.equal(r.status, 200);
  const t = ler(id);
  assert.ok(t.conferido_em, "ficou registrado que ela viu");
  assert.equal(t.external_post_id, "17900000001",
    "é o único fio que liga a peça ao que foi ao ar — não pode virar 'manual'");
  assert.equal(t.published_at, "2026-10-05 15:25", "e a hora da publicação fica como estava");
});

test("dá para voltar atrás: a peça volta para a grade", async () => {
  const id = peca("Conferida sem querer");
  db.prepare("UPDATE tasks SET published_at = '2026-10-05 15:25', external_post_id = '179' WHERE id = ?").run(id);
  await pedir("POST", `/distribution/${id}/conferir`, { conferido: true });
  await pedir("POST", `/distribution/${id}/conferir`, { conferido: false });
  assert.equal(ler(id).conferido_em, null);
});

test("conferir não atravessa para outra casa", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const cliAlheio = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Alheio','active',?)").run(outra).lastInsertRowid;
  const alheia = db.prepare(
    "INSERT INTO tasks (title,client_id,published_at,external_post_id,org_id) VALUES ('Da vizinha',?,'2026-10-05 10:00','1',?)"
  ).run(cliAlheio, outra).lastInsertRowid;

  const r = await pedir("POST", `/distribution/${alheia}/conferir`, {});
  assert.equal(r.status, 404);
  assert.equal(ler(alheia).conferido_em, null);
});

test("marcar à mão grava a hora DAQUI, não a de Greenwich", async () => {
  const id = peca("Reel do Edits");
  await pedir("POST", `/distribution/${id}/mark-posted`, { posted: true });
  const t = ler(id);
  assert.equal(t.external_post_id, "manual");
  const greenwich = db.prepare("SELECT datetime('now') AS t").get().t;
  assert.notEqual(t.published_at, greenwich, "a hora que aparece no selo é a hora dela");
});

test("a listagem entrega o que a grade precisa para escolher a cor", async () => {
  const id = peca("Na listagem");
  db.prepare("UPDATE tasks SET published_at = '2026-10-05 15:25', external_post_id = '42' WHERE id = ?").run(id);
  const r = await pedir("GET", "/distribution");
  const todas = [...(r.corpo.items || []), ...(r.corpo.scheduled || []), ...(r.corpo.waiting || []), ...(r.corpo.programmed || [])];
  const achada = todas.find((p) => p.id === id);
  assert.ok(achada, "a peça está em alguma das listas");
  assert.equal(achada.external_post_id, "42", "sem isto a tela não sabe quem publicou");
  assert.ok("conferido_em" in achada);
});

// --- o que a tela promete -----------------------------------------------------

const tela = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/pages/Distribution.jsx"), "utf8");

test("no editor, 'desfazer' só aparece para o que foi marcado à mão", () => {
  // O servidor já recusava desfazer uma publicação de verdade (o post está no
  // Instagram; dizer aqui que não foi não tira de lá). Era o botão que
  // prometia o que não cumpria.
  const trecho = tela.slice(tela.indexOf('"DESFAZER" S'), tela.indexOf("Vai direto para o Instagram"));
  assert.match(trecho, /Publicado pelo sistema/);
  assert.match(trecho, /item\.external_post_id === "manual"/);
  assert.match(trecho, /marcarPostado\(false\)/);
});

test("o clique no verde chama conferir, não mark-posted", () => {
  assert.match(tela, /async function conferirPostado/);
  assert.match(tela, /\/conferir`, \{ conferido: true \}/);
  const h = tela.slice(tela.indexOf("async function conferirPostado"), tela.indexOf("async function marcarPostado"));
  assert.ok(!/mark-posted/.test(h), "são duas coisas diferentes: 'postei' e 'já vi'");
});
