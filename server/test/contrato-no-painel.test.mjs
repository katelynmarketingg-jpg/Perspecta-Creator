// "POSSO SABER SE DEU PRA GERAR O CONTRATO, SE A MINHA ASSINATURA JA FOI
//  COLETADA OU FALTA ASSINAR, E MESMA COISA A DELA, SE JA MANDAMOS."
//
// São quatro perguntas de sim ou não sobre o mesmo documento, e a resposta
// estava espalhada: o contrato numa aba, a assinatura noutra, o "já mandei?"
// na memória dela. Agora o painel do cliente, no Onboarding, responde as
// quatro — e, quando o contrato não saiu, diz POR QUÊ.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-contrato-painel-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const briefings = (await import("../src/routes/briefings.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Contrato',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katy','Katy','k@ct.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (org_id,name,status) VALUES (?,?,'active')").run(org, "Von Haus").lastInsertRowid;
const bid = db.prepare(
  "INSERT INTO briefings (org_id,client_id,token,status) VALUES (?,?,?,'aberto')"
).run(org, cli, "tok-contrato").lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/briefings", briefings);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/briefings`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

const painel = async () => (await (await fetch(B, { headers: H })).json())[0];

test("sem os termos, o painel diz que falta preencher — não só 'não gerou'", async () => {
  const c = (await painel()).contrato;
  assert.equal(c.gerado, false);
  assert.equal(c.pode_gerar, false);
  assert.match(c.motivo, /Faltam os termos/);
});

test("gerar na mão sem termos é recusado com o mesmo motivo", async () => {
  const r = await fetch(`${B}/${bid}/contrato`, { method: "POST", headers: H });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Faltam os termos/);
});

test("com o contrato na mesa, as quatro perguntas têm resposta", async () => {
  const ct = db.prepare(
    "INSERT INTO contracts (org_id,client_id,title,value,status) VALUES (?,?,?,?,'active')"
  ).run(org, cli, "Contrato — Von Haus", 1500).lastInsertRowid;

  let c = (await painel()).contrato;
  assert.equal(c.gerado, true);
  assert.equal(c.title, "Contrato — Von Haus");
  assert.equal(c.assinatura_casa, null, "ainda não assinei");
  assert.equal(c.enviado_em, null, "ainda não mandei");
  assert.equal(c.assinatura_cliente, null, "ele ainda não assinou");

  db.prepare(
    `UPDATE contracts SET agency_signed_at = '2026-10-20 10:00:00', agency_signer_name = 'Katelyn',
       sent_at = '2026-10-21 09:00:00', signed_at = '2026-10-22 18:30:00', signer_name = 'Marcelo'
     WHERE id = ?`
  ).run(ct);

  c = (await painel()).contrato;
  assert.equal(c.assinatura_casa, "2026-10-20 10:00:00");
  assert.equal(c.quem_assinou_casa, "Katelyn");
  assert.equal(c.enviado_em, "2026-10-21 09:00:00");
  assert.equal(c.assinatura_cliente, "2026-10-22 18:30:00");
  assert.equal(c.quem_assinou_cliente, "Marcelo");
});

test("não gera um segundo contrato por cima do que já está esperando", async () => {
  db.prepare("UPDATE briefings SET terms = ? WHERE id = ?")
    .run(JSON.stringify({ template_id: 1, value: 1500 }), bid);
  // O que existe já está assinado pelo cliente, então o guarda é o outro: o
  // onboarding só gera quando não há contrato aberto esperando assinatura.
  db.prepare("UPDATE contracts SET signed_at = NULL WHERE client_id = ?").run(cli);
  const r = await fetch(`${B}/${bid}/contrato`, { method: "POST", headers: H });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /já tem um contrato/);
});

test("a tela mostra os quatro passos, na ordem em que acontecem", () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const tela = readFileSync(join(raiz, "client/src/pages/Onboarding.jsx"), "utf8");
  const ordem = ["Contrato gerado", "A minha assinatura", "Mandado para o cliente", "A assinatura dele"]
    .map((x) => tela.indexOf(x));
  assert.ok(ordem.every((i) => i > 0), "algum passo do contrato sumiu do painel");
  for (let i = 1; i < ordem.length; i++) {
    assert.ok(ordem[i] > ordem[i - 1], "os passos saíram da ordem em que acontecem");
  }
  // E cada passo que falta traz o botão que resolve, não só o aviso.
  assert.match(tela, /assinar-como-casa/, "faltou o botão de assinar como a casa");
  assert.match(tela, /sign-link/, "faltou pegar o link para mandar");
  assert.match(tela, /briefings\/\$\{briefing\.id\}\/contrato/, "faltou gerar o contrato que não saiu");
});
