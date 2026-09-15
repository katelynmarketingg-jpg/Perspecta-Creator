// A GALERIA ENCHENDO DE "1.png", "2.png", "3.png" REPETIDOS.
//
// Mandar o mesmo arquivo duas vezes criava dois, sem ninguém avisar. Bloquear
// seria pior — às vezes é de propósito, e perder um envio é imperdoável. Então
// o arquivo entra do mesmo jeito e a resposta avisa que já havia um igual.
//
// "Igual" é: mesmo nome, mesmo tamanho, mesma pasta, mesmo cliente. Nome igual
// em pasta diferente (ou cliente diferente) NÃO é repetição — "capa.png" de
// cada mês mora numa pasta.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-rep-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const { default: filesRoutes } = await import("../src/routes/files.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Repetida',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@rep.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Silva','active',?)").run(org).lastInsertRowid;
const outroCli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Souza','active',?)").run(org).lastInsertRowid;
const pastaA = db.prepare("INSERT INTO folders (name, client_id, org_id) VALUES ('Setembro',?,?)").run(cli, org).lastInsertRowid;
const pastaB = db.prepare("INSERT INTO folders (name, client_id, org_id) VALUES ('Outubro',?,?)").run(cli, org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/files", filesRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

async function sobe(nome, { clientId = cli, folderId = null, bytes = 4096 } = {}) {
  const fd = new FormData();
  fd.append("client_id", String(clientId));
  if (folderId) fd.append("folder_id", String(folderId));
  fd.append("files", new Blob([Buffer.alloc(bytes, 5)], { type: "image/png" }), nome);
  const r = await fetch(`${B}/files/upload`, { method: "POST", headers: H, body: fd });
  assert.equal(r.status, 201, "o envio nunca pode ser recusado por ser repetido");
  return (await r.json())[0];
}

test("a primeira vez não é repetida; a segunda avisa — e as duas entram", async () => {
  const a = await sobe("capa.png", { folderId: pastaA });
  assert.equal(a.repetida, false, "a primeira não tem nada igual antes dela");

  const b = await sobe("capa.png", { folderId: pastaA });
  assert.equal(b.repetida, true, "a segunda tinha que avisar");
  assert.notEqual(a.id, b.id, "o arquivo entra de qualquer jeito — nunca se perde um envio");

  const quantos = db.prepare(
    "SELECT COUNT(*) n FROM files WHERE folder_id = ? AND original_name = 'capa.png'"
  ).get(pastaA).n;
  assert.equal(quantos, 2);
});

test("mesmo nome em OUTRA pasta não é repetição", async () => {
  const c = await sobe("capa.png", { folderId: pastaB });
  assert.equal(c.repetida, false, "cada mês tem a sua capa.png");
});

test("mesmo nome em OUTRO cliente não é repetição", async () => {
  const d = await sobe("capa.png", { clientId: outroCli });
  assert.equal(d.repetida, false);
});

test("mesmo nome com tamanho diferente é arte nova, não repetição", async () => {
  const e = await sobe("capa.png", { folderId: pastaA, bytes: 9999 });
  assert.equal(e.repetida, false, "trocou a arte e manteve o nome — isso é versão nova");
});
