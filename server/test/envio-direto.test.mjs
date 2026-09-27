// ENVIO DIRETO PARA A NUVEM.
//
// Pedido dela: "ainda acho lento, tem outra maneira?" — com arquivos pesados,
// vídeo editado, subindo do celular.
//
// O motivo era o caminho: todo arquivo fazia a viagem DUAS vezes — celular →
// nosso servidor (Oregon, costa oeste dos EUA) → Cloudflare —, e entre as duas
// o servidor ainda gravava o arquivo inteiro no disco dele. Agora o navegador
// entrega direto na nuvem, que tem ponto de entrada em São Paulo.
//
// O arquivo NÃO é tocado: mesmos bytes, caminho mais curto.
//
// O que este arquivo trava:
//   1. sem nuvem configurada, a tela volta sozinha pelo caminho antigo;
//   2. a chave da entrega é do servidor, e é conferida na volta — senão
//      bastaria mandar a chave de outra casa para pendurar o arquivo dela na
//      sua galeria;
//   3. o tamanho gravado vem da NUVEM, não do navegador;
//   4. o caminho antigo continua inteiro.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-direto-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const files = (await import("../src/routes/files.js")).default;
const { chaveEhDoEscritorio, storageConfigured } = await import("../src/storage.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Direta',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@d.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Karen','active',?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json({ limit: "8mb" }));
app.use("/api/files", files);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

const pedir = async (caminho, corpo) => {
  const r = await fetch(`${B}${caminho}`, { method: "POST", headers: H, body: JSON.stringify(corpo) });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

// --- a conferência da chave (é o que separa uma casa da outra) ---------------

test("a chave da entrega tem de ser da pasta do próprio escritório", () => {
  assert.ok(chaveEhDoEscritorio("uploads/7/1234-abcd", 7));
  assert.ok(!chaveEhDoEscritorio("uploads/8/1234-abcd", 7), "pasta de outra casa");
  assert.ok(!chaveEhDoEscritorio("uploads/70/1234-abcd", 7), "7 não é prefixo de 70");
  assert.ok(!chaveEhDoEscritorio("backups/agency.db", 7), "nem sonhar com a pasta dos backups");
});

test("nem subir na árvore, nem inventar subpasta", () => {
  assert.ok(!chaveEhDoEscritorio("uploads/7/../8/arte.png", 7));
  assert.ok(!chaveEhDoEscritorio("uploads/7/sub/arte.png", 7));
  assert.ok(!chaveEhDoEscritorio("uploads/7/", 7), "sem nome nenhum");
  assert.ok(!chaveEhDoEscritorio("uploads/7/x", null), "sem escritório, nada vale");
});

// --- sem nuvem configurada, o caminho antigo continua sendo o caminho --------

test("sem nuvem, autorizar responde que não dá — e a tela volta pelo caminho antigo", async () => {
  assert.equal(storageConfigured(), false, "o teste roda sem R2, como o disco local");
  const r = await pedir("/files/upload-direto/autorizar", {
    arquivos: [{ nome: "reel.mp4", mime: "video/mp4", tamanho: 900 * 1024 * 1024 }],
  });
  assert.equal(r.status, 200, "não é erro: é um 'por aqui não'");
  assert.equal(r.corpo.direto, false);
  assert.ok(r.corpo.motivo, "e diz por quê");
});

test("sem nuvem, registrar recusa — ninguém grava linha sem arquivo", async () => {
  const r = await pedir("/files/upload-direto/registrar", {
    client_id: cli, arquivos: [{ key: `uploads/${org}/inventada`, nome: "x.png" }],
  });
  assert.equal(r.status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM files WHERE org_id = ?").get(org).n, 0);
});

test("autorizar sem nada para enviar é recusado", async () => {
  const r = await pedir("/files/upload-direto/autorizar", { arquivos: [] });
  assert.equal(r.status, 400);
});

// --- o teto de tamanho é o mesmo dos dois lados -----------------------------

test("acima de 2 GB é recusado antes de qualquer viagem", async () => {
  const r = await pedir("/files/upload-direto/autorizar", {
    arquivos: [{ nome: "bruto.mov", mime: "video/quicktime", tamanho: 3 * 1024 * 1024 * 1024 }],
  });
  assert.equal(r.status, 413);
  assert.match(r.corpo.error, /2 GB/);
});

// --- o que a rota promete no código ----------------------------------------

const aqui = dirname(fileURLToPath(import.meta.url));
const rota = readFileSync(join(aqui, "../src/routes/files.js"), "utf8");
const tela = readFileSync(join(aqui, "../../client/src/upload/envio-direto.js"), "utf8");
const contexto = readFileSync(join(aqui, "../../client/src/upload/UploadContext.jsx"), "utf8");

test("a chave é do SERVIDOR — o navegador não escolhe onde grava", () => {
  const trecho = rota.slice(rota.indexOf('router.post("/upload-direto/autorizar"'),
                            rota.indexOf('router.post("/upload-direto/registrar"'));
  assert.match(trecho, /const key = `uploads\/\$\{req\.orgId\}\/\$\{Date\.now\(\)\}-\$\{randomUUID\(\)\}`/);
});

test("o tamanho gravado vem da NUVEM, não do navegador", () => {
  const trecho = rota.slice(rota.indexOf('router.post("/upload-direto/registrar"'), rota.indexOf('router.post("/upload", upload.array'));
  assert.match(trecho, /const naNuvem = await conferirObjeto\(key\)/);
  assert.match(trecho, /const tamanho = naNuvem\.tamanho;/);
  assert.ok(!/size: *Number\(a\?\.tamanho\)/.test(trecho), "nada de confiar no número que veio de fora");
  assert.match(trecho, /chaveEhDoEscritorio\(key, req\.orgId\)/);
});

test("o registro guarda o caminho da nuvem, como o envio comum", () => {
  const trecho = rota.slice(rota.indexOf('router.post("/upload-direto/registrar"'), rota.indexOf('router.post("/upload", upload.array'));
  assert.match(trecho, /const storedPath = `r2:\$\{key\}`/);
  assert.match(trecho, /novo\.repetida = repetida/, "o aviso de arquivo repetido continua");
});

test("o caminho antigo continua inteiro", () => {
  assert.match(rota, /router\.post\("\/upload", upload\.array\("files", 20\)/);
  assert.match(rota, /if \(!storageConfigured\(\)\) return f\.path; \/\/ sem R2: fica no disco/);
});

// --- a tela ----------------------------------------------------------------

test("a tela tenta o caminho curto primeiro e cai no antigo se não der", () => {
  assert.match(contexto, /const direto = await enviarDireto\(/);
  assert.match(contexto, /if \(direto\) return direto;/);
  const trecho = contexto.slice(contexto.indexOf("PRIMEIRO, O CAMINHO CURTO"), contexto.indexOf("const thumb = await miniaturaBarata"));
  assert.match(trecho, /catch/, "qualquer tropeço volta para o caminho de sempre");
  assert.match(trecho, /grande demais/, "menos a recusa por tamanho, que o outro caminho também faria");
});

test("a entrega manda o mesmo tipo que foi assinado", () => {
  // A assinatura cobre o cabeçalho Content-Type: mandar outro faz a Cloudflare
  // recusar a entrega, e o envio inteiro falharia sem motivo aparente.
  assert.match(tela, /xhr\.setRequestHeader\("Content-Type", tipo\)/);
  assert.match(tela, /const tipo = file\?\.type \|\| TIPO_PADRAO/);
  assert.match(tela, /mime: tipo/);
});

test("o arquivo não é tocado no caminho — nada de recompressão", () => {
  assert.match(tela, /xhr\.send\(file\)/, "vai o arquivo, como está");
  assert.ok(!/canvas|toDataURL|toBlob|compress/i.test(tela), "nada que mexa nos bytes");
});

test("vídeo grande tem prazo de sobra", () => {
  assert.match(tela, /xhr\.timeout = 2 \* 60 \* 60 \* 1000/);
});
