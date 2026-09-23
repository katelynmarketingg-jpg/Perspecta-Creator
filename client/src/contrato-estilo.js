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
    // Logo só deste contrato. Vazio: vale o da casa.
    logo: typeof v.logo === "string" && v.logo.startsWith("data:") ? v.logo : null,
    topo: faixa(topo, true),
    rodape: faixa(v.rodape, false),   // o rodapé nasce desligado
  };
}

/** O que vai para o banco. Só o que a gente conhece, e nada mais. */
export function estiloParaGuardar(e) {
  return {
    logo: e.logo || null,
    topo: { ativo: e.topo.ativo, x: e.topo.x, y: e.topo.y, w: e.topo.w },
    rodape: { ativo: e.rodape.ativo, x: e.rodape.x, y: e.rodape.y, w: e.rodape.w },
  };
}
