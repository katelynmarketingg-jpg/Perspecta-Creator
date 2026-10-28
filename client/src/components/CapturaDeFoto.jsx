import { useEffect, useRef, useState } from "react";
import { Box, Button, Typography, Stack } from "@mui/material";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import ReplayIcon from "@mui/icons-material/Replay";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";

// ---------------------------------------------------------------------------
// TIRAR UMA FOTO (selfie ou documento) na própria tela de assinatura.
//
// Usa a câmera do aparelho (getUserMedia). Se a câmera não abrir — negada,
// inexistente, navegador sem suporte —, cai no "enviar do aparelho" (input de
// arquivo com `capture`, que no celular abre a câmera do sistema). Assim ela
// nunca fica sem caminho: sempre dá para mandar a foto.
//
// A imagem sai reduzida (máx. 720px, JPEG) para não pesar no envio nem no banco.
// ---------------------------------------------------------------------------
const MAX = 720;

function comprime(fonte, largura, altura) {
  const escala = Math.min(1, MAX / Math.max(largura, altura));
  const c = document.createElement("canvas");
  c.width = Math.round(largura * escala);
  c.height = Math.round(altura * escala);
  c.getContext("2d").drawImage(fonte, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

export default function CapturaDeFoto({ facingMode = "user", rotulo = "Foto", onChange }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [ligada, setLigada] = useState(false);
  const [foto, setFoto] = useState("");
  const [erro, setErro] = useState("");

  const desliga = () => {
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ok */ }
    streamRef.current = null;
    setLigada(false);
  };
  // Desliga a câmera ao sair da tela — senão a luzinha fica acesa.
  useEffect(() => () => desliga(), []);

  async function ligaCamera() {
    setErro("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
      streamRef.current = stream;
      setLigada(true);
      // O vídeo só existe no DOM depois de ligada=true; espera um tique.
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); } }, 0);
    } catch {
      setErro("Não consegui abrir a câmera. Use o botão “Enviar do aparelho”.");
    }
  }

  function tira() {
    const v = videoRef.current;
    if (!v) return;
    const dataUrl = comprime(v, v.videoWidth || 640, v.videoHeight || 480);
    setFoto(dataUrl);
    onChange?.(dataUrl);
    desliga();
  }

  function refaz() {
    setFoto("");
    onChange?.("");
    ligaCamera();
  }

  function doArquivo(file) {
    if (!file) return;
    setErro("");
    const leitor = new FileReader();
    leitor.onload = () => {
      const img = new Image();
      img.onload = () => {
        const dataUrl = comprime(img, img.width || 640, img.height || 480);
        setFoto(dataUrl);
        onChange?.(dataUrl);
      };
      img.onerror = () => setErro("Não consegui ler essa imagem. Tente outra.");
      img.src = leitor.result;
    };
    leitor.onerror = () => setErro("Não consegui ler o arquivo.");
    leitor.readAsDataURL(file);
  }

  const moldura = { width: "100%", borderRadius: 8, border: "1px solid rgba(255,255,255,.2)", display: "block", background: "#111" };

  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 600 }}>{rotulo} *</Typography>

      {foto ? (
        <Stack spacing={1}>
          <Box component="img" src={foto} alt={rotulo} sx={{ ...moldura, maxHeight: 260, objectFit: "contain" }} />
          <Button size="small" startIcon={<ReplayIcon />} onClick={refaz}>Tirar outra</Button>
        </Stack>
      ) : ligada ? (
        <Stack spacing={1}>
          <Box component="video" ref={videoRef} playsInline muted sx={{ ...moldura, maxHeight: 300 }} />
          <Button variant="contained" startIcon={<CameraAltIcon />} onClick={tira}>Tirar a foto</Button>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button variant="outlined" startIcon={<CameraAltIcon />} onClick={ligaCamera}>Abrir a câmera</Button>
          <Button variant="text" component="label" startIcon={<PhotoCameraIcon />}>
            Enviar do aparelho
            <input hidden type="file" accept="image/*" capture={facingMode === "user" ? "user" : "environment"}
              onChange={(e) => { doArquivo(e.target.files?.[0]); e.target.value = ""; }} />
          </Button>
        </Stack>
      )}

      {erro && <Typography variant="caption" color="error" sx={{ display: "block", mt: 0.5 }}>{erro}</Typography>}
    </Box>
  );
}
