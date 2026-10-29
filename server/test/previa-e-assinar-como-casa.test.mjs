// VER O CONTRATO ANTES — E JÁ DEIXAR ASSINADO POR ELA.
//
// "quero que tenha um botão de ver contrato com os dados. bem como pra que eu
// mesma já possa assinar, entende?"
//
// Antes: a única forma de ver o contrato preenchido era GERAR um de verdade —
// criando um documento no sistema só para conferir. E a assinatura da casa só
// podia ser posta depois, na aba Contratos, quando ela lembrasse: o cliente
// abria o link e via um papel em branco dos dois lados.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-previa-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const briefings = (await import("../src/routes/briefings.js")).default;
const { geraContratoDoOnboarding } = await import("../src/onboarding.js");

const org = db.prepare(
  "INSERT INTO organizations (name,is_master,document,city) VALUES ('Casa da Prévia',0,'52.622.307/0001-28','Porto Alegre')"
).run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katy','Katy','k@prev.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare(
  `INSERT INTO clients (org_id,name,status,legal_name,document,address,rep_name,rep_document,payment_day,email)
   VALUES (?,'Dra. Ana Prado','active','Ana Prado Advocacia LTDA','12345678000190','Av. Central, 100','Ana Prado','123.456.789-09',10,'ana@x.com')`
).run(org).lastInsertRowid;
const servico = db.prepare(
  "INSERT INTO services (org_id,name,default_price,contract_template) VALUES (?,?,?,?)"
).run(org, "Landing Page", 2500,
  "<h1>CONTRATO</h1><p>CONTRATANTE: {{razao_social}}, {{documento_rotulo}} {{cnpj}}, em {{endereco}}.</p>"
  + "<p>Valor de {{valor}} ({{valor_extenso}}), vencimento {{vencimento}}.</p><p>{{assinatura_perspecta}}</p>").lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/briefings", briefings);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/briefings`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

const quantosContratos = () => db.prepare("SELECT COUNT(*) n FROM contracts WHERE org_id=?").get(org).n;
const previa = (corpo) => fetch(`${B}/previa-contrato`, { method: "POST", headers: H, body: JSON.stringify(corpo) });

test("a prévia traz o contrato com os dados do cliente — e NÃO cria nada", async () => {
  const antes = quantosContratos();
  const r = await previa({ client_id: cli, termos: { service_id: servico, servico: "Landing Page", value: "2500" } });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.match(d.titulo, /Landing Page/);
  assert.match(d.corpo, /Ana Prado Advocacia LTDA/);
  assert.match(d.corpo, /12\.345\.678\/0001-90/, "o CNPJ sai formatado, como vai para o papel");
  assert.match(d.corpo, /R\$ 2\.500,00/);
  assert.match(d.corpo, /dois mil e quinhentos reais/);
  assert.match(d.corpo, /todo dia 10 de cada mês/);
  assert.equal(quantosContratos(), antes, "ver não pode criar documento nenhum");
});

test("a prévia diz o que ainda falta", async () => {
  const d = await (await previa({ client_id: cli, termos: { service_id: servico } })).json();
  assert.ok(Array.isArray(d.faltando));
  assert.ok(d.faltando.some((x) => /assina pela agência/i.test(x)),
    "é o que responde 'por que saiu uma linha em branco aqui?' antes de o cliente ver");
});

test("sem cliente ou sem serviço, a prévia explica o que falta escolher", async () => {
  assert.match((await (await previa({ termos: { service_id: servico } })).json()).error, /Escolha o cliente/);
  assert.match((await (await previa({ client_id: cli, termos: {} })).json()).error, /Escolha o serviço/);
});

test("ligou 'já assinado por mim' sem ter desenhado a assinatura: a prévia avisa", async () => {
  const d = await (await previa({ client_id: cli, assinar_casa: 1, termos: { service_id: servico } })).json();
  assert.equal(d.falta_assinatura_casa, true);
  assert.equal(d.assinatura_casa, null);
});

test("com a assinatura desenhada, o contrato do onboarding JÁ NASCE assinado por ela", () => {
  db.prepare("UPDATE organizations SET signature_img=?, signer_name=?, signer_document=? WHERE id=?")
    .run("data:image/png;base64,AAA", "Katelyn dos Santos", "040.096.640-96", org);

  const token = "tok-previa";
  const termos = { service_id: servico, servico: "Landing Page", value: 2500, assinar_casa: 1 };
  db.prepare("INSERT INTO briefings (org_id,client_id,token,status,terms) VALUES (?,?,?,'respondido',?)")
    .run(org, cli, token, JSON.stringify(termos));
  const b = db.prepare("SELECT * FROM briefings WHERE token=?").get(token);

  const contrato = geraContratoDoOnboarding(b);
  assert.ok(contrato, "o contrato tinha de nascer");
  const salvo = db.prepare("SELECT * FROM contracts WHERE id=?").get(contrato.id);
  assert.ok(salvo.agency_signed_at, "a assinatura da casa entra no mesmo instante");
  assert.equal(salvo.agency_signer_name, "Katelyn dos Santos");
  assert.equal(salvo.agency_signature_img, "data:image/png;base64,AAA");
});

test("sem a bandeira, o contrato nasce em branco dos dois lados (como antes)", () => {
  const outro = db.prepare("INSERT INTO clients (org_id,name,status) VALUES (?,'Outro Cliente','active')").run(org).lastInsertRowid;
  db.prepare("INSERT INTO briefings (org_id,client_id,token,status,terms) VALUES (?,?,?,'respondido',?)")
    .run(org, outro, "tok-sem-assinar", JSON.stringify({ service_id: servico, value: 1000 }));
  const b = db.prepare("SELECT * FROM briefings WHERE token='tok-sem-assinar'").get();
  const contrato = geraContratoDoOnboarding(b);
  const salvo = db.prepare("SELECT agency_signed_at FROM contracts WHERE id=?").get(contrato.id);
  assert.equal(salvo.agency_signed_at, null);
});

test("a janela tem o botão de ver e o interruptor de assinar", () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const tela = readFileSync(join(raiz, "client/src/pages/Onboarding.jsx"), "utf8");
  assert.match(tela, /Ver contrato com os dados/);
  assert.match(tela, /Já deixar <b>assinado por mim<\/b>/);
  // A prévia usa as MESMAS folhas A4 da tela de assinatura: o que ela confere
  // aqui é o que o cliente vai ver lá.
  assert.match(tela, /<FolhasDoContrato texto=\{pronta\.corpo\}/);
});

test("a regra de assinar como a casa mora num lugar só", async () => {
  const { assinaComoCasa } = await import("../src/assinatura-da-casa.js");
  assert.equal(assinaComoCasa(org, 999999), "sem-contrato");
  const rotas = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/routes/contracts.js"), "utf8");
  assert.match(rotas, /assinaComoCasa\(req\.orgId, c\.id\)/,
    "a rota e o onboarding têm de chamar a mesma função — duas cópias divergem");
});
