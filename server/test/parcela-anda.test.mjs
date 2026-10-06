// A PARCELA TEM DE ANDAR DE UM MÊS PARA O OUTRO.
//
// Palavras dela: "os 2/3 não estão seguindo, de um mês pro outro se mantém o
// mesmo, não passa pra próxima parcela".
//
// Existem DOIS caminhos que levam uma conta para o mês seguinte:
//
//   · rollForward — abre um mês vazio puxando as contas do mês anterior;
//   · propagateForward — leva uma conta recém-marcada como fixa/parcelada para
//     os meses que JÁ existem.
//
// O primeiro sabia reler o número de dentro do texto "2/5" quando as colunas
// installment_num/installment_total estavam vazias (importação antiga grava só
// o texto). O segundo não sabia — e copiava "2/5" igual para todo mês seguinte.
// A conta nunca andava e nunca acabava.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-parcela-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const personal = (await import("../src/routes/personal-finance.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa da Parcela',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('Katy','K','k@p.com',?,'admin',1,?)")
  .run(hashPassword("SenhaBoa#1"), org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/personal-finance", personal);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/personal-finance`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}`, "content-type": "application/json" };
after(() => srv.close());

const pedir = async (metodo, caminho, corpo) => {
  const r = await fetch(`${B}${caminho}`, {
    method: metodo, headers: H, body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};
const parcelasDe = async (ym, nome) => {
  const r = await pedir("GET", `?ym=${ym}`);
  return (r.corpo.entries || []).filter((e) => e.name === nome).map((e) => e.parcela);
};
/** Uma linha como a importação antiga gravava: só o TEXTO, colunas vazias. */
const linhaAntiga = (ym, nome, parcela) => db.prepare(
  `INSERT INTO personal_finance (org_id,user_id,ym,name,parcela,amount,category,paid,position,
     recurring,installment_num,installment_total,avulso)
   VALUES (?,?,?,?,?,100,'Roupas',0,0,1,NULL,NULL,0)`
).run(org, uid, ym, nome, parcela).lastInsertRowid;

test("mês novo e vazio: a parcela anda", async () => {
  await pedir("POST", "", { ym: "2026-09", name: "Calças", amount: 75.98, parcela: "2/5", category: "Roupas" });
  assert.deepEqual(await parcelasDe("2026-09", "Calças"), ["2/5"]);
  assert.deepEqual(await parcelasDe("2026-10", "Calças"), ["3/5"]);
  assert.deepEqual(await parcelasDe("2026-11", "Calças"), ["4/5"]);
});

test("e some quando acaba de pagar", async () => {
  assert.deepEqual(await parcelasDe("2026-12", "Calças"), ["5/5"]);
  assert.deepEqual(await parcelasDe("2027-01", "Calças"), [], "5/5 era a última");
});

test("ERA O BUG: nos meses que JÁ existem, a parcela ficava parada", async () => {
  // A linha só tem o texto — é o caso da importação antiga.
  const id = linhaAntiga("2026-09", "Bota", "2/7");
  // E os meses seguintes já existem (ela já entrou neles).
  for (const m of ["2026-10", "2026-11"]) linhaAntiga(m, "Fies", "fixa");

  await pedir("PUT", `/${id}`, { recurring: 1 });   // mexer na conta propaga

  assert.deepEqual(await parcelasDe("2026-09", "Bota"), ["2/7"]);
  assert.deepEqual(await parcelasDe("2026-10", "Bota"), ["3/7"], "antes vinha 2/7 de novo");
  assert.deepEqual(await parcelasDe("2026-11", "Bota"), ["4/7"], "e 2/7 outra vez");
});

test("a conta fixa continua fixa — não ganha número", async () => {
  assert.deepEqual(await parcelasDe("2026-10", "Fies"), ["fixa"]);
  assert.deepEqual(await parcelasDe("2026-11", "Fies"), ["fixa"], "sem n\u00famero, repete para sempre \u2014 \u00e9 o que \"fixa\" quer dizer");
});

// --- o conserto do que já estava gravado ------------------------------------

test("a renumeração de uma vez só está registrada, e é conservadora", async () => {
  const { readFileSync } = await import("node:fs");
  const dbjs = readFileSync(new URL("../src/db.js", import.meta.url), "utf8");
  const trecho = dbjs.slice(dbjs.indexOf("parcelas-presas-no-mesmo-numero"), dbjs.indexOf("export default db;"));

  assert.match(trecho, /new Set\(textos\)\.size === textos\.length/,
    "série que já andava não se toca");
  assert.match(trecho, /l\.ym > mesAtual/,
    "só o que está no futuro pode ser removido — histórico não se reescreve");
  assert.ok(!/DELETE FROM personal_finance WHERE org_id/.test(trecho),
    "nada de apagar em bloco");
});

