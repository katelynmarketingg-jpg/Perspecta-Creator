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
