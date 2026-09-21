// O SERVIÇO TRAZ O FORMULÁRIO JUNTO.
//
// Com vários formulários na casa — Gestão, Landing page, Rebranding — lembrar
// qual mandar para cada cliente vira trabalho: ela já sabe o que ele contratou,
// e ter de dizer duas vezes a mesma coisa é onde nascem os erros.
//
// Agora o formulário declara para qual serviço ele é. Ao abrir o onboarding,
// escolher o serviço já traz o formulário dele — e ela ainda pode trocar.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-svcform-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const { db } = await import("../src/db.js");
const { hashPassword, JWT_SECRET } = await import("../src/auth.js");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;
const briefingsRoutes = (await import("../src/routes/briefings.js")).default;

const org = db.prepare("INSERT INTO organizations (name,is_master) VALUES ('Casa dos Serviços',0)").run().lastInsertRowid;
const uid = db.prepare(
  "INSERT INTO users (name,username,email,password_hash,role,active,org_id) VALUES ('K','K','k@s.com',?,'admin',1,?)"
).run(hashPassword("x"), org).lastInsertRowid;
const a = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Cliente A','active',?)").run(org).lastInsertRowid;
const bcli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Cliente B','active',?)").run(org).lastInsertRowid;
const ccli = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Cliente C','active',?)").run(org).lastInsertRowid;

// Dois serviços da casa.
const gestao = db.prepare("INSERT INTO services (name, default_price, org_id) VALUES ('Gestão de redes', 1500, ?)").run(org).lastInsertRowid;
const landing = db.prepare("INSERT INTO services (name, default_price, org_id) VALUES ('Landing page', 2500, ?)").run(org).lastInsertRowid;

const app = express();
app.use(express.json());
app.use("/api/briefings", briefingsRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}/api`;

const token = jwt.sign({ id: uid, org_id: org, role: "admin" }, JWT_SECRET);
const auth = { "content-type": "application/json", authorization: `Bearer ${token}` };
const chamar = (m, c, corpo) => fetch(`${B}${c}`, {
  method: m, headers: auth, body: corpo ? JSON.stringify(corpo) : undefined,
});

const P = (label) => [{ id: "e", titulo: "Etapa", perguntas: [{ id: "q", tipo: "texto", label }] }];

const fGestao = await (await chamar("POST", "/briefings/formularios", {
  nome: "Gestão", secoes: P("Quantos posts por mês?"), servico: `servico:${gestao}`,
})).json();
const fLanding = await (await chamar("POST", "/briefings/formularios", {
  nome: "Landing page", secoes: P("Qual a oferta da página?"), servico: `servico:${landing}`,
})).json();

test("o formulário guarda para qual serviço ele é", () => {
  assert.equal(fGestao.servico, `servico:${gestao}`);
  assert.equal(fLanding.servico, `servico:${landing}`);
});

test("escolher o serviço ao abrir o onboarding já traz o formulário dele", async () => {
  const r = await chamar("POST", "/briefings", {
    client_id: a, termos: { service_id: gestao, servico: "Gestão de redes", value: "1500" },
  });
  const b = await r.json();
  assert.equal(b.form_id, fGestao.id);
  assert.equal(b.origem.nome, "Gestão");
});

test("outro serviço traz outro formulário", async () => {
  const b = await (await chamar("POST", "/briefings", {
    client_id: bcli, termos: { service_id: landing, servico: "Landing page" },
  })).json();
  assert.equal(b.form_id, fLanding.id);
});

test("a escolha dela na mão vence o serviço", async () => {
  const b = await (await chamar("POST", "/briefings", {
    client_id: ccli, form_id: fLanding.id,
    termos: { service_id: gestao, servico: "Gestão de redes" },
  })).json();
  assert.equal(b.form_id, fLanding.id, "ela pediu Landing page, e é Landing page que vale");
});

test("serviço sem formulário próprio cai no padrão da casa, sem erro", async () => {
  const outro = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Cliente D','active',?)").run(org).lastInsertRowid;
  const semForm = db.prepare("INSERT INTO services (name, default_price, org_id) VALUES ('Consultoria', 800, ?)").run(org).lastInsertRowid;
  const b = await (await chamar("POST", "/briefings", {
    client_id: outro, termos: { service_id: semForm, servico: "Consultoria" },
  })).json();
  assert.equal(b.form_id, null);
  assert.equal(b.origem.tipo, "padrao");
});

test("mudar o serviço de um formulário muda quem ele atende daí em diante", async () => {
  await chamar("PUT", `/briefings/formularios/${fGestao.id}`, { servico: "" });
  const outro = db.prepare("INSERT INTO clients (name,status,org_id) VALUES ('Cliente E','active',?)").run(org).lastInsertRowid;
  const b = await (await chamar("POST", "/briefings", {
    client_id: outro, termos: { service_id: gestao, servico: "Gestão de redes" },
  })).json();
  assert.equal(b.form_id, null, "o formulário não é mais deste serviço");

  // E quem já tinha recebido não é mexido: o link dele continua o mesmo.
  const antigo = (await (await chamar("GET", "/briefings")).json()).find((x) => x.client_id === a);
  assert.equal(antigo.form_id, fGestao.id);
});

test("o serviço não é duplicado ao duplicar um formulário", async () => {
  await chamar("PUT", `/briefings/formularios/${fGestao.id}`, { servico: `servico:${gestao}` });
  const copia = await (await chamar("POST", "/briefings/formularios", {
    nome: "Gestão (cópia)", copiar_de: fGestao.id,
  })).json();
  assert.equal(copia.servico, "", "dois formulários no mesmo serviço deixariam a escolha sem saber qual usar");
  assert.equal(copia.secoes[0].perguntas[0].label, "Quantos posts por mês?", "as perguntas vieram junto");
});

after(() => { srv.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
