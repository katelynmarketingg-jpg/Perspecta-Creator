import { useEffect, useRef, useState } from "react";
import { Box, IconButton, Tooltip } from "@mui/material";
import StraightenIcon from "@mui/icons-material/Straighten";
import api from "../api/client.js";

const BAND_H = 150; // altura da faixa onde o logo flutua
const SNAP = 8;     // distância (px) para "encaixar" no meio

// Faixa com o logo do escritório: segurar e arrastar move; alça no canto
// redimensiona. Geometria (logoW/logoX/logoY) sobe pelo onGeom. Reutilizável.
//
// Guias tipo Canva (botão da régua): mostra as linhas do meio (horizontal e
// vertical) e, ao arrastar, o logo ENCAIXA no centro quando chega perto — aí
// grava logoX = null (centralizado de verdade, igual no PDF).
export default function LogoBanner({ geom = {}, onGeom, editable = true }) {
  const bandRef = useRef(null);
  const drag = useRef(null);
  const [logo, setLogo] = useState(null);
  const [guias, setGuias] = useState(false);   // botão réguas/guias ligado?
  const [arrastando, setArrastando] = useState(false);
  const [noMeio, setNoMeio] = useState(false);  // encaixou no centro agora?
  const logoW = geom.logoW || 200;
  const logoX = geom.logoX ?? null; // null = centralizado
  const logoY = geom.logoY ?? 16;

  useEffect(() => { api.get("/branding").then((r) => setLogo(r.data?.logo || null)).catch(() => {}); }, []);

  function iniciar(e, modo) {
    if (!editable) return;
    e.preventDefault();
    const band = bandRef.current?.getBoundingClientRect();
    const baseX = logoX == null ? (band ? (band.width - logoW) / 2 : 0) : logoX;
    drag.current = { modo, startX: e.clientX, startY: e.clientY, baseX, baseY: logoY, baseW: logoW, bandW: band?.width || 800 };
    setArrastando(true);
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }
  function mover(e) {
    const g = drag.current; if (!g) return;
    if (g.modo === "move") {
      const nx = Math.max(0, Math.min(g.bandW - logoW, g.baseX + (e.clientX - g.startX)));
      const ny = Math.max(0, Math.min(BAND_H - 20, g.baseY + (e.clientY - g.startY)));
      // Encaixe no meio: se o centro do logo está a menos de SNAP do centro da
      // faixa, centraliza de verdade (logoX = null) — igual vai sair no PDF.
      const centroLogo = nx + logoW / 2;
      const centroFaixa = g.bandW / 2;
      if (Math.abs(centroLogo - centroFaixa) <= SNAP) {
        setNoMeio(true);
        onGeom?.({ ...geom, logoX: null, logoY: ny });
      } else {
        setNoMeio(false);
        onGeom?.({ ...geom, logoX: nx, logoY: ny });
      }
    } else {
      const nw = Math.max(60, Math.min(g.bandW, g.baseW + (e.clientX - g.startX)));
      onGeom?.({ ...geom, logoW: nw });
    }
  }
  function soltar() {
    drag.current = null;
    setArrastando(false);
    setNoMeio(false);
    window.removeEventListener("pointermove", mover);
    window.removeEventListener("pointerup", soltar);
  }

  if (!logo) {
    return (
      <Box sx={{ height: BAND_H, borderBottom: 1, borderColor: "divider", display: "grid", placeItems: "center", color: "text.disabled", fontSize: 13 }}>
        (Sem logo — defina em Integrações/Configurações)
      </Box>
    );
  }

  const mostrarGuias = guias || arrastando; // guias aparecem no botão OU ao arrastar
  const linha = (extra) => ({
    position: "absolute", bgcolor: "primary.main", opacity: 0.5,
    pointerEvents: "none", zIndex: 1, ...extra,
  });

  return (
    <Box ref={bandRef} sx={{ position: "relative", height: BAND_H, borderBottom: 1, borderColor: "divider" }}>
      {/* Botão réguas/guias (tipo Canva): liga/desliga as linhas do meio */}
      {editable && (
        <Tooltip title={guias ? "Esconder guias" : "Mostrar réguas e guias (meio)"}>
          <IconButton size="small" onClick={() => setGuias((v) => !v)}
            sx={{ position: "absolute", top: 4, right: 4, zIndex: 3, bgcolor: "background.paper",
              border: 1, borderColor: "divider", color: guias ? "primary.main" : "text.secondary",
              "&:hover": { bgcolor: "background.paper" } }}>
            <StraightenIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      )}

      {/* Linhas-guia do meio (horizontal e vertical) */}
      {mostrarGuias && (
        <>
          <Box sx={linha({ left: "50%", top: 0, bottom: 0, width: "1px",
            borderLeft: "1px dashed", borderColor: "primary.main", bgcolor: "transparent",
            opacity: noMeio ? 1 : 0.5 })} />
          <Box sx={linha({ top: "50%", left: 0, right: 0, height: "1px",
            borderTop: "1px dashed", borderColor: "primary.main", bgcolor: "transparent" })} />
        </>
      )}

      <Box sx={{
        position: "absolute", top: logoY,
        left: logoX == null ? "50%" : logoX,
        transform: logoX == null ? "translateX(-50%)" : "none",
        width: logoW, cursor: editable ? "move" : "default", zIndex: 2, "&:hover .rz": { opacity: 1 },
      }}
        onPointerDown={(e) => iniciar(e, "move")}>
        <Box component="img" src={logo} alt="" draggable={false}
          sx={{ width: "100%", objectFit: "contain", display: "block", userSelect: "none", pointerEvents: "none" }} />
        {editable && (
          <Box className="rz" onPointerDown={(e) => { e.stopPropagation(); iniciar(e, "resize"); }}
            sx={{ position: "absolute", right: -6, bottom: -6, width: 14, height: 14, bgcolor: "primary.main", borderRadius: "50%", cursor: "nwse-resize", opacity: 0.5, transition: "opacity .15s" }} />
        )}
      </Box>
    </Box>
  );
}

export { BAND_H };
