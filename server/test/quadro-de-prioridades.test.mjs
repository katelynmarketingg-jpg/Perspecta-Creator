// O QUADRO DAS PRIORIDADES: DUAS COLUNAS, UMA GAVETA, E NADA ANTES DA HORA.
//
// Dois pedidos dela, no mesmo dia:
//
//   "quero que seja só pendente, concluído, e o próximo é de arquivado, que eu
//    arrastando ele já some, abre só quando clicar"
//
//   "quando eu marcar na prospecção que eu tenho que retornar em tal data, na
//    semana vai aparecer pra mim uma notificação, e vai aparecer nas
//    prioridades e no dashboard, NÃO DESDE AGORA"
//
// O segundo veio olhando um recado de retorno marcado para 10/12 ocupando a
// coluna Pendente em outubro.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-quadro-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const prospects = (await import("../src/routes/prospects.js")).default;
const priorities = (await import("../src/routes/priorities.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Quadro',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@q.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/prospects", prospects);
app.use("/api/priorities", priorities);
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
const dias = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const novoProspect = async (nome) => (await pedir("POST", "/prospects", { name: nome })).corpo.id;

// --- as colunas ---------------------------------------------------------------

test("os estados agora são pendente, concluído e arquivado", async () => {
  const r = await pedir("POST", "/priorities", { message: "Recado qualquer" });
  const id = r.corpo.id;
  for (const status of ["pending", "done", "arquivado"]) {
    assert.equal((await pedir("PUT", `/priorities/${id}/status`, { status })).status, 200, status);
  }
  assert.equal((await pedir("PUT", `/priorities/${id}/status`, { status: "doing" })).status, 400,
    "'Em andamento' saiu do quadro");
});

test("arquivar some da frente, mas não apaga nada", async () => {
  const r = await pedir("POST", "/priorities", { message: "Para guardar" });
  await pedir("PUT", `/priorities/${r.corpo.id}/status`, { status: "arquivado" });
  const guardada = (await pedir("GET", "/priorities?status=arquivado")).corpo;
  assert.ok(guardada.some((p) => p.id === r.corpo.id), "continua lá, na gaveta");
});

test("só CONCLUIR marca a hora; arquivar não finge que resolveu", async () => {
  const r = await pedir("POST", "/priorities", { message: "Nem resolvida" });
  await pedir("PUT", `/priorities/${r.corpo.id}/status`, { status: "arquivado" });
  const p = db.prepare("SELECT status, done_at FROM priorities WHERE id = ?").get(r.corpo.id);
  assert.equal(p.status, "arquivado");
  assert.equal(p.done_at, null);
});

// --- o retorno que ainda não chegou a vez -------------------------------------

test("retorno marcado para daqui a dois meses NÃO entra no quadro", async () => {
  const p = await novoProspect("Mérian");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: dias(60) });

  const quadro = (await pedir("GET", "/priorities")).corpo;
  assert.ok(!quadro.some((x) => x.prospect_id === p), "em outubro, um retorno de dezembro não é recado de agora");
});

test("mas não some em silêncio: o quadro sabe contar os que esperam", async () => {
  const p = await novoProspect("Contada");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: dias(45) });

  const todas = (await pedir("GET", "/priorities?agendados=1")).corpo;
  const minha = todas.find((x) => x.prospect_id === p);
  assert.ok(minha, "com agendados=1 ela vem");
  assert.equal(minha.agendado, 1, "marcada como 'ainda não chegou a vez'");
});

test("na semana da data, aparece", async () => {
  const p = await novoProspect("Da semana");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: dias(5) });

  const quadro = (await pedir("GET", "/priorities")).corpo;
  const minha = quadro.find((x) => x.prospect_id === p);
  assert.ok(minha, "a semana chegou");
  assert.equal(minha.agendado, 0);
});

test("o que já venceu continua no quadro, claro", async () => {
  const p = await novoProspect("Atrasada");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: dias(-3) });
  const quadro = (await pedir("GET", "/priorities")).corpo;
  assert.ok(quadro.some((x) => x.prospect_id === p));
});

test("a regra é só do retorno automático — recado escrito à mão aparece já", async () => {
  // Quem escreveu um recado com prazo quis que ele aparecesse: esconder até a
  // véspera seria decidir pela pessoa.
  const r = await pedir("POST", "/priorities", { message: "Fechar contrato", due_date: dias(90) });
  const quadro = (await pedir("GET", "/priorities")).corpo;
  assert.ok(quadro.some((x) => x.id === r.corpo.id));
});

test("concluir um retorno agendado tira ele do caminho de vez", async () => {
  const p = await novoProspect("Resolvida cedo");
  await pedir("PUT", `/prospects/${p}/retorno`, { data: dias(50) });
  const pr = db.prepare("SELECT id FROM priorities WHERE prospect_id = ?").get(p);
  await pedir("PUT", `/priorities/${pr.id}/status`, { status: "done" });

  const todas = (await pedir("GET", "/priorities?agendados=1")).corpo;
  const minha = todas.find((x) => x.id === pr.id);
  assert.equal(minha.agendado, 0, "concluída não é 'esperando a vez'");
});

// --- o que a tela promete -------------------------------------------------------

const tela = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/pages/Priorities.jsx"), "utf8");

test("a tela tem duas colunas e uma gaveta", () => {
  const colunas = tela.slice(tela.indexOf("const COLUMNS = ["), tela.indexOf("const ARQUIVO"));
  assert.match(colunas, /key: "pending"/);
  assert.match(colunas, /key: "done"/);
  assert.ok(!/key: "doing"/.test(colunas), "'Em andamento' saiu");
  assert.match(tela, /repeat\(2, 1fr\)/);
});

test("a gaveta aceita o cartão fechada, e abre no clique", () => {
  const gaveta = tela.slice(tela.indexOf("A GAVETA DO ARQUIVO"), tela.indexOf("O QUE AINDA N"));
  assert.match(gaveta, /onDrop=.*mover\(dragId\.current, ARQUIVO\)/s, "não precisa abrir para guardar");
  assert.match(gaveta, /setArquivoAberto\(\(v\) => !v\)/);
  assert.match(gaveta, /<Collapse in=\{arquivoAberto\}/);
  assert.match(gaveta, /onDesarquivar/, "e tem como tirar de lá");
});

test("a tela conta os que ainda não chegaram a vez", () => {
  assert.match(tela, /agendados: 1/, "pede ao servidor as que estão esperando");
  assert.match(tela, /rows\.filter\(\(p\) => p\.agendado\)/);
  assert.match(tela, /aparecem? aqui na semana em que vencer/);
});
