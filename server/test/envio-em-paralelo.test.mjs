// SUBIR 10 FOTOS NÃO PODE SER 10 ESPERAS EM FILA.
//
// Cada arquivo que vai para a Cloudflare é uma ida e volta de rede. O servidor
// fazia uma de cada vez: com 10 fotos, a pessoa via a barra em 100% e ficava
// esperando o resto sem nada acontecer na tela. Num .zip de 200 fotos, pior
// ainda — tudo isso dentro de UM pedido só.
//
// O que estes testes garantem: alguns sobem juntos (mas nunca todos, senão a
// memória estoura) e a ORDEM da lista não muda — num carrossel a ordem é o post.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-par-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { emParalelo } = await import("../src/em-paralelo.js");
const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const AdmZip = (await import("adm-zip")).default;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test("a ordem da lista não muda, mesmo com uns terminando antes dos outros", async () => {
  const entrada = [50, 5, 40, 5, 30, 5, 20, 5];
  const saida = await emParalelo(entrada, 3, async (ms, i) => { await espera(ms); return i; });
  assert.deepEqual(saida, [0, 1, 2, 3, 4, 5, 6, 7], "cada resposta tem que voltar no lugar dela");
});

test("nunca passa do limite — 200 fotos não abrem 200 de uma vez", async () => {
  let agora = 0, pico = 0;
  await emParalelo(Array.from({ length: 30 }), 4, async () => {
    agora++; pico = Math.max(pico, agora);
    await espera(10);
    agora--;
  });
  assert.equal(pico, 4, `abriu ${pico} ao mesmo tempo; o limite pedido era 4`);
});

test("10 esperas de rede param de ser 10 filas", async () => {
  const REDE = 120; // o custo de uma ida à Cloudflare, arredondado para baixo
  const t0 = Date.now();
  await emParalelo(Array.from({ length: 10 }), 4, () => espera(REDE));
  const paralelo = Date.now() - t0;
  const emFila = 10 * REDE;
  assert.ok(
    paralelo < emFila / 2,
    `em paralelo levou ${paralelo}ms; em fila levaria ~${emFila}ms — tinha que cair pela metade, no mínimo`
  );
});

// --- o .zip de verdade, passando pela rota ---------------------------------
const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Zip',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@zip.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Silva','active',?)").run(org).lastInsertRowid;

const { default: filesRoutes } = await import("../src/routes/files.js");
const app = express();
app.use(express.json());
app.use("/api/files", filesRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };

test("o .zip entra inteiro, na ordem da pasta, e o que não é foto fica de fora", async (t) => {
  t.after(() => srv.close());
  const zip = new AdmZip();
  for (let i = 1; i <= 12; i++) zip.addFile(`foto-${String(i).padStart(2, "0")}.png`, Buffer.alloc(2048, i));
  zip.addFile("leiame.txt", Buffer.from("isso aqui não é foto"));
  const caminho = join(dir, "pasta.zip");
  writeFileSync(caminho, zip.toBuffer());

  const fd = new FormData();
  fd.append("client_id", String(cli));
  fd.append("zip", new Blob([zip.toBuffer()]), "pasta.zip");
  const r = await fetch(`${B}/files/upload-zip`, { method: "POST", headers: H, body: fd });
  const j = await r.json();
  assert.equal(r.status, 201);
  assert.equal(j.count, 12, "as 12 fotos tinham que entrar");
  assert.equal(j.ignorados, 1, "o .txt tinha que ficar de fora");

  const nomes = db.prepare(
    "SELECT original_name FROM files WHERE client_id = ? ORDER BY id"
  ).all(cli).map((f) => f.original_name);
  assert.deepEqual(
    nomes,
    Array.from({ length: 12 }, (_, i) => `foto-${String(i + 1).padStart(2, "0")}.png`),
    "a ordem da pasta tem que ser a ordem da galeria"
  );
});
