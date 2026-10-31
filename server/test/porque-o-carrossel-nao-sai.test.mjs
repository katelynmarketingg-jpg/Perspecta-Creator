// "APARECE QUE ESTÁ TUDO CERTO, MAS MESMO ASSIM NÃO ESTÁ POSTANDO O CARROSSEL.
//  Diferente do da Von, que estava funcionando."
//
// Duas coisas, e as duas eram nossas.
//
// 1) O CARROSSEL ESPERAVA SÓ O VÍDEO. A Meta não guarda o arquivo: ela BAIXA a
//    arte do nosso link e processa. Numa foto isso costuma ser instantâneo —
//    "costuma". Com o Render frio ou a arte pesada, o container ainda está
//    IN_PROGRESS quando montamos o pai do carrossel, e a Meta recusa com
//    "Media ID is not available", que não diz nada. É corrida, não
//    configuração: por isso o de um cliente saía e o do outro não.
//
// 2) NINGUÉM VIA O MOTIVO. publish_error era gravado desde sempre e a tela nem
//    pedia o campo. O aviso vermelho durava três segundos no clique e sumia; o
//    do robô ia só para o sininho. Sobrava "não está postando".
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-naosai-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";
process.env.META_APP_ID = "app";
process.env.META_APP_SECRET = "segredo";
process.env.META_REDIRECT_URI = "https://exemplo.com/callback";
process.env.PUBLIC_URL = "exemplo.onrender.com";

const { db } = await import("../src/db.js");
const { encrypt } = await import("../src/crypto.js");
const { recadoDaMeta } = await import("../src/meta.js");
const { publishTask } = await import("../src/routes/integrations.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Porque',0)").run().lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo Lemos','active',?)")
  .run(org).lastInsertRowid;
db.prepare(
  `INSERT INTO integrations (client_id,provider,page_id,page_name,ig_user_id,ig_username,access_token,org_id)
   VALUES (?,'meta','PG1','Marcelo Lemos Advocacia','IG99','marcelolemos.adv',?,?)`
).run(cli, encrypt("tok"), org);

const arte = () => db.prepare(
  `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
   VALUES (?,'lamina.jpg','image/jpeg',10,'/tmp/l.jpg','editados',?)`
).run(cli, org).lastInsertRowid;

function carrossel(titulo, n = 3) {
  const ids = Array.from({ length: n }, arte);
  const id = db.prepare(
    `INSERT INTO tasks (title,client_id,content_type,scheduled_at,approval_status,media_ids,cover_file_id,org_id)
     VALUES (?,?,'carrossel','2026-10-28 09:00','approved',?,?,?)`
  ).run(titulo, cli, JSON.stringify(ids), ids[0], org).lastInsertRowid;
  for (const f of ids) db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)").run(id, f);
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
}

after(() => db.close());

/**
 * A Meta fingida, com o detalhe que importa: cada container nasce IN_PROGRESS
 * e só fica FINISHED depois de `prontaApos` consultas — como a de verdade, que
 * precisa baixar a arte antes.
 */
function fingeAMeta({ prontaApos = 0, recusaPaiSeNaoPronto = true } = {}) {
  const containers = new Map();
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = String(url);
    chamadas.push(u);
    const resp = (corpo) => ({ ok: true, status: 200, text: async () => JSON.stringify(corpo) });
    const erro = (msg) => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: msg } }) });

    // Consulta de status de um container.
    const status = u.match(/\/(c\d+)\?/);
    if (status && /status_code/.test(decodeURIComponent(u))) {
      const c = containers.get(status[1]);
      c.consultas++;
      return resp({ status_code: c.consultas > prontaApos ? "FINISHED" : "IN_PROGRESS" });
    }
    // Criação de container (lâmina ou pai).
    if (/\/IG99\/media\?/.test(u)) {
      const d = decodeURIComponent(u);
      if (/media_type=CAROUSEL/.test(d)) {
        const filhos = (d.match(/children=([^&]+)/) || [])[1]?.split(",") || [];
        const atrasado = filhos.find((f) => {
          const c = containers.get(f);
          return c && c.consultas <= prontaApos;
        });
        if (atrasado && recusaPaiSeNaoPronto) return erro("Media ID is not available");
        const id = `pai${containers.size}`;
        containers.set(id, { consultas: 99 });
        return resp({ id });
      }
      const id = `c${containers.size}`;
      containers.set(id, { consultas: 0 });
      return resp({ id });
    }
    if (/media_publish/.test(u)) return resp({ id: "POST_PUBLICADO" });
    return resp({ id: "x" });
  };
  return { chamadas, desfaz: () => { globalThis.fetch = original; } };
}

// --- 1) a corrida ----------------------------------------------------------------

test("lâmina que a Meta ainda está baixando é ESPERADA — o carrossel sai", async () => {
  const t = carrossel("Carrossel do Marcelo");
  // Duas consultas até ficar pronta: no código antigo o pai era montado antes.
  const meta = fingeAMeta({ prontaApos: 2 });
  let r;
  try { r = await publishTask(t, org, "exemplo.onrender.com"); } finally { meta.desfaz(); }

  assert.equal(r.slides, 3);
  assert.equal(r.post_id, "POST_PUBLICADO");
  assert.ok(db.prepare("SELECT published_at FROM tasks WHERE id = ?").get(t.id).published_at);
});

test("a espera é por CADA lâmina, não só pela primeira", async () => {
  const t = carrossel("Carrossel de 4", 4);
  const meta = fingeAMeta({ prontaApos: 1 });
  try { await publishTask(t, org, "exemplo.onrender.com"); } finally { meta.desfaz(); }
  const consultas = meta.chamadas.filter((u) => /status_code/.test(decodeURIComponent(u)));
  assert.ok(consultas.length >= 8, `quatro lâminas, duas consultas cada — vieram ${consultas.length}`);
});

test("foto não espera no relógio do vídeo", async () => {
  // Se a foto fosse esperada de 6 em 6 segundos, este teste levaria mais de 10s.
  const t = carrossel("Carrossel rápido", 3);
  const meta = fingeAMeta({ prontaApos: 1 });
  const antes = Date.now();
  try { await publishTask(t, org, "exemplo.onrender.com"); } finally { meta.desfaz(); }
  assert.ok(Date.now() - antes < 8000, `levou ${Date.now() - antes}ms — foto tem de ser esperada de perto`);
});

// --- 2) o motivo, em português e grudado na peça -----------------------------------

test("o que a Meta responde vira frase com saída, não jargão", () => {
  const casos = [
    ["Media ID is not available", /não conseguiu terminar de preparar/i, /de novo/],
    ["The submitted image has an invalid aspect ratio", /proporção/i, /4:5/],
    ["The image format is not supported", /formato/i, /JPEG|JPG/],
    ["Uploaded file is too large, maximum size is 8388608", /pesada demais/i, /8 MB/],
    ["(#10) Application does not have permission", /permiss(ã|a)o/i, /Integra(ç|c)ões/],
    ["(#4) Application request limit reached", /limite/i, /50 posts/],
    ["Error validating access token: Session has expired", /venceu|retirado/i, /Integra(ç|c)ões/],
  ];
  for (const [bruto, oProblema, aSaida] of casos) {
    const r = recadoDaMeta(bruto, { carrossel: true });
    assert.match(r, oProblema, `o problema, em ${bruto}`);
    assert.match(r, aSaida, `e a saída, em ${bruto}`);
    assert.notEqual(r, bruto);
  }
});

test("o que não se reconhece volta INTEIRO — nunca engolido", () => {
  const estranho = "Some brand new Meta error nobody has seen yet";
  assert.equal(recadoDaMeta(estranho), estranho);
});

test("a falha fica gravada na peça, em português", async () => {
  const t = carrossel("Carrossel que falha");
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => (/IG99\/media\?/.test(String(url)) && /media_type=CAROUSEL/.test(decodeURIComponent(String(url))))
    ? { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: "The submitted image has an invalid aspect ratio" } }) }
    : { ok: true, status: 200, text: async () => JSON.stringify({ id: "c1", status_code: "FINISHED" }) };
  let msg = "";
  try { await publishTask(t, org, "exemplo.onrender.com"); }
  catch (e) { msg = e.message; } finally { globalThis.fetch = original; }

  assert.match(msg, /proporção/i, "o erro que sobe já vem traduzido");
  assert.ok(!/aspect ratio/i.test(msg), "e não em inglês");
});

// --- a tela ------------------------------------------------------------------------

const ler = (p) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), p), "utf8");

test("a Distribuição pede E mostra o motivo da última falha", () => {
  const rota = ler("../src/routes/distribution.js");
  assert.equal(rota.split("t.publish_error").length - 1, 6, "as seis listas (inclui 'Ajustar'), senão uma delas esconde");
  const tela = ler("../../client/src/pages/Distribution.jsx");
  assert.match(tela, /item\.publish_error && \(/);
  assert.match(tela, /A última tentativa falhou/);
});

test("falhar recarrega a peça — o motivo não some com o aviso", () => {
  const tela = ler("../../client/src/pages/Distribution.jsx");
  const bloco = tela.slice(tela.indexOf("async function publicarAgora"), tela.indexOf("async function marcarPostado"));
  const catchDoPublicar = bloco.slice(bloco.indexOf("} catch (err) {"));
  assert.match(catchDoPublicar, /onChanged\?\.\(\)/, "recarrega no catch, não só no sucesso");
});
