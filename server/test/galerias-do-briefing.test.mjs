// DUAS GALERIAS NUM ONBOARDING SÓ.
//
// "Fotos do seu espaço" e "referências que você gosta" são coisas diferentes:
// uma vira conteúdo, a outra vira direção. Caindo na mesma pasta, alguém tinha
// de separar tudo à mão depois — e a contagem de uma pergunta aparecia na
// outra ("12 arquivos enviados" nas duas, tendo o cliente mandado 6 em cada).
//
// Agora cada pergunta de envio pode dizer em que pasta cai.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-galerias-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const briefingsRoutes = (await import("../src/routes/briefings.js")).default;
const { briefingPublicRouter } = await import("../src/routes/briefing-public.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa das Pastas',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@g.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Café Aurora','active',?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/briefings", briefingsRoutes);
app.use("/api/briefing", briefingPublicRouter);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;

const token = jwt.sign({ id: uid, org_id: org, role: "admin" }, JWT_SECRET);
const auth = { "content-type": "application/json", authorization: `Bearer ${token}` };

const b = await (await fetch(`${B}/briefings`, {
  method: "POST", headers: auth, body: JSON.stringify({ client_id: cli }),
})).json();

await fetch(`${B}/briefings/${b.id}/perguntas`, {
  method: "PUT", headers: auth,
  body: JSON.stringify({ secoes: [{
    id: "material", titulo: "Seu material",
    perguntas: [
      { id: "espaco", tipo: "arquivos", label: "Fotos do seu espaço", pasta: "Fotos do espaço" },
      { id: "refs", tipo: "arquivos", label: "Referências que você gosta", pasta: "Referências" },
    ],
  }] }),
});

/** Manda uma "foto" (um PNG mínimo de verdade) para uma pergunta. */
async function mandar(perguntaId, nome) {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const fd = new FormData();
  fd.append("files", new Blob([png], { type: "image/png" }), nome);
  return fetch(`${B}/briefing/${b.token}/arquivos?pergunta=${perguntaId}`, { method: "POST", body: fd });
}

const lista = (perguntaId) =>
  fetch(`${B}/briefing/${b.token}/arquivos?pergunta=${perguntaId}`).then((r) => r.json());

test("cada pergunta de envio ganha a própria pasta na galeria", async () => {
  assert.equal((await mandar("espaco", "salao.png")).status, 201);
  assert.equal((await mandar("refs", "inspiracao.png")).status, 201);

  const raiz = db.prepare("SELECT id FROM folders WHERE client_id = ? AND parent_id IS NULL AND name = ?")
    .get(cli, "Enviado pelo cliente");
  assert.ok(raiz, "a pasta geral do cliente continua existindo");
  const filhas = db.prepare("SELECT name FROM folders WHERE parent_id = ? ORDER BY name").all(raiz.id);
  assert.deepEqual(filhas.map((f) => f.name), ["Fotos do espaço", "Referências"]);
});

test("uma galeria não mostra o que o cliente mandou na outra", async () => {
  const espaco = await lista("espaco");
  const refs = await lista("refs");
  assert.deepEqual(espaco.map((f) => f.original_name), ["salao.png"]);
  assert.deepEqual(refs.map((f) => f.original_name), ["inspiracao.png"]);
});

test("a contagem de cada pergunta conta só o que é dela", async () => {
  await mandar("espaco", "balcao.png");
  const visto = await (await fetch(`${B}/briefing/${b.token}`)).json();
  assert.equal(visto.respostas.espaco, "2 arquivo(s) enviado(s)");
  assert.equal(visto.respostas.refs, "1 arquivo(s) enviado(s)");
});

test("sem pasta declarada, tudo cai na pasta geral — como sempre foi", async () => {
  await fetch(`${B}/briefings/${b.id}/perguntas`, {
    method: "PUT", headers: auth,
    body: JSON.stringify({ secoes: [{
      id: "material", titulo: "Seu material",
      perguntas: [{ id: "envios", tipo: "arquivos", label: "Mande o que tiver" }],
    }] }),
  });
  assert.equal((await mandar("envios", "solto.png")).status, 201);
  const raiz = db.prepare("SELECT id FROM folders WHERE client_id = ? AND parent_id IS NULL AND name = ?")
    .get(cli, "Enviado pelo cliente");
  const naRaiz = db.prepare("SELECT original_name FROM files WHERE folder_id = ?").all(raiz.id);
  assert.deepEqual(naRaiz.map((f) => f.original_name), ["solto.png"]);
});

after(() => { srv.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
