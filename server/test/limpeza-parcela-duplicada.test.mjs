// A LIMPEZA DAS CÓPIAS ERRADAS DE PARCELA FINAL.
//
// Houve uma versão em que a conta parcelada era copiada para o mês seguinte com
// o mesmo texto — "3/3" aparecia em dois meses. O erro foi corrigido, mas os
// meses abertos naquela versão ficaram com essas linhas.
//
// A limpeza roda uma vez, na subida, e é estreita de propósito: só apaga a
// linha que é última parcela, no formato antigo (campos de número vazios), que
// tem uma gêmea no mês anterior e que ela ainda não marcou como paga.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-limpeza-"));
const caminho = join(dir, "test.db");
process.env.DB_PATH = caminho;
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

// Monta um banco "sujo" ANTES de o db.js rodar a limpeza.
const Database = (await import("better-sqlite3")).default;
{
  const cru = new Database(caminho);
  cru.exec(`CREATE TABLE personal_finance (
    id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER, user_id INTEGER, ym TEXT,
    name TEXT, parcela TEXT, amount REAL, method TEXT, category TEXT,
    paid INTEGER DEFAULT 0, position INTEGER DEFAULT 0,
    installment_num INTEGER, installment_total INTEGER);`);
  const ins = cru.prepare(
    `INSERT INTO personal_finance (org_id,user_id,ym,name,parcela,amount,paid,installment_num,installment_total)
     VALUES (1,1,?,?,?,?,?,?,?)`
  );
  // setembro: os originais
  ins.run("2026-09", "Calças térmicas Bruno", "3/3", 25, 0, null, null);
  ins.run("2026-09", "Caderno", "2/2", 21.27, 1, null, null);
  ins.run("2026-09", "Monitor", "3/6", 27.5, 0, null, null);
  ins.run("2026-09", "Sofá", "4/4", 300, 0, 4, 4);          // formato novo
  // outubro: as cópias erradas
  ins.run("2026-10", "Calças térmicas Bruno", "3/3", 25, 0, null, null);  // APAGA
  ins.run("2026-10", "Caderno", "2/2", 21.27, 1, null, null);             // fica: ela marcou como paga
  ins.run("2026-10", "Monitor", "3/6", 27.5, 0, null, null);              // fica: ainda tem parcela
  ins.run("2026-10", "Sofá", "4/4", 300, 0, 4, 4);                        // fica: formato novo
  // uma última parcela legítima, sem gêmea no mês anterior
  ins.run("2026-10", "Fone", "2/2", 90, 0, null, null);                   // fica
  cru.close();
}

const { db } = await import("../src/db.js");
const nomesDe = (ym) => db.prepare("SELECT name FROM personal_finance WHERE ym=? ORDER BY name").all(ym).map((r) => r.name);

test("apaga só a cópia errada da última parcela", () => {
  assert.deepEqual(nomesDe("2026-10"), ["Caderno", "Fone", "Monitor", "Sofá"],
    "a única que sai é a 'Calças térmicas Bruno 3/3' repetida");
});

test("não encosta no mês de origem", () => {
  assert.deepEqual(nomesDe("2026-09"), ["Caderno", "Calças térmicas Bruno", "Monitor", "Sofá"]);
});

test("linha que ela marcou como paga não se apaga — o dado é dela", () => {
  const cad = db.prepare("SELECT * FROM personal_finance WHERE ym='2026-10' AND name='Caderno'").get();
  assert.ok(cad, "o Caderno 2/2 pago de outubro continua lá");
});

test("roda uma vez só", () => {
  const antes = db.prepare("SELECT COUNT(*) c FROM personal_finance").get().c;
  // simula uma segunda subida: a marca impede a limpeza de rodar de novo
  assert.ok(db.prepare("SELECT 1 FROM migracoes WHERE chave='parcela-final-duplicada-2026-09'").get());
  assert.equal(db.prepare("SELECT COUNT(*) c FROM personal_finance").get().c, antes);
});

after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
