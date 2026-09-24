// ---------------------------------------------------------------------------
// LANDING PAGES — a conta da renovação.
//
// Uma LP é uma venda única que vira uma obrigação anual: o site fica no ar, o
// domínio vence, e alguém precisa lembrar de cobrar a renovação ANTES disso.
// Esquecer é perder o cliente e, pior, deixar o site dele cair.
//
// Todo o controle conta a partir da DATA DE PUBLICAÇÃO — não da venda, nem da
// assinatura do contrato. É o dia em que o site entrou no ar que marca o ano.
//
// Este arquivo é só conta: nada de banco, nada de rota. É o que dá para testar
// sem subir servidor nenhum, e é onde mora a regra que não pode errar.
// ---------------------------------------------------------------------------

export const VALOR_LP_PADRAO = 1000;
export const VALOR_RENOVACAO_PADRAO = 300;

// Os marcos do aviso, em dias ANTES do vencimento. O contrato prevê cobrança
// com 30 dias de antecedência; o aviso de 45 existe para ela ter folga para
// conversar antes de cobrar.
export const AVISO_LEMBRETE = 45;
export const AVISO_COBRANCA = 30;
// Depois do vencimento, quantos dias de tolerância antes de o site sair do ar.
export const DIAS_DE_TOLERANCIA = 15;

/** Uma data em AAAA-MM-DD, ou null se não der para entender. */
export function soData(v) {
  const t = String(v || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

/**
 * Soma meses a uma data, sem estourar o fim do mês.
 *
 * Publicado em 31 de janeiro, a renovação não pode cair em 3 de março: JS faz
 * isso sozinho quando o mês de destino é mais curto. Aqui, 31/01 + 12 meses é
 * 31/01 do ano seguinte, e 31/03 + 1 mês é 30/04.
 */
export function somaMeses(data, meses) {
  const base = soData(data);
  if (!base) return null;
  const [a, m, d] = base.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimoDia));
  return alvo.toISOString().slice(0, 10);
}

/** Quando vence o ano N da LP (ano 1 = o primeiro aniversário da publicação). */
export function vencimentoDoAno(publicado_em, ano) {
  return somaMeses(publicado_em, 12 * Math.max(1, Number(ano) || 1));
}

/** Dias de hoje até a data. Negativo quer dizer que já passou. */
export function diasAte(data, hoje = new Date()) {
  const alvo = soData(data);
  if (!alvo) return null;
  const a = Date.parse(`${alvo}T00:00:00Z`);
  const h = Date.parse(`${hoje.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((a - h) / 86400000);
}

/**
 * Em que pé está uma renovação, olhando a data e o que já foi marcado à mão.
 *
 * O que ela marcou manda: "pago" e "cancelado" são decisões dela e não são
 * recalculados. O resto sai do calendário — assim a lista nunca mostra "em dia"
 * numa renovação que venceu ontem só porque ninguém abriu a tela.
 */
export function situacaoDaRenovacao(renovacao = {}, hoje = new Date()) {
  const marcado = String(renovacao.status || "").trim();
  if (marcado === "pago" || marcado === "cancelado") return marcado;

  const dias = diasAte(renovacao.vence_em, hoje);
  if (dias === null) return "em_dia";
  if (dias < -DIAS_DE_TOLERANCIA) return "tolerancia_vencida";
  if (dias < 0) return "atrasado";
  // Já avisada e ainda no prazo: mostra que a bola está com o cliente.
  if (marcado === "avisado") return "avisado";
  return "em_dia";
}

/** A cor do semáforo na lista. */
export function corDaSituacao(situacao, dias) {
  if (situacao === "pago") return "success";
  if (situacao === "cancelado") return "default";
  if (situacao === "atrasado" || situacao === "tolerancia_vencida") return "error";
  if (dias !== null && dias <= AVISO_LEMBRETE) return "warning";
  return "success";
}

/**
 * Quais avisos esta renovação está devendo HOJE.
 *
 * Devolve a lista de marcos vencidos que ainda não foram avisados — quem chama
 * grava o que já mandou, para o mesmo aviso não sair todo dia. Renovação paga
 * ou cancelada não gera aviso nenhum.
 */
export function avisosDevidos(renovacao = {}, hoje = new Date(), jaAvisados = []) {
  const marcado = String(renovacao.status || "").trim();
  if (marcado === "pago" || marcado === "cancelado") return [];
  const dias = diasAte(renovacao.vence_em, hoje);
  if (dias === null) return [];

  const marcos = [
    { chave: "lembrete", quando: dias <= AVISO_LEMBRETE && dias > AVISO_COBRANCA },
    { chave: "cobranca", quando: dias <= AVISO_COBRANCA && dias >= 0 },
    { chave: "atrasado", quando: dias < 0 && dias >= -DIAS_DE_TOLERANCIA },
    { chave: "tolerancia", quando: dias < -DIAS_DE_TOLERANCIA },
  ];
  return marcos
    .filter((m) => m.quando && !jaAvisados.includes(m.chave))
    .map((m) => m.chave);
}

/** O texto de cada aviso, para a notificação da equipe. */
export function textoDoAviso(chave, { cliente, endereco, vence_em, valor, dias }) {
  const site = endereco || "o site";
  const quanto = valor ? ` (R$ ${Number(valor).toFixed(2).replace(".", ",")})` : "";
  switch (chave) {
    case "lembrete":
      return `🗓️ ${cliente}: a renovação de ${site} vence em ${dias} dias (${vence_em})${quanto}. `
        + "Boa hora de chamar para conversar, antes de cobrar.";
    case "cobranca":
      return `💰 ${cliente}: hora de enviar a cobrança da renovação de ${site} — vence em ${dias} dias `
        + `(${vence_em})${quanto}.`;
    case "atrasado":
      return `⚠️ ${cliente}: a renovação de ${site} venceu em ${vence_em}${quanto} e não foi paga.`;
    case "tolerancia":
      return `🚨 ${cliente}: passou o prazo de tolerância (${DIAS_DE_TOLERANCIA} dias) da renovação de `
        + `${site}, vencida em ${vence_em}${quanto}. Decida se o site sai do ar.`;
    default:
      return `${cliente}: renovação de ${site}.`;
  }
}

/** A mensagem pronta para ela copiar e mandar ao cliente. */
export function mensagemDeRenovacao({ cliente, endereco, vence_em, valor, agencia }) {
  const dinheiro = `R$ ${Number(valor || VALOR_RENOVACAO_PADRAO).toFixed(2).replace(".", ",")}`;
  const data = vence_em ? vence_em.split("-").reverse().join("/") : "";
  return [
    `Oi, ${cliente}! Tudo bem?`,
    "",
    `Passando para lembrar que a renovação anual do site ${endereco || ""} vence em ${data}.`,
    "",
    `A renovação é de ${dinheiro} e cobre mais 12 meses de domínio no ar, hospedagem, `
      + "certificado de segurança e os ajustes pontuais combinados.",
    "",
    "Posso seguir com a renovação? Me confirma que eu já te mando o pagamento.",
    "",
    agencia ? `— ${agencia}` : "",
  ].filter((l) => l !== null).join("\n").trim();
}
