// ---------------------------------------------------------------------------
// DATA SEM HORA É UMA DATA, NÃO UM INSTANTE.
//
// O bug que trouxe este arquivo: um post bônus criado para OUTUBRO aparecia
// agrupado em SETEMBRO. O título vinha certo ("10/2026") porque é texto; a
// data, não.
//
// Por quê: `new Date("2026-10-01")` — uma data sem hora — é lida pelo navegador
// como meia-noite em UTC. Aqui no Brasil (UTC-3), isso é 21h do dia 30 de
// SETEMBRO. Aí `getMonth()` devolve setembro, e a peça cai no grupo errado.
//
// Vale para todo dia 1º de todo mês, e para a primeira hora de qualquer dia:
// a peça marcada para o dia 1º sempre caía no mês anterior.
//
// A regra aqui é simples: data sem hora vira meia-noite LOCAL. Quem já traz
// hora continua como estava — aí é um instante de verdade, e o fuso importa.
// ---------------------------------------------------------------------------

const SO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Transforma o que vem do servidor em Date, sem escorregar de dia.
 * Devolve null quando não há data (ou quando o texto não é data nenhuma).
 */
export function dataLocal(valor) {
  if (!valor) return null;
  const texto = String(valor).trim();

  // "2026-10-01" → meia-noite local, não de Greenwich.
  const so = SO_DATA.exec(texto);
  if (so) return new Date(Number(so[1]), Number(so[2]) - 1, Number(so[3]));

  // "2026-10-01 14:30" (o formato do nosso banco) → o T que o navegador espera.
  // Sem Z nem fuso no fim, o navegador já lê como hora local, que é o certo:
  // a hora marcada é a hora daqui.
  const d = new Date(texto.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** O mês da data, no formato "AAAA-MM" — a chave dos agrupamentos por mês. */
export function chaveDoMes(valor) {
  const d = dataLocal(valor);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** O dia da data, no formato "AAAA-MM-DD" — a chave do calendário. */
export function chaveDoDia(valor) {
  const d = dataLocal(valor);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
