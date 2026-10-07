// AUDITORIA DO QUE SAI SOZINHO.
//
// Pedido dela: "confere para mim se realmente os aprovados para ser postados
// vão ser postados conforme as datas colocadas ali. Eu testei programar a mão,
// apareceu 'publicar agora', funcionou, entrou direitinho, porém eu tô com
// receio desses que vão entrar sozinhos."
//
// O caminho manual e o automático NÃO são o mesmo código: o manual passa pela
// rota (com o endereço do site vindo do pedido HTTP), o automático roda sozinho
// a cada 5 minutos e não tem pedido nenhum de onde tirar esse endereço. Então
// "o manual funcionou" não prova nada sobre o outro.
//
// Aqui o robô roda DE VERDADE, com a Meta fingida, e cada caso é conferido:
// o que tem de sair, o que não tem, e o que tem de virar aviso.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-auto-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";
// Sem estas três, metaConfigured() é falso e o robô nem tenta.
process.env.META_APP_ID = "app";
process.env.META_APP_SECRET = "segredo";
process.env.META_REDIRECT_URI = "https://exemplo.com/callback";
process.env.PUBLIC_URL = "exemplo.onrender.com";   // como o Render preenche: só o host

const { db } = await import("../src/db.js");
const { agoraNaAgencia } = await import("../src/fuso.js");
const { runAutoPublish } = await import("../src/publisher.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Robô',0)").run().lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,auto_publish,org_id) VALUES ('Von Saltiel','active',1,?)")
  .run(org).lastInsertRowid;
db.prepare("INSERT INTO integrations (client_id,provider,ig_user_id,access_token,org_id) VALUES (?,'meta','IG1','tok',?)")
  .run(cli, org);

/** Uma hora, em minutos a partir de agora, no relógio DAQUI. */
const daqui = (minutos) => {
  const d = new Date(`${agoraNaAgencia().replace(" ", "T")}Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutos);
  return d.toISOString().slice(0, 19).replace("T", " ");
};

const arte = (mime = "image/jpeg") => db.prepare(
  `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
   VALUES (?,'a.jpg',?,10,'/tmp/a.jpg','editados',?)`
).run(cli, mime, org).lastInsertRowid;

function peca({ titulo, quando, aprovada = true, comArte = true, cliente = cli }) {
  const id = db.prepare(
    `INSERT INTO tasks (title,client_id,scheduled_at,approval_status,org_id)
     VALUES (?,?,?,?,?)`
  ).run(titulo, cliente, quando, aprovada ? "approved" : "pending", org).lastInsertRowid;
  if (comArte) {
    const f = arte();
    db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)").run(id, f);
    db.prepare("UPDATE tasks SET cover_file_id = ? WHERE id = ?").run(f, id);
  }
  return id;
}
const ler = (id) => db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
const avisosDe = (id) => db.prepare("SELECT message FROM notifications WHERE task_id = ?").all(id).map((n) => n.message);

/** A Meta fingida. Guarda a conversa para a gente conferir o que foi enviado. */
function fingeAMeta({ falhar = false } = {}) {
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    chamadas.push({ url: String(url), metodo: options?.method || "GET" });
    if (falhar) return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: "deu ruim" } }) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: `post${chamadas.length}` }) };
  };
  return { chamadas, desfaz: () => { globalThis.fetch = original; } };
}

after(() => db.close());

// --- o caso que ela quer ter certeza -------------------------------------------

test("chegada a hora, a peça aprovada SAI sozinha", async () => {
  const id = peca({ titulo: "Post das 15:25", quando: daqui(-2) });
  const meta = fingeAMeta();
  try {
    const r = await runAutoPublish();
    assert.equal(r.publicados, 1, "o robô pegou a peça");
  } finally { meta.desfaz(); }

  const t = ler(id);
  assert.ok(t.published_at, "ficou marcada como publicada");
  assert.ok(t.external_post_id, "guardou o id do post lá no Instagram");
  assert.equal(t.publish_error, null);
  assert.ok(avisosDe(id).some((m) => /publicado no instagram/i.test(m)), "e avisou no sininho");
});

test("o endereço da arte que vai para a Meta é PÚBLICO e completo", async () => {
  // É o ponto cego do automático: a rota manual tira o endereço do pedido HTTP,
  // e o robô não tem pedido nenhum. Só sobra o PUBLIC_URL.
  const id = peca({ titulo: "Confere o endereço", quando: daqui(-1) });
  const meta = fingeAMeta();
  try { await runAutoPublish(); } finally { meta.desfaz(); }

  const comImagem = meta.chamadas.find((c) => /image_url/.test(decodeURIComponent(c.url)));
  assert.ok(comImagem, "mandou a imagem");
  const url = new URL(comImagem.url).searchParams.get("image_url");
  assert.match(url, /^https:\/\/exemplo\.onrender\.com\/api\/files\/shared\//,
    "endereço relativo a Meta não alcança — e o erro seria incompreensível");
  assert.ok(ler(id).published_at);
});

// --- o que NÃO pode sair ---------------------------------------------------------

test("a hora ainda não chegou: fica quieto", async () => {
  const id = peca({ titulo: "Daqui a uma hora", quando: daqui(60) });
  const meta = fingeAMeta();
  try { await runAutoPublish(); } finally { meta.desfaz(); }
  assert.equal(ler(id).published_at, null);
});

test("sem a aprovação do cliente, não vai ao ar de jeito nenhum", async () => {
  const id = peca({ titulo: "Não aprovada", quando: daqui(-5), aprovada: false });
  const meta = fingeAMeta();
  try { await runAutoPublish(); } finally { meta.desfaz(); }
  assert.equal(ler(id).published_at, null);
});

test("sem arte anexada, não publica — e agora cobra", async () => {
  const id = peca({ titulo: "Sem arte", quando: daqui(-5), comArte: false });
  const meta = fingeAMeta();
  try { await runAutoPublish(); } finally { meta.desfaz(); }
  assert.equal(ler(id).published_at, null);
  assert.ok(avisosDe(id).some((m) => /Falta a arte/.test(m)));
});

test("com o interruptor do cliente desligado, nada sai", async () => {
  const quieto = db.prepare("INSERT INTO clients (name,status,auto_publish,org_id) VALUES ('Quieto','active',0,?)")
    .run(org).lastInsertRowid;
  db.prepare("INSERT INTO integrations (client_id,provider,ig_user_id,access_token,org_id) VALUES (?,'meta','IG2','tok',?)")
    .run(quieto, org);
  const id = peca({ titulo: "De cliente sem automático", quando: daqui(-5), cliente: quieto });
  const meta = fingeAMeta();
  try { await runAutoPublish(); } finally { meta.desfaz(); }
  assert.equal(ler(id).published_at, null);
  assert.ok(avisosDe(id).some((m) => /desligada neste cliente/.test(m)));
});

test("passou das 48h, o robô não joga no ar de surpresa — avisa", async () => {
  const id = peca({ titulo: "De três dias atrás", quando: daqui(-60 * 72) });
  const meta = fingeAMeta();
  try { await runAutoPublish(); } finally { meta.desfaz(); }
  assert.equal(ler(id).published_at, null);
  assert.ok(avisosDe(id).some((m) => /48h/.test(m)));
});

test("o que já foi publicado não sai duas vezes", async () => {
  const id = peca({ titulo: "Repetida", quando: daqui(-3) });
  let meta = fingeAMeta();
  try { await runAutoPublish(); } finally { meta.desfaz(); }
  const primeira = ler(id).published_at;
  assert.ok(primeira);

  meta = fingeAMeta();
  try { await runAutoPublish(); } finally { meta.desfaz(); }
  assert.equal(meta.chamadas.length, 0, "nem tentou de novo");
  assert.equal(ler(id).published_at, primeira);
});

test("sem PUBLIC_URL, o robô diz O QUE falta — não um erro da Meta", async () => {
  // Era o ponto cego: sem endereço público a conta montava um link relativo,
  // a Meta recusava, e o aviso vinha com uma mensagem que não explica nada.
  const guardado = process.env.PUBLIC_URL;
  process.env.PUBLIC_URL = "";
  const id = peca({ titulo: "Sem endereço público", quando: daqui(-6) });
  const meta = fingeAMeta();
  try { await runAutoPublish(); } finally { meta.desfaz(); process.env.PUBLIC_URL = guardado; }

  assert.equal(meta.chamadas.length, 0, "nem chegou a falar com a Meta");
  const t = ler(id);
  assert.equal(t.published_at, null);
  assert.match(t.publish_error, /PUBLIC_URL/);
  assert.ok(avisosDe(id).some((m) => /endereço público/.test(m)), "e o sininho diz o que arrumar");
});

// --- quando a Meta recusa ---------------------------------------------------------

test("se a Meta recusar, a peça NÃO fica dada como publicada — e o erro fica guardado", async () => {
  const id = peca({ titulo: "Vai falhar", quando: daqui(-4) });
  const meta = fingeAMeta({ falhar: true });
  try { await runAutoPublish(); } finally { meta.desfaz(); }

  const t = ler(id);
  assert.equal(t.published_at, null, "falhou é falhou");
  assert.ok(t.publish_error, "o motivo fica gravado na peça");
  assert.equal(t.publicando_desde, null, "e o portão abre de novo para a próxima rodada");
  assert.ok(avisosDe(id).some((m) => /Falha ao publicar/.test(m)));
});

test("depois de uma falha, a próxima rodada tenta de novo", async () => {
  const id = db.prepare("SELECT id FROM tasks WHERE title='Vai falhar'").get().id;
  const meta = fingeAMeta();
  try { await runAutoPublish(); } finally { meta.desfaz(); }
  assert.ok(ler(id).published_at, "não ficou presa por causa do tropeço anterior");
});

// --- o relógio --------------------------------------------------------------------

test("o robô usa o relógio DAQUI, não o de Greenwich", async () => {
  const servidor = db.prepare("SELECT datetime('now') AS t").get().t;
  const daquiAgora = agoraNaAgencia();
  assert.notEqual(servidor.slice(0, 13), daquiAgora.slice(0, 13),
    "o servidor roda em UTC — se a conta fosse com ele, tudo sairia 3h adiantado");

  // Uma peça marcada para daqui a 30 minutos: pelo relógio de Greenwich já
  // teria passado há muito; pelo nosso, ainda não é hora.
  const id = peca({ titulo: "Daqui a meia hora", quando: daqui(30) });
  const meta = fingeAMeta();
  try { await runAutoPublish(); } finally { meta.desfaz(); }
  assert.equal(ler(id).published_at, null);
});

// --- a fila que ela pode olhar sozinha ---------------------------------------------

test("a fila separa o que vai sair do que está marcado e não vai", async () => {
  const { filaDoAutomatico } = await import("../src/publisher.js");

  const vai = peca({ titulo: "Essa vai", quando: daqui(60 * 24) });
  const semArte = peca({ titulo: "Essa não tem arte", quando: daqui(60 * 25), comArte: false });
  const semAprovar = peca({ titulo: "Essa não foi aprovada", quando: daqui(60 * 26), aprovada: false });

  const fila = filaDoAutomatico(org, cli);
  const titulos = (lista) => lista.map((p) => p.title);

  assert.ok(titulos(fila.proximas).includes("Essa vai"));
  const travada = (t) => fila.travadas.find((p) => p.title === t);
  assert.match(travada("Essa não tem arte").motivo, /sem arte/);
  assert.match(travada("Essa não foi aprovada").motivo, /não aprovou/);
  assert.ok(!titulos(fila.proximas).includes("Essa não tem arte"), "não promete o que não vai sair");
});

test("com o automático desligado, a fila diz isso em vez de prometer", async () => {
  const { filaDoAutomatico } = await import("../src/publisher.js");
  const quieto = db.prepare("SELECT id FROM clients WHERE name='Quieto'").get().id;
  peca({ titulo: "Do cliente quieto", quando: daqui(60 * 24), cliente: quieto });
  const fila = filaDoAutomatico(org, quieto);
  assert.equal(fila.proximas.length, 0);
  assert.ok(fila.travadas.some((p) => /desligada/.test(p.motivo)));
});

test("a rodada roda a cada 5 minutos — é a precisão do horário", () => {
  const src = readFileSync(new URL("../src/publisher.js", import.meta.url), "utf8");
  assert.match(src, /CINCO_MIN = 5 \* 60 \* 1000/);
  assert.match(src, /setInterval\(/);
});
import { readFileSync } from "node:fs";
