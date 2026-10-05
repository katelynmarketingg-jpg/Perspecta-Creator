// ARRASTAR NO QUADRO DE TAREFAS.
//
// Palavras dela: "aqui na aba de tarefas, notei que pra arrastar não dá se
// estiver muito embaixo, sabe? corrija, quero que ao começar a arrastar já
// apareça sutil qual o nome da coluna".
//
// Eram duas coisas, e as duas vistas no navegador, não só lidas no código:
//
// 1. Cada coluna acabava onde acabavam os cartões dela. Com a tarefa lá
//    embaixo, a coluna de destino simplesmente NÃO EXISTIA naquela altura —
//    não havia onde soltar. Com alignItems: "stretch" toda coluna passa a ter
//    a altura da mais alta, e aí dá.
//
// 2. O nome da coluna ficava lá em cima, fora da tela. Agora, ao começar o
//    arrasto, aparece uma barra discreta no topo com os nomes — e ela própria
//    aceita o cartão: dá para soltar sem rolar nada.
//
// A barra tem de ficar FORA do quadro. Dentro dele não adianta: o quadro rola
// para o lado, e "grudar no topo" gruda em relação a quem rola.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tela = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/pages/Tasks.jsx"), "utf8");

test("as colunas têm todas a mesma altura: existe onde soltar lá embaixo", () => {
  assert.match(tela, /overflowX: "auto", pb: 2, alignItems: "stretch"/);
  assert.ok(!/overflowX: "auto", pb: 2, alignItems: "flex-start"/.test(tela),
    "flex-start é justamente o que fazia a coluna curta não chegar lá embaixo");
});

test("enquanto se arrasta, toda coluna se mostra como alvo", () => {
  const quadro = tela.slice(tela.indexOf("onDragOver={(e) => { e.preventDefault(); ponteiroY"));
  assert.match(quadro, /\.\.\.\(arrastando && \{/);
  assert.match(quadro, /minHeight: 340/);
});

test("a barra com os nomes aparece ao começar o arrasto", () => {
  const barra = tela.slice(tela.indexOf("A BARRA DE DESTINOS"), tela.indexOf('overflowX: "auto", pb: 2'));
  assert.match(barra, /Soltar em/);
  assert.match(barra, /opacity: arrastando \? 1 : 0/, "sem arrasto, invisível");
  assert.match(barra, /pointerEvents: arrastando \? "auto" : "none"/,
    "escondida não pode roubar clique de nada");
  assert.match(barra, /height: 0/, "não pode empurrar o quadro para baixo no meio do arrasto");
  assert.match(barra, /onDrop=\{\(e\) => handleDrop\(e, stage\)\}/,
    "o nome na barra é alvo de verdade — é o que resolve o cartão lá embaixo");
});

test("a barra fica fora do quadro que rola para o lado", () => {
  const iBarra = tela.indexOf("A BARRA DE DESTINOS");
  const iQuadro = tela.indexOf('overflowX: "auto", pb: 2');
  assert.ok(iBarra > 0 && iBarra < iQuadro,
    "dentro do quadro, 'grudar no topo' não acontece: quem rola ali rola na horizontal");
});

test("a página rola sozinha quando o cursor chega perto da borda", () => {
  assert.match(tela, /function comecarRolagemAutomatica/);
  assert.match(tela, /function pararRolagemAutomatica/);
  assert.match(tela, /window\.scrollBy/);
  assert.match(tela, /useEffect\(\(\) => pararRolagemAutomatica, \[\]\)/,
    "sair da página no meio do arrasto não pode deixar o motor ligado");
});

test("soltar (ou desistir) desliga tudo", () => {
  const fim = tela.slice(tela.indexOf("function handleDragEnd"), tela.indexOf("function comecarRolagemAutomatica"));
  assert.match(fim, /pararRolagemAutomatica\(\)/);
  assert.match(fim, /setArrastando\(null\)/);
  assert.match(fim, /setDragOver\(null\)/);
  assert.match(fim, /draggingRef\.current = false/, "o clique de depois não pode abrir a tarefa");
  assert.match(tela, /onDragEnd=\{handleDragEnd\}/);
});
