import { useEffect, useState } from "react";
import {
  Box, Card, CardContent, Typography, Chip, Stack, Button, Tabs, Tab, Alert,
  IconButton, Tooltip, Dialog, DialogContent,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import DownloadIcon from "@mui/icons-material/Download";
import MovieIcon from "@mui/icons-material/Movie";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import { fileSize } from "../utils.js";
import { ehHeic, heicParaJpeg } from "../upload/heic.js";

const ABAS = [
  { key: "todos", label: "Todos" },
  { key: "originais", label: "Originais" },
  { key: "editados", label: "Editados" },
  { key: "aprovacao", label: "Para aprovação" },
  { key: "aprovados", label: "Aprovados" },
  { key: "programados", label: "Programados" },
];

function diasRestantes(expiresAt) {
  if (!expiresAt) return null;
  const iso = expiresAt.includes("T") ? expiresAt : expiresAt.replace(" ", "T") + "Z";
  const dias = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  return Number.isFinite(dias) ? dias : null;
}

function Item({ arquivo, fetchFile }) {
  const [src, setSrc] = useState(null);
  const [baixando, setBaixando] = useState(false);
  const [vendo, setVendo] = useState(false);
  const ehImagem = arquivo.mime?.startsWith("image/");
  const ehVideo = arquivo.mime?.startsWith("video/");
  const heic = ehHeic(arquivo.original_name, arquivo.mime);
  const dias = diasRestantes(arquivo.expires_at);
  const urgente = dias !== null && dias <= 3 && !arquivo.keep_forever;

  // A miniatura, quando existe, evita baixar a arte inteira. Sem ela, baixa —
  // e no caso do .HEIC (foto de iPhone) converte antes, porque nenhum navegador
  // desenha esse formato. Baixar continua entregando o arquivo original.
  useEffect(() => {
    if (arquivo.thumb) { setSrc(arquivo.thumb); return undefined; }
    if (!ehImagem) return undefined;
    let url; let vivo = true;
    fetchFile(arquivo.id)
      .then(async (blob) => {
        const pronto = heic ? await heicParaJpeg(blob) : blob;
        if (!vivo || !pronto) return;
        url = URL.createObjectURL(pronto);
        setSrc(url);
      })
      .catch(() => {});
    return () => { vivo = false; if (url) URL.revokeObjectURL(url); };
  }, [arquivo.id, arquivo.thumb, ehImagem, heic, fetchFile]);

  async function baixar() {
    setBaixando(true);
    try {
      const blob = await fetchFile(arquivo.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = arquivo.original_name; a.click();
      URL.revokeObjectURL(url);
    } finally { setBaixando(false); }
  }

  // Pode ver em tela cheia? Vídeo com link, ou imagem já carregada/com link.
  const podeVer = (ehVideo && arquivo.media_url) || (ehImagem && (src || arquivo.media_url));

  return (
    <Card sx={{ overflow: "hidden" }}>
      <Box onClick={() => podeVer && setVendo(true)}
        sx={{ position: "relative", aspectRatio: "1", bgcolor: ehVideo ? "#000" : "action.hover",
          display: "grid", placeItems: "center", cursor: podeVer ? "pointer" : "default" }}>
        {ehVideo ? (
          <>
            {arquivo.thumb ? (
              <Box component="img" src={arquivo.thumb} alt={arquivo.original_name}
                sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : arquivo.media_url ? (
              <Box component="video" src={`${arquivo.media_url}#t=0.1`} preload="metadata" muted playsInline
                sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <MovieIcon sx={{ fontSize: 40, color: "primary.main" }} />
            )}
            <PlayCircleIcon sx={{ position: "absolute", fontSize: 44, color: "rgba(255,255,255,0.92)",
              filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.6))", pointerEvents: "none" }} />
          </>
        ) : src ? (
          <Box component="img" src={src} alt={arquivo.original_name}
            sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <InsertDriveFileIcon sx={{ fontSize: 36, color: "text.disabled" }} />
        )}
        {arquivo.content_type && (
          <Chip size="small" label={arquivo.content_type}
            sx={{ position: "absolute", top: 6, left: 6, height: 20, fontSize: 10, textTransform: "capitalize" }} />
        )}
      </Box>
      <CardContent sx={{ p: 1.25, "&:last-child": { pb: 1.25 } }}>
        <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600 }} title={arquivo.original_name}>
          {arquivo.task_title || arquivo.original_name}
        </Typography>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">{fileSize(arquivo.size)}</Typography>
          <Tooltip title="Baixar na qualidade original">
            <span>
              <IconButton size="small" color="primary" onClick={baixar} disabled={baixando}>
                <DownloadIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        {arquivo.keep_forever ? (
          <Chip size="small" variant="outlined" label="sem prazo" sx={{ mt: 0.5, height: 19, fontSize: 10 }} />
        ) : dias !== null && (
          <Chip size="small" color={urgente ? "error" : "default"} variant="outlined"
            label={dias <= 0 ? "sai hoje" : dias === 1 ? "1 dia restante" : `${dias} dias restantes`}
            sx={{ mt: 0.5, height: 19, fontSize: 10 }} />
        )}
      </CardContent>

      {/* Ver em tela cheia: vídeo toca (na proporção real), foto amplia. */}
      <Dialog open={vendo} onClose={() => setVendo(false)} maxWidth="md" fullWidth>
        <DialogContent sx={{ p: 1, bgcolor: "#000", display: "grid", placeItems: "center" }}>
          {ehVideo ? (
            <Box component="video" src={arquivo.media_url} controls autoPlay playsInline
              sx={{ width: "100%", maxHeight: "78vh", objectFit: "contain" }} />
          ) : (
            <Box component="img" src={src || arquivo.media_url} alt={arquivo.original_name}
              sx={{ width: "100%", maxHeight: "78vh", objectFit: "contain" }} />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function Galeria({ dados, fetchFile }) {
  const [aba, setAba] = useState("todos");
  if (!dados) return null;

  const todos = [...(dados.originais || []), ...(dados.editados || []), ...(dados.aprovacao || []), ...(dados.aprovados || []), ...(dados.programados || [])];
  const lista = aba === "todos" ? todos : (dados[aba] || []);
  const vencendo = todos.filter((f) => {
    const d = diasRestantes(f.expires_at);
    return !f.keep_forever && d !== null && d <= 3;
  }).length;

  return (
    <>
      <Alert severity="info" sx={{ mb: 2 }}>
        Todo material fica disponível por <strong>30 dias</strong> depois de enviado.
        Baixe o que quiser guardar — avisamos um dia antes de sair do ar.
      </Alert>

      {vencendo > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {vencendo} arquivo(s) saem do ar em até 3 dias.
        </Alert>
      )}

      <Tabs value={aba} onChange={(_, v) => setAba(v)} variant="scrollable"
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
        {ABAS.map((a) => {
          const n = a.key === "todos" ? todos.length : (dados[a.key] || []).length;
          return <Tab key={a.key} value={a.key} label={`${a.label} (${n})`} />;
        })}
      </Tabs>

      {lista.length === 0 ? (
        <Card><CardContent sx={{ textAlign: "center", py: 5 }}>
          <Typography color="text.secondary">Nada nesta etapa por enquanto.</Typography>
        </CardContent></Card>
      ) : (
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
          {lista.map((f) => <Item key={f.id} arquivo={f} fetchFile={fetchFile} />)}
        </Box>
      )}
    </>
  );
}
