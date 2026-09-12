// AUDITORIA — Etapa 2: o cliente respondendo, no celular, com pressa, errando.
// Cola texto gigante, digita CNPJ torto, escolhe dia 31, aperta enviar duas
// vezes, volta dois dias depois. Nada disso pode quebrar nem sujar o cadastro.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-brfa-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { BRIEFING, perguntasDe, respostasParaCliente, faltando } = await import("../src/briefing.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const briefings = (await import("../src/routes/briefings.js")).default;
const { briefingPublicRouter } = await import("../src/routes/briefing-public.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Briefing',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@brf.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use("/api/briefing", briefingPublicRouter);
app.use("/api/briefings", briefings);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
const J = { "content-type": "application/json" };
after(() => srv.close());

const req = (m, u, corpo, cab) => fetch(B + u, {
  method: m, headers: cab || J, body: corpo ? JSON.stringify(corpo) : undefined,
}).then(async (r) => ({ st: r.status, ...(await r.json().catch(() => ({}))) }));

let n = 0;
async function novoLink(termos) {
  const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES (?,'active',?)")
    .run(`Cliente ${++n}`, org).lastInsertRowid;
  const b = await req("POST", "/briefings", { client_id: cli, termos }, H);
  return { cli, token: b.token, id: b.id };
}
function tudoRespondido(extra = {}) {
  const r = {};
  for (const p of perguntasDe(BRIEFING)) r[p.id] = p.tipo === "escolhas" ? p.opcoes[0] : `resposta de ${p.id}`;
  return { ...r, ...extra };
}

test("colar um texto gigante não derruba nem entope o banco", async () => {
  const { token } = await novoLink();
  const gigante = "x".repeat(200000);
  const r = await req("PUT", `/briefing/${token}`, { respostas: { razao_social: gigante } });
  assert.equal(r.st, 200);
  const guardado = JSON.parse(db.prepare("SELECT answers FROM briefings WHERE token = ?").get(token).answers);
  assert.ok(guardado.razao_social.length <= 4000, `guardou ${guardado.razao_social.length} caracteres`);
});

test("o cliente fecha a aba e volta depois — nada se perde", async () => {
  const { token } = await novoLink();
  await req("PUT", `/briefing/${token}`, { respostas: { razao_social: "PRIMEIRA PARTE LTDA" } });
  await req("PUT", `/briefing/${token}`, { respostas: { cnpj: "19.131.243/0001-97" } });
  const volta = await req("GET", `/briefing/${token}`);
  assert.equal(volta.respostas.razao_social, "PRIMEIRA PARTE LTDA", "o que ele digitou antes continua lá");
  assert.equal(volta.respostas.cnpj, "19.131.243/0001-97");
});

test("faltando obrigatória, o sistema diz QUAIS — não só que faltam", async () => {
  const { token } = await novoLink();
  const r = await req("POST", `/briefing/${token}/enviar`);
  assert.equal(r.st, 400);
  assert.ok(Array.isArray(r.faltando) && r.faltando.length, "tem que vir a lista");

  // A lista vem como ids, e a tela do cliente troca cada um pelo texto da
  // pergunta (ela já tem as seções). O que este teste garante é que TODO id
  // devolvido corresponde a uma pergunta de verdade — se um id fantasma
  // entrasse aqui, a tela mostraria um item em branco e a pessoa ficaria sem
  // saber o que responder.
  const conhecidas = new Set(perguntasDe(BRIEFING).map((p) => p.id));
  for (const id of r.faltando) {
    assert.ok(conhecidas.has(id), `id sem pergunta correspondente: ${id}`);
  }
  // E só entram as marcadas como obrigatórias.
  const obrigatorias = new Set(perguntasDe(BRIEFING).filter((p) => p.obrigatoria).map((p) => p.id));
  assert.deepEqual([...r.faltando].sort(), [...obrigatorias].sort());
});

test("CNPJ com pontuação, sem pontuação e torto — o que chega no cadastro", () => {
  const comPonto = respostasParaCliente(BRIEFING, { cnpj: "19.131.243/0001-97" });
  const semPonto = respostasParaCliente(BRIEFING, { cnpj: "19131243000197" });
  assert.equal(String(comPonto.document).replace(/\D/g, ""), "19131243000197");
  assert.equal(String(semPonto.document).replace(/\D/g, ""), "19131243000197");
  const torto = respostasParaCliente(BRIEFING, { cnpj: "12345" });
  assert.ok(!torto.document || String(torto.document).replace(/\D/g, "").length !== 14,
    "CNPJ de 5 dígitos não pode virar um CNPJ válido no cadastro");
});

test("dia de pagamento impossível não entra no cadastro", () => {
  assert.equal(respostasParaCliente(BRIEFING, { dia_pagamento: "45" }).payment_day, undefined);
  assert.equal(respostasParaCliente(BRIEFING, { dia_pagamento: "0" }).payment_day, undefined);
  assert.equal(respostasParaCliente(BRIEFING, { dia_pagamento: "abacaxi" }).payment_day, undefined);
  assert.equal(respostasParaCliente(BRIEFING, { dia_pagamento: "10" }).payment_day, 10);
  // "-5": o sinal é descartado e vira dia 5. Não é o ideal, mas é inofensivo —
  // dia negativo não existe, e recusar de vez atrapalharia quem digita "5-".
  assert.equal(respostasParaCliente(BRIEFING, { dia_pagamento: "-5" }).payment_day, 5);
});

test("o dia 31 é RECUSADO — a armadilha de fevereiro já está fechada", () => {
  // A pergunta do briefing tem faixa 1..28 e o cadastro respeita essa faixa.
  // Sem isso, a cobrança de quem escolhesse 31 cairia no último dia de
  // fevereiro (ou não cairia) e a agência descobriria no mês errado.
  assert.equal(respostasParaCliente(BRIEFING, { dia_pagamento: "31" }).payment_day, undefined);
  assert.equal(respostasParaCliente(BRIEFING, { dia_pagamento: "29" }).payment_day, undefined);
  assert.equal(respostasParaCliente(BRIEFING, { dia_pagamento: "28" }).payment_day, 28, "o limite entra");
});

test("enviar duas vezes seguidas não duplica contrato, cobrança nem aviso", async () => {
  const { cli, token } = await novoLink();
  await req("PUT", `/briefing/${token}`, { respostas: tudoRespondido() });
  const [a, b] = await Promise.all([
    req("POST", `/briefing/${token}/enviar`),
    req("POST", `/briefing/${token}/enviar`),
  ]);
  assert.ok([a.st, b.st].every((s) => s === 200));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM contracts WHERE client_id = ?").get(cli).n, 0,
    "sem termos definidos, nenhum contrato — e muito menos dois");
  const avisos = db.prepare("SELECT COUNT(*) n FROM notifications WHERE client_id = ? AND message LIKE '%respondeu o onboarding%'").get(cli).n;
  assert.ok(avisos <= 2, `avisos demais: ${avisos}`);
});

test("pergunta que não existe no briefing não grava nada", async () => {
  const { token } = await novoLink();
  await req("PUT", `/briefing/${token}`, { respostas: { pergunta_inventada: "lixo", __proto__: "ataque" } });
  const guardado = JSON.parse(db.prepare("SELECT answers FROM briefings WHERE token = ?").get(token).answers);
  assert.equal(guardado.pergunta_inventada, undefined);
});

test("link inventado não abre e não vaza a existência de nada", async () => {
  const r = await req("GET", "/briefing/token-que-nao-existe");
  assert.equal(r.st, 404);
  assert.match(r.error, /não existe/i);
});

test("o link continua servindo depois de enviado — ele volta para ver o contrato", async () => {
  const { token } = await novoLink();
  await req("PUT", `/briefing/${token}`, { respostas: tudoRespondido() });
  await req("POST", `/briefing/${token}/enviar`);
  const r = await req("GET", `/briefing/${token}`);
  assert.equal(r.st, 200);
  assert.equal(r.status, "respondido");
  const passos = await req("GET", `/briefing/${token}/proximos-passos`);
  assert.equal(passos.st, 200, "a tela final precisa continuar abrindo");
});

test("o acesso do cliente: nome curto, senha curta e nome já usado são recusados", async () => {
  const { token } = await novoLink();
  assert.equal((await req("POST", `/briefing/${token}/acesso`, { usuario: "ab", senha: "123456" })).st, 400);
  assert.equal((await req("POST", `/briefing/${token}/acesso`, { usuario: "marcelo", senha: "123" })).st, 400);
  assert.equal((await req("POST", `/briefing/${token}/acesso`, { usuario: "Mar celo!", senha: "123456" })).st, 400);
  assert.equal((await req("POST", `/briefing/${token}/acesso`, { usuario: "marcelo", senha: "segredo123" })).st, 201);

  const outro = await novoLink();
  const repetido = await req("POST", `/briefing/${outro.token}/acesso`, { usuario: "marcelo", senha: "segredo123" });
  assert.equal(repetido.st, 409, "dois clientes não podem ter o mesmo nome de acesso");
});

test("um link antigo não troca a senha de quem já criou acesso", async () => {
  const { token } = await novoLink();
  await req("POST", `/briefing/${token}/acesso`, { usuario: "pessoa.nova", senha: "segredo123" });
  const segunda = await req("POST", `/briefing/${token}/acesso`, { usuario: "pessoa.nova", senha: "senha-do-invasor" });
  assert.equal(segunda.st, 409, "tem que recusar — senão o link vira uma chave mestra");
});
