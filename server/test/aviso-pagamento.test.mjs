// O aviso "você tem X pagamentos em aberto" na área do cliente tem que
// acompanhar a realidade: marcou a mensalidade como paga, o aviso some.
// Antes ele ficava gravado para sempre — o cliente via "em aberto" semanas
// depois de ter pago.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-avi-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { remindOverdue, sincronizaAvisoDeAberto, quantasEmAberto } = await import("../src/overdue.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const financial = (await import("../src/routes/financial.js")).default;

const org = db.prepare("INSERT INTO organizations (name, is_master) VALUES ('Casa do Aviso', 0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@aviso.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/financial", financial);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/financial`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

const novoCliente = (nome) =>
  db.prepare("INSERT INTO clients (name,status,org_id) VALUES (?, 'active', ?)").run(nome, org).lastInsertRowid;

/** Uma mensalidade vencida (ontem), ainda pendente. */
const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const cobranca = (clientId, desc, vencimento = ontem, status = "pending") => db.prepare(
  `INSERT INTO financial_entries (type, description, amount, client_id, category, status, due_date, org_id)
   VALUES ('income', ?, 1500, ?, 'Mensalidade', ?, ?, ?)`
).run(desc, clientId, status, vencimento, org).lastInsertRowid;

const avisosDoCliente = (clientId) => db.prepare(
  "SELECT message FROM notifications WHERE org_id = ? AND client_id = ? AND audience = 'client' AND is_read = 0"
).all(org, clientId).map((r) => r.message);

test("vencida e não paga: o cliente é avisado, uma vez só", () => {
  const c = novoCliente("Atrasado");
  cobranca(c, "Mensalidade de agosto");
  remindOverdue(org, c);
  const avisos = avisosDoCliente(c).filter((m) => /em aberto/.test(m));
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /1 pagamento em aberto/);
});

test("marcou como paga pelo sistema: o aviso some na hora", async () => {
  const c = novoCliente("Pagou certinho");
  const id = cobranca(c, "Mensalidade de setembro");
  remindOverdue(org, c);
  assert.equal(avisosDoCliente(c).filter((m) => /em aberto/.test(m)).length, 1, "primeiro o aviso existe");

  const r = await fetch(`${B}/${id}`, { method: "PUT", headers: H, body: JSON.stringify({ status: "paid" }) });
  assert.equal(r.status, 200);
  assert.deepEqual(avisosDoCliente(c).filter((m) => /em aberto/.test(m)), [],
    "depois de paga, não pode sobrar aviso nenhum");
});

test("aviso antigo, de antes desta correção, some ao abrir as notificações", () => {
  const c = novoCliente("Ficou preso no aviso");
  const id = cobranca(c, "Mensalidade de julho");
  remindOverdue(org, c);
  // Pago por fora (direto no banco, como aconteceu antes da correção existir).
  db.prepare("UPDATE financial_entries SET status='paid', paid_at=datetime('now') WHERE id=?").run(id);
  assert.equal(avisosDoCliente(c).filter((m) => /em aberto/.test(m)).length, 1, "o aviso velho ainda está lá");

  remindOverdue(org, c);   // é o que roda quando alguém abre as notificações
  assert.deepEqual(avisosDoCliente(c).filter((m) => /em aberto/.test(m)), [], "tem que se consertar sozinho");
});

test("pagou uma de duas: a contagem cai para 1, não some inteira", async () => {
  const c = novoCliente("Duas em aberto");
  const a = cobranca(c, "Mensalidade de junho");
  cobranca(c, "Mensalidade de julho");
  remindOverdue(org, c);
  assert.match(avisosDoCliente(c).find((m) => /em aberto/.test(m)), /2 pagamentos em aberto/);

  await fetch(`${B}/${a}`, { method: "PUT", headers: H, body: JSON.stringify({ status: "paid" }) });
  assert.match(avisosDoCliente(c).find((m) => /em aberto/.test(m)), /1 pagamento em aberto/);
});

test("pagamento PARCIAL continua em aberto — não é quitado", async () => {
  const c = novoCliente("Pagou metade");
  const id = cobranca(c, "Mensalidade rachada");
  await fetch(`${B}/${id}`, { method: "PUT", headers: H, body: JSON.stringify({ paid_amount: 700 }) });
  assert.equal(quantasEmAberto(org, c), 1, "meia mensalidade não quita a cobrança");
  sincronizaAvisoDeAberto(org, c);
  assert.match(avisosDoCliente(c).find((m) => /em aberto/.test(m)), /1 pagamento em aberto/);
});

test("cobrança que ainda vai vencer não vira aviso", () => {
  const c = novoCliente("Em dia");
  const amanha = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  cobranca(c, "Mensalidade de outubro", amanha);
  remindOverdue(org, c);
  assert.deepEqual(avisosDoCliente(c).filter((m) => /em aberto/.test(m)), []);
});

test("apagar o lançamento também tira o aviso", async () => {
  const c = novoCliente("Lançamento errado");
  const id = cobranca(c, "Cobrança lançada por engano");
  remindOverdue(org, c);
  assert.equal(avisosDoCliente(c).filter((m) => /em aberto/.test(m)).length, 1);

  await fetch(`${B}/${id}`, { method: "DELETE", headers: H });
  assert.deepEqual(avisosDoCliente(c).filter((m) => /em aberto/.test(m)), []);
});

test("um aviso já LIDO pelo cliente não é mexido", () => {
  const c = novoCliente("Já leu");
  cobranca(c, "Mensalidade lida");
  remindOverdue(org, c);
  db.prepare("UPDATE notifications SET is_read = 1 WHERE client_id = ? AND audience = 'client'").run(c);
  sincronizaAvisoDeAberto(org, c);
  const lidos = db.prepare(
    "SELECT COUNT(*) n FROM notifications WHERE client_id = ? AND audience = 'client' AND is_read = 1"
  ).get(c).n;
  assert.ok(lidos >= 1, "o histórico do que ele já leu continua lá");
});
