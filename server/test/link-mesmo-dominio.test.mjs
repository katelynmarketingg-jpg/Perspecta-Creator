// O ENDEREÇO PELO NOSSO DOMÍNIO — e por que ele ainda precisa existir.
//
// Mudamos a mídia para vir DIRETO da Cloudflare, o que deixou tudo muito mais
// rápido. Mas isso quebrou uma coisa: a tela de escolher a capa do vídeo não
// mostra o vídeo, ela CAPTURA um quadro dele desenhando num canvas — e o
// navegador proíbe capturar de mídia que veio de outro domínio. A captura
// passou a falhar com "Não foi possível capturar o quadro".
//
// Por isso existe /api/files/:id/link: devolve o endereço pelo NOSSO servidor,
// de onde a captura funciona. É mais lento para começar, e é usado só onde a
// captura é o objetivo — um vídeo, numa tela.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-link-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const { default: filesRoutes, sharedRouter } = await import("../src/routes/files.js");

const cabeca = (nome) => {
  const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES (?,0)").run(nome).lastInsertRowid;
  const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES (?,?,?,?,'admin',1,?)")
    .run(nome, nome, `${nome}@l.com`, hashPassword("SenhaBoa#1"), org).lastInsertRowid;
  return { org, H: { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` } };
};
const casa = cabeca("Casa do Link");
const vizinha = cabeca("Vizinha");

const arq = join(dir, "reel.mp4");
writeFileSync(arq, Buffer.alloc(64, 7));
const novo = (org, caminho) => db.prepare(
  `INSERT INTO files (original_name,mime,size,stored_path,stage,org_id)
   VALUES ('reel.mp4','video/mp4',64,?,'editados',?)`
).run(caminho, org).lastInsertRowid;

const meu = novo(casa.org, arq);
const naNuvem = novo(casa.org, "r2:uploads/9/reel");
const alheio = novo(vizinha.org, arq);

const app = express();
app.use(express.json());
app.use("/api/files", sharedRouter);
app.use("/api/files", filesRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/files`;
after(() => srv.close());

test("devolve um endereço do NOSSO domínio, nunca o da nuvem", async () => {
  const r = await fetch(`${B}/${meu}/link`, { headers: casa.H });
  assert.equal(r.status, 200);
  const { url } = await r.json();
  assert.match(url, /^\/api\/files\/shared\//, "tem que ser caminho nosso, para a captura funcionar");
  assert.ok(!url.includes("cloudflarestorage"), "endereço de outro domínio não deixa capturar quadro");
});

test("vale também para arquivo que está na nuvem — é justamente esse o caso", async () => {
  const { url } = await fetch(`${B}/${naNuvem}/link`, { headers: casa.H }).then((x) => x.json());
  assert.match(url, /^\/api\/files\/shared\//);
});

test("o endereço devolvido abre de verdade", async () => {
  const { url } = await fetch(`${B}/${meu}/link`, { headers: casa.H }).then((x) => x.json());
  const r = await fetch(`http://127.0.0.1:${srv.address().port}${url}`);
  assert.equal(r.status, 200);
});

test("arquivo de outra agência não ganha endereço", async () => {
  const r = await fetch(`${B}/${alheio}/link`, { headers: casa.H });
  assert.equal(r.status, 404);
});

test("arquivo que não existe também não", async () => {
  const r = await fetch(`${B}/999999/link`, { headers: casa.H });
  assert.equal(r.status, 404);
});
