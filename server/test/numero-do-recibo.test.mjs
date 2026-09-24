// O NÚMERO DO RECIBO: 0003/09/2026
//
// Era "0003/2026". Palavras dela: "essa coisa de baixar recibo 0003/2026, não
// entendi, quero que seja mês e ano". O 0003 sozinho não diz de quando o
// recibo é — e é isso que se procura ao achar um papel guardado.
//
// O mês entra no meio. A sequência continua sendo do ANO: renumerar por mês
// faria o "0001" existir várias vezes no mesmo ano, e recibo não repete número.
// E recibo já emitido NÃO se renumera: o número que o cliente recebeu vale.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-recibo-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { formataNumero, ensureReceiptForEntry } = await import("../src/receipts.js");

test("o número mostra o mês e o ano", () => {
  assert.equal(formataNumero(3, 2026, 9), "0003/09/2026");
  assert.equal(formataNumero(12, 2026, 12), "0012/12/2026");
  assert.equal(formataNumero(1, 2027, 1), "0001/01/2027");
});

test("sem mês, continua o formato antigo — é o dos já emitidos", () => {
  assert.equal(formataNumero(3, 2026), "0003/2026");
  assert.equal(formataNumero(3, 2026, null), "0003/2026");
});

const org = db.prepare("INSERT INTO organizations (name,is_master,city) VALUES ('Casa dos Recibos',0,'Curitiba')").run().lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Fulano','active',?)").run(org).lastInsertRowid;
const lancar = (desc, valor, pagoEm) => db.prepare(
  `INSERT INTO financial_entries (org_id, type, description, amount, client_id, category, status, due_date, paid_at)
   VALUES (?, 'income', ?, ?, ?, 'Mensalidade', 'paid', ?, ?)`
).run(org, desc, valor, cli, pagoEm, pagoEm).lastInsertRowid;

test("o recibo emitido sai com mês e ano, e guarda o mês", () => {
  const r = ensureReceiptForEntry(lancar("Mensalidade — Setembro", 1000, "2026-09-10"));
  assert.equal(r.number, "0001/09/2026");
  assert.equal(r.year, 2026);
  assert.equal(r.month, 9);
  assert.equal(r.seq, 1);
});

test("a sequência é do ano: outubro continua de onde setembro parou", () => {
  const r = ensureReceiptForEntry(lancar("Mensalidade — Outubro", 1000, "2026-10-10"));
  assert.equal(r.number, "0002/10/2026", "o 0002 não volta a ser 0001 só porque virou o mês");
  assert.equal(r.month, 10);
});

test("ano novo recomeça a contagem", () => {
  const r = ensureReceiptForEntry(lancar("Mensalidade — Janeiro", 1000, "2027-01-10"));
  assert.equal(r.number, "0001/01/2027");
});

test("emitir duas vezes o mesmo lançamento não gera outro número", () => {
  const entry = lancar("Mensalidade — Novembro", 1000, "2026-11-10");
  const a = ensureReceiptForEntry(entry);
  const b = ensureReceiptForEntry(entry);
  assert.equal(a.id, b.id);
  assert.equal(a.number, b.number);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM receipts WHERE entry_id = ?").get(entry).c, 1);
});

test("recibo já emitido no formato antigo continua com o número dele", () => {
  // O cliente já recebeu esse papel: renumerar seria trocar um documento.
  const entry = lancar("Mensalidade — Agosto", 1000, "2026-08-10");
  db.prepare(
    `INSERT INTO receipts (org_id, entry_id, client_id, status, number, year, month, seq, amount)
     VALUES (?, ?, ?, 'issued', '0009/2026', 2026, NULL, 9, 1000)`
  ).run(org, entry, cli);
  assert.equal(ensureReceiptForEntry(entry).number, "0009/2026", "o papel que o cliente já tem continua valendo");
});

after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
