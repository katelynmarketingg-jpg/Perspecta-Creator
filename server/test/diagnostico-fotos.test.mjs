// "SUMIU TODAS AS FOTOS" — o diagnóstico.
//
// Esta é a falha mais assustadora do sistema, e a mais silenciosa: se o acesso
// ao R2 quebra — chave trocada, variável perdida num deploy, permissão retirada
// —, TODA foto e TODO vídeo somem de uma vez. Nenhum erro na tela, nada errado
// no banco, os arquivos intactos na Cloudflare. Só não aparecem.
//
// Pior: assinar o endereço de um arquivo é conta matemática feita dentro do
// servidor, SEM tocar na rede. Com a chave errada a assinatura sai perfeita, o
// servidor acha que serviu, e quem recusa é a Cloudflare — longe de qualquer
// log que a agência consiga ler.
//
// Estes testes seguram a rota que responde "por que sumiram", em português.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-diag-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";
// Sem chaves de R2: é exatamente o estado "variáveis perdidas no deploy".
delete process.env.R2_ACCOUNT_ID; delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY; delete process.env.R2_BUCKET;

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { testarR2 } = await import("../src/storage.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const { default: filesRoutes, sharedRouter } = await import("../src/routes/files.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa das Fotos',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katy','katy','k@f.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo','active',?)").run(org).lastInsertRowid;

const guarda = (nome, caminho) => db.prepare(
  `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
   VALUES (?,?,'image/png',100,?,'editados',?)`
).run(cli, nome, caminho, org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/files", sharedRouter);
app.use("/api/files", filesRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/files`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

const diagnostico = () => fetch(`${B}/diagnostico`, { headers: H }).then((r) => r.json());

test("R2 desligado é dito com todas as letras, e diz que nada se perdeu", async () => {
  const r = await testarR2("qualquer/chave");
  assert.equal(r.ok, false);
  assert.equal(r.etapa, "configuracao");
  assert.match(r.mensagem, /DESLIGADO/);
  assert.match(r.mensagem, /não foram perdidos/, "a pessoa precisa saber que o material está a salvo");
  assert.ok(r.faltando.includes("R2_BUCKET"));
});

test("com arquivos no R2 e o R2 fora, o veredito diz quantos sumiram", async () => {
  guarda("foto-na-nuvem.png", "r2:uploads/9/abc");
  guarda("outra-na-nuvem.png", "r2:uploads/9/def");
  const d = await diagnostico();
  assert.equal(d.no_r2, 2);
  assert.match(d.veredito, /2 de \d+ arquivos estão no R2/);
  assert.match(d.veredito, /NENHUM deles consegue ser mostrado/);
});

test("arquivo que sumiu do disco do servidor também é apontado", async () => {
  const caminho = join(dir, "some.png");
  writeFileSync(caminho, Buffer.alloc(10));
  guarda("estava-no-disco.png", caminho);
  unlinkSync(caminho);   // é o que acontece quando o Render troca de máquina
  const d = await diagnostico();
  assert.ok(d.sumiram_do_disco >= 1, JSON.stringify(d));
});

test("o veredito explica o disco efêmero em vez de só dizer 'arquivo não encontrado'", async () => {
  // Sem nada no R2, o veredito passa a ser sobre o disco.
  db.prepare("DELETE FROM files WHERE stored_path LIKE 'r2:%' AND org_id = ?").run(org);
  const d = await diagnostico();
  assert.match(d.veredito, /disco/i);
  assert.match(d.veredito, /apagado a cada troca de máquina|R2/,
    "tem que dizer POR QUE some, senão o aviso não ajuda a resolver");
});

test("tudo em ordem: o veredito não assusta à toa", async () => {
  db.prepare("DELETE FROM files WHERE org_id = ?").run(org);
  const bom = join(dir, "ok.png");
  writeFileSync(bom, Buffer.alloc(10));
  guarda("no-disco-e-existe.png", bom);
  const d = await diagnostico();
  assert.equal(d.sumiram_do_disco, 0);
  assert.match(d.veredito, /Nada errado/);
});

test("o diagnóstico é só da própria agência", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const outroU = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('V','V','v@f.com',?,'admin',1,?)")
    .run(hashPassword("SenhaBoa#1"), outra).lastInsertRowid;
  const d = await fetch(`${B}/diagnostico`, { headers: { authorization: `Bearer ${jwt.sign({ id: outroU }, JWT_SECRET)}` } }).then((r) => r.json());
  assert.equal(d.total, 0, "não pode contar arquivo de outra agência");
});
