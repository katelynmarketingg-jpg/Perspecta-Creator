// AUDITORIA: O ID QUE VIAJA NO CORPO DO PEDIDO.
//
// A varredura de vazamento troca o :id do ENDEREÇO e não achou furo em 69
// rotas. O ponto cego era o id que vai no CORPO — e ali havia furo de verdade.
//
// Medido antes de corrigir, com duas agências: a agência A criava tarefa,
// cobrança e projeto amarrados ao CLIENTE da agência B, e o pedido respondia
// 201. Não era dado parado num canto do banco:
//
//   - a COBRANÇA aparecia na Área do Cliente da agência B, como se fosse dela
//     — uma fatura plantada na tela do cliente de outra pessoa;
//   - o conteúdo aparecia no feed daquele cliente;
//   - e o NOME do cliente da agência B voltava na listagem de quem plantou.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-corpo-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;

const app = express();
app.use(express.json());
for (const k of ["tasks", "financial", "projects", "events", "contracts", "portal"]) {
  app.use(`/api/${k}`, (await import(`../src/routes/${k}.js`)).default);
}
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
after(() => srv.close());

function monta(nome, usuario) {
  const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES (?,0)").run(nome).lastInsertRowid;
  const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES (?,?,?,?,'admin',1,?)")
    .run(nome, nome, `${nome}@x.com`, hashPassword("SenhaBoa#1"), org).lastInsertRowid;
  const cli = db.prepare("INSERT INTO clients (name,status,org_id,portal_username,portal_password_hash) VALUES (?,'active',?,?,?)")
    .run(`SEGREDO-CLIENTE-${nome}`, org, usuario, hashPassword("segredo123")).lastInsertRowid;
  return { org, cli, H: { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" } };
}
const A = monta("AgenciaA", "ua");
const V = monta("AgenciaB", "ub");

const cria = (rota, corpo, H) => fetch(B + rota, { method: "POST", headers: H, body: JSON.stringify(corpo) });

test("não dá para criar TAREFA no cliente de outra agência", async () => {
  const r = await cria("/tasks", { title: "Tarefa plantada", client_id: V.cli }, A.H);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /não é desta agência/);
});

test("não dá para criar COBRANÇA no cliente de outra agência", async () => {
  const r = await cria("/financial", { type: "income", description: "Fatura plantada", amount: 999, client_id: V.cli }, A.H);
  assert.equal(r.status, 400, "era 201: a fatura ia parar na tela do cliente da outra agência");
});

test("nem PROJETO, nem EVENTO, nem CONTRATO", async () => {
  assert.equal((await cria("/projects", { name: "P", client_id: V.cli }, A.H)).status, 400);
  assert.equal((await cria("/events", { title: "E", start_at: "2026-10-01 10:00", client_id: V.cli }, A.H)).status, 400);
  assert.equal((await cria("/contracts", { title: "C", value: 1, client_id: V.cli }, A.H)).status, 400);
});

test("nada plantado chega na Área do Cliente da outra agência", async () => {
  const pt = (await (await fetch(`${B}/portal/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ub", password: "segredo123" }),
  })).json()).token;
  const P = { authorization: `Bearer ${pt}` };
  for (const rota of ["/portal/payments", "/portal/approvals", "/portal/feed"]) {
    const txt = await (await fetch(B + rota, { headers: P })).text();
    assert.ok(!/plantad/i.test(txt), `apareceu em ${rota}: ${txt.slice(0, 200)}`);
  }
});

test("o nome do cliente da outra agência não volta na listagem de quem tentou", async () => {
  for (const rota of ["/tasks", "/financial", "/projects"]) {
    const txt = await (await fetch(B + rota, { headers: A.H })).text();
    assert.ok(!txt.includes("SEGREDO-CLIENTE-AgenciaB"), `vazou o nome em ${rota}`);
  }
});

test("EDITAR também não reaponta para o cliente da outra agência", async () => {
  const minha = await (await cria("/tasks", { title: "Minha tarefa", client_id: A.cli }, A.H)).json();
  const r = await fetch(`${B}/tasks/${minha.id}`, { method: "PUT", headers: A.H, body: JSON.stringify({ client_id: V.cli }) });
  assert.equal(r.status, 400, "criar era barrado mas editar reabria a mesma porta");
  assert.equal(db.prepare("SELECT client_id FROM tasks WHERE id=?").get(minha.id).client_id, A.cli);
});

test("com o PRÓPRIO cliente, tudo continua funcionando", async () => {
  assert.equal((await cria("/tasks", { title: "Tarefa normal", client_id: A.cli }, A.H)).status, 201);
  assert.equal((await cria("/financial", { type: "income", description: "Mensalidade", amount: 1500, client_id: A.cli }, A.H)).status, 201);
  assert.equal((await cria("/projects", { name: "Projeto normal", client_id: A.cli }, A.H)).status, 201);
});

test("sem cliente nenhum também continua funcionando", async () => {
  assert.equal((await cria("/tasks", { title: "Tarefa interna" }, A.H)).status, 201);
  assert.equal((await cria("/financial", { type: "expense", description: "Aluguel", amount: 100 }, A.H)).status, 201);
});
