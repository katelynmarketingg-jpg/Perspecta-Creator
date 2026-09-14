// A ORDEM DA PRÉVIA DO PERFIL, e a armadilha que ela tinha.
//
// A prévia ordena pela POSIÇÃO salva e só depois pela data. Arrastar uma vez
// grava posição em TODAS as peças daquele quadro — e daí em diante mudar a data
// não movia mais nada: o quadro ficava parado no lugar antigo e as datas
// embaixo dos quadros deixavam de bater com a ordem, para sempre. Era o que ela
// descreveu: "arrasto, a data fica errada, eu arrumo, e não adianta".
//
// Duas saídas, as duas respeitando a escolha dela (arrastar NÃO mexe em datas):
//   1. mudar a data de uma peça devolve ELA para a ordem por data;
//   2. um botão devolve o quadro inteiro à ordem por data, sem tocar em datas.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-ordem-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const distribution = (await import("../src/routes/distribution.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Ordem',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@o.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo','active',?)").run(org).lastInsertRowid;
db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Distribuição',4,0,?)").run(org);
const etapa = db.prepare("SELECT id FROM kanban_stages WHERE org_id=?").get(org).id;

const app = express();
app.use(express.json());
app.use("/api/distribution", distribution);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/distribution`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

let n = 0;
const nova = (data) => db.prepare(
  `INSERT INTO tasks (title,content_type,client_id,org_id,approval_status,stage_id,scheduled_at)
   VALUES (?,'post',?,?,'pending',?,?)`
).run(`Peça ${++n}`, cli, org, etapa, data).lastInsertRowid;

const posicao = (id) => db.prepare("SELECT position FROM tasks WHERE id = ?").get(id).position;
const post = (rota, corpo) => fetch(B + rota, { method: "POST", headers: H, body: JSON.stringify(corpo) });
const put = (id, corpo) => fetch(`${B}/${id}`, { method: "PUT", headers: H, body: JSON.stringify(corpo) });

test("arrastar grava posição e NÃO mexe nas datas", async () => {
  const a = nova("2026-10-01 10:00"), b = nova("2026-10-02 10:00");
  await post("/reorder-position", { ids: [b, a] });
  // Começa em 1: o 0 fica reservado para "nunca arrastada".
  assert.equal(posicao(b), 1);
  assert.equal(posicao(a), 2);
  assert.equal(db.prepare("SELECT scheduled_at FROM tasks WHERE id=?").get(a).scheduled_at, "2026-10-01 10:00");
  assert.equal(db.prepare("SELECT scheduled_at FROM tasks WHERE id=?").get(b).scheduled_at, "2026-10-02 10:00");
});

test("mudar a data NÃO mexe na ordem arrumada — foi a escolha dela", async () => {
  const a = nova("2026-11-01 10:00"), b = nova("2026-11-02 10:00");
  await post("/reorder-position", { ids: [b, a] });
  const r = await put(a, { scheduled_at: "2026-11-09 10:00" });
  assert.equal(r.status, 200);
  assert.equal(posicao(a), 2, "a peça fica onde ela a pôs; quem devolve à data é o botão");
  assert.equal(posicao(b), 1);
});

test("salvar sem mexer na data não desfaz o que ela arrumou", async () => {
  const a = nova("2026-12-01 10:00"), b = nova("2026-12-02 10:00");
  await post("/reorder-position", { ids: [b, a] });
  await put(a, { caption: "só a legenda" });
  assert.equal(posicao(a), 2, "mexer na legenda não pode bagunçar a ordem");
});

test("o botão devolve o quadro inteiro à ordem por data, sem tocar em datas", async () => {
  const a = nova("2027-01-01 10:00"), b = nova("2027-01-02 10:00"), c = nova("2027-01-03 10:00");
  await post("/reorder-position", { ids: [c, b, a] });
  const datasAntes = [a, b, c].map((id) => db.prepare("SELECT scheduled_at FROM tasks WHERE id=?").get(id).scheduled_at);

  const r = await post("/reorder-reset", { ids: [a, b, c] });
  assert.equal(r.status, 200);
  for (const id of [a, b, c]) assert.equal(posicao(id), 0, "as posições saem (0 = sem ordem manual)");
  const datasDepois = [a, b, c].map((id) => db.prepare("SELECT scheduled_at FROM tasks WHERE id=?").get(id).scheduled_at);
  assert.deepEqual(datasDepois, datasAntes, "e nenhuma data é tocada");
});

test("nem arrastar nem reorganizar alcançam peça de outra agência", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const alheia = db.prepare(
    `INSERT INTO tasks (title,content_type,client_id,org_id,stage_id,scheduled_at,position)
     VALUES ('Alheia','post',NULL,?,?, '2027-02-01 10:00', 7)`
  ).run(outra, etapa).lastInsertRowid;
  await post("/reorder-position", { ids: [alheia] });
  assert.equal(posicao(alheia), 7, "a posição da outra agência não muda");
  await post("/reorder-reset", { ids: [alheia] });
  assert.equal(posicao(alheia), 7, "nem com o botão de reorganizar");
});
