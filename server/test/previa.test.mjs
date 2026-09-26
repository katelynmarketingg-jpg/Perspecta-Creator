// A PRÉVIA: a arte no tamanho em que ela APARECE.
//
// A grade do perfil desenha quadradinhos de uns 350 px e estava baixando a arte
// ORIGINAL de cada peça para isso — medido no Chromium, 12,6 MB com nove peças
// (e 38 MB com artes pesadas). A prévia tem 1080 px de largura (a mesma que a
// Meta publica) e uns 150 KB.
//
// Ela vai por ENDEREÇO, não embutida na listagem: assim cada uma fica no cache
// do navegador e a listagem não engorda.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-previa-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const { default: filesRoutes, sharedRouter } = await import("../src/routes/files.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Prévia',0)").run().lastInsertRowid;
const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Vizinha da Prévia',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@previa.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Silva','active',?)").run(org).lastInsertRowid;
const arquivo = db.prepare(
  `INSERT INTO files (client_id, original_name, mime, size, stored_path, stage, org_id)
   VALUES (?, 'arte.png', 'image/png', 6000000, 'r2:uploads/9/arte', 'editados', ?)`
).run(cli, org).lastInsertRowid;

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/api/files", sharedRouter);
app.use("/api/files", filesRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

// Um JPEG mínimo de verdade, em data URI.
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

test("sem prévia, a listagem diz que não tem — e nada quebra", async () => {
  const r = await fetch(`${B}/files?client_id=${cli}&all=1`, { headers: H });
  const [f] = await r.json();
  assert.equal(f.preview_url, null, "arquivo antigo não tem prévia");
  assert.ok(f.media_url, "e continua com o endereço da arte, como antes");
  assert.equal(f.stored_path, undefined, "o caminho interno não pode sair na resposta");
});

test("guarda a prévia e a listagem passa a trazer o endereço dela", async () => {
  const p = await fetch(`${B}/files/${arquivo}/previa`, { method: "PUT", headers: H, body: JSON.stringify({ previa: JPEG }) });
  assert.equal(p.status, 200);

  const r = await fetch(`${B}/files?client_id=${cli}&all=1`, { headers: H });
  const [f] = await r.json();
  assert.match(f.preview_url || "", /^\/api\/files\/previa\//, "o endereço da prévia tem que vir na listagem");
  // E os bytes da prévia NÃO vão junto: é isso que mantém a listagem leve.
  assert.ok(!JSON.stringify(f).includes(JPEG.slice(30, 60)), "a prévia não pode ir embutida na listagem");
});

test("o endereço da prévia devolve a imagem, sem precisar de login", async () => {
  const r0 = await fetch(`${B}/files?client_id=${cli}&all=1`, { headers: H });
  const [f] = await r0.json();
  const r = await fetch(`http://127.0.0.1:${srv.address().port}${f.preview_url}`);  // sem cabeçalho nenhum
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/jpeg");
  assert.match(r.headers.get("cache-control") || "", /max-age=\d{4,}/, "prévia nunca muda: cache longo");
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.ok(bytes.length > 100, "veio imagem de verdade");
  assert.equal(bytes[0], 0xFF, "começa como um JPEG");
});

test("bilhete de outra agência não abre a prévia", async () => {
  const falso = jwt.sign({ file_id: arquivo, org_id: outra, previa: true }, JWT_SECRET, { expiresIn: "1h" });
  const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/files/previa/${falso}`);
  assert.equal(r.status, 404, "arquivo de outra casa não existe para esse bilhete");
});

test("bilhete de mídia comum não vale como bilhete de prévia", async () => {
  const semMarca = jwt.sign({ file_id: arquivo, org_id: org, inline: true }, JWT_SECRET, { expiresIn: "1h" });
  const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/files/previa/${semMarca}`);
  assert.equal(r.status, 403);
});

// UMA PRÉVIA MELHOR SUBSTITUI A ANTIGA.
//
// Antes esta rota recusava QUALQUER prévia quando já havia uma: respondia "já
// tinha" e jogava a nova fora. Era isso que travava o conserto das tiras de
// carrossel — o navegador refazia a prévia em alta a partir do original e o
// servidor descartava em silêncio, sem erro nenhum na tela.
//
// O critério é o tamanho: para a mesma arte, mais resolução é mais bytes.
test("prévia melhor entra no lugar da antiga; pior não estraga o que já está bom", async () => {
  const antes = db.prepare("SELECT preview FROM files WHERE id = ?").get(arquivo).preview;

  // Uma prévia MAIOR (mais resolução) substitui.
  const melhor = `${JPEG}${"A".repeat(400)}`;
  const r = await fetch(`${B}/files/${arquivo}/previa`, { method: "PUT", headers: H, body: JSON.stringify({ previa: melhor }) });
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(db.prepare("SELECT preview FROM files WHERE id = ?").get(arquivo).preview, melhor);

  // Uma prévia MENOR (tela antiga, com a conta velha) não desfaz o conserto.
  const pior = await fetch(`${B}/files/${arquivo}/previa`, { method: "PUT", headers: H, body: JSON.stringify({ previa: JPEG }) });
  assert.deepEqual(await pior.json(), { ok: true, ja_tinha: true });
  assert.equal(db.prepare("SELECT preview FROM files WHERE id = ?").get(arquivo).preview, melhor);
  assert.notEqual(melhor, antes);
});

test("lixo e prévia gigante são recusados", async () => {
  const novo = db.prepare("INSERT INTO files (client_id, original_name, mime, size, stored_path, stage, org_id) VALUES (?,?,?,?,?,?,?)")
    .run(cli, "b.png", "image/png", 10, "x", "editados", org).lastInsertRowid;
  const ruim = await fetch(`${B}/files/${novo}/previa`, { method: "PUT", headers: H, body: JSON.stringify({ previa: "<script>alert(1)</script>" }) });
  assert.equal(ruim.status, 400);

  // O teto existe para a tira larga caber; acima dele, recusa.
  const gigante = `data:image/jpeg;base64,${"A".repeat(1700 * 1024)}`;
  const grande = await fetch(`${B}/files/${novo}/previa`, { method: "PUT", headers: H, body: JSON.stringify({ previa: gigante }) });
  assert.equal(grande.status, 400);
  assert.equal(db.prepare("SELECT preview FROM files WHERE id = ?").get(novo).preview, null);
});
