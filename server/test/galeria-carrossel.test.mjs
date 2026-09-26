// A GALERIA COM FORMA DE POST
//
// Pedido dela: "carrosseis podem aparecer maiores... no tamanho dos posts
// normais, com a mesma forma que acontece nos posts da distribuição, que já
// corta e fica o primeiro na frente". E: "os vídeos pode dar um pequeno zoom
// deles pra não ficar a borda preta".
//
// A tira do carrossel é UMA arte larga com as slides lado a lado. Ajustada pela
// largura, ela virava um filete. Aqui trava a conta que decide quantas slides a
// tira tem — é ela que diz onde cortar para a capa preencher o quadro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
const { sugerirSlides } = await import("../../client/src/upload/carousel.js");
const fonte = readFileSync(join(aqui, "../../client/src/pages/Files.jsx"), "utf8");

// A mesma regra que a Galeria aplica antes de perguntar quantas slides são.
function slidesDaTira(w, h) {
  if (!w || !h) return 1;
  if (w / h <= 1.05) return 1;
  const { n } = sugerirSlides(w, h);
  return n > 1 ? n : 1;
}

test("post comum não é confundido com carrossel", () => {
  assert.equal(slidesDaTira(1080, 1350), 1, "retrato 4:5");
  assert.equal(slidesDaTira(1080, 1080), 1, "quadrado");
  assert.equal(slidesDaTira(1080, 1920), 1, "story");
});

test("a tira de carrossel é reconhecida, inclusive exportada em alta", () => {
  assert.equal(slidesDaTira(1080 * 5, 1350), 5, "5 slides 4:5");
  assert.equal(slidesDaTira(2970 * 6, 3712.5), 6, "6 slides exportadas em ~2,75x");
  assert.equal(slidesDaTira(1080 * 3, 1080), 3, "3 slides quadradas");
});

test("uma foto deitada comum não vira carrossel de muitas slides", () => {
  // Uma paisagem 3:2 é mais larga que um post, mas não é tira: no máximo o
  // sistema lê como 2 slides, e nunca como 8.
  const n = slidesDaTira(3000, 2000);
  assert.ok(n <= 2, `leu ${n} slides numa paisagem 3:2`);
});

// --- o que a tela faz com essa conta -----------------------------------------

test("a grade usa a forma de post e corta, em vez de encolher", () => {
  assert.match(fonte, /aspectRatio: "4 \/ 5"/, "o quadro tem a forma de um post");
  assert.match(fonte, /objectFit: "cover"/, "a mídia preenche o quadro");
  assert.ok(!/objectFit: "contain", display: "block", bgcolor: ehVideo/.test(fonte),
    "o ajuste antigo (que deixava tarja preta no vídeo) saiu");
});

test("a tira é ancorada na primeira slide, sem deslizar", () => {
  // Na Galeria o quadro mostra a CAPA e pronto: quem quiser ver o resto abre a
  // arte. Por isso não há translate por índice como na Distribuição.
  const trecho = fonte.slice(fonte.indexOf("const tiraSx"), fonte.indexOf("const midiaSx"));
  assert.match(trecho, /left: 0/, "ancorada na esquerda — a capa é a primeira slide");
  assert.ok(!/translateX\(-\$\{/.test(trecho), "não desliza para outras slides");
});

test("o quadro avisa quantas slides estão escondidas atrás do corte", () => {
  assert.match(fonte, /\$\{slides\} slides/, "o selo diz quantas são");
});

test("a grade prefere a prévia à miniatura — o quadro maior exige resolução", () => {
  // A miniatura tem 480px no lado maior. Num quadro de 150px bastava; com o
  // quadro maior e o corte preenchendo, ela aparece esticada. Numa tira de 5
  // slides é pior: cada slide fica com 96px.
  assert.match(fonte, /f\.preview_url \|\| f\.thumb \|\| f\.media_url/,
    "prévia primeiro, miniatura como reserva, original por último");
  assert.ok(!/const previa = f\.thumb \|\|/.test(fonte),
    "a ordem antiga (miniatura primeiro) saiu");
});
