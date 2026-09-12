// AUDITORIA DO ID QUE VIAJA NO CORPO — a varredura, não um caso escolhido.
//
// A outra varredura (vazamento-entre-agencias) troca o id do ENDEREÇO. Esta
// cuida do ponto cego dela: o id de CLIENTE que chega no CORPO do pedido.
//
// Ela lê as rotas do próprio código, sobe o app inteiro, cria duas agências e,
// para cada rota de escrita que mexe com cliente, tenta amarrar ao cliente da
// OUTRA. E a pergunta é medida no BANCO — alguma das 20 tabelas com client_id
// ficou com uma linha desta agência apontando para o cliente da outra? — e não
// no código de resposta, porque muita rota responde 200 sem gravar nada.
//
// Rota nova entra na varredura sozinha, sem ninguém precisar lembrar.
//
// O que isto pegou quando foi escrita: tarefa, cobrança, projeto, evento e
// contrato (a cobrança aparecia na Área do Cliente da outra agência), mais
// pasta da galeria, planejamento, documento de planejamento e prioridade.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "pc-varre2-"));
process.env.DB_PATH = join(dir, "t.db");
process.env.UPLOADS_DIR = join(dir, "up");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;

const indexSrc = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const importados = {};
for (const m of indexSrc.matchAll(/import\s+(?:(\w+)|\{([^}]+)\})\s+from\s+"\.\/routes\/([\w-]+)\.js"/g)) {
  const arq = m[3];
  if (m[1]) importados[m[1]] = { arq, nomeado: null };
  for (const nome of (m[2] || "").split(",")) {
    const p = nome.split(" as ").map((x) => x.trim());
    if (p[0]) importados[p[1] || p[0]] = { arq, nomeado: p[0] };
  }
}
const app = express();
app.use(express.json({ limit: "15mb" }));
const montadas = [];
for (const m of indexSrc.matchAll(/app\.use\("(\/api\/[^"]+)",\s*(\w+)\)/g)) {
  const info = importados[m[2]];
  if (!info) continue;
  const mod = await import(`../src/routes/${info.arq}.js`);
  const r = info.nomeado ? mod[info.nomeado] : mod.default;
  if (r) { app.use(m[1], r); montadas.push({ prefixo: m[1], arq: info.arq }); }
}
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}`;

function monta(nome) {
  const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES (?,0)").run(nome).lastInsertRowid;
  const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES (?,?,?,?,'admin',1,?)")
    .run(nome, nome, `${nome}@x.com`, hashPassword("SenhaBoa#1"), org).lastInsertRowid;
  const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES (?,'active',?)").run(`Cli ${nome}`, org).lastInsertRowid;
  return { org, cli, H: { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" } };
}
const A = monta("AgA"), V = monta("AgB");

// Todas as tabelas que têm client_id E org_id.
const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name)
  .filter((t) => {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    return cols.includes("client_id") && cols.includes("org_id");
  });

function foraDeCasa() {
  const achados = [];
  for (const t of tabelas) {
    const n = db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE org_id = ? AND client_id = ?`).get(A.org, V.cli).n;
    if (n) achados.push(`${t}(${n})`);
  }
  return achados;
}

const corpo = {
  client_id: V.cli, title: "sonda", name: "sonda", description: "sonda", date: "2026-10-01",
  start_at: "2026-10-01 10:00", ym: "2026-10", content: "x", amount: 10, value: 10,
  type: "income", kind: "note", label: "sonda", text: "sonda", message: "sonda", entry_id: 1,
};

const furos = [];
for (const { prefixo, arq } of montadas) {
  const src = readFileSync(new URL(`../src/routes/${arq}.js`, import.meta.url), "utf8");
  if (!/client_id/.test(src)) continue;
  for (const m of src.matchAll(/router\w*\.(post|put|patch)\(\s*"([^"]*)"/gi)) {
    const metodo = m[1].toUpperCase();
    const caminho = prefixo + m[2].replace(/:(\w+)/g, "1");
    if (/\/login|\/upload|arquivos/.test(caminho)) continue;
    const antes = foraDeCasa().join(",");
    try { await fetch(B + caminho, { method: metodo, headers: A.H, body: JSON.stringify(corpo) }); } catch { continue; }
    const depois = foraDeCasa().join(",");
    if (depois !== antes) furos.push(`${metodo.padEnd(5)} ${prefixo}${m[2]}   → gravou em ${depois}`);
  }
}
after(() => srv.close());

test("nenhuma rota grava o cliente de outra agência a partir do corpo do pedido", () => {
  assert.deepEqual(furos, [],
    "uma agência conseguiu amarrar dado dela ao cliente de outra:\n" + furos.join("\n"));
});

test("a varredura está mesmo olhando as tabelas que importam", () => {
  assert.ok(tabelas.length >= 15, `só ${tabelas.length} tabelas com client_id — a leitura do banco quebrou?`);
  for (const esperada of ["tasks", "financial_entries", "projects", "planning_dates", "priorities", "folders"]) {
    assert.ok(tabelas.includes(esperada), `faltou conferir a tabela ${esperada}`);
  }
});
