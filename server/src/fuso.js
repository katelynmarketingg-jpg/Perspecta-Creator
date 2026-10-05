// ---------------------------------------------------------------------------
// A HORA MARCADA É A HORA DAQUI
//
// O bug que trouxe este arquivo: ela aprovou um post para as 15:25 e ele não
// saiu na hora. O servidor (Render) roda com o relógio de Greenwich; a hora
// que o navegador grava é a hora do Brasil, sem fuso nenhum junto —
// "2026-10-05 15:25", texto puro. Quando o robô comparava essa hora com o
// datetime('now') do banco, estava comparando hora do Brasil com hora de
// Greenwich: às 12:25 daqui o relógio de lá já marcava 15:25, e o post
// contava como vencido TRÊS HORAS ANTES.
//
// Guardar em UTC resolveria também, mas obrigaria a converter tudo que já
// está gravado — e toda tela que mostra a hora. O caminho mais seguro é o
// contrário: deixar o dado como está e perguntar as horas no fuso certo.
//
// O Brasil não tem mais horário de verão (acabou em 2019), mas isto não
// depende disso: quem resolve o fuso é o próprio sistema, pelo nome da
// cidade. Se um dia voltar, volta sozinho.
// ---------------------------------------------------------------------------

/** O fuso da agência. Dá para trocar sem mexer no código. */
export const FUSO = process.env.FUSO_DA_AGENCIA || "America/Sao_Paulo";

const FORMATO = new Intl.DateTimeFormat("sv-SE", {
  timeZone: FUSO, dateStyle: "short", timeStyle: "medium",
});

/**
 * Agora, no fuso da agência, no mesmo formato em que o banco guarda as horas
 * marcadas ("AAAA-MM-DD HH:MM:SS"). É com isto que se compara scheduled_at.
 */
export function agoraNaAgencia(quando = new Date()) {
  return FORMATO.format(quando).replace("T", " ");
}
