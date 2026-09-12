// CARROSSEL QUE SÓ TEM CAPA, SEM ANEXO NA PEÇA.
//
// É um estado real e comum: carrossel montado antes de a peça ganhar anexo, ou
// que teve o anexo trocado. A agência via o quadro em branco na Distribuição
// (corrigido: a tela ignorava o cover_url e só olhava o media_url).
//
// Aqui a pergunta é o outro lado: o CLIENTE consegue ver essa peça para
// aprovar? Se a arte não chega nele, ele recebe "aprove isto" sem ter o que
// olhar — e é pior que o quadro em branco da agência.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-carr-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword } = await import("../src/auth.js");
const express = (await import("express")).default;
const portalRoutes = (await import("../src/routes/portal.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Carrossel',0)").run().lastInsertRowid;
const cli = db.prepare(
  "INSERT INTO clients (name,status,org_id,portal_username,portal_password_hash) VALUES ('Marcelo','active',?,'marcelo',?)"
).run(org, hashPassword("segredo123")).lastInsertRowid;
db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Distribuição',4,0,?)").run(org);
// Peça ENVIADA muda de etapa: vai para "Aprovação". É de lá que a fila do
// cliente é montada.
db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Aprovação',5,0,?)").run(org);
const etapa = db.prepare("SELECT id FROM kanban_stages WHERE org_id=? AND name='Aprovação'").get(org).id;

const arte = join(dir, "tira.png");
writeFileSync(arte, Buffer.alloc(256, 5));
const capa = db.prepare(
  `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
   VALUES (?,'tira.png','image/png',256,?,'aprovacao',?)`
).run(cli, arte, org).lastInsertRowid;

// A peça problemática: carrossel com CAPA definida e NENHUM anexo.
const semAnexo = db.prepare(
  `INSERT INTO tasks (title,content_type,client_id,org_id,approval_status,stage_id,scheduled_at,cover_file_id)
   VALUES ('Carrossel só com capa','carrossel',?,?,'sent',?,'2026-10-15 10:00',?)`
).run(cli, org, etapa, capa).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/portal", portalRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/portal`;
after(() => srv.close());

const { token } = await fetch(`${B}/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "marcelo", password: "segredo123" }),
}).then((r) => r.json());
const P = { authorization: `Bearer ${token}` };

test("a peça aparece na fila de aprovação do cliente", async () => {
  const fila = await fetch(`${B}/approvals`, { headers: P }).then((r) => r.json());
  assert.ok(fila.some((x) => x.id === semAnexo), "carrossel sumiu da fila dele");
});

test("o cliente RECEBE a arte para aprovar, mesmo sem anexo na peça", async () => {
  const anexos = await fetch(`${B}/tasks/${semAnexo}/attachments`, { headers: P }).then((r) => r.json());
  assert.ok(Array.isArray(anexos) && anexos.length > 0,
    "sem arte, ele recebe 'aprove isto' sem ter o que olhar");
  assert.equal(anexos[0].id, capa, "a arte tem que ser a capa escolhida");
  assert.ok(anexos[0].media_url, "e com o endereço direto, para desenhar sem baixar tudo");
});

test("no perfil do cliente a peça aparece com a arte", async () => {
  const feed = await fetch(`${B}/feed`, { headers: P }).then((r) => r.json());
  const p = feed.find((x) => x.id === semAnexo);
  assert.ok(p, "a peça tem que estar no perfil");
  assert.equal(p.file_id, capa);
  assert.ok(p.media_url, "e com endereço para desenhar");
});

test("peça de outro cliente continua fora do alcance dele", async () => {
  const outroOrg = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Outra',0)").run().lastInsertRowid;
  const outroCli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Alheio','active',?)").run(outroOrg).lastInsertRowid;
  const alheia = db.prepare(
    `INSERT INTO tasks (title,content_type,client_id,org_id,approval_status,stage_id) VALUES ('Alheia','post',?,?,'sent',?)`
  ).run(outroCli, outroOrg, etapa).lastInsertRowid;
  const r = await fetch(`${B}/tasks/${alheia}/attachments`, { headers: P });
  assert.equal(r.status, 404);
});
