import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Typography, Stack, IconButton, Tooltip } from "@mui/material";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import { comAssinaturas } from "../assinaturas-no-contrato.js";
import { limpaContrato, pareceHtml } from "./TextoDoContrato.jsx";
import { paginaDoContrato } from "../contrato-estilo.js";

// ---------------------------------------------------------------------------
// O CONTRATO EM FOLHAS A4 — página 1, 2, 3.
//
// Pedido dela: "ficou quebrada a questão da página, pode separar por páginas,
// 1, 2, 3, conforme cabe nas folhas a4".
//
// A tela de assinatura mostrava o contrato inteiro numa folha só, dentro de
// uma caixa com rolagem: o texto passava do branco e continuava por cima do
// fundo, como se a folha tivesse sido cortada no meio. Quem ia assinar via um
// documento quebrado.
//
// Aqui o texto é MEDIDO e distribuído em folhas de verdade: A4 (21 × 29,7 cm),
// com as margens, a entrelinha e o tamanho de letra do próprio contrato — os
// mesmos que vão para a impressora. Um bloco (parágrafo, título, tabela) nunca
// é partido ao meio: quando não cabe, começa na folha seguinte.
//
// Medir é a única forma honesta de paginar HTML. Dá para errar por um
// parágrafo em telas com fonte diferente, mas o que a pessoa lê passa a ser o
// mesmo documento que ela vai receber em PDF.
// ---------------------------------------------------------------------------

const PX_POR_CM = 37.7953;     // 96 dpi
const A4_L = Math.round(21 * PX_POR_CM);     // 794
const A4_A = Math.round(29.7 * PX_POR_CM);   // 1123
const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5];

/** O CSS do texto dentro da folha — igual ao da impressão. */
function estiloDoTexto(pg) {
  return {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: `${pg.corpo}pt`,
    lineHeight: pg.entrelinha,
    color: "#1a1a1a",
    textAlign: "justify",
    hyphens: "auto",
    "& h1": { fontSize: `${(pg.corpo * 1.22).toFixed(1)}pt`, textAlign: "center", margin: "0 0 4px" },
    "& h2": { fontSize: `${(pg.corpo * 1.05).toFixed(1)}pt` },
    "& h3": { fontSize: `${pg.corpo}pt` },
    "& p": { margin: "0 0 10px" },
    "& ul, & ol": { paddingLeft: "22px" },
    "& img": { maxWidth: "100%" },
    "& table": { borderCollapse: "collapse", maxWidth: "100%" },
    "& pre": { whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "inherit", margin: 0, textAlign: "justify" },
    "& .assinatura-no-lugar img": { maxHeight: 70, display: "block", marginBottom: 2 },
    "& .assinatura-no-lugar small": { display: "block", color: "#555", fontSize: "8.5pt", lineHeight: 1.4 },
  };
}

export default function FolhasDoContrato({ texto, contrato = null, pagina = null }) {
  const pg = paginaDoContrato(pagina);
  const medidor = useRef(null);
  const caixa = useRef(null);
  const [paginas, setPaginas] = useState(null);
  const [zoom, setZoom] = useState(null);     // null = caber na largura

  // O HTML já pronto: limpo, com as assinaturas trocadas pelos marcadores.
  const html = useMemo(() => {
    const bruto = String(texto || "");
    if (!bruto.trim()) return "";
    return pareceHtml(bruto)
      ? comAssinaturas(limpaContrato(bruto), contrato || {})
      : comAssinaturas(
        `<pre>${bruto.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]))}</pre>`,
        contrato || {},
      );
  }, [texto, contrato]);

  const margem = {
    topo: pg.topo * PX_POR_CM, baixo: pg.baixo * PX_POR_CM,
    esquerda: pg.esquerda * PX_POR_CM, direita: pg.direita * PX_POR_CM,
  };
  const larguraUtil = A4_L - margem.esquerda - margem.direita;
  const alturaUtil = A4_A - margem.topo - margem.baixo;

  // MEDE E DISTRIBUI. O medidor é uma folha invisível do mesmo tamanho: o que
  // couber nela cabe no papel.
  useLayoutEffect(() => {
    const el = medidor.current;
    if (!el || !html) { setPaginas(html ? [] : null); return; }
    const blocos = Array.from(el.children);
    if (!blocos.length) { setPaginas([html]); return; }
    const folhas = [[]];
    let altura = 0;
    for (const b of blocos) {
      const estilo = window.getComputedStyle(b);
      const h = b.getBoundingClientRect().height
        + parseFloat(estilo.marginTop || 0) + parseFloat(estilo.marginBottom || 0);
      // Um bloco maior que a folha inteira fica sozinho e transborda — melhor
      // do que sumir. (É raro: só tabela ou imagem gigante.)
      if (altura > 0 && altura + h > alturaUtil) { folhas.push([]); altura = 0; }
      folhas[folhas.length - 1].push(b.outerHTML);
      altura += h;
    }
    setPaginas(folhas.map((f) => f.join("")));
  }, [html, alturaUtil, larguraUtil, pg.corpo, pg.entrelinha]);

  // Caber na largura: a folha é sempre A4 de verdade e encolhe junto.
  const [larguraCaixa, setLarguraCaixa] = useState(0);
  useEffect(() => {
    const el = caixa.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setLarguraCaixa(el.clientWidth));
    ro.observe(el);
    setLarguraCaixa(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const escalaQueCabe = larguraCaixa ? Math.min(1, (larguraCaixa - 8) / A4_L) : 1;
  const escala = zoom ?? escalaQueCabe;
  const texto_ = estiloDoTexto(pg);

  if (!html) {
    return <Typography variant="body2" color="text.secondary">Este contrato não tem texto.</Typography>;
  }

  const folhas = paginas || [];

  return (
    <Box ref={caixa}>
      {/* O medidor: mesma largura e mesma letra da folha, fora da vista. */}
      <Box aria-hidden ref={medidor}
        sx={{ ...texto_, position: "absolute", left: -99999, top: 0, width: larguraUtil, visibility: "hidden" }}
        dangerouslySetInnerHTML={{ __html: html }} />

      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {folhas.length > 1 ? `${folhas.length} páginas` : "1 página"} · A4
        </Typography>
        <Tooltip title="Diminuir">
          <span>
            <IconButton size="small" disabled={escala <= ZOOMS[0]}
              onClick={() => setZoom(ZOOMS.filter((z) => z < escala - 0.01).pop() ?? ZOOMS[0])}>
              <ZoomOutIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 42, textAlign: "center" }}>
          {Math.round(escala * 100)}%
        </Typography>
        <Tooltip title="Aumentar">
          <span>
            <IconButton size="small" disabled={escala >= ZOOMS[ZOOMS.length - 1]}
              onClick={() => setZoom(ZOOMS.find((z) => z > escala + 0.01) ?? ZOOMS[ZOOMS.length - 1])}>
              <ZoomInIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Box sx={{ bgcolor: "#78716c", borderRadius: 1.5, p: { xs: 1, sm: 1.5 }, overflow: "auto", maxHeight: "70vh" }}>
        <Stack spacing={1.5} alignItems="center">
          {folhas.map((conteudo, i) => (
            <Box key={i} sx={{ width: A4_L * escala, height: A4_A * escala, flex: "0 0 auto" }}>
              <Box sx={{
                width: A4_L, height: A4_A, transform: `scale(${escala})`, transformOrigin: "top left",
                bgcolor: "#fff", boxShadow: "0 1px 10px rgba(0,0,0,.35)",
                paddingTop: `${margem.topo}px`, paddingBottom: `${margem.baixo}px`,
                paddingLeft: `${margem.esquerda}px`, paddingRight: `${margem.direita}px`,
                boxSizing: "border-box", overflow: "hidden", position: "relative",
              }}>
                <Box sx={texto_} dangerouslySetInnerHTML={{ __html: conteudo }} />
                {/* O número DENTRO da folha, no rodapé, como num documento. */}
                <Typography sx={{
                  position: "absolute", left: 0, right: 0, bottom: margem.baixo / 3,
                  textAlign: "center", fontSize: "9pt", color: "#8a8a8a",
                  fontFamily: 'Georgia, "Times New Roman", serif',
                }}>
                  {i + 1} de {folhas.length}
                </Typography>
              </Box>
            </Box>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}
