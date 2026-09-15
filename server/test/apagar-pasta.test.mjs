// APAGAR UMA PASTA DEIXAVA LIXO NA NUVEM, PARA SEMPRE.
//
// A rota só apagava de verdade os arquivos soltos na pasta escolhida. O que
// estava numa SUBPASTA sumia do banco por cascata e os bytes continuavam lá —
// invisíveis na galeria, impossíveis de recuperar e cobrados no fim do mês.
//
// E a remoção era disparada sem `await`: a resposta dizia "ok" antes de a
// remoção começar, então qualquer falha da nuvem sumia sem deixar rastro.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-pasta-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const { default: filesRoutes } = await import("../src/routes/files.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Pasta',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@pasta.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Silva','active',?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/files", filesRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

const novaPasta = (name, parent_id) => db.prepare(
  "INSERT INTO folders (name, client_id, parent_id, org_id) VALUES (?,?,?,?)"
).run(name, cli, parent_id || null, org).lastInsertRowid;

function arquivoEm(folderId, nome) {
  const caminho = join(dir, nome);
  writeFileSync(caminho, Buffer.alloc(512, 7));
  const id = db.prepare(
    `INSERT INTO files (folder_id, client_id, original_name, mime, size, stored_path, stage, org_id)
     VALUES (?,?,?,'image/png',512,?,'editados',?)`
  ).run(folderId, cli, nome, caminho, org).lastInsertRowid;
  return { id, caminho };
}

test("apagar a pasta leva embora o que está nas subpastas também", async () => {
  const mae = novaPasta("Outubro");
  const filha = novaPasta("Stories", mae);
  const neta = novaPasta("Bastidores", filha);
  const a = arquivoEm(mae, "na-mae.png");
  const b = arquivoEm(filha, "na-filha.png");
  const c = arquivoEm(neta, "na-neta.png");

  const r = await fetch(`${B}/files/folders/${mae}`, { method: "DELETE", headers: H });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.arquivos, 3, "tinha que contar os três, não só o da pasta de cima");
  assert.equal(j.pastas, 3, "a árvore inteira: mãe, filha e neta");

  for (const { caminho, } of [a, b, c]) {
    assert.equal(existsSync(caminho), false, `${caminho} continuou ocupando espaço depois de apagar a pasta`);
  }
  for (const { id } of [a, b, c]) {
    assert.equal(db.prepare("SELECT id FROM files WHERE id = ?").get(id), undefined);
  }
});

test("a resposta só sai depois de remover de verdade", async () => {
  const p = novaPasta("Novembro");
  const a = arquivoEm(p, "sozinha.png");
  const r = await fetch(`${B}/files/folders/${p}`, { method: "DELETE", headers: H });
  assert.equal(r.status, 200);
  // Sem nenhuma espera: se a remoção fosse disparada sem await, o arquivo ainda
  // estaria aqui neste exato instante.
  assert.equal(existsSync(a.caminho), false, "a resposta saiu antes de o arquivo ser removido");
});

test("pasta de outro escritório não é apagada", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Vizinha',0)").run().lastInsertRowid;
  const cliVizinho = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Vizinho','active',?)").run(outra).lastInsertRowid;
  const alheia = db.prepare("INSERT INTO folders (name, client_id, org_id) VALUES ('Deles',?,?)").run(cliVizinho, outra).lastInsertRowid;
  const r = await fetch(`${B}/files/folders/${alheia}`, { method: "DELETE", headers: H });
  assert.equal(r.status, 404);
  assert.ok(db.prepare("SELECT id FROM folders WHERE id = ?").get(alheia), "a pasta da vizinha continua lá");
});
