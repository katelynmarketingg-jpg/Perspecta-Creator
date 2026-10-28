// UM FORMULÁRIO PRONTO, COM AS PERGUNTAS DO CONTRATO JUNTO.
//
// Pedido dela: "cria pra mim um formulário unindo todas as perguntas pro
// contrato + [as 9 seções da página de um criminalista]".
//
// A estante nascia vazia: todo formulário novo saía igual ao padrão da casa, e
// montar o de um ramo era escrever pergunta por pergunta, uma a uma. Agora há
// modelos prontos — e criar a partir de um faz uma CÓPIA que vive na casa
// dela: mexer no modelo depois não mexe no formulário que já foi criado.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-modelo-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const briefings = (await import("../src/routes/briefings.js")).default;
const { MODELOS_PRONTOS, modeloPronto } = await import("../src/modelos-de-formulario.js");
const { TIPOS_DE_PERGUNTA, CAMPOS_CLIENTE, perguntasDe } = await import("../src/briefing.js");
const { PERSONA_FIELDS } = await import("../src/ai.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Modelo',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katy','Katy','k@mod.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/briefings", briefings);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/briefings`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

const criminal = modeloPronto("advocacia-criminal");

test("o modelo existe e aparece na lista, com o tamanho dele", async () => {
  const { modelos } = await (await fetch(`${B}/modelos-prontos`, { headers: H })).json();
  const m = modelos.find((x) => x.id === "advocacia-criminal");
  assert.ok(m, "o pronto tem de aparecer para ela escolher");
  assert.equal(m.secoes, 9);
  assert.ok(m.perguntas > 40, "são as perguntas do contrato mais as nove seções");
  assert.equal(m.servico, "Landing Page");
});

test("as perguntas do contrato vêm na frente, e apontam para o cadastro", () => {
  const primeira = criminal.secoes[0];
  assert.equal(primeira.titulo, "Dados para o contrato",
    "o que trava o início do trabalho é a papelada: ela vem primeiro");

  // Sem destino no cadastro, o contrato não sai pronto — era o motivo de
  // existir a seção.
  const destinos = primeira.perguntas.map((p) => p.campo_cliente).filter(Boolean);
  for (const obrigatorio of ["name", "document", "legal_name", "address", "rep_name", "rep_document", "email", "payment_day"]) {
    assert.ok(destinos.includes(obrigatorio), `faltou mandar alguma resposta para ${obrigatorio}`);
  }
  // E as duas perguntas dela, que não são do contrato mas são do começo.
  const labels = primeira.perguntas.map((p) => p.label).join(" | ");
  assert.match(labels, /WhatsApp vamos usar na página/);
  assert.match(labels, /divulgar o endereço dos seus escritórios/);
});

test("as nove seções são as que ela escreveu, na ordem", () => {
  assert.deepEqual(criminal.secoes.map((s) => s.titulo), [
    "Dados para o contrato",
    "Formação e trajetória",
    "Podcast e mídia",
    "Áreas de atuação",
    "Cliente ideal",
    "Diferenciais",
    "Concorrentes e referências",
    "Identidade visual",
    "Fotos",
  ]);
});

test("nenhuma pergunta inventada: tipos, destinos e ids conferem", () => {
  const ids = new Set();
  for (const s of criminal.secoes) {
    assert.ok(!ids.has(s.id), `seção repetida: ${s.id}`);
    ids.add(s.id);
    for (const p of s.perguntas) {
      assert.ok(TIPOS_DE_PERGUNTA.includes(p.tipo), `tipo inválido em ${p.id}: ${p.tipo}`);
      assert.ok(!ids.has(p.id), `pergunta repetida: ${p.id}`);
      ids.add(p.id);
      if (p.campo_cliente) {
        assert.ok(CAMPOS_CLIENTE[p.campo_cliente], `campo do cadastro inexistente: ${p.campo_cliente}`);
      }
      if (p.campo) {
        assert.ok(PERSONA_FIELDS.some((f) => f.key === p.campo),
          `campo da inteligência inexistente: ${p.campo}`);
      }
      if (p.tipo === "escolhas") {
        assert.ok(Array.isArray(p.opcoes) && p.opcoes.length >= 2, `escolhas sem opções: ${p.id}`);
      }
    }
  }
});

test("criar a partir do pronto faz uma CÓPIA dela, com a jornada junto", async () => {
  const r = await fetch(`${B}/formularios`, {
    method: "POST", headers: H,
    body: JSON.stringify({ modelo: "advocacia-criminal" }),
  });
  assert.equal(r.status, 201);
  const f = await r.json();
  assert.equal(f.name, criminal.nome, "sem nome digitado, fica o nome do modelo");
  assert.equal(f.secoes.length, 9);
  assert.equal(perguntasDe(f.secoes).length, perguntasDe(criminal.secoes).length);
  // O texto de boas-vindas do modelo vai junto: um convite de página não abre
  // com as mesmas palavras de um onboarding mensal.
  assert.match(f.welcome.titulo, /montar a sua página/);

  // É dela: mexer aqui não mexe no modelo, e vice-versa.
  const semUma = f.secoes.map((s, i) => (i === 1 ? { ...s, perguntas: s.perguntas.slice(1) } : s));
  await fetch(`${B}/formularios/${f.id}`, {
    method: "PUT", headers: H, body: JSON.stringify({ secoes: semUma }),
  });
  assert.equal(perguntasDe(modeloPronto("advocacia-criminal").secoes).length,
    perguntasDe(criminal.secoes).length, "o modelo de fábrica não pode mudar porque ela editou a cópia");
});

test("modelo que não existe é recusado, com motivo", async () => {
  const r = await fetch(`${B}/formularios`, {
    method: "POST", headers: H, body: JSON.stringify({ nome: "X", modelo: "nao-existe" }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /não existe/);
});

test("a tela oferece o pronto na hora de criar", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const tela = readFileSync(join(raiz, "client/src/pages/Onboarding.jsx"), "utf8");
  assert.match(tela, /briefings\/modelos-prontos/);
  assert.match(tela, /OU COMECE DE UM PRONTO/);
  assert.match(tela, /modelo: modelo \|\| undefined/);
});

test("há exatamente um pronto por enquanto — e ele tem descrição", () => {
  assert.equal(MODELOS_PRONTOS.length, 1);
  for (const m of MODELOS_PRONTOS) {
    assert.ok(m.nome && m.descricao, "um pronto sem descrição não ajuda a escolher");
  }
});

// O DIA DO PAGAMENTO SAÍA "1…" NA TELA DO CLIENTE.
//
// Visto no navegador, no celular, na primeira etapa deste formulário: o rótulo
// do chip vem com 12px de recuo de cada lado e a bolinha tem 44 de largura —
// sobravam 20px, e todo dia de dois dígitos virava reticências. A pessoa
// escolhia o dia do pagamento do contrato adivinhando qual era qual.
test("os dias do pagamento cabem dentro da bolinha", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const tela = readFileSync(join(raiz, "client/src/pages/Briefing.jsx"), "utf8");
  assert.match(tela, /"& \.MuiChip-label": \{ px: 0 \}/,
    "sem tirar o recuo do rótulo, o dia 28 some atrás das reticências");
});
