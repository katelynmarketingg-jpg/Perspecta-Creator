// CONFERIR UM DOCUMENTO ASSINADO — SEM LOGIN, COM O CÓDIGO DO TERMO.
//
// O Termo de Veracidade já dizia "o hash deste documento é X". Sozinho, isso é
// uma AFIRMAÇÃO: quem recebe o PDF — o cliente, um advogado, um juiz — não
// tinha como conferir se é verdade. Esta é a outra metade: um endereço
// público onde se digita o código impresso (ou se aponta a câmera para o QR) e
// o sistema responde quem assinou, quando, e se o texto mudou depois.
//
// O que NÃO pode sair daqui: o texto do contrato, o valor, o CPF inteiro, o
// e-mail inteiro. Conferir é confirmar que o documento é autêntico, não ler o
// contrato dos outros.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-verificar-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const express = (await import("express")).default;
const { verificarRouter, garanteCodigoDeVerificacao, geraCodigo, normalizaCodigo } =
  await import("../src/routes/verificar.js");
const { contractHash } = await import("../src/routes/sign.js");
const { _zera } = await import("../src/tranca.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Verificação',0)").run().lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (org_id,name,status) VALUES (?,'Von Haus','active')").run(org).lastInsertRowid;

function contrato({ texto = "Cláusula primeira: o combinado.", assinado = true } = {}) {
  const id = db.prepare(
    `INSERT INTO contracts (org_id, client_id, title, value, status, notes)
     VALUES (?,?,?,?,'active',?)`
  ).run(org, cli, "Contrato — Von Haus", 1500, texto).lastInsertRowid;
  if (assinado) {
    const c = db.prepare("SELECT * FROM contracts WHERE id=?").get(id);
    db.prepare(
      `UPDATE contracts SET signed_at='2026-10-20 14:30:00', signer_name='Marcelo Lemos',
         signer_document='12345678909', signer_ip='201.1.2.3', signed_hash=?,
         sign_verify_method='email', sign_verify_dest='m****@vonhaus.com'
       WHERE id=?`
    ).run(contractHash(c), id);
  }
  return id;
}

const app = express();
app.use(express.json());
app.use("/api/verificar", verificarRouter);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/verificar`;
after(() => srv.close());

const confere = async (codigo) => {
  const r = await fetch(`${B}/${codigo}`);
  return { status: r.status, corpo: await r.json() };
};

test("o código é legível: sem 0/O nem 1/I, para ditar no telefone", () => {
  for (let i = 0; i < 200; i++) {
    const c = geraCodigo();
    assert.equal(c.length, 6);
    assert.ok(!/[01OIL]/.test(c), `código confuso: ${c}`);
  }
  // Digitado com traço, minúsculo ou com espaço, é o mesmo código.
  assert.equal(normalizaCodigo("abc-k7m"), "ABCK7M");
  assert.equal(normalizaCodigo(" ABC K7M "), "ABCK7M");
});

test("o código nasce uma vez e não muda mais", () => {
  const id = contrato();
  const primeiro = garanteCodigoDeVerificacao(id);
  assert.match(primeiro, /^[0-9A-Z]{6}$/);
  // Papel já entregue não se corrige: chamar de novo devolve o mesmo.
  assert.equal(garanteCodigoDeVerificacao(id), primeiro);
});

test("com o código, qualquer pessoa confere quem assinou e quando", async () => {
  const id = contrato();
  const codigo = garanteCodigoDeVerificacao(id);
  const { status, corpo } = await confere(codigo);
  assert.equal(status, 200);
  assert.equal(corpo.encontrado, true);
  assert.equal(corpo.status, "assinado");
  assert.equal(corpo.documento.titulo, "Contrato — Von Haus");
  assert.equal(corpo.documento.emitido_por, "Casa da Verificação");
  assert.equal(corpo.assinaturas.length, 1);
  assert.equal(corpo.assinaturas[0].nome, "Marcelo Lemos");
  assert.match(corpo.assinaturas[0].verificacao, /código único enviado por e-mail/i);
});

test("o que é dos outros continua sendo dos outros", async () => {
  const id = contrato();
  const codigo = garanteCodigoDeVerificacao(id);
  const { corpo } = await confere(codigo);
  const tudo = JSON.stringify(corpo);
  assert.ok(!tudo.includes("Cláusula primeira"), "o texto do contrato não pode sair daqui");
  assert.ok(!tudo.includes("1500"), "nem o valor");
  assert.ok(!tudo.includes("12345678909"), "nem o CPF inteiro");
  assert.equal(corpo.assinaturas[0].documento, "***.456.789-**");
  // O hash inteiro também não: só a ponta, que é o que o termo imprime.
  const c = db.prepare("SELECT signed_hash FROM contracts WHERE id=?").get(id);
  assert.ok(!tudo.includes(c.signed_hash));
  assert.equal(corpo.hash_final, c.signed_hash.slice(-12));
});

test("texto mexido depois de assinado: a página AVISA", async () => {
  const id = contrato();
  const codigo = garanteCodigoDeVerificacao(id);
  db.prepare("UPDATE contracts SET notes = ? WHERE id = ?")
    .run("Cláusula primeira: o combinado, mas com outro valor.", id);
  const { corpo } = await confere(codigo);
  assert.equal(corpo.status, "alterado",
    "é esta a pergunta que a página existe para responder");
});

test("código que não existe não diz nada além de 'não existe'", async () => {
  _zera();
  const { status, corpo } = await confere("ZZZZZZ");
  assert.equal(status, 404);
  assert.equal(corpo.encontrado, false);
  assert.match(corpo.error, /Não encontrei/);
});

test("tentar adivinhar o código cansa antes de acertar", async () => {
  _zera();
  const tentativas = [];
  for (let i = 0; i < 9; i++) tentativas.push((await confere("ZZZZZ" + "23456789"[i])).status);
  assert.ok(tentativas.includes(429),
    "sem trava, dá para varrer códigos à vontade num endereço público");
});

test("contrato sem assinatura nenhuma não tem código para conferir", () => {
  _zera();
  const id = contrato({ assinado: false });
  // O código só nasce quando alguém assina — quem chama é a rota de assinatura.
  const c = db.prepare("SELECT verify_code FROM contracts WHERE id=?").get(id);
  assert.equal(c.verify_code, null);
});

// O CÓDIGO NASCE SOZINHO, nas duas pontas em que um documento vira assinado:
// quando o cliente assina pelo link e quando a casa assina. Sem isso, o termo
// sairia impresso mandando conferir num código que não existe.
test("assinar pelo link e assinar como a casa criam o código", async () => {
  const { readFileSync } = await import("node:fs");
  const rotas = new URL("../src/routes/", import.meta.url);
  for (const arquivo of ["sign.js", "contracts.js"]) {
    const texto = readFileSync(new URL(arquivo, rotas), "utf8");
    assert.match(texto, /garanteCodigoDeVerificacao\(c\.id\)/,
      `${arquivo} precisa criar o código ao assinar — senão o termo sai impresso mandando conferir um código que não existe`);
  }
});
