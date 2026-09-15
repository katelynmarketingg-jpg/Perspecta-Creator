// O AVISO QUE MENTIA NA TELA DO CLIENTE.
//
// "🆕 Você tem 8 conteúdos para aprovar" era escrito quando a agência mandava a
// peça e nunca mais mexido. O cliente aprovava, a lista caía para 7 e o aviso
// continuava dizendo 8 — dois números diferentes na MESMA tela, e o de cima
// errado, até a agência mandar outra peça.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-aviso-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const portalRoutes = (await import("../src/routes/portal.js")).default;
const distribution = (await import("../src/routes/distribution.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Aviso',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@aviso.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare(
  "INSERT INTO clients (name,status,org_id,portal_username,portal_password_hash) VALUES ('Silva','active',?,'marcelo',?)"
).run(org, hashPassword("segredo123")).lastInsertRowid;

const etapa = (nome, pos, done = 0) => db.prepare(
  "INSERT INTO kanban_stages (name, position, is_done, org_id) VALUES (?,?,?,?)"
).run(nome, pos, done, org).lastInsertRowid;
const distEtapa = etapa("Distribuição", 1);
etapa("Aprovação", 2);
etapa("Programados", 3, 1);

// Peça de verdade: com data marcada e arte anexada — sem isso o sistema
// (corretamente) recusa mandar para aprovação.
const pecas = [];
for (let i = 1; i <= 3; i++) {
  const id = db.prepare(
    `INSERT INTO tasks (title, client_id, stage_id, position, org_id, content_type, scheduled_at)
     VALUES (?,?,?,?,?,'post',?)`
  ).run(`Post ${i}`, cli, distEtapa, i, org, new Date(Date.now() + i * 86400000).toISOString()).lastInsertRowid;
  const arte = db.prepare(
    `INSERT INTO files (client_id, original_name, mime, size, stored_path, stage, org_id)
     VALUES (?,?,'image/png',1000,?,'editados',?)`
  ).run(cli, `arte ${i}.png`, `/tmp/arte-${i}`, org).lastInsertRowid;
  db.prepare("INSERT INTO task_attachments (task_id, file_id) VALUES (?,?)").run(id, arte);
  pecas.push(id);
}

const app = express();
app.use(express.json());
app.use("/api/portal", portalRoutes);
app.use("/api/distribution", distribution);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

const { token: portalToken } = await fetch(`${B}/portal/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "marcelo", password: "segredo123" }),
}).then((r) => r.json());
const P = { authorization: `Bearer ${portalToken}`, "content-type": "application/json" };

const avisoAtual = () => db.prepare(
  "SELECT message FROM notifications WHERE audience='client' AND client_id=? AND is_read=0 AND message LIKE '%aprovar%'"
).get(cli)?.message || null;

test("o aviso acompanha o que o cliente faz, peça por peça", async () => {
  for (const id of pecas) {
    const r = await fetch(`${B}/distribution/${id}/send`, { method: "POST", headers: H });
    assert.equal(r.status, 200);
  }
  assert.match(avisoAtual() || "", /3 conteúdos/, "três mandadas, três no aviso");

  // Ele aprova uma: o aviso tem que cair para 2.
  const ap = await fetch(`${B}/portal/approvals/${pecas[0]}/approve`, { method: "POST", headers: P });
  assert.equal(ap.status, 200);
  assert.match(avisoAtual() || "", /2 conteúdos/, `depois de aprovar uma, o aviso diz: ${avisoAtual()}`);

  // Pede ajuste noutra: cai para 1 — e no singular.
  const aj = await fetch(`${B}/portal/approvals/${pecas[1]}/request-changes`, {
    method: "POST", headers: P, body: JSON.stringify({ client_note: "Trocar o fundo." }),
  });
  assert.equal(aj.status, 200);
  assert.match(avisoAtual() || "", /1 conteúdo para aprovar/, `deu: ${avisoAtual()}`);

  // Aprovando a última, o aviso some — não fica "0 conteúdos".
  await fetch(`${B}/portal/approvals/${pecas[2]}/approve`, { method: "POST", headers: P });
  assert.equal(avisoAtual(), null, "sem nada aguardando, o aviso sai da tela");
});
