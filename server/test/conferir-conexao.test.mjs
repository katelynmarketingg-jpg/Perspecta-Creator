// "NÃO ESTÁ DANDO CERTO" — o buraco que fazia os passos certos não bastarem.
//
// Ela vinculou o Instagram à Página na Meta, como eu disse, e o sistema seguiu
// dizendo "sem Instagram vinculado". Estava certa: o ig_user_id só era gravado
// no login completo (saveConnection) e NADA nunca perguntava de novo. Vincular
// lá não chegava aqui nunca. O único jeito era desconectar e refazer o login
// inteiro — e ninguém adivinha isso.
//
// Aqui o botão "Conferir conexão" é medido: ele re-pergunta à Meta pela Página
// já guardada, grava o Instagram que apareceu, e quando não apareceu diz o que
// ainda falta em vez de um erro cru.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-conf-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";
process.env.META_APP_ID = "app";
process.env.META_APP_SECRET = "segredo";
process.env.META_REDIRECT_URI = "https://exemplo.com/callback";

const { db } = await import("../src/db.js");
const { encrypt } = await import("../src/crypto.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const integrations = (await import("../src/routes/integrations.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Conferir',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@c.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;

// Marcelo: conectado SÓ pela Página. É o caso dela.
const marcelo = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo Lemos','active',?)")
  .run(org).lastInsertRowid;
db.prepare(
  `INSERT INTO integrations (client_id,provider,page_id,page_name,ig_user_id,access_token,org_id)
   VALUES (?,'meta','PG1','Marcelo Lemos Advocacia',NULL,?,?)`
).run(marcelo, encrypt("tok"), org);

// Um cliente sem conexão nenhuma, para o caso de borda.
const semNada = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Sem Meta','active',?)")
  .run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/integrations", integrations);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/integrations`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => { srv.close(); db.close(); });

const conferir = (cli) => fetch(`${B}/meta/${cli}/conferir`, { method: "POST", headers: H })
  .then(async (r) => ({ st: r.status, ...(await r.json().catch(() => ({}))) }));

const conexao = (cli) => db.prepare("SELECT * FROM integrations WHERE client_id = ?").get(cli);

/** A Meta fingida: devolve a Página com ou sem Instagram vinculado. */
function fingeAMeta(resposta) {
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = String(url);
    if (!u.includes("graph.facebook.com")) return original(url, options);
    chamadas.push(u);
    if (resposta instanceof Error) {
      return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: resposta.message } }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(resposta) };
  };
  return { chamadas, desfaz: () => { globalThis.fetch = original; } };
}

const COM_IG = {
  name: "Marcelo Lemos Advocacia",
  instagram_business_account: {
    id: "IG99", username: "marcelolemos.adv", name: "Marcelo Lemos",
    profile_picture_url: "https://x/f.jpg", followers_count: 4200, media_count: 88,
  },
};
const SEM_IG = { name: "Marcelo Lemos Advocacia" };

// --- o conserto -----------------------------------------------------------------

test("o Instagram vinculado DEPOIS é encontrado e gravado — sem refazer login", async () => {
  assert.equal(conexao(marcelo).ig_user_id, null, "parte de 'sem Instagram', como ela está");
  const meta = fingeAMeta(COM_IG);
  let r;
  try { r = await conferir(marcelo); } finally { meta.desfaz(); }

  assert.equal(r.st, 200);
  assert.equal(r.instagram, true);
  const c = conexao(marcelo);
  assert.equal(c.ig_user_id, "IG99", "gravou o id — é ele que decide se o carrossel pode sair");
  assert.equal(c.ig_username, "marcelolemos.adv");
  assert.equal(c.ig_followers, 4200);
  assert.match(r.mensagem, /Achei agora/, "e diz que achou, em vez de um 'ok' mudo");
  assert.match(r.mensagem, /sem precisar reconectar/);
});

test("perguntou à Meta pela PÁGINA guardada, pedindo o Instagram dela", async () => {
  const meta = fingeAMeta(COM_IG);
  try { await conferir(marcelo); } finally { meta.desfaz(); }
  const u = decodeURIComponent(meta.chamadas[0] || "");
  assert.match(u, /\/PG1\?/, "pela página que já estava guardada");
  assert.match(u, /instagram_business_account/, "pedindo justamente o vínculo");
});

test("conferir de novo, já com Instagram, confirma que está tudo certo", async () => {
  const meta = fingeAMeta(COM_IG);
  let r;
  try { r = await conferir(marcelo); } finally { meta.desfaz(); }
  assert.equal(r.instagram, true);
  assert.match(r.mensagem, /Tudo certo/);
  assert.match(r.mensagem, /Carrossel/);
});

// --- quando ainda falta ----------------------------------------------------------

test("sem Instagram na Página, diz os TRÊS motivos reais — não um erro da Meta", async () => {
  const meta = fingeAMeta(SEM_IG);
  let r;
  try { r = await conferir(marcelo); } finally { meta.desfaz(); }

  assert.equal(r.st, 200);
  assert.equal(r.instagram, false);
  assert.match(r.mensagem, /profissional/, "conta profissional, não pessoal");
  assert.match(r.mensagem, /ESTA Página/, "vinculado a esta página, não a outra");
  assert.match(r.mensagem, /administrador/);
  assert.match(r.mensagem, /não precisa reconectar/, "e que dá para conferir de novo");
});

test("o que a Meta diz manda: Instagram que sumiu lá, sai daqui também", async () => {
  // Cliente trocou a conta do Instagram ou desvinculou. Guardar um ig_user_id
  // que não existe mais faria o sistema prometer carrossel e falhar na hora.
  db.prepare("UPDATE integrations SET ig_user_id='IG99', ig_username='velho' WHERE client_id=?").run(marcelo);
  const meta = fingeAMeta(SEM_IG);
  try { await conferir(marcelo); } finally { meta.desfaz(); }
  assert.equal(conexao(marcelo).ig_user_id, null, "a verdade é a da Meta, não a cópia daqui");
});

test("acesso vencido vira recado em português, com o que fazer", async () => {
  const meta = fingeAMeta(new Error("Error validating access token: Session has expired"));
  let r;
  try { r = await conferir(marcelo); } finally { meta.desfaz(); }
  assert.equal(r.st, 400);
  assert.match(r.error, /não aceitou mais o acesso/i);
  assert.match(r.error, /troca a senha|tira o app|vence/);
  assert.match(r.error, /Desconecte e conecte de novo/);
});

test("cliente sem Meta nenhuma manda conectar, não dá erro feio", async () => {
  const r = await conferir(semNada);
  assert.equal(r.st, 404);
  assert.match(r.error, /não tem a Meta conectada/i);
});

// --- a tela ----------------------------------------------------------------------

test("o botão Conferir aparece para quem NÃO tem Instagram — que é quem precisa", () => {
  const tela = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../client/src/pages/Integrations.jsx"), "utf8");
  assert.match(tela, /Conferir conexão/);
  // Não pode estar dentro do `conn.ig_user_id && (...)` do botão de atualizar:
  // lá ele só apareceria para quem já está resolvido.
  const trecho = tela.slice(tela.indexOf("Atualizar foto"), tela.indexOf("Conferir conexão"));
  assert.match(trecho, /\)\}/, "o botão de atualizar fecha ANTES do Conferir");
  assert.match(tela, /diagnostico\?\.client_id === c\.id/, "e a resposta sai no cartão daquele cliente");
});
