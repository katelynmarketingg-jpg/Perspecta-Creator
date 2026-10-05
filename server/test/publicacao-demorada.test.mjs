// PUBLICAR SEM SEGURAR O CLIQUE, E AVISAR ANTES DO TOKEN VENCER.
//
// Os dois pontos que eu tinha deixado em aberto na auditoria das integrações,
// porque mudam o jeito de funcionar e não eram remendo. Ela disse "corrige".
//
//   · VÍDEO ESTOURAVA O TEMPO: a Meta processa antes de publicar e a gente
//     espera até 2 minutos. Esperar dentro do pedido fazia o navegador
//     desistir — a pessoa via erro de demora com o post indo ao ar depois, e
//     podia clicar de novo, publicando duas vezes.
//   · O TOKEN VENCIA EM SILÊNCIO: token_expires era gravado e nunca lido.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-demorada-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { encrypt } = await import("../src/crypto.js");
const {
  comecarPublicacao, terminarPublicacao, temVideo, soltarPenduradas,
  avisarTokensVencendo, diasAteVencer, LIMITE_PENDURADO_MIN, AVISAR_TOKEN_DIAS,
} = await import("../src/publicacao-demorada.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const integrations = (await import("../src/routes/integrations.js")).default;
const notifications = (await import("../src/routes/notifications.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Demorada',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@d.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Von Saltiel','active',?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/integrations", integrations);
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

const peca = (mime = "image/png", titulo = "Peça") => {
  const f = db.prepare(
    `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
     VALUES (?,'a.png',?,10,'x','editados',?)`).run(cli, mime, org).lastInsertRowid;
  const t = db.prepare("INSERT INTO tasks (title,client_id,cover_file_id,org_id) VALUES (?,?,?,?)")
    .run(titulo, cli, f, org).lastInsertRowid;
  db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)").run(t, f);
  return t;
};
const lerTask = (id) => db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
const avisos = () => db.prepare("SELECT * FROM notifications WHERE org_id = ? ORDER BY id").all(org);

// --- o portão contra publicar duas vezes ----------------------------------------

test("o segundo clique não passa enquanto o primeiro trabalha", () => {
  const t = peca();
  assert.equal(comecarPublicacao(t, org), true, "o primeiro entra");
  assert.equal(comecarPublicacao(t, org), false, "o segundo bate na porta");
  terminarPublicacao(t, org);
  assert.equal(comecarPublicacao(t, org), true, "depois de terminar, libera");
});

test("marca velha não tranca a peça para sempre", () => {
  const t = peca();
  db.prepare("UPDATE tasks SET publicando_desde = datetime('now', ?) WHERE id = ?")
    .run(`-${LIMITE_PENDURADO_MIN + 5} minutes`, t);
  assert.equal(comecarPublicacao(t, org), true, "servidor caiu no meio: pode tentar de novo");
});

test("peça já publicada não entra no portão", () => {
  const t = peca();
  db.prepare("UPDATE tasks SET published_at = datetime('now') WHERE id = ?").run(t);
  assert.equal(comecarPublicacao(t, org), false);
});

test("o portão é por casa", () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const t = peca();
  assert.equal(comecarPublicacao(t, outra), false, "não dá para destravar a peça da vizinha");
});

// --- o que ficou pendurado quando o servidor reiniciou ----------------------------

test("publicação pendurada é solta no reinício, com aviso", () => {
  const t = peca("image/png", "Ficou no meio");
  db.prepare("UPDATE tasks SET publicando_desde = datetime('now', ?) WHERE id = ?")
    .run(`-${LIMITE_PENDURADO_MIN + 10} minutes`, t);

  assert.equal(soltarPenduradas(), 1);
  assert.equal(lerTask(t).publicando_desde, null, "a peça voltou a poder ser publicada");
  const aviso = avisos().find((n) => n.task_id === t);
  assert.match(aviso.message, /ficou no meio da publicação/);
  assert.match(aviso.message, /Confira no Instagram/, "o post PODE ter ido ao ar — quem confere é quem olha");
});

test("publicação recente NÃO é solta — ela ainda está acontecendo", () => {
  const t = peca();
  comecarPublicacao(t, org);
  assert.equal(soltarPenduradas(), 0);
  assert.ok(lerTask(t).publicando_desde, "continua segurada");
  terminarPublicacao(t, org);
});

// --- vídeo responde na hora -------------------------------------------------------

test("temVideo olha o tipo do arquivo", () => {
  assert.equal(temVideo([{ mime: "image/png" }]), false);
  assert.equal(temVideo([{ mime: "image/png" }, { mime: "video/mp4" }]), true, "basta uma slide de vídeo");
  assert.equal(temVideo([{}]), false, "sem tipo não quebra");
});

test("vídeo responde 202 na hora, em vez de segurar o clique", async () => {
  const t = peca("video/mp4", "Reel");
  db.prepare(
    `INSERT INTO integrations (org_id,client_id,provider,page_id,ig_user_id,access_token)
     VALUES (?,?,'meta','P','IG',?)`).run(org, cli, encrypt("tok"));

  // A Meta nunca responde neste teste: é justamente o caso que segurava tudo.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => String(url).includes("graph.facebook.com")
    ? new Promise(() => {})                       // pendura para sempre
    : originalFetch(url, options);
  try {
    const t0 = Date.now();
    const r = await pedir("POST", `/integrations/publish/${t}`);
    const demorou = Date.now() - t0;
    assert.equal(r.status, 202, "voltou sem esperar a Meta");
    assert.equal(r.corpo.emAndamento, true);
    assert.match(r.corpo.aviso, /aviso quando/);
    assert.ok(demorou < 3000, `voltou rápido (${demorou}ms)`);
    assert.ok(lerTask(t).publicando_desde, "e ficou marcada como publicando");

    // E o clique repetido bate no portão em vez de virar um segundo post.
    const segundo = await pedir("POST", `/integrations/publish/${t}`);
    assert.equal(segundo.status, 409);
    assert.match(segundo.corpo.error, /já está sendo publicada/);
  } finally {
    globalThis.fetch = originalFetch;
    terminarPublicacao(t, org);
  }
});

// --- o token vencendo --------------------------------------------------------------

const emDias = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString();
};
const porVencer = (dias) => db.prepare(
  "UPDATE integrations SET token_expires = ?, aviso_token_em = NULL WHERE client_id = ? AND org_id = ?"
).run(emDias(dias), cli, org);

test("avisa antes de vencer, uma vez por dia", () => {
  porVencer(3);
  const antes = avisos().length;
  assert.equal(avisarTokensVencendo(org), 1);
  const novo = avisos().slice(antes)[0];
  assert.match(novo.message, /vence em/);
  assert.match(novo.message, /Reconecte em Integrações/);
  assert.equal(avisarTokensVencendo(org), 0, "não repete no mesmo dia");
});

test("vencido fala no passado e diz que nada publica", () => {
  porVencer(-2);
  const antes = avisos().length;
  avisarTokensVencendo(org);
  const novo = avisos().slice(antes)[0];
  assert.match(novo.message, /venceu em/);
  assert.match(novo.message, /nada publica até lá/);
});

test("token longe de vencer não incomoda", () => {
  porVencer(AVISAR_TOKEN_DIAS + 30);
  const antes = avisos().length;
  assert.equal(avisarTokensVencendo(org), 0);
  assert.equal(avisos().length, antes);
});

test("conexão sem data de vencimento não gera aviso", () => {
  db.prepare("UPDATE integrations SET token_expires = NULL, aviso_token_em = NULL WHERE client_id = ?").run(cli);
  assert.equal(avisarTokensVencendo(org), 0);
});

test("o aviso não atravessa para outra casa", () => {
  const outra = db.prepare("SELECT id FROM organizations WHERE name = 'Vizinha'").get().id;
  const cliAlheio = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Dela','active',?)").run(outra).lastInsertRowid;
  db.prepare(
    `INSERT INTO integrations (org_id,client_id,provider,page_id,access_token,token_expires)
     VALUES (?,?,'meta','P2',?,?)`).run(outra, cliAlheio, encrypt("t"), emDias(1));
  assert.equal(avisarTokensVencendo(org), 0, "a da vizinha é problema dela");
});

test("diasAteVencer conta certo", () => {
  assert.equal(diasAteVencer(null), null);
  assert.equal(diasAteVencer("não é data"), null);
  const cinco = diasAteVencer(emDias(5));
  assert.ok(cinco === 4 || cinco === 5, `cinco dias à frente conta 4 ou 5 (veio ${cinco})`);
  assert.ok(diasAteVencer(emDias(-3)) < 0, "vencido conta negativo");
});

test("abrir as notificações dispara o aviso sozinho", async () => {
  porVencer(2);
  const r = await pedir("GET", "/notifications");
  assert.equal(r.status, 200);
  assert.ok(r.corpo.some((n) => /vence em/.test(n.message)), "já veio na lista");
});

test("a tela recebe quantos dias faltam", async () => {
  porVencer(6);
  const r = await pedir("GET", "/integrations/meta/status");
  const conexao = r.corpo.connections.find((c) => c.client_id === cli);
  assert.equal(conexao.dias_para_vencer, 5);
  assert.equal(conexao.access_token, undefined, "o token continua sem sair do servidor");
});

// --- o que a tela promete -----------------------------------------------------------

const aqui = dirname(fileURLToPath(import.meta.url));
const dist = readFileSync(join(aqui, "../../client/src/pages/Distribution.jsx"), "utf8");
const integra = readFileSync(join(aqui, "../../client/src/pages/Integrations.jsx"), "utf8");

test("a peça entende o 202 e NÃO se marca como postada antes da hora", () => {
  const trecho = dist.slice(dist.indexOf("async function publicarAgora"), dist.indexOf("async function marcarPostado"));
  assert.match(trecho, /r\.status === 202 \|\| r\.data\?\.emAndamento/);
  const ramo = trecho.slice(trecho.indexOf("emAndamento"), trecho.indexOf("} else {"));
  assert.ok(!/setPosted\(true\)/.test(ramo), "quem marca é o aviso, quando entrar mesmo");
});

test("a aba de Integrações avisa o vencimento, com botão de reconectar", () => {
  assert.match(integra, /dias_para_vencer/);
  assert.match(integra, /A conexão com a Meta venceu/);
  assert.match(integra, /Reconectar/);
});

test("o arroba do usuário entra uma vez só", () => {
  // A Meta devolve sem arroba, mas dado antigo pode vir com ela.
  db.prepare("UPDATE integrations SET ig_username = '@comarroba', token_expires = ?, aviso_token_em = NULL WHERE client_id = ? AND org_id = ?")
    .run(emDias(2), cli, org);
  const antes = avisos().length;
  avisarTokensVencendo(org);
  const novo = avisos().slice(antes)[0];
  assert.match(novo.message, /@comarroba/);
  assert.ok(!/@@/.test(novo.message), "nada de @@");
});
