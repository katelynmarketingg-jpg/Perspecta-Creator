// AUDITORIA — Etapa 8: o cliente vê SÓ o que é dele, e o escritório vê só o
// que é do escritório. Este é o teste que, se falhar, é o pior defeito
// possível: o conteúdo de um cliente aparecendo para outro.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-iso-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const portalRoutes = (await import("../src/routes/portal.js")).default;
const { briefingPublicRouter } = await import("../src/routes/briefing-public.js");
const briefings = (await import("../src/routes/briefings.js")).default;
const { signRouter, makeSignToken } = await import("../src/routes/sign.js");

// DUAS agências, com um cliente cada — o pior cenário de vazamento.
function monta(nomeOrg, nomeCliente, usuario) {
  const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES (?,0)").run(nomeOrg).lastInsertRowid;
  const user = db.prepare(
    "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES (?,?,?,?,'admin',1,?)"
  ).run(nomeOrg, nomeOrg, `${usuario}@x.com`, hashPassword("x"), org).lastInsertRowid;
  const cli = db.prepare(
    "INSERT INTO clients (name,status,org_id,portal_username,portal_password_hash) VALUES (?,'active',?,?,?)"
  ).run(nomeCliente, org, usuario, hashPassword("segredo123")).lastInsertRowid;
  const arq = join(dir, `${usuario}.bin`);
  writeFileSync(arq, Buffer.alloc(64, 1));
  const file = db.prepare(
    `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
     VALUES (?,?,'image/png',64,?,'editados',?)`
  ).run(cli, `arte-${usuario}.png`, arq, org).lastInsertRowid;
  const contrato = db.prepare(
    "INSERT INTO contracts (client_id,title,value,status,notes,org_id) VALUES (?,?,1000,'active',?,?)"
  ).run(cli, `Contrato ${nomeCliente}`, `SEGREDO DE ${nomeCliente}`, org).lastInsertRowid;
  const tarefa = db.prepare(
    "INSERT INTO tasks (title,content_type,client_id,org_id,approval_status) VALUES (?,'post',?,?,'sent')"
  ).run(`Post secreto de ${nomeCliente}`, cli, org).lastInsertRowid;
  db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)").run(tarefa, file);
  return { org, user, cli, file, contrato, tarefa };
}

const A = monta("Agência A", "Cliente A", "clientea");
const B_ = monta("Agência B", "Cliente B", "clienteb");

const app = express();
app.use(express.json());
app.use("/api/portal", portalRoutes);
app.use("/api/briefing", briefingPublicRouter);
app.use("/api/briefings", briefings);
app.use("/api/sign", signRouter);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const URL = `http://127.0.0.1:${srv.address().port}/api`;
after(() => srv.close());

const entra = (usuario) => fetch(`${URL}/portal/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: usuario, password: "segredo123" }),
}).then((r) => r.json()).then((d) => d.token);

const tokenA = await entra("clientea");
const tokenB = await entra("clienteb");
const comoA = { authorization: `Bearer ${tokenA}` };

test("o cliente A não baixa o arquivo do cliente B", async () => {
  const meu = await fetch(`${URL}/portal/files/${A.file}/download`, { headers: comoA });
  assert.equal(meu.status, 200, "o próprio arquivo abre");
  const dele = await fetch(`${URL}/portal/files/${B_.file}/download`, { headers: comoA });
  assert.equal(dele.status, 404, "o do outro cliente NÃO pode abrir");
});

test("o cliente A não vê o post nem o contrato do cliente B", async () => {
  const feed = await fetch(`${URL}/portal/feed`, { headers: comoA }).then((r) => r.json());
  assert.ok(!JSON.stringify(feed).includes("Cliente B"), "nada do outro cliente no feed");
  const contratos = await fetch(`${URL}/portal/contracts`, { headers: comoA }).then((r) => r.json());
  assert.ok(!JSON.stringify(contratos).includes("SEGREDO DE Cliente B"));
  assert.ok(JSON.stringify(contratos).includes("SEGREDO DE Cliente A"), "o próprio, sim");
});

test("o cliente A não aprova nem comenta o conteúdo do cliente B", async () => {
  const r = await fetch(`${URL}/portal/tasks/${B_.tarefa}/approve`, {
    method: "POST", headers: { ...comoA, "content-type": "application/json" }, body: "{}",
  });
  assert.ok(r.status >= 400, `devia recusar, respondeu ${r.status}`);
  const t = db.prepare("SELECT approval_status FROM tasks WHERE id = ?").get(B_.tarefa);
  assert.equal(t.approval_status, "sent", "a peça do outro não pode ter mudado de estado");
});

test("o token do portal não abre as telas da equipe", async () => {
  const r = await fetch(`${URL}/briefings`, { headers: comoA });
  assert.ok(r.status === 401 || r.status === 403, `respondeu ${r.status}`);
});

test("a equipe de uma agência não enxerga briefing da outra", async () => {
  const tokenEquipeA = jwt.sign({ id: A.user }, JWT_SECRET);
  const criado = await fetch(`${URL}/briefings`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokenEquipeA}` },
    body: JSON.stringify({ client_id: B_.cli }),
  }).then((r) => ({ st: r.status }));
  assert.equal(criado.st, 404, "cliente de outra agência não existe para esta");
});

test("link de briefing de um cliente não escreve no cadastro de outro", async () => {
  const tokenEquipeA = jwt.sign({ id: A.user }, JWT_SECRET);
  const meu = await fetch(`${URL}/briefings`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokenEquipeA}` },
    body: JSON.stringify({ client_id: A.cli }),
  }).then((r) => r.json());
  await fetch(`${URL}/briefing/${meu.token}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ respostas: { razao_social: "INVASOR LTDA" } }),
  });
  const outro = db.prepare("SELECT legal_name FROM clients WHERE id = ?").get(B_.cli);
  assert.equal(outro.legal_name, null, "o cadastro do outro cliente continua intocado");
});

test("token do portal assinado com outro segredo não vale", async () => {
  const falso = jwt.sign({ portal: true, client_id: B_.cli, org_id: B_.org }, "outro-segredo");
  const r = await fetch(`${URL}/portal/feed`, { headers: { authorization: `Bearer ${falso}` } });
  assert.equal(r.status, 401);
});

test("trocar o client_id dentro de um token válido não funciona (ele é assinado)", async () => {
  // Um token forjado com o segredo certo seria válido — por isso o segredo é
  // o que precisa estar protegido. O que se testa aqui é que o payload não é
  // lido de nenhum lugar que o cliente controle (querystring, cabeçalho...).
  const r = await fetch(`${URL}/portal/feed?client_id=${B_.cli}`, { headers: comoA }).then((x) => x.json());
  assert.ok(!JSON.stringify(r).includes("Cliente B"), "o client_id da URL não pode mandar");
});

test("o link de assinatura de um contrato não abre outro contrato", async () => {
  const meu = await fetch(`${URL}/sign/${makeSignToken(A.contrato)}`).then((r) => r.json());
  assert.match(meu.notes, /SEGREDO DE Cliente A/);
  assert.ok(!JSON.stringify(meu).includes("Cliente B"));
});
