// AUDITORIA DO CONTRATO — os defeitos que saíram no documento de verdade e o
// que os impede de voltar. Cada teste aqui FALHA sem a sua correção.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-aud-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { MODELO_REDES } = await import("../src/contract-model.js");
const { geraContrato } = await import("../src/contract-gen.js");
const { dataExtenso } = await import("../src/receipts.js");

const org = db.prepare(
  `INSERT INTO organizations (name,is_master,document,address,city,signer_name,signer_document)
   VALUES ('Auditoria',0,'52622307000128','Rua Iraci, 93','Santo Antônio da Patrulha','Katelyn','040.096.640-96')`
).run().lastInsertRowid;
const tpl = db.prepare("INSERT INTO contract_templates (org_id,name,body) VALUES (?,?,?)")
  .run(org, "Modelo", MODELO_REDES.body).lastInsertRowid;

let seq = 0;
function contrato(dadosCliente, termos = {}) {
  const dados = { name: `Cliente ${++seq}`, status: "active", org_id: org, ...dadosCliente };
  const cols = Object.keys(dados);
  const cli = db.prepare(`INSERT INTO clients (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .run(...cols.map((k) => dados[k])).lastInsertRowid;
  return geraContrato(org, {
    template_id: tpl, client_id: cli, value: 1500,
    start_date: "2026-09-01", end_date: "2027-02-28", contract_date: "2026-08-20", ...termos,
  });
}

const COMPLETO = {
  legal_name: "MARCELO AUGUSTO RODRIGUES DE LEMOS SOCIEDADE INDIVIDUAL DE ADVOCACIA",
  document: "55514449000160", address: "Av. Borges de Medeiros, 500 — Porto Alegre/RS",
  rep_name: "Marcelo Augusto Rodrigues de Lemos", rep_document: "RS 98.765",
  rep_doc_type: "oab", payment_day: 10,
};

test("uma captação não sai como 'um real' — a moeda não pode vazar na quantidade", () => {
  const c = contrato(COMPLETO, { itens: [{ label: "Captações", quantidade: 1 }] });
  assert.ok(!/\(um real\)|\(uma real\)/.test(c.notes),
    `moeda vazou: ${(c.notes.match(/\(\w+ reais?\)/g) || []).join(", ")}`);
  assert.match(c.notes, /01 \(uma\) captação/, "e concorda no feminino: UMA captação");
});

test("duas captações concordam no feminino", () => {
  const c = contrato(COMPLETO, { itens: [{ label: "Captações", quantidade: 2 }] });
  assert.match(c.notes, /02 \(duas\) captações? presencia/);
});

test("a frase inteira concorda: um vídeo x dois vídeos", () => {
  const um = contrato(COMPLETO, { itens: [{ label: "Posts", quantidade: 1 }, { label: "Vídeos", quantidade: 1 }] });
  assert.match(um.notes, /01 \(um\) vídeo no formato Reels/);
  assert.match(um.notes, /01 \(um\) post estático e\/ou carrossel estratégico/);

  const varios = contrato(COMPLETO, { itens: [{ label: "Posts", quantidade: 4 }, { label: "Vídeos", quantidade: 4 }] });
  assert.match(varios.notes, /04 \(quatro\) vídeos no formato Reels/);
  assert.match(varios.notes, /04 \(quatro\) posts estáticos e\/ou carrosséis estratégicos/);
});

test("o verbo acompanha o número da captação", () => {
  const uma = contrato(COMPLETO, { itens: [{ label: "Captações", quantidade: 1 }] });
  assert.match(uma.notes, /será realizada 01 \(uma\) captação presencial ao mês/);
  const duas = contrato(COMPLETO, { itens: [{ label: "Captações", quantidade: 2 }] });
  assert.match(duas.notes, /serão realizadas 02 \(duas\) captações presenciais ao mês/);
});

test("o CNPJ do cliente sai pontuado, igual ao da agência", () => {
  const c = contrato(COMPLETO);
  assert.match(c.notes, /55\.514\.449\/0001-60/);
  assert.ok(!/55514449000160/.test(c.notes), "não pode sobrar o número cru em lugar nenhum");
});

test("o documento de quem assina também sai pontuado", () => {
  const c = contrato({ ...COMPLETO, rep_document: "04009664096", rep_doc_type: "cpf" });
  assert.match(c.notes, /040\.096\.640-96/);
});

test("pessoa física assina com CPF — o contrato não pode chamar de CNPJ", () => {
  const c = contrato({ name: "Ana Paula Souza", document: "04009664096", rep_name: "Ana Paula Souza",
    rep_document: "04009664096", rep_doc_type: "cpf", payment_day: 5, address: "Rua A, 1" });
  assert.match(c.notes, /inscrita no CPF sob o n\.º 040\.096\.640-96/);
  assert.ok(!/inscrita no CNPJ sob o n\.º 040/.test(c.notes));
});

test("o primeiro dia do mês se escreve 1º", () => {
  assert.equal(dataExtenso("2026-09-01"), "1º de setembro de 2026");
  assert.equal(dataExtenso("2026-09-02"), "2 de setembro de 2026");
  const c = contrato(COMPLETO);
  assert.match(c.notes, /iniciando-se em 1º de setembro de 2026/);
});

test("campo que falta vira LINHA para preencher, não frase quebrada", () => {
  const c = contrato({ name: "Só o nome" });
  const t = c.notes;
  assert.ok(!/sob o n\.º\s*,/.test(t), "CNPJ vazio deixava 'sob o n.º ,'");
  assert.ok(!/com sede em ,/.test(t), "endereço vazio deixava 'com sede em ,'");
  assert.ok(!/representada por ,/.test(t), "quem assina vazio deixava 'representada por ,'");
  assert.ok(!/até o dia\s+de cada mês/.test(t), "dia vazio deixava 'até o dia  de cada mês'");
  assert.match(t, /_{5,}/, "no lugar deles entra uma linha para preencher à mão");
});

test("o contrato AVISA o que saiu faltando — quem lê isso é advogado", () => {
  const c = contrato({ name: "Só o nome" });
  assert.ok(Array.isArray(c.faltando));
  for (const campo of ["CNPJ/CPF", "endereço", "quem assina", "dia do pagamento"]) {
    assert.ok(c.faltando.includes(campo), `faltou avisar sobre "${campo}": ${c.faltando.join(", ")}`);
  }
});

test("cadastro completo não gera aviso nenhum", () => {
  const c = contrato(COMPLETO);
  assert.deepEqual(c.faltando, []);
});

test("nenhum marcador sobra, em nenhum dos casos", () => {
  for (const dados of [COMPLETO, { name: "Só o nome" },
    { name: "PF", document: "04009664096", rep_name: "PF", rep_document: "04009664096", payment_day: 1, address: "R. B, 2" }]) {
    const t = contrato(dados).notes;
    const sobrando = [...new Set(t.match(/\{\{\s*[\wçãáéíóú]+\s*\}\}/gi) || [])];
    assert.deepEqual(sobrando, [], `sobrou marcador: ${sobrando.join(", ")}`);
  }
});

test("valor zero (permuta) não quebra o texto", () => {
  const c = contrato(COMPLETO, { value: 0 });
  assert.match(c.notes, /R\$ 0,00 \(zero real\)/);
  assert.ok(!/\(\s*\)/.test(c.notes), "não pode sobrar parêntese vazio");
});
