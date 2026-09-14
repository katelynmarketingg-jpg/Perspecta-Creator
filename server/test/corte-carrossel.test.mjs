// A CONTA DO CORTE: em quantas slides esta arte foi feita?
//
// A conta antiga era largura ÷ 1080 e só acertava quando a exportação usava
// exatamente 1080 px por slide. Depois passou a olhar o FORMATO — e aí sobrou
// outro buraco: o número 1 era descartado, então um POST NORMAL (que é uma
// slide só) era anunciado como duas, e um quadrado 1080x1080 saía rotulado
// como "9:16 (story)".
//
// Este teste roda a conta pura, sem navegador: é só matemática.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// O módulo é do navegador (usa canvas em outras funções), mas sugerirSlides é
// conta pura. Carregamos só ela, sem arrastar o resto.
const aqui = dirname(fileURLToPath(import.meta.url));
const fonte = readFileSync(join(aqui, "../../client/src/upload/carousel.js"), "utf8");
const corpo = fonte
  .split("// Mede a arte:")[0]                       // para antes das funções de canvas
  .replace(/export const/g, "const")
  .replace(/export function/g, "function");
const { sugerirSlides } = await import(
  `data:text/javascript;base64,${Buffer.from(`${corpo}\nexport { sugerirSlides };`).toString("base64")}`
);

const casos = [
  ["tira de 6 slides 4:5",            6480, 1350,  6],
  ["a mesma tira exportada em dobro", 12960, 2700, 6],
  ["a mesma tira em baixa",           3240,  675,  6],
  ["tira de 3",                       3240, 1350,  3],
  ["tira de 10",                     10800, 1350, 10],
  ["tira de 20 (limite do Instagram)",21600, 1350, 20],
  ["um post 4:5 — NÃO é tira",         1080, 1350,  1],
  ["um post quadrado — NÃO é tira",    1080, 1080,  1],
  ["um story 9:16 — NÃO é tira",       1080, 1920,  1],
  ["tira de 5 stories",                5400, 1920,  5],
];

for (const [nome, w, h, esperado] of casos) {
  test(`${nome} (${w}x${h}) = ${esperado} slide(s)`, () => {
    const r = sugerirSlides(w, h);
    assert.equal(r.n, esperado, `deu ${r.n} em "${r.formato}"`);
    assert.ok(r.confianca > 0.98, `a conta tinha que fechar redonda (deu ${r.confianca})`);
  });
}

test("o quadrado é reconhecido como quadrado, não como story", () => {
  assert.equal(sugerirSlides(1080, 1080).formato, "1:1 (quadrado)");
});

test("quando encaixa de mais de um jeito, os outros são oferecidos", () => {
  // 4320x1080 fecha redondo de três jeitos ao mesmo tempo: 5 slides 4:5,
  // 4 quadrados e 6 em 2:3. Nenhum é "o certo" — só ela sabe qual fez.
  const r = sugerirSlides(4320, 1080);
  assert.equal(r.n, 5, "fica com 4:5, que é o formato de carrossel mais usado");
  const outras = r.alternativas.map((a) => a.n);
  assert.ok(outras.includes(4), `a leitura de 4 quadrados tem que aparecer (veio ${outras})`);
  assert.ok(!outras.includes(5), "a própria sugestão não se repete na lista");
  assert.ok(r.alternativas.every((a) => a.formato), "cada alternativa diz de que formato ela é");
});

test("arte que não é tira de nada não inventa certeza", () => {
  const r = sugerirSlides(5000, 1350);  // não fecha redondo em formato nenhum
  assert.ok(r.confianca < 0.99, "não pode dizer que fechou redondo quando não fechou");
});

test("medida ausente não quebra", () => {
  const r = sugerirSlides(0, 0);
  assert.equal(r.n, 2);
  assert.deepEqual(r.alternativas, []);
});
