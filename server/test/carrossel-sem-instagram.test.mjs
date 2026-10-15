// CARROSSEL NUM CLIENTE QUE SÓ TEM A PÁGINA DO FACEBOOK.
//
// Pedido dela: "não estou conseguindo postar um carrossel no perfil do Marcelo
// Lemos, mesmo tendo uma página no Facebook."
//
// Ter Página do Facebook não basta. Carrossel é recurso do Instagram: a Meta só
// aceita publicar um por uma conta PROFISSIONAL vinculada à Página. E o que o
// sistema fazia nesse caso era pior do que recusar — mandava SÓ A PRIMEIRA
// lâmina para o Facebook e escrevia no sininho "publicado (carrossel de 6
// slides)". Seis aprovadas, uma no ar, e o sistema dizendo que deu certo.
//
// Aqui cada parte disso é medida: a recusa, o que ela diz, o que NÃO foi
// gravado, o robô que não tenta mais, e a fila que avisa antes da data.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-carr-ig-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";
process.env.META_APP_ID = "app";
process.env.META_APP_SECRET = "segredo";
process.env.META_REDIRECT_URI = "https://exemplo.com/callback";
process.env.PUBLIC_URL = "exemplo.onrender.com";

const { db } = await import("../src/db.js");
const { encrypt } = await import("../src/crypto.js");
const { agoraNaAgencia } = await import("../src/fuso.js");
const { publishTask } = await import("../src/routes/integrations.js");
const { prontosParaPublicar, filaDoAutomatico, avisarAtrasados } = await import("../src/publisher.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Carrossel',0)").run().lastInsertRowid;

// Marcelo: Página do Facebook, SEM Instagram vinculado. É o caso dela.
const marcelo = db.prepare(
  "INSERT INTO clients (name,status,auto_publish,org_id) VALUES ('Marcelo Lemos','active',1,?)"
).run(org).lastInsertRowid;
db.prepare(
  `INSERT INTO integrations (client_id,provider,page_id,page_name,ig_user_id,access_token,org_id)
   VALUES (?,'meta','PG1','Marcelo Lemos Advocacia',NULL,?,?)`
).run(marcelo, encrypt("tok"), org);

// Von Saltiel: Instagram profissional vinculado. É o controle.
const von = db.prepare(
  "INSERT INTO clients (name,status,auto_publish,org_id) VALUES ('Von Saltiel','active',1,?)"
).run(org).lastInsertRowid;
db.prepare(
  `INSERT INTO integrations (client_id,provider,page_id,page_name,ig_user_id,access_token,org_id)
   VALUES (?,'meta','PG2','Von Saltiel',' IG2 ',?,?)`
).run(von, encrypt("tok"), org);
db.prepare("UPDATE integrations SET ig_user_id='IG2' WHERE client_id=?").run(von);

const daqui = (minutos) => {
  const d = new Date(`${agoraNaAgencia().replace(" ", "T")}Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutos);
  return d.toISOString().slice(0, 19).replace("T", " ");
};

const arte = (cliente) => db.prepare(
  `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
   VALUES (?,'lamina.jpg','image/jpeg',10,'/tmp/lamina.jpg','editados',?)`
).run(cliente, org).lastInsertRowid;

/** Uma peça com N lâminas de verdade, na ordem, como a Galeria monta. */
function peca({ cliente, titulo, laminas, quando = daqui(-2) }) {
  const ids = Array.from({ length: laminas }, () => arte(cliente));
  const id = db.prepare(
    `INSERT INTO tasks (title,client_id,content_type,scheduled_at,approval_status,media_ids,cover_file_id,org_id)
     VALUES (?,?,'carrossel',?,'approved',?,?,?)`
  ).run(titulo, cliente, quando, JSON.stringify(ids), ids[0], org).lastInsertRowid;
  for (const f of ids) db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)").run(id, f);
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
}

/** A Meta fingida — para provar que ninguém a chamou. */
function fingeAMeta() {
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    chamadas.push({ url: String(url), metodo: options?.method || "GET" });
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: `post${chamadas.length}` }) };
  };
  return { chamadas, desfaz: () => { globalThis.fetch = original; } };
}

after(() => db.close());

// --- a recusa -----------------------------------------------------------------

test("carrossel num cliente só-Facebook é RECUSADO — não vai meia peça ao ar", async () => {
  const t = peca({ cliente: marcelo, titulo: "Carrossel dos 6 erros", laminas: 6 });
  const meta = fingeAMeta();
  let erro = null;
  try {
    await publishTask(t, org, "exemplo.onrender.com");
  } catch (e) { erro = e; } finally { meta.desfaz(); }

  assert.ok(erro, "tinha de recusar");
  assert.equal(meta.chamadas.length, 0, "e recusar ANTES de mandar qualquer coisa para a Meta");
  const depois = db.prepare("SELECT published_at, external_post_id FROM tasks WHERE id = ?").get(t.id);
  assert.equal(depois.published_at, null, "não pode ficar marcada como publicada");
  assert.equal(depois.external_post_id, null);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM notifications WHERE task_id = ?").get(t.id).n, 0,
    "e nada de aviso dizendo que publicou",
  );
});

test("a recusa diz o número de lâminas, o nome da página e o que fazer", async () => {
  const t = peca({ cliente: marcelo, titulo: "Carrossel de 3", laminas: 3 });
  const meta = fingeAMeta();
  let msg = "";
  try { await publishTask(t, org, "exemplo.onrender.com"); }
  catch (e) { msg = e.message; } finally { meta.desfaz(); }

  assert.match(msg, /3 lâminas/, "quantas lâminas são");
  assert.match(msg, /Marcelo Lemos Advocacia/, "de qual página se está falando");
  assert.match(msg, /Instagram/, "e qual é a rede que faz carrossel");
  assert.match(msg, /profissional/, "o vínculo que falta");
  assert.match(msg, /Integra(ç|c)ões/, "e onde arrumar");
});

test("peça de UMA arte nesse mesmo cliente continua indo para o Facebook", async () => {
  // A recusa é do carrossel, não do cliente: quem só tem Página segue
  // publicando foto única na Página, que é o que a Meta aceita.
  const f = arte(marcelo);
  const id = db.prepare(
    `INSERT INTO tasks (title,client_id,content_type,scheduled_at,approval_status,media_ids,cover_file_id,org_id)
     VALUES ('Foto única',?,'post',?,'approved',?,?,?)`
  ).run(marcelo, daqui(-2), JSON.stringify([f]), f, org).lastInsertRowid;
  const t = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);

  const meta = fingeAMeta();
  let r = null;
  try { r = await publishTask(t, org, "exemplo.onrender.com"); } finally { meta.desfaz(); }

  assert.equal(r.destino, "facebook");
  assert.equal(r.slides, 1);
  assert.ok(meta.chamadas.some((c) => /\/PG1\/photos/.test(c.url)), "foi pela página do Facebook");
  assert.ok(db.prepare("SELECT published_at FROM tasks WHERE id = ?").get(id).published_at);
});

test("o mesmo carrossel num cliente COM Instagram sai normal", async () => {
  const t = peca({ cliente: von, titulo: "Carrossel que sai", laminas: 3 });
  const meta = fingeAMeta();
  let r = null;
  try { r = await publishTask(t, org, "exemplo.onrender.com"); } finally { meta.desfaz(); }

  assert.equal(r.destino, "instagram");
  assert.equal(r.slides, 3);
  assert.equal(meta.chamadas.filter((c) => /is_carousel_item=true/.test(decodeURIComponent(c.url))).length, 3,
    "um container por lâmina");
  assert.ok(meta.chamadas.some((c) => /media_type=CAROUSEL/.test(decodeURIComponent(c.url))), "e o pai do carrossel");
});

// --- o robô -------------------------------------------------------------------

test("o robô NEM TENTA um carrossel sem Instagram", () => {
  peca({ cliente: marcelo, titulo: "Carrossel do robô", laminas: 4, quando: daqui(-5) });
  const prontos = prontosParaPublicar();
  assert.ok(!prontos.some((t) => t.title === "Carrossel do robô"),
    "tentar a cada rodada só enchia o sininho de erro da Meta");
});

test("mas o carrossel do cliente com Instagram continua na fila do robô", () => {
  peca({ cliente: von, titulo: "Carrossel do robô (Von)", laminas: 4, quando: daqui(-5) });
  assert.ok(prontosParaPublicar().some((t) => t.title === "Carrossel do robô (Von)"));
});

test("a fila de Integrações avisa ANTES da data, com o motivo", () => {
  peca({ cliente: marcelo, titulo: "Carrossel da semana que vem", laminas: 5, quando: daqui(60 * 24 * 3) });
  const { proximas, travadas } = filaDoAutomatico(org, marcelo);
  assert.ok(!proximas.some((p) => p.title === "Carrossel da semana que vem"), "não é 'vai sair'");
  const travada = travadas.find((p) => p.title === "Carrossel da semana que vem");
  assert.ok(travada, "é 'travada'");
  assert.match(travada.motivo, /carrossel/i);
  assert.match(travada.motivo, /Facebook/);
});

test("passou da hora, o aviso de atraso diz o motivo certo", () => {
  const t = peca({ cliente: marcelo, titulo: "Carrossel atrasado", laminas: 2, quando: daqui(-10) });
  avisarAtrasados(org);
  const avisos = db.prepare("SELECT message FROM notifications WHERE task_id = ?").all(t.id).map((n) => n.message);
  assert.ok(avisos.length, "avisou");
  assert.ok(avisos.some((m) => /Página do Facebook/.test(m) && /Instagram/.test(m)),
    `o motivo tem de ser o que é, não um erro cru da Meta — veio: ${avisos.join(" | ")}`);
});

// --- o que a tela promete -----------------------------------------------------

const aqui = dirname(fileURLToPath(import.meta.url));
const ler = (p) => readFileSync(join(aqui, p), "utf8");

test("Distribuição não oferece 'Publicar agora' para carrossel sem Instagram", () => {
  const tela = ler("../../client/src/pages/Distribution.jsx");
  assert.match(tela, /!item\.meta_instagram && slides\.length > 1/,
    "a condição da tela tem de ser a MESMA do servidor: mais de uma lâmina, sem Instagram");
  assert.match(tela, /carrossel só existe no Instagram/);
  // E o aviso de confirmação tem de dizer a rede certa.
  assert.match(tela, /const rede = item\.meta_instagram \? "Instagram" : "Facebook"/);
});

test("Integrações avisa que a conexão é só Página, onde se conecta", () => {
  const tela = ler("../../client/src/pages/Integrations.jsx");
  assert.match(tela, /!conn\.ig_user_id && \(/);
  assert.match(tela, /sem Instagram vinculado/);
});

test("o servidor manda para a tela se a conexão tem Instagram", () => {
  const rota = ler("../src/routes/distribution.js");
  const vezes = rota.split("AS meta_instagram").length - 1;
  assert.equal(vezes, 5, "as cinco listas da Distribuição, senão uma delas mente");
});

test("'nenhuma página' não manda mais criar uma página que já existe", () => {
  const meta = ler("../src/meta.js");
  assert.doesNotMatch(meta, /Crie uma Página e vincule/);
  assert.match(meta, /não foi marcada/, "o motivo real: a página não foi marcada na tela da Meta");
  assert.match(meta, /administrador/);
  assert.match(meta, /Portf(ó|o)lio Empresarial/);
});
