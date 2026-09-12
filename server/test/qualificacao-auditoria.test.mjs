// AUDITORIA DA QUALIFICAÇÃO DAS PARTES (Etapa 3 — "leia o contrato inteiro,
// como um advogado leria").
//
// Dois achados de uma leitura do texto gerado, ponta a ponta:
//
// 1. "inscrito(a) na CPF sob o n.º ..." — o "na" estava fixo no modelo, porque
//    servia para "na OAB". Com CPF ou CNPJ vira erro de português, na primeira
//    frase do contrato, onde o advogado do outro lado começa a ler.
//
// 2. A qualificação da PRÓPRIA AGÊNCIA saía em branco e ninguém era avisado:
//    "inscrita no CNPJ sob o n.º , com sede em , neste ato representada por sua
//    titular, , brasileira, portadora do CPF n.º ." A conferência de dados
//    faltando só olhava o cliente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-qualif-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { geraContrato } = await import("../src/contract-gen.js");
const { MODELO_REDES } = await import("../src/contract-model.js");

function casa(nome, dadosDaCasa = {}) {
  const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES (?, 0)").run(nome).lastInsertRowid;
  db.prepare("UPDATE organizations SET document=?, address=?, city=?, signer_name=?, signer_document=? WHERE id=?")
    .run(dadosDaCasa.document ?? null, dadosDaCasa.address ?? null, dadosDaCasa.city ?? null,
         dadosDaCasa.signer_name ?? null, dadosDaCasa.signer_document ?? null, org);
  const tpl = db.prepare("INSERT INTO contract_templates (org_id, name, body) VALUES (?, ?, ?)")
    .run(org, MODELO_REDES.name, MODELO_REDES.body).lastInsertRowid;
  return { org, tpl };
}

function cliente(org, extra = {}) {
  const id = db.prepare("INSERT INTO clients (name, status, org_id) VALUES ('Marcelo','active',?)").run(org).lastInsertRowid;
  const campos = {
    legal_name: "Marcelo Advocacia LTDA", document: "12.345.678/0001-95",
    address: "Rua das Flores, 10 — Curitiba/PR", rep_name: "Marcelo Silva",
    rep_document: "040.096.640-96", rep_doc_type: "cpf", payment_day: 10, ...extra,
  };
  for (const [k, v] of Object.entries(campos)) {
    db.prepare(`UPDATE clients SET ${k} = ? WHERE id = ?`).run(v, id);
  }
  return id;
}

const TERMOS = (tpl, client_id) => ({
  template_id: tpl, client_id, value: 1500,
  start_date: "2026-09-01", end_date: "2027-02-28", contract_date: "2026-09-01",
  itens: [{ label: "Posts", unit: "post", quantidade: 12 },
          { label: "Vídeos", unit: "vídeo", quantidade: 4 },
          { label: "Captações", unit: "captação", quantidade: 2 }],
});

const DA_CASA = { document: "11.222.333/0001-44", address: "Av. Central, 900 — Curitiba/PR",
                  city: "Curitiba", signer_name: "Katelyn", signer_document: "123.456.789-09" };

test("representante com CPF: o contrato diz 'no CPF', não 'na CPF'", () => {
  const { org, tpl } = casa("Casa do CPF", DA_CASA);
  const c = geraContrato(org, TERMOS(tpl, cliente(org)));
  assert.match(c.notes, /inscrito\(a\) no CPF sob o n\.º 040\.096\.640-96/);
  assert.doesNotMatch(c.notes, /na CPF/, "erro de português na primeira frase do contrato");
});

test("representante com OAB: o contrato diz 'na OAB'", () => {
  const { org, tpl } = casa("Casa da OAB", DA_CASA);
  const id = cliente(org, { rep_doc_type: "oab", rep_document: "OAB/PR 123.456" });
  const c = geraContrato(org, TERMOS(tpl, id));
  assert.match(c.notes, /inscrito\(a\) na OAB sob o n\.º/);
  assert.doesNotMatch(c.notes, /no OAB/);
});

test("a casa com tudo preenchido: nada falta e a qualificação dela sai inteira", () => {
  const { org, tpl } = casa("Casa Completa", DA_CASA);
  const c = geraContrato(org, TERMOS(tpl, cliente(org)));
  assert.deepEqual(c.faltando, []);
  assert.match(c.notes, /CONTRATADA: Casa Completa, inscrita no CNPJ sob o n\.º 11\.222\.333\/0001-44/);
  assert.match(c.notes, /com sede em Av\. Central, 900/);
  assert.match(c.notes, /portadora do CPF n\.º 123\.456\.789-09/);
});

test("a casa SEM os dados dela é avisada — não sai contrato em branco calado", () => {
  const { org, tpl } = casa("Casa Vazia");   // nada preenchido em Configurações
  const c = geraContrato(org, TERMOS(tpl, cliente(org)));
  for (const esperado of ["CNPJ da agência", "endereço da agência",
                          "quem assina pela agência", "documento de quem assina pela agência",
                          "cidade da agência (para o foro)"]) {
    assert.ok(c.faltando.includes(esperado), `faltou avisar: ${esperado}`);
  }
});

test("dado que falta vira linha para preencher à mão, não some da frase", () => {
  const { org, tpl } = casa("Casa Sem CNPJ", { ...DA_CASA, document: null });
  const c = geraContrato(org, TERMOS(tpl, cliente(org)));
  assert.doesNotMatch(c.notes, /inscrita no CNPJ sob o n\.º ,/,
    "sem o CNPJ a frase ficava com uma vírgula solta no lugar do número");
  assert.match(c.notes, /inscrita no CNPJ sob o n\.º _+/);
});

test("nenhum marcador sobra no contrato da casa completa", () => {
  const { org, tpl } = casa("Casa Limpa", DA_CASA);
  const c = geraContrato(org, TERMOS(tpl, cliente(org)));
  assert.equal((c.notes.match(/\{\{\w+\}\}/) || [])[0], undefined);
});
