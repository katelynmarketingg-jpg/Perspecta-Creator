import { useEffect, useState } from "react";
import { Box, Typography, Chip, Stack, Tooltip } from "@mui/material";
import { alpha } from "@mui/material/styles";
import ImageNotSupportedIcon from "@mui/icons-material/ImageNotSupported";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import { CONTENT_TYPES } from "../utils.js";

// Miniatura da grade. Recebe o fetcher pronto para servir tanto a agência
// quanto o portal (cada um tem o seu token).
//
// Ordem de desenho:
//  1. a miniatura que veio junto do post (leve, não baixa nada);
//  2. senão, baixa a arte e desenha — VÍDEO com <video>, porque <img> não toca
//     vídeo, e FOTO com <img>.
// O tipo vem do blob (o servidor manda o tipo certo); se o blob vier sem tipo,
// usamos o mime do post como reserva.
function Celula({ post, fetchFile, onClick }) {
  const [src, setSrc] = useState(null);
  const [tipo, setTipo] = useState(post.mime || "");
  const [erro, setErro] = useState(false);

  const fileId = post.file_id;
  const thumb = post.thumb || null;

  useEffect(() => {
    setSrc(null); setErro(false); setTipo(post.mime || "");
    if (!fileId || thumb) return undefined;
    let url;
    let vivo = true;
    fetchFile(fileId)
      .then((blob) => {
        if (!vivo) return;
        url = URL.createObjectURL(blob);
        if (blob.type) setTipo(blob.type);
        setSrc(url);
      })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; if (url) URL.revokeObjectURL(url); };
  }, [fileId, thumb, post.mime, fetchFile]);

  const ehVideo = ["reel", "stories"].includes(post.content_type) || /^video\//.test(tipo);
  const aprovado = post.approval_status === "approved" || post.stage_done;
  const midiaSx = { width: "100%", height: "100%", objectFit: "cover", display: "block" };

  // A arte em si: miniatura > vídeo > foto > aviso.
  let arte;
  if (thumb) {
    arte = <Box component="img" src={thumb} alt={post.title} sx={midiaSx} />;
  } else if (src && /^video\//.test(tipo)) {
    // preload="metadata" + #t=0.1 = mostra o 1º quadro sem tocar o vídeo.
    arte = <Box component="video" src={`${src}#t=0.1`} preload="metadata" muted playsInline
      sx={{ ...midiaSx, bgcolor: "#000" }} onError={() => setErro(true)} />;
  } else if (src) {
    arte = <Box component="img" src={src} alt={post.title} sx={midiaSx}
      onError={() => setErro(true)} />;
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
