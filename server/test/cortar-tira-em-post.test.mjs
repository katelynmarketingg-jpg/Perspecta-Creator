// "POR QUE NÃO APARECE O BOTÃO DE CORTAR CARROSSEL, LEMBRA QUE TINHA?"
//
// Tinha — mas só no editor de CARROSSEL. A peça dela era do tipo "Post" com uma
// tira larga anexada (seis artes lado a lado, 6480×1350), e peça "Post" cai no
// caminho simples da tela, onde o botão nunca existiu. Ela lembrava certo do
// botão; lembrava de outro lugar.
//
// O plano da casa gera as peças como "Post 4/6", "Post 6/6" — tipo `post` — e a
// arte que chega do design costuma ser a tira inteira. Ou seja: o caso dela não
// é exceção, é o caminho normal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const tela = readFileSync(join(aqui, "../../client/src/pages/Distribution.jsx"), "utf8");

// O card tem dois caminhos: o editor de carrossel e o simples (post/reel). O
// corte morava só no primeiro.
const ramoSimples = tela.slice(
  tela.indexOf('{coverId ? "Trocar capa" : "Definir capa (foto)"}'),
  tela.indexOf("Legenda</Typography>"),
);

test("o botão de cortar também aparece em peça do tipo Post", () => {
  assert.match(ramoSimples, /Cortar arte larga em slides/,
    "é este o caminho de uma peça 'Post' com a tira anexada");
  assert.match(ramoSimples, /onClick=\{cortarArteExistente\}/);
});

test("só aparece quando há arte — não enfeita peça vazia", () => {
  assert.match(ramoSimples, /\{\(fileId \|\| coverId\) && \(/);
});

test("arte que não é tira não fica sem resposta", () => {
  // Quem mede é a própria função, e ela já dizia isso: não precisa de uma
  // segunda regra na tela para esconder o botão.
  assert.match(tela, /Essa arte não é larga o bastante para virar um carrossel de várias slides\./);
});

test("cortar NÃO muda o tipo da peça", () => {
  // Trocar 'post' por 'carrossel' aqui mexeria sozinho na contagem de Entregas,
  // que conta por tipo — ela planejou aquilo como post.
  const cortar = tela.slice(tela.indexOf("async function confirmarFatiar"), tela.indexOf("async function cortarArteExistente"));
  assert.doesNotMatch(cortar, /content_type/);
  assert.match(cortar, /saveSlides\(next\)/, "o que muda são as slides, não o tipo");
});

test("o editor de carrossel continua tendo o seu", () => {
  // A regra de lá é outra (some quando já há mais de uma slide, porque aí a
  // tira já foi cortada) e não pode ter sido levada junto.
  assert.match(tela, /\{slides\.length <= 1 && \(fileId \|\| slides\[0\]\) && \(/);
});
