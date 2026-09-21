// PERGUNTAS EM IMAGEM — ESCOLHER E DIZER POR QUÊ.
//
// Perguntar "que estilo vocês querem?" por escrito quase nunca funciona: cada
// um entende "moderno" de um jeito, e a resposta volta vaga. Mostrando três
// imagens, a pessoa aponta em segundos — e o campo de baixo, o "por quê", é o
// que vira direção de arte: "gostei do tom terroso e da foto sem gente".
//
// Duas coisas precisam ser verdade para isso funcionar:
//  1. o "por quê" tem que ser ACEITO ao salvar (ele não está na lista de
//     perguntas, é filho de uma) — senão a frase mais valiosa é jogada fora;
//  2. o "por quê" tem que chegar na inteligência da IA junto da escolha.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-visual-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { saneiaSecoes, respostasParaPersona, idDoPorque, progresso } = await import("../src/briefing.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const briefingsRoutes = (await import("../src/routes/briefings.js")).default;
const { briefingPublicRouter } = await import("../src/routes/briefing-public.js");
const { midiaPublicRouter } = await import("../src/routes/briefing-midia.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Visual',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@v.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Estúdio Lua','active',?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/briefings", briefingsRoutes);
app.use("/api/briefing", briefingPublicRouter);
app.use("/api/briefing-midia", midiaPublicRouter);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;

const token = jwt.sign({ id: uid, org_id: org, role: "admin" }, JWT_SECRET);
const auth = { "content-type": "application/json", authorization: `Bearer ${token}` };

const SECOES = [{
  id: "estilo",
  titulo: "O visual",
  perguntas: [
    { id: "paleta", tipo: "visual", label: "Qual destes combina com vocês?",
      opcoes_visuais: [{ token: "aaa", legenda: "Terroso" }, { token: "bbb", legenda: "Preto e branco" }],
      pede_porque: true, porque_label: "O que te chamou atenção?", campo: "positioning" },
  ],
}];

const b = await (await fetch(`${B}/briefings`, {
  method: "POST", headers: auth, body: JSON.stringify({ client_id: cli }),
})).json();
await fetch(`${B}/briefings/${b.id}/perguntas`, {
  method: "PUT", headers: auth, body: JSON.stringify({ secoes: SECOES }),
});

test("a pergunta visual sobrevive à limpeza, com opções e por quê", () => {
  const limpo = saneiaSecoes(SECOES);
  const p = limpo[0].perguntas[0];
  assert.equal(p.tipo, "visual");
  assert.equal(p.opcoes_visuais.length, 2);
  assert.equal(p.pede_porque, true);
  assert.equal(p.porque_label, "O que te chamou atenção?");
});

test("opção sem imagem cai fora — não dá para escolher o que não aparece", () => {
  const limpo = saneiaSecoes([{
    id: "x", titulo: "X",
    perguntas: [{ id: "q", tipo: "visual", label: "Q",
      opcoes_visuais: [{ legenda: "sem imagem" }, { token: "ok", legenda: "com imagem" }] }],
  }]);
  assert.deepEqual(limpo[0].perguntas[0].opcoes_visuais.map((o) => o.token), ["ok"]);
});

test("o cliente escolhe e escreve por quê, e as duas coisas ficam guardadas", async () => {
  const r = await fetch(`${B}/briefing/${b.token}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ respostas: { paleta: "Terroso", paleta__porque: "O tom lembra madeira, e a gente é marcenaria." } }),
  });
  assert.equal(r.status, 200);
  const visto = await (await fetch(`${B}/briefing/${b.token}`)).json();
  assert.equal(visto.respostas.paleta, "Terroso");
  assert.equal(visto.respostas.paleta__porque, "O tom lembra madeira, e a gente é marcenaria.");
});

test("o por quê chega na inteligência da IA junto da escolha", () => {
  const persona = respostasParaPersona(saneiaSecoes(SECOES), {
    paleta: "Terroso",
    [idDoPorque("paleta")]: "O tom lembra madeira.",
  });
  assert.equal(persona.positioning, "Terroso — O tom lembra madeira.");
});

test("só o por quê, sem escolha, também vale para a IA", () => {
  const persona = respostasParaPersona(saneiaSecoes(SECOES), {
    [idDoPorque("paleta")]: "Nenhuma dessas, queria algo mais claro.",
  });
  assert.equal(persona.positioning, "Nenhuma dessas, queria algo mais claro.");
});

test("o por quê não infla o progresso — quem conta é a pergunta", () => {
  const secoes = saneiaSecoes(SECOES);
  assert.equal(progresso(secoes, {}), 0);
  assert.equal(progresso(secoes, { paleta: "Terroso" }), 100);
});

test("imagem que não existe responde 404, não derruba a página do cliente", async () => {
  const r = await fetch(`${B}/briefing-midia/naoexiste`);
  assert.equal(r.status, 404);
});

after(() => { srv.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
