// O BOTÃO DE BAIXAR NÃO RESPONDIA — e não dava erro nenhum, só ficava rodando.
//
// Todos os arquivos dela moram na Cloudflare (121, 1,3 GB). Nesse caminho o
// servidor assina um endereço e manda o navegador buscar direto lá. Só que a
// função que assina NÃO ESTAVA IMPORTADA no arquivo de rotas: a rota estourava
// "enderecoAssinado is not defined", o erro sumia numa promessa sem dono e a
// resposta nunca saía. Para quem clicou, o download simplesmente não acontecia.
//
// Dois testes, porque são dois problemas diferentes:
//   1. baixar arquivo da nuvem tem que devolver o endereço assinado;
//   2. rota async que estoura tem que RESPONDER (500), nunca ficar pendurada.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-baixa-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";
// Credenciais de mentira: assinar é conta local, não conversa com a Cloudflare.
process.env.R2_ACCOUNT_ID = "conta-de-teste";
process.env.R2_ACCESS_KEY_ID = "chave-de-teste";
process.env.R2_SECRET_ACCESS_KEY = "segredo-de-teste";
process.env.R2_BUCKET = "balde-de-teste";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { pegarPromessasSoltas } = await import("../src/promessa-solta.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;

pegarPromessasSoltas();
const { default: filesRoutes, sharedRouter } = await import("../src/routes/files.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Download',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@baixa.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Silva','active',?)").run(org).lastInsertRowid;

const arquivo = db.prepare(
  `INSERT INTO files (client_id, original_name, mime, size, stored_path, stage, org_id)
   VALUES (?, 'arte final de setembro.png', 'image/png', 5200000, 'r2:uploads/9/arte', 'editados', ?)`
).run(cli, org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/files", sharedRouter);
app.use("/api/files", filesRoutes);
// Rota que estoura de propósito, para provar que estourar vira resposta.
app.get("/api/estoura", async () => { throw new Error("de propósito"); });
app.use((err, req, res, next) => res.status(500).json({ error: "Erro interno do servidor." }));
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

// Espera com prazo: se a rota não responder, o teste FALHA em vez de travar a
// suíte inteira — que é exatamente o que ela fazia no navegador.
function comPrazo(promessa, ms = 8000) {
  return Promise.race([
    promessa,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`ficou rodando: passou de ${ms}ms sem responder`)), ms).unref()),
  ]);
}

test("baixar arquivo que está na nuvem devolve o endereço assinado", async () => {
  const r = await comPrazo(fetch(`${B}/files/${arquivo}/download`, { headers: H, redirect: "manual" }));
  assert.equal(r.status, 302, "tem que redirecionar para a Cloudflare");
  const destino = r.headers.get("location") || "";
  assert.match(destino, /X-Amz-Signature=/, "o endereço precisa ir assinado");
  // Uma volta de decodificação é a que o navegador faz. O que sobra tem que
  // ser o nome de verdade — não "arte%20final%20de%20setembro.png".
  const comoChega = decodeURIComponent(destino);
  assert.match(comoChega, /filename\*=UTF-8''/, "o nome real vai no filename*");
  assert.match(
    decodeURIComponent(comoChega),
    /arte final de setembro\.png/,
    "o arquivo tem que chegar com o nome original, não com %20 no meio"
  );
});

test("nome com acento e espaço chega inteiro, não escapado", async () => {
  const id = db.prepare(
    `INSERT INTO files (client_id, original_name, mime, size, stored_path, stage, org_id)
     VALUES (?, 'coração de setembro.png', 'image/png', 900, 'r2:uploads/9/cor', 'editados', ?)`
  ).run(cli, org).lastInsertRowid;
  const r = await comPrazo(fetch(`${B}/files/${id}/download`, { headers: H, redirect: "manual" }));
  assert.equal(r.status, 302);
  const aberto = decodeURIComponent(decodeURIComponent(r.headers.get("location") || ""));
  assert.match(aberto, /coração de setembro\.png/, "o acento tem que sobreviver");
});

test("o link público da arte também entrega, em vez de ficar pendurado", async () => {
  const bilhete = jwt.sign({ file_id: arquivo, org_id: org }, JWT_SECRET, { expiresIn: "10m" });
  const r = await comPrazo(fetch(`${B}/files/shared/${bilhete}`, { redirect: "manual" }));
  assert.equal(r.status, 302);
  assert.match(r.headers.get("location") || "", /X-Amz-Signature=/);
});

test("rota async que estoura responde 500 — nunca deixa a tela rodando", async () => {
  const r = await comPrazo(fetch(`${B}/estoura`), 5000);
  assert.equal(r.status, 500);
});
