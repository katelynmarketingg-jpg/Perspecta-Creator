// CRIAR TAREFA — o que impedia, e o silêncio que escondia.
//
// Ela: "por quê quando eu vou criar uma tarefa na aba tarefas eu não consigo
// criar?". Reproduzido no navegador: POST /api/tasks devolvia 500 e a tela não
// dizia nada. Eram três coisas somadas.
//
//   1. O formulário manda `""` nos campos de escolher que ficaram em branco.
//      O servidor usava `b.project_id ?? null`, e `??` não troca texto vazio:
//      o `""` ia para uma coluna que aponta para a tabela de projetos e o banco
//      recusava a linha inteira (FOREIGN KEY constraint failed).
//   2. O salvar da tela não tinha try/catch: o erro morria como promessa solta
//      e o diálogo ficava aberto sem explicação.
//   3. Mesmo criando, o quadro abria filtrado em "Só as minhas" — que esconde
//      também o que não tem responsável, ou seja, toda tarefa recém-criada.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-criar-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { idOuNulo } = await import("../src/pertence.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const tasks = (await import("../src/routes/tasks.js")).default;
const projects = (await import("../src/routes/projects.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa das Tarefas',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@t.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Von Saltiel','active',?)").run(org).lastInsertRowid;
const etapa = db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Criação',1,0,?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/tasks", tasks);
app.use("/api/projects", projects);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

const pedir = async (metodo, caminho, corpo) => {
  const r = await fetch(`${B}${caminho}`, {
    method: metodo, headers: H, body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

// O corpo EXATO que a tela manda quando só o título foi preenchido — copiado da
// captura no navegador. É este pedido que dava 500.
const comoATelaManda = (extra = {}) => ({
  title: "Tarefa de teste",
  description: "",
  client_id: null,
  project_id: "",        // <- o vilão
  assignee_id: null,
  stage_id: etapa,
  priority: "medium",
  tags: [],
  due_date: "",
  quantity: 1,
  content_type: null,
  caption: null,
  scheduled_at: null,
  ...extra,
});

// --- o buraco ------------------------------------------------------------------

test("criar com os campos em branco funciona — era o 500", async () => {
  const r = await pedir("POST", "/tasks", comoATelaManda());
  assert.equal(r.status, 201, "não pode mais explodir");
  assert.equal(r.corpo.title, "Tarefa de teste");
  const salva = db.prepare("SELECT project_id, client_id, assignee_id FROM tasks WHERE id = ?").get(r.corpo.id);
  assert.equal(salva.project_id, null, "texto vazio virou nulo, não foi para o banco");
  assert.equal(salva.client_id, null);
  assert.equal(salva.assignee_id, null);
});

test("idOuNulo trata o vazio como não informado, e o resto como número", () => {
  for (const v of ["", null, undefined, "abc", {}]) assert.equal(idOuNulo(v), null, `${JSON.stringify(v)} vira nulo`);
  assert.equal(idOuNulo(7), 7);
  assert.equal(idOuNulo("7"), 7, "o formulário manda texto; o banco quer número");
});

test("com os ids preenchidos de verdade, eles são gravados", async () => {
  const proj = await pedir("POST", "/projects", { name: "Projeto X", client_id: cli });
  assert.equal(proj.status, 201);
  const r = await pedir("POST", "/tasks", comoATelaManda({
    title: "Com tudo preenchido", client_id: String(cli), project_id: String(proj.corpo.id), assignee_id: String(uid),
  }));
  assert.equal(r.status, 201);
  const salva = db.prepare("SELECT project_id, client_id, assignee_id FROM tasks WHERE id = ?").get(r.corpo.id);
  assert.equal(salva.client_id, cli);
  assert.equal(salva.project_id, proj.corpo.id);
  assert.equal(salva.assignee_id, uid);
});

test("id de outra casa continua barrado — a trava não foi afrouxada", async () => {
  const outra = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Vizinha',0)").run().lastInsertRowid;
  const alheio = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Dela','active',?)").run(outra).lastInsertRowid;
  const r = await pedir("POST", "/tasks", comoATelaManda({ client_id: alheio }));
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /não é desta agência/);
});

test("título continua obrigatório", async () => {
  const r = await pedir("POST", "/tasks", comoATelaManda({ title: "" }));
  assert.equal(r.status, 400);
});

test("criar em lote também aguenta os campos em branco", async () => {
  const r = await pedir("POST", "/tasks", comoATelaManda({ title: "Mês inteiro", quantity: 8 }));
  assert.equal(r.status, 201);
  assert.equal(Array.isArray(r.corpo), true);
  assert.equal(r.corpo.length, 8);
});

test("editar também não engasga com campo esvaziado", async () => {
  const nova = await pedir("POST", "/tasks", comoATelaManda({ title: "Para editar" }));
  const r = await pedir("PUT", `/tasks/${nova.corpo.id}`, { title: "Editada", project_id: "", client_id: "" });
  assert.equal(r.status, 200);
  const salva = db.prepare("SELECT project_id, client_id FROM tasks WHERE id = ?").get(nova.corpo.id);
  assert.equal(salva.project_id, null);
  assert.equal(salva.client_id, null);
});

// --- o mesmo buraco nas outras telas ---------------------------------------------

test("nenhuma rota grava id vindo do corpo com `?? null`", () => {
  // `??` não troca texto vazio — era por isso que o banco recusava. Quem grava
  // id do corpo usa idOuNulo.
  const aqui2 = dirname(fileURLToPath(import.meta.url));
  for (const arq of ["tasks", "projects", "contracts", "events", "financial", "goals"]) {
    const txt = readFileSync(join(aqui2, `../src/routes/${arq}.js`), "utf8");
    const sobrou = txt.match(/^\s*\w*_id: b\.\w*_id \?\? null,/gm) || [];
    assert.deepEqual(sobrou, [], `${arq}.js ainda grava id do corpo com ?? null`);
  }
});

// --- o que a tela promete ----------------------------------------------------------

const aqui = dirname(fileURLToPath(import.meta.url));
const tela = readFileSync(join(aqui, "../../client/src/pages/Tasks.jsx"), "utf8");

test("falhar deixou de ser silêncio: o motivo aparece no diálogo", () => {
  const salvar = tela.slice(tela.indexOf("async function save()"), tela.indexOf("// Move com update otimista"));
  assert.match(salvar, /try \{/, "a falha é tratada");
  assert.match(salvar, /setErroDoFormulario\(/);
  assert.match(tela, /erroDoFormulario && <Alert severity="error"/, "e aparece na tela");
});

test("o formulário manda projeto vazio como nulo", () => {
  const salvar = tela.slice(tela.indexOf("async function save()"), tela.indexOf("// Move com update otimista"));
  assert.match(salvar, /project_id: draft\.project_id \|\| null/);
});

test("o quadro abre mostrando tudo, não só as minhas", () => {
  assert.match(tela, /const \[filterAssignee, setFilterAssignee\] = useState\(""\)/,
    'abrir em "__me" escondia a tarefa recém-criada, que nasce sem responsável');
  // O filtro continua existindo para quem quiser.
  assert.match(tela, /Só as minhas/);
});
