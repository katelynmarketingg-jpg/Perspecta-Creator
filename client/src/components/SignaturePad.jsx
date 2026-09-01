import { useEffect, useRef } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";

// Quadro para desenhar a assinatura (dedo no celular ou mouse).
// Usado na assinatura do contrato e na assinatura salva do escritório (recibos).
export default function SignaturePad({ onChange, height = 150 }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    // Ajusta a resolução ao tamanho real (nitidez em telas retina).
    const ratio = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    cv.width = rect.width * ratio;
    cv.height = rect.height * ratio;
    const ctx = cv.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.strokeStyle = "#111";
  }, []);

  function pos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function start(e) { e.preventDefault(); drawing.current = true; last.current = pos(e); }
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
