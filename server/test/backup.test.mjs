import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const dir = mkdtempSync(join(tmpdir(), "pc-bkp-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { makeBackup } = await import("../src/backup.js");

test("o backup gera uma cópia consistente que 'restaura' com todos os dados", async () => {
  // grava um dado marcador
  db.prepare("INSERT INTO clients (name, status, org_id) VALUES (?, 'active', 1)").run("Cliente Restauração");

  // gera o backup (é o arquivo que se usaria para restaurar)
  const dest = join(dir, "restaurado.db");
  await makeBackup(dest);

  // "restaura": abre o arquivo como um banco novo e confere
  const restaurado = new Database(dest, { readonly: true });
  const achou = restaurado.prepare("SELECT name FROM clients WHERE name = ?").get("Cliente Restauração");
  assert.equal(achou?.name, "Cliente Restauração", "o dado deve estar na cópia restaurada");

  const nTabelas = restaurado.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n;
  assert.ok(nTabelas > 20, "a cópia deve conter o banco completo");
  restaurado.close();
});
