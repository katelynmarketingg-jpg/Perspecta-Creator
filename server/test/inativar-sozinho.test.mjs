// QUANDO UM CLIENTE VAI SOZINHO PARA "INATIVOS".
//
// Automatismo que mexe na lista principal é onde a confiança se perde: sumir
// com um cliente sem ela mandar é pior do que deixar um encerrado à vista.
//
// Por isso a regra é conservadora, e o teste que mais importa aqui é o do
// CLIENTE NOVO: quem ainda nem começou não pode ser "encerrado".
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-inativar-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { motivoParaInativar, inativaQuemAcabou } = await import("../src/inativar-sozinho.js");

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Inativa',0)").run().lastInsertRowid;
const hoje = new Date("2026-09-24T12:00:00Z");
const cliente = (campos = {}) => ({
  id: 1, org_id: org, name: "X", status: "active", work_end: null, archived_at: null, ...campos,
});

test("cliente NOVO, sem contrato e sem LP, não é tocado", () => {
  // O erro mais caro possível aqui: arquivar quem acabou de ser cadastrado.
  assert.equal(motivoParaInativar(cliente(), { hoje }), null);
});

test("contrato ainda correndo, fica onde está", () => {
  assert.equal(motivoParaInativar(cliente({ work_end: "2027-01-01" }), { hoje }), null);
});

test("contrato terminado e nenhuma LP: vai para Inativos", () => {
  const m = motivoParaInativar(cliente({ work_end: "2026-06-30" }), { hoje });
  assert.match(m, /contrato terminou em 2026-06-30/);
});

test("contrato terminado mas com LP no ar: FICA — o site ainda é dele", () => {
  const lps = [{ status: "ativa", proxima: { vence_em: "2027-05-01", status: "em_dia" } }];
  assert.equal(motivoParaInativar(cliente({ work_end: "2026-06-30" }), { lps, hoje }), null);
});

test("LP atrasada ainda é conversa, não é fim", () => {
  const lps = [{ status: "ativa", proxima: { vence_em: "2026-09-20", status: "em_dia" } }];
  assert.equal(motivoParaInativar(cliente({ work_end: "2026-06-30" }), { lps, hoje }), null);
});

test("LP fora da tolerância + contrato terminado: aí sim", () => {
  const lps = [{ status: "ativa", proxima: { vence_em: "2026-08-01", status: "em_dia" } }];
  const m = motivoParaInativar(cliente({ work_end: "2026-06-30" }), { lps, hoje });
  assert.match(m, /contrato terminou/);
});

test("só LP, toda cancelada, sem contrato mensal: vai", () => {
  const lps = [{ status: "cancelada", proxima: null }];
  assert.match(motivoParaInativar(cliente(), { lps, hoje }), /landing pages/);
});

test("uma LP cancelada e outra no ar: fica", () => {
  const lps = [
    { status: "cancelada", proxima: null },
    { status: "ativa", proxima: { vence_em: "2027-01-01", status: "em_dia" } },
  ];
  assert.equal(motivoParaInativar(cliente(), { lps, hoje }), null);
});

test("quem já está arquivado não é arquivado de novo", () => {
  assert.equal(motivoParaInativar(cliente({ work_end: "2020-01-01", archived_at: "2021-01-01" }), { hoje }), null);
});

test("a passada move, avisa e não apaga nada", () => {
  const c = db.prepare(
    "INSERT INTO clients (name,status,org_id,work_end) VALUES ('Acabou','active',?,'2026-06-30')"
  ).run(org).lastInsertRowid;
  const novo = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Recém-chegado','active',?)").run(org).lastInsertRowid;

  const r = inativaQuemAcabou(hoje);
  assert.equal(r.movidos, 1);

  const foi = db.prepare("SELECT status, archived_at, archive_note FROM clients WHERE id = ?").get(c);
  assert.equal(foi.status, "inactive");
  assert.ok(foi.archived_at);
  assert.match(foi.archive_note, /sozinho/);

  const ficou = db.prepare("SELECT status, archived_at FROM clients WHERE id = ?").get(novo);
  assert.equal(ficou.status, "active");
  assert.equal(ficou.archived_at, null, "o cliente novo continua intocado");

  const aviso = db.prepare(
    "SELECT message FROM notifications WHERE client_id = ? ORDER BY id DESC LIMIT 1"
  ).get(c);
  assert.match(aviso.message, /Inativos/);
  assert.match(aviso.message, /Reativar/, "ela precisa saber que dá para desfazer");
});

test("rodar de novo não mexe em quem já foi movido", () => {
  assert.equal(inativaQuemAcabou(hoje).movidos, 0);
});

after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
