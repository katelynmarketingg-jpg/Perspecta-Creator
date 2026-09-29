// DATA SEM HORA É UMA DATA, NÃO UM INSTANTE.
//
// O bug: um post bônus criado para OUTUBRO aparecia agrupado em SETEMBRO. O
// título saía certo ("10/2026") porque é texto; a data, não.
//
// `new Date("2026-10-01")` — data sem hora — é lida pelo navegador como
// meia-noite em GREENWICH. Aqui no Brasil (UTC-3) isso é 21h do dia 30 de
// setembro, então `getMonth()` devolve setembro e a peça cai no grupo errado.
//
// Vale para o dia 1º de qualquer mês, em qualquer tela que agrupe por data.
process.env.TZ = "America/Sao_Paulo";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
const { dataLocal, chaveDoMes, chaveDoDia } = await import("../../client/src/data-local.js");

test("o fuso do teste é o dela — senão este arquivo não prova nada", () => {
  // Um fuso NEGATIVO é o que faz a meia-noite de Greenwich cair no dia anterior.
  assert.ok(new Date(2026, 9, 1).getTimezoneOffset() > 0,
    "precisa rodar num fuso a oeste de Greenwich para o bug existir");
});

test("é ASSIM que o bug acontecia", () => {
  // A leitura antiga, que estava espalhada pelas telas.
  assert.equal(new Date("2026-10-01").getMonth(), 8, "outubro virava setembro (mês 8)");
  assert.equal(new Date("2026-10-01").getDate(), 30, "e o dia 1º virava dia 30");
});

test("data sem hora vira meia-noite LOCAL — o mês é o que foi escolhido", () => {
  const d = dataLocal("2026-10-01");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9, "outubro é outubro");
  assert.equal(d.getDate(), 1, "e o dia 1º é o dia 1º");
  assert.equal(d.getHours(), 0);
});

test("o dia 1º de todo mês do ano cai no mês certo", () => {
  for (let m = 1; m <= 12; m++) {
    const chave = chaveDoMes(`2026-${String(m).padStart(2, "0")}-01`);
    assert.equal(chave, `2026-${String(m).padStart(2, "0")}`, `mês ${m}`);
  }
});

test("virada de ano também: 1º de janeiro não vira dezembro do ano passado", () => {
  assert.equal(chaveDoMes("2027-01-01"), "2027-01");
  assert.equal(chaveDoDia("2027-01-01"), "2027-01-01");
});

test("quem já traz hora continua como estava — aí é instante de verdade", () => {
  // "2026-10-01 09:30" é o formato do nosso banco: hora local, sem fuso.
  const d = dataLocal("2026-10-01 09:30");
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 1);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 30);
});

test("data com fuso explícito é respeitada, não reinterpretada", () => {
  // Marcado às 10h de Brasília, gravado em UTC: tem de voltar como 10h daqui.
  const d = dataLocal("2026-10-10T13:00:00.000Z");
  assert.equal(d.getHours(), 10, "13h em Greenwich são 10h aqui");
  assert.equal(d.getDate(), 10);
});

test("sem data, ou com lixo, devolve null — e ninguém quebra", () => {
  assert.equal(dataLocal(null), null);
  assert.equal(dataLocal(""), null);
  assert.equal(dataLocal("qualquer coisa"), null);
  assert.equal(chaveDoMes(null), null);
});

// --- as telas que agrupam por data usam a leitura nova ----------------------

const dist = readFileSync(join(aqui, "../../client/src/pages/Distribution.jsx"), "utf8");
const feed = readFileSync(join(aqui, "../../client/src/components/FeedPreview.jsx"), "utf8");
const portal = readFileSync(join(aqui, "../../client/src/pages/Portal.jsx"), "utf8");

test("o agrupamento por mês da Distribuição usa a leitura nova", () => {
  const trecho = dist.slice(dist.indexOf("function agrupaPorMes"), dist.indexOf("const GRADE ="));
  assert.match(trecho, /const d = dataLocal\(it\.scheduled_at\)/);
  assert.ok(!/new Date\(it\.scheduled_at/.test(trecho), "a leitura antiga saiu");
});

test("o calendário do mês também", () => {
  const trecho = dist.slice(dist.indexOf("function MonthGrid"), dist.indexOf("function MonthGrid") + 900);
  assert.match(trecho, /const d = dataLocal\(it\.scheduled_at\)/);
});

test("nenhuma tela lê scheduled_at do jeito antigo", () => {
  for (const [nome, fonte] of [["Distribuição", dist], ["prévia do feed", feed], ["Área do Cliente", portal]]) {
    const sobrou = fonte.match(/new Date\(\w+\.scheduled_at[^)]*\)/g) || [];
    assert.deepEqual(sobrou, [], `${nome} ainda lê a data do jeito antigo`);
  }
});

test("a prévia do perfil ordena pela mesma leitura", () => {
  assert.match(dist, /const dtISO = \(v\) => dataLocal\(v\)/);
});
