// O NÚMERO DE CIMA DA ABINHA É "QUANTO AINDA FALTA".
//
// Pedido dela: "quando eu marcar aqui dentro como pago, quero que em cima
// apareça o valor ainda em aberto; se paguei tudo, aparece o valor completo
// mas mais clarinho."
//
// Antes aquele número era sempre o TOTAL — e total não responde a pergunta que
// ela faz olhando a tela, que é "quanto desse cartão eu ainda tenho de pagar".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const tela = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/pages/MinhasFinancas.jsx"), "utf8");

// A conta do grupo, extraída da tela e rodada de verdade — assim o teste mede
// o comportamento, não a aparência do código.
function agrupa(itens) {
  const g = { total: 0, pagoValor: 0, itens: 0 };
  for (const e of itens) {
    g.total += Number(e.amount) || 0;
    g.pagoValor += e.paid ? (Number(e.amount) || 0) : (Number(e.pago_parcial) || 0);
    g.itens++;
  }
  return {
    total: +g.total.toFixed(2),
    aberto: +Math.max(0, g.total - g.pagoValor).toFixed(2),
    tudoPago: g.itens > 0 && g.total - g.pagoValor <= 0.004,
  };
}

test("nada pago: mostra o total inteiro — ainda falta tudo", () => {
  const g = agrupa([{ amount: 151 }, { amount: 89.9 }]);
  assert.equal(g.aberto, 240.9);
  assert.equal(g.tudoPago, false);
});

test("marcou uma: o número cai para o que sobrou", () => {
  const g = agrupa([{ amount: 151, paid: true }, { amount: 89.9 }]);
  assert.equal(g.aberto, 89.9, "é esta a pergunta: quanto ainda falta");
  assert.equal(g.tudoPago, false);
});

test("marcou todas: aí sim o total cheio, para ficar claro quanto era", () => {
  const g = agrupa([{ amount: 151, paid: true }, { amount: 89.9, paid: true }]);
  assert.equal(g.tudoPago, true);
  assert.equal(g.total, 240.9);
});

test("a de mês anterior conta no que falta — ela ainda deve", () => {
  // Fatura do mês paga, setembro em aberto: o cartão continua devendo.
  const g = agrupa([{ amount: 151, paid: true }, { amount: 303.92, atrasado_de: "2026-09" }]);
  assert.equal(g.aberto, 303.92);
  assert.equal(g.tudoPago, false, "não dá para dizer 'tudo pago' devendo setembro");
});

test("centavo de arredondamento não impede o 'tudo pago'", () => {
  // 0,1 + 0,2 não dá exatamente 0,3 em ponto flutuante. Sem a folga, o grupo
  // ficaria eternamente devendo um centésimo de centavo.
  const g = agrupa([{ amount: 0.1, paid: true }, { amount: 0.2, paid: true }]);
  assert.equal(g.tudoPago, true);
});

test("grupo vazio não é 'tudo pago'", () => {
  assert.equal(agrupa([]).tudoPago, false);
});

// --- e a tela faz isso mesmo --------------------------------------------------------

test("a tela mostra o aberto, e o total só quando tudo está pago", () => {
  assert.match(tela, /\{currency\(g\.tudoPago \? g\.total : g\.aberto\)\}/);
});

test("pago fica mais clarinho — foi isso que ela pediu", () => {
  assert.match(tela, /color: g\.tudoPago \? "text\.disabled" : undefined/);
});

test("a conta da tela é a mesma que este teste mede", () => {
  assert.match(tela, /aberto: \+Math\.max\(0, g\.total - g\.pagoValor\)\.toFixed\(2\)/);
  assert.match(tela, /tudoPago: g\.items\.length > 0 && g\.total - g\.pagoValor <= 0\.004/);
  assert.match(tela, /map\[k\]\.pagoValor \+= e\.paid \? \(Number\(e\.amount\) \|\| 0\) : \(Number\(e\.pago_parcial\) \|\| 0\);/,
    "a baixa parcial é dinheiro que saiu: conta no 'quanto ainda falta'");
});

test("o total cheio não se perde: fica no aviso ao passar o mouse", () => {
  assert.match(tela, /ainda em aberto, de \$\{currency\(g\.total\)\}/);
  assert.match(tela, /Tudo pago — \$\{currency\(g\.total\)\} no total/);
});

test("o check do cabeçalho continua sendo sobre a fatura DO MÊS", () => {
  // Duas perguntas diferentes: o número diz quanto falta no cartão (contando o
  // atraso), o check diz se a fatura deste mês foi paga. Misturar os dois faria
  // o check nunca mais ficar marcado.
  assert.match(tela, /allPaid: g\.doMes > 0 && g\.pagos === g\.doMes/);
});

// --- A PONTE COM O FINANCEIRO ---------------------------------------------------------
//
// "Lá no Financeiro quero que interligue a isso aqui: quando eu pagar qualquer
// coisa aqui, além de mudar em cima, mudar lá também, pra aparecer o valor
// total mais baixinho e o valor ainda em aberto forte."

const financeiro = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/pages/Financial.jsx"), "utf8");

test("o Financeiro mostra o que FALTA forte e o total baixinho", () => {
  assert.match(financeiro, /const falta = Math\.max\(0, total - pago\)/);
  assert.match(financeiro, /de \{currency\(total\)\}/, "o total continua à vista, só que menor");
  assert.match(financeiro, /color: "text\.disabled"/);
});

test("pago inteiro fica claro nos dois lugares — a mesma leitura", () => {
  assert.match(financeiro, /if \(falta <= 0\.004\)/, "a mesma folga de centavo de Minhas Finanças");
  assert.match(tela, /color: g\.tudoPago \? "text\.disabled" : undefined/);
});

test("sem nada pago, a linha continua como sempre foi", () => {
  assert.match(financeiro, /if \(pago <= 0\)/);
});

test("o aviso verde só aparece com a ponte LIGADA", () => {
  // Ele anunciava "aparece no Financeiro" mesmo desligada — e era isso que
  // fazia o interruptor parecer quebrado: a tela dizia a mesma coisa antes e
  // depois de ligar.
  assert.match(tela, /\{s\?\.total > 0 && data\?\.ponte_financeiro && \(/);
});

test("os números ficam numa fileira só, e o controle sai dela", () => {
  // O cartão do Lazer tem campo e interruptor: é três vezes mais alto que os
  // outros e esticava a fileira inteira.
  const bloco = tela.slice(tela.indexOf("OS NÚMEROS NUMA FILEIRA SÓ"), tela.indexOf("A FAIXA DE CONTROLE"));
  assert.match(bloco, /alignItems: "stretch"/);
  assert.doesNotMatch(bloco, /Lazer deste mês/, "o controle não fica na fileira dos números");
  assert.doesNotMatch(bloco, /gridColumn/, "nenhum cartão ocupa duas colunas — era o que desalinhava");
  assert.match(tela, /A FAIXA DE CONTROLE/);
});

test("pagar um pedaço baixa o número de cima, sem quitar a conta", () => {
  // Os dois ícones novos da linha: um dá baixa parcial, o outro lança juros.
  const g = agrupa([{ amount: 200, pago_parcial: 50 }, { amount: 100 }]);
  assert.equal(g.aberto, 250, "300 menos os 50 que já saíram");
  assert.equal(g.tudoPago, false);
});
