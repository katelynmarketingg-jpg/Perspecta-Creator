// ---------------------------------------------------------------------------
// IMPRIMIR UM CONTRATO.
//
// Três coisas moravam soltas em três telas diferentes (Serviços, Contratos e a
// ficha do cliente), cada uma com um jeito próprio de montar a página — e as
// três saíam erradas de um jeito diferente. Agora passam por aqui.
//
// MARGEM (ABNT NBR 14724): 3 cm em cima e à esquerda, 2 cm embaixo e à direita,
// em A4. Num contrato isso não é capricho de norma: é onde cabe a rubrica de
// cada página, o carimbo e o furo do grampo.
//
// O erro que fazia a margem "sumir" era escrever a margem como `padding` do
// corpo: padding vale só para a PRIMEIRA página. Da segunda em diante o texto
// encostava na borda do papel. Só `@page` vale para todas.
// ---------------------------------------------------------------------------

/** As margens da norma, na ordem do CSS: topo · direita · rodapé · esquerda. */
export const MARGENS_ABNT = "3cm 2cm 2cm 3cm";

/**
 * A folha de estilo do documento.
 *
 * Na TELA, desenha uma folha A4 de verdade — branca, centrada, com as mesmas
 * margens por dentro. Antes a janela de prévia era um muro de texto de ponta a
 * ponta do monitor, que não parecia nem de longe com o que ia sair na
 * impressora. No PAPEL, a folha some e quem manda é o `@page`.
 */
export function folhaDeImpressao() {
  return `
  @page { size: A4; margin: ${MARGENS_ABNT}; }

  /* ---- na tela: uma folha A4, para a prévia parecer com o papel ---- */
  html { background: #78716c; }
  body { margin: 0; padding: 24px 0; }
  .folha {
    width: 21cm;
    min-height: 29.7cm;
    box-sizing: border-box;
    margin: 0 auto;
    padding: ${MARGENS_ABNT};
    background: #fff;
    box-shadow: 0 2px 16px rgba(0,0,0,.35);
  }

  /* ---- o texto ---- */
  .folha {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 11.5pt;
    line-height: 1.55;
    color: #1a1a1a;
    text-align: justify;
    /* Justificado sem hifenização abre "rios" de espaço no meio do
       parágrafo — o texto fica esticado e feio de ler. */
    hyphens: auto;
    -webkit-hyphens: auto;
  }
  .folha h1 { font-size: 14pt; text-align: center; margin: 0 0 4px; letter-spacing: .01em; }
  .folha h2 { font-size: 12pt; }
  .folha h3 { font-size: 11.5pt; }
  .folha p { margin: 0 0 10px; text-indent: 0; }
  .folha ul, .folha ol { padding-left: 22px; }
  .folha img { max-width: 100%; }
  .folha table { border-collapse: collapse; max-width: 100%; }
  /* Texto puro guardado com quebras de linha continua quebrando no papel. */
  .folha pre { white-space: pre-wrap; font-family: inherit; font-size: inherit; margin: 0; text-align: justify; }

  /* O nome do serviço, acima do título — pequeno, sem brigar com ele. */
  .sobretitulo { text-align: center; font-size: 9.5pt; letter-spacing: .12em;
                 text-transform: uppercase; color: #78716c; margin: 0 0 6px; }

  /* ---- o que não pode quebrar no lugar errado ---- */
  /* Título sozinho no pé da página é o erro mais feio de um contrato. */
  .folha h1, .folha h2, .folha h3, .folha b, .folha strong {
    break-after: avoid; page-break-after: avoid;
  }
  .folha p, .folha li { orphans: 2; widows: 2; }
  .assinatura, .faixa-logo { break-inside: avoid; page-break-inside: avoid; }

  .assinatura { margin-top: 36px; padding-top: 14px; border-top: 1px solid #ccc;
                font-size: 9.5pt; color: #555; text-align: left; }

  /* ---- no papel: a folha vira a própria página ---- */
  @media print {
    html { background: #fff; }
    body { padding: 0; }
    .folha { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
  }
  `;
}

/**
 * A faixa do logo — a de cima e a do rodapé usam a mesma.
 *
 * `geom` é o que ela arrastou na tela: { x, y, w }. `x` vazio quer dizer
 * centralizado de verdade (e não "centralizado por acaso naquela largura").
 */
export function faixaDeLogo(logo, geom = {}, { altura = 150, rodape = false } = {}) {
  if (!logo) return "";
  const w = Number(geom.w) || 200;
  const y = Number(geom.y) || 0;
  const posX = geom.x == null || geom.x === ""
    ? "left:50%;transform:translateX(-50%)"
    : `left:${Number(geom.x) || 0}px`;
  return `<div class="faixa-logo" style="position:relative;height:${altura}px;${rodape ? "margin-top:24px" : "margin-bottom:8px"}">
    <img src="${logo}" alt="" style="position:absolute;top:${y}px;${posX};width:${w}px;max-width:100%;object-fit:contain" />
  </div>`;
}

/**
 * Abre a janela e escreve o documento pronto para imprimir.
 * Devolve false quando o navegador bloqueou a janela, para quem chamou avisar.
 */
export function imprimirDocumento({ titulo, corpo, estiloExtra = "", janela }) {
  const w = janela || window.open("", "_blank");
  if (!w) return false;
  const nome = String(titulo || "Documento").replace(/[<>]/g, "");
  w.document.write(`<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<title>${nome}</title>
<style>${folhaDeImpressao()}${estiloExtra}</style>
</head><body><div class="folha">${corpo}</div>
<script>window.onload=function(){window.focus();window.print();}<\/script>
</body></html>`);
  w.document.close();
  return true;
}
