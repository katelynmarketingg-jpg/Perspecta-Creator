// ---------------------------------------------------------------------------
// A ORDEM DO PERFIL.
//
// A lógica do Instagram, nas palavras dela: "debaixo pra cima, da direita pra
// esquerda. O bem da direita e bem debaixo é o mais antigo; o bem da esquerda e
// bem de cima é o último postado."
//
// Então a lista é sempre DO MAIS NOVO PARA O MAIS ANTIGO, e a grade a desenha
// da esquerda para a direita, de cima para baixo: índice 0 no canto de cima à
// esquerda. Arrastar uma peça de baixo para uma posição de cima EMPURRA para a
// direita quem estava lá — quem foi empurrado fica um lugar mais "antigo".
// ---------------------------------------------------------------------------

/**
 * Reencaixa a peça que está em `de` na posição `para`, empurrando o resto.
 *
 * É encaixe, não troca: quem estava em `para` anda um lugar para a direita (e
 * cai para a linha de baixo quando chega no fim da linha), em vez de pular para
 * o buraco que a arrastada deixou.
 */
export function reencaixar(lista = [], de, para) {
  if (!Array.isArray(lista)) return [];
  if (!Number.isInteger(de) || !Number.isInteger(para)) return lista;
  if (de === para || de < 0 || de >= lista.length) return lista;
  const destino = Math.max(0, Math.min(para, lista.length - 1));
  const saida = [...lista];
  const [movida] = saida.splice(de, 1);
  saida.splice(destino, 0, movida);
  return saida;
}

/**
 * A ordem em que as peças aparecem no perfil.
 *
 * Quem foi arrumada à mão (position > 0) manda: vem na ordem que a pessoa deu.
 * O resto segue a data, do mais recente para o mais antigo.
 *
 * PEÇA SEM DATA FICA EM CIMA, não embaixo. Ela é o que acabou de subir e ainda
 * não tem hora marcada — é o próximo a ir ao ar, não o mais antigo. Antes ia
 * para o fim e, nas palavras dela, "acabavam com a ordem".
 *
 * O desempate pelo id existe por um motivo prático: sem ele, duas peças com a
 * mesma data (ou duas sem data) ficavam em ordem imprevisível, e podiam trocar
 * de lugar sozinhas entre um desenho e outro da tela.
 */
export function ordenarFeed(posts = []) {
  return [...posts].sort((a, b) => {
    const pa = a.position || 1e9, pb = b.position || 1e9;
    if (pa !== pb) return pa - pb;

    const da = a.scheduled_at || "", dbb = b.scheduled_at || "";
    if (da !== dbb) {
      if (!da) return -1;         // sem data vai para cima
      if (!dbb) return 1;
      return da > dbb ? -1 : 1;   // mais recente primeiro
    }
    return (b.id || 0) - (a.id || 0);
  });
}

/**
 * O que a grade do perfil mostra: tudo menos o que já foi postado.
 *
 * Pedido dela: marcar "já foi postado" tira a peça da grade principal, "sem
 * deixar o resto perder a ordem". Tirar da lista não mexe na `position` de
 * ninguém — as outras continuam exatamente onde estavam.
 */
export function aindaNoPerfil(posts = []) {
  return posts.filter((p) => !p.published_at);
}
