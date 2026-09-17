// QUEM JÁ TINHA SIDO ARQUIVADO NÃO PODE PERDER A DATA.
//
// Uma versão anterior guardava o encerramento de outro jeito: status 'archived'
// e o mês do último pagamento em `last_payment_month`. A versão de hoje usa
// status 'inactive' e `pagamento_ate` — que é o campo que o Financeiro lê para
// saber até quando aquele cliente ainda entra na mensalidade.
//
// Se a troca fosse feita sem migrar, todo cliente já arquivado por ela sumiria
// do Financeiro e a data combinada viraria nada. Este teste garante que, ao
// abrir o banco, o que já estava gravado é trazido para os campos de hoje.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "pc-migrar-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Antiga',0)").run().lastInsertRowid;

// Como ficava um cliente arquivado pela versão anterior.
const antigo = db.prepare(
  `INSERT INTO clients (org_id, name, status, archived_at, last_payment_month)
   VALUES (?, 'Padaria do Zé', 'archived', '2026-08-01T10:00:00.000Z', '2026-09')`
).run(org).lastInsertRowid;

// E um que já foi arquivado pela versão de hoje: a migração não pode mexer nele.
const novo = db.prepare(
  `INSERT INTO clients (org_id, name, status, archived_at, pagamento_ate, last_payment_month)
   VALUES (?, 'Lava-jato Aurora', 'inactive', '2026-09-01T10:00:00.000Z', '2026-11', '2026-07')`
).run(org).lastInsertRowid;

// Abrir o banco de novo é o que dispara a migração.
execFileSync(process.execPath, ["-e", "import('./server/src/db.js')"], {
  cwd: join(import.meta.dirname, "..", ".."),
  env: { ...process.env },
});

test("cliente arquivado na versão antiga mantém a data do último pagamento", () => {
  const c = db.prepare("SELECT status, pagamento_ate FROM clients WHERE id = ?").get(antigo);
  assert.equal(c.pagamento_ate, "2026-09");
  assert.equal(c.status, "inactive");
});

test("quem já estava no formato de hoje não é sobrescrito", () => {
  const c = db.prepare("SELECT status, pagamento_ate FROM clients WHERE id = ?").get(novo);
  assert.equal(c.pagamento_ate, "2026-11");
  assert.equal(c.status, "inactive");
});

after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
