// "QUANDO EU MUDAR LÁ EM MINHAS FINANÇAS, MUDA AQUI."
//
// A categoria "Perspectiva" quer dizer "isto é da empresa": o lugar dela é no
// Financeiro → Despesas, não nas finanças pessoais. Só que isso valia apenas na
// IMPORTAÇÃO do CSV. Criar um gasto à mão nessa categoria, ou trocar a
// categoria de um gasto que já existia, deixava a conta parada nas finanças
// pessoais — ela mudava lá e não mudava no Financeiro, e tinha que lembrar de
// clicar no aviso depois.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-empresa-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const pessoais = (await import("../src/routes/personal-finance.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Empresa',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katy','Katy','k@emp.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/personal-finance", pessoais);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/personal-finance`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

const nasPessoais = (nome) => db.prepare(
  "SELECT COUNT(*) n FROM personal_finance WHERE org_id=? AND name=?"
).get(org, nome).n;
const noFinanceiro = (nome) => db.prepare(
  "SELECT COUNT(*) n FROM financial_entries WHERE org_id=? AND type='expense' AND description=?"
).get(org, nome).n;

test("gasto novo na categoria Perspectiva já nasce no Financeiro", async () => {
  const r = await fetch(B, { method: "POST", headers: H, body: JSON.stringify({
    ym: "2026-09", name: "Assinatura Canva", amount: 120, category: "Perspectiva", method: "Nubank PJ" }) });
  assert.equal(r.status, 201);
  const corpo = await r.json();
  assert.equal(corpo.foi_para_o_financeiro, true);
  assert.equal(nasPessoais("Assinatura Canva"), 0, "não fica nas finanças pessoais dela");
  assert.equal(noFinanceiro("Assinatura Canva"), 1, "aparece como despesa da empresa");

  const despesa = db.prepare("SELECT category, amount, card FROM financial_entries WHERE description=?").get("Assinatura Canva");
  assert.equal(despesa.category, "Perspectiva");
  assert.equal(despesa.amount, 120);
  assert.equal(despesa.card, "Nubank PJ", "o meio de pagamento vai junto");
});

test("gasto pessoal continua pessoal", async () => {
  await fetch(B, { method: "POST", headers: H, body: JSON.stringify({
    ym: "2026-09", name: "Mercado", amount: 400, category: "Casa" }) });
  assert.equal(nasPessoais("Mercado"), 1);
  assert.equal(noFinanceiro("Mercado"), 0);
});

test("TROCAR a categoria para Perspectiva move a conta na hora", async () => {
  const criado = await (await fetch(B, { method: "POST", headers: H, body: JSON.stringify({
    ym: "2026-09", name: "Domínio do site", amount: 60, category: "Contas fixas" }) })).json();
  assert.equal(nasPessoais("Domínio do site"), 1, "começou como gasto pessoal");

  const r = await fetch(`${B}/${criado.id}`, { method: "PUT", headers: H,
    body: JSON.stringify({ category: "Perspectiva" }) });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).foi_para_o_financeiro, true);
  assert.equal(nasPessoais("Domínio do site"), 0, "saiu das pessoais");
  assert.equal(noFinanceiro("Domínio do site"), 1, "entrou no Financeiro");
});

test("mudar outra coisa do gasto NÃO move nada", async () => {
  const criado = await (await fetch(B, { method: "POST", headers: H, body: JSON.stringify({
    ym: "2026-09", name: "Farmácia", amount: 80, category: "Casa" }) })).json();
  await fetch(`${B}/${criado.id}`, { method: "PUT", headers: H, body: JSON.stringify({ amount: 95 }) });
  assert.equal(nasPessoais("Farmácia"), 1, "continua onde estava");
  assert.equal(noFinanceiro("Farmácia"), 0);
});

test("renomear uma categoria inteira para Perspectiva leva todas junto", async () => {
  for (const nome of ["Tráfego pago", "Ferramenta de IA", "Banco de imagens"]) {
    await fetch(B, { method: "POST", headers: H, body: JSON.stringify({
      ym: "2026-10", name: nome, amount: 50, category: "Trabalho" }) });
  }
  assert.equal(nasPessoais("Tráfego pago"), 1);

  const r = await fetch(`${B}/rename-category`, { method: "PUT", headers: H,
    body: JSON.stringify({ ym: "2026-10", from: "Trabalho", to: "Perspectiva" }) });
  const corpo = await r.json();
  assert.equal(corpo.foi_para_o_financeiro, 3, "as três foram");
  for (const nome of ["Tráfego pago", "Ferramenta de IA", "Banco de imagens"]) {
    assert.equal(nasPessoais(nome), 0, `${nome} saiu das pessoais`);
    assert.equal(noFinanceiro(nome), 1, `${nome} entrou no Financeiro`);
  }
});

test("renomear para uma categoria pessoal não move nada", async () => {
  await fetch(B, { method: "POST", headers: H, body: JSON.stringify({
    ym: "2026-11", name: "Padaria", amount: 30, category: "Rua" }) });
  await fetch(`${B}/rename-category`, { method: "PUT", headers: H,
    body: JSON.stringify({ ym: "2026-11", from: "Rua", to: "Alimentação" }) });
  assert.equal(nasPessoais("Padaria"), 1);
  assert.equal(noFinanceiro("Padaria"), 0);
});

test("conta parcelada da empresa entra com as parcelas que faltam", async () => {
  await fetch(B, { method: "POST", headers: H, body: JSON.stringify({
    ym: "2026-09", name: "Notebook da equipe", amount: 500, category: "Perspectiva", parcela: "2/5" }) });
  assert.equal(noFinanceiro("Notebook da equipe"), 4, "faltavam 4 parcelas (da 2 até a 5)");
});

test("escrito de outro jeito ainda é a empresa", async () => {
  await fetch(B, { method: "POST", headers: H, body: JSON.stringify({
    ym: "2026-09", name: "Impulsionamento", amount: 200, category: "perspectiva media" }) });
  assert.equal(nasPessoais("Impulsionamento"), 0);
  assert.equal(noFinanceiro("Impulsionamento"), 1);
});
