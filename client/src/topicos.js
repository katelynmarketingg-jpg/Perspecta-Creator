// ---------------------------------------------------------------------------
// TÓPICOS DO FINANCEIRO
//
// A lista de despesas virava um rolo: MacBook, monitor, Netcomet, Adobe,
// "Claude + chat + dropbox + apple", celular, curso... cada gasto numa linha.
// O pedido foi juntar tudo em tópicos — uma linha por tópico, com o total. O
// detalhe não some: abre por dentro quando ela clicar.
//
// O tópico de fábrica é CUSTOS PERSPECTIVA: despesa sem categoria é conta da
// agência, e era exatamente esse monte de assinatura miúda que ela queria ver
// num número só.
// ---------------------------------------------------------------------------

export const CUSTOS_PERSPECTIVA = "Custos Perspectiva";

/** Conta da agência: sem categoria, ou marcada como Perspectiva. As duas viram o mesmo tópico. */
const ehCustoDaCasa = (categoria) => {
  const c = String(categoria ?? "").trim();
  return !c || /perspec/i.test(c);
};

/** Em que tópico esta linha entra. */
export function topicoDaLinha(linha = {}) {
  return ehCustoDaCasa(linha.category) ? CUSTOS_PERSPECTIVA : linha.category.trim();
}

/**
 * Junta lançamentos por tópico. Devolve uma linha por tópico com o total, o
 * quanto já foi pago (contando pagamento parcial) e o que sobrou em aberto.
 */
export function agrupaEmTopicos(linhas = []) {
  const mapa = new Map();
  for (const l of linhas) {
    const nome = topicoDaLinha(l);
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
  const grupos = new Set(linhas.map((l) => topicoDaLinha(l)));
  return linhas.length >= 4 && grupos.size < linhas.length;
}
