import { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import api from "../api/client.js";

const BAND_H = 150; // altura da faixa onde o logo flutua

// Faixa com o logo do escritório: segurar e arrastar move; alça no canto
// redimensiona. Geometria (logoW/logoX/logoY) sobe pelo onGeom. Reutilizável.
export default function LogoBanner({ geom = {}, onGeom, editable = true }) {
  const bandRef = useRef(null);
  const drag = useRef(null);
  const [logo, setLogo] = useState(null);
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
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }
  function mover(e) {
    const g = drag.current; if (!g) return;
    if (g.modo === "move") {
      const nx = Math.max(0, Math.min(g.bandW - logoW, g.baseX + (e.clientX - g.startX)));
      const ny = Math.max(0, Math.min(BAND_H - 20, g.baseY + (e.clientY - g.startY)));
      onGeom?.({ ...geom, logoX: nx, logoY: ny });
    } else {
      const nw = Math.max(60, Math.min(g.bandW, g.baseW + (e.clientX - g.startX)));
      onGeom?.({ ...geom, logoW: nw });
    }
  }
  function soltar() {
    drag.current = null;
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
  return (
    <Box ref={bandRef} sx={{ position: "relative", height: BAND_H, borderBottom: 1, borderColor: "divider" }}>
      <Box sx={{
        position: "absolute", top: logoY,
        left: logoX == null ? "50%" : logoX,
        transform: logoX == null ? "translateX(-50%)" : "none",
        width: logoW, cursor: editable ? "move" : "default", "&:hover .rz": { opacity: 1 },
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
