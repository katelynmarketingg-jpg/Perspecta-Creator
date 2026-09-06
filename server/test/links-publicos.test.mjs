// Os links que saem do sistema (briefing, assinatura de contrato) precisam ter
// domínio de verdade. No Render a variável PUBLIC_URL pode acabar guardando só
// o NOME do serviço ("saas-agency-k9ft", sem o .onrender.com) — e aí o navegador
// responde "não é possível acessar esse site" (DNS_PROBE_FINISHED_NXDOMAIN).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-links-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.JWT_SECRET = "test-secret";

const { publicBaseUrl, hostServeParaLink } = await import("../src/auth.js");

const pedido = { headers: { host: "saas-agency-k9ft.onrender.com" } };
const comPublicUrl = (valor, req = pedido) => {
  const antes = process.env.PUBLIC_URL;
  if (valor === null) delete process.env.PUBLIC_URL; else process.env.PUBLIC_URL = valor;
  try { return publicBaseUrl(req); }
  finally { if (antes === undefined) delete process.env.PUBLIC_URL; else process.env.PUBLIC_URL = antes; }
};

test("nome de serviço sem domínio não vira link", () => {
  assert.equal(hostServeParaLink("saas-agency-k9ft"), false);
  assert.equal(hostServeParaLink(""), false);
  assert.equal(hostServeParaLink("saas-agency-k9ft.onrender.com"), true);
  assert.equal(hostServeParaLink("https://meudominio.com.br"), true);
  assert.equal(hostServeParaLink("localhost:8080"), true);
});

test("PUBLIC_URL quebrada não derruba o link — usa o endereço do pedido", () => {
  const url = comPublicUrl("saas-agency-k9ft");
  assert.equal(url, "https://saas-agency-k9ft.onrender.com");
  assert.ok(!/\/\/saas-agency-k9ft$/.test(url), "não pode sobrar o nome do serviço sozinho");
});

test("PUBLIC_URL completa continua mandando", () => {
  assert.equal(comPublicUrl("minhaagencia.com.br"), "https://minhaagencia.com.br");
  assert.equal(comPublicUrl("https://minhaagencia.com.br"), "https://minhaagencia.com.br");
});

test("sem PUBLIC_URL, vale o endereço por onde a pessoa chegou", () => {
  assert.equal(comPublicUrl(null), "https://saas-agency-k9ft.onrender.com");
  // Atrás de proxy o cabeçalho pode vir com uma lista; fica o primeiro.
  assert.equal(
    comPublicUrl(null, { headers: { "x-forwarded-host": "meudominio.com.br, interno" } }),
    "https://meudominio.com.br");
});

test("na máquina local o esquema é http, não https", () => {
  assert.equal(comPublicUrl("localhost:8080"), "http://localhost:8080");
  assert.equal(comPublicUrl(null, { headers: { host: "localhost:8080" } }), "http://localhost:8080");
});

test("todo link gerado tem domínio que o navegador consegue resolver", () => {
  const valida = (base) => /^https?:\/\/([^/]+\.[^/]+|localhost(:\d+)?)$/.test(base);
  for (const v of ["saas-agency-k9ft", "", "saas-agency-k9ft.onrender.com", "https://x.com.br", "localhost:8080", null]) {
    const base = comPublicUrl(v);
    assert.ok(valida(base), `PUBLIC_URL=${JSON.stringify(v)} gerou "${base}"`);
  }
});
