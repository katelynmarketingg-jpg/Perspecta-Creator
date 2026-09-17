// ---------------------------------------------------------------------------
// QUEM APARECE E QUEM NÃO APARECE, depois de arquivado.
//
// A regra do dia a dia é simples: arquivado some. A do Financeiro não é —
// o cliente saiu, mas ainda tem uma parcela combinada para cair. Ele continua
// na tela ATÉ O FIM DO MÊS do último pagamento; passado esse mês, some de lá
// também. Assim ela não perde de vista quem ainda deve, e a tela não fica
// carregando ex-cliente para sempre.
// ---------------------------------------------------------------------------

/** O último dia do mês de uma data "AAAA-MM-..." (ou null se não houver data). */
export function fimDoMes(data) {
  if (!data) return null;
  const m = /^(\d{4})-(\d{2})/.exec(String(data));
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  // Dia 0 do mês seguinte = último dia deste mês.
  const d = new Date(Date.UTC(ano, mes, 0));
  return d.toISOString().slice(0, 10);
}

/** Ainda vale no Financeiro? (não arquivado, ou dentro do mês do último pagamento) */
export function apareceNoFinanceiro(cliente, hoje = new Date().toISOString().slice(0, 10)) {
  if (!cliente?.archived_at) return true;
  const limite = fimDoMes(cliente.pagamento_ate);
  if (!limite) return false;          // arquivado sem data de pagamento: sai na hora
  return hoje <= limite;
}

/**
 * O trecho de SQL que filtra a lista, por tela.
 *
 * 'ativos'     — o dia a dia: Distribuição, Tarefas, Planejamento, Galeria,
 *                Relatórios, Metas. Arquivado não aparece.
 * 'financeiro' — ativos + arquivados cujo mês de último pagamento ainda não passou.
 * 'arquivados' — só os arquivados (a aba de registros).
 * 'todos'      — tudo, sem filtro.
 */
export function filtroDeClientes(escopo, hoje = new Date().toISOString().slice(0, 10)) {
  if (escopo === "todos") return { sql: "", params: [] };
  if (escopo === "arquivados") return { sql: " AND archived_at IS NOT NULL", params: [] };
  if (escopo === "financeiro") {
    // date(pagamento_ate,'start of month','+1 month','-1 day') = fim daquele mês.
    return {
      sql: ` AND (archived_at IS NULL
                  OR (pagamento_ate IS NOT NULL
                      AND date(?) <= date(pagamento_ate, 'start of month', '+1 month', '-1 day')))`,
      params: [hoje],
    };
  }
  return { sql: " AND archived_at IS NULL", params: [] };
}
