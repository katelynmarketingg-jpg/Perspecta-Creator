// AS OUTRAS LÂMINAS DO CARROSSEL, NA ÁREA DO CLIENTE.
//
// "na área do cliente não tá aparecendo pra ver as outras lâminas dos
// carrosséis... falta a seta que aparece pra nós."
//
// Existiam dois carrosséis e só um tinha setas:
//
//   · UMA TIRA LARGA (seis lâminas numa imagem só) — a tela fatiava e mostrava
//     as setas;
//   · UM ARQUIVO POR LÂMINA — cada arquivo é uma arte de 1080×1350, a conta de
//     fatiar dá UMA janela, as setas nunca apareciam, e as lâminas iam
//     empilhadas uma embaixo da outra. De relance, parece que o carrossel tem
//     uma lâmina só.
//
// E tinha um segundo problema, do lado do servidor: os anexos vinham na ordem
// do banco, não na ordem das lâminas — que mora em tasks.media_ids e é a que
// manda na hora de publicar. O cliente podia aprovar um carrossel que ia ao ar
// em outra ordem.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-laminas-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword } = await import("../src/auth.js");
const express = (await import("express")).default;
const portal = (await import("../src/routes/portal.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa das Lâminas',0)").run().lastInsertRowid;
const apr = db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Aprovação',4,0,?)").run(org).lastInsertRowid;
const cli = db.prepare(
  "INSERT INTO clients (name,status,portal_username,portal_password_hash,org_id) VALUES ('Von Saltiel','active','vonsaltiel',?,?)"
).run(hashPassword("SenhaCliente#1"), org).lastInsertRowid;

const arquivo = (nome) => {
  const caminho = join(dir, nome);
  writeFileSync(caminho, Buffer.alloc(64, 1));
  return db.prepare(
    `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
     VALUES (?,?,'image/jpeg',64,?,'aprovacao',?)`
  ).run(cli, nome, caminho, org).lastInsertRowid;
};

// Três lâminas, criadas FORA de ordem de propósito: a ordem certa é a do
// media_ids, não a dos ids.
const b = arquivo("lamina-b.jpg");
const a = arquivo("lamina-a.jpg");
const c = arquivo("lamina-c.jpg");
const ordemCerta = [a, b, c];

const tarefa = db.prepare(
  `INSERT INTO tasks (title,stage_id,client_id,content_type,scheduled_at,approval_status,caption,cover_file_id,media_ids,org_id)
   VALUES ('Carrossel de 3',?,?,'carrossel','2026-10-20 09:00','sent','Legenda',?,?,?)`
).run(apr, cli, a, JSON.stringify(ordemCerta), org).lastInsertRowid;
for (const f of [b, a, c]) db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)").run(tarefa, f);

const app = express();
app.use(express.json());
app.use("/api/portal", portal);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/portal`;
after(() => srv.close());

const entrar = async () => {
  const r = await fetch(`${B}/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "vonsaltiel", password: "SenhaCliente#1" }),
  });
  return (await r.json()).token;
};

test("as três lâminas chegam ao cliente — não só a capa", async () => {
  const token = await entrar();
  const r = await fetch(`${B}/tasks/${tarefa}/attachments`, { headers: { authorization: `Bearer ${token}` } });
  const lista = await r.json();
  assert.equal(lista.length, 3, "o carrossel tem três lâminas");
  assert.ok(lista.every((f) => f.media_url), "cada uma com o endereço da arte");
});

test("e chegam NA ORDEM DAS LÂMINAS, não na ordem do banco", async () => {
  const token = await entrar();
  const lista = await (await fetch(`${B}/tasks/${tarefa}/attachments`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.deepEqual(lista.map((f) => f.id), ordemCerta,
    "a ordem do carrossel mora no media_ids — é a que vai ao ar");
});

test("sem media_ids, a ordem continua previsível", async () => {
  const t2 = db.prepare(
    `INSERT INTO tasks (title,stage_id,client_id,content_type,approval_status,cover_file_id,org_id)
     VALUES ('Sem ordem salva',?,?,'carrossel','sent',?,?)`
  ).run(apr, cli, a, org).lastInsertRowid;
  for (const f of [c, a]) db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)").run(t2, f);
  const token = await entrar();
  const lista = await (await fetch(`${B}/tasks/${t2}/attachments`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal(lista.length, 2);
});

test("lâmina que está no carrossel mas não virou anexo TAMBÉM aparece", async () => {
  // A verdade do carrossel é o media_ids: é ele que a publicação usa. Os anexos
  // são uma cópia dessa lista — e cópia sai do ar. Carrossel montado antes de a
  // gravação dos anexos existir pode ter seis lâminas e um anexo só: o cliente
  // aprovava olhando UMA arte e ia ao ar o carrossel inteiro.
  const t3 = db.prepare(
    `INSERT INTO tasks (title,stage_id,client_id,content_type,approval_status,cover_file_id,media_ids,org_id)
     VALUES ('Só a capa virou anexo',?,?,'carrossel','sent',?,?,?)`
  ).run(apr, cli, a, JSON.stringify([a, b, c]), org).lastInsertRowid;
  db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)").run(t3, a);  // só a capa

  const token = await entrar();
  const lista = await (await fetch(`${B}/tasks/${t3}/attachments`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.deepEqual(lista.map((f) => f.id), [a, b, c],
    "as três lâminas, na ordem do carrossel");
  assert.ok(lista.every((f) => f.media_url));
});

test("lâmina de outra casa citada no media_ids NÃO entra", async () => {
  const outraOrg = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const outroCli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Alheio','active',?)").run(outraOrg).lastInsertRowid;
  const alheio = db.prepare(
    `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
     VALUES (?,'alheia.jpg','image/jpeg',64,'/tmp/x','aprovacao',?)`
  ).run(outroCli, outraOrg).lastInsertRowid;

  const t4 = db.prepare(
    `INSERT INTO tasks (title,stage_id,client_id,content_type,approval_status,cover_file_id,media_ids,org_id)
     VALUES ('Com lâmina alheia',?,?,'carrossel','sent',?,?,?)`
  ).run(apr, cli, a, JSON.stringify([a, alheio]), org).lastInsertRowid;
  db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)").run(t4, a);

  const token = await entrar();
  const lista = await (await fetch(`${B}/tasks/${t4}/attachments`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.deepEqual(lista.map((f) => f.id), [a], "o arquivo é buscado pelo cliente dono");
});

// --- o que a tela do cliente promete -------------------------------------------

const tela = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/pages/Portal.jsx"), "utf8");

test("carrossel de várias lâminas vira UM slider, não uma pilha", () => {
  assert.match(tela, /function CarrosselDeLaminasPortal/);
  // ANTES exigia content_type === "carrossel". Regra trocada de propósito: a
  // peça montada como "post" com cinco artes, ou com o tipo em branco, voltava
  // a empilhar e a seta sumia. Mais de uma arte já basta.
  assert.match(tela, /\{midias\.length > 1\n\s*\? <CarrosselDeLaminasPortal files=\{midias\} \/>/,
    "a seta não pode depender do tipo estar escrito certo");
  assert.doesNotMatch(tela, /post\.content_type === "carrossel" && midias\.length > 1/);
});

test("a janela que abre pela agenda também tem seta", () => {
  // PostDialog abre pela agenda, pelo calendário e pela prévia do feed — e
  // empilhava as artes. Num carrossel de seis lâminas o cliente via a primeira
  // e rolava sem saber se o de baixo era outra lâmina ou outro post.
  const d = tela.slice(tela.indexOf("function PostDialog"), tela.indexOf("const EXT_VIDEO"));
  assert.match(d, /const laminas = attachments\.filter\(ehMidiaAprovacao\)/);
  assert.match(d, /laminas\.length > 1\n\s*\? <CarrosselDeLaminasPortal files=\{laminas\} \/>/);
  assert.match(d, /documentos\.map/, "o que não é arte (PDF, contrato) continua aparecendo");
});

test("as setas que a agência tem, agora o cliente também", () => {
  const c = tela.slice(tela.indexOf("function CarrosselDeLaminasPortal"), tela.indexOf("function CarrosselLargoPortal"));
  assert.match(c, /Lâmina anterior/);
  assert.match(c, /Próxima lâmina/);
  assert.match(c, /\{cur \+ 1\} \/ \{n\}/, "e o contador");
  assert.match(c, /files\.map\(\(f, i\)/, "e as bolinhas, que dizem que há mais de uma");
});

test("trocar de lâmina troca A ARTE — não só o contador", () => {
  // A Foto guarda o endereço da arte no estado dela. Sem trocar a chave, o
  // React reaproveita a mesma Foto: o contador ia para 3/3 e a imagem ficava
  // na 1. Visto no navegador, não deduzido.
  const c = tela.slice(tela.indexOf("function CarrosselDeLaminasPortal"), tela.indexOf("function CarrosselLargoPortal"));
  assert.match(c, /<Foto key=\{atual\.id\}/);
  assert.match(c, /component="video"[\s\S]{0,40}key=\{atual\.id\}|key=\{atual\.id\} component="video"/);
});

test("o botão de baixar segue a lâmina que está na tela", () => {
  const c = tela.slice(tela.indexOf("function CarrosselDeLaminasPortal"), tela.indexOf("function CarrosselLargoPortal"));
  assert.match(c, /Baixar lâmina \$\{cur \+ 1\}/);
  assert.match(c, /files\/\$\{atual\.id\}\/download/);
});
