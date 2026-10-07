// ENTREGAS: O PLANO DO PROJETO, MÊS A MÊS.
//
// Palavras dela: "quero que aqui esteja vinculado com os projetos, que lá no
// projeto a gente determina quantidade de cada coisa que entra por mês. E daí
// aqui eu quero ter a visualização do que já foi entregue daquele respectivo
// mês... uma linha correspondente para post, uma para carrossel, uma para
// reel... Só vai ficar concluído o que já está programado."
//
// Três regras saíram daí, e cada uma muda um número que ela olha:
//
//   · ENTREGUE = na etapa final E com data no mês. Antes bastava ter data —
//     mas marcar a data é intenção, não entrega.
//   · O PLANEJADO vem só de projeto vivo. Encerrado cobrava para sempre.
//   · A conta é POR TIPO, e o que falta é a soma do que falta em cada tipo:
//     entregar reel a mais não cobre o post que não saiu.
//
// E um erro que ninguém tinha visto: a tarefa do "Lançar mês" nasce AGRUPADA
// (quantity = 4 numa linha só) e só se abre em peças individuais quando chega
// na Distribuição. Contando linhas, quatro reels valiam um.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-entregas-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const reports = (await import("../src/routes/reports.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa das Entregas',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@e.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Von Saltiel','active',?)").run(org).lastInsertRowid;
const criacao = db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Criação',0,0,?)").run(org).lastInsertRowid;
const programados = db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Programados',5,1,?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/reports", reports);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/reports`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

const MES = "2026-10";
const entregas = async (mes = MES) =>
  (await fetch(`${B}/deliveries?month=${mes}`, { headers: H })).json();
const doVon = async (mes = MES) => (await entregas(mes)).find((d) => d.client_name === "Von Saltiel");
const tipo = (d, t) => d.tipos.find((x) => x.content_type === t);

// O plano: 8 posts, 4 reels, 2 carrosséis por mês.
const proj = db.prepare("INSERT INTO projects (name,client_id,status,org_id) VALUES ('Plano mensal',?,'active',?)")
  .run(cli, org).lastInsertRowid;
const planItem = db.prepare("INSERT INTO plan_items (org_id,project_id,content_type,quantity) VALUES (?,?,?,?)");
planItem.run(org, proj, "post", 8);
planItem.run(org, proj, "reel", 4);
planItem.run(org, proj, "carrossel", 2);

const novaPeca = ({ tipo, qtd = 1, etapa = criacao, data = null, concluida = false, ref = null }) => {
  const id = db.prepare(
    `INSERT INTO tasks (title,client_id,stage_id,content_type,quantity,scheduled_at,completed_at,ref_month,org_id)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(`${tipo}`, cli, etapa, tipo, qtd, data, concluida ? "2026-10-01 10:00" : null, ref, org);
  return id.lastInsertRowid;
};

test("o planejado vem do plano do projeto, separado por tipo", async () => {
  const d = await doVon();
  assert.equal(d.planejado, 14, "8 + 4 + 2");
  assert.equal(tipo(d, "post").planejado, 8);
  assert.equal(tipo(d, "reel").planejado, 4);
  assert.equal(tipo(d, "carrossel").planejado, 2);
});

test("peça com data mas parada em Criação NÃO conta como entregue", async () => {
  novaPeca({ tipo: "post", data: "2026-10-09 09:00" });
  const d = await doVon();
  assert.equal(d.entregues, 0, "marcar a data é intenção, não entrega");
  assert.equal(d.em_producao, 1);
});

test("movida para Programados, aí sim conta", async () => {
  const id = novaPeca({ tipo: "post", data: "2026-10-10 09:00" });
  db.prepare("UPDATE tasks SET stage_id=?, completed_at='2026-10-02 10:00' WHERE id=?").run(programados, id);
  const d = await doVon();
  assert.equal(tipo(d, "post").entregue, 1);
  assert.equal(tipo(d, "post").falta, 7);
});

test("a tarefa AGRUPADA vale pela quantidade, não por uma linha", async () => {
  // É assim que o "Lançar mês" cria: um reel ×4, que só se abre na Distribuição.
  const id = novaPeca({ tipo: "reel", qtd: 4, data: "2026-10-12 09:00" });
  db.prepare("UPDATE tasks SET stage_id=?, completed_at='2026-10-03 10:00' WHERE id=?").run(programados, id);
  const d = await doVon();
  assert.equal(tipo(d, "reel").entregue, 4, "quatro reels, não um");
  assert.equal(tipo(d, "reel").falta, 0);
});

test("o que falta é a soma do que falta em cada tipo", async () => {
  const d = await doVon();
  // post 1/8, reel 4/4, carrossel 0/2 → faltam 7 + 0 + 2
  assert.equal(d.falta, 9, "reel sobrando não cobre post que não saiu");
});

test("entrega de um mês não aparece no outro", async () => {
  const d = await doVon("2026-11");
  assert.equal(d.entregues, 0);
  assert.equal(d.planejado, 14, "o plano é mensal: vale para novembro também");
});

test("peça entregue de um tipo fora do plano aparece, marcada", async () => {
  const id = novaPeca({ tipo: "stories", data: "2026-10-14 09:00" });
  db.prepare("UPDATE tasks SET stage_id=?, completed_at='2026-10-04 10:00' WHERE id=?").run(programados, id);
  const d = await doVon();
  const s = tipo(d, "stories");
  assert.equal(s.entregue, 1);
  assert.equal(s.planejado, 0);
  assert.equal(s.fora_do_plano, true, "é informação: foi entregue sem estar combinado");
  assert.equal(s.falta, 0, "o que não foi planejado não pode 'faltar'");
});

test("projeto encerrado para de cobrar", async () => {
  const outro = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Encerrado','active',?)").run(org).lastInsertRowid;
  const p2 = db.prepare("INSERT INTO projects (name,client_id,status,org_id) VALUES ('Antigo',?,'done',?)")
    .run(outro, org).lastInsertRowid;
  planItem.run(org, p2, "post", 10);
  const lista = await entregas();
  assert.ok(!lista.some((d) => d.client_name === "Encerrado"),
    "projeto encerrado continuava somando e inflava o que faltava para sempre");
});

test("projeto com prazo só conta nos meses do prazo", async () => {
  const c3 = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Campanha','active',?)").run(org).lastInsertRowid;
  const p3 = db.prepare(
    "INSERT INTO projects (name,client_id,status,start_date,end_date,org_id) VALUES ('Campanha de verão',?,'active','2026-12-01','2027-02-28',?)"
  ).run(c3, org).lastInsertRowid;
  planItem.run(org, p3, "post", 5);

  assert.ok(!(await entregas("2026-10")).some((d) => d.client_name === "Campanha"), "antes de começar");
  assert.ok((await entregas("2026-12")).some((d) => d.client_name === "Campanha"), "dentro do prazo");
  assert.ok(!(await entregas("2027-03")).some((d) => d.client_name === "Campanha"), "depois de acabar");
});

// --- o que a tela promete -----------------------------------------------------

const tela = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/pages/Deliveries.jsx"), "utf8");

test("o balão inteiro abre, não só o nome", () => {
  assert.match(tela, /onClick=\{\(\) => setAberto\(\(v\) => \(v === d\.id \? null : d\.id\)\)\}/);
  assert.match(tela, /<Collapse in=\{estaAberto\}/);
  assert.match(tela, /e\.stopPropagation\(\); navigate\("\/tasks"\)/,
    "o botão de ir ao quadro não pode abrir/fechar o balão junto");
});

test("a tela tem as setas de mês", () => {
  assert.match(tela, /andarMes\(m, -1\)/);
  assert.match(tela, /andarMes\(m, 1\)/);
  assert.match(tela, /type="month"/, "e o campo para pular para um mês distante");
});

test("e diz a regra, em vez de deixar a pessoa adivinhar", () => {
  assert.match(tela, /Programados.*com data neste mês/s);
  assert.match(tela, /plano mensal de/);
});
