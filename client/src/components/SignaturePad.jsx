import { useEffect, useRef } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";

// Quadro para desenhar a assinatura (dedo no celular ou mouse).
// Usado na assinatura do contrato e na assinatura salva do escritório (recibos).
export default function SignaturePad({ onChange, height = 150 }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);

  const temTraco = useRef(false);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;

    // Ajusta a resolução ao tamanho real (nitidez em telas retina). Dentro de um
    // diálogo o quadro nasce com largura 0 e só ganha tamanho depois da animação
    // — por isso medimos de novo a cada mudança, senão o desenho não pega.
    const ajustar = () => {
      const rect = cv.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ratio = window.devicePixelRatio || 1;
      const w = Math.round(rect.width * ratio);
      const h = Math.round(rect.height * ratio);
      if (cv.width === w && cv.height === h) return;
      // Redimensionar limpa o canvas: só refaz enquanto não há assinatura.
      if (temTraco.current) return;
      cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d");
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.strokeStyle = "#111";
    };

    ajustar();
    const ro = new ResizeObserver(ajustar);
    ro.observe(cv);
    return () => ro.disconnect();
  }, []);

  function pos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function start(e) { e.preventDefault(); drawing.current = true; temTraco.current = true; last.current = pos(e); }
  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p;
  }
  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current.toDataURL("image/png"));
  }
  function limpar() {
    const cv = canvasRef.current;
    cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
    temTraco.current = false;
    onChange("");
  }

  return (
    <Box>
      <Box component="canvas" ref={canvasRef}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
        sx={{ width: "100%", height, bgcolor: "#fff", borderRadius: 2, border: 1,
              borderColor: "divider", touchAction: "none", cursor: "crosshair" }} />
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">Assine com o dedo ou o mouse</Typography>
        <Button size="small" onClick={limpar}>Limpar</Button>
      </Stack>
    </Box>
  );
}
