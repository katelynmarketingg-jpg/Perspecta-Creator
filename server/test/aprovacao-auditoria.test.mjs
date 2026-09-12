// AUDITORIA — Etapa 6: aprovação. O que a agência manda, o que o cliente vê,
// o que ele responde, e se os dois lados contam a mesma história.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-apr-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const distribution = (await import("../src/routes/distribution.js")).default;
const portalRoutes = (await import("../src/routes/portal.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Aprovação',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@apr.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare(
  "INSERT INTO clients (name,status,org_id,portal_username,portal_password_hash) VALUES ('Marcelo','active',?,'marcelo',?)"
).run(org, hashPassword("segredo123")).lastInsertRowid;

db.prepare("INSERT INTO kanban_stages (name,position,is_done,org_id) VALUES ('Distribuição',4,0,?)").run(org);
const etapaDist = db.prepare("SELECT id FROM kanban_stages WHERE name='Distribuição' AND org_id=?").get(org).id;

const arq = join(dir, "arte.png");
writeFileSync(arq, Buffer.alloc(128, 9));
const arte = () => db.prepare(
  `INSERT INTO files (client_id,original_name,mime,size,stored_path,stage,org_id)
   VALUES (?, 'arte.png','image/png',128,?,'editados',?)`
).run(cli, arq, org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/distribution", distribution);
app.use("/api/portal", portalRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

const { token: portal } = await fetch(`${B}/portal/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "marcelo", password: "segredo123" }),
}).then((r) => r.json());
const P = { "content-type": "application/json", authorization: `Bearer ${portal}` };

const req = (m, u, corpo, cab) => fetch(B + u, {
  method: m, headers: cab, body: corpo ? JSON.stringify(corpo) : undefined,
}).then(async (r) => ({ st: r.status, ...(await r.json().catch(() => ({}))) }));

let n = 0;
function novaPeca({ comArte = true, data = "2026-10-15 10:00", tipo = "post" } = {}) {
  const id = db.prepare(
    "INSERT INTO tasks (title,content_type,client_id,org_id,approval_status,stage_id,scheduled_at) VALUES (?,?,?,?,'pending',?,?)"
  ).run(`Peça ${++n}`, tipo, cli, org, etapaDist, data).lastInsertRowid;
  if (comArte) db.prepare("INSERT INTO task_attachments (task_id,file_id) VALUES (?,?)").run(id, arte());
  return id;
}

test("peça sem data não é enviada para o cliente", async () => {
  const id = novaPeca({ data: null });
  const r = await req("POST", `/distribution/${id}/send`, null, H);
  assert.equal(r.st, 400);
  assert.match(r.error, /data/i);
});

test("peça sem arte não é enviada — o cliente aprovaria o quê?", async () => {
  const id = novaPeca({ comArte: false });
  const r = await req("POST", `/distribution/${id}/send`, null, H);
  assert.equal(r.st, 400);
  assert.match(r.error, /foto|vídeo|arte/i);
});

test("enviada, a peça continua visível para a agência — não some da tela", async () => {
  const id = novaPeca();
  assert.equal((await req("POST", `/distribution/${id}/send`, null, H)).st, 200);
  const d = await fetch(`${B}/distribution`, { headers: H }).then((r) => r.json());
  const achada = (d.waiting || []).find((x) => x.id === id);
  assert.ok(achada, "tem que aparecer em 'Para aprovação'");
  assert.equal(achada.approval_status, "sent");
});

test("o cliente vê a peça na fila dele, e só depois de enviada", async () => {
  const id = novaPeca();
  const antes = await fetch(`${B}/portal/approvals`, { headers: P }).then((r) => r.json());
  assert.ok(!antes.some((x) => x.id === id), "antes de enviar, não aparece para ele");
  await req("POST", `/distribution/${id}/send`, null, H);
  const depois = await fetch(`${B}/portal/approvals`, { headers: P }).then((r) => r.json());
  assert.ok(depois.some((x) => x.id === id), "depois de enviar, aparece");
});

test("aprovar muda o estado dos DOIS lados e avisa a agência", async () => {
  const id = novaPeca();
  await req("POST", `/distribution/${id}/send`, null, H);
  const r = await req("POST", `/portal/approvals/${id}/approve`, {}, P);
  assert.equal(r.st, 200);
  assert.equal(db.prepare("SELECT approval_status FROM tasks WHERE id=?").get(id).approval_status, "approved");
  const d = await fetch(`${B}/distribution`, { headers: H }).then((x) => x.json());
  assert.ok((d.approved || []).some((x) => x.id === id), "entra na fila de aprovados da agência");
  const aviso = db.prepare("SELECT COUNT(*) n FROM notifications WHERE audience='agency' AND client_id=? AND task_id=?").get(cli, id).n;
  assert.ok(aviso >= 1, "a agência precisa ser avisada");
});

test("pedir ajuste guarda o RECADO e devolve a peça para a agência", async () => {
  const id = novaPeca();
  await req("POST", `/distribution/${id}/send`, null, H);
  const r = await req("POST", `/portal/approvals/${id}/request-changes`, { client_note: "Trocar a foto do meio, por favor." }, P);
  assert.equal(r.st, 200);
  const t = db.prepare("SELECT approval_status, client_note FROM tasks WHERE id=?").get(id);
  assert.equal(t.approval_status, "changes_requested");
  assert.match(t.client_note, /Trocar a foto do meio/);
  const d = await fetch(`${B}/distribution`, { headers: H }).then((x) => x.json());
  const achada = (d.waiting || []).concat(d.items || []).find((x) => x.id === id);
  assert.ok(achada, "a agência precisa ver que ele pediu ajuste");
});

test("aprovar duas vezes não duplica aviso nem muda de novo", async () => {
  const id = novaPeca();
  await req("POST", `/distribution/${id}/send`, null, H);
  await req("POST", `/portal/approvals/${id}/approve`, {}, P);
  const antes = db.prepare("SELECT COUNT(*) n FROM notifications WHERE task_id=?").get(id).n;
  await req("POST", `/portal/approvals/${id}/approve`, {}, P);
  const depois = db.prepare("SELECT COUNT(*) n FROM notifications WHERE task_id=?").get(id).n;
  assert.equal(db.prepare("SELECT approval_status FROM tasks WHERE id=?").get(id).approval_status, "approved");
  assert.ok(depois - antes <= 1, `duplicou aviso: ${antes} → ${depois}`);
});

test("o cliente não aprova peça que nunca foi enviada a ele", async () => {
  // Com um id conhecido, dava para aprovar conteúdo ainda em produção — e no
  // modo automático isso ia direto para "Programados", ou seja, para o ar.
  const id = novaPeca();
  const r = await fetch(`${B}/portal/approvals/${id}/approve`, { method: "POST", headers: P, body: "{}" });
  assert.equal(r.status, 409, "tem que recusar");
  assert.equal(db.prepare("SELECT approval_status FROM tasks WHERE id=?").get(id).approval_status, "pending");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE task_id=?").get(id).n, 0,
    "e não pode avisar a agência de uma aprovação que não houve");
});

test("pedir ajuste em peça não enviada também é recusado", async () => {
  const id = novaPeca();
  const r = await fetch(`${B}/portal/approvals/${id}/request-changes`, {
    method: "POST", headers: P, body: JSON.stringify({ client_note: "muda isso" }),
  });
  assert.equal(r.status, 409);
  assert.equal(db.prepare("SELECT client_note FROM tasks WHERE id=?").get(id).client_note, null);
});

test("um aviso de 'conteúdo para aprovar' por cliente, com a contagem certa", async () => {
  db.prepare("DELETE FROM notifications WHERE audience='client' AND client_id=?").run(cli);
  const a = novaPeca(); const b = novaPeca();
  await req("POST", `/distribution/${a}/send`, null, H);
  await req("POST", `/distribution/${b}/send`, null, H);
  const avisos = db.prepare(
    "SELECT message FROM notifications WHERE audience='client' AND client_id=? AND is_read=0"
  ).all(cli);
  assert.equal(avisos.length, 1, `um aviso só, veio ${avisos.length}: ${avisos.map((x) => x.message).join(" | ")}`);
  assert.match(avisos[0].message, /\d+ conteúdos? para aprovar/);
});

test("programar tira da fila de aprovados e marca como concluído", async () => {
  const id = novaPeca();
  await req("POST", `/distribution/${id}/send`, null, H);
  await req("POST", `/portal/approvals/${id}/approve`, {}, P);
  const r = await req("POST", `/distribution/${id}/schedule`, { scheduled_at: "2026-10-20 09:00" }, H);
  assert.equal(r.st, 200);
  const d = await fetch(`${B}/distribution`, { headers: H }).then((x) => x.json());
  assert.ok(!(d.approved || []).some((x) => x.id === id), "sai da fila de aprovados");
  assert.ok((d.programmed || []).some((x) => x.id === id), "entra em programados");
});

test("programar sem data é recusado", async () => {
  const id = novaPeca({ data: null });
  db.prepare("UPDATE tasks SET approval_status='approved' WHERE id=?").run(id);
  const r = await req("POST", `/distribution/${id}/schedule`, {}, H);
  assert.equal(r.st, 400);
});

// ---------------------------------------------------------------------------
// A VOLTA INTEIRA — é isso que acontece toda semana, não o caso feliz:
// manda, o cliente pede ajuste, a agência conserta e manda de novo, ele aprova.
// Se algum estado ficar preso no meio, a peça some da vista de alguém.
// ---------------------------------------------------------------------------

test("manda, pede ajuste, manda de novo, aprova — sem ficar preso no caminho", async () => {
  const id = novaPeca();
  const estado = () => db.prepare("SELECT approval_status, client_note FROM tasks WHERE id=?").get(id);

  assert.equal((await req("POST", `/distribution/${id}/send`, null, H)).st, 200);
  assert.equal(estado().approval_status, "sent");

  const ajuste = await req("POST", `/portal/approvals/${id}/request-changes`, { client_note: "A legenda está errada." }, P);
  assert.equal(ajuste.st, 200);
  assert.equal(estado().approval_status, "changes_requested");

  // A agência conserta e manda de novo. Este é o passo que costuma faltar:
  // reenviar uma peça que voltou com pedido de ajuste tem que ser permitido.
  const reenvio = await req("POST", `/distribution/${id}/send`, null, H);
  assert.equal(reenvio.st, 200, `não deu para reenviar depois do ajuste: ${JSON.stringify(reenvio)}`);
  assert.equal(estado().approval_status, "sent", "reenviada, volta a esperar o cliente");

  const aprovada = await req("POST", `/portal/approvals/${id}/approve`, {}, P);
  assert.equal(aprovada.st, 200);
  assert.equal(estado().approval_status, "approved");

  const d = await fetch(`${B}/distribution`, { headers: H }).then((x) => x.json());
  assert.ok((d.approved || []).some((x) => x.id === id), "termina na fila de aprovados");
});

test("na volta, o cliente vê a peça de novo na fila dele", async () => {
  const id = novaPeca();
  await req("POST", `/distribution/${id}/send`, null, H);
  await req("POST", `/portal/approvals/${id}/request-changes`, { client_note: "ajustar" }, P);
  const fila = () => fetch(`${B}/portal/approvals`, { headers: P }).then((r) => r.json());

  await req("POST", `/distribution/${id}/send`, null, H);
  const depois = await fila();
  assert.ok((depois || []).some((x) => x.id === id), "reenviada, tem que reaparecer para ele aprovar");
});

test("depois de aprovada, o cliente não consegue mais pedir ajuste", async () => {
  const id = novaPeca();
  await req("POST", `/distribution/${id}/send`, null, H);
  await req("POST", `/portal/approvals/${id}/approve`, {}, P);
  const r = await req("POST", `/portal/approvals/${id}/request-changes`, { client_note: "mudei de ideia" }, P);
  assert.equal(r.st, 409, "peça já aprovada não volta sozinha — a agência é que reabre");
  assert.equal(db.prepare("SELECT approval_status FROM tasks WHERE id=?").get(id).approval_status, "approved");
});

test("pedir ajuste duas vezes seguidas guarda o recado mais novo", async () => {
  const id = novaPeca();
  await req("POST", `/distribution/${id}/send`, null, H);
  await req("POST", `/portal/approvals/${id}/request-changes`, { client_note: "primeiro recado" }, P);
  const r = await req("POST", `/portal/approvals/${id}/request-changes`, { client_note: "na verdade, outra coisa" }, P);
  const t = db.prepare("SELECT approval_status, client_note FROM tasks WHERE id=?").get(id);
  // Ou recusa (já não está mais "enviada"), ou aceita e guarda o recado novo —
  // o que não pode é aceitar e guardar o recado ANTIGO.
  if (r.st === 200) assert.match(t.client_note, /outra coisa/);
  else assert.match(t.client_note, /primeiro recado/);
  assert.equal(t.approval_status, "changes_requested");
});
