// ---------------------------------------------------------------------------
// TÓPICOS DO FINANCEIRO
//
// A lista de despesas virava um rolo: MacBook, monitor, Adobe, celular, curso,
// registro... cada gasto numa linha. O pedido foi juntar tudo em tópicos —
// "Perspectiva", "Salário Katy" — uma linha por tópico, com o total. O detalhe
// não some: abre por dentro quando ela quiser conferir item por item.
// ---------------------------------------------------------------------------

export const SEM_TOPICO = "Sem tópico";

/**
 * Junta lançamentos por categoria. Devolve uma linha por tópico com o total, o
 * quanto já foi pago (contando pagamento parcial) e o que sobrou em aberto.
 */
export function agrupaEmTopicos(linhas = []) {
  const mapa = new Map();
  for (const l of linhas) {
    const nome = (l.category || "").trim() || SEM_TOPICO;
    if (!mapa.has(nome)) mapa.set(nome, { topico: nome, itens: [], total: 0, pago: 0, aberto: 0, impagaveis: 0 });
    const g = mapa.get(nome);
    const valor = Number(l.amount) || 0;
    g.itens.push(l);
    g.total += valor;
    g.pago += l.status === "paid" ? valor : Number(l.paid_amount) || 0;
    if (l.impagavel) g.impagaveis++;
  }
  return [...mapa.values()].map((g) => ({
    ...g,
    total: +g.total.toFixed(2),
    pago: +g.pago.toFixed(2),
    aberto: +Math.max(0, g.total - g.pago).toFixed(2),
  })).sort((a, b) => b.total - a.total);
}

/** Vale a pena juntar? Com pouca coisa na tela, tópico só atrapalha. */
export function valeAPenaAgrupar(linhas = []) {
  const grupos = new Set(linhas.map((l) => (l.category || "").trim() || SEM_TOPICO));
  return linhas.length >= 6 && grupos.size < linhas.length;
}
