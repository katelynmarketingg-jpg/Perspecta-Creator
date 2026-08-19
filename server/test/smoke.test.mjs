import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Banco temporário e segredo de teste ANTES de importar o app.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "pc-test-")), "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, verifyPassword } = await import("../src/auth.js");

test("o banco sobe do zero e semeia o escritório master + admin", () => {
  const master = db.prepare("SELECT * FROM organizations WHERE is_master = 1").get();
  assert.ok(master, "deve existir o escritório master");
  const admin = db.prepare("SELECT * FROM users WHERE lower(username) = 'admin'").get();
  assert.ok(admin, "deve existir o usuário admin");
  assert.equal(admin.role, "superadmin");
});

test("senha-padrão '001' é marcada para troca obrigatória", () => {
  const admin = db.prepare("SELECT must_change_password FROM users WHERE lower(username) = 'admin'").get();
  assert.equal(admin.must_change_password, 1);
});

test("o escritório de trabalho nasce com as 6 etapas do kanban", () => {
  const persp = db.prepare("SELECT id FROM organizations WHERE name = 'Perspectiva'").get();
  const nomes = db.prepare("SELECT name FROM kanban_stages WHERE org_id = ? ORDER BY position").all(persp.id).map((s) => s.name);
  assert.deepEqual(nomes, ["Planejamento", "Captação", "Criação", "Distribuição", "Aprovação", "Programados"]);
});

test("hash e verificação de senha (bcrypt) funcionam", () => {
  const h = hashPassword("MinhaSenha#2026");
  assert.ok(h.startsWith("$2"), "deve ser um hash bcrypt");
  assert.equal(verifyPassword("MinhaSenha#2026", h), true);
  assert.equal(verifyPassword("errada", h), false);
});

test("e-mail de usuário é único (constraint do banco)", () => {
  const persp = db.prepare("SELECT id FROM organizations WHERE name = 'Perspectiva'").get();
  const ins = db.prepare("INSERT INTO users (name, username, email, password_hash, role, org_id) VALUES (?, ?, ?, ?, 'member', ?)");
  ins.run("A", "user_a", "dup@x.local", hashPassword("x1234"), persp.id);
  assert.throws(() => ins.run("B", "user_b", "dup@x.local", hashPassword("x1234"), persp.id));
});
