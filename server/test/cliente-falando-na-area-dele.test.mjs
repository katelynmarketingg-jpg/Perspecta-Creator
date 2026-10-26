// "NA AREA DO CLIENTE ELE NÃO TA CONSEGUINDO COLOCAR OBSERVACOES,
//  SUGESTOES... ALTERAR."
//
// Reproduzido no Chromium: a LISTA de aprovações do portal é montada pela
// ETAPA do quadro (quem está em "Aprovação"); a trava do servidor exigia o
// STATUS 'sent'. Uma peça ARRASTADA para a etapa de Aprovação — o jeito normal
// de mexer no quadro — aparecia para o cliente com os dois botões, e cada
// clique voltava 409. O portal não mostrava nada: ele escrevia a observação,
// clicava em "Enviar para a agência" e a janela ficava parada. Para sempre.
//
// E a segunda metade do pedido: "quero que [...] fique salvo pra mim o que
// cada cliente mudar". client_note é UMA casa só — o pedido seguinte escreve
// por cima. Agora todo pedido também vira comentário do post, que tem data,
// tem autor e não é sobrescrito por nada.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-fala-cliente-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const portalRoutes = (await import("../src/routes/portal.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Fala',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@fala.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare(
  "INSERT INTO clients (name,status,org_id,portal_username,portal_password_hash) VALUES ('Von Haus','active',?,'vonhaus',?)"
).run(org, hashPassword("segredo123")).lastInsertRowid;

const etapa = (nome, pos, done = 0) => db.prepare(
  "INSERT INTO kanban_stages (name, position, is_done, org_id) VALUES (?,?,?,?)"
).run(nome, pos, done, org).lastInsertRowid;
const dist = etapa("Distribuição", 1);
const aprova = etapa("Aprovação", 2);
etapa("Programados", 3, 1);

const peca = (titulo, stage, status, caption = "Legenda original") => db.prepare(
  `INSERT INTO tasks (title, client_id, stage_id, org_id, content_type, caption, approval_status, scheduled_at)
   VALUES (?,?,?,?,'post',?,?,'2026-11-10 10:00:00')`
).run(titulo, cli, stage, org, caption, status).lastInsertRowid;

// A peça ARRASTADA para Aprovação: está com o cliente, mas ninguém clicou em
// "enviar para aprovação".
const arrastada = peca("Post arrastado para Aprovação", aprova, "none");
// A peça mandada do jeito certo.
const mandada = peca("Post enviado de verdade", aprova, "sent");
// E uma que ainda está sendo preparada — essa o cliente não vê nem responde.
const preparando = peca("Post ainda em preparo", dist, "none");

const app = express();
app.use(express.json());
app.use("/api/portal", portalRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
after(() => srv.close());

const { token } = await fetch(`${B}/portal/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "vonhaus", password: "segredo123" }),
}).then((r) => r.json());
const P = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const conversa = (id) => db.prepare(
  "SELECT author_type, body FROM task_comments WHERE task_id = ? ORDER BY id"
).all(id);

test("a peça que ele VÊ, ele consegue responder", async () => {
  const r = await fetch(`${B}/portal/approvals/${arrastada}/request-changes`, {
    method: "POST", headers: P,
    body: JSON.stringify({ client_note: "Essa foto ficou escura." }),
  });
  assert.equal(r.status, 200, "era 409: a lista mostrava a peça e a trava recusava o clique");
});

test("o que ele escreveu fica guardado na conversa, não só num campo", () => {
  const c = conversa(arrastada);
  assert.equal(c.length, 1);
  assert.equal(c[0].author_type, "client");
  assert.match(c[0].body, /Essa foto ficou escura/);
});

test("o pedido seguinte NÃO apaga o anterior", async () => {
  const r = await fetch(`${B}/portal/approvals/${arrastada}/request-changes`, {
    method: "POST", headers: P,
    body: JSON.stringify({ client_note: "Pensando melhor, troca a cor do fundo." }),
  });
  assert.equal(r.status, 200);
  const c = conversa(arrastada);
  assert.equal(c.length, 2, "o campo client_note é sobrescrito; a conversa não pode ser");
  assert.match(c[0].body, /escura/);
  assert.match(c[1].body, /cor do fundo/);
});

test("a legenda que ele sugeriu também fica registrada", async () => {
  await fetch(`${B}/portal/approvals/${mandada}/request-changes`, {
    method: "POST", headers: P,
    body: JSON.stringify({ client_caption: "Minha legenda, do meu jeito", client_note: "Mudei o texto." }),
  });
  const c = conversa(mandada);
  assert.equal(c.length, 1);
  assert.match(c[0].body, /Mudei o texto/);
  assert.match(c[0].body, /Legenda sugerida por ele/);
  assert.match(c[0].body, /Minha legenda, do meu jeito/);
});

test("a peça com ajuste pedido continua à vista dele, com o que ele pediu", async () => {
  const lista = await (await fetch(`${B}/portal/approvals`, { headers: P })).json();
  const nela = lista.find((x) => x.id === arrastada);
  assert.ok(nela, "ela voltou para a Distribuição e sumia da tela dele sem nenhuma confirmação");
  assert.equal(nela.approval_status, "changes_requested");
  assert.match(nela.client_note, /cor do fundo/);
});

test("peça que ainda está em preparo continua fora do alcance dele", async () => {
  const lista = await (await fetch(`${B}/portal/approvals`, { headers: P })).json();
  assert.ok(!lista.some((x) => x.id === preparando), "não é para ele ver o que está em preparo");
  const r = await fetch(`${B}/portal/approvals/${preparando}/request-changes`, {
    method: "POST", headers: P, body: JSON.stringify({ client_note: "oi" }),
  });
  assert.equal(r.status, 409, "a trava continua valendo para o que não está com ele");
});

test("comentário solto também vira registro — e é o mesmo lugar", async () => {
  const r = await fetch(`${B}/portal/tasks/${mandada}/comments`, {
    method: "POST", headers: P, body: JSON.stringify({ body: "Podem usar a foto da vitrine." }),
  });
  assert.equal(r.status, 201);
  const c = conversa(mandada);
  assert.equal(c.length, 2);
  assert.match(c[1].body, /vitrine/);
});

test("a tela do cliente não deixa mais o clique morrer calado", () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const portal = readFileSync(join(raiz, "client/src/pages/Portal.jsx"), "utf8");
  const conversaUI = readFileSync(join(raiz, "client/src/components/PostComments.jsx"), "utf8");

  assert.match(portal, /catch \(e\) \{ recado\(e\); \}/,
    "sem o catch, o erro do servidor não aparecia em lugar nenhum");
  assert.match(portal, /Enviado para a agência/, "ele precisa saber que chegou");
  assert.match(portal, /Você pediu ajustes/, "e precisa poder reler o que pediu");

  // O botão de mandar tinha só a setinha, num quadradinho de 44px.
  assert.match(conversaUI, /\{enviando \? "Enviando…" : "Enviar"\}/,
    "o botão precisa dizer o que faz — no celular ninguém achava a setinha");
  assert.match(conversaUI, /setErro\(e\?\.response\?\.data\?\.error/,
    "comentário que não vai tem de dizer que não foi");
});

test("a agência lê a conversa onde trabalha a peça", () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const dist = readFileSync(join(raiz, "client/src/pages/Distribution.jsx"), "utf8");
  assert.match(dist, /O que o cliente disse/,
    "estava salvo e só aparecia no Calendário — na prática, ela nunca via");
  assert.match(dist, /useState\(item\.approval_status === "changes_requested"\)/,
    "abre sozinha na peça em que ele pediu ajuste");
  assert.match(dist, /<Collapse in=\{verConversa\} unmountOnExit>/,
    "fechada, não busca nada: numa fileira de vinte peças seriam vinte buscas");
});

// A REGRA QUE QUASE QUEBREI AO CONSERTAR A DE CIMA.
//
// Peça aprovada FICA na etapa de Aprovação (no modo "avisar a equipe" ela não
// anda sozinha). Se "estar na etapa" bastasse, o cliente poderia desaprovar
// sozinho depois de ter aprovado. Quem reabre é a agência — e agora ele ouve
// isso, em vez de clicar num botão morto.
test("aprovada não volta atrás pela mão dele — e ele é avisado do porquê", async () => {
  const aprovada = peca("Post já aprovado", aprova, "sent");
  const ok = await fetch(`${B}/portal/approvals/${aprovada}/approve`, { method: "POST", headers: P });
  assert.equal(ok.status, 200);

  const r = await fetch(`${B}/portal/approvals/${aprovada}/request-changes`, {
    method: "POST", headers: P, body: JSON.stringify({ client_note: "mudei de ideia" }),
  });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /Fale com a agência/);
  assert.equal(
    db.prepare("SELECT approval_status FROM tasks WHERE id=?").get(aprovada).approval_status, "approved");
});
