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

// A CAPA DE UM CARROSSEL É UM POST, NÃO UMA TIRA.
//
// Quando a conta não fecha em formato nenhum, a resposta ainda saía com cara de
// certeza — e a capa de um carrossel virava "1 / 2" no card. O visor então
// desenhava a arte com o DOBRO da largura da caixa e ela estourava o card.
test("quando a conta não fecha, uma arte que não é tira vale 1 slide", () => {
  for (const [w, h] of [[1200, 1000], [1000, 900], [1080, 1350], [1080, 1080]]) {
    const r = sugerirSlides(w, h);
    assert.equal(r.n, 1, `${w}x${h} não é uma tira; deu ${r.n} em "${r.formato}"`);
  }
});

test("tira de 2 slides, que é a mais estreita possível, continua valendo", () => {
  // O limite é justamente aqui: duas slides lado a lado dão uma arte só um
  // pouco mais larga que alta. Elas encaixam EXATO, e é isso que as separa de
  // uma capa quase quadrada.
  assert.equal(sugerirSlides(2160, 1920).n, 2, "duas slides 9:16");
  assert.equal(sugerirSlides(2160, 1350).n, 2, "duas slides 4:5");
  assert.equal(sugerirSlides(2160, 1080).n, 2, "dois quadrados");
});

test("encaixe frouxo não passa por encaixe", () => {
  // 7 slides 9:16 numa arte de 1200x1000 "fechavam" com 98% pela conta antiga,
  // que dividia o erro pelo número de slides: quanto mais slides, mais fácil
  // parecer certo.
  const r = sugerirSlides(1200, 1000);
  assert.equal(r.confianca, 0, `deu ${r.confianca} de certeza numa arte que não encaixa`);
  assert.equal(r.formato, null);
});

test("tira larga cujo formato não bate ainda dá um palpite útil", () => {
  // 5000x1350 é claramente uma tira (bem mais larga que alta), mesmo sem fechar
  // redondo. Aí o palpite antigo (largura ÷ 1080) é melhor que dizer "1".
  const r = sugerirSlides(5000, 1350);
  assert.ok(r.n >= 4 && r.n <= 5, `esperava um palpite de tira, deu ${r.n}`);
  assert.equal(r.confianca, 0, "e sem prometer certeza");
});

test("medida ausente não quebra", () => {
  const r = sugerirSlides(0, 0);
  assert.equal(r.n, 2);
  assert.deepEqual(r.alternativas, []);
});
