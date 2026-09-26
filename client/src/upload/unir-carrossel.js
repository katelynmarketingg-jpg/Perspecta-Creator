// CARROSSEL MONTADO À MÃO, NA GALERIA.
//
// Pedido dela: "se eu segurar um e arrastar pra cima de outro, o que eu
// arrastar vira o segundo slide daquele post; se arrasto mais um, fica como o
// terceiro... e aí vai. Unifica."
//
// Aqui mora só a CONTA: a lista de arquivos que o servidor manda vira uma lista
// de POSTS. Quem foi unido aparece como um cartão só, com as lâminas na ordem;
// quem está solto continua sendo um cartão por arquivo.
//
// Nada é recortado nem regravado: cada lâmina continua sendo o arquivo
// original. É por isso que o "baixar" de um post unido já sai separado — as
// lâminas nunca chegaram a virar um arquivo só.

function ordem(a, b) {
  const pa = a.carrossel_pos || 0, pb = b.carrossel_pos || 0;
  return pa !== pb ? pa - pb : (a.id - b.id);
}

export function agruparPosts(arquivos = []) {
  // Junta as lâminas por capa.
  const porCapa = new Map();
  for (const f of arquivos) {
    if (!f.carrossel_id) continue;
    if (!porCapa.has(f.carrossel_id)) porCapa.set(f.carrossel_id, []);
    porCapa.get(f.carrossel_id).push(f);
  }
  for (const laminas of porCapa.values()) laminas.sort(ordem);

  const postos = [];
  const jaSaiu = new Set();
  for (const f of arquivos) {
    if (!f.carrossel_id) { postos.push({ f, laminas: null }); continue; }
    const laminas = porCapa.get(f.carrossel_id) || [];
    // Carrossel de uma lâmina só não é carrossel.
    if (laminas.length < 2) { postos.push({ f, laminas: null }); continue; }
    // Só a CAPA vira cartão; as outras aparecem dentro dele. Se a capa não está
    // nesta pasta (foi apagada ou movida), a primeira lâmina que sobrou assume
    // — assim o post não some da tela.
    if (jaSaiu.has(f.carrossel_id)) continue;
    if (f.id !== f.carrossel_id && f.id !== laminas[0].id) continue;
    jaSaiu.add(f.carrossel_id);
    postos.push({ f: laminas[0], laminas });
  }
  return postos;
}

// O que vai junto quando se arrasta um cartão: se ele está marcado, vai a
// seleção inteira (na ordem em que foi marcada); se não, vai só ele.
export function oQueArrastar(id, selecionados = []) {
  return selecionados.includes(id) ? [...selecionados] : [id];
}

// ---------------------------------------------------------------------------
// O MESMO CÁLCULO, FEITO NA TELA, ANTES DE O SERVIDOR RESPONDER.
//
// Pedido dela: "ainda demora quando arrasto um post pra cima do outro, demora
// pra sumir; consegue deixar instantâneo?".
//
// Demorava porque a tela esperava o pedido voltar e então recarregava a lista
// INTEIRA da pasta — que leva a miniatura de cada arquivo embutida. Agora a
// união é aplicada aqui na hora, na lista que já está na mão: a arte arrastada
// entra como lâmina e some da grade no mesmo instante. O pedido segue por trás;
// se falhar, a lista volta ao que era.
//
// As regras são as mesmas do servidor, de propósito — é o que faz o resultado
// otimista bater com o definitivo.
// ---------------------------------------------------------------------------

export function aplicarUniao(arquivos = [], capaId, ids = []) {
  const capa = arquivos.find((f) => f.id === capaId);
  if (!capa) return arquivos;
  // Soltar em cima de uma lâmina do meio vale como soltar no post inteiro.
  const alvo = capa.carrossel_id || capa.id;

  const pedidos = ids.map(Number).filter((n) => n !== alvo);
  // Arrastar a capa de outro post leva as lâminas dele junto.
  const gruposInteiros = new Set(
    arquivos.filter((f) => pedidos.includes(f.id) && f.carrossel_id).map((f) => f.carrossel_id));
  gruposInteiros.delete(alvo);

  const jaEra = arquivos
    .filter((f) => f.id === alvo || f.carrossel_id === alvo)
    .sort(ordem);
  const jaSao = new Set(jaEra.map((f) => f.id));

  const chegando = arquivos
    .filter((f) => !jaSao.has(f.id) && (pedidos.includes(f.id) || gruposInteiros.has(f.carrossel_id)))
    .sort((a, b) => {
      // Primeiro a ordem em que foram arrastados; dentro de um post arrastado
      // inteiro, a ordem que ele já tinha.
      const ia = pedidos.indexOf(a.id), ib = pedidos.indexOf(b.id);
      if (ia !== ib && (ia !== -1 || ib !== -1)) return (ia === -1 ? 1e6 : ia) - (ib === -1 ? 1e6 : ib);
      return ordem(a, b);
    });
  if (!chegando.length) return arquivos;

  const posicao = new Map();
  [...jaEra, ...chegando].forEach((f, i) => posicao.set(f.id, i + 1));
  return arquivos.map((f) => (posicao.has(f.id)
    ? { ...f, carrossel_id: alvo, carrossel_pos: posicao.get(f.id) }
    : f));
}

/** Desfaz o post: cada lâmina volta a ser arquivo solto. */
export function aplicarSeparacao(arquivos = [], capaId) {
  const capa = arquivos.find((f) => f.id === capaId);
  const alvo = capa?.carrossel_id || capaId;
  return arquivos.map((f) => (f.carrossel_id === alvo
    ? { ...f, carrossel_id: null, carrossel_pos: 0 }
    : f));
}

/** Tira arquivos da lista — e desfaz o post que ficou com uma lâmina só. */
export function aplicarRemocao(arquivos = [], ids = []) {
  const fora = new Set(ids.map(Number));
  const restam = arquivos.filter((f) => !fora.has(f.id));
  const quantas = new Map();
  for (const f of restam) if (f.carrossel_id) quantas.set(f.carrossel_id, (quantas.get(f.carrossel_id) || 0) + 1);
  return restam.map((f) => (f.carrossel_id && quantas.get(f.carrossel_id) < 2
    ? { ...f, carrossel_id: null, carrossel_pos: 0 }
    : f));
}
