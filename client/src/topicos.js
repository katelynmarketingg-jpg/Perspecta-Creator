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
export const SALARIOS = "Salários";

/** Conta da agência: sem categoria, ou marcada como Perspectiva. As duas viram o mesmo tópico. */
const ehCustoDaCasa = (categoria) => {
  const c = String(categoria ?? "").trim();
  return !c || /perspec/i.test(c);
};

/**
 * Salário é salário, escrito como for. Na tela dela havia três linhas em dois
 * tópicos ("Salário" e "Salários") só por causa da letra final — e o "Salário
 * Katy" num terceiro. São a mesma coisa e ficam juntas.
 */
const ehSalario = (categoria, descricao) =>
  /sal[áa]rios?\b/i.test(String(categoria ?? "")) || /^\s*sal[áa]rio\b/i.test(String(descricao ?? ""));

/** Em que tópico esta linha entra. */
export function topicoDaLinha(linha = {}) {
  if (ehSalario(linha.category, linha.description)) return SALARIOS;
  return ehCustoDaCasa(linha.category) ? CUSTOS_PERSPECTIVA : linha.category.trim();
}

/**
 * Os nomes que estão dentro do tópico, para o título dizer o que ele guarda.
 * "Salários" sozinho não informa nada; "Salário Bruno, Salário Rafaela, Salário
 * Katy" responde na hora. Com muita coisa dentro, mostra os primeiros e conta
 * o resto — um título não pode virar parágrafo.
 */
export function nomesDoTopico(itens = [], limite = 3) {
  const nomes = itens.map((i) => (i.description || "").trim()).filter(Boolean);
  if (!nomes.length) return "";
  if (nomes.length <= limite) return nomes.join(", ");
  return `${nomes.slice(0, limite).join(", ")} +${nomes.length - limite}`;
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
    nomes: nomesDoTopico(g.itens),
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
