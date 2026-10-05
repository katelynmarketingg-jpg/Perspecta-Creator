// PUBLICAR CARROSSEL — o buraco que ninguém via.
//
// Ela perguntou se as integrações estão funcionando. Auditando o caminho de
// publicação, a palavra "carrossel" não aparecia UMA vez: a peça de 5 slides ia
// ao ar como UMA imagem, e o sistema anunciava "publicado" — porque, do ponto
// de vista dele, tinha publicado mesmo. Quem monta carrossel toda semana só
// descobriria olhando o perfil depois.
//
// Junto vinham dois irmãos menores: a CAPA escolhida era ignorada, e o "primeiro
// anexo" saía de um LIMIT 1 sem ORDER BY — ou seja, não queria dizer nada.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-carrossel-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { midiasDaPeca } = await import("../src/routes/integrations.js");
const { publishCarouselToInstagram, MAX_SLIDES } = await import("../src/meta.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Carrossel',0)").run().lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Von Saltiel','active',?)").run(org).lastInsertRowid;

const arquivo = (nome, mime = "image/png") => db.prepare(
  `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
   VALUES (?,?,?,10,'x','editados',?)`).run(cli, nome, mime, org).lastInsertRowid;

const peca = ({ media_ids = null, cover_file_id = null, anexos = [] }) => {
  const id = db.prepare(
    "INSERT INTO tasks (title,client_id,content_type,media_ids,cover_file_id,org_id) VALUES ('Peça',?,?,?,?,?)"
  ).run(cli, media_ids ? "carrossel" : "post", media_ids ? JSON.stringify(media_ids) : null, cover_file_id, org).lastInsertRowid;
  const ins = db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)");
  anexos.forEach((f) => ins.run(id, f));
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
};

// --- quais mídias vão ao ar, e em que ordem ------------------------------------

test("carrossel vai com TODAS as slides, na ordem montada", () => {
  const slides = [arquivo("s1.png"), arquivo("s2.png"), arquivo("s3.png"), arquivo("s4.png"), arquivo("s5.png")];
  const t = peca({ media_ids: slides, cover_file_id: slides[0], anexos: [slides[0]] });
  const m = midiasDaPeca(t);
  assert.equal(m.length, 5, "cinco slides, não uma imagem só");
  assert.deepEqual(m.map((x) => x.id), slides, "na ordem exata em que ela montou");
});

test("ordem fora de sequência é respeitada — quem manda é a lista, não o id", () => {
  const a = arquivo("a.png"), b = arquivo("b.png"), c = arquivo("c.png");
  const t = peca({ media_ids: [c, a, b] });
  assert.deepEqual(midiasDaPeca(t).map((x) => x.id), [c, a, b]);
});

test("peça simples usa a CAPA escolhida, não um anexo qualquer", () => {
  const velho = arquivo("antigo.png"), capa = arquivo("capa.png");
  const t = peca({ cover_file_id: capa, anexos: [velho] });
  assert.deepEqual(midiasDaPeca(t).map((x) => x.id), [capa]);
});

test("sem capa, cai no anexo mais antigo — uma ordem de verdade", () => {
  const primeiro = arquivo("1.png"), segundo = arquivo("2.png");
  const t = peca({ anexos: [primeiro, segundo] });
  assert.deepEqual(midiasDaPeca(t).map((x) => x.id), [primeiro]);
});

test("slide apagada da Galeria não quebra a publicação", () => {
  const a = arquivo("a.png"), b = arquivo("b.png");
  const t = peca({ media_ids: [a, 99999, b] });
  assert.deepEqual(midiasDaPeca(t).map((x) => x.id), [a, b], "o que sumiu é pulado");
});

test("peça sem arte nenhuma devolve vazio (quem chama recusa)", () => {
  assert.deepEqual(midiasDaPeca(peca({})), []);
});

test("vídeo é reconhecido pelo tipo do arquivo", () => {
  const v = arquivo("reel.mp4", "video/mp4");
  const t = peca({ cover_file_id: v });
  assert.equal(midiasDaPeca(t)[0].mime, "video/mp4");
});

// --- o protocolo do carrossel na Meta -------------------------------------------
//
// Daqui não dá para falar com a Meta de verdade (o ambiente bloqueia o
// graph.facebook.com). Então trocamos o `fetch` e conferimos a CONVERSA: é o
// passo a passo que a Meta exige, e era ele que não existia.

function fingeAMeta({ respostas = {} } = {}) {
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = new URL(url);
    chamadas.push({
      caminho: u.pathname,
      metodo: options?.method || "GET",
      params: Object.fromEntries(u.searchParams),
    });
    const corpo = respostas[chamadas.length - 1] ?? { id: `c${chamadas.length}` };
    return { ok: true, status: 200, text: async () => JSON.stringify(corpo) };
  };
  return { chamadas, desfaz: () => { globalThis.fetch = original; } };
}

const conn = { ig_user_id: "IG123", access_token: "tok" };
const itens = (n, video = false) =>
  Array.from({ length: n }, (_, i) => ({ url: `https://x/${i}`, isVideo: video }));

test("o carrossel segue os três passos que a Meta exige", async () => {
  const meta = fingeAMeta();
  try {
    const id = await publishCarouselToInstagram({ conn, itens: itens(3), caption: "Olá" });

    // 3 filhos + 1 pai + 1 publicar
    assert.equal(meta.chamadas.length, 5);

    const filhos = meta.chamadas.slice(0, 3);
    for (const f of filhos) {
      assert.equal(f.metodo, "POST");
      assert.match(f.caminho, /\/IG123\/media$/);
      assert.equal(f.params.is_carousel_item, "true", "slide entra marcada como item de carrossel");
      assert.ok(!f.params.caption, "a legenda vai só no pai, nunca repetida nas slides");
    }

    const pai = meta.chamadas[3];
    assert.equal(pai.params.media_type, "CAROUSEL");
    assert.equal(pai.params.children, "c1,c2,c3", "os filhos entram na ordem");
    assert.equal(pai.params.caption, "Olá");

    const publicar = meta.chamadas[4];
    assert.match(publicar.caminho, /media_publish$/);
    assert.equal(publicar.params.creation_id, "c4");
    assert.equal(id, "c5");
  } finally { meta.desfaz(); }
});

test("slide de vídeo entra como VIDEO e espera processar", async () => {
  // A 2ª chamada é a consulta de status do container de vídeo.
  const meta = fingeAMeta({ respostas: { 2: { status_code: "FINISHED" }, 3: { status_code: "FINISHED" } } });
  try {
    await publishCarouselToInstagram({ conn, itens: itens(2, true), caption: "" });
    assert.equal(meta.chamadas[0].params.media_type, "VIDEO");
    assert.ok(meta.chamadas.some((c) => c.params.fields === "status_code"),
      "esperou o vídeo terminar antes de montar o pai");
  } finally { meta.desfaz(); }
});

test("menos de 2 slides não é carrossel", async () => {
  await assert.rejects(() => publishCarouselToInstagram({ conn, itens: itens(1), caption: "" }),
    /pelo menos 2 slides/);
});

test("acima do teto da Meta, o recado diz o número — não deixa a Meta recusar", async () => {
  await assert.rejects(
    () => publishCarouselToInstagram({ conn, itens: itens(MAX_SLIDES + 1), caption: "" }),
    new RegExp(`no máximo ${MAX_SLIDES} slides`));
});

test("sem Instagram profissional, recusa antes de falar com a Meta", async () => {
  const meta = fingeAMeta();
  try {
    await assert.rejects(
      () => publishCarouselToInstagram({ conn: { access_token: "t" }, itens: itens(3), caption: "" }),
      /Instagram profissional/);
    assert.equal(meta.chamadas.length, 0, "nem tentou");
  } finally { meta.desfaz(); }
});

// --- a corrente inteira: peça -> publishTask -> Meta ------------------------------

const { publishTask } = await import("../src/routes/integrations.js");
const { encrypt } = await import("../src/crypto.js");

db.prepare(
  `INSERT INTO integrations (org_id,client_id,provider,page_id,page_name,ig_user_id,ig_username,access_token)
   VALUES (?,?,'meta','P1','Página','IG123','@vs',?)`
).run(org, cli, encrypt("tok"));

test("peça de carrossel sai como carrossel, e a peça fica marcada como publicada", async () => {
  const slides = [arquivo("x1.png"), arquivo("x2.png"), arquivo("x3.png"), arquivo("x4.png")];
  const t = peca({ media_ids: slides, cover_file_id: slides[0], anexos: [slides[0]] });
  db.prepare("UPDATE tasks SET title = 'Carrossel de 4', caption = 'Legenda da peça' WHERE id = ?").run(t.id);
  const tarefa = db.prepare("SELECT * FROM tasks WHERE id = ?").get(t.id);

  const meta = fingeAMeta();
  try {
    const r = await publishTask(tarefa, org, "exemplo.com.br", "https");
    assert.equal(r.slides, 4, "foram as quatro slides, não uma");
    assert.equal(r.destino, "instagram");

    const pai = meta.chamadas.find((c) => c.params.media_type === "CAROUSEL");
    assert.ok(pai, "montou o carrossel");
    assert.equal(pai.params.children.split(",").length, 4);
    assert.equal(pai.params.caption, "Legenda da peça");

    // Cada slide vai por um link assinado e temporário, não pelo arquivo aberto.
    const filhos = meta.chamadas.filter((c) => c.params.is_carousel_item === "true");
    assert.equal(filhos.length, 4);
    for (const f of filhos) assert.match(f.params.image_url, /^https:\/\/[^/]+\/api\/files\/shared\/ey/);
    assert.equal(new Set(filhos.map((f) => f.params.image_url)).size, 4, "cada slide tem o seu link");
  } finally { meta.desfaz(); }

  const depois = db.prepare("SELECT published_at, external_post_id FROM tasks WHERE id = ?").get(t.id);
  assert.ok(depois.published_at, "a peça ficou marcada como publicada");
  assert.ok(depois.external_post_id);

  const aviso = db.prepare("SELECT message FROM notifications WHERE task_id = ? ORDER BY id DESC LIMIT 1").get(t.id);
  assert.match(aviso.message, /carrossel de 4 slides/, "o aviso diz o que foi ao ar");
});

test("peça simples continua indo como imagem única", async () => {
  const capa = arquivo("solo.png");
  const t = peca({ cover_file_id: capa, anexos: [capa] });
  const tarefa = db.prepare("SELECT * FROM tasks WHERE id = ?").get(t.id);
  const meta = fingeAMeta();
  try {
    const r = await publishTask(tarefa, org, "exemplo.com.br", "https");
    assert.equal(r.slides, 1);
    assert.ok(!meta.chamadas.some((c) => c.params.media_type === "CAROUSEL"), "nada de carrossel aqui");
    assert.ok(!meta.chamadas.some((c) => c.params.is_carousel_item), "nem item de carrossel");
  } finally { meta.desfaz(); }
});

test("sem a Meta conectada, recusa com recado claro", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Sem Meta',0)").run().lastInsertRowid;
  const cliSemMeta = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Sozinho','active',?)").run(outra).lastInsertRowid;
  const t = db.prepare("INSERT INTO tasks (title,client_id,org_id) VALUES ('X',?,?)").run(cliSemMeta, outra).lastInsertRowid;
  const tarefa = db.prepare("SELECT * FROM tasks WHERE id = ?").get(t);
  await assert.rejects(() => publishTask(tarefa, outra, "exemplo.com.br", "https"), /não tem a Meta conectada/);
});
