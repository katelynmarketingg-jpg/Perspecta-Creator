// O contrato pronto: sai preenchido, sem marcador sobrando, e com as cláusulas
// que protegem a agência.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-ct-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { MODELO_REDES } = await import("../src/contract-model.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const rotas = (await import("../src/routes/contract-templates.js")).default;

const org = db.prepare(
  `INSERT INTO organizations (name, is_master, document, address, city, signer_name, signer_document, signer_role)
   VALUES ('Agência Perspecta', 0, '51234567000188', 'Av. Ipiranga, 100', 'Porto Alegre', 'Katelyn', '012.345.678-90', 'Sócia')`
).run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@x.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cliente = db.prepare(
  `INSERT INTO clients (name, company, legal_name, document, address, email, phone, segment,
     rep_name, rep_document, rep_doc_type, payment_day, status, org_id)
   VALUES ('KN','KN','KN ADVOCACIA LTDA','19.131.243/0001-97','Rua dos Andradas, 1234',
           'fin@kn.com.br','51 99999-0000','Advocacia','Karen Nunes','RS 123.456','oab',10,'active',?)`
).run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/contract-templates", rotas);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/contract-templates`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

const modelo = await (await fetch(`${B}/pronto`, { method: "POST", headers: H })).json();
const contrato = await (await fetch(`${B}/${modelo.id}/generate`, {
  method: "POST", headers: H,
  body: JSON.stringify({ client_id: cliente, value: 12500, duration_months: 12, start_date: "2026-10-01" }),
})).json();

test("o modelo pronto traz as cláusulas que protegem a agência", () => {
  const c = MODELO_REDES.body;
  // A que a Katelyn pediu: resultado não é garantido.
  assert.match(c, /é de MEIO, e não de resultado/);
  assert.match(c, /NÃO GARANTE resultados específicos/);
  assert.match(c, /não ensejando devolução de valores/);
  // As outras que seguram o dia a dia.
  assert.match(c, /TACITAMENTE APROVADO/, "aprovação tácita");
  assert.match(c, /manter a CONTRATADA indene/, "material do cliente é responsabilidade dele");
  assert.match(c, /limitada ao valor efetivamente pago/, "teto de responsabilidade");
  assert.match(c, /poderá suspender a execução dos serviços/, "suspensão por atraso");
  assert.match(c, /Lei n\.º 13\.709\/2018/, "LGPD");
  assert.match(c, /elegendo-se o \{\{foro\}\}/, "foro");
});

test("nenhum marcador fica vazio no contrato gerado", () => {
  assert.equal(contrato.notes.match(/\{\{\w+\}\}/g), null,
    `sobrou: ${contrato.notes.match(/\{\{\w+\}\}/g)}`);
});

test("os dois lados aparecem identificados", () => {
  assert.match(contrato.notes, /CONTRATADA: Agência Perspecta, inscrita no CNPJ sob o n\.º 51\.234\.567\/0001-88/);
  assert.match(contrato.notes, /CONTRATANTE: KN ADVOCACIA LTDA, inscrita no CNPJ sob o n\.º 19\.131\.243\/0001-97/);
  assert.match(contrato.notes, /representada por Karen Nunes, brasileiro\(a\), inscrito\(a\) na OAB sob o n\.º RS 123\.456/);
});

test("valor com separador de milhar e por extenso", () => {
  assert.match(contrato.notes, /R\$ 12\.500,00 \(doze mil e quinhentos reais\)/,
    "num contrato, 'R$ 12500,00' fica errado");
  assert.match(contrato.notes, /até o dia 10 de cada mês, por meio de PIX/);
});

test("prazo, foro e cidade vêm dos dados da agência", () => {
  assert.match(contrato.notes, /terá vigência de 12 \(doze\) meses/);
  assert.match(contrato.notes, /iniciando-se em 1 de outubro de 2026/);
  assert.match(contrato.notes, /foro da comarca de Porto Alegre/);
  assert.match(contrato.notes, /^Porto Alegre, \d+ de \w+ de \d{4}\./m);
});
