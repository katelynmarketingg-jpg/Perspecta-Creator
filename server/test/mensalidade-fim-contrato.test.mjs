// "COLOQUEI QUE O ÚLTIMO MÊS É SETEMBRO E NÃO ADIANTOU DE NADA."
//
// O campo "Fim (vazio = indeterminado)" na ficha do cliente não era NEM
// CONSULTADO na hora de gerar as mensalidades: dava para preencher e não
// acontecia nada. Ele só servia para mostrar "⚠ renovar" na lista e mandar um
// lembrete um mês antes.
//
// E a regra que faltava é inclusiva: marcar "Fim: setembro" quer dizer que
// setembro É o último mês cobrado — não que a cobrança para antes dele.
//
// Além disso, o botão dizia só "N já existiam ou sem valor definido",
// juntando num número só razões completamente diferentes: não dava para saber
// qual cliente faltou nem o que arrumar.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Mensalidade',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@mens.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const servico = db.prepare("INSERT INTO services (name, default_price, org_id) VALUES ('Social media', 1000, ?)")
  .run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/financial", financialRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/financial`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

function cliente(nome, campos = {}) {
  const id = db.prepare(
    `INSERT INTO clients (name, status, org_id, payment_day, billing_type, work_end, archived_at, pagamento_ate)
     VALUES (?, ?, ?, 10, ?, ?, ?, ?)`
  ).run(nome, campos.status || "active", org, campos.billing_type || "pagante",
        campos.work_end || null, campos.archived_at || null, campos.pagamento_ate || null).lastInsertRowid;
  if (campos.semServico !== true) {
    db.prepare("INSERT INTO client_services (client_id, service_id, price) VALUES (?,?,?)")
      .run(id, servico, campos.preco ?? 1000);
  }
  return id;
}

const gerar = (month, months = 1) => fetch(`${B}/generate-monthly`, {
  method: "POST", headers: H, body: JSON.stringify({ month, months }),
}).then((r) => r.json());

const lancamentosDe = (id) => db.prepare(
  "SELECT strftime('%Y-%m', due_date) m FROM financial_entries WHERE client_id = ? ORDER BY due_date"
).all(id).map((r) => r.m);

test("o mês do fim do contrato AINDA é cobrado — é o último, não o primeiro fora", async () => {
  const c = cliente("Termina em setembro", { work_end: "2026-09-30" });
  await gerar("2026-09");
  assert.deepEqual(lancamentosDe(c), ["2026-09"], "setembro tinha que entrar");
});

test("depois do fim do contrato, não cobra mais", async () => {
  const c = cliente("Terminou em agosto", { work_end: "2026-08-31" });
  const r = await gerar("2026-09");
  assert.deepEqual(lancamentosDe(c), [], "outubro em diante não é da conta dele");
  const meu = r.fora.find((f) => f.cliente === "Terminou em agosto");
  assert.ok(meu, "tem que aparecer na lista de quem não entrou");
  assert.match(meu.motivo, /contrato encerrou em 2026-08/);
});

test("gerando vários meses de uma vez, para no mês do fim", async () => {
  const c = cliente("Vai até novembro", { work_end: "2026-11-15" });
  await gerar("2026-09", 6);
  assert.deepEqual(lancamentosDe(c), ["2026-09", "2026-10", "2026-11"],
    "cobra setembro, outubro e novembro — e para");
});

test("sem data de fim, segue cobrando (prazo indeterminado)", async () => {
  const c = cliente("Sem fim definido");
  await gerar("2026-09", 3);
  assert.deepEqual(lancamentosDe(c), ["2026-09", "2026-10", "2026-11"]);
});

test("cliente arquivado é cobrado até o mês do último pagamento combinado", async () => {
  const c = cliente("Arquivado com parcela", {
    status: "inactive", archived_at: "2026-09-16T10:00:00Z", pagamento_ate: "2026-10-10",
  });
  await gerar("2026-09", 4);
  assert.deepEqual(lancamentosDe(c), ["2026-09", "2026-10"],
    "encerrou, mas o combinado era pagar até outubro");
});

test("cada motivo aparece com nome e sobrenome", async () => {
  cliente("Não pagante", { billing_type: "permuta" });
  cliente("Sem serviço", { semServico: true });
  cliente("Inativo de verdade", { status: "inactive" });
  const r = await gerar("2027-03");
  const motivo = (nome) => r.fora.find((f) => f.cliente === nome)?.motivo || "";
  assert.match(motivo("Não pagante"), /não é cliente pagante/);
  assert.match(motivo("Sem serviço"), /sem valor de serviço/);
  assert.match(motivo("Inativo de verdade"), /cliente inativo/);
});

test("gerar duas vezes não duplica, e diz que já estava lançada", async () => {
  const c = cliente("Repetido");
  await gerar("2027-06");
  const r = await gerar("2027-06");
  assert.deepEqual(lancamentosDe(c), ["2027-06"], "uma só");
  assert.match(r.fora.find((f) => f.cliente === "Repetido")?.motivo || "", /já lançada/);
});
