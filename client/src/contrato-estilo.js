// ---------------------------------------------------------------------------
// O ESTILO DO CONTRATO: o logo e onde ele fica.
//
// Guardado em `services.contract_style` (JSON) e copiado para o contrato no
// momento em que ele é gerado — senão o logo viveria só na prévia do modelo, e
// o contrato que o cliente assina sairia sem marca nenhuma.
//
// O formato antigo era {logoX, logoY, logoW}: uma faixa só, no topo, sempre com
// o logo do escritório. Ele continua sendo lido — quem já tinha posicionado o
// logo não perde o trabalho.
// ---------------------------------------------------------------------------

export const ALTURA_TOPO = 150;
export const ALTURA_RODAPE = 110;

// ---------------------------------------------------------------------------
// A PÁGINA: margem, entrelinha e tamanho do texto.
//
// Pergunta dela: "como eu sei a margem e espaçamento? tem que ter também."
// Antes esses três números estavam escritos no código e não apareciam em
// lugar nenhum: o contrato saía com eles e ninguém sabia quais eram.
//
// O padrão continua o da ABNT NBR 14724 — 3 cm em cima e à esquerda, 2 cm
// embaixo e à direita. Num contrato isso não é capricho de norma: é onde cabe
// a rubrica de cada página, o carimbo e o furo do grampo. Mas agora é um
// número à vista, que ela muda.
// ---------------------------------------------------------------------------
export const PAGINA_PADRAO = {
  topo: 3, direita: 2, baixo: 2, esquerda: 3,  // cm
  entrelinha: 1.55,                            // vezes o tamanho da letra
  corpo: 11.5,                                 // pt
};

/** Número dentro de limites de gente: fora deles, volta para o padrão. */
const entre = (v, min, max, padrao) => {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= min && n <= max ? n : padrao;
};

export const paginaDoContrato = (p) => ({
  // Margem: de meio centímetro (quase sem margem) a 6 cm (quase um livro).
  topo: entre(p?.topo, 0.5, 6, PAGINA_PADRAO.topo),
  direita: entre(p?.direita, 0.5, 6, PAGINA_PADRAO.direita),
  baixo: entre(p?.baixo, 0.5, 6, PAGINA_PADRAO.baixo),
  esquerda: entre(p?.esquerda, 0.5, 6, PAGINA_PADRAO.esquerda),
  entrelinha: entre(p?.entrelinha, 1, 3, PAGINA_PADRAO.entrelinha),
  corpo: entre(p?.corpo, 7, 20, PAGINA_PADRAO.corpo),
});

const faixa = (g, padraoAtivo) => ({
  ativo: g?.ativo === undefined ? padraoAtivo : Boolean(g.ativo),
  x: g?.x === undefined || g?.x === null ? null : Number(g.x),
  y: Number(g?.y) || 0,
  w: Number(g?.w) || 200,
});

/** Lê o estilo guardado (objeto ou texto JSON) e devolve a forma de hoje. */
export function estiloDoContrato(bruto) {
  let v = bruto;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
  v = v && typeof v === "object" ? v : {};

  // Formato antigo: uma faixa no topo, com as chaves soltas.
  const temAntigo = v.logoX !== undefined || v.logoY !== undefined || v.logoW !== undefined;
  const topo = v.topo || (temAntigo
    ? { ativo: true, x: v.logoX ?? null, y: v.logoY ?? 16, w: v.logoW ?? 200 }
    : undefined);

  return {
    // Logo do TOPO. Vazio: vale o da casa. (O nome é só "logo" por herança —
    // quem já tinha um logo posicionado não perde nada.)
    logo: typeof v.logo === "string" && v.logo.startsWith("data:") ? v.logo : null,
    // Logo do RODAPÉ, separado do de cima. Vazio: cai no do topo (e, se não
    // houver, no da casa) — assim quem já usava o mesmo logo nas duas pontas
    // continua igual, e quem quer um diferente embaixo agora pode escolher.
    logoRodape: typeof v.logoRodape === "string" && v.logoRodape.startsWith("data:") ? v.logoRodape : null,
    topo: faixa(topo, true),
    rodape: faixa(v.rodape, false),   // o rodapé nasce desligado
    pagina: paginaDoContrato(v.pagina),
  };
}

/** O logo que o rodapé usa de fato: o dele, senão o do topo, senão o da casa. */
export const logoDoRodape = (estilo, logoDaCasa = null) =>
  estilo.logoRodape || estilo.logo || logoDaCasa || null;

/** O logo do topo: o dele, senão o da casa. */
export const logoDoTopo = (estilo, logoDaCasa = null) =>
  estilo.logo || logoDaCasa || null;

/** O que vai para o banco. Só o que a gente conhece, e nada mais. */
export function estiloParaGuardar(e) {
  return {
    logo: e.logo || null,
    logoRodape: e.logoRodape || null,
    topo: { ativo: e.topo.ativo, x: e.topo.x, y: e.topo.y, w: e.topo.w },
    rodape: { ativo: e.rodape.ativo, x: e.rodape.x, y: e.rodape.y, w: e.rodape.w },
    pagina: paginaDoContrato(e.pagina),
  };
}
