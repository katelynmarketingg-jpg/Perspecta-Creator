// AUDITORIA — Etapa 1: a agência abre o onboarding. O que acontece quando ela
// erra: data invertida, valor com vírgula, quantidade absurda, serviço sem
// contrato escrito, cliente que não é dela.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-onba-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET, hostServeParaLink, publicBaseUrl } = await import("../src/auth.js");
const { mesesDeVigencia, achaModelo, modelosDisponiveis } = await import("../src/contract-gen.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const briefings = (await import("../src/routes/briefings.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa do Onboarding',0)").run().lastInsertRowid;
const outraOrg = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa Vizinha',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@onb.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const cli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Marcelo','active',?)").run(org).lastInsertRowid;
const cliVizinho = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('De outra casa','active',?)").run(outraOrg).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/briefings", briefings);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api/briefings`;
const H = { "content-type": "application/json", authorization: `Bearer ${jwt.sign({ id: uid }, JWT_SECRET)}` };
after(() => srv.close());

const abrir = (corpo) => fetch(B, { method: "POST", headers: H, body: JSON.stringify(corpo) })
  .then(async (r) => ({ st: r.status, ...(await r.json().catch(() => ({}))) }));

test("vigência: os dois extremos contam, e fim antes do início não vale", () => {
  assert.equal(mesesDeVigencia("2026-09-01", "2027-02-28"), 6);
  assert.equal(mesesDeVigencia("2026-10-01", "2027-03-31"), 6);
  assert.equal(mesesDeVigencia("2026-09-15", "2026-09-30"), 1);
  assert.equal(mesesDeVigencia("2026-09-01", "2027-08-31"), 12);
  assert.equal(mesesDeVigencia("2027-01-01", "2026-01-01"), null, "invertida não vale");
  assert.equal(mesesDeVigencia("2026-09-01", ""), null);
  assert.equal(mesesDeVigencia("data torta", "2027-02-28"), null);
});

test("data fora do formato não entra nos termos — vira vazio, não lixo", async () => {
  const r = await abrir({ client_id: cli, termos: {
    value: 1500, start_date: "01/09/2026", end_date: "2027-02-28", contract_date: "ontem",
  } });
  assert.equal(r.st, 201);
  assert.equal(r.termos.start_date, null);
  assert.equal(r.termos.contract_date, null);
  assert.equal(r.termos.end_date, "2027-02-28", "a que estava certa fica");
  assert.equal(r.termos.duration_months, null, "sem início não dá para calcular");
});

test("valor escrito em palavras vira zero, não NaN", async () => {
  const r = await abrir({ client_id: cli, termos: { value: "mil e quinhentos" } });
  assert.equal(r.termos.value, 0);
  assert.ok(!Number.isNaN(r.termos.value));
});

test("entrega sem nome não vira marcador", async () => {
  const r = await abrir({ client_id: cli, termos: {
    itens: [{ label: "", quantidade: 5 }, { label: "   ", quantidade: 2 }, { label: "Posts", quantidade: 4 }],
  } });
  assert.deepEqual(r.termos.itens.map((i) => i.label), ["Posts"]);
});

test("lista de entregas absurda é cortada", async () => {
  const muitas = Array.from({ length: 50 }, (_, i) => ({ label: `Entrega ${i}`, quantidade: 1 }));
  const r = await abrir({ client_id: cli, termos: { itens: muitas } });
  assert.ok(r.termos.itens.length <= 20, `guardou ${r.termos.itens.length} entregas`);
});

test("texto gigante nos termos é cortado", async () => {
  const r = await abrir({ client_id: cli, termos: {
    servico: "x".repeat(5000), observacoes: "y".repeat(50000),
  } });
  assert.ok(r.termos.servico.length <= 160);
  assert.ok(r.termos.observacoes.length <= 1000);
});

test("cliente de OUTRA agência não abre onboarding aqui", async () => {
  const r = await abrir({ client_id: cliVizinho, termos: { value: 100 } });
  assert.equal(r.st, 404);
});

test("abrir duas vezes devolve o MESMO link — não espalha endereços", async () => {
  const c = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Um link só','active',?)").run(org).lastInsertRowid;
  const a = await abrir({ client_id: c, termos: { value: 1000 } });
  const b = await abrir({ client_id: c, termos: { value: 2000 } });
  assert.equal(a.token, b.token, "o link tem que ser o mesmo");
  assert.equal(b.termos.value, 2000, "mas os termos corrigidos valem");
});

test("serviço sem contrato escrito diz o que fazer", () => {
  const svc = db.prepare("INSERT INTO services (name,org_id) VALUES ('Tráfego pago',?)").run(org).lastInsertRowid;
  assert.throws(() => achaModelo(org, { service_id: svc }), /ainda não tem contrato escrito/);
  const comTexto = db.prepare("INSERT INTO services (name,contract_template,org_id) VALUES ('Com texto','<p>oi</p>',?)").run(org).lastInsertRowid;
  assert.equal(achaModelo(org, { service_id: comTexto }).origem, "servico");
});

test("a lista de modelos separa quem tem texto de quem não tem", () => {
  const lista = modelosDisponiveis(org);
  assert.ok(lista.some((m) => m.name === "Com texto" && m.tem_contrato === true));
  assert.ok(lista.some((m) => m.name === "Tráfego pago" && m.tem_contrato === false));
});

test("modelo de OUTRA agência não é encontrado", () => {
  const svc = db.prepare("INSERT INTO services (name,contract_template,org_id) VALUES ('Vizinho','<p>x</p>',?)").run(outraOrg).lastInsertRowid;
  assert.throws(() => achaModelo(org, { service_id: svc }), /não encontrado/i);
  assert.ok(!modelosDisponiveis(org).some((m) => m.name === "Vizinho"));
});

test("o LINK do cliente precisa ter domínio de verdade", () => {
  // O erro clássico: PUBLIC_URL com só o nome do serviço do Render, sem
  // domínio — o navegador responde DNS_PROBE_FINISHED_NXDOMAIN e o cliente
  // acha que a agência mandou um link quebrado.
  assert.equal(hostServeParaLink("saas-agency-k9ft"), false);
  assert.equal(hostServeParaLink(""), false);
  assert.equal(hostServeParaLink("creator.perspecta.app.br"), true);
  assert.equal(hostServeParaLink("https://creator.perspecta.app.br"), true);
  assert.equal(hostServeParaLink("localhost:8080"), true);

  const antes = process.env.PUBLIC_URL;
  try {
    process.env.PUBLIC_URL = "saas-agency-k9ft";
    const url = publicBaseUrl({ headers: { host: "creator.perspecta.app.br" } });
    assert.equal(url, "https://creator.perspecta.app.br", "cai no endereço do próprio pedido");
  } finally {
    if (antes === undefined) delete process.env.PUBLIC_URL; else process.env.PUBLIC_URL = antes;
  }
});

test("o link gerado é um endereço completo, pronto para colar no WhatsApp", async () => {
  const c = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Link bom','active',?)").run(org).lastInsertRowid;
  const r = await abrir({ client_id: c, termos: {} });
  assert.match(r.url, /^https?:\/\/[^/]+\.[^/]+\/briefing\/.+|^https?:\/\/127\.0\.0\.1:\d+\/briefing\/.+/);
  assert.ok(r.token.length >= 20, "e o segredo do link não pode ser curto de adivinhar");
});
