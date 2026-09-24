// A CONTA DA RENOVAÇÃO DE UMA LANDING PAGE.
//
// Uma LP é uma venda única que vira obrigação anual: o site fica no ar, o
// domínio vence, e alguém tem de cobrar a renovação ANTES disso. Esquecer é
// perder o cliente e deixar o site dele cair.
//
// Por isso a conta vive sozinha, sem banco e sem rota: é a regra que não pode
// errar, e é a que dá para provar linha por linha.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  somaMeses, vencimentoDoAno, diasAte, situacaoDaRenovacao, corDaSituacao,
  avisosDevidos, mensagemDeRenovacao, textoDoAviso,
  AVISO_LEMBRETE, AVISO_COBRANCA, DIAS_DE_TOLERANCIA,
} from "../src/landing.js";

const emDia = (d) => new Date(`${d}T12:00:00Z`);

// ---------------------------------------------------------------------------
// A DATA
// ---------------------------------------------------------------------------
test("a renovação é a publicação + 12 meses", () => {
  assert.equal(vencimentoDoAno("2025-06-10", 1), "2026-06-10");
});

test("o ano 2 e o ano 3 contam da publicação, não do pagamento anterior", () => {
  assert.equal(vencimentoDoAno("2025-06-10", 2), "2027-06-10");
  assert.equal(vencimentoDoAno("2025-06-10", 3), "2028-06-10");
});

test("publicado em 31 não escorrega para o mês seguinte", () => {
  // Sem cuidado, 31/01 + 12 meses vira 03/03 em ano bissexto: o JS estoura o
  // fim do mês sozinho, e a renovação apareceria com a data errada.
  assert.equal(somaMeses("2025-01-31", 1), "2025-02-28");
  assert.equal(somaMeses("2025-03-31", 1), "2025-04-30");
  assert.equal(vencimentoDoAno("2025-01-31", 1), "2026-01-31");
});

test("publicado em 29 de fevereiro cai no dia 28 no ano comum", () => {
  assert.equal(vencimentoDoAno("2024-02-29", 1), "2025-02-28");
  assert.equal(vencimentoDoAno("2024-02-29", 4), "2028-02-29");
});

test("sem data de publicação não há vencimento inventado", () => {
  assert.equal(vencimentoDoAno("", 1), null);
  assert.equal(vencimentoDoAno("qualquer coisa", 1), null);
  assert.equal(diasAte(null), null);
});

test("dias até: hoje é zero, ontem é negativo", () => {
  assert.equal(diasAte("2026-03-10", emDia("2026-03-10")), 0);
  assert.equal(diasAte("2026-03-11", emDia("2026-03-10")), 1);
  assert.equal(diasAte("2026-03-09", emDia("2026-03-10")), -1);
});

// ---------------------------------------------------------------------------
// A SITUAÇÃO
// ---------------------------------------------------------------------------
test("longe do vencimento, está em dia", () => {
  assert.equal(situacaoDaRenovacao({ vence_em: "2026-12-01" }, emDia("2026-03-10")), "em_dia");
});

test("vencida ontem e sem pagar é atrasada — mesmo que ninguém abra a tela", () => {
  assert.equal(situacaoDaRenovacao({ vence_em: "2026-03-09" }, emDia("2026-03-10")), "atrasado");
});

test("passada a tolerância, muda de nome: é outra conversa", () => {
  const hoje = emDia("2026-04-01");
  assert.equal(situacaoDaRenovacao({ vence_em: "2026-03-25" }, hoje), "atrasado");
  assert.equal(situacaoDaRenovacao({ vence_em: "2026-03-10" }, hoje), "tolerancia_vencida");
});

test("o que ela marcou manda: pago e cancelado não são recalculados", () => {
  const hoje = emDia("2026-04-01");
  assert.equal(situacaoDaRenovacao({ vence_em: "2026-01-01", status: "pago" }, hoje), "pago");
  assert.equal(situacaoDaRenovacao({ vence_em: "2026-01-01", status: "cancelado" }, hoje), "cancelado");
});

test("avisado continua avisado enquanto está no prazo, e vira atrasado depois", () => {
  assert.equal(situacaoDaRenovacao({ vence_em: "2026-04-10", status: "avisado" }, emDia("2026-04-01")), "avisado");
  assert.equal(situacaoDaRenovacao({ vence_em: "2026-03-20", status: "avisado" }, emDia("2026-04-01")), "atrasado");
});

test("a cor do semáforo acompanha a situação", () => {
  assert.equal(corDaSituacao("em_dia", 200), "success");
  assert.equal(corDaSituacao("em_dia", 40), "warning", "a vencer em até 45 dias já é amarelo");
  assert.equal(corDaSituacao("atrasado", -3), "error");
  assert.equal(corDaSituacao("tolerancia_vencida", -40), "error");
  assert.equal(corDaSituacao("pago", -400), "success");
});

// ---------------------------------------------------------------------------
// OS AVISOS
// ---------------------------------------------------------------------------
test("45 dias antes sai o lembrete, e só ele", () => {
  const r = { vence_em: "2026-05-01" };
  assert.deepEqual(avisosDevidos(r, emDia("2026-03-17")), ["lembrete"]);   // 45 dias
  assert.deepEqual(avisosDevidos(r, emDia("2026-03-01")), []);             // 61 dias: cedo demais
});

test("30 dias antes sai a cobrança", () => {
  const r = { vence_em: "2026-05-01" };
  assert.deepEqual(avisosDevidos(r, emDia("2026-04-01")), ["cobranca"]);   // 30 dias
});

test("no dia do vencimento ainda é cobrança; no dia seguinte é atraso", () => {
  const r = { vence_em: "2026-05-01" };
  assert.deepEqual(avisosDevidos(r, emDia("2026-05-01")), ["cobranca"]);
  assert.deepEqual(avisosDevidos(r, emDia("2026-05-02")), ["atrasado"]);
});

test("passados 15 dias do vencimento, o aviso é o da tolerância", () => {
  const r = { vence_em: "2026-05-01" };
  assert.deepEqual(avisosDevidos(r, emDia("2026-05-16")), ["atrasado"]);
  assert.deepEqual(avisosDevidos(r, emDia("2026-05-17")), ["tolerancia"]);
});

test("o mesmo aviso não sai duas vezes", () => {
  const r = { vence_em: "2026-05-01" };
  assert.deepEqual(avisosDevidos(r, emDia("2026-04-01"), ["cobranca"]), []);
});

test("renovação paga ou cancelada não incomoda mais ninguém", () => {
  const hoje = emDia("2026-06-01");
  assert.deepEqual(avisosDevidos({ vence_em: "2026-05-01", status: "pago" }, hoje), []);
  assert.deepEqual(avisosDevidos({ vence_em: "2026-05-01", status: "cancelado" }, hoje), []);
});

test("cada aviso fala com ela na língua dela, e diz o que fazer", () => {
  const dados = { cliente: "Marcelo", endereco: "advogadomarcelolemos.com.br",
                  vence_em: "2026-05-01", valor: 300, dias: 30 };
  assert.match(textoDoAviso("cobranca", dados), /cobran/i);
  assert.match(textoDoAviso("cobranca", dados), /advogadomarcelolemos/);
  assert.match(textoDoAviso("tolerancia", dados), /tolerância/i);
  assert.match(textoDoAviso("tolerancia", dados), new RegExp(String(DIAS_DE_TOLERANCIA)));
});

test("a mensagem de renovação sai pronta para copiar, com data e valor em português", () => {
  const m = mensagemDeRenovacao({
    cliente: "Marcelo", endereco: "advogadomarcelolemos.com.br",
    vence_em: "2026-05-01", valor: 300, agencia: "Perspectiva",
  });
  assert.match(m, /01\/05\/2026/);
  assert.match(m, /R\$ 300,00/);
  assert.match(m, /Perspectiva/);
  assert.ok(!m.includes("undefined"), "nada de 'undefined' numa mensagem que vai para o cliente");
});

test("os marcos são os que o contrato promete", () => {
  assert.equal(AVISO_LEMBRETE, 45);
  assert.equal(AVISO_COBRANCA, 30);
  assert.equal(DIAS_DE_TOLERANCIA, 15);
});
