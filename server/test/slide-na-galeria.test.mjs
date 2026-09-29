// SLIDE QUE SOBE PELA DISTRIBUIÇÃO TAMBÉM APARECE NA GALERIA, ARRUMADO.
//
// Pedido dela: "se eu subir slide daqui, direto da distribuição, quero que ele
// suba também na galeria".
//
// Ele até subia — a linha existia na Galeria —, mas SEM PASTA: caía solto na
// raiz do cliente, fora de "Editados", enquanto a etapa gravada no arquivo
// dizia justamente "editados". Ficava misturado com o material bruto, e era
// fácil achar que não tinha subido.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-slide-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const files = (await import("../src/routes/files.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Slide',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@sl.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Karen','active',?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/files", files);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

// Um PNG mínimo de verdade.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64");

async function subir(campos) {
  const fd = new FormData();
  fd.append("files", new Blob([PNG], { type: "image/png" }), "slide.png");
  for (const [k, v] of Object.entries(campos)) if (v != null) fd.append(k, String(v));
  const r = await fetch(`${B}/files/upload`, { method: "POST", headers: H, body: fd });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

const pastaDe = (id) => db.prepare(
  "SELECT (SELECT name FROM folders WHERE id = f.folder_id) AS pasta, f.stage FROM files f WHERE f.id = ?"
).get(id);

test("slide da Distribuição nasce na pasta Editados do cliente", async () => {
  const r = await subir({ client_id: cli, stage: "editados", na_pasta_da_etapa: "1" });
  assert.equal(r.status, 201);
  const info = pastaDe(r.corpo[0].id);
  assert.equal(info.pasta, "Editados", "e não solto na raiz");
  assert.equal(info.stage, "editados");
});

test("a pasta é criada na primeira vez, e reaproveitada depois", async () => {
  const antes = db.prepare("SELECT COUNT(*) n FROM folders WHERE org_id = ? AND client_id = ? AND name = 'Editados'")
    .get(org, cli).n;
  assert.equal(antes, 1, "nasceu uma só no teste anterior");
  await subir({ client_id: cli, stage: "editados", na_pasta_da_etapa: "1" });
  const depois = db.prepare("SELECT COUNT(*) n FROM folders WHERE org_id = ? AND client_id = ? AND name = 'Editados'")
    .get(org, cli).n;
  assert.equal(depois, 1, "não vira uma pasta nova a cada envio");
});

test("cada etapa cai na sua pasta", async () => {
  const r = await subir({ client_id: cli, stage: "aprovacao", na_pasta_da_etapa: "1" });
  assert.equal(pastaDe(r.corpo[0].id).pasta, "Para aprovação");
});

test("a Galeria continua podendo mandar para a RAIZ de propósito", async () => {
  // Sem o pedido explícito, nada muda: é o envio normal da Galeria.
  const r = await subir({ client_id: cli, stage: "originais" });
  assert.equal(pastaDe(r.corpo[0].id).pasta, null, "fica na raiz, como antes");
});

test("pasta escolhida à mão manda sobre a da etapa", async () => {
  const pasta = db.prepare("INSERT INTO folders (name,client_id,org_id) VALUES ('Setembro',?,?)")
    .run(cli, org).lastInsertRowid;
  const r = await subir({ client_id: cli, stage: "editados", folder_id: pasta, na_pasta_da_etapa: "1" });
  assert.equal(pastaDe(r.corpo[0].id).pasta, "Setembro");
});

test("sem cliente não há pasta de cliente — e nada quebra", async () => {
  const r = await subir({ stage: "editados", na_pasta_da_etapa: "1" });
  assert.equal(r.status, 201);
  assert.equal(pastaDe(r.corpo[0].id).pasta, null);
});

test("a tela pede isso ao subir slide pela Distribuição", () => {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const dist = readFileSync(join(aqui, "../../client/src/pages/Distribution.jsx"), "utf8");
  const trecho = dist.slice(dist.indexOf("async function subirArquivo"), dist.indexOf("async function uploadSlide"));
  assert.match(trecho, /fd\.append\("na_pasta_da_etapa", "1"\)/);
  assert.match(trecho, /fd\.append\("stage", "editados"\)/);
});
