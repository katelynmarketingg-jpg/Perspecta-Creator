// APAGAR E TIRAR DA GRADE, PELA PRÉVIA DO PERFIL.
//
// Pedidos dela:
//   · "quero que por aqui eu também possa apagar";
//   · "ou tirar da grade se for o caso de vídeo — daí fica numa grade ao lado,
//     só pra saber o dia, mas vai estar só na grade de reels";
//   · "é da direita pra esquerda, o lugar vago tem que ser a esquerda".
//
// O lugar vago não é um buraco: é O LUGAR DO PRÓXIMO POST. E o próximo post
// entra no canto de cima à esquerda, empurrando o resto para a direita — então
// é ali que ele tem de ficar.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-grade-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const distribution = (await import("../src/routes/distribution.js")).default;
const notifications = (await import("../src/routes/notifications.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Grade',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@g.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Karen','active',?)").run(org).lastInsertRowid;
const etapa = db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Distribuição',3,0,?)")
  .run(org).lastInsertRowid;

const novaPeca = (tipo = "reel") => db.prepare(
  "INSERT INTO tasks (title,stage_id,client_id,content_type,org_id) VALUES (?,?,?,?,?)"
).run(`Peça ${tipo}`, etapa, cli, tipo, org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/distribution", distribution);
app.use("/api/notifications", notifications);
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
const ler = (id) => db.prepare("SELECT fora_da_grade FROM tasks WHERE id = ?").get(id);

// --- tirar da grade e devolver ----------------------------------------------

test("tirar da grade marca a peça, e devolver desmarca", async () => {
  const id = novaPeca("reel");
  assert.equal(ler(id).fora_da_grade, 0, "nasce na grade");

  const fora = await pedir("PUT", `/distribution/${id}/grade`, { na_grade: false });
  assert.equal(fora.status, 200);
  assert.equal(ler(id).fora_da_grade, 1);

  await pedir("PUT", `/distribution/${id}/grade`, { na_grade: true });
  assert.equal(ler(id).fora_da_grade, 0, "volta com um clique");
});

test("tirar da grade NÃO mexe na posição de ninguém", async () => {
  const a = novaPeca("post"), b = novaPeca("reel"), c = novaPeca("post");
  const pos = db.prepare("UPDATE tasks SET position = ? WHERE id = ?");
  pos.run(1, a); pos.run(2, b); pos.run(3, c);

  await pedir("PUT", `/distribution/${b}/grade`, { na_grade: false });

  const posDe = (id) => db.prepare("SELECT position FROM tasks WHERE id = ?").get(id).position;
  assert.equal(posDe(a), 1, "as outras ficam onde estavam");
  assert.equal(posDe(c), 3);
});

test("peça de outra casa não é mexida", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const alheia = db.prepare("INSERT INTO tasks (title,org_id) VALUES ('Dela',?)").run(outra).lastInsertRowid;
  const r = await pedir("PUT", `/distribution/${alheia}/grade`, { na_grade: false });
  assert.equal(r.status, 404);
  assert.equal(ler(alheia).fora_da_grade, 0);
});

test("a listagem leva a marca para a tela", async () => {
  const id = novaPeca("reel");
  await pedir("PUT", `/distribution/${id}/grade`, { na_grade: false });
  const r = await pedir("GET", `/distribution?client_id=${cli}`);
  const achou = r.corpo.items.find((p) => p.id === id);
  assert.equal(achou.fora_da_grade, 1);
});

// --- apagar ------------------------------------------------------------------

test("apagar tira a peça — a arte não é tocada", async () => {
  const id = novaPeca("post");
  const arquivo = db.prepare(
    `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
     VALUES (?,'arte.png','image/png',10,'x','editados',?)`).run(cli, org).lastInsertRowid;
  db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)").run(id, arquivo);

  const r = await pedir("DELETE", `/distribution/${id}`);
  assert.equal(r.status, 200);
  assert.equal(db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(id), undefined, "a peça saiu");
  assert.ok(db.prepare("SELECT 1 FROM files WHERE id = ?").get(arquivo), "a arte continua na Galeria");
});

// --- limpar as notificações ---------------------------------------------------

test("limpar esvazia a caixa de avisos", async () => {
  const ins = db.prepare("INSERT INTO notifications (audience,message,org_id) VALUES ('agency',?,?)");
  ins.run("⚠️ Pagamento atrasado", org);
  ins.run("📝 Cliente respondeu o onboarding", org);
  assert.equal((await pedir("GET", "/notifications")).corpo.length, 2);

  const r = await pedir("DELETE", "/notifications");
  assert.equal(r.status, 200);
  assert.equal(r.corpo.apagadas, 2);
  assert.equal((await pedir("GET", "/notifications")).corpo.length, 0);
});

test("limpar não toca no que o aviso avisava", async () => {
  // A cobrança atrasada continua atrasada — some o recado, não o fato.
  db.prepare(
    `INSERT INTO financial_entries (type,description,amount,status,due_date,client_id,org_id)
     VALUES ('income','Mensalidade',100,'pending','2020-01-10',?,?)`
  ).run(cli, org);
  await pedir("DELETE", "/notifications");
  const aberto = db.prepare(
    "SELECT COUNT(*) n FROM financial_entries WHERE org_id = ? AND status = 'pending'"
  ).get(org).n;
  assert.ok(aberto > 0, "o lançamento continua lá");
});

test("limpar não alcança a caixa de outra casa", async () => {
  const outra = db.prepare("SELECT id FROM organizations WHERE name = 'Vizinha'").get().id;
  db.prepare("INSERT INTO notifications (audience,message,org_id) VALUES ('agency','Da vizinha',?)").run(outra);
  await pedir("DELETE", "/notifications");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE org_id = ?").get(outra).n, 1);
});

// --- o que a tela promete -----------------------------------------------------

const aqui = dirname(fileURLToPath(import.meta.url));
const dist = readFileSync(join(aqui, "../../client/src/pages/Distribution.jsx"), "utf8");
const layout = readFileSync(join(aqui, "../../client/src/components/Layout.jsx"), "utf8");

test("o lugar vago fica no canto de cima à ESQUERDA", () => {
  const trecho = dist.slice(dist.indexOf("A FOLGA FICA NO CANTO"), dist.indexOf("A GRADINHA DOS REELS"));
  // As células vazias vêm ANTES dos quadros, não no meio.
  const posFolga = trecho.indexOf("length: folga");
  const posItens = trecho.indexOf("...order.map((p, j) => celula(p, j))");
  assert.ok(posFolga > 0 && posItens > posFolga, "a folga vem antes de tudo");
  assert.ok(!/order\.slice\(0, resto\)/.test(trecho), "a divisão antiga, que punha a folga no meio, saiu");
});

test("a grade tem apagar e, no vídeo, tirar da grade", () => {
  assert.match(dist, /onApagar\(p\)/);
  assert.match(dist, /onTirarDaGrade && pecaEhVideo\(p\)/, "tirar da grade só faz sentido em vídeo");
  assert.match(dist, /onTirarDaGrade\(p, false\)/);
});

test("apagar avisa que a arte continua na Galeria", () => {
  const trecho = dist.slice(dist.indexOf("async function apagarPeca"), dist.indexOf("async function mudarGrade"));
  assert.match(trecho, /confirm\(/, "é ida sem volta: confirma");
  assert.match(trecho, /A arte continua na Galeria/);
});

test("os reels ficam numa gradinha ao lado, com a data", () => {
  const trecho = dist.slice(dist.indexOf("A GRADINHA DOS REELS"), dist.indexOf("</Stack>\n    </Box>"));
  assert.match(trecho, /Reels \(\{reels\.length\}\)/);
  assert.match(trecho, /onTirarDaGrade\(p, true\)/, "e dá para devolver à grade");
  assert.match(trecho, /sem data/, "a data aparece — é para isso que ela serve ali");
});

test("a caixa de avisos tem um limpar de verdade", () => {
  assert.match(layout, /async function limparNotifs/);
  assert.match(layout, /api\.delete\("\/notifications"\)/);
  assert.match(layout, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); limparNotifs\(\); \}\}/);
});

// --- o tamanho dos cards ------------------------------------------------------
//
// "Bugou o tamanho": na aba Preparar um card ficou gigante e os dois vizinhos
// viraram um filete. Não foi o card — foi a arte deitada dentro dele. Numa
// coluna `1fr` (que é `minmax(auto, 1fr)`) a arte conta com a LARGURA REAL do
// arquivo, e empurra a coluna. Os dois cintos: `minmax(0, 1fr)` na grade e
// `max-width: 100%` na arte.

test("as colunas da grade não podem ser empurradas pelo conteúdo", () => {
  const grade = dist.slice(dist.indexOf("const GRADE = {"), dist.indexOf("const GRADE_IGUAL"));
  assert.match(grade, /minmax\(0, 1fr\)/, "o piso da coluna é zero");
  assert.ok(!/["'`]1fr 1fr["'`]|["'`]1fr 1fr 1fr["'`]/.test(grade), "nenhuma coluna `1fr` crua sobrou");
});

test("a arte nunca passa da largura da caixa", () => {
  const media = dist.slice(dist.indexOf("const sx = natural"), dist.indexOf("const pequeno ="));
  // As três formas (natural com altura igual, natural solta, e a de altura fixa)
  // — todas com o teto de largura.
  assert.equal((media.match(/maxWidth: "100%"/g) || []).length, 3);
});

// --- quem pode confirmar ------------------------------------------------------

test("confirmar que postou não é coisa de admin", async () => {
  // A regra do servidor é o módulo "tarefas", não o papel. Quem está na equipe
  // confirma; só não confirma quem teve o módulo desligado em Usuários.
  const auth = readFileSync(join(aqui, "../src/auth.js"), "utf8");
  const trecho = auth.slice(auth.indexOf("export function moduleAllowed"), auth.indexOf("export function superadminRequired"));
  assert.match(trecho, /=== false/, "só barra quem foi barrado de propósito");

  const dist_ = readFileSync(join(aqui, "../src/routes/distribution.js"), "utf8");
  const rota = dist_.slice(dist_.indexOf('router.post("/:id/mark-posted"'), dist_.indexOf('router.post("/reorder"'));
  assert.ok(!/adminRequired/.test(rota), "a rota não exige admin");
});

test("a equipe confirma de fato — pelo endereço, com um usuário comum", async () => {
  const comum = db.prepare(
    "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Equipe','EQ','eq@g.com',?,'user',1,?)"
  ).run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
  const id = novaPeca("post");
  const r = await fetch(`${B}/distribution/${id}/mark-posted`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt.sign({ id: comum }, JWT_SECRET)}`, "content-type": "application/json" },
    body: JSON.stringify({ posted: true }),
  });
  assert.equal(r.status, 200);
  assert.ok(db.prepare("SELECT published_at FROM tasks WHERE id = ?").get(id).published_at, "ficou marcada");
});

test("o certinho aparece nos DOIS caminhos do perfil, não só no cliente filtrado", () => {
  // Era o bug: sem escolher empresa, a equipe via os perfis lado a lado e
  // nenhum deles tinha o botão.
  const agrupados = dist.slice(dist.indexOf("{feedGroups.map((g) => ("), dist.indexOf("</Stack>\n        )\n      ) : ("));
  assert.match(agrupados, /onMarcarPostado=\{marcarPostado\}/);
  assert.match(agrupados, /onApagar=\{apagarPeca\}/);
  assert.match(agrupados, /onTirarDaGrade=\{mudarGrade\}/);
});
