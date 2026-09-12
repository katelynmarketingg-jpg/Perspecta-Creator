// AUDITORIA DOS TERMOS TORTOS (Etapa 1: "Data invertida, valor com vírgula,
// quantidade negativa, quantidade com casa decimal — o que entra no banco?").
//
// Mandei tudo torto de propósito para um servidor rodando e li o contrato que
// saiu. Quatro coisas saíam erradas, todas caladas:
//
//   valor "1500,50"   ->  R$ 0,00 (zero real)      ← contrato de valor ZERO
//   fim antes início  ->  "prazo indeterminado"     ← contrato mensal sem prazo
//   quantidade 2.7    ->  "2.7 (dois) posts"        ← número brigando com o extenso
//   um mês só         ->  "01 (um) meses"           ← português
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-tortos-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { geraContrato, numeroBR } = await import("../src/contract-gen.js");
const { MODELO_REDES } = await import("../src/contract-model.js");

const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES ('Casa dos Tortos', 0)").run().lastInsertRowid;
db.prepare("UPDATE organizations SET document=?, address=?, city=?, signer_name=?, signer_document=? WHERE id=?")
  .run("11.222.333/0001-44", "Av. Central, 900", "Curitiba", "Katelyn", "123.456.789-09", org);
const tpl = db.prepare("INSERT INTO contract_templates (org_id, name, body) VALUES (?, ?, ?)")
  .run(org, MODELO_REDES.name, MODELO_REDES.body).lastInsertRowid;

let n = 0;
function clienteNovo() {
  const id = db.prepare("INSERT INTO clients (name, status, org_id) VALUES (?, 'active', ?)")
    .run(`Cliente ${++n}`, org).lastInsertRowid;
  db.prepare(`UPDATE clients SET legal_name=?, document=?, address=?, rep_name=?, rep_document=?, payment_day=? WHERE id=?`)
    .run("Torto LTDA", "12.345.678/0001-95", "Rua X, 1", "Fulano", "040.096.640-96", 10, id);
  return id;
}
const gera = (termos) => geraContrato(org, {
  template_id: tpl, client_id: clienteNovo(), contract_date: "2026-09-01",
  start_date: "2026-09-01", end_date: "2027-02-28", value: 1500, ...termos,
});

test("número escrito com vírgula é número — 1500,50 não é zero", () => {
  assert.equal(numeroBR("1500,50"), 1500.5);
  assert.equal(numeroBR("1.500,50"), 1500.5);
  assert.equal(numeroBR("R$ 1.500,00"), 1500);
  assert.equal(numeroBR("1500.50"), 1500.5);
  assert.equal(numeroBR(1500.5), 1500.5);
  assert.equal(numeroBR(""), 0);
  assert.equal(numeroBR("abacaxi"), 0);
});

test("valor digitado com vírgula NÃO vira contrato de valor zero", () => {
  const c = gera({ value: "1500,50" });
  assert.match(c.notes, /R\$ 1\.500,50/);
  assert.doesNotMatch(c.notes, /R\$ 0,00/, "era isso que saía: contrato de valor zero, calado");
  assert.equal(c.value, 1500.5);
});

test("vigência invertida avisa em vez de virar 'prazo indeterminado' calado", () => {
  const c = gera({ start_date: "2026-09-01", end_date: "2026-03-01" });
  assert.ok(c.faltando.some((f) => /invertida/.test(f)),
    `a agência precisa ser avisada; veio: ${JSON.stringify(c.faltando)}`);
});

test("quantidade com casa decimal não deixa o número brigar com o extenso", () => {
  const c = gera({ itens: [{ label: "Posts", unit: "post", quantidade: 2.7 }] });
  assert.doesNotMatch(c.notes, /2\.7|2,7/, "número quebrado não entra em contrato");
  assert.match(c.notes, /03 \(três\) posts/, "arredonda e o extenso acompanha");
});

test("quantidade negativa avisa a agência", () => {
  const c = gera({ itens: [{ label: "Posts", unit: "post", quantidade: -5 }] });
  assert.ok(c.faltando.some((f) => /negativa/.test(f)), JSON.stringify(c.faltando));
});

test("valor zero avisa a agência", () => {
  const c = gera({ value: 0 });
  assert.ok(c.faltando.includes("valor mensal"), JSON.stringify(c.faltando));
});

test("vigência de um mês só diz 'mês', não 'meses'", () => {
  const c = gera({ start_date: "2026-09-01", end_date: "2026-09-30" });
  assert.match(c.notes, /vigência de 01 \(um\) mês,/);
  assert.doesNotMatch(c.notes, /\(um\) meses/);
});

test("o caminho normal continua certo", () => {
  const c = gera({ itens: [{ label: "Posts", unit: "post", quantidade: 12 }] });
  assert.match(c.notes, /R\$ 1\.500,00 \(mil e quinhentos reais\)/);
  assert.match(c.notes, /vigência de 06 \(seis\) meses/);
  assert.match(c.notes, /12 \(doze\) posts/);
  assert.deepEqual(c.faltando, []);
});
