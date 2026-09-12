// AUDITORIA DO REENVIO DO ONBOARDING (Etapa 2 da auditoria).
//
// "Enviar duas vezes (clique duplo, ou voltar e reenviar) duplica alguma coisa
// — contrato, cobrança, aviso?" A resposta era pior que duplicar: APAGAVA.
//
// O passo a passo do estrago: ao enviar, a senha que o cliente respondeu sai da
// resposta do formulário (certo: não pode ficar em texto puro) e o lugar dela
// fica com o texto "(guardado na Central)". Se o cliente reenviasse — clique
// duplo, voltar no navegador, recarregar —, esse TEXTO era tratado como a nova
// senha e substituía a senha de verdade na Central, criptografada e tudo.
// A senha do Instagram do cliente ia embora e ninguém ficava sabendo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-reenvio-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { decrypt } = await import("../src/central.js");
const { fechaOnboarding, GUARDADO } = await import("../src/onboarding.js");
const { getTemplate } = await import("../src/briefing.js");

const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES ('Casa do Reenvio', 0)").run().lastInsertRowid;
const cliente = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo','active',?)").run(org).lastInsertRowid;

// A agência marca, no modelo dela, quais perguntas vão para a Central como
// ACESSO/SENHA (o modelo que vem de fábrica não marca nenhuma — quem escolhe é
// ela). Montamos aqui o modelo como ela montaria.
const SECOES = [{
  id: "acessos", titulo: "Acessos", perguntas: [
    { id: "senha_insta", tipo: "texto", label: "Senha do Instagram", destino_central: "credential" },
    { id: "obs", tipo: "longo", label: "Observações do acesso", destino_central: "note" },
  ],
}];
db.prepare("INSERT INTO briefing_templates (org_id, welcome, sections) VALUES (?, ?, ?)")
  .run(org, JSON.stringify({}), JSON.stringify(SECOES));

const daSenha = { id: "senha_insta", label: "Senha do Instagram" };

test("o modelo desta casa tem mesmo uma pergunta de senha", () => {
  const secoes = getTemplate(org).secoes;
  const p = secoes.flatMap((s) => s.perguntas).find((q) => q.id === "senha_insta");
  assert.equal(p?.destino_central, "credential");
});

function novoBriefing(respostas) {
  const id = db.prepare(
    "INSERT INTO briefings (client_id, token, status, answers, org_id) VALUES (?, ?, 'aberto', ?, ?)"
  ).run(cliente, `t${Math.random()}`, JSON.stringify(respostas), org).lastInsertRowid;
  return db.prepare("SELECT * FROM briefings WHERE id = ?").get(id);
}

test("reenviar o onboarding NÃO apaga a senha guardada na Central", () => {
  const SENHA = "InstaDoMarcelo#2026";
  const b = novoBriefing({ [daSenha.id]: SENHA });

  fechaOnboarding(b, JSON.parse(b.answers));
  const guardado = db.prepare(
    "SELECT secret FROM workspace_items WHERE org_id = ? AND client_id = ? AND title = ?"
  ).get(org, cliente, daSenha.label);
  assert.equal(decrypt(guardado.secret), SENHA, "a senha tinha que estar na Central");

  // O cliente reenvia: o formulário agora carrega o texto de substituição.
  const depois = db.prepare("SELECT * FROM briefings WHERE id = ?").get(b.id);
  fechaOnboarding(depois, JSON.parse(depois.answers));

  const agora = db.prepare(
    "SELECT secret FROM workspace_items WHERE org_id = ? AND client_id = ? AND title = ?"
  ).get(org, cliente, daSenha.label);
  assert.equal(decrypt(agora.secret), SENHA,
    "reenviar não pode escrever o texto '(guardado na Central)' por cima da senha de verdade");
});

test("reenviar não enche a Central de cópias", () => {
  const b = novoBriefing({ [daSenha.id]: "OutraSenha#1" });
  fechaOnboarding(b, JSON.parse(b.answers));
  const conta = () => db.prepare(
    "SELECT COUNT(*) AS n FROM workspace_items WHERE org_id = ? AND client_id = ? AND title = ?"
  ).get(org, cliente, daSenha.label).n;
  const antes = conta();
  const d = db.prepare("SELECT * FROM briefings WHERE id = ?").get(b.id);
  fechaOnboarding(d, JSON.parse(d.answers));
  assert.equal(conta(), antes, "o mesmo título atualiza, não duplica");
});

// A porta pública: o cliente aperta "enviar" duas vezes.
const express = (await import("express")).default;
const { briefingPublicRouter } = await import("../src/routes/briefing-public.js");
const app = express();
app.use(express.json({ limit: "15mb" }));
app.use("/api/briefing", briefingPublicRouter);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/briefing`;
const { after } = await import("node:test");
after(() => srv.close());

function contaAvisos() {
  return db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE org_id = ? AND client_id = ?")
    .get(org, cliente).n;
}

test("clicar duas vezes em enviar não avisa a equipe duas vezes", async () => {
  const token = `dup${Date.now()}`;
  db.prepare("INSERT INTO briefings (client_id, token, status, answers, org_id) VALUES (?, ?, 'aberto', ?, ?)")
    .run(cliente, token, JSON.stringify({ senha_insta: "Segredo#9" }), org);

  const antes = contaAvisos();
  const um = await fetch(`${B}/${token}/enviar`, { method: "POST" });
  assert.equal(um.status, 200);
  const depoisDoPrimeiro = contaAvisos();
  assert.ok(depoisDoPrimeiro > antes, "o primeiro envio precisa avisar a equipe");

  const dois = await fetch(`${B}/${token}/enviar`, { method: "POST" });
  assert.equal(dois.status, 200, "o cliente não pode ver erro por ter clicado duas vezes");
  assert.equal((await dois.json()).ja_enviado, true);
  assert.equal(contaAvisos(), depoisDoPrimeiro, "o segundo clique não pode gerar aviso novo");
});

test("clicar duas vezes não mexe na senha já guardada", async () => {
  const senha = db.prepare(
    "SELECT secret FROM workspace_items WHERE org_id = ? AND client_id = ? AND title = 'Senha do Instagram'"
  ).get(org, cliente);
  assert.notEqual(decrypt(senha.secret), GUARDADO, "a senha de verdade tem que continuar lá");
});
