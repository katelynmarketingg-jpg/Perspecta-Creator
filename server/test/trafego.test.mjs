// TRÁFEGO: a estrutura (clientes + plataformas), antes de haver números.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-trafego-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const trafego = (await import("../src/routes/trafego.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Tráfego',0)").run().lastInsertRowid;
const uid = db.prepare("INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@t.com',?,'admin',1,?)")
  .run(hashPassword("x"), org).lastInsertRowid;
const ativo = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Ativo SA','active',?)").run(org).lastInsertRowid;
db.prepare("INSERT INTO clients (name,status,archived_at,org_id) VALUES ('Arquivado SA','inactive','2026-01-01',?)").run(org);

const app = express();
app.use(express.json());
app.use("/api/trafego", trafego);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/trafego`;
const H = { authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

test("lista os clientes ativos com Meta e Google (ainda não conectados)", async () => {
  const r = await fetch(B, { headers: H });
  assert.equal(r.status, 200);
  const rows = await r.json();
  const c = rows.find((x) => x.id === ativo);
  assert.ok(c, "o cliente ativo aparece");
  assert.equal(c.meta, null, "Meta ainda não conectada");
  assert.equal(c.google, null, "Google ainda não conectado");
  assert.ok(!rows.some((x) => x.name === "Arquivado SA"), "arquivado não entra no tráfego");
});

test("quando houver números gravados, a rota os devolve", async () => {
  db.prepare(
    `INSERT INTO ad_metrics (org_id, client_id, platform, balance, spent, clicks, impressions, period, updated_at)
     VALUES (?, ?, 'meta', 500, 123.45, 10, 2000, '2026-11', datetime('now'))`
  ).run(org, ativo);
  const rows = await (await fetch(B, { headers: H })).json();
  const c = rows.find((x) => x.id === ativo);
  assert.equal(c.meta.spent, 123.45);
  assert.equal(c.meta.clicks, 10);
  assert.equal(c.google, null, "Google segue sem conexão");
});

test("sem token, não entra", async () => {
  const r = await fetch(B);
  assert.equal(r.status, 401);
});
