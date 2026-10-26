// CONFIGURAÇÕES USANDO A TELA TODA.
//
// "arruma essa aba de configuracoes pra usar a tela toda, reorganiza."
//
// A tela inteira cabia numa coluna de 620px: metade do monitor ficava vazia e
// as caixas (marca, recibos, portal, etapas, tipos, conta, armazenamento)
// desciam uma embaixo da outra, obrigando a rolar muito para achar qualquer
// coisa.
//
// Grade comum não resolve: as caixas têm alturas muito diferentes, e em grade
// a linha estica na altura da mais alta — sobra buraco embaixo das curtas, que
// é exatamente o desalinhamento de que ela reclamou em Minhas Finanças. Então
// aqui são COLUNAS (columnCount): cada caixa fica com a altura que precisa e
// elas se encaixam.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "../..");
const tela = readFileSync(join(RAIZ, "client/src/pages/Settings.jsx"), "utf8");

test("a coluna estreita acabou", () => {
  assert.ok(!/maxWidth: 620/.test(tela),
    "voltou a coluna de 620px — é ela que deixa metade da tela vazia");
});

test("as caixas se encaixam em colunas, não em linhas esticadas", () => {
  assert.match(tela, /columnCount: \{ xs: 1, md: 2, xl: 3 \}/,
    "uma coluna no celular, duas no computador, três na tela larga");
  assert.match(tela, /breakInside: "avoid"/,
    "sem isso uma caixa racha no meio ao virar a coluna");
  assert.ok(!/display: "grid"[\s\S]{0,80}gridTemplateColumns[\s\S]{0,200}columnCount/.test(tela),
    "grade esticaria as linhas na altura da caixa mais alta");
});

test("cada assunto perto do seu", () => {
  // Primeiro a marca, depois o que é do cliente, depois o que é da equipe,
  // e por último a conta e o armazenamento.
  const ordem = [
    "Marca (logo e favicon)",
    "Acessos dos clientes (portal)",
    "Aprovação de conteúdo",
    "Etapas do Kanban",
    "Tipos de tarefa e quem faz cada um",
    ">Conta<",
    "<Armazenamento />",
  ].map((t) => tela.indexOf(t));
  assert.ok(ordem.every((i) => i > 0), "alguma caixa sumiu da tela de configurações");
  for (let i = 1; i < ordem.length; i++) {
    assert.ok(ordem[i] > ordem[i - 1], `caixa ${i} saiu de ordem na tela`);
  }
});

test("Recibos fora das colunas, ocupando a largura toda", () => {
  // Medido no Chromium: dentro de uma coluna essa caixa ficava com 2642px de
  // altura — as outras duas colunas ficavam vazias ao lado dela, que é
  // justamente o buraco que ela mandou arrumar.
  const fim = tela.indexOf("</Box>", tela.indexOf('columnCount'));
  assert.ok(tela.indexOf("<ReceiptSettings />") > fim,
    "Recibos voltou para dentro das colunas — ela sozinha desequilibra a página");

  const recibos = readFileSync(join(RAIZ, "client/src/components/ReceiptSettings.jsx"), "utf8");
  assert.match(recibos, /gridTemplateColumns: \{[\s\S]*?xl: "minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(0, 1\.3fr\)"/,
    "quem emite | o modelo | a prévia, lado a lado na tela larga");
  assert.match(recibos, /gridColumn: \{ lg: "span 2", xl: "auto" \}/,
    "no notebook a prévia passa por baixo, da largura toda");
  assert.match(recibos, /position: \{ xl: "sticky" \}/,
    "a prévia acompanha quem mexe nos campos, sem rolar até o fim");
});
