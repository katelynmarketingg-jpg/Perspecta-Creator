// ---------------------------------------------------------------------------
// A TELA QUE FICA RODANDO PARA SEMPRE.
//
// No Express 4, quando uma rota `async` estoura um erro, ninguém pega: o erro
// vira "promessa rejeitada sem dono", o middleware de erro NÃO é chamado e a
// resposta nunca é enviada. Do lado de quem usa, isso não aparece como erro —
// aparece como a bolinha girando até o navegador desistir, sem mensagem
// nenhuma. Foi exatamente assim que o botão de baixar arquivo se comportou:
// uma linha faltando no import, e o download simplesmente não respondia.
//
// Aqui o Express passa a enxergar essas rejeições. O erro continua sendo erro
// (vai para o log e devolve 500 com a mensagem padrão), mas a pessoa recebe
// UMA RESPOSTA em vez de ficar esperando pelo resto da vida.
//
// O jeito de fazer isso é trocar o `handle_request` da camada interna do
// roteador — é o mesmo caminho que a biblioteca express-async-errors usa. Se
// um dia o Express mudar esse arquivo por dentro, a troca simplesmente não
// acontece e tudo segue como antes (por isso o try/catch e o retorno false).
// ---------------------------------------------------------------------------
import { createRequire } from "node:module";

const exigir = createRequire(import.meta.url);

export function pegarPromessasSoltas() {
  let Camada;
  try {
    Camada = exigir("express/lib/router/layer.js");
  } catch {
    return false;
  }
  const original = Camada?.prototype?.handle_request;
  if (typeof original !== "function" || original.pegaPromessa) return false;

  function handle_request(req, res, next) {
    const fn = this.handle;
    // Quatro argumentos = middleware de erro; esse não é nosso caso.
    if (typeof fn !== "function" || fn.length > 3) return next();
    let saida;
    try {
      saida = fn(req, res, next);
    } catch (erro) {
      return next(erro);
    }
    // Rota async: o erro chega depois, pela promessa.
    if (saida && typeof saida.catch === "function") saida.catch(next);
  }
  handle_request.pegaPromessa = true;
  Camada.prototype.handle_request = handle_request;
  return true;
}
