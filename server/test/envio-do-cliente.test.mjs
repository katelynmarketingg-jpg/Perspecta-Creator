// O CLIENTE MANDANDO MATERIAL PELA ÁREA DELE.
//
// Era um pedido só com todos os arquivos: uma bolinha girando, nenhum progresso
// e, se um arquivo desse problema, todos falhavam juntos. E quando o sistema
// recusava (arquivo grande demais, arquivos demais, tipo não aceito), a resposta
// era "Erro interno do servidor" — que não diz nada e ainda parece defeito.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-envcli-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword } = await import("../src/auth.js");
const express = (await import("express")).default;
const portalRoutes = (await import("../src/routes/portal.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Envio',0)").run().lastInsertRowid;
db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@env.com',?,'admin',1,?)")
  .run(hashPassword("x"), org);
const cli = db.prepare(
  "INSERT INTO clients (name,status,org_id,portal_username,portal_password_hash) VALUES ('Silva','active',?,'marcelo',?)"
).run(org, hashPassword("segredo123")).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/portal", portalRoutes);
app.use((err, req, res, next) => res.status(500).json({ error: "Erro interno do servidor." }));
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/portal`;
after(() => srv.close());

const { token } = await fetch(`${B}/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "marcelo", password: "segredo123" }),
}).then((r) => r.json());
const H = { authorization: `Bearer ${token}` };

function corpo(arquivos) {
  const fd = new FormData();
  for (const [nome, bytes, tipo] of arquivos) {
    fd.append("files", new Blob([Buffer.alloc(bytes, 7)], { type: tipo }), nome);
  }
  return fd;
}

test("um arquivo por vez é o caminho normal — e cai na pasta dele", async () => {
  const r = await fetch(`${B}/upload`, { method: "POST", headers: H, body: corpo([["foto.jpg", 2048, "image/jpeg"]]) });
  assert.equal(r.status, 201);
  const [criado] = await r.json();
  assert.equal(criado.original_name, "foto.jpg");
  assert.equal(criado.stage, "originais", "material do cliente entra como Originais");

  const pasta = db.prepare("SELECT name FROM folders WHERE id = (SELECT folder_id FROM files WHERE id = ?)").get(criado.id);
  assert.match(pasta.name, /cliente/i, `caiu na pasta "${pasta.name}"`);
});

test("o que já subiu fica salvo mesmo que o próximo dê errado", async () => {
  const antes = db.prepare("SELECT COUNT(*) n FROM files WHERE client_id = ?").get(cli).n;
  await fetch(`${B}/upload`, { method: "POST", headers: H, body: corpo([["ok.jpg", 1024, "image/jpeg"]]) });
  // um tipo que não é aceito: falha SÓ ele
  const ruim = await fetch(`${B}/upload`, { method: "POST", headers: H, body: corpo([["planilha.xlsx", 1024, "application/vnd.ms-excel"]]) });
  assert.equal(ruim.status, 400);
  const depois = db.prepare("SELECT COUNT(*) n FROM files WHERE client_id = ?").get(cli).n;
  assert.equal(depois, antes + 1, "o arquivo bom entrou; o recusado não derrubou ele junto");
});

test("tipo não aceito explica o que é aceito", async () => {
  const r = await fetch(`${B}/upload`, { method: "POST", headers: H, body: corpo([["arquivo.zip", 512, "application/zip"]]) });
  assert.equal(r.status, 400);
  const { error } = await r.json();
  assert.match(error, /imagem|foto|vídeo|PDF/i, `mensagem foi: "${error}"`);
  assert.doesNotMatch(error, /Erro interno/i, "recusar não é quebrar");
});

test("arquivos demais de uma vez diz QUANTOS dá para mandar", async () => {
  const doze = Array.from({ length: 12 }, (_, i) => [`f${i}.jpg`, 512, "image/jpeg"]);
  const r = await fetch(`${B}/upload`, { method: "POST", headers: H, body: corpo(doze) });
  assert.equal(r.status, 400, "12 passa do limite de 10");
  const { error } = await r.json();
  assert.match(error, /10 arquivos por vez/, `mensagem foi: "${error}"`);
  assert.doesNotMatch(error, /Erro interno/i);
});

test("a equipe é avisada do que chegou", async () => {
  const antes = db.prepare("SELECT COUNT(*) n FROM notifications WHERE audience='agency' AND org_id=?").get(org).n;
  await fetch(`${B}/upload`, { method: "POST", headers: H, body: corpo([["novo.jpg", 1024, "image/jpeg"]]) });
  const depois = db.prepare("SELECT COUNT(*) n FROM notifications WHERE audience='agency' AND org_id=?").get(org).n;
  assert.equal(depois, antes + 1);
});
