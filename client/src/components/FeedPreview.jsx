import { useEffect, useState } from "react";
import { Box, Typography, Chip, Stack, Tooltip } from "@mui/material";
import { alpha } from "@mui/material/styles";
import ImageNotSupportedIcon from "@mui/icons-material/ImageNotSupported";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import { CONTENT_TYPES } from "../utils.js";

// Miniatura da grade. Recebe o fetcher pronto para servir tanto a agência
// quanto o portal (cada um tem o seu token).
//
// QUALIDADE: cada quadro é 1080x1440 (o retrato do Instagram), e é por ele que
// o cliente julga o trabalho — então a miniatura leve serve só de rascunho
// enquanto a ARTE DE VERDADE carrega por cima. Antes a grade parava na
// miniatura e o texto das artes saía embolado.
//
// VÍDEO não é baixado inteiro: o <video> com preload="metadata" puxa só o
// começo do arquivo e desenha o 1º quadro.
function Celula({ post, fetchFile, onClick }) {
  const [src, setSrc] = useState(null);
  const [tipo, setTipo] = useState(post.mime || "");
  const [erro, setErro] = useState(false);

  const fileId = post.file_id;
  const thumb = post.thumb || null;
  const ehVideo = ["reel", "stories"].includes(post.content_type) || /^video\//.test(post.mime || tipo);

  useEffect(() => {
    setSrc(null); setErro(false); setTipo(post.mime || "");
    if (!fileId) return undefined;
    // Vídeo com endereço próprio toca direto, sem baixar nada por aqui.
    if (ehVideo && post.media_url) return undefined;
    let url;
    let vivo = true;
    fetchFile(fileId)
      .then((blob) => {
        if (!vivo) return;
        url = URL.createObjectURL(blob);
        if (blob.type) setTipo(blob.type);
        setSrc(url);
      })
      // Sem a arte inteira, a miniatura (se houver) continua na tela.
      .catch(() => { if (vivo && !thumb) setErro(true); });
    return () => { vivo = false; if (url) URL.revokeObjectURL(url); };
  }, [fileId, thumb, post.mime, post.media_url, ehVideo, fetchFile]);

  const aprovado = post.approval_status === "approved" || post.stage_done;
  const midiaSx = { width: "100%", height: "100%", objectFit: "cover", display: "block" };
  const porCima = { ...midiaSx, position: "absolute", inset: 0 };

  // A arte em si. A miniatura entra primeiro (instantânea) e a arte cheia
  // desenha por cima quando chega — a troca não pisca.
  let arte;
  if (ehVideo && post.media_url) {
    arte = <Box component="video" src={`${post.media_url}#t=0.1`} preload="metadata" muted playsInline
      poster={thumb || undefined} sx={{ ...midiaSx, bgcolor: "#000" }} onError={() => setErro(true)} />;
  } else if (thumb || src) {
    arte = (
      <>
        {thumb && <Box component="img" src={thumb} alt="" aria-hidden sx={midiaSx} />}
        {src && (/^video\//.test(tipo)
          ? <Box component="video" src={`${src}#t=0.1`} preload="metadata" muted playsInline
              sx={{ ...(thumb ? porCima : midiaSx), bgcolor: "#000" }} onError={() => setErro(true)} />
          : <Box component="img" src={src} alt={post.title} sx={thumb ? porCima : midiaSx}
              onError={() => setErro(true)} />)}
      </>
    );
  } else {
    arte = (
      <Stack alignItems="center" spacing={0.5} sx={{ color: erro ? "error.main" : "text.disabled", p: 1 }}>
        <ImageNotSupportedIcon fontSize="small" />
        <Typography variant="caption" align="center" sx={{ fontSize: 10, lineHeight: 1.2 }}>
          {erro ? "arte não carregou" : "sem arte"}
        </Typography>
      </Stack>
    );
  }

  return (
    <Tooltip title={`${post.title}${post.scheduled_at ? ` · ${new Date(post.scheduled_at).toLocaleDateString("pt-BR")}` : ""}`}>
      <Box
        onClick={() => onClick?.(post)}
        sx={{
          position: "relative", aspectRatio: "1080 / 1440", cursor: "pointer", overflow: "hidden",
          bgcolor: "action.hover", display: "grid", placeItems: "center",
          "&:hover .capa": { opacity: 1 },
        }}
      >
        {arte}

        {ehVideo && (
          <PlayCircleIcon sx={{ position: "absolute", top: 6, right: 6, color: "#fff",
            filter: "drop-shadow(0 1px 3px rgba(0,0,0,.6))", fontSize: 20 }} />
        )}

        {/* Marca o que ainda não passou pelo cliente */}
        {!aprovado && (
          <Box sx={{
            position: "absolute", bottom: 0, left: 0, right: 0, py: 0.25,
            bgcolor: (t) => alpha(t.palette.warning.main, 0.9),
            color: "#1C1917", fontSize: 9.5, fontWeight: 700, textAlign: "center",
          }}>
            AGUARDA APROVAÇÃO
          </Box>
        )}

        <Box className="capa" sx={{
          position: "absolute", inset: 0, opacity: 0, transition: "opacity .18s ease",
          bgcolor: "rgba(0,0,0,.62)", color: "#fff", p: 1,
          display: "flex", flexDirection: "column", justifyContent: "center", gap: 0.4,
        }}>
          <Typography sx={{ fontSize: 11, fontWeight: 700, lineHeight: 1.25 }}>{post.title}</Typography>
          {post.scheduled_at && (
            <Typography sx={{ fontSize: 10, opacity: 0.85 }}>
              {new Date(post.scheduled_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </Typography>
          )}
        </Box>
      </Box>
    </Tooltip>
  );
}

/**
 * Grade do perfil: mostra como o feed vai ficar na ordem programada.
 * O Instagram põe o mais recente primeiro, então a ordem é decrescente.
 */
export default function FeedPreview({ posts, fetchFile, onSelect, titulo = "Prévia do feed" }) {
  if (!posts?.length) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
        Nada programado ainda. Assim que os posts tiverem data, a prévia do perfil aparece aqui.
      </Typography>
    );
  }

  const semArte = posts.filter((p) => !p.file_id).length;

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, flexWrap: "wrap", gap: 1 }}>
        <Typography variant="subtitle2">{titulo}</Typography>
        <Chip size="small" variant="outlined" label={`${posts.length} publicações`} />
        {semArte > 0 && (
          <Chip size="small" color="warning" variant="outlined" label={`${semArte} sem arte`} />
        )}
      </Stack>

      {/* Moldura de celular para dar a leitura certa da grade */}
      <Box sx={{
        maxWidth: 380, mx: "auto", border: 1, borderColor: "divider",
        borderRadius: 3, overflow: "hidden", bgcolor: "background.paper",
      }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px", bgcolor: "divider" }}>
          {posts.map((p) => (
            <Celula key={p.id} post={p} fetchFile={fetchFile} onClick={onSelect} />
          ))}
        </Box>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", mt: 1.5 }}>
        Ordem do mais recente para o mais antigo, como aparece no perfil.
      </Typography>
    </Box>
  );
}
