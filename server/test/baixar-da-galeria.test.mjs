// BAIXAR VÍDEO DA GALERIA.
//
// "não estou conseguindo baixar os vídeos da galeria."
//
// A Galeria baixava assim: fetch na rota de baixar, lê a resposta inteira como
// blob, monta um link na memória e clica nele. Funciona com foto pequena no
// disco. Com vídeo no R2, não:
//
//   · a rota de baixar RESPONDE COM UM REDIRECIONAMENTO para a Cloudflare, que
//     é outro domínio. Para o JavaScript LER bytes de outro domínio, o servidor
//     de lá precisa autorizar (CORS) — e o balde não autoriza. Medido no
//     Chromium: "Failed to fetch".
//   · a prévia funcionava porque <video src> NÃO precisa dessa autorização:
//     quem busca é o navegador, não o JavaScript. Daí a cena esquisita de o
//     vídeo tocar na tela e não baixar.
//   · e mesmo no disco, ler 300 MB para dentro da memória do navegador antes de
//     salvar é pedir para engasgar — além de revogar o endereço na linha
//     seguinte ao clique, que é corrida com o navegador.
//
// Agora o endereço vem assinado na listagem e o navegador busca sozinho.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-baixar-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { bilheteParaBaixar, bilheteDeMidia } = await import("../src/midia-url.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const files = await import("../src/routes/files.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Galeria',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@g.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Von Saltiel','active',?)").run(org).lastInsertRowid;

const caminho = join(dir, "reel.mp4");
writeFileSync(caminho, Buffer.alloc(4096, 7));
const fileId = db.prepare(
  `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
   VALUES (?,'reel-da-von.mp4','video/mp4',4096,?,'editados',?)`
).run(cli, caminho, org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/files", files.sharedRouter);
app.use("/api/files", files.default);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

test("o bilhete de baixar entrega o arquivo como ANEXO, com o nome certo", async () => {
  const r = await fetch(B + bilheteParaBaixar(fileId, org));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition") || "", /attachment/);
  assert.match(decodeURIComponent(r.headers.get("content-disposition") || ""), /reel-da-von\.mp4/);
  assert.equal((await r.arrayBuffer()).byteLength, 4096, "o arquivo inteiro");
});

test("o bilhete de VER continua entregando para tocar na tela, não para baixar", async () => {
  const r = await fetch(B + bilheteDeMidia(fileId, org));
  assert.equal(r.status, 200);
  assert.ok(!/attachment/.test(r.headers.get("content-disposition") || ""),
    "se viesse como anexo, o <video> baixaria em vez de tocar");
});

test("bilhete de outra casa não serve", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const r = await fetch(B + bilheteParaBaixar(fileId, outra));
  assert.equal(r.status, 404);
});

test("bilhete inventado não serve", async () => {
  const r = await fetch(`${B}/api/files/shared/nada-disso`);
  assert.equal(r.status, 403);
});

test("a listagem já traz o endereço de baixar de cada arquivo", async () => {
  const r = await fetch(`${B}/api/files?client_id=${cli}`, { headers: H });
  const lista = await r.json();
  const meu = (Array.isArray(lista) ? lista : lista.files || []).find((f) => f.id === fileId);
  assert.ok(meu, "o arquivo está na listagem");
  assert.match(meu.download_url, /^\/api\/files\/shared\//,
    "sem isto a tela não tem como baixar sem passar os bytes pelo JavaScript");
});

// --- o que a tela promete -----------------------------------------------------

const tela = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/pages/Files.jsx"), "utf8");

test("a Galeria não lê mais o arquivo para dentro da memória", () => {
  assert.ok(!/authFetchBlob/.test(tela), "era o caminho que quebrava no R2");
  assert.ok(!/createObjectURL/.test(tela.slice(tela.indexOf("function download"), tela.indexOf("function download") + 900)),
    "e era onde estava a corrida do revoke");
  const f = tela.slice(tela.indexOf("function download"), tela.indexOf("// ---- Seleção"));
  assert.match(f, /file\.download_url/);
  assert.match(f, /document\.body\.appendChild\(a\)/, "o Firefox ignora clique em link solto");
});
