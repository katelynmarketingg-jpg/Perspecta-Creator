// AUDITORIA DA REGRA DE SENHA (Etapa 5 / Etapa 8).
//
// Estava ao contrário: o CLIENTE era obrigado a 6 caracteres, e a EQUIPE — que
// vê o financeiro, os contratos e as senhas de todos os clientes — podia trocar
// a própria senha por 3 caracteres ("abc"), e o admin podia criar gente com
// senha de UM caractere. Quem tem mais acesso tinha a regra mais frouxa.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-senha-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET, conferirSenha, SENHA_MINIMA } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const { default: authRoutes } = await import("../src/routes/auth.js");
const { default: usersRoutes } = await import("../src/routes/users.js");

const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES ('Casa das Senhas', 0)").run().lastInsertRowid;
const SENHA_ATUAL = "SenhaBoa#2026";
const admin = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katy','katy','k@s.com',?,'admin',1,?)"
).run(hashPassword(SENHA_ATUAL), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}`;
const H = { authorization: `Bearer ${jwt.sign({ id: admin }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

const post = (r, c) => fetch(B + r, { method: "POST", headers: H, body: JSON.stringify(c) });
const put = (r, c) => fetch(B + r, { method: "PUT", headers: H, body: JSON.stringify(c) });

test("a regra é a mesma para a casa inteira, e é no mínimo 6", () => {
  assert.ok(SENHA_MINIMA >= 6, "a equipe não pode ter regra mais frouxa que o cliente");
  assert.equal(conferirSenha("SenhaBoa#2026"), null);
  assert.ok(conferirSenha("abc"), "senha de 3 caracteres tem que ser recusada");
  assert.ok(conferirSenha(""), "senha vazia tem que ser recusada");
  assert.ok(conferirSenha("      "), "senha só de espaços tem que ser recusada");
});

test("trocar a própria senha por 'abc' é recusado", async () => {
  const r = await put("/api/auth/password", { current_password: SENHA_ATUAL, new_password: "abc" });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /6 caracteres/);
});

test("trocar por uma senha de verdade funciona", async () => {
  const r = await put("/api/auth/password", { current_password: SENHA_ATUAL, new_password: "OutraBoa#77" });
  assert.equal(r.status, 200, JSON.stringify(await r.json().catch(() => null)));
  // devolve para não atrapalhar os testes seguintes
  await put("/api/auth/password", { current_password: "OutraBoa#77", new_password: SENHA_ATUAL });
});

test("admin não consegue criar gente com senha de um caractere", async () => {
  const r = await post("/api/users", { name: "Estagiário", username: "estag", password: "1" });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /6 caracteres/);
});

test("admin cria gente com senha de verdade", async () => {
  const r = await post("/api/users", { name: "Ana", username: "ana", password: "AnaSegura#1" });
  assert.equal(r.status, 201, JSON.stringify(await r.json().catch(() => null)));
});

test("admin não consegue REBAIXAR a senha de alguém depois", async () => {
  const criado = await (await post("/api/users", { name: "Bia", username: "bia", password: "BiaSegura#1" })).json();
  const r = await put(`/api/users/${criado.id}`, { password: "123" });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /6 caracteres/);
});

test("editar um usuário SEM mexer na senha continua funcionando", async () => {
  const criado = await (await post("/api/users", { name: "Caio", username: "caio", password: "CaioSeguro#1" })).json();
  const r = await put(`/api/users/${criado.id}`, { name: "Caio Silva" });
  assert.equal(r.status, 200, "não pode exigir senha em toda edição");
  assert.equal((await r.json()).name, "Caio Silva");
});
