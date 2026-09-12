// AUDITORIA DA MINIATURA DA GRADE (Distribuição / Galeria).
//
// A grade pede a miniatura de CADA quadradinho. Arquivo enviado antes de a
// miniatura existir simplesmente não tem uma — isso é estado normal, não erro.
// A resposta tem que dizer "não tem" sem levantar 404: senão o console enche de
// vermelho a cada tela aberta e fica impossível enxergar erro de verdade no
// meio do barulho. O 404 fica só para arquivo que não existe (ou é de outra
// agência).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-mini-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const { default: filesRoutes, sharedRouter } = await import("../src/routes/files.js");

const cabeca = (nome) => {
  const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES (?, 0)").run(nome).lastInsertRowid;
  const uid = db.prepare(
    "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES (?,?,?,?,'admin',1,?)"
  ).run(nome, nome, `${nome}@t.com`, hashPassword("x"), org).lastInsertRowid;
  return { org, H: { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` } };
};

const casa = cabeca("Casa da Miniatura");
const vizinha = cabeca("Agência Vizinha");

const arte = join(dir, "arte.jpg");
writeFileSync(arte, Buffer.alloc(4096, 7));
const guarda = (org, thumb) => db.prepare(
  `INSERT INTO files (original_name, mime, size, stored_path, stage, thumb, org_id)
   VALUES ('post.jpg','image/jpeg',4096,?,'editados',?,?)`
).run(arte, thumb, org).lastInsertRowid;

const MINI = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const semMiniatura = guarda(casa.org, null);
const comMiniatura = guarda(casa.org, MINI);
const daVizinha = guarda(vizinha.org, MINI);

const app = express();
app.use(express.json({ limit: "15mb" }));
app.use("/api/files", sharedRouter);
app.use("/api/files", filesRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/files`;
after(() => srv.close());

test("arquivo sem miniatura responde 200 com thumb nula — não 404", async () => {
  const r = await fetch(`${B}/${semMiniatura}/thumb`, { headers: casa.H });
  assert.equal(r.status, 200, "não ter miniatura ainda é estado normal, não erro");
  assert.equal((await r.json()).thumb, null);
});

test("arquivo com miniatura devolve a miniatura", async () => {
  const r = await fetch(`${B}/${comMiniatura}/thumb`, { headers: casa.H });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).thumb, MINI);
});

test("arquivo que não existe continua 404", async () => {
  const r = await fetch(`${B}/999999/thumb`, { headers: casa.H });
  assert.equal(r.status, 404);
});

test("miniatura de outra agência não vaza", async () => {
  const r = await fetch(`${B}/${daVizinha}/thumb`, { headers: casa.H });
  assert.equal(r.status, 404, "arquivo de outra agência não pode ser lido");
});

test("guardar a miniatura depois funciona e ela passa a voltar na consulta", async () => {
  const g = await fetch(`${B}/${semMiniatura}/thumb`, {
    method: "PUT",
    headers: { ...casa.H, "content-type": "application/json" },
    body: JSON.stringify({ thumb: MINI }),
  });
  assert.equal(g.status, 200);
  const r = await fetch(`${B}/${semMiniatura}/thumb`, { headers: casa.H });
  assert.equal((await r.json()).thumb, MINI);
});

test("não dá para plantar qualquer coisa no lugar da miniatura", async () => {
  const alvo = guarda(casa.org, null);
  const r = await fetch(`${B}/${alvo}/thumb`, {
    method: "PUT",
    headers: { ...casa.H, "content-type": "application/json" },
    body: JSON.stringify({ thumb: "<script>alert(1)</script>" }),
  });
  assert.equal(r.status, 400, "miniatura tem que ser data:image/");
});
