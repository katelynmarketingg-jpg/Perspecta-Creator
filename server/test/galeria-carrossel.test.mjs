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

test("a tira abre na capa e desliza pelas outras lâminas", () => {
  const trecho = fonte.slice(fonte.indexOf("const tiraSx"), fonte.indexOf("if (erro)"));
  assert.match(trecho, /left: 0/, "ancorada na esquerda — a capa é a primeira lâmina");
  assert.match(trecho, /atual \* \(100 \/ slides\)/, "e desliza conforme a lâmina escolhida");
  assert.match(fonte, /const atual = Math\.min\(lamina, slides - 1\)/, "nunca passa da última");
});

test("as setinhas passam as lâminas sem abrir a arte em tela cheia", () => {
  const trecho = fonte.slice(fonte.indexOf("AS SETINHAS"), fonte.indexOf("</Box>", fonte.indexOf("AS SETINHAS")));
  assert.match(trecho, /setLamina\(atual - 1\)/);
  assert.match(trecho, /setLamina\(atual \+ 1\)/);
  // O quadro inteiro abre a tela cheia no clique; a seta precisa segurar o dela.
  assert.equal((trecho.match(/stopPropagation\(\)/g) || []).length, 2,
    "as duas setas seguram o clique");
});

test("o selo mostra em qual lâmina estamos", () => {
  assert.match(fonte, /\$\{atual \+ 1\}\/\$\{slides\}/);
});

test("baixar cortado gera um arquivo por lâmina, sem tocar no original", () => {
  const trecho = fonte.slice(fonte.indexOf("async function baixarCortado"), fonte.indexOf("// Imagem ou vídeo comum"));
  assert.match(trecho, /fatiarEmSlides\(arquivo, slides\)/, "usa o mesmo corte da Distribuição");
  assert.match(trecho, /a\.download = fatia\.name/, "baixa cada lâmina");
  assert.ok(!/api\.(put|post|delete)/.test(trecho), "não mexe no arquivo guardado");
});

test("prévia grossa demais para uma tira pede uma nova, feita do original", () => {
  // A prévia antiga tinha 1080px na arte INTEIRA: numa tira de 7 slides isso dá
  // 154px por slide, e ampliar para preencher o quadro sai borrado.
  assert.match(fonte, /if \(n > 1 && w \/ n < 420\) reforcarPrevia\(f\.id\)/);
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

// --- a lista tem de aparecer sozinha depois do envio -------------------------

test("a Galeria recarrega quando o envio termina, sem depender do canal ao vivo", () => {
  // Era só o SSE. Durante um envio ele é justamente o que mais corre risco (as
  // conexões do navegador estão ocupadas), e aí a fila sumia do canto e os
  // arquivos não apareciam — só com F5.
  assert.match(fonte, /window\.addEventListener\("files-uploaded"/);
  assert.match(fonte, /window\.removeEventListener\("files-uploaded"/, "e solta o ouvinte ao sair");
  const trecho = fonte.slice(fonte.indexOf('const aoTerminar'), fonte.indexOf('removeEventListener'));
  assert.match(trecho, /loadDocs\(true\)/, "recarrega de verdade, sem cair no cache da lista");
});

test("arquivo antigo sem prévia ganha uma ao aparecer na grade", () => {
  // É o conserto do que já subiu: quem foi enviado antes da prévia existir só
  // tem a miniatura de 480px e aparece estourado no quadro maior.
  assert.match(fonte, /if \(!f\.preview_url\) guardarPrevia\(f\.id, e\.currentTarget\)/);
});

// --- a conta da resolução da prévia -----------------------------------------

const { ladoDaPrevia } = await import("../../client/src/upload/thumbnail.js");

test("a prévia de um post continua em 1080", () => {
  assert.equal(ladoDaPrevia(2160, 2700), 1080, "retrato 4:5");
  assert.equal(ladoDaPrevia(1080, 1920), 1080, "story");
});

test("a prévia de uma tira cresce com o número de lâminas", () => {
  // O que importa é a resolução POR LÂMINA, não a da arte inteira.
  const porLamina = (w, h, n) => ladoDaPrevia(w, h) / n;
  assert.ok(porLamina(1080 * 5, 1350, 5) >= 540, "5 lâminas");
  assert.ok(porLamina(1080 * 7, 1350, 7) >= 540, "7 lâminas — o caso dela");
  assert.ok(porLamina(2970 * 6, 3712.5, 6) >= 540, "6 lâminas exportadas em alta");
});

test("mas tem teto: uma tira de dez lâminas não vira um arquivo gigante", () => {
  assert.ok(ladoDaPrevia(1080 * 10, 1350) <= 4320);
});
