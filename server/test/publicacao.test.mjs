// PUBLICAÇÃO: o que sai sozinho, o que não sai, e o que avisa.
//
// Ela conectou a página em Integrações e nada foi publicado. Três buracos
// vieram daí:
//   · o interruptor "Publicar sozinho" nasce desligado (isso é de propósito e
//     continua assim — publicar é irreversível);
//   · a peça que perdia a janela era ignorada EM SILÊNCIO, para sempre;
//   · não existia nenhum botão para publicar a pedido, apesar de a rota existir.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-publi-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { avisarAtrasados, JANELA_DE_ATRASO } = await import("../src/publisher.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const integrations = (await import("../src/routes/integrations.js")).default;
const distribution = (await import("../src/routes/distribution.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Post',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@p.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Von Saltiel','active',?)").run(org).lastInsertRowid;
const etapa = db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Programados',4,1,?)")
  .run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/integrations", integrations);
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

const horas = (n) => {
  const d = new Date(); d.setHours(d.getHours() + n);
  return d.toISOString().slice(0, 19).replace("T", " ");
};
const arte = () => db.prepare(
  `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
   VALUES (?,'a.png','image/png',10,'x','editados',?)`).run(cli, org).lastInsertRowid;

function peca({ quando, aprovada = true, comArte = true, titulo = "Post" }) {
  const id = db.prepare(
    `INSERT INTO tasks (title,stage_id,client_id,content_type,scheduled_at,approval_status,org_id)
     VALUES (?,?,?,'post',?,?,?)`
  ).run(titulo, etapa, cli, quando, aprovada ? "approved" : "pending", org).lastInsertRowid;
  if (comArte) db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)").run(id, arte());
  return id;
}
const conectarMeta = () => db.prepare(
  "INSERT OR IGNORE INTO integrations (org_id,client_id,provider,page_id,ig_user_id,access_token) VALUES (?,?,'meta','p1','ig1','tok')"
).run(org, cli);
const ligarAuto = (v) => pedir("PUT", "/integrations/auto-publish", { client_id: cli, enabled: v });
const avisosDe = (taskId) => db.prepare("SELECT * FROM notifications WHERE task_id = ? ORDER BY id").all(taskId);
const lerTask = (id) => db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);

conectarMeta();

// --- a trava de ligar o interruptor -------------------------------------------

test("ligar o automático grava DESDE QUANDO", async () => {
  const r = await ligarAuto(true);
  assert.equal(r.status, 200);
  const c = db.prepare("SELECT auto_publish, auto_publish_desde FROM clients WHERE id = ?").get(cli);
  assert.equal(c.auto_publish, 1);
  assert.ok(c.auto_publish_desde, "marcou o momento");
});

test("reabrir a tela e ligar de novo NÃO empurra a marca para a frente", async () => {
  const antes = db.prepare("SELECT auto_publish_desde FROM clients WHERE id = ?").get(cli).auto_publish_desde;
  await ligarAuto(true);
  const depois = db.prepare("SELECT auto_publish_desde FROM clients WHERE id = ?").get(cli).auto_publish_desde;
  assert.equal(depois, antes, "só a virada de desligado para ligado remarca");
});

test("cliente de outra casa não é ligado", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const alheio = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Dela','active',?)").run(outra).lastInsertRowid;
  const r = await pedir("PUT", "/integrations/auto-publish", { client_id: alheio, enabled: true });
  assert.equal(r.status, 404);
  assert.equal(db.prepare("SELECT auto_publish FROM clients WHERE id = ?").get(alheio).auto_publish, 0);
});

// --- o aviso de atraso, que é o buraco principal -------------------------------

test("peça que passou da janela VIRA AVISO — não some mais em silêncio", () => {
  const id = peca({ quando: horas(-72), titulo: "Perdeu a hora" });
  assert.equal(avisarAtrasados(org) >= 1, true);
  const avisos = avisosDe(id);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].message, /passou da hora/);
  assert.match(avisos[0].message, /Perdeu a hora/);
});

test("o aviso sai UMA vez, não todo dia", () => {
  const id = peca({ quando: horas(-80), titulo: "Uma vez só" });
  avisarAtrasados(org);
  avisarAtrasados(org);
  avisarAtrasados(org);
  assert.equal(avisosDe(id).length, 1);
  assert.ok(lerTask(id).aviso_atraso_em, "ficou marcada como avisada");
});

test("dentro da janela ainda não é atraso — o robô ainda vai tentar", () => {
  // O interruptor está ligado desde ontem: a peça de 2h atrás está ao alcance
  // do automático, então cobrar seria falso alarme.
  db.prepare("UPDATE clients SET auto_publish_desde = datetime('now','-1 day') WHERE id = ?").run(cli);
  const id = peca({ quando: horas(-2), titulo: "Ainda dá tempo" });
  avisarAtrasados(org);
  assert.equal(avisosDe(id).length, 0);
});

test("peça programada ANTES de ligar o automático é cobrada, não publicada", () => {
  // É o caso real dela: os 9 programados de antes de conectar a página.
  const desde = db.prepare("SELECT auto_publish_desde FROM clients WHERE id = ?").get(cli).auto_publish_desde;
  const antesDeLigar = new Date(new Date(desde).getTime() - 3600_000).toISOString().slice(0, 19).replace("T", " ");
  const id = peca({ quando: antesDeLigar, titulo: "De antes do interruptor" });
  avisarAtrasados(org);
  const avisos = avisosDe(id);
  assert.equal(avisos.length, 1, "ela fica sabendo");
  assert.match(avisos[0].message, /passou da hora/);
});

test("com o automático desligado, o aviso diz isso", async () => {
  await ligarAuto(false);
  const id = peca({ quando: horas(-5), titulo: "Com o automático desligado" });
  avisarAtrasados(org);
  assert.match(avisosDe(id)[0].message, /automática está desligada/);
  await ligarAuto(true);
});

test("não cobra o que ninguém esperava: sem aprovação ou já publicado", () => {
  const semAprovacao = peca({ quando: horas(-72), aprovada: false, titulo: "Sem aprovação" });
  const jaFoi = peca({ quando: horas(-72), titulo: "Já publicado" });
  db.prepare("UPDATE tasks SET published_at = datetime('now') WHERE id = ?").run(jaFoi);

  avisarAtrasados(org);
  for (const id of [semAprovacao, jaFoi]) {
    assert.equal(avisosDe(id).length, 0, `não cobra ${lerTask(id).title}`);
  }
});

// ESTE CASO MUDOU DE LADO, DE PROPÓSITO.
//
// Antes, a peça aprovada e com hora marcada que não tivesse arte anexada ficava
// FORA também da lista de atrasadas: não publicava e não avisava. Era o pior
// silêncio dos três, porque de fora parece tudo certo — a peça está lá,
// aprovada, com a hora. Agora ela é cobrada, dizendo o que falta.
test("sem arte, agora cobra — e diz que o que falta é a arte", () => {
  const semArte = peca({ quando: horas(-72), comArte: false, titulo: "Sem arte" });
  avisarAtrasados(org);
  const avisos = avisosDe(semArte);
  assert.equal(avisos.length, 1, "não pode ficar em silêncio");
  assert.match(avisos[0].message, /Falta a arte/);
});

test("peça sem data marcada não é cobrada", () => {
  const id = peca({ quando: null, titulo: "Sem data" });
  avisarAtrasados(org);
  assert.equal(avisosDe(id).length, 0);
});

test("o aviso não atravessa para outra casa", () => {
  const outra = db.prepare("SELECT id FROM organizations WHERE name = 'Vizinha'").get().id;
  const cliAlheio = db.prepare("SELECT id FROM clients WHERE org_id = ?").get(outra).id;
  const alheia = db.prepare(
    `INSERT INTO tasks (title,client_id,scheduled_at,approval_status,org_id)
     VALUES ('Da vizinha',?,?,'approved',?)`).run(cliAlheio, horas(-72), outra).lastInsertRowid;
  db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)").run(alheia, arte());

  avisarAtrasados(org);
  assert.equal(avisosDe(alheia).length, 0);
  assert.equal(lerTask(alheia).aviso_atraso_em, null, "nem marcou como avisada");
});

// --- remarcar devolve o direito de cobrar ---------------------------------------

test("mudar a data apaga o aviso: a peça volta a poder ser cobrada", async () => {
  const id = peca({ quando: horas(-72), titulo: "Remarcada" });
  avisarAtrasados(org);
  assert.ok(lerTask(id).aviso_atraso_em);

  await pedir("PUT", `/distribution/${id}`, { scheduled_at: horas(-50) });
  assert.equal(lerTask(id).aviso_atraso_em, null, "data nova, cobrança nova");

  avisarAtrasados(org);
  assert.equal(avisosDe(id).length, 2, "cobrou de novo");
});

test("salvar só a legenda NÃO apaga o aviso", async () => {
  const id = peca({ quando: horas(-72), titulo: "Só legenda" });
  avisarAtrasados(org);
  const marca = lerTask(id).aviso_atraso_em;
  await pedir("PUT", `/distribution/${id}`, { caption: "texto novo" });
  assert.equal(lerTask(id).aviso_atraso_em, marca, "mexer na legenda não é remarcar");
});

// --- publicar a pedido ----------------------------------------------------------

test("a rota de publicar recusa o que já foi publicado", async () => {
  const id = peca({ quando: horas(-1), titulo: "Repetida" });
  db.prepare("UPDATE tasks SET published_at = datetime('now') WHERE id = ?").run(id);
  const r = await pedir("POST", `/integrations/publish/${id}`);
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /já foi publicado/);
});

test("a rota de publicar não alcança peça de outra casa", async () => {
  const outra = db.prepare("SELECT id FROM organizations WHERE name = 'Vizinha'").get().id;
  const alheia = db.prepare("INSERT INTO tasks (title,org_id) VALUES ('Dela',?)").run(outra).lastInsertRowid;
  const r = await pedir("POST", `/integrations/publish/${alheia}`);
  assert.equal(r.status, 404);
});

test("a listagem diz se o cliente tem a Meta ligada — é o que mostra o botão", async () => {
  // A listagem sai da etapa "Distribuição"; sem ela a rota devolve vazio.
  const etapaDist = db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Distribuição',3,0,?)")
    .run(org).lastInsertRowid;
  const id = peca({ quando: horas(6), titulo: "Na distribuição" });
  db.prepare("UPDATE tasks SET stage_id = ?, approval_status = 'pending' WHERE id = ?").run(etapaDist, id);

  const r = await pedir("GET", `/distribution?client_id=${cli}`);
  assert.equal(r.status, 200);
  const comData = (r.corpo.scheduled || []).concat(r.corpo.items || []);
  assert.ok(comData.length, "tem peças para conferir");
  assert.equal(comData[0].meta_conectada, 1);
});

// --- o que a tela promete --------------------------------------------------------

const aqui = dirname(fileURLToPath(import.meta.url));
const dist = readFileSync(join(aqui, "../../client/src/pages/Distribution.jsx"), "utf8");
const tarefas = readFileSync(join(aqui, "../../client/src/pages/Tasks.jsx"), "utf8");

test("a peça tem o botão 'Publicar agora', e ele confirma antes", () => {
  const trecho = dist.slice(dist.indexOf("async function publicarAgora"), dist.indexOf("async function marcarPostado"));
  assert.match(trecho, /window\.confirm\(/, "vai ao ar na conta do cliente: confirma");
  assert.match(trecho, /integrations\/publish\//, "chama a rota que já existia");
  assert.match(dist, /Publicar agora/);
  assert.match(dist, /item\.meta_conectada/, "só aparece com o Instagram conectado");
});

test("o aviso velho de 'aguardando o app Meta developer' saiu", () => {
  assert.ok(!/aguardando o app Meta developer/.test(tarefas),
    "a integração existe faz tempo — o texto mentia para quem lia");
});

test("a janela de atraso é maior que um dia", () => {
  assert.match(JANELA_DE_ATRASO, /-(\d+) hours/);
  assert.ok(Number(JANELA_DE_ATRASO.match(/-(\d+)/)[1]) > 24);
});

// --- quando a Meta não responde JSON ---------------------------------------------
//
// Ela cai, limita o uso ou devolve página de erro do gateway: vem HTML. O
// `json()` estourava com "Unexpected token '<'" — e era ISSO que aparecia na
// tela, no lugar do problema real.

test("resposta que não é JSON vira recado legível, não erro de parse", async () => {
  const meta = readFileSync(join(aqui, "../src/meta.js"), "utf8");
  const trecho = meta.slice(meta.indexOf("async function graph("), meta.indexOf("export async function exchangeCode"));
  assert.match(trecho, /await res\.text\(\)/, "lê como texto antes de tentar entender");
  assert.match(trecho, /JSON\.parse/);
  assert.match(trecho, /A Meta respondeu/, "o recado diz de quem é o problema");
  assert.ok(!/const data = await res\.json\(\);/.test(trecho), "o json() cru saiu");
});
