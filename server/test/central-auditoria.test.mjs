// AUDITORIA — a CENTRAL: senhas de acesso dos clientes (Instagram e afins).
// O achado: toda listagem devolvia TODAS as senhas decifradas.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-cen-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { encrypt, decrypt, guardaNaCentral } = await import("../src/central.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const workspace = (await import("../src/routes/workspace.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Central',0)").run().lastInsertRowid;
const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Vizinha 2',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@cen.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo','active',?)").run(org).lastInsertRowid;
const cliVizinho = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Vizinho','active',?)").run(outra).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/workspace", workspace);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/workspace`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

const SENHA = "SenhaDoInstagram#2026";

test("a senha é guardada CRIPTOGRAFADA, não em texto puro", () => {
  guardaNaCentral(org, cli, { kind: "credential", title: "Instagram", valor: SENHA });
  const linha = db.prepare("SELECT secret, content FROM workspace_items WHERE client_id = ? AND title = 'Instagram'").get(cli);
  assert.ok(linha.secret, "tem que ter algo guardado");
  assert.ok(!linha.secret.includes(SENHA), "a senha não pode aparecer no banco");
  assert.equal(linha.content, null, "e nem no campo de texto livre");
  assert.equal(decrypt(linha.secret), SENHA, "mas tem que voltar inteira");
});

test("cada gravação usa um vetor diferente — duas iguais não saem idênticas", () => {
  const a = encrypt(SENHA);
  const b = encrypt(SENHA);
  assert.notEqual(a, b, "senhas iguais não podem gerar o mesmo texto cifrado");
  assert.equal(decrypt(a), SENHA);
  assert.equal(decrypt(b), SENHA);
});

test("texto cifrado adulterado não é aceito — devolve nulo, não lixo", () => {
  const cifrado = encrypt(SENHA);
  const [iv, tag, dados] = cifrado.split(":");
  const mexido = [iv, tag, dados.replace(/.$/, (c) => (c === "a" ? "b" : "a"))].join(":");
  assert.equal(decrypt(mexido), null);
  assert.equal(decrypt("qualquer coisa"), null);
  assert.equal(decrypt(""), null);
  assert.equal(decrypt(null), null);
});

test("a LISTAGEM não devolve senha nenhuma — só diz que existe", async () => {
  const lista = await fetch(`${B}?client_id=${cli}`, { headers: H }).then((r) => r.json());
  const item = lista.find((x) => x.title === "Instagram");
  assert.ok(item, "o item aparece na lista");
  assert.equal(item.secret, null, "mas SEM a senha");
  assert.equal(item.tem_senha, true, "dizendo apenas que existe uma");
  assert.ok(!JSON.stringify(lista).includes(SENHA),
    "nenhuma senha pode viajar na listagem — um furo de XSS colheria todas de uma vez");
});

test("ver UMA senha é um pedido separado, e funciona", async () => {
  const lista = await fetch(`${B}?client_id=${cli}`, { headers: H }).then((r) => r.json());
  const item = lista.find((x) => x.title === "Instagram");
  const r = await fetch(`${B}/${item.id}/secret`, { headers: H }).then((x) => x.json());
  assert.equal(r.secret, SENHA);
});

test("senha de cliente de OUTRA agência não abre", async () => {
  guardaNaCentral(outra, cliVizinho, { kind: "credential", title: "Instagram", valor: "segredo-alheio" });
  const id = db.prepare("SELECT id FROM workspace_items WHERE client_id = ?").get(cliVizinho).id;
  const r = await fetch(`${B}/${id}/secret`, { headers: H });
  assert.equal(r.status, 404);
});

test("sem login, nem a listagem nem a senha abrem", async () => {
  assert.equal((await fetch(`${B}?client_id=${cli}`)).status, 401);
  const id = db.prepare("SELECT id FROM workspace_items WHERE client_id = ?").get(cli).id;
  assert.equal((await fetch(`${B}/${id}/secret`)).status, 401);
});

test("aplicar o briefing duas vezes atualiza, não duplica", () => {
  guardaNaCentral(org, cli, { kind: "credential", title: "Instagram", valor: "primeira" });
  guardaNaCentral(org, cli, { kind: "credential", title: "Instagram", valor: "segunda" });
  const n = db.prepare("SELECT COUNT(*) n FROM workspace_items WHERE client_id = ? AND title = 'Instagram'").get(cli).n;
  assert.equal(n, 1, "um item só");
  const linha = db.prepare("SELECT secret FROM workspace_items WHERE client_id = ? AND title = 'Instagram'").get(cli);
  assert.equal(decrypt(linha.secret), "segunda", "e com o valor mais novo");
});

test("editar o TÍTULO sem mandar a senha não apaga a senha", async () => {
  const item = db.prepare("SELECT * FROM workspace_items WHERE client_id = ? AND title = 'Instagram'").get(cli);
  const r = await fetch(`${B}/${item.id}`, {
    method: "PUT", headers: H,
    body: JSON.stringify({ title: "Instagram do cliente", client_id: cli, kind: "credential" }),
  });
  assert.equal(r.status, 200);
  const depois = db.prepare("SELECT secret FROM workspace_items WHERE id = ?").get(item.id);
  assert.equal(decrypt(depois.secret), "segunda", "a senha tem que continuar lá");
});
