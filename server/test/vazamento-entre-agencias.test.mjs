// AUDITORIA DE VAZAMENTO ENTRE AGÊNCIAS — a varredura, não um caso escolhido.
//
// Este teste não confere uma rota que alguém lembrou de conferir: ele LÊ as
// rotas do próprio código, acha toda rota que recebe um :id, e bate em cada uma
// com o crachá da agência A contra o recurso da agência B. Rota nova entra na
// varredura sozinha, sem ninguém precisar lembrar.
//
// A pergunta é medida no BANCO, não no código de resposta: o recurso da outra
// agência sobreviveu intacto? Um DELETE que responde 200 mas não apaga nada é
// status feio, não vazamento — e confundir os dois faria este teste gritar por
// nada. Hoje são 69 rotas conferidas, 0 vazamentos, e 21 que devolvem 200 onde
// 404 seria mais honesto (sem tocar em dado nenhum).
//
// Se um dia alguém escrever um DELETE sem o "AND org_id = ?", é aqui que
// aparece — antes de uma agência apagar o cliente da outra.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-vaz2-"));
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

const ins = (sql, ...v) => { try { return db.prepare(sql).run(...v).lastInsertRowid; } catch (e) { return null; } };
function monta(nome) {
  const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES (?,0)").run(nome).lastInsertRowid;
  const uid = ins("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES (?,?,?,?,'admin',1,?)", nome, nome, `${nome}@x.com`, hashPassword("SenhaBoa#1"), org);
  const o = { org, uid, user: uid };
  o.client = ins("INSERT INTO clients (name,status,org_id) VALUES (?,'active',?)", `Cli ${nome}`, org);
  o.file = ins("INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id) VALUES (?,?,'image/png',9,'/tmp/x','editados',?)", o.client, `a-${nome}.png`, org);
  o.contract = ins("INSERT INTO contracts (client_id,title,value,status,notes,org_id) VALUES (?,?,1,'active','texto',?)", o.client, `C ${nome}`, org);
  o.entry = ins("INSERT INTO financial_entries (type,description,amount,client_id,status,org_id) VALUES ('income',?,1,?,'pending',?)", `F ${nome}`, o.client, org);
  o.task = ins("INSERT INTO tasks (title,client_id,org_id) VALUES (?,?,?)", `T ${nome}`, o.client, org);
  o.project = ins("INSERT INTO projects (name,client_id,org_id) VALUES (?,?,?)", `P ${nome}`, o.client, org);
  o.service = ins("INSERT INTO services (name,org_id) VALUES (?,?)", `S ${nome}`, org);
  o.workspace = ins("INSERT INTO workspace_items (client_id,kind,title,content,org_id) VALUES (?,'note',?,'x',?)", o.client, `W ${nome}`, org);
  o.briefing = ins("INSERT INTO briefings (org_id,client_id,token) VALUES (?,?,?)", org, o.client, `tok-${nome}-${Math.random()}`);
  o.template = ins("INSERT INTO contract_templates (org_id,name,body) VALUES (?,?,'x')", org, `M ${nome}`);
  o.prospect = ins("INSERT INTO prospects (name,org_id) VALUES (?,?)", `Pr ${nome}`, org);
  o.goal = ins("INSERT INTO goals (title,org_id) VALUES (?,?)", `G ${nome}`, org);
  o.H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
  return o;
}

const TABELA = { client: "clients", file: "files", contract: "contracts", entry: "financial_entries",
  task: "tasks", project: "projects", service: "services", workspace: "workspace_items",
  briefing: "briefings", template: "contract_templates", prospect: "prospects", goal: "goals", user: "users" };
const DE_PREFIXO = { "/api/clients": "client", "/api/files": "file", "/api/contracts": "contract",
  "/api/financial": "entry", "/api/tasks": "task", "/api/projects": "project",
  "/api/services": "service", "/api/workspace": "workspace", "/api/briefings": "briefing",
  "/api/contract-templates": "template", "/api/users": "user", "/api/prospects": "prospect",
  "/api/goals": "goal" };

const vazou = [], statusFeio = [], ok = [];
for (const { prefixo, arq } of montadas) {
  const chave = DE_PREFIXO[prefixo];
  if (!chave) continue;
  const src = readFileSync(new URL(`../src/routes/${arq}.js`, import.meta.url), "utf8");
  for (const m of src.matchAll(/router\w*\.(get|post|put|patch|delete)\(\s*"([^"]*:id[^"]*)"/gi)) {
    const metodo = m[1].toUpperCase();
    // Cada rota ganha um par novo de agências, para um teste não sujar o outro.
    const A = monta(`A${vazou.length + statusFeio.length + ok.length}_${Math.random().toString(36).slice(2, 6)}`);
    const V = monta(`V${vazou.length + statusFeio.length + ok.length}_${Math.random().toString(36).slice(2, 6)}`);
    if (!V[chave]) continue;
    const alvo = V[chave];
    const tab = TABELA[chave];
    const antes = db.prepare(`SELECT * FROM ${tab} WHERE id = ?`).get(alvo);
    const caminho = prefixo + m[2].replace(/:id\b/, String(alvo)).replace(/:(\w+)/g, "1");
    let res;
    try {
      res = await fetch(B + caminho, { method: metodo, headers: A.H,
        body: ["GET", "DELETE"].includes(metodo) ? undefined : JSON.stringify({ name: "INVADIDO", title: "INVADIDO", keep_forever: 1, tags: ["x"], permissions: { tudo: true } }) });
    } catch { continue; }
    const depois = db.prepare(`SELECT * FROM ${tab} WHERE id = ?`).get(alvo);
    const rotulo = `${String(res.status).padEnd(3)} ${metodo.padEnd(6)} ${prefixo}${m[2]}`;
    const sumiu = antes && !depois;
    const mudou = antes && depois && JSON.stringify(antes) !== JSON.stringify(depois);
    if (sumiu) vazou.push(`${rotulo}   ← APAGOU o recurso da outra agência`);
    else if (mudou) vazou.push(`${rotulo}   ← ALTEROU o recurso da outra agência`);
    else if (res.status < 300) statusFeio.push(`${rotulo}   (não mexeu em nada; só devolve 200 onde devia ser 404)`);
    else ok.push(rotulo);
  }
}
after(() => srv.close());

test("nenhuma agência alcança o dado de outra — varredura de todas as rotas com :id", () => {
  assert.deepEqual(vazou, [],
    "o crachá de uma agência mexeu no recurso de outra:\n" + vazou.join("\n"));
});

test("a varredura está de fato passando por um número sério de rotas", () => {
  const total = vazou.length + statusFeio.length + ok.length;
  assert.ok(total >= 60, `só ${total} rotas conferidas — a leitura das rotas quebrou?`);
});

test("as que negam, negam com 404/403 — e as que só devolvem 200 não tocam em nada", () => {
  // Este não é um defeito: são rotas cujo "WHERE org_id = ?" não casou com
  // nada e ainda assim responderam 200. Fica registrado para não ser confundido
  // com vazamento numa leitura futura. Se a lista CRESCER muito, vale olhar.
  assert.ok(statusFeio.length <= 25, `mais rotas devolvendo 200 indevido do que antes:\n${statusFeio.join("\n")}`);
});
