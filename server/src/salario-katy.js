// ---------------------------------------------------------------------------
// SALÁRIO KATY — a ponte entre as Minhas Finanças e o Financeiro.
//
// O dinheiro que ela tira da empresa não sai de uma vez: sai aos poucos, uma
// conta de cada vez. Toda vez que ela dá check num gasto pessoal, aquele valor
// já saiu do caixa — então tem que aparecer no Financeiro. Mas não como vinte
// linhas soltas (MacBook, monitor, Adobe, celular...): como UMA linha só, que
// vai engordando. É o que ela pediu — "fica no mesmo tópico".
//
// Aqui ficam só as contas. Quem mexe no banco é o routes/personal-finance.js.
// ---------------------------------------------------------------------------

export const TOPICO_PERSPECTIVA = "Perspectiva";
export const TOPICO_SALARIO = "Salário Katy";

/** Gasto da empresa que foi parar nas finanças pessoais. O lugar dele é o Financeiro. */
export function souDaPerspectiva(categoria) {
  return /perspec/i.test(String(categoria ?? ""));
}

/** Como a linha do Financeiro se chama, a partir do nome de quem é o salário. */
export function topicoDoSalario(nome) {
  const primeiro = String(nome ?? "").trim().split(/\s+/)[0];
  return primeiro ? `Salário ${primeiro}` : TOPICO_SALARIO;
}

const soma = (linhas) => +linhas.reduce((s, l) => s + (Number(l.amount) || 0), 0).toFixed(2);

/** O que é dela mesma — gasto pessoal, tirando o que é da Perspectiva. */
export const soMeus = (linhas = []) => linhas.filter((l) => !souDaPerspectiva(l.category));

/** Quanto ela JÁ tirou este mês: a soma do que está com check. */
export function quantoJaPeguei(linhas = []) {
  return soma(soMeus(linhas).filter((l) => l.paid));
}

/**
 * O SALÁRIO DELA NO MÊS — o que a empresa precisa pagar para ela.
 *
 * Palavras dela: "o meu vai ser o que está lá nas minhas finanças de gastos,
 * mais o que eu colocar de lazer". É o mês inteiro dela, pago ou não, mais o
 * que ela quer tirar para si por cima. Não é "o que já saiu": é o tamanho do
 * salário, e por isso não muda quando ela dá um check numa conta — muda quando
 * ela mexe nas contas ou no lazer.
 */
export function quantoEhOMeu(linhas = [], lazer = 0) {
  return +(soma(soMeus(linhas)) + Math.max(0, Number(lazer) || 0)).toFixed(2);
}

/** O que ainda está em aberto — o que falta pagar das contas dela. */
export function quantoFaltaPagar(linhas = []) {
  return soma(soMeus(linhas).filter((l) => !l.paid));
}

/**
 * A conta que ela quis ver em cima: "o que falta pagar do meu".
 *
 * Palavras dela: "o meu é os valores que tenho em aberto, mais o valor que eu
 * colocar ali". Ou seja — o que ainda precisa sair do caixa este mês é o que
 * falta pagar das contas MAIS o que ela quer tirar para si por cima.
 *
 * Esse segundo valor é o LAZER do mês ("se eu vou pegar algo do que sobrou pra
 * lazer"), não um salário fixo; o campo continua chamado `salario` aqui e
 * `salary` no banco por história, e a tela diz Lazer. E ele já não é o cheio:
 * desconta o que ela foi pegando conta a conta ao longo do mês.
 */
export function oQueFaltaDoMeu(linhas = [], salario = 0) {
  const emAberto = quantoFaltaPagar(linhas);
  const jaPeguei = quantoJaPeguei(linhas);
  const salarioPedido = Math.max(0, Number(salario) || 0);
  const salarioAindaAPegar = Math.max(0, +(salarioPedido - jaPeguei).toFixed(2));
  return {
    emAberto,
    jaPeguei,
    salario: salarioPedido,
    salarioAindaAPegar,
    total: +(emAberto + salarioAindaAPegar).toFixed(2),
  };
}

/** Último dia do mês 'AAAA-MM' — é onde a linha do salário vence. */
export function ultimoDiaDoMes(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  const dia = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}
