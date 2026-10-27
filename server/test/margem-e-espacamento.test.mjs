// "COMO EU SEI A MARGEM E ESPACAMENTO? TEM QUE TER TAMBÉM."
//
// Tinha — escrito no código, onde ela não via nem mexia: 3 cm de margem em
// cima e à esquerda, 2 cm embaixo e à direita (ABNT NBR 14724), entrelinha
// 1,55 e texto 11,5 pt. O contrato saía assim e ninguém sabia por quê.
//
// Agora os três são do contrato: ficam no estilo (junto do logo), aparecem na
// faixa "PÁGINA (A4)" em cima do editor, e o próprio editor passa a usar a
// MESMA PROPORÇÃO do papel — 3 cm de margem num A4 de 21 cm é 1/7 da largura,
// na tela também.
//
// Conferido no Chromium: pôr 5 cm na margem esquerda levou o recuo do editor
// de 14,29% para 23,81% da largura (3/21 e 5/21), a entrelinha dupla dobrou a
// altura da linha, tudo sobreviveu ao salvar, e a folha impressa saiu com
// "@page { size: A4; margin: 3cm 2cm 2cm 5cm; }".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ler = (p) => readFileSync(join(RAIZ, p), "utf8");
const estilo = ler("client/src/contrato-estilo.js");
const impressao = ler("client/src/impressao.js");
const servicos = ler("client/src/pages/Services.jsx");
const editor = ler("client/src/components/RichEditor.jsx");

test("a página é parte do contrato, e nasce no padrão da ABNT", () => {
  assert.match(estilo, /export const PAGINA_PADRAO = \{/);
  assert.match(estilo, /topo: 3, direita: 2, baixo: 2, esquerda: 3/);
  assert.match(estilo, /entrelinha: 1\.55/);
  assert.match(estilo, /corpo: 11\.5/);
  // Vai junto do logo, nas duas pontas: ao ler e ao guardar.
  assert.equal(estilo.split("pagina: paginaDoContrato(").length - 1, 2,
    "ler sem guardar faz a escolha dela sumir no próximo salvar");
});

test("número sem sentido volta para o padrão", () => {
  const f = estilo.slice(estilo.indexOf("const entre ="), estilo.indexOf("export const paginaDoContrato"));
  assert.match(f, /Number\.isFinite\(n\) && n >= min && n <= max \? n : padrao/,
    "margem de 900 cm ou entrelinha 0 não podem virar um contrato impossível de imprimir");
  assert.match(estilo, /entre\(p\?\.topo, 0\.5, 6/);
  assert.match(estilo, /entre\(p\?\.entrelinha, 1, 3/);
  assert.match(estilo, /entre\(p\?\.corpo, 7, 20/);
});

test("o papel obedece: margem, entrelinha e tamanho do texto", () => {
  assert.match(impressao, /@page \{ size: A4; margin: \$\{MARGENS\}; \}/);
  assert.match(impressao, /font-size: \$\{pagina\.corpo\}pt/);
  assert.match(impressao, /line-height: \$\{pagina\.entrelinha\}/);
  assert.match(impressao, /padding: \$\{MARGENS\}/, "a folha na tela tem de ter a mesma margem do papel");
});

test("os três lugares que imprimem contrato mandam a página junto", () => {
  for (const [nome, texto] of [
    ["Serviços", servicos],
    ["Contratos", ler("client/src/pages/Contracts.jsx")],
    ["ficha do cliente", ler("client/src/pages/Clients.jsx")],
  ]) {
    assert.match(texto, /pagina: st\.pagina/, `${nome} ainda imprime com a margem de fábrica`);
  }
  // Inclusive o caminho de reserva, quando a marca não carrega.
  assert.equal(servicos.split("pagina: st.pagina").length - 1, 2);
});

test("o editor mostra a proporção do papel", () => {
  assert.match(editor, /\(\(pagina\.esquerda \/ 21\) \* 100\)/,
    "A4 tem 21 cm: a margem em cm vira a mesma fatia na tela");
  assert.match(editor, /fontSize: pagina \? `\$\{pagina\.corpo\}pt`/);
  assert.match(editor, /lineHeight: pagina \? pagina\.entrelinha/);
  assert.match(servicos, /<RichEditor\s+pagina=\{estiloDoContrato\(draft\.contract_style\)\.pagina\}/);
});

test("a faixa diz os números e de onde eles vêm", () => {
  assert.match(servicos, /PÁGINA \(A4\)/);
  assert.match(servicos, /Margens em cm:/);
  assert.match(servicos, /padrão é o da ABNT \(3 · 2 · 2 · 3\)/);
  assert.match(servicos, /Voltar ao padrão/);
  // MenuItem foi esquecido no import e a tela de Serviços inteira parou de
  // abrir ("Não deu para abrir esta tela"). Visto no navegador.
  assert.match(servicos, /Switch, FormControlLabel, MenuItem,/);
});
