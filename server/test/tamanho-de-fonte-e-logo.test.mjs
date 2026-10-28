// "QUERO PODER MUDAR TAMANHO DE FONTE E MUDAR LOGO."
//
// (no editor do "Modelo de contrato deste serviço", em Serviços)
//
// Os dois controles existiam. O tamanho, porém, só valia para o trecho
// MARCADO: quem escolhia "Grande" sem ter marcado nada via o comando cair no
// cursor e nada acontecer na tela — e o próprio seletor continuava dizendo
// "Normal", como se não tivesse sido clicado. Num contrato, o que se quer
// quase sempre é mudar o documento inteiro.
//
// E o logo: o botão estava lá, mas a faixa não dizia que aquilo era o logo
// nem que dava para trocar; quando a imagem não abria, o aviso não dizia o
// que fazer; e a dica do "sem logo" mandava para "Integrações/Configurações",
// que não é onde se põe o logo da casa.
//
// Conferido no Chromium: sem marcar nada, "Grande" muda o contrato todo e o
// seletor passa a mostrar "Grande"; marcando um parágrafo, muda só ele; e
// tudo sobrevive ao salvar e recarregar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ler = (p) => readFileSync(join(RAIZ, p), "utf8");
const editor = ler("client/src/components/RichEditor.jsx");
const servicos = ler("client/src/pages/Services.jsx");
const faixa = ler("client/src/components/LogoBanner.jsx");

test("sem nada marcado, a letra e o tamanho valem para o contrato inteiro", () => {
  const f = editor.slice(editor.indexOf("const aplicaNoTexto"), editor.indexOf("return (", editor.indexOf("const aplicaNoTexto")));
  assert.ok(f, "a função que aplica fonte e tamanho sumiu");
  assert.match(f, /!sel\.isCollapsed/, "trecho marcado é trecho marcado");
  assert.match(f, /selectNodeContents\(ref\.current\)/,
    "sem marcação, o comando tem de pegar o documento todo — senão não acontece nada");
  assert.match(f, /collapseToEnd\(\)/,
    "no documento todo, desmarca no fim: tudo azul assusta e uma tecla apagaria tudo");
  // A fonte continua num dropdown; o tamanho agora é nos botões − e +.
  assert.match(editor, /aplicaNoTexto\("fontName"/);
  assert.match(f, /const aplicaPt =/, "o tamanho em pt é aplicado por aplicaPt");
});

test("o tamanho muda com os botões − e +", () => {
  assert.match(editor, /passoDeTamanho\(-1\)/, "faltou o botão de diminuir");
  assert.match(editor, /passoDeTamanho\(1\)/, "faltou o botão de aumentar");
  // onMouseDown preventDefault é o que segura a marcação do texto ao clicar no
  // botão — sem isso o trecho "desmarca" e a mudança não pega.
  assert.match(editor, /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/,
    "os botões de tamanho precisam segurar o foco para não desmarcar o texto");
});

test("a barra mostra a fonte e o tamanho", () => {
  assert.match(editor, /value=\{fonte\}/, "dizia 'Arial' para sempre, mesmo depois de trocar");
  assert.match(editor, /\{tamPt\}/, "o tamanho atual (pt) tem de aparecer na barra, entre o − e o +");
  assert.ok(!/defaultValue="3"/.test(editor), "defaultValue não acompanha a escolha");
});

test("a dica não fica por cima do que ela quer clicar", () => {
  // A fonte (dropdown) e os dois botões de tamanho usam dica não-interativa,
  // para não segurar o ponteiro por cima do controle.
  assert.equal(editor.split("disableInteractive").length - 1, 3,
    "a fonte e os dois botões de tamanho precisam de dica não-interativa");
});

test("a faixa do logo diz que é o logo, e de quem", () => {
  assert.match(servicos, /Logo do contrato — \{estilo\.logo \? "próprio deste serviço" : "o da casa"\}/);
});

test("quando a imagem não abre, o aviso diz o que fazer", () => {
  assert.match(servicos, /PNG, JPG, WEBP ou SVG/);
  assert.match(servicos, /exporte como PNG/);
});

test("e o caminho do logo da casa é o caminho certo", () => {
  // Os recibos e a marca moram em Configurações; "Integrações" nunca teve isso.
  assert.match(faixa, /Configurações → Marca/);
  assert.ok(!/Integrações\/Configurações/.test(faixa), "esse caminho não existe");
  assert.match(servicos, /Configurações → Marca/);
});
