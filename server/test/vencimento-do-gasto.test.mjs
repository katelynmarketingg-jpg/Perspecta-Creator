// "ACRESCENTA DATA DE VENCIMENTO, CASO EU QUEIRA COLOCAR, (EM TODOS)"
//
// Opcional: quem não tem vencimento continua como estava. E guardamos o DIA,
// não a data inteira — a linha já pertence a um mês (ym), então dia + mês dão
// a data, e a conta que acompanha os próximos meses leva o dia junto sozinha.
// Com a data cheia, ela teria de reescrever o vencimento todo mês.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-venc-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const mod = await import("../src/routes/personal-finance.js");
const pf = mod.default;
const { diaDoVencimento } = mod;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Vencimento',0)").run().lastInsertRowid;
const katy = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katy','Katy','k@v.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/personal-finance", pf);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/personal-finance`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: katy }, JWT_SECRET)}` };
after(() => { srv.close(); db.close(); });

const req = (m, u, corpo) => fetch(B + u, {
  method: m, headers: H, body: corpo ? JSON.stringify(corpo) : undefined,
}).then(async (r) => ({ st: r.status, corpo: await r.json().catch(() => ({})) }));
const linha = (id) => db.prepare("SELECT * FROM personal_finance WHERE id=?").get(id);

// --- o que ela digita ---------------------------------------------------------------

test("aceita o jeito que ela escrever: 10, 10/11 ou a data inteira", () => {
  assert.equal(diaDoVencimento("10"), 10);
  assert.equal(diaDoVencimento(10), 10);
  assert.equal(diaDoVencimento("10/11"), 10);
  assert.equal(diaDoVencimento("10/11/2026"), 10);
  assert.equal(diaDoVencimento("2026-11-10"), 10);
  assert.equal(diaDoVencimento("05"), 5);
});

test("dia que não existe vira NADA — vencimento errado é pior que nenhum", () => {
  for (const v of ["", null, undefined, "0", "32", "abc", "-3", "99"]) {
    assert.equal(diaDoVencimento(v), null, `"${v}" não podia virar dia`);
  }
});

// --- guardar e devolver --------------------------------------------------------------

test("o gasto nasce com o vencimento que ela colocou", async () => {
  const r = await req("POST", "/", { ym: "2026-11", name: "Riachuelo", amount: 151, method: "Riachuelo", due_day: "10" });
  assert.equal(r.st, 201);
  assert.equal(r.corpo.due_day, 10);
});

test("sem vencimento continua funcionando — é opcional", async () => {
  const r = await req("POST", "/", { ym: "2026-11", name: "Mercado", amount: 430, method: "Pix" });
  assert.equal(r.st, 201);
  assert.equal(r.corpo.due_day, null);
});

test("dá para pôr o vencimento depois, editando", async () => {
  const { corpo } = await req("POST", "/", { ym: "2026-11", name: "Luz", amount: 90, method: "Pix" });
  const r = await req("PUT", `/${corpo.id}`, { due_day: "25" });
  assert.equal(r.corpo.due_day, 25);
});

test("salvar sem mexer no vencimento NÃO apaga o que ela pôs", async () => {
  const { corpo } = await req("POST", "/", { ym: "2026-11", name: "Água", amount: 70, method: "Pix", due_day: "7" });
  await req("PUT", `/${corpo.id}`, { amount: 80 });
  assert.equal(linha(corpo.id).due_day, 7, "mexer no valor não pode levar o vencimento junto");
});

test("dá para tirar o vencimento mandando vazio", async () => {
  const { corpo } = await req("POST", "/", { ym: "2026-11", name: "Gás", amount: 120, method: "Pix", due_day: "3" });
  await req("PUT", `/${corpo.id}`, { due_day: "" });
  assert.equal(linha(corpo.id).due_day, null);
});

test("a lista do mês devolve o vencimento, para a tela mostrar", async () => {
  const r = await req("GET", "/?ym=2026-11");
  const riachuelo = r.corpo.entries.find((e) => e.name === "Riachuelo");
  assert.equal(riachuelo.due_day, 10);
  assert.equal(riachuelo.ym, "2026-11", "a tela precisa do mês para montar a data");
});

// --- acompanhar os meses --------------------------------------------------------------

test("a conta que acompanha os meses leva o vencimento junto", async () => {
  await req("POST", "/", { ym: "2026-11", name: "Aluguel", amount: 1500, method: "Pix", parcela: "fixa", due_day: "5" });
  // Dezembro ainda não existe: ao abrir, o sistema o preenche sozinho.
  const dez = await req("GET", "/?ym=2026-12");
  const aluguel = dez.corpo.entries.find((e) => e.name === "Aluguel");
  assert.ok(aluguel, "a fixa foi para dezembro");
  assert.equal(aluguel.due_day, 5, "e venceu no mesmo dia — por isso guardamos o DIA, não a data");
});

test("a parcelada também leva, e a parcela avança", async () => {
  await req("POST", "/", { ym: "2026-11", name: "Sofá", amount: 200, method: "Pix", parcela: "2/5", due_day: "20" });
  const dez = await req("GET", "/?ym=2026-12");
  const sofa = dez.corpo.entries.find((e) => e.name === "Sofá");
  assert.equal(sofa.due_day, 20);
  assert.equal(sofa.parcela, "3/5");
});

test("a atrasada que volta no mês seguinte mantém o vencimento DELA", async () => {
  // O chip vai dizer "vence 10/11" mesmo aparecendo em dezembro: é a data real
  // da conta, e é ela que mostra o tamanho do atraso.
  const dez = await req("GET", "/?ym=2026-12");
  const atrasada = dez.corpo.atrasadas.find((e) => e.name === "Riachuelo");
  assert.ok(atrasada);
  assert.equal(atrasada.due_day, 10);
  assert.equal(atrasada.ym, "2026-11");
});

test("importar CSV (que não traz vencimento) não quebra", async () => {
  const r = await req("POST", "/import", {
    ym: "2027-01", entries: [{ name: "Netflix", amount: 55, method: "Nubank PF" }], label: "teste",
  });
  assert.equal(r.st, 200);
  assert.equal(r.corpo.imported, 1);
});

// --- a tela ----------------------------------------------------------------------------

const tela = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/pages/MinhasFinancas.jsx"), "utf8");

test("o campo está no formulário, e é só dígito", () => {
  assert.match(tela, /label="Vence dia"/);
  assert.match(tela, /due_day: e\.target\.value\.replace\(\/\\D\/g, ""\)\.slice\(0, 2\)/,
    "ela digita o dia, não um texto qualquer");
  assert.match(tela, /due_day: ""/, "o formulário de gasto novo também tem o campo");
});

test("a linha mostra o vencimento, montado com o mês dela", () => {
  assert.match(tela, /vencimentoDaLinha\(e\.due_day, e\.ym\)/);
  assert.match(tela, /label=\{`vence \$\{vencimentoDaLinha\(e\.due_day, e\.ym\)\}`\}/);
});

test("dia 31 em mês curto cai no último dia — não existe 31/02", () => {
  const f = tela.slice(tela.indexOf("function vencimentoDaLinha"), tela.indexOf("// \"2026-09\""));
  assert.match(f, /new Date\(a, m, 0\)\.getDate\(\)/);
  assert.match(f, /Math\.min\(d, ultimo\)/);
});
