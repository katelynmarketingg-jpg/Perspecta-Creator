// O ENDEREÇO QUE VAI PARA O <img>: direto na Cloudflare, ou pelo nosso servidor?
//
// Havia um só caminho: /api/files/shared/<bilhete>. O navegador pedia ao NOSSO
// servidor, que conferia o bilhete, ia ao banco, assinava um endereço da
// Cloudflare e devolvia um redirecionamento — e só então o navegador buscava o
// arquivo. Numa tela com 20 fotos são 20 idas ao nosso servidor antes de a
// primeira começar a chegar; com o servidor ocupado, é a diferença entre
// "abriu" e "carregando há minutos".
//
// Arquivo no R2 agora vai com o endereço da Cloudflare já na listagem. Arquivo
// em disco continua pelo bilhete, porque só nós sabemos servi-lo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-end-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";
// Credenciais de mentira: assinar é conta local, não toca na Cloudflare.
process.env.R2_ACCOUNT_ID = "conta-de-teste";
process.env.R2_ACCESS_KEY_ID = "chave-de-teste";
process.env.R2_SECRET_ACCESS_KEY = "segredo-de-teste";
process.env.R2_BUCKET = "balde-de-teste";

const { db } = await import("../src/db.js");
const { enderecoDeMidia, enderecosDeMidia, bilheteDeMidia } = await import("../src/midia-url.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Endereço',0)").run().lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo','active',?)").run(org).lastInsertRowid;
const emDisco = join(dir, "no-disco.png");
writeFileSync(emDisco, Buffer.alloc(32, 1));

const guarda = (nome, caminho, mime = "image/png") => db.prepare(
  `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
   VALUES (?,?,?,32,?,'editados',?)`
).run(cli, nome, mime, caminho, org).lastInsertRowid;

const naNuvem = guarda("na-nuvem.png", "r2:uploads/9/abc");
const noDisco = guarda("no-disco.png", emDisco);
const videoNaNuvem = guarda("reel.mov", "r2:uploads/9/reel", "video/quicktime");

const linha = (id) => db.prepare("SELECT id, mime, original_name, stored_path FROM files WHERE id = ?").get(id);

test("arquivo no R2 vai DIRETO para a Cloudflare, sem passar pelo nosso servidor", async () => {
  const url = await enderecoDeMidia(linha(naNuvem), org);
  // O R2 põe o balde no domínio: balde.conta.r2.cloudflarestorage.com
  assert.match(url, /^https:\/\/[\w.-]+\.r2\.cloudflarestorage\.com\//,
    "o endereço tem que apontar para a Cloudflare");
  assert.ok(!url.includes("/api/files/"), "não pode passar pelo nosso servidor");
  assert.match(url, /X-Amz-Signature=/, "e tem que estar assinado");
});

test("arquivo no disco continua pelo nosso servidor — só nós sabemos servi-lo", async () => {
  const url = await enderecoDeMidia(linha(noDisco), org);
  assert.match(url, /^\/api\/files\/shared\//);
});

test("o .mov de iPhone vai com o rótulo que o navegador toca", async () => {
  const url = await enderecoDeMidia(linha(videoNaNuvem), org);
  assert.match(decodeURIComponent(url), /response-content-type=video\/mp4/i,
    "o Chrome recusa video/quicktime; o rótulo é trocado na resposta do R2");
});

test("o endereço é o MESMO dentro da mesma hora — senão o cache do navegador é jogado fora", async () => {
  const a = await enderecoDeMidia(linha(naNuvem), org);
  const b = await enderecoDeMidia(linha(naNuvem), org);
  assert.equal(a, b, "endereço diferente a cada pedido faz o navegador baixar tudo de novo");
});

test("resolve uma lista inteira de uma vez, e ignora id de outra agência", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const alheio = db.prepare(
    `INSERT INTO files (original_name,mime,size,stored_path,stage,org_id)
     VALUES ('alheio.png','image/png',32,'r2:uploads/1/x','editados',?)`
  ).run(outra).lastInsertRowid;

  const mapa = await enderecosDeMidia(db, [naNuvem, noDisco, alheio, 999999], org);
  assert.equal(mapa.size, 2, "só os arquivos desta agência ganham endereço");
  assert.ok(mapa.get(naNuvem).includes("r2.cloudflarestorage.com"));
  assert.ok(mapa.get(noDisco).startsWith("/api/files/shared/"));
  assert.equal(mapa.get(alheio), undefined, "arquivo de outra agência não pode ganhar endereço");
});

test("o bilhete pelo nosso servidor continua existindo para quem precisa", () => {
  const b = bilheteDeMidia(naNuvem, org);
  assert.match(b, /^\/api\/files\/shared\/[\w-]+\.[\w-]+\.[\w-]+$/);
});
