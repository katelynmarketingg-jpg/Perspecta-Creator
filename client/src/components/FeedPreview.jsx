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
  // Se o endereço direto não desenhar (.HEIC de iPhone), aí sim baixa e converte.
  const [baixarMesmo, setBaixarMesmo] = useState(false);

  const fileId = post.file_id;
  const thumb = post.thumb || null;
  const ehVideo = ["reel", "stories"].includes(post.content_type) || /^video\//.test(post.mime || tipo);

  useEffect(() => {
    setSrc(null); setErro(false); setTipo(post.mime || "");
    if (!fileId) return undefined;
    // Vídeo com endereço próprio toca direto, sem baixar nada por aqui.
    if (ehVideo && post.media_url) return undefined;
    // FOTO com endereço próprio também: desenha a arte em qualidade cheia direto
    // da nuvem, com a miniatura por baixo enquanto ela chega. Antes só o vídeo
    // tinha esse caminho — a foto era BAIXADA inteira por aqui, o que era lento
    // e, quando o download falhava, deixava a grade parada na miniatura
    // comprimida. Era isso que fazia a prévia do perfil parecer embaçada.
    if (post.media_url && !baixarMesmo) { setSrc(post.media_url); return undefined; }
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
  }, [fileId, thumb, post.mime, post.media_url, ehVideo, fetchFile, baixarMesmo]);

  const aprovado = post.approval_status === "approved" || post.stage_done;

  // CARROSSEL exportado como UMA imagem larga (as partes lado a lado): a capa
  // é o COMEÇO do carrossel, os primeiros 1080px da esquerda — nunca o meio da
  // tira. Ancorando à esquerda, a conta fecha sozinha: num quadro 1080x1440
  // (3:4), o recorte visível tem 0,75 x a altura da arte de largura — ou seja,
  // exatamente 1080px numa tira de 1440 de altura.
  const comecoDaTira = post.content_type === "carrossel";
  const midiaSx = {
    width: "100%", height: "100%", objectFit: "cover", display: "block",
    objectPosition: comecoDaTira ? "left center" : "center",
  };
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
          : <Box component="img" src={src} alt={post.title} loading="lazy" decoding="async"
              sx={thumb ? porCima : midiaSx}
              onError={() => {
                // Pelo endereço direto não desenhou (.HEIC): baixa e converte.
                // Só marca erro quando nem isso resolve e não há miniatura.
                if (src === post.media_url) setBaixarMesmo(true);
                else if (!thumb) setErro(true);
              }} />)}
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

        {/* Marca o que ainda não passou pelo cliente. É um selo no canto, não
            uma tarja no quadro inteiro: a prévia existe para a pessoa ver o
            PERFIL dela, e uma faixa laranja em cima de cada arte tapava
            justamente o que ela veio olhar. */}
        {!aprovado && (
          <Box sx={{
            position: "absolute", top: 5, left: 5, px: 0.6, py: 0.15, borderRadius: 0.75,
            bgcolor: (t) => alpha(t.palette.warning.main, 0.95),
            color: "#1C1917", fontSize: 8.5, fontWeight: 800, letterSpacing: .2,
            boxShadow: "0 1px 3px rgba(0,0,0,.25)",
          }}>
            AGUARDA
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
  // O perfil mostra o que EXISTE. Peça sem arte não é um quadrado cinza no
  // Instagram — ela simplesmente ainda não está lá. Quadro vazio no meio da
  // grade dava a impressão de um perfil furado.
  const comArte = (posts || []).filter((p) => p.file_id);

  // No perfil, a grade enche de baixo para cima: as linhas COMPLETAS ficam
  // embaixo e a folga (quando o total não fecha múltiplo de 3) sobra EM CIMA,
  // à direita do mais recente. O mais recente continua no topo à esquerda.
  // Ex.: 10 posts → linha de cima = [mais recente] + 2 vazios; abaixo, 3 linhas
  // cheias. Antes a folga ficava embaixo, o que não acontece num perfil real.
  const resto = comArte.length % 3;
  const folga = resto === 0 ? 0 : 3 - resto;
  const celulas = folga === 0
    ? comArte
    : [...comArte.slice(0, resto), ...Array.from({ length: folga }, () => null), ...comArte.slice(resto)];

  if (!comArte.length) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
        Nada por aqui ainda. Assim que os conteúdos tiverem arte, a prévia do perfil aparece.
      </Typography>
    );
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, flexWrap: "wrap", gap: 1 }}>
        <Typography variant="subtitle2">{titulo}</Typography>
        <Chip size="small" variant="outlined" label={`${comArte.length} publicações`} />
      </Stack>

      {/* Moldura de celular para dar a leitura certa da grade */}
      <Box sx={{
        maxWidth: 380, mx: "auto", border: 1, borderColor: "divider",
        borderRadius: 3, overflow: "hidden", bgcolor: "background.paper",
      }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px", bgcolor: "divider" }}>
          {celulas.map((p, i) => (
            p
              ? <Celula key={p.id} post={p} fetchFile={fetchFile} onClick={onSelect} />
              // Espaço que ainda vai ser preenchido — em cima, à direita do mais
              // recente. Fica neutro (não é "arte que não carregou").
              : <Box key={`vazio-${i}`} sx={{ aspectRatio: "1080 / 1440", bgcolor: "background.paper" }} />
          ))}
        </Box>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", mt: 1.5 }}>
        O mais recente em cima à esquerda, como aparece no perfil.
      </Typography>
    </Box>
  );
}
