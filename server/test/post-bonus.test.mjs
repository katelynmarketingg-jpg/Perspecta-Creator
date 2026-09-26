// POST BÔNUS: a peça publicada ALÉM do que o contrato prevê.
//
// "Quero poder criar daqui direto mais um também, se eu quiser postar a mais do
// que está no projeto, daí isso vai ficar como post bônus e o mês que eu
// seleciono, depois fica assim nos relatórios."
//
// O relatório compara o combinado (X posts, Y vídeos por mês) com o que saiu.
// Se o extra fosse contado junto, ele inflaria a entrega e ESCONDERIA um post
// do contrato que ficou faltando. Por isso o bônus anda por fora.
//
// E apagar: dá para lançar duplicado (o setembro dela veio em dobro) e não
// havia como desfazer sem ir até o quadro de Tarefas.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-bonus-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const distRoutes = (await import("../src/routes/distribution.js")).default;
const reportRoutes = (await import("../src/routes/reports.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Bônus',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','k','k@p.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
// A etapa que a Distribuição procura pelo nome.
db.prepare("INSERT INTO kanban_stages (org_id, name, position) VALUES (?, 'Distribuição', 1)").run(org);
// Cliente com 2 posts e 1 vídeo por mês combinados.
const cli = db.prepare(
  "INSERT INTO clients (name,status,org_id,posts_per_month,videos_per_month) VALUES ('Fulano','active',?,2,1)"
).run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/distribution", distRoutes);
app.use("/api/reports", reportRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const auth = { "content-type": "application/json",
               authorization: `Bearer ${jwt.sign({ id: uid, org_id: org, role: "admin" }, JWT_SECRET)}` };
const chamar = (m, c, corpo) => fetch(`${B}${c}`, {
  method: m, headers: auth, body: corpo ? JSON.stringify(corpo) : undefined });

const MES = "2026-09";
const relatorio = async () =>
  (await (await chamar("GET", `/reports/planned-vs-delivered?month=${MES}`)).json())
    .find((r) => r.client_name === "Fulano");

test("criar um post bônus daqui, no mês escolhido", async () => {
  const r = await chamar("POST", "/distribution", { client_id: cli, content_type: "post", month: MES });
  assert.equal(r.status, 201);
  const peca = await r.json();
  assert.equal(peca.bonus, 1, "nasce marcada como bônus");
  assert.equal(peca.content_type, "post");
  assert.equal(peca.scheduled_at, "2026-09-01", "cai no dia 1 do mês escolhido");
  assert.match(peca.title, /Bônus — Fulano/, "e o título já diz o que é");
});

test("sem cliente não cria", async () => {
  assert.equal((await chamar("POST", "/distribution", { content_type: "post" })).status, 400);
  assert.equal((await chamar("POST", "/distribution", { client_id: 99999 })).status, 404);
});

test("o bônus NÃO conta como entrega do contrato", async () => {
  const r = await relatorio();
  assert.equal(r.planejado, 3, "2 posts + 1 vídeo combinados");
  assert.equal(r.posts_entregues, 0, "o bônus não entra aqui");
  assert.equal(r.bonus_entregues, 1, "ele aparece à parte");
  assert.equal(r.falta, 3, "e o contrato continua inteiro por entregar");
});

test("post normal conta; o bônus continua separado", async () => {
  db.prepare(
    "INSERT INTO tasks (org_id, client_id, title, content_type, scheduled_at) VALUES (?, ?, 'Post do contrato', 'post', ?)"
  ).run(org, cli, `${MES}-10`);

  const r = await relatorio();
  assert.equal(r.posts_entregues, 1);
  assert.equal(r.bonus_entregues, 1);
  assert.equal(r.entregue, 1, "a entrega do contrato é só o que é do contrato");
  assert.equal(r.falta, 2);
});

test("o bônus de um mês não aparece no relatório de outro", async () => {
  await chamar("POST", "/distribution", { client_id: cli, content_type: "reel", month: "2026-10" });
  assert.equal((await relatorio()).bonus_entregues, 1, "setembro continua com um só");
});

test("apagar tira a peça da lista — é o conserto do lançamento duplicado", async () => {
  const dup = db.prepare(
    "INSERT INTO tasks (org_id, client_id, title, content_type, scheduled_at) VALUES (?, ?, 'Duplicada', 'post', ?)"
  ).run(org, cli, `${MES}-11`).lastInsertRowid;
  assert.equal((await relatorio()).posts_entregues, 2);

  const r = await chamar("DELETE", `/distribution/${dup}`);
  assert.equal(r.status, 200);
  assert.equal(db.prepare("SELECT 1 FROM tasks WHERE id=?").get(dup), undefined);
  assert.equal((await relatorio()).posts_entregues, 1, "e o relatório acerta junto");
});

test("não dá para apagar peça de outra casa", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const alheia = db.prepare(
    "INSERT INTO tasks (org_id, title, content_type) VALUES (?, 'Não é minha', 'post')"
  ).run(outra).lastInsertRowid;
  assert.equal((await chamar("DELETE", `/distribution/${alheia}`)).status, 404);
  assert.ok(db.prepare("SELECT 1 FROM tasks WHERE id=?").get(alheia), "continua lá");
});

after(() => { srv.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });

// --- o que a tela faz com isso ----------------------------------------------

const { readFileSync: lerArquivo } = await import("node:fs");
const { fileURLToPath: paraCaminho } = await import("node:url");
const { dirname: pastaDe, join: juntar } = await import("node:path");
const aqui = pastaDe(paraCaminho(import.meta.url));
const tela = lerArquivo(juntar(aqui, "../../client/src/pages/Distribution.jsx"), "utf8");

test("existe uma visão compacta, com muitos por linha", () => {
  assert.match(tela, /value="compacto"/, "o botão de visão");
  assert.match(tela, /GRADE_COMPACTA/, "e a grade densa");
});

// A VISÃO COMPACTA TEM QUE SER, DE FATO, MENOR.
//
// Pedido dela: "essa visualização ficou igual à outra, mesmo tamanho; quero que
// fique igual mas beeeem menor". A causa era a grade por NÚMERO de colunas:
// numa janela entre dois tamanhos de tela caíam cinco por linha e a peça ficava
// do tamanho da visão normal.
test("a visão compacta mede pela largura da peça, não por número de colunas", () => {
  assert.match(tela, /const LARGURA_COMPACTA = 110/, "cada peça tem ~110px");
  assert.match(tela, /repeat\(auto-fill, minmax\(\$\{LARGURA_COMPACTA\}px, 1fr\)\)/,
    "a linha se enche com quantas couberem");
  const grade = tela.slice(tela.indexOf("const GRADE_COMPACTA"), tela.indexOf("function rotuloCurto"));
  assert.ok(!/repeat\(7, 1fr\)|repeat\(5, 1fr\)/.test(grade),
    "as colunas fixas por tamanho de tela saíram — eram elas que deixavam a peça grande");
});

test("num selo de 110px o nome sai curto, sem o cliente e o mês repetidos", () => {
  const trecho = tela.slice(tela.indexOf("function rotuloCurto"), tela.indexOf("function CartaoCompacto"));
  assert.match(trecho, /split\(" — "\)/, "corta no travessão");
  const cartao = tela.slice(tela.indexOf("function CartaoCompacto"), tela.indexOf("/** Desenha os itens em blocos de mês"));
  assert.match(cartao, /rotuloCurto\(item\.title\)/);
  assert.match(cartao, /<Tooltip title=\{item\.title \|\| ""\}/, "o nome inteiro fica no repousar do mouse");
});

test("a barra de seleção é uma só, e tem o apagar", () => {
  assert.match(tela, /function BarraDeSelecao/);
  assert.match(tela, /onClick=\{apagarSelecionadas\}/);
  // Antes eram duas cópias quase iguais; o apagar teria virado uma terceira.
  assert.equal((tela.match(/Enviar \$\{checked\.size \|\| ""\} para aprovação/g) || []).length, 1,
    "a barra não foi copiada de novo");
});

test("apagar pergunta antes — peça apagada não volta", () => {
  const trecho = tela.slice(tela.indexOf("async function apagarSelecionadas"), tela.indexOf("POST BÔNUS: uma peça"));
  assert.match(trecho, /window\.confirm/);
  assert.match(trecho, /Não dá para desfazer/);
  assert.match(trecho, /api\.delete\(`\/distribution\/\$\{id\}`\)/);
});

test("na Lista dá para marcar qualquer peça — a duplicada pode estar em qualquer estado", () => {
  assert.match(tela, /const marcavel = true;/);
  assert.ok(!/const marcavel = st === "nao_enviado"/.test(tela), "a trava antiga saiu");
});

test("o cartão compacto avisa quando a peça é bônus", () => {
  const trecho = tela.slice(tela.indexOf("function CartaoCompacto"), tela.indexOf("/** Desenha os itens em blocos de mês"));
  assert.match(trecho, /item\.bonus/);
  assert.match(trecho, /label="bônus"/);
});

test("o calendário também recebe o endereço direto da arte", () => {
  // Era a única visão que chamava o <Media> sem ele: caía no download pelo
  // servidor e, quando esse caminho falha, TODA peça do mês virava "Arte não
  // carregou (reenvie)" — inclusive as que apareciam certas nas outras visões.
  const grade = tela.slice(tela.indexOf("function MonthGrid"), tela.indexOf("function FeedThumb"));
  assert.match(grade, /streamUrl=\{enderecoDoArquivo\(it/, "o endereço direto");
  assert.match(grade, /previaUrl=\{it\.cover_preview_url \|\| it\.preview_url\}/, "e a prévia leve");
});

test("o botão de apagar tem o ícone importado", () => {
  // O build passa com um ícone não importado; quem quebra é a tela, em
  // execução. Foi assim que este erro apareceu.
  assert.match(tela, /import DeleteIcon from "@mui\/icons-material\/Delete"/);
});

test("o tipo do post bônus sai do objeto CONTENT_TYPES, não de uma lista", () => {
  // CONTENT_TYPES é um objeto (chave -> {label, emoji}); tratá-lo como lista
  // derrubava a página inteira com "CONTENT_TYPES.map is not a function".
  assert.ok(!/CONTENT_TYPES\.map/.test(tela));
  assert.match(tela, /\["post", "carrossel", "reel", "stories", "foto"\]\.map/);
});
