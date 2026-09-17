// ---------------------------------------------------------------------------
// A ÁREA QUE RECEBE OS ARQUIVOS ARRASTADOS.
//
// Envolve o conteúdo de uma tela e acende quando algo é arrastado por cima.
// O contador de "entrou/saiu" existe porque o navegador dispara dragleave ao
// passar de um filho para outro dentro da mesma área — sem contar, a moldura
// piscaria o tempo todo enquanto a pessoa move o mouse.
// ---------------------------------------------------------------------------
import { useCallback, useRef, useState } from "react";
import { Box, Typography, Stack } from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { arquivosSoltos } from "./arrastar.js";

export default function AreaDeSoltar({ aoSoltar, ativo = true, aviso, children, sx }) {
  const [arrastando, setArrastando] = useState(false);
  const [lendo, setLendo] = useState(false);
  const dentro = useRef(0);

  const temArquivo = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");

  const entrou = useCallback((e) => {
    if (!temArquivo(e)) return;
    e.preventDefault();
    dentro.current += 1;
    setArrastando(true);
  }, []);

  const saiu = useCallback((e) => {
    if (!temArquivo(e)) return;
    dentro.current = Math.max(0, dentro.current - 1);
    if (dentro.current === 0) setArrastando(false);
  }, []);

  const porCima = useCallback((e) => {
    if (!temArquivo(e)) return;
    e.preventDefault();                       // sem isto o navegador não deixa soltar
    e.dataTransfer.dropEffect = ativo ? "copy" : "none";
  }, [ativo]);

  const soltou = useCallback(async (e) => {
    if (!temArquivo(e)) return;
    e.preventDefault();
    dentro.current = 0;
    setArrastando(false);
    if (!ativo) return;
    setLendo(true);
    try {
      // Pode demorar um instante quando é uma pasta grande — daí o aviso.
      const arquivos = await arquivosSoltos(e.dataTransfer);
      if (arquivos.length) aoSoltar(arquivos);
    } finally {
      setLendo(false);
    }
  }, [ativo, aoSoltar]);

  return (
    <Box
      onDragEnter={entrou} onDragOver={porCima} onDragLeave={saiu} onDrop={soltou}
      sx={{ position: "relative", ...sx }}
    >
      {children}
      {(arrastando || lendo) && (
        <Box sx={{
          position: "absolute", inset: -8, zIndex: 5, borderRadius: 3,
          border: "2px dashed", borderColor: ativo ? "primary.main" : "text.disabled",
          bgcolor: (t) => (t.palette.mode === "dark" ? "rgba(0,0,0,.72)" : "rgba(255,255,255,.86)"),
          display: "grid", placeItems: "center", pointerEvents: "none", textAlign: "center", p: 2,
        }}>
          <Stack alignItems="center" spacing={1}>
            <CloudUploadIcon sx={{ fontSize: 46, color: ativo ? "primary.main" : "text.disabled" }} />
            <Typography sx={{ fontWeight: 700 }}>
              {lendo ? "Abrindo a pasta…" : (ativo ? "Solte para enviar" : "Escolha um cliente primeiro")}
            </Typography>
            {ativo && !lendo && aviso && (
              <Typography variant="body2" color="text.secondary">{aviso}</Typography>
            )}
          </Stack>
        </Box>
      )}
    </Box>
  );
}
