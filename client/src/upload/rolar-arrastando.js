// ---------------------------------------------------------------------------
// ROLAR A PÁGINA ENQUANTO SE ARRASTA.
//
// Pedido dela: "quando eu rolo bem pra baixo, ele abre o menu do Mac; daí só
// funciona se eu for bem pra baixo bem no canto direito. Tem como melhorar pra
// quando eu estiver pra baixo (nem precisar ser encostando) ele ir pra baixo?"
//
// O navegador só rola sozinho quando o cursor encosta NA BORDA da janela — e no
// Mac essa mesma borda é onde mora o Dock, que abre por cima. Aqui a página
// passa a rolar quando o cursor entra numa FAIXA perto do rodapé (ou do topo),
// sem precisar chegar na borda: quanto mais fundo na faixa, mais rápido rola.
// ---------------------------------------------------------------------------
export const FAIXA = 160;        // px do topo/rodapé que já fazem rolar
export const VELOCIDADE_MAX = 26; // px por quadro, no fim da faixa

/**
 * Quanto rolar neste quadro, a partir de onde o cursor está.
 * Negativo sobe, positivo desce, zero fica parado.
 */
export function velocidadeDaRolagem(y, altura, faixa = FAIXA, max = VELOCIDADE_MAX) {
  if (!altura || y == null) return 0;
  if (y < faixa) return -Math.ceil(((faixa - y) / faixa) * max);
  const doFundo = altura - y;
  if (doFundo < faixa) return Math.ceil(((faixa - doFundo) / faixa) * max);
  return 0;
}

/** O primeiro pai que de fato rola — senão, a página inteira. */
function quemRola(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    const rola = /(auto|scroll|overlay)/.test(s.overflowY);
    if (rola && n.scrollHeight > n.clientHeight + 4) return n;
  }
  return null;
}

/**
 * Liga a rolagem por arrasto na janela inteira e devolve como desligar. Vale
 * para arrastar um cartão daqui de dentro e para arrastar arquivos do
 * computador.
 *
 * Sem React de propósito: este arquivo é lido pelos testes do servidor, que
 * rodam sem as dependências do client instaladas. Na tela, é só chamar dentro
 * de um useEffect — o retorno já é a função de limpeza.
 */
export function ligarRolagemAoArrastar() {
  if (typeof window === "undefined") return () => {};
  let y = null, quadro = 0;

  const passo = () => {
    quadro = 0;
    if (y == null) return;
    const v = velocidadeDaRolagem(y, window.innerHeight);
    if (v) {
      const alvo = quemRola(document.elementFromPoint(window.innerWidth / 2, y) || document.body);
      if (alvo) alvo.scrollTop += v;
      else window.scrollBy(0, v);
    }
    agendar();
  };
  const agendar = () => { if (!quadro) quadro = requestAnimationFrame(passo); };

  const porCima = (e) => { y = e.clientY; agendar(); };
  const parar = () => { y = null; if (quadro) cancelAnimationFrame(quadro); quadro = 0; };

  window.addEventListener("dragover", porCima);
  window.addEventListener("dragend", parar);
  window.addEventListener("drop", parar);
  return () => {
    parar();
    window.removeEventListener("dragover", porCima);
    window.removeEventListener("dragend", parar);
    window.removeEventListener("drop", parar);
  };
}
