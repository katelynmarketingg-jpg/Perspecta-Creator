// "COLOQUEI QUE O ÚLTIMO PAGAMENTO SERIA SETEMBRO E NÃO APARECEU"
//
// Natural Light, Drums, Afeto e Camila: ela encerrou os quatro, combinou que
// setembro era o último mês cobrado, e a mensalidade de setembro não saiu.
//
// A causa: o "último pagamento" só era lido quando o cliente tinha a data de
// arquivamento preenchida. Quem ficou inativo por outro caminho — editando o
// status na ficha, ou pela migração dos clientes arquivados na versão antiga —
// batia antes na regra "cliente inativo" e a data combinada nem era olhada.
//
// Agora vale o contrário: se tem último pagamento combinado, ele manda. É o
// campo mais específico e é o que ela preencheu de propósito.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-mens-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const financialRoutes = (await import("../src/routes/financial.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa das Mensalidades',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','k','k@p.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const servico = db.prepare("INSERT INTO services (name, default_price, org_id) VALUES ('Gestão', 1000, ?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/financial", financialRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/financial`;
const auth = { "content-type": "application/json",
               authorization: `Bearer ${jwt.sign({ id: uid, org_id: org, role: "admin" }, JWT_SECRET)}` };
const gerar = (mes) => fetch(`${B}/generate-monthly`, {
  method: "POST", headers: auth, body: JSON.stringify({ month: mes }) });

// Cria um cliente com mensalidade e devolve o id.
function cliente(nome, campos = {}) {
  const colunas = { status: "active", archived_at: null, pagamento_ate: null, work_end: null, ...campos };
  const id = db.prepare(
    `INSERT INTO clients (name, status, org_id, payment_day, archived_at, pagamento_ate, work_end)
     VALUES (?, ?, ?, 10, ?, ?, ?)`
  ).run(nome, colunas.status, org, colunas.archived_at, colunas.pagamento_ate, colunas.work_end).lastInsertRowid;
  db.prepare("INSERT INTO client_services (client_id, service_id, price) VALUES (?, ?, 1000)").run(id, servico);
  return id;
}
const lancadas = (mes) => db.prepare(
  `SELECT description FROM financial_entries
    WHERE org_id=? AND category='Mensalidade' AND strftime('%Y-%m', due_date)=? ORDER BY description`
).all(org, mes).map((r) => r.description);

test("inativado SEM data de arquivamento, mas com último pagamento: entra", async () => {
  // O caminho dela: o cliente ficou inativo pela ficha ou pela migração antiga,
  // então archived_at está vazio — mas o último pagamento foi combinado.
  cliente("Natural Light", { status: "inactive", pagamento_ate: "2026-09-30" });
  cliente("Drums", { status: "inactive", pagamento_ate: "2026-09-30" });

  const r = await (await gerar("2026-09")).json();
  assert.equal(r.created, 2, "as duas mensalidades de setembro saem");
  assert.deepEqual(lancadas("2026-09"), ["Mensalidade — Drums", "Mensalidade — Natural Light"]);
});

test("e param depois do mês combinado", async () => {
  await gerar("2026-10");
  assert.deepEqual(lancadas("2026-10"), [], "outubro não cobra mais");

  const r = await (await gerar("2026-10")).json();
  const motivos = r.fora.filter((f) => ["Natural Light", "Drums"].includes(f.cliente));
  assert.equal(motivos.length, 2);
  assert.ok(motivos.every((m) => /último pagamento em 2026-09/.test(m.motivo)), JSON.stringify(motivos));
});

test("arquivado pelo botão continua funcionando igual", async () => {
  cliente("Afeto", { status: "inactive", archived_at: "2026-09-20T10:00:00Z", pagamento_ate: "2026-09-30" });
  await gerar("2026-09");
  assert.ok(lancadas("2026-09").includes("Mensalidade — Afeto"));
});

test("inativo SEM último pagamento continua fora, com o motivo certo", async () => {
  cliente("Camila", { status: "inactive" });
  const r = await (await gerar("2026-09")).json();
  const c = r.fora.find((f) => f.cliente === "Camila");
  assert.equal(c.motivo, "cliente inativo");
  assert.ok(!lancadas("2026-09").includes("Mensalidade — Camila"));
});

test("arquivado sem último pagamento diz isso, não 'cliente inativo'", async () => {
  cliente("Sem Data", { status: "inactive", archived_at: "2026-08-01T10:00:00Z" });
  const r = await (await gerar("2026-09")).json();
  assert.equal(r.fora.find((f) => f.cliente === "Sem Data").motivo,
    "cliente arquivado (sem último pagamento definido)");
});

test("o fim de contrato continua mandando quando é anterior", async () => {
  cliente("Contrato Curto", { status: "inactive", pagamento_ate: "2026-12-31", work_end: "2026-07-31" });
  const r = await (await gerar("2026-09")).json();
  assert.match(r.fora.find((f) => f.cliente === "Contrato Curto").motivo, /contrato encerrou em 2026-07/);
});

test("a migração traz a data de quem foi arquivado na versão antiga", async () => {
  // Aquela versão guardava o último pagamento em `last_payment_month` e nem
  // sempre preenchia `archived_at`. A cópia exigia `archived_at` e deixava
  // esses para trás — a data existia no banco e não valia para nada.
  const id = cliente("Grãos", { status: "inactive" });
  db.prepare("UPDATE clients SET last_payment_month = '2026-09-30', pagamento_ate = NULL WHERE id = ?").run(id);

  // Simula a subida seguinte rodando a mesma cópia da migração.
  db.prepare(
    `UPDATE clients SET pagamento_ate = last_payment_month
      WHERE (pagamento_ate IS NULL OR pagamento_ate = '')
        AND last_payment_month IS NOT NULL AND last_payment_month <> ''`
  ).run();

  assert.equal(db.prepare("SELECT pagamento_ate FROM clients WHERE id=?").get(id).pagamento_ate, "2026-09-30");
  await gerar("2026-09");
  assert.ok(lancadas("2026-09").includes("Mensalidade — Grãos"), "e aí a mensalidade sai");
});

after(() => { srv.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
