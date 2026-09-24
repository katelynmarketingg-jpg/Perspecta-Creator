// "AQUI NÃO APARECE NADA EM OUTUBRO"
//
// O mês virava e as Minhas Finanças abriam vazias. A causa: uma conta só
// acompanhava o mês seguinte se tivesse "Mensal" ou "3/5" escrito no campo
// parcela — e quase nenhuma tem. Netcomet, Adobe, celular: ninguém escreve
// "Mensal" ao lado de cada uma, e o mês novo nascia em branco.
//
// Agora o padrão é o contrário: conta de casa é conta que volta. A exceção é a
// que ela marcar como "só neste mês". E a parcelada continua andando sozinha —
// 1/2 vira 2/2 e some quando acaba.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-meses-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const rotas = (await import("../src/routes/personal-finance.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa dos Meses',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katy','k','k@p.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/pf", rotas);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/pf`;
const auth = { "content-type": "application/json",
               authorization: `Bearer ${jwt.sign({ id: uid, org_id: org, role: "admin" }, JWT_SECRET)}` };
const chamar = (m, c, corpo) => fetch(`${B}${c}`, {
  method: m, headers: auth, body: corpo ? JSON.stringify(corpo) : undefined });
const mes = async (ym) => (await (await chamar("GET", `/?ym=${ym}`)).json());
const nomes = (r) => r.entries.map((e) => e.name).sort();

test("a conta sem parcela escrita também acompanha o mês seguinte", async () => {
  // Era exatamente a tela dela: nenhuma com "Mensal" escrito.
  await chamar("POST", "/", { ym: "2026-09", name: "Netcomet", amount: 119.9 });
  await chamar("POST", "/", { ym: "2026-09", name: "Celular", amount: 134.66 });

  const out = await mes("2026-10");
  assert.deepEqual(nomes(out), ["Celular", "Netcomet"], "outubro não abre mais vazio");
  assert.equal(out.preenchido_de, "2026-09", "e a tela sabe dizer de onde vieram");
  assert.ok(out.entries.every((e) => !e.paid), "tudo em aberto: é conta a pagar, não histórico");
});

test("a parcelada anda sozinha: 1/2 vira 2/2, e some quando acaba", async () => {
  await chamar("POST", "/", { ym: "2026-09", name: "Curso designer", amount: 8, parcela: "1/2" });

  const out = await mes("2026-10");
  const curso = out.entries.find((e) => e.name === "Curso designer");
  assert.equal(curso.parcela, "2/2");

  const nov = await mes("2026-11");
  assert.ok(!nov.entries.some((e) => e.name === "Curso designer"), "acabou de pagar, não volta");
  assert.deepEqual(nomes(nov), ["Celular", "Netcomet"], "as outras seguem");
});

test("dá para andar vários meses de uma vez", async () => {
  const mar = await mes("2027-03");
  assert.deepEqual(nomes(mar), ["Celular", "Netcomet"]);
  // e os meses do caminho ficaram feitos, não só o de destino
  for (const ym of ["2026-12", "2027-01", "2027-02"]) {
    assert.deepEqual(nomes(await mes(ym)), ["Celular", "Netcomet"], ym);
  }
});

test('marcar "só neste mês" impede a conta de voltar', async () => {
  await chamar("POST", "/", { ym: "2027-04", name: "Presente de aniversário", amount: 200, avulso: true });
  const abr = await mes("2027-04");
  assert.ok(abr.entries.find((e) => e.name === "Presente de aniversário").avulso);

  const mai = await mes("2027-05");
  assert.ok(!mai.entries.some((e) => e.name === "Presente de aniversário"));
  assert.deepEqual(nomes(mai), ["Celular", "Netcomet"], "as de sempre continuam");
});

test('e dá para marcar "só neste mês" depois, editando', async () => {
  const jun = await mes("2027-06");
  const celular = jun.entries.find((e) => e.name === "Celular");
  await chamar("PUT", `/${celular.id}`, { avulso: true });

  const jul = await mes("2027-07");
  assert.deepEqual(nomes(jul), ["Netcomet"], "o celular não acompanhou");
});

test("abrir o mês de novo não duplica nada, nem repete o aviso", async () => {
  const primeira = await mes("2027-08");
  assert.deepEqual(nomes(primeira), ["Netcomet"]);
  assert.equal(primeira.preenchido_de, "2027-07", "da primeira vez, avisa de onde veio");

  const segunda = await mes("2027-08");
  assert.deepEqual(nomes(segunda), ["Netcomet"], "não duplicou");
  assert.equal(segunda.preenchido_de, null, "já estava feito: não avisa de novo");
});

test("lançar num mês nunca aberto traz junto as contas que vinham", async () => {
  // Sem isso, o gasto novo "inaugurava" o mês sozinho e as contas de sempre
  // sumiam — o mesmo buraco de abrir outubro e achar tudo vazio.
  await chamar("POST", "/", { ym: "2027-11", name: "Só isto aqui", amount: 10 });
  assert.deepEqual(nomes(await mes("2027-11")), ["Netcomet", "Só isto aqui"]);
});

test("gasto da Perspectiva não acompanha: o lugar dele é o Financeiro", async () => {
  await chamar("POST", "/", { ym: "2027-09", name: "Registro.br", amount: 90, category: "Perspectiva" });
  const out = await mes("2027-10");
  assert.ok(!out.entries.some((e) => e.name === "Registro.br"));
});

after(() => { srv.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
