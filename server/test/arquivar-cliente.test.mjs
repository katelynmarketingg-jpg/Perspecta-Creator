// ENCERRAR UM CLIENTE NÃO É APAGAR A HISTÓRIA DELE.
//
// Até aqui o único caminho era "Excluir cliente?" e um DELETE na hora — que
// levava junto, POR CASCATA, as artes, as pastas, os briefings, o planejamento
// e as prioridades; e deixava contratos, recibos e lançamentos órfãos, sem nome
// de cliente. Sem confirmação nenhuma além de uma pergunta de uma linha.
//
// Agora: arquivar guarda tudo e tira o cliente das telas do dia a dia; excluir
// continua existindo, mas só depois de arquivado e digitando o nome.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-arq-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const { fimDoMes, apareceNoFinanceiro } = await import("../src/arquivar-cliente.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const clientsRoutes = (await import("../src/routes/clients.js")).default;
const portalRoutes = (await import("../src/routes/portal.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Arquivo',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@arq.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/clients", clientsRoutes);
app.use("/api/portal", portalRoutes);
app.use((err, req, res, next) => res.status(500).json({ error: "Erro interno do servidor." }));
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

function novoCliente(nome, comAcesso = false) {
  const id = db.prepare(
    `INSERT INTO clients (name, status, org_id, portal_username, portal_password_hash)
     VALUES (?, 'active', ?, ?, ?)`
  ).run(nome, org, comAcesso ? nome.toLowerCase() : null, comAcesso ? hashPassword("segredo123") : null).lastInsertRowid;
  // material de verdade pendurado nele
  const caminho = join(dir, `arte-${id}.png`);
  writeFileSync(caminho, Buffer.alloc(64, 1));
  db.prepare(`INSERT INTO files (client_id, original_name, mime, size, stored_path, stage, org_id)
              VALUES (?,?, 'image/png', 64, ?, 'editados', ?)`).run(id, `arte de ${nome}.png`, caminho, org);
  db.prepare("INSERT INTO contracts (client_id, title, org_id) VALUES (?,?,?)").run(id, `Contrato ${nome}`, org);
  db.prepare(`INSERT INTO financial_entries (client_id, type, description, amount, status, org_id)
              VALUES (?, 'income', 'Mensalidade', 2500, 'pending', ?)`).run(id, org);
  return { id, caminho };
}

const lista = (escopo) => fetch(`${B}/clients${escopo ? `?escopo=${escopo}` : ""}`, { headers: H })
  .then((r) => r.json()).then((r) => r.map((c) => c.name));

test("arquivar tira o cliente do dia a dia e NÃO perde nada", async () => {
  const { id, caminho } = novoCliente("Silva Advogados");
  assert.ok((await lista()).includes("Silva Advogados"));

  const r = await fetch(`${B}/clients/${id}/arquivar`, {
    method: "POST", headers: H,
    body: JSON.stringify({ entrega_ate: "2026-10-31", pagamento_ate: "2026-11-10", observacao: "Encerrado em acordo." }),
  });
  assert.equal(r.status, 200);

  assert.ok(!(await lista()).includes("Silva Advogados"), "some da lista do dia a dia");
  assert.ok((await lista("arquivados")).includes("Silva Advogados"), "aparece nos arquivados");
  assert.ok((await lista("todos")).includes("Silva Advogados"));

  // e o material continua inteiro
  assert.equal(db.prepare("SELECT COUNT(*) n FROM files WHERE client_id = ?").get(id).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM contracts WHERE client_id = ?").get(id).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM financial_entries WHERE client_id = ?").get(id).n, 1);
  assert.equal(existsSync(caminho), true, "a arte continua guardada");

  const guardado = db.prepare("SELECT entrega_ate, pagamento_ate, archive_note FROM clients WHERE id = ?").get(id);
  assert.equal(guardado.entrega_ate, "2026-10-31", "o que foi combinado fica registrado");
  assert.equal(guardado.pagamento_ate, "2026-11-10");
});

test("no Financeiro ele fica até o fim do mês do último pagamento", () => {
  const cliente = { archived_at: "2026-09-16T10:00:00Z", pagamento_ate: "2026-11-10" };
  assert.equal(fimDoMes("2026-11-10"), "2026-11-30");
  assert.equal(apareceNoFinanceiro(cliente, "2026-09-20"), true, "logo depois de arquivar, continua lá");
  assert.equal(apareceNoFinanceiro(cliente, "2026-11-30"), true, "no último dia do mês, ainda está");
  assert.equal(apareceNoFinanceiro(cliente, "2026-12-01"), false, "virou o mês: sai do Financeiro");
  assert.equal(apareceNoFinanceiro({ archived_at: "x", pagamento_ate: null }, "2026-09-20"), false,
    "arquivado sem data de pagamento sai na hora");
  assert.equal(apareceNoFinanceiro({ archived_at: null }, "2030-01-01"), true, "cliente ativo aparece sempre");
});

test("a mesma regra vale na consulta do Financeiro", async () => {
  const { id } = novoCliente("Souza Contabilidade");
  await fetch(`${B}/clients/${id}/arquivar`, { method: "POST", headers: H,
    body: JSON.stringify({ pagamento_ate: "2999-12-20" }) });
  assert.ok((await lista("financeiro")).includes("Souza Contabilidade"), "ainda tem parcela para cair");

  const { id: id2 } = novoCliente("Antigo Ltda");
  await fetch(`${B}/clients/${id2}/arquivar`, { method: "POST", headers: H,
    body: JSON.stringify({ pagamento_ate: "2020-01-05" }) });
  assert.ok(!(await lista("financeiro")).includes("Antigo Ltda"), "o mês passou: sai do Financeiro");
});

test("o acesso do cliente para NA HORA de arquivar", async () => {
  const { id } = novoCliente("Marcelo Silva", true);
  const entra = () => fetch(`${B}/portal/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "marcelo silva", password: "segredo123" }) });

  const antes = await entra();
  assert.equal(antes.status, 200, "antes de arquivar, ele entra");
  const { token } = await antes.json();

  await fetch(`${B}/clients/${id}/arquivar`, { method: "POST", headers: H, body: JSON.stringify({}) });

  const depois = await entra();
  assert.equal(depois.status, 403);
  const { error } = await depois.json();
  assert.match(error, /encerrado/i, `mensagem: "${error}"`);
  assert.doesNotMatch(error, /inválid/i, "senha certa não pode virar 'senha inválida'");

  // e o token que ele já tinha não vale mais
  const comTokenAntigo = await fetch(`${B}/portal/me`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(comTokenAntigo.status, 403, "quem estava logado sai na hora, sem esperar o token expirar");
});

test("reativar traz o cliente de volta inteiro", async () => {
  const { id } = novoCliente("Voltou Ltda", true);
  await fetch(`${B}/clients/${id}/arquivar`, { method: "POST", headers: H, body: JSON.stringify({}) });
  assert.ok(!(await lista()).includes("Voltou Ltda"));

  const r = await fetch(`${B}/clients/${id}/reativar`, { method: "POST", headers: H });
  assert.equal(r.status, 200);
  assert.ok((await lista()).includes("Voltou Ltda"));

  const login = await fetch(`${B}/portal/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "voltou ltda", password: "segredo123" }) });
  assert.equal(login.status, 200, "o acesso dele volta junto");
});

test("excluir de vez exige arquivar antes E digitar o nome", async () => {
  const { id, caminho } = novoCliente("Para Apagar");

  const semArquivar = await fetch(`${B}/clients/${id}`, { method: "DELETE", headers: H });
  assert.equal(semArquivar.status, 400);
  assert.match((await semArquivar.json()).error, /Arquive o cliente antes/);
  assert.ok(db.prepare("SELECT id FROM clients WHERE id = ?").get(id), "não apagou");

  await fetch(`${B}/clients/${id}/arquivar`, { method: "POST", headers: H, body: JSON.stringify({}) });

  const nomeErrado = await fetch(`${B}/clients/${id}?confirmar=para apagar`, { method: "DELETE", headers: H });
  assert.equal(nomeErrado.status, 400, "o nome tem que bater exatamente");
  assert.ok(db.prepare("SELECT id FROM clients WHERE id = ?").get(id), "continua lá");

  const certo = await fetch(`${B}/clients/${id}?confirmar=${encodeURIComponent("Para Apagar")}`, { method: "DELETE", headers: H });
  assert.equal(certo.status, 200);
  assert.equal(db.prepare("SELECT id FROM clients WHERE id = ?").get(id), undefined);
  assert.equal(existsSync(caminho), false, "e os arquivos saem da nuvem junto, em vez de ficarem lá sendo cobrados");
});

test("o resumo diz o que existe, para a tela não prometer nada errado", async () => {
  const { id } = novoCliente("Com Material");
  const r = await fetch(`${B}/clients/${id}/resumo`, { headers: H });
  const resumo = await r.json();
  assert.equal(resumo.arquivos, 1);
  assert.equal(resumo.contratos, 1);
  assert.equal(resumo.lancamentos, 1);
  assert.equal(resumo.em_aberto, 2500, "o que ele ainda deve aparece antes de encerrar");
});

test("projeto de outro cliente não entra na ficha de encerramento", async () => {
  const { id } = novoCliente("Cliente A");
  const { id: outro } = novoCliente("Cliente B");
  const projetoDoOutro = db.prepare("INSERT INTO projects (name, client_id, org_id) VALUES ('Projeto B',?,?)")
    .run(outro, org).lastInsertRowid;
  const r = await fetch(`${B}/clients/${id}/arquivar`, { method: "POST", headers: H,
    body: JSON.stringify({ ultimo_projeto_id: projetoDoOutro }) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /não é deste cliente/i);
});
