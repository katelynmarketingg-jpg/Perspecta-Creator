// DISTRIBUIÇÃO: UM MÊS DE CADA VEZ.
//
// "a parte de distribuição ainda tá bem perdida, tenta organizar, pra ter como
// filtrar por mês, talvez que apareça menor cada post com suas respectivas
// legendas, que tenha como apagar e editar independente de qual tipo de
// visualização... que sempre abra do mês que estamos, mas que possamos filtrar
// outros meses" — e, logo depois: "ainda tá demorando muito pra carregar".
//
// São o mesmo problema. A tela trazia TODAS as peças de TODOS os meses, e a
// lista do panorama trazia tudo de novo. Medido com 504 peças: 994 KB de
// resposta, 1008 linhas. Com o mês: 142 KB, 144 linhas.
//
// O que ainda não tem data continua aparecendo sempre: é a fila de preparação,
// não pertence a mês nenhum até alguém marcar o dia.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "pc-distmes-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const distribution = (await import("../src/routes/distribution.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Mês',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@m.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Von Saltiel','active',?)").run(org).lastInsertRowid;
const dist = db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Distribuição',3,0,?)").run(org).lastInsertRowid;
const prog = db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Programados',5,1,?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/distribution", distribution);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/distribution`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

const peca = ({ titulo, quando = null, ref = null, etapa = dist, aprov = "pending" }) => db.prepare(
  `INSERT INTO tasks (title,stage_id,client_id,content_type,scheduled_at,ref_month,approval_status,org_id)
   VALUES (?,?,?,'post',?,?,?,?)`
).run(titulo, etapa, cli, quando, ref, aprov, org).lastInsertRowid;

const pedir = async (qs = "") => (await fetch(`${B}${qs}`, { headers: H })).json();
const titulos = (d) => Object.values(d).filter(Array.isArray).flat().map((t) => t.title);

peca({ titulo: "De outubro", quando: "2026-10-09 09:00" });
peca({ titulo: "De novembro", quando: "2026-11-09 09:00" });
peca({ titulo: "Aprovada de outubro", quando: "2026-10-15 09:00", aprov: "approved" });
peca({ titulo: "Programada de novembro", quando: "2026-11-20 09:00", etapa: prog, aprov: "approved" });
peca({ titulo: "Sem data nenhuma" });
peca({ titulo: "Da produção de novembro", ref: "2026-11" });

test("pedindo outubro, novembro não vem junto", async () => {
  const d = await pedir("?month=2026-10");
  const t = titulos(d);
  assert.ok(t.includes("De outubro"));
  assert.ok(t.includes("Aprovada de outubro"));
  assert.ok(!t.includes("De novembro"), "era isto que trazia o ano inteiro de uma vez");
  assert.ok(!t.includes("Programada de novembro"));
});

test("o que ainda não tem data aparece em qualquer mês", async () => {
  // É a fila de preparação: não pertence a mês nenhum até marcarem o dia.
  for (const m of ["2026-10", "2026-11", "2027-03"]) {
    assert.ok(titulos(await pedir(`?month=${m}`)).includes("Sem data nenhuma"), `sumiu em ${m}`);
  }
});

test("sem data, mas com mês de produção, só aparece no mês dele", async () => {
  assert.ok(titulos(await pedir("?month=2026-11")).includes("Da produção de novembro"));
  assert.ok(!titulos(await pedir("?month=2026-10")).includes("Da produção de novembro"));
});

test("o panorama também é do mês — era ele o maior peso", async () => {
  const d = await pedir("?month=2026-10");
  const datas = d.scheduled.map((t) => String(t.scheduled_at).slice(0, 7));
  assert.ok(datas.every((m) => m === "2026-10"), `veio ${[...new Set(datas)]}`);
});

test("sem mês pedido, continua trazendo tudo (quem chama velho não quebra)", async () => {
  const t = titulos(await pedir(""));
  assert.ok(t.includes("De outubro") && t.includes("De novembro"));
});

test("mês escrito errado não filtra nada — não devolve vazio por engano", async () => {
  assert.ok(titulos(await pedir("?month=outubro")).includes("De outubro"));
});

// --- o que a tela promete -----------------------------------------------------

const tela = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/pages/Distribution.jsx"), "utf8");

test("a tela abre no mês de hoje e tem as setas", () => {
  assert.match(tela, /useState\(\(\) => new Date\(\)\.toISOString\(\)\.slice\(0, 7\)\)/);
  assert.match(tela, /andarMes\(m, -1\)/);
  assert.match(tela, /andarMes\(m, 1\)/);
  assert.match(tela, /setMes\(hojeEmMes\(\)\)/, "e o atalho de voltar para hoje");
  assert.match(tela, /params = \{ month: mes/, "o mês vai para o servidor");
  assert.match(tela, /\[clientFilter, mes, vTasks, vDist\]/, "e trocar de mês recarrega");
});

test("legenda e os dois botões em toda visualização", () => {
  assert.match(tela, /function AcoesDaPeca/);
  // compacto
  const compacto = tela.slice(tela.indexOf("function CartaoCompacto"), tela.indexOf("function PorMes"));
  assert.match(compacto, /item\.caption \|\| "sem legenda"/);
  assert.match(compacto, /<AcoesDaPeca/);
  // lista
  const lista = tela.slice(tela.indexOf("function ListView"), tela.indexOf("const GRADE = {"));
  assert.match(lista, /it\.caption \|\| "sem legenda"/);
  assert.match(lista, /<AcoesDaPeca/);
  // e as duas recebem o apagar de verdade
  assert.match(tela, /<CartaoCompacto item=\{it\} onSelect=\{setSelected\} onApagar=\{apagarPeca\} \/>/);
  assert.match(tela, /<ListView items=\{scheduled\} onSelect=\{setSelected\} onApagar=\{apagarPeca\}/);
});

test("programar para outro mês avisa para onde a peça foi", () => {
  const f = tela.slice(tela.indexOf("async function programar"), tela.indexOf("function toggleCheck"));
  assert.match(f, /outroMes/);
  assert.match(f, /está em \$\{nomeDoMes/);
});
