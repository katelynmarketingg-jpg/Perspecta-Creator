// O CANVAS SUJO: por que a captura do quadro do vídeo falhava na nuvem.
//
// Quando o arquivo está no R2, o endereço da mídia termina num redirecionamento
// para a Cloudflare. Medido no Chromium: um <img>/<video> que SEGUE um
// redirecionamento para outro domínio suja o canvas — e ler de volta o que foi
// desenhado vira SecurityError. Não adianta o endereço COMEÇAR no nosso
// domínio: é o destino que conta.
//
// Por isso existe um bilhete marcado "para capturar": com ele os bytes passam
// por dentro do nosso servidor, do começo ao fim, sem redirecionar. É o que faz
// a capa do vídeo e a prévia de arte antiga funcionarem na instância dela.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-capt-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";
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

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Captura',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@capt.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Silva','active',?)").run(org).lastInsertRowid;

const naNuvem = db.prepare(
  `INSERT INTO files (client_id, original_name, mime, size, stored_path, stage, org_id)
   VALUES (?, 'reel.mp4', 'video/mp4', 9000000, 'r2:uploads/9/reel', 'editados', ?)`
).run(cli, org).lastInsertRowid;

const caminho = join(dir, "no-disco");
writeFileSync(caminho, Buffer.alloc(64, 3));
const noDisco = db.prepare(
  `INSERT INTO files (client_id, original_name, mime, size, stored_path, stage, org_id)
   VALUES (?, 'local.png', 'image/png', 64, ?, 'editados', ?)`
).run(cli, caminho, org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/files", sharedRouter);
app.use("/api/files", filesRoutes);
app.use((err, req, res, next) => res.status(500).json({ error: "Erro interno do servidor." }));
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const raiz = `http://127.0.0.1:${srv.address().port}`;
const B = `${raiz}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

test("o endereço de sempre manda o navegador direto para a Cloudflare", async () => {
  const bilhete = jwt.sign({ file_id: naNuvem, org_id: org, inline: true }, JWT_SECRET, { expiresIn: "1h" });
  const r = await fetch(`${B}/files/shared/${bilhete}`, { redirect: "manual" });
  assert.equal(r.status, 302, "é o caminho rápido: quem serve é a Cloudflare");
});

test("o endereço PARA CAPTURAR nunca redireciona — senão o canvas fica sujo", async () => {
  const { url } = await fetch(`${B}/files/${naNuvem}/link`, { headers: H }).then((x) => x.json());
  assert.match(url, /^\/api\/files\/shared\//);

  const r = await fetch(`${raiz}${url}`, { redirect: "manual" });
  assert.notEqual(r.status, 302, "redirecionar para outro domínio é exatamente o que quebra a captura");
  // Sem R2 de verdade atrás, a busca dos bytes falha — mas o que importa aqui é
  // que ela foi TENTADA por dentro do servidor, em vez de virar redirecionamento.
  assert.ok([200, 206, 404].includes(r.status), `respondeu ${r.status}`);
});

test("arquivo em disco funciona pelos dois caminhos", async () => {
  const { url } = await fetch(`${B}/files/${noDisco}/link`, { headers: H }).then((x) => x.json());
  const r = await fetch(`${raiz}${url}`, { redirect: "manual" });
  assert.equal(r.status, 200);
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.equal(bytes.length, 64);
});

test("o link não sai para arquivo de outra agência", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Vizinha da Captura',0)").run().lastInsertRowid;
  const alheio = db.prepare(
    `INSERT INTO files (client_id, original_name, mime, size, stored_path, stage, org_id)
     VALUES (NULL, 'deles.png', 'image/png', 10, 'r2:x', 'editados', ?)`
  ).run(outra).lastInsertRowid;
  const r = await fetch(`${B}/files/${alheio}/link`, { headers: H });
  assert.equal(r.status, 404);
});
