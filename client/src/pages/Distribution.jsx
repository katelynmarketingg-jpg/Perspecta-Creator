import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  Box, Card, CardContent, Typography, TextField, MenuItem, Button, Stack,
  Chip, Alert, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  ToggleButtonGroup, ToggleButton, IconButton, Divider, Checkbox, Tooltip, Slider,
} from "@mui/material";
import CheckBoxIcon from "@mui/icons-material/CheckBox";
import ScheduleSendIcon from "@mui/icons-material/ScheduleSend";
import SendIcon from "@mui/icons-material/Send";
import UploadIcon from "@mui/icons-material/Upload";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import ViewModuleIcon from "@mui/icons-material/ViewModule";
import ViewListIcon from "@mui/icons-material/ViewList";
import GridOnIcon from "@mui/icons-material/GridOn";
import CalendarViewMonthIcon from "@mui/icons-material/CalendarViewMonth";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import StarIcon from "@mui/icons-material/Star";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import DescriptionIcon from "@mui/icons-material/Description";
import DownloadIcon from "@mui/icons-material/Download";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import api from "../api/client.js";
import { makeThumbnail } from "../upload/thumbnail.js";
import { medirImagem, fatiarEmSlides } from "../upload/carousel.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { CONTENT_TYPES, formatTime, whatsappLink } from "../utils.js";
import PlanningRefDialog from "../components/PlanningRefDialog.jsx";
import { thumbFromElement } from "../upload/thumbnail.js";
import { carregarArte } from "../media.js";

// Cache de mídias por sessão: cada arquivo é baixado UMA vez e reaproveitado
// entre telas, filtros e re-renderizações. Antes cada componente rebaixava o
// blob e o revogava ao desmontar — trocar de visão/rolar recarregava tudo, o
// que deixava a Distribuição lenta. Aqui a URL do objeto vive enquanto a página
// estiver aberta (o cache é o dono; ninguém revoga).
function loadMedia(fileId) {
  if (!fileId) return Promise.resolve(null);
  // Passa pelo carregador compartilhado: é ele que converte a foto de iPhone
  // (.HEIC), que nenhum navegador desenha — era por isso que as fotos ficavam
  // em branco aqui, mesmo já aparecendo na Galeria.
  return carregarArte(
    `agencia:${fileId}`,
    () => api.get(`/files/${fileId}/download`, { responseType: "blob" }).then((r) => r.data)
  ).then((m) => ({ url: m.url, type: m.tipo }));
}

// Miniatura (leve) do arquivo: é o que desenha a grade do perfil sem baixar a
// arte inteira de cada quadrado. Vale para foto E vídeo — a miniatura do vídeo
// é um quadro dele, então a prévia aparece igual à da foto.
const _thumbCache = new Map();   // fileId -> data URI | null (null = não tem)
const _thumbInflight = new Map();
// Guarda a miniatura a partir da mídia já desenhada, para os arquivos enviados
// antes de a miniatura existir. Uma vez por arquivo por sessão.
const _thumbsEnviadas = new Set();
async function guardarMiniatura(fileId, el) {
  if (!fileId || _thumbsEnviadas.has(fileId)) return;
  _thumbsEnviadas.add(fileId);
  const thumb = thumbFromElement(el);
  if (!thumb) return;
  try { await api.put(`/files/${fileId}/thumb`, { thumb }); _thumbCache.set(fileId, thumb); }
  catch { _thumbsEnviadas.delete(fileId); }
}

function loadThumb(fileId) {
  if (!fileId) return Promise.resolve(null);
  if (_thumbCache.has(fileId)) return Promise.resolve(_thumbCache.get(fileId));
  if (_thumbInflight.has(fileId)) return _thumbInflight.get(fileId);
  const p = api.get(`/files/${fileId}/thumb`)
    .then((r) => { const t = r.data?.thumb || null; _thumbCache.set(fileId, t); return t; })
    .catch(() => { _thumbCache.set(fileId, null); return null; })   // sem miniatura: cai na arte inteira
    .finally(() => _thumbInflight.delete(fileId));
  _thumbInflight.set(fileId, p);
  return p;
}

// Mês de referência da peça (para abrir o planejamento certo): usa a data
// programada; se não tiver, o mês atual.
const ymOf = (scheduled) => {
  const s = scheduled ? String(scheduled).slice(0, 7) : "";
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Bolinha de status: a cor conta, num relance, em que pé está cada peça.
//  🟢 verde   = já aprovado pelo cliente
//  🟡 amarelo = enviado, aguardando aprovação
//  🟠 laranja = ainda não foi enviado para aprovação
//  🔵 azul    = programado (já foi para "Programados")
const STATUS = {
  programado: { color: "#2563EB", label: "Programado" },
  aprovado:   { color: "#16A34A", label: "Aprovado" },
  aguardando: { color: "#EAB308", label: "Aguardando aprovação" },
  nao_enviado:{ color: "#EA580C", label: "Não enviado" },
};
function statusOf(p) {
  if (p.stage_done) return "programado";
  if (p.approval_status === "approved") return "aprovado";
  if (p.approval_status === "sent") return "aguardando";
  return "nao_enviado";
}
function StatusDot({ status }) {
  const s = STATUS[status] || STATUS.nao_enviado;
  return (
    <Tooltip title={s.label}>
      <Box sx={{ width: 13, height: 13, borderRadius: "50%", bgcolor: s.color, flexShrink: 0, boxShadow: "0 0 0 2px rgba(0,0,0,0.06)" }} />
    </Tooltip>
  );
}

// data do banco "YYYY-MM-DD HH:MM" <-> input "YYYY-MM-DDTHH:MM"
const toInput = (v) => (v ? v.replace(" ", "T").slice(0, 16) : "");
const fromInput = (v) => (v ? v.replace("T", " ").slice(0, 16) : "");

// Mostra a arte (foto ou vídeo), carregada em alta qualidade.
// fit="cover" (padrão) preenche o quadrado (para grades/miniaturas);
// fit="contain" mostra a IMAGEM INTEIRA na proporção real (para a prévia do
// post), sem cortar nada — sobra uma faixa neutra ao redor quando não é quadrada.
// Reel e stories são sempre vídeo; fora isso, o tipo do arquivo decide.
const pecaEhVideo = (p) => ["reel", "stories"].includes(p?.content_type) || /^video\//.test(p?.mime || "");

function Media({ fileId, capaId, height = 200, fit = "cover", streamUrl = null, ehVideoDica = false, comecoDaTira = false, natural = false }) {
  const [src, setSrc] = useState(null);
  const [video, setVideo] = useState(false);
  const [capa, setCapa] = useState(null);
  const [ph, setPh] = useState(null);   // miniatura leve como placeholder instantâneo
  const [erro, setErro] = useState(false);

  // VÍDEO não é baixado: toca pelo endereço de streaming, em que o navegador
  // pede só o começo do arquivo e já mostra o 1º quadro. Baixar um reel de
  // 200 MB inteiro antes de aparecer qualquer coisa fazia a peça parecer
  // travada — e em internet de celular, nunca terminava.
  const transmite = Boolean(streamUrl && ehVideoDica);

  useEffect(() => {
    setSrc(null); setErro(false); setCapa(null); setPh(null);
    if (!fileId || transmite) return undefined;
    let alive = true;
    // Carregamento PROGRESSIVO, sem perder qualidade: a miniatura leve (~640px)
    // entra na hora como rascunho, e a ARTE EM QUALIDADE REAL desenha por cima
    // assim que baixa. A pessoa vê algo na hora (tela não fica "carregando uma
    // década") e a qualidade final é sempre a do arquivo original.
    loadThumb(fileId).then((t) => { if (alive && t) setPh(t); }).catch(() => {});
    loadMedia(fileId)
      .then((m) => { if (alive && m) { setSrc(m.url); setVideo((m.type || "").startsWith("video")); } })
      .catch(() => { if (alive) setErro(true); });
    return () => { alive = false; };  // não revoga: o cache é dono da URL
  }, [fileId, transmite]);

  // A CAPA escolhida vira o quadro parado do vídeo: o post aparece com a arte
  // certa e continua dando para dar play — antes era um ou outro.
  useEffect(() => {
    if (!capaId || capaId === fileId) return undefined;
    let alive = true;
    loadThumb(capaId)
      .then((t) => (t ? { url: t } : loadMedia(capaId)))
      .then((m) => { if (alive && m) setCapa(m.url); })
      .catch(() => {});
    return () => { alive = false; };
  }, [capaId, fileId]);

  const contain = fit === "contain";
  // Modo NATURAL: a arte aparece na proporção REAL, preenchendo a largura do
  // card, com altura automática — sem cortar e sem tarja preta em volta. É o
  // jeito certo de ver o post (retrato 4:5, reel 9:16, etc.) na Distribuição.
  // Carrossel salvo como UMA imagem larga: onde o quadro representa a CAPA, o
  // que tem de aparecer é o começo da tira — os primeiros 1080px da esquerda.
  const sx = natural
    ? {
        width: "100%", height: "auto", display: "block", borderRadius: 2,
        objectPosition: comecoDaTira ? "left center" : "center",
      }
    : {
        width: "100%", height, objectFit: fit, borderRadius: 2,
        objectPosition: comecoDaTira && !contain ? "left center" : "center",
        bgcolor: contain ? "#000" : "action.hover", display: "block",
      };
  const pequeno = !natural && height <= 90;
  // Caixa de aviso/carregando: no modo natural usa uma proporção retrato padrão
  // só para não "colapsar" a altura enquanto nada carregou.
  const molduraVazia = natural
    ? { width: "100%", aspectRatio: "4 / 5", borderRadius: 2 }
    : { width: "100%", height, borderRadius: 2 };
  const aviso = (texto, cor, tracejado = false) => (
    <Box sx={{
      ...molduraVazia, display: "grid", placeItems: "center", textAlign: "center",
      color: cor, fontSize: pequeno ? 9 : 13, lineHeight: 1.3, p: 1,
      // Falta de arte NÃO é erro: fundo claro e borda tracejada, como um espaço
      // esperando ser preenchido. Antes era um retângulo preto com "Sem mídia",
      // que parecia exatamente uma imagem quebrada.
      bgcolor: tracejado ? "action.hover" : (contain && !natural ? "#000" : "action.hover"),
      border: tracejado ? "2px dashed" : 0, borderColor: "divider",
    }}>{texto}</Box>
  );
  if (!fileId) {
    return aviso(
      pequeno ? "sem arte" : <>Nenhuma arte ainda<br /><Box component="span" sx={{ fontSize: 12, opacity: 0.75 }}>use “Subir” ou “Da galeria”</Box></>,
      "text.secondary", true);
  }
  if (erro) return aviso(<>Arte não carregou<br />(reenvie)</>, "error.main");
  const mostraControles = natural || height > 120;
  // No modo natural o vídeo também aparece na proporção real (altura automática);
  // fora dele, mantém a caixa de altura fixa com o vídeo contido em fundo preto.
  const sxVideo = natural ? { ...sx, bgcolor: "#000" } : { ...sx, objectFit: "contain", bgcolor: "#000" };
  if (transmite) {
    return <Box component="video" src={streamUrl} poster={capa || undefined} controls={mostraControles}
      muted playsInline preload="metadata" sx={sxVideo}
      onError={() => setErro(true)} />;
  }
  // Ainda baixando a arte cheia: mostra a miniatura (se já veio) como rascunho;
  // senão, o spinner. A qualidade final entra por cima quando o arquivo chega.
  if (!src) {
    if (ph) return <Box component="img" src={ph} alt="" sx={sx} />;
    return <Box sx={{ ...molduraVazia, bgcolor: "action.hover", display: "grid", placeItems: "center" }}><CircularProgress size={22} /></Box>;
  }
  return video
    ? <Box component="video" src={src} poster={capa || ph || undefined} controls={mostraControles} muted playsInline
        preload="metadata" sx={sxVideo}
        onError={() => setErro(true)} />
    : <Box component="img" src={src} alt="" sx={sx} onError={() => setErro(true)} />;
}

// Escolher um arquivo navegando pelas PASTAS do cliente (mesma estrutura da
// aba Arquivos). Mostra as pastas para entrar e os arquivos para selecionar.
function GalleryPicker({ clientId, open, onClose, onPick, titulo = "Selecionar da galeria de arquivos" }) {
  const [path, setPath] = useState([]); // trilha de pastas: [{id,name}]
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const currentFolder = path[path.length - 1]?.id || null;

  useEffect(() => { if (open) setPath([]); }, [open, clientId]);

  useEffect(() => {
    if (!open || !clientId) return;
    setLoading(true);
    const params = { client_id: clientId };
    if (currentFolder) params.parent_id = currentFolder;
    const pf = api.get("/files/folders", { params }).then((r) => setFolders(r.data || [])).catch(() => setFolders([]));
    // Arquivos da pasta atual (na raiz = sem pasta).
    const fparams = { client_id: clientId };
    if (currentFolder) fparams.folder_id = currentFolder;
    const ff = api.get("/files", { params: fparams })
      .then((r) => setFiles((r.data || []).filter((f) => /^(image|video)\//.test(f.mime || ""))))
      .catch(() => setFiles([]));
    Promise.all([pf, ff]).finally(() => setLoading(false));
  }, [open, clientId, currentFolder]);

  const vazio = !loading && folders.length === 0 && files.length === 0;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{titulo}</DialogTitle>
      <DialogContent>
        {/* Trilha de navegação (breadcrumb) */}
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: "wrap", mb: 1.5 }}>
          <Button size="small" onClick={() => setPath([])} disabled={!path.length}>📁 Início</Button>
          {path.map((p, i) => (
            <Typography key={p.id} variant="body2" sx={{ cursor: "pointer" }}
              onClick={() => setPath(path.slice(0, i + 1))}>/ {p.name}</Typography>
          ))}
        </Stack>
        {loading ? (
          <Box sx={{ display: "grid", placeItems: "center", py: 4 }}><CircularProgress /></Box>
        ) : vazio ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            Nada aqui. Suba arquivos ou crie pastas na aba Arquivos.
          </Typography>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 1.5, pt: 1 }}>
            {folders.map((fd) => (
              <Box key={`d${fd.id}`} onClick={() => setPath([...path, { id: fd.id, name: fd.name }])}
                sx={{ cursor: "pointer", borderRadius: 1.5, p: 1, border: 1, borderColor: "divider", display: "grid", placeItems: "center", gap: 0.5, "&:hover": { borderColor: "primary.main" } }}>
                <Typography sx={{ fontSize: 34, lineHeight: 1 }}>📁</Typography>
                <Typography variant="caption" noWrap sx={{ maxWidth: "100%" }}>{fd.name}</Typography>
              </Box>
            ))}
            {files.map((f) => (
              <Box key={`f${f.id}`} onClick={() => { onPick(f.id); onClose(); }}
                sx={{ cursor: "pointer", borderRadius: 1.5, overflow: "hidden", border: 1, borderColor: "divider", "&:hover": { borderColor: "primary.main" } }}>
                {/* Miniatura leve (não baixa a arte inteira) → galeria abre rápido. */}
                <Box sx={{ height: 110, bgcolor: "action.hover" }}><FeedThumb fileId={f.id} /></Box>
                <Typography variant="caption" noWrap sx={{ display: "block", px: 0.5, py: 0.25 }}>{f.original_name}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Fechar</Button></DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ESCOLHER A CAPA DO VÍDEO, como no Instagram: uma tira de quadros embaixo do
// vídeo; toca num e a capa é aquela. A barra fica para ajustar no detalhe.
//
// O que fazia isso demorar: a tela BAIXAVA o vídeo inteiro antes de mostrar
// qualquer coisa. Agora ela transmite (o navegador pede só os pedaços de que
// precisa) e a tira é montada pulando de quadro em quadro, num vídeo escondido
// — então a janela abre na hora, mesmo num reel grande.
// ---------------------------------------------------------------------------
const QUADROS_DA_TIRA = 8;

/** Pula para `t` e espera o quadro estar desenhado. */
function vaiPara(v, t) {
  return new Promise((resolve) => {
    let feito = false;
    const acabou = () => { if (feito) return; feito = true; v.removeEventListener("seeked", acabou); resolve(); };
    v.addEventListener("seeked", acabou);
    setTimeout(acabou, 2500);        // quadro teimoso não trava a tira
    try { v.currentTime = t; } catch { acabou(); }
  });
}

function VideoCoverDialog({ fileId, streamUrl, clientId, open, onClose, onCaptured, flash }) {
  const videoRef = useRef(null);
  const tiraRef = useRef(null);       // vídeo escondido que monta a tira
  const [src, setSrc] = useState(null);
  const [isVideo, setIsVideo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);
  const [tira, setTira] = useState([]);      // [{ t, url }]
  const [montando, setMontando] = useState(false);

  useEffect(() => {
    if (!open || !fileId) { setSrc(null); setDur(0); setCur(0); setTira([]); return undefined; }
    // Endereço de streaming: abre na hora, sem baixar o arquivo.
    if (streamUrl) { setSrc(streamUrl); setIsVideo(true); return undefined; }
    let alive = true;
    loadMedia(fileId)
      .then((m) => { if (alive && m) { setSrc(m.url); setIsVideo((m.type || "").startsWith("video")); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [open, fileId, streamUrl]);

  // A tira de quadros, assim que o vídeo diz quanto dura.
  useEffect(() => {
    if (!open || !src || !dur) return undefined;
    let vivo = true;
    const urls = [];
    (async () => {
      setMontando(true);
      const v = tiraRef.current;
      if (!v) return;
      const cv = document.createElement("canvas");
      const feitos = [];
      for (let i = 0; i < QUADROS_DA_TIRA && vivo; i++) {
        // Não pega o 0 nem o fim: costumam ser preto.
        const t = dur * ((i + 0.5) / QUADROS_DA_TIRA);
        await vaiPara(v, t);
        if (!vivo || !v.videoWidth) continue;
        const esc = Math.min(1, 160 / v.videoHeight);
        cv.width = Math.max(1, Math.round(v.videoWidth * esc));
        cv.height = Math.max(1, Math.round(v.videoHeight * esc));
        cv.getContext("2d").drawImage(v, 0, 0, cv.width, cv.height);
        const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.7));
        if (!blob || !vivo) continue;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        feitos.push({ t, url });
        setTira([...feitos]);        // aparecem um a um, sem esperar a tira toda
      }
      if (vivo) setMontando(false);
    })();
    return () => { vivo = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [open, src, dur]);

  const fmt = (s) => {
    if (!Number.isFinite(s)) return "0:00";
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return `${m}:${String(ss).padStart(2, "0")}`;
  };
  // Arrasta a barra (ou toca num quadro) → o vídeo vai para aquele instante.
  const seek = (t) => {
    setCur(t);
    const v = videoRef.current;
    if (v) { try { v.pause(); v.currentTime = t; } catch { /* ignore */ } }
  };

  async function capturar() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext("2d").drawImage(v, 0, 0);
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
      const fd = new FormData();
      fd.append("files", blob, `capa-${Date.now()}.jpg`);
      if (clientId) fd.append("client_id", clientId);
      fd.append("stage", "editados");
      const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      const newId = data?.[0]?.id;
      if (newId) { onCaptured(newId); onClose(); }
    } catch { flash?.("Não foi possível capturar o quadro.", "error"); }
    setBusy(false);
  }

  // Qual quadro da tira está escolhido agora (o mais perto do instante atual).
  const escolhido = tira.reduce((melhor, q, i) =>
    (melhor === -1 || Math.abs(q.t - cur) < Math.abs(tira[melhor].t - cur) ? i : melhor), -1);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Escolher a capa do vídeo</DialogTitle>
      <DialogContent>
        {!src ? (
          <Box sx={{ display: "grid", placeItems: "center", py: 4 }}><CircularProgress /></Box>
        ) : !isVideo ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            O anexo atual é uma foto. Anexe um vídeo para escolher um quadro.
          </Typography>
        ) : (
          <Stack spacing={1.25}>
            <Box component="video" ref={videoRef} src={src} playsInline preload="metadata"
              onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => setCur(e.currentTarget.currentTime || 0)}
              sx={{ width: "100%", maxHeight: 420, bgcolor: "#000", borderRadius: 2 }} />

            {/* O vídeo que monta a tira, fora da vista. */}
            <Box component="video" ref={tiraRef} src={src} muted playsInline preload="auto"
              crossOrigin="anonymous" sx={{ display: "none" }} />

            <Typography variant="caption" color="text.secondary">
              Toque no quadro que você quer de capa. Dá para afinar na barra.
            </Typography>

            {/* A TIRA — o jeito rápido de escolher */}
            <Box sx={{ display: "flex", gap: 0.5, overflowX: "auto", pb: 0.5 }}>
              {tira.map((q, i) => (
                <Box key={q.url} onClick={() => seek(q.t)}
                  sx={{
                    flex: "0 0 auto", cursor: "pointer", borderRadius: 1, overflow: "hidden",
                    border: 2, borderColor: i === escolhido ? "primary.main" : "transparent",
                    opacity: i === escolhido ? 1 : 0.75, transition: "opacity .12s, border-color .12s",
                    "&:hover": { opacity: 1 },
                  }}>
                  <Box component="img" src={q.url} alt="" sx={{ height: 78, display: "block" }} />
                </Box>
              ))}
              {montando && Array.from({ length: Math.max(0, QUADROS_DA_TIRA - tira.length) }).map((_, i) => (
                <Box key={`v${i}`} sx={{ flex: "0 0 auto", width: 44, height: 78, borderRadius: 1, bgcolor: "action.hover" }} />
              ))}
            </Box>

            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums", minWidth: 34 }}>{fmt(cur)}</Typography>
              <Slider size="small" min={0} max={dur || 0} step={0.05} value={Math.min(cur, dur || 0)}
                onChange={(_, v) => seek(Array.isArray(v) ? v[0] : v)} sx={{ flex: 1 }} disabled={!dur} />
              <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums", minWidth: 34 }}>{fmt(dur)}</Typography>
            </Stack>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
        {isVideo && <Button variant="contained" onClick={capturar} disabled={busy}>Usar este quadro como capa</Button>}
      </DialogActions>
    </Dialog>
  );
}

// Um cartão por peça: mídia + legenda + observação + data → enviar p/ aprovação.
function PieceCard({ item, onChanged, flash }) {
  const [caption, setCaption] = useState(item.caption || "");
  const [obs, setObs] = useState(item.description || "");
  const [when, setWhen] = useState(toInput(item.scheduled_at));
  const [fileId, setFileId] = useState(item.file_id || null);
  const [coverId, setCoverId] = useState(item.cover_file_id || null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [picker, setPicker] = useState(false);
  const [coverPicker, setCoverPicker] = useState(false);
  const [videoCover, setVideoCover] = useState(false);
  const [planRef, setPlanRef] = useState(false);
  const [slides, setSlides] = useState(item.media_ids || []); // carrossel
  const [slidePicker, setSlidePicker] = useState(false);
  const [slideUploading, setSlideUploading] = useState(false);
  const [posted, setPosted] = useState(!!item.published_at);
  const [baixando, setBaixando] = useState(false);
  const [iaLegenda, setIaLegenda] = useState(false);
  // Fatiador de carrossel: quando a arte é mais larga que uma slide, pergunta
  // em quantas partes cortar. { file, largura, altura, n }.
  const [slicer, setSlicer] = useState(null);
  // Visualizador do carrossel (setinha): qual slide está na frente.
  const [viewIdx, setViewIdx] = useState(0);
  const ct = CONTENT_TYPES[item.content_type];
  const isCarousel = item.content_type === "carrossel";

  // Gera a legenda com IA OLHANDO a arte (foto ou 1º quadro do vídeo) + a persona
  // e o planejamento do cliente. O resultado entra no campo pra você ajustar.
  async function gerarLegendaIA() {
    if (!item.client_id) { flash("Escolha o cliente primeiro.", "error"); return; }
    setIaLegenda(true);
    try {
      let image = null;
      const midiaId = coverId || fileId || slides[0];
      if (midiaId) {
        try {
          const blob = (await api.get(`/files/${midiaId}/download`, { responseType: "blob" })).data;
          image = await makeThumbnail(blob); // reduz p/ ~640px antes de enviar
        } catch { /* sem imagem: gera pelo contexto/planejamento */ }
      }
      const { data } = await api.post("/ai/generate", {
        client_id: item.client_id, kind: "caption", count: 1, image,
        topic: item.title || CONTENT_TYPES[item.content_type]?.label || "",
      });
      const txt = (data.text || "").trim();
      if (txt) { setCaption(txt); flash("Legenda gerada pela IA — revise e salve. ✨", "success"); }
      else flash("A IA não retornou legenda. Tente de novo.", "error");
    } catch (err) {
      const d = err.response?.data;
      if (d?.needs_key) flash("Configure a chave de IA na aba IA (menu lateral) primeiro.", "error");
      else flash(d?.error || "Não foi possível gerar a legenda.", "error");
    }
    setIaLegenda(false);
  }

  // ---- Postar manual (Reels com música do Edits) ----
  // Baixa/compartilha o vídeo (no celular abre a folha de compartilhamento →
  // Edits), copia a legenda e marca como postado — sem passar pela API da Meta.
  async function baixarOuCompartilhar() {
    const id = fileId || coverId || slides[0];
    if (!id) { flash("Sem arquivo pra baixar. Anexe a arte primeiro.", "error"); return; }
    setBaixando(true);
    try {
      const blob = (await api.get(`/files/${id}/download`, { responseType: "blob" })).data;
      const ext = (blob.type.split("/")[1] || "mp4").split("+")[0];
      const nome = `${(item.title || "conteudo").replace(/[^\w.-]+/g, "_")}.${ext}`;
      const file = new File([blob], nome, { type: blob.type || "application/octet-stream" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], text: caption || "" }); return; }
        catch { /* usuário cancelou o compartilhamento */ }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = nome; a.click();
      URL.revokeObjectURL(url);
    } catch { flash("Não consegui baixar o arquivo.", "error"); }
    finally { setBaixando(false); }
  }
  async function copiarLegenda() {
    try { await navigator.clipboard.writeText(caption || ""); flash("Legenda copiada!", "success"); }
    catch { flash("Não consegui copiar — selecione o texto e copie manualmente.", "error"); }
  }
  async function marcarPostado(v = true) {
    try {
      await api.post(`/distribution/${item.id}/mark-posted`, { posted: v });
      setPosted(v);
      flash(v ? "Marcado como postado ✓" : "Voltou para pendente.", "success");
    } catch (err) { flash(err.response?.data?.error || "Não foi possível marcar.", "error"); }
  }

  async function saveSlides(next) {
    setSlides(next);
    if (next[0]) { setCoverId(next[0]); setFileId(next[0]); }
    try { await api.put(`/distribution/${item.id}`, { media_ids: next }); }
    catch (err) { flash(err.response?.data?.error || "Não foi possível salvar as slides.", "error"); }
  }
  const addSlide = (id) => { if (id && !slides.includes(id)) saveSlides([...slides, id]); };
  const removeSlide = (id) => saveSlides(slides.filter((s) => s !== id));
  // Mover uma slide de lugar. Num carrossel a ordem É o post: a 1ª é a capa que
  // aparece no perfil, e as outras seguem na ordem em que a pessoa desliza.
  const moveSlide = (i, d) => {
    const alvo = i + d;
    if (alvo < 0 || alvo >= slides.length) return;
    const next = [...slides];
    [next[i], next[alvo]] = [next[alvo], next[i]];
    saveSlides(next);
  };
  // Sobe UM arquivo (File/Blob) e devolve o id — reaproveitado pelo fatiador.
  async function subirArquivo(file) {
    const fd = new FormData();
    fd.append("files", file);
    if (item.client_id) fd.append("client_id", item.client_id);
    fd.append("stage", "editados");
    const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
    return data?.[0]?.id || null;
  }

  async function uploadSlide(e) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    // Arte larga (mais de uma slide)? Pergunta em quantas fatiar em vez de subir
    // um bloco só — a pessoa vê o carrossel montado, deslizando com a setinha.
    try {
      const medida = await medirImagem(file);
      if (medida?.fatiavel) { setSlicer({ file, largura: medida.largura, altura: medida.altura, n: medida.sugestao }); return; }
    } catch { /* segue como slide única */ }
    setSlideUploading(true);
    try {
      const newId = await subirArquivo(file);
      if (newId) saveSlides([...slides, newId]);
    } catch (err) { flash(err.response?.data?.error || "Falha no upload.", "error"); }
    setSlideUploading(false);
  }

  // Corta a arte em N fatias (no navegador) e sobe cada uma como slide, na ordem.
  // Se `substituir` estiver setado (arte larga que já estava), as fatias tomam o
  // LUGAR dela na sequência — é assim que "arrumamos" um carrossel antigo.
  async function confirmarFatiar() {
    if (!slicer) return;
    setSlideUploading(true);
    try {
      const partes = await fatiarEmSlides(slicer.file, slicer.n);
      const novos = [];
      for (const parte of partes) {
        // eslint-disable-next-line no-await-in-loop
        const id = await subirArquivo(parte);
        if (id) novos.push(id);
      }
      if (novos.length) {
        let next;
        const sub = slicer.substituir;
        if (sub) {
          const base = slides.length ? slides : [sub];
          const i = base.indexOf(sub);
          next = i >= 0 ? [...base.slice(0, i), ...novos, ...base.slice(i + 1)] : novos;
        } else {
          next = [...slides, ...novos];
        }
        saveSlides(next);
        setViewIdx(0);
        flash(`Carrossel montado com ${novos.length} slides. ✅`, "success");
      }
      setSlicer(null);
    } catch (err) { flash(err.response?.data?.error || "Não consegui fatiar a arte.", "error"); }
    setSlideUploading(false);
  }

  // "Arrumar" um carrossel que já existe: pega a arte larga atual (uma tira com
  // várias slides lado a lado) e abre o corte, para trocá-la pelas slides.
  async function cortarArteExistente() {
    const id = slides[0] || fileId || coverId;
    if (!id) { flash("Não há arte para cortar aqui.", "error"); return; }
    try {
      const blob = (await api.get(`/files/${id}/download`, { responseType: "blob" })).data;
      const file = new File([blob], `${(item.title || "carrossel").replace(/[^\w.-]+/g, "_")}.jpg`,
        { type: blob.type || "image/jpeg" });
      const medida = await medirImagem(file);
      if (!medida?.fatiavel) {
        flash("Essa arte não é larga o bastante para virar um carrossel de várias slides.", "error");
        return;
      }
      setSlicer({ file, largura: medida.largura, altura: medida.altura, n: medida.sugestao, substituir: id });
    } catch { flash("Não consegui abrir a arte para cortar.", "error"); }
  }

  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("files", file);
      if (item.client_id) fd.append("client_id", item.client_id);
      fd.append("stage", "editados");
      const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      const newId = data?.[0]?.id;
      if (newId) { setFileId(newId); await api.put(`/distribution/${item.id}`, { file_id: newId }); }
    } catch (err) { flash(err.response?.data?.error || "Falha no upload.", "error"); }
    setUploading(false);
  }

  async function pickFromGallery(id) {
    setFileId(id);
    try { await api.put(`/distribution/${item.id}`, { file_id: id }); }
    catch (err) { flash(err.response?.data?.error || "Não foi possível anexar.", "error"); }
  }

  async function setCover(id) {
    setCoverId(id);
    try { await api.put(`/distribution/${item.id}`, { cover_file_id: id }); flash("Capa do perfil definida.", "success"); }
    catch (err) { flash(err.response?.data?.error || "Não foi possível definir a capa.", "error"); }
  }

  async function save(silent) {
    setSaving(true);
    try {
      await api.put(`/distribution/${item.id}`, { caption, description: obs, scheduled_at: fromInput(when) });
      if (!silent) flash("Salvo.", "success");
    } catch (err) { flash(err.response?.data?.error || "Não foi possível salvar.", "error"); }
    setSaving(false);
  }

  async function send() {
    setSending(true);
    try {
      await api.put(`/distribution/${item.id}`, { caption, description: obs, scheduled_at: fromInput(when) });
      await api.post(`/distribution/${item.id}/send`);
      flash("Enviado para o cliente aprovar. ✅", "success");
      onChanged();
    } catch (err) { flash(err.response?.data?.error || "Não foi possível enviar.", "error"); }
    setSending(false);
  }

  const canSend = Boolean(fileId && when);

  return (
    <Card sx={{ height: "100%" }}>
      <CardContent>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap", gap: 0.5 }}>
            {ct && <Chip size="small" color="primary" label={`${ct.emoji} ${ct.label}`} />}
            <Typography sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{item.title}</Typography>
          </Stack>
          {item.client_name && <Typography variant="caption" color="text.secondary">{item.client_name}</Typography>}

          {item.approval_status === "changes_requested" && (
            <Alert severity="warning" sx={{ py: 0.5 }}>
              Cliente pediu ajuste{item.client_note ? `: ${item.client_note}` : "."}
            </Alert>
          )}

          {/* Arte da peça. No carrossel vira um visualizador: a 1ª slide fica na
              frente e a pessoa desliza com a setinha. Fora do carrossel, mostra
              a capa/arte escolhida. */}
          {isCarousel && slides.length ? (
            <Box sx={{ position: "relative" }}>
              <Media fileId={slides[Math.min(viewIdx, slides.length - 1)]} natural />
              {slides.length > 1 && (
                <>
                  <IconButton size="small" onClick={() => setViewIdx((i) => (i - 1 + slides.length) % slides.length)}
                    sx={{ position: "absolute", top: "50%", left: 6, transform: "translateY(-50%)", color: "#fff", bgcolor: "rgba(0,0,0,0.5)", "&:hover": { bgcolor: "rgba(0,0,0,0.75)" } }}>
                    <ChevronLeftIcon />
                  </IconButton>
                  <IconButton size="small" onClick={() => setViewIdx((i) => (i + 1) % slides.length)}
                    sx={{ position: "absolute", top: "50%", right: 6, transform: "translateY(-50%)", color: "#fff", bgcolor: "rgba(0,0,0,0.5)", "&:hover": { bgcolor: "rgba(0,0,0,0.75)" } }}>
                    <ChevronRightIcon />
                  </IconButton>
                  <Box sx={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", px: 1, py: 0.25, borderRadius: 5, bgcolor: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 11, fontWeight: 700 }}>
                    {Math.min(viewIdx, slides.length - 1) + 1} / {slides.length}
                  </Box>
                </>
              )}
            </Box>
          ) : (
            <Media fileId={fileId || coverId || slides[0]} capaId={coverId} natural
              streamUrl={item.media_url} ehVideoDica={pecaEhVideo(item) && fileId === item.file_id} />
          )}

          {isCarousel ? (
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Slides do carrossel, na ordem em que o cliente vai deslizar.
                A <b>capa é sempre a 1ª</b> — é ela que aparece no perfil e na prévia do feed.
                Para trocar a capa, use as setas e ponha outra slide na frente.
              </Typography>
              <Stack direction="row" spacing={1.25} sx={{ overflowX: "auto", pb: 0.5 }}>
                {slides.map((id, i) => (
                  <Box key={id} sx={{ width: 84, flex: "0 0 auto" }}>
                    <Box sx={{ position: "relative" }}>
                      <Box sx={{ borderRadius: 1, overflow: "hidden", border: 2, borderColor: i === 0 ? "primary.main" : "divider" }}>
                        <Media fileId={id} height={110} comecoDaTira={isCarousel} />
                      </Box>
                      <Chip size="small" color={i === 0 ? "primary" : "default"}
                        label={i === 0 ? "★ capa" : i + 1}
                        sx={{ position: "absolute", top: 3, left: 3, height: 18, fontSize: 10, fontWeight: 700,
                              bgcolor: i === 0 ? undefined : "rgba(0,0,0,0.6)", color: i === 0 ? undefined : "#fff",
                              "& .MuiChip-label": { px: 0.7 } }} />
                      <IconButton size="small" onClick={() => removeSlide(id)} title="Tirar esta slide"
                        sx={{ position: "absolute", top: 0, right: 0, p: 0.25, color: "#fff", bgcolor: "rgba(0,0,0,0.5)", "&:hover": { bgcolor: "error.main" } }}>
                        <Typography sx={{ fontSize: 13, lineHeight: 1, fontWeight: 700 }}>×</Typography>
                      </IconButton>
                    </Box>
                    <Stack direction="row" justifyContent="center" alignItems="center" sx={{ mt: 0.25 }}>
                      <IconButton size="small" sx={{ p: 0.25 }} disabled={i === 0}
                        onClick={() => moveSlide(i, -1)} title="Mover para trás">
                        <ChevronLeftIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                      <IconButton size="small" sx={{ p: 0.25 }} disabled={i === slides.length - 1}
                        onClick={() => moveSlide(i, 1)} title="Mover para a frente">
                        <ChevronRightIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Stack>
                  </Box>
                ))}
                {!slides.length && <Typography variant="caption" color="text.disabled" sx={{ py: 2 }}>Nenhuma slide ainda — adicione abaixo.</Typography>}
              </Stack>
              <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                <Button component="label" variant="outlined" startIcon={<UploadIcon />} disabled={slideUploading} size="small" sx={{ flex: 1 }}>
                  {slideUploading ? "Enviando..." : "+ Slide"}
                  <input type="file" hidden accept="image/*,video/*" onChange={uploadSlide} />
                </Button>
                <Button variant="outlined" startIcon={<PhotoLibraryIcon />} size="small" sx={{ flex: 1 }}
                  onClick={() => setSlidePicker(true)} disabled={!item.client_id}>
                  + Da galeria
                </Button>
              </Stack>
              {/* Carrossel antigo que veio como UMA arte larga → cortar em slides.
                  Aparece quando ainda há no máximo 1 slide (a tira inteira). */}
              {slides.length <= 1 && (fileId || slides[0]) && (
                <Button fullWidth variant="text" size="small" startIcon={<GridOnIcon />}
                  disabled={slideUploading} onClick={cortarArteExistente} sx={{ mt: 0.5 }}>
                  {slideUploading ? "Cortando…" : "Cortar arte larga em slides"}
                </Button>
              )}
            </Box>
          ) : (
            <>
              <Stack direction="row" spacing={1}>
                <Button component="label" variant="outlined" startIcon={<UploadIcon />} disabled={uploading} size="small" sx={{ flex: 1 }}>
                  {uploading ? "Enviando..." : "Subir"}
                  <input type="file" hidden accept="image/*,video/*" onChange={upload} />
                </Button>
                <Button variant="outlined" startIcon={<PhotoLibraryIcon />} size="small" sx={{ flex: 1 }}
                  onClick={() => setPicker(true)} disabled={!item.client_id}>
                  Da galeria
                </Button>
              </Stack>

              <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                <Button variant="text" startIcon={<StarIcon />} size="small" onClick={() => setCoverPicker(true)}
                  disabled={!item.client_id}>
                  {coverId ? "Trocar capa" : "Definir capa (foto)"}
                </Button>
                {fileId && (
                  <Button variant="text" size="small" onClick={() => setVideoCover(true)} disabled={!item.client_id}>
                    Escolher capa do vídeo
                  </Button>
                )}
              </Stack>
            </>
          )}

          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">Legenda</Typography>
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                <Button size="small" startIcon={<AutoAwesomeIcon />} onClick={gerarLegendaIA}
                  disabled={!item.client_id || iaLegenda}>
                  {iaLegenda ? "Gerando…" : "Gerar com IA"}
                </Button>
                <Button size="small" startIcon={<DescriptionIcon />} onClick={() => setPlanRef(true)} disabled={!item.client_id}>
                  Do planejamento
                </Button>
              </Stack>
            </Stack>
            <TextField label="Legenda" multiline minRows={2} value={caption} onChange={(e) => setCaption(e.target.value)} fullWidth />
          </Box>
          <TextField label="Observação (interna)" multiline minRows={1} value={obs} onChange={(e) => setObs(e.target.value)} fullWidth />
          <TextField label="Data e hora" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
            fullWidth InputLabelProps={{ shrink: true }} />

          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => save(false)} disabled={saving}>Salvar</Button>
            <Button variant="contained" startIcon={<SendIcon />} onClick={send} disabled={sending || !canSend}>
              Enviar p/ aprovação
            </Button>
          </Stack>
          {item.client_phone && (
            <Button size="small" startIcon={<WhatsAppIcon />} sx={{ color: "#25D366", alignSelf: "flex-start" }}
              onClick={() => window.open(whatsappLink(item.client_phone,
                `Oi! Preparei um conteúdo novo pra você aprovar. É só entrar na sua área do cliente 🙂`), "_blank")}>
              Avisar no WhatsApp
            </Button>
          )}

          {/* Postar manual — aparece quando o cliente já aprovou. Ideal pros
              Reels com música do Edits, que precisam ser postados no app. */}
          {item.approval_status === "approved" && (
            <>
              <Divider sx={{ my: 0.5 }}>Publicar no Instagram</Divider>
              {posted ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip color="success" icon={<CheckCircleIcon sx={{ fontSize: 16 }} />} label="Postado ✓" />
                  <Button size="small" color="inherit" onClick={() => marcarPostado(false)}>desfazer</Button>
                </Stack>
              ) : (
                <>
                  <Typography variant="caption" color="text.secondary">
                    Reels com música do Edits: baixe/abra o vídeo, monte a música no Edits e poste. Depois marque como postado aqui.
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                    <Button size="small" variant="outlined" startIcon={<DownloadIcon />}
                      disabled={baixando} onClick={baixarOuCompartilhar}>
                      {baixando ? "Preparando…" : "Baixar / abrir vídeo"}
                    </Button>
                    <Button size="small" variant="outlined" startIcon={<ContentCopyIcon />}
                      disabled={!caption} onClick={copiarLegenda}>Copiar legenda</Button>
                    <Button size="small" variant="contained" startIcon={<CheckCircleIcon />}
                      onClick={() => marcarPostado(true)}>Marquei como postado</Button>
                  </Stack>
                </>
              )}
            </>
          )}

          <GalleryPicker clientId={item.client_id} open={picker} onClose={() => setPicker(false)} onPick={pickFromGallery} />
          <GalleryPicker clientId={item.client_id} open={coverPicker} onClose={() => setCoverPicker(false)}
            onPick={setCover} titulo="Escolher a capa do perfil (uma foto)" />
          <GalleryPicker clientId={item.client_id} open={slidePicker} onClose={() => setSlidePicker(false)}
            onPick={addSlide} titulo="Adicionar slide ao carrossel" />
          <VideoCoverDialog fileId={fileId} streamUrl={fileId === item.file_id ? item.media_url : null}
            clientId={item.client_id} open={videoCover}
            onClose={() => setVideoCover(false)} onCaptured={setCover} flash={flash} />
          <PlanningRefDialog clientId={item.client_id} ym={ymOf(when || item.scheduled_at)}
            open={planRef} onClose={() => setPlanRef(false)}
            onUse={(txt) => { setCaption(txt); flash("Legenda trazida do planejamento. Ajuste e salve.", "success"); }} />

          {/* Fatiar carrossel: a arte é mais larga que uma slide → pergunta em
              quantas partes cortar (cada uma vira uma slide, na ordem). */}
          <Dialog open={Boolean(slicer)} onClose={() => !slideUploading && setSlicer(null)} fullWidth maxWidth="xs">
            <DialogTitle>Cortar em carrossel</DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Essa arte tem <b>{slicer?.largura}px</b> de largura — dá para cortar em várias slides
                de <b>~1080px</b>. Em quantas partes você quer dividir? A 1ª vira a capa, e no card você
                desliza pelas slides com a setinha.
              </Typography>
              <TextField type="number" label="Quantas slides" fullWidth autoFocus
                value={slicer?.n ?? 2}
                onChange={(e) => setSlicer((s) => s && ({ ...s, n: Math.max(2, Math.min(20, Number(e.target.value) || 2)) }))}
                inputProps={{ min: 2, max: 20 }} />
              {slicer && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                  Cada slide fica com ~{Math.round(slicer.largura / (slicer.n || 2))}px de largura.
                </Typography>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSlicer(null)} disabled={slideUploading}>Cancelar</Button>
              {/* "Manter inteira" só faz sentido ao SUBIR uma arte nova; para
                  arte que já está na peça, manter inteira é simplesmente cancelar. */}
              {!slicer?.substituir && (
                <Button variant="outlined" disabled={slideUploading}
                  onClick={async () => { const f = slicer.file; setSlicer(null); setSlideUploading(true);
                    try { const id = await subirArquivo(f); if (id) saveSlides([...slides, id]); }
                    catch (err) { flash(err.response?.data?.error || "Falha no upload.", "error"); }
                    setSlideUploading(false); }}>
                  Manter inteira
                </Button>
              )}
              <Button variant="contained" onClick={confirmarFatiar} disabled={slideUploading}>
                {slideUploading ? "Cortando…" : `Cortar em ${slicer?.n ?? 2}`}
              </Button>
            </DialogActions>
          </Dialog>
        </Stack>
      </CardContent>
    </Card>
  );
}

// Legenda das bolinhas de status (aparece no topo da Lista).
function StatusLegend() {
  return (
    <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 0.5, mb: 1 }}>
      {Object.values(STATUS).map((s) => (
        <Stack key={s.label} direction="row" spacing={0.5} alignItems="center">
          <Box sx={{ width: 11, height: 11, borderRadius: "50%", bgcolor: s.color }} />
          <Typography variant="caption" color="text.secondary">{s.label}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

// Visão em lista: uma linha por peça, com bolinha de status à direita.
// clique abre o editor; no modo seleção, marca para enviar p/ aprovação.
function ListView({ items, onSelect, selectMode, checked, onToggle }) {
  return (
    <Stack spacing={1}>
      {items.map((it) => {
        const ct = CONTENT_TYPES[it.content_type];
        const st = statusOf(it);
        const marcavel = st === "nao_enviado" && it.scheduled_at; // só o "laranja" pode ser enviado
        const marcada = checked?.has(it.id);
        return (
          <Card key={it.id} sx={selectMode && marcada ? { outline: "2px solid", outlineColor: "primary.main" } : undefined}>
            <Box sx={{ display: "flex", gap: 1.5, p: 1, alignItems: "center" }}>
              {selectMode && (
                <Checkbox size="small" checked={!!marcada} disabled={!marcavel}
                  onChange={() => onToggle(it.id)} sx={{ p: 0.5 }} />
              )}
              <Box onClick={selectMode ? (marcavel ? () => onToggle(it.id) : undefined) : () => onSelect(it)}
                sx={{ display: "flex", gap: 1.5, flex: 1, minWidth: 0, alignItems: "center", cursor: selectMode ? (marcavel ? "pointer" : "default") : "pointer", "&:hover": { bgcolor: selectMode && !marcavel ? "transparent" : "action.hover" }, borderRadius: 1 }}>
                <Box sx={{ width: 56, height: 56, flexShrink: 0 }}><Media fileId={it.cover_file_id || it.file_id} height={56}
                    comecoDaTira={it.content_type === "carrossel"} /></Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
                    {ct && <Chip size="small" color="primary" variant="outlined" label={`${ct.emoji} ${ct.label}`} />}
                    {it.client_name && <Chip size="small" variant="outlined" label={it.client_name} />}
                  </Stack>
                  <Typography sx={{ fontWeight: 600, mt: 0.3 }} noWrap>{it.title}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {it.scheduled_at ? new Date(it.scheduled_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Sem data"}
                  </Typography>
                </Box>
                <StatusDot status={st} />
              </Box>
            </Box>
          </Card>
        );
      })}
    </Stack>
  );
}

// Visão em calendário: grade do mês com miniaturas.
// ---------------------------------------------------------------------------
// Separado POR MÊS. Filtrando por empresa, a lista vira o ano inteiro de
// conteúdo dela — sem as divisórias de mês não dá para achar nada.
// ---------------------------------------------------------------------------
function agrupaPorMes(itens) {
  const grupos = new Map();
  const semData = [];
  for (const it of itens) {
    if (!it.scheduled_at) { semData.push(it); continue; }
    const d = new Date(it.scheduled_at.replace(" ", "T"));
    if (Number.isNaN(d.getTime())) { semData.push(it); continue; }
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!grupos.has(chave)) {
      grupos.set(chave, { rotulo: `${MONTHS[d.getMonth()]} de ${d.getFullYear()}`, itens: [] });
    }
    grupos.get(chave).itens.push(it);
  }
  const ordenados = [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => g);
  // Sem data fica por último: é o que ainda falta resolver, não o que vem antes.
  if (semData.length) ordenados.push({ rotulo: "Sem data marcada", itens: semData, semData: true });
  return ordenados;
}

const GRADE = { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" }, gap: 2, alignItems: "start" };

/** Desenha os itens em blocos de mês. `children` é como cada item vira cartão. */
function PorMes({ itens, children }) {
  const grupos = agrupaPorMes(itens);
  if (grupos.length <= 1) return <Box sx={GRADE}>{itens.map(children)}</Box>;
  return (
    <Stack spacing={3}>
      {grupos.map((g) => (
        <Box key={g.rotulo}>
          <Divider textAlign="left" sx={{ mb: 1.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: .5 }}
              color={g.semData ? "error.main" : "primary.main"}>
              {g.rotulo} · {g.itens.length}
            </Typography>
          </Divider>
          <Box sx={GRADE}>{g.itens.map(children)}</Box>
        </Box>
      ))}
    </Stack>
  );
}

function MonthGrid({ items, onSelect }) {
  const [cursor, setCursor] = useState(() => new Date());
  const byDay = useMemo(() => {
    const map = {};
    items.forEach((it) => {
      if (!it.scheduled_at) return;
      const d = new Date(it.scheduled_at.replace(" ", "T"));
      if (d.getFullYear() === cursor.getFullYear() && d.getMonth() === cursor.getMonth()) {
        (map[d.getDate()] ||= []).push(it);
      }
    });
    return map;
  }, [items, cursor]);

  const grid = useMemo(() => {
    const y = cursor.getFullYear(), m = cursor.getMonth();
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="center" spacing={2} sx={{ mb: 2 }}>
        <IconButton onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}><ChevronLeftIcon /></IconButton>
        <Typography variant="h6" sx={{ minWidth: 190, textAlign: "center" }}>{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</Typography>
        <IconButton onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}><ChevronRightIcon /></IconButton>
      </Stack>
      <Card>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: 1, borderColor: "divider" }}>
          {WEEKDAYS.map((w) => (
            <Typography key={w} variant="caption" sx={{ p: 1, textAlign: "center", fontWeight: 700, color: "text.secondary" }}>{w}</Typography>
          ))}
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {grid.map((day, i) => (
            <Box key={i} sx={{ minHeight: 118, p: 0.5, borderRight: (i + 1) % 7 !== 0 ? 1 : 0, borderBottom: i < grid.length - 7 ? 1 : 0, borderColor: "divider" }}>
              {day && (
                <>
                  <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>{day}</Typography>
                  <Stack spacing={0.5} sx={{ mt: 0.4 }}>
                    {(byDay[day] || []).slice(0, 2).map((it) => (
                      <Box key={it.id} onClick={() => onSelect(it)} sx={{ cursor: "pointer", borderRadius: 1, overflow: "hidden", border: 1, borderColor: "divider", "&:hover": { borderColor: "primary.main" } }}>
                        <Box sx={{ position: "relative", aspectRatio: "1" }}>
                          <Media fileId={it.cover_file_id || it.file_id} height="100%"
                            comecoDaTira={it.content_type === "carrossel"} />
                          <Box sx={{ position: "absolute", left: 3, bottom: 3, px: 0.5, borderRadius: 0.5, bgcolor: "rgba(0,0,0,0.62)", color: "#fff", fontSize: 10, fontWeight: 700 }}>
                            {formatTime(it.scheduled_at)}
                          </Box>
                        </Box>
                      </Box>
                    ))}
                    {(byDay[day] || []).length > 2 && (
                      <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5 }}>+{byDay[day].length - 2} mais</Typography>
                    )}
                  </Stack>
                </>
              )}
            </Box>
          ))}
        </Box>
      </Card>
    </>
  );
}

// Miniatura da grade do perfil. Ordem: a miniatura leve (foto ou quadro do
// vídeo); se o arquivo não tiver miniatura, cai na arte inteira — e aí VÍDEO é
// desenhado com <video> mostrando o 1º quadro, porque <img> não toca vídeo (era
// por isso que os vídeos não apareciam aqui).
function FeedThumb({ fileId, comecoDaTira = false }) {
  const [thumb, setThumb] = useState(null);
  const [midia, setMidia] = useState(null);   // { url, type } quando não há miniatura
  const [erro, setErro] = useState(false);

  useEffect(() => {
    setThumb(null); setMidia(null); setErro(false);
    if (!fileId) return;
    let alive = true;
    loadThumb(fileId).then((t) => {
      if (!alive) return;
      if (t) { setThumb(t); return; }
      loadMedia(fileId)
        .then((m) => { if (alive && m) setMidia(m); })
        .catch(() => { if (alive) setErro(true); });
    });
    return () => { alive = false; };  // não revoga: o cache é dono da URL
  }, [fileId]);

  // Carrossel salvo como UMA imagem larga: a capa é o começo da tira (os
  // primeiros 1080px da esquerda), nunca o meio. Ver FeedPreview.jsx.
  const sx = {
    width: "100%", height: "100%", objectFit: "cover", display: "block",
    objectPosition: comecoDaTira ? "left center" : "center",
  };
  const vazio = (texto, cor = "text.disabled") => (
    <Box sx={{ width: "100%", height: "100%", display: "grid", placeItems: "center", textAlign: "center",
               color: cor, fontSize: 10, lineHeight: 1.2, p: 0.5 }}>{texto}</Box>
  );

  if (erro) return vazio("arte não carregou", "error.main");
  if (thumb) return <Box component="img" src={thumb} alt="" sx={sx} onError={() => setErro(true)} />;
  if (!midia) return vazio("sem arte");
  if ((midia.type || "").startsWith("video")) {
    // preload="metadata" + #t=0.1 = mostra o 1º quadro sem baixar o vídeo todo.
    // E aproveita esse quadro para guardar a miniatura: da próxima vez esta
    // grade nem toca no vídeo.
    return <Box component="video" src={`${midia.url}#t=0.1`} preload="metadata" muted playsInline
      sx={{ ...sx, bgcolor: "#000" }} onError={() => setErro(true)}
      onLoadedData={(e) => guardarMiniatura(fileId, e.currentTarget)} />;
  }
  return <Box component="img" src={midia.url} alt="" sx={sx} onError={() => setErro(true)}
    onLoad={(e) => guardarMiniatura(fileId, e.currentTarget)} />;
}

const dtISO = (v) => (v ? new Date(v.replace(" ", "T")) : null);

// Prévia do perfil ARRASTÁVEL: organiza o feed (salva a ORDEM). As datas ficam
// paradas — cada peça mantém a sua. Sem data ou no passado aparece em vermelho
// (clique para ajustar). O 1º fica em cima à esquerda; enche → direita → baixo.
function ReorderableFeed({ posts, fetchFile, onSelect, onReorder, titulo }) {
  // O PERFIL só tem o que já existe. Peça sem arte não é um quadrado cinza no
  // Instagram — ela simplesmente não está lá. Deixá-la na grade dava um perfil
  // falso, cheio de buracos que ninguém vai ver.
  const comArte = useMemo(() => posts.filter((p) => p.cover_file_id || p.file_id), [posts]);
  const semArte = posts.length - comArte.length;
  const [order, setOrder] = useState(comArte);
  const [dragId, setDragId] = useState(null); // qual peça está sendo arrastada
  const dragIndex = useRef(null);
  const movedRef = useRef(false);
  // Só ressincroniza com o servidor quando NÃO está arrastando (evita "pulo").
  useEffect(() => { if (dragIndex.current == null) setOrder(comArte); }, [comArte]);

  const now = Date.now();
  const errada = (p) => { const d = dtISO(p.scheduled_at); return !d || d.getTime() < now; };

  // Ao passar por cima de outro quadrado, já reencaixa ao vivo (os outros se
  // ajustam na hora). No fim (soltar) só salva a ordem — sem recarregar a tela.
  function onEnter(i) {
    const from = dragIndex.current;
    if (from == null || from === i) return;
    setOrder((arr) => {
      const next = [...arr];
      const [m] = next.splice(from, 1);
      next.splice(i, 0, m);
      return next;
    });
    dragIndex.current = i;
    movedRef.current = true;
  }
  function fim() {
    dragIndex.current = null;
    setDragId(null);
    if (movedRef.current) { movedRef.current = false; onReorder(order.map((p) => p.id)); }
  }

  if (!comArte.length) {
    return <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
      {posts.length
        ? `${posts.length} peça(s) ainda sem arte — o perfil aparece aqui assim que você anexar a primeira.`
        : "Nada por aqui ainda. As peças que estiverem na Distribuição aparecem aqui para organizar."}
    </Typography>;
  }

  return (
    <Box>
      <Typography variant="subtitle2">{titulo}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
        O mais recente em cima à esquerda, como no perfil. Arraste para organizar (encaixa entre um e
        outro) — a ordem fica salva e as datas não mudam. Em vermelho = sem data ou no passado
        (clique para ajustar).
        {semArte > 0 && ` ${semArte} peça(s) ainda sem arte ficam de fora daqui.`}
      </Typography>
      <Box sx={{ maxWidth: 380, mx: "auto", border: 1, borderColor: "divider", borderRadius: 0, overflow: "hidden" }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px", bgcolor: "divider" }}>
          {order.map((p, i) => (
            <Box key={p.id} draggable
              onDragStart={() => { dragIndex.current = i; movedRef.current = false; setDragId(p.id); }}
              onDragEnter={() => onEnter(i)}
              onDragOver={(e) => e.preventDefault()}
              onDragEnd={fim}
              onDrop={(e) => { e.preventDefault(); fim(); }}
              onClick={() => onSelect(p)}
              sx={{
                position: "relative", aspectRatio: "1080 / 1440", cursor: "grab", bgcolor: "action.hover", overflow: "hidden",
                opacity: dragId === p.id ? 0.35 : 1, transition: "opacity .12s ease",
                outline: errada(p) ? "2px solid" : "none", outlineColor: "error.main", outlineOffset: "-2px",
              }}>
              <FeedThumb fileId={p.cover_file_id || p.file_id} fetchFile={fetchFile}
                comecoDaTira={p.content_type === "carrossel"} />
              <Box sx={{
                position: "absolute", bottom: 0, left: 0, right: 0, px: 0.5, py: 0.25,
                bgcolor: errada(p) ? "error.main" : "rgba(0,0,0,0.6)", color: "#fff", fontSize: 10, fontWeight: 700,
              }}>
                {p.scheduled_at ? dtISO(p.scheduled_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "sem data"}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

export default function Distribution() {
  const [clients, setClients] = useState([]);
  const [clientFilter, setClientFilter] = useState("");
  const [items, setItems] = useState([]);
  const [scheduled, setScheduled] = useState([]); // panorama completo (calendário)
  const [stage, setStage] = useState(null);
  const [loading, setLoading] = useState(true);
  const loadedOnce = useRef(false);
  const [msg, setMsg] = useState(null);
  const [view, setView] = useState("post"); // post | list | feed | calendar
  const [selected, setSelected] = useState(null); // peça no editor (lista/perfil/calendário)
  const [selectMode, setSelectMode] = useState(false); // seleção múltipla na visão "Por post"
  const [checked, setChecked] = useState(() => new Set()); // ids marcados
  const [sendingBulk, setSendingBulk] = useState(false);
  const [approved, setApproved] = useState([]); // aprovados aguardando programação
  const [programmed, setProgrammed] = useState([]); // já programados
  const [waiting, setWaiting] = useState([]);   // enviados, esperando o cliente aprovar
  const [postFilter, setPostFilter] = useState("para_aprovar"); // para_aprovar | aprovados | programados

  const flash = (texto, tipo = "success") => { setMsg({ texto, tipo }); setTimeout(() => setMsg(null), 4000); };
  const fetchFile = useCallback((id) => api.get(`/files/${id}/download`, { responseType: "blob" }).then((r) => r.data), []);

  useEffect(() => { api.get("/clients").then((r) => setClients(r.data)).catch(() => {}); }, []);

  const vTasks = useLiveVersion("tasks");
  const vDist = useLiveVersion("distribution");
  const load = (opts = {}) => {
    // Só mostra o spinner de tela cheia na 1ª carga. Recargas de fundo (SSE,
    // reorganizar) atualizam sem piscar — o feed fica liso.
    if (!loadedOnce.current && !opts.silent) setLoading(true);
    const params = clientFilter ? { client_id: clientFilter } : {};
    api.get("/distribution", { params })
      .then((r) => { setItems(r.data.items || []); setScheduled(r.data.scheduled || []); setApproved(r.data.approved || []); setProgrammed(r.data.programmed || []); setWaiting(r.data.waiting || []); setStage(r.data.stage); })
      .catch(() => { setItems([]); setScheduled([]); setApproved([]); setProgrammed([]); setWaiting([]); })
      .finally(() => { setLoading(false); loadedOnce.current = true; });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [clientFilter, vTasks, vDist]);

  // Organiza o feed salvando SÓ a ordem (posição) — as datas ficam paradas.
  async function reorderPosition(ids) {
    // A ordem já foi aplicada na tela (otimista). Só persiste — sem recarregar,
    // pra não piscar. A sincronização entre telas vem pelo SSE, silenciosa.
    try {
      await api.post("/distribution/reorder-position", { ids });
    } catch (e) {
      flash(e.response?.data?.error || "Não foi possível organizar.", "error");
      load({ silent: true });
    }
  }

  async function programar(it) {
    try { await api.post(`/distribution/${it.id}/schedule`); flash("Programado! ✅", "success"); load(); }
    catch (e) { flash(e.response?.data?.error || "Não foi possível programar.", "error"); }
  }

  function toggleCheck(id) {
    setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function sairDaSelecao() { setSelectMode(false); setChecked(new Set()); }

  // Envia todas as peças marcadas para aprovação (uma a uma). Cada peça precisa
  // ter mídia e data; as que não tiverem são reportadas.
  async function enviarSelecionadas() {
    const ids = [...checked];
    if (!ids.length) return;
    setSendingBulk(true);
    let ok = 0; const falhas = [];
    for (const id of ids) {
      try { await api.post(`/distribution/${id}/send`); ok++; }
      catch (e) {
        const it = [...items, ...scheduled].find((i) => i.id === id);
        falhas.push(`${it?.title || id}: ${e.response?.data?.error || "erro"}`);
      }
    }
    setSendingBulk(false);
    sairDaSelecao();
    load();
    if (falhas.length) flash(`${ok} enviada(s). ${falhas.length} não foram: ${falhas.join(" · ")}`, "error");
    else flash(`${ok} peça(s) enviadas para aprovação. ✅`, "success");
  }

  // Quando algo muda ao vivo, reflete na peça aberta no editor.
  const selectedFresh = selected ? items.find((i) => i.id === selected.id) || selected : null;

  // Prévia do perfil: junta tudo (com ou SEM data) — programados, aprovados e as
  // peças em preparação — para organizar o feed arrastando. Ordena pela POSIÇÃO
  // salva (o que você arrumou); sem posição, mais recente primeiro.
  const feedPosts = useMemo(() => {
    const map = new Map();
    [...scheduled, ...approved, ...items].forEach((i) => {
      if (!map.has(i.id)) map.set(i.id, { ...i, file_id: i.cover_file_id || i.file_id });
    });
    return [...map.values()].sort((a, b) => {
      const pa = a.position ?? 1e9, pb = b.position ?? 1e9;
      if (pa !== pb) return pa - pb;
      return (b.scheduled_at || "") > (a.scheduled_at || "") ? 1 : -1;
    });
  }, [scheduled, approved, items]);

  // Um perfil é de UM cliente. Sem filtro ("Todas"), agrupa por cliente para
  // mostrar um grid separado por empresa (em vez de misturar todo mundo num só).
  const feedGroups = useMemo(() => {
    const m = new Map();
    feedPosts.forEach((p) => {
      const k = p.client_id ?? "sem";
      if (!m.has(k)) m.set(k, { clientId: k, clientName: p.client_name || "Sem cliente", posts: [] });
      m.get(k).posts.push(p);
    });
    return [...m.values()].sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR"));
  }, [feedPosts]);

  return (
    <>
      <PageHeader title="Distribuição" subtitle="Prepare as peças, programe e veja o calendário do que vai ao ar"
        action={
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: "wrap", gap: 1 }}>
            <TextField select size="small" label="Empresa" value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">Todas</MenuItem>
              {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
              <ToggleButton value="post" aria-label="Por post"><ViewModuleIcon fontSize="small" /></ToggleButton>
              <ToggleButton value="list" aria-label="Lista"><ViewListIcon fontSize="small" /></ToggleButton>
              <ToggleButton value="feed" aria-label="Perfil"><GridOnIcon fontSize="small" /></ToggleButton>
              <ToggleButton value="calendar" aria-label="Calendário"><CalendarViewMonthIcon fontSize="small" /></ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        } />

      {msg && <Alert severity={msg.tipo} sx={{ mb: 2 }}>{msg.texto}</Alert>}

      {!stage && !loading ? (
        <EmptyState message="Crie uma etapa chamada 'Distribuição' no quadro de Tarefas para usar esta aba." />
      ) : loading ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 6 }}><CircularProgress /></Box>
      ) : view === "post" ? (
        <>
          {/* Filtro: para aprovar (preparar/enviar) x aprovados (programar) */}
          <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap", gap: 1 }} alignItems="center">
            <ToggleButtonGroup size="small" exclusive value={postFilter} onChange={(_, v) => v && setPostFilter(v)}
              sx={{ flexWrap: "wrap" }}>
              <ToggleButton value="para_aprovar">Preparar{items.length ? ` (${items.length})` : ""}</ToggleButton>
              <ToggleButton value="aguardando">Para aprovação{waiting.length ? ` (${waiting.length})` : ""}</ToggleButton>
              <ToggleButton value="aprovados">Aprovados{approved.length ? ` (${approved.length})` : ""}</ToggleButton>
              <ToggleButton value="programados">Programados{programmed.length ? ` (${programmed.length})` : ""}</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {postFilter === "programados" ? (
            programmed.length === 0 ? (
              <EmptyState message="Nada programado ainda. Quando você programa um conteúdo aprovado, ele aparece aqui." />
            ) : (
              <PorMes itens={programmed}>
                {(p) => {
                  const ct = CONTENT_TYPES[p.content_type];
                  return (
                    <Card key={p.id}>
                      <CardContent>
                        <Stack spacing={1}>
                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: "wrap", gap: 0.5 }}>
                            {ct && <Chip size="small" color="primary" label={`${ct.emoji} ${ct.label}`} />}
                            <Chip size="small" color="info" label="Programado 🗓️" />
                          </Stack>
                          {p.client_name && <Typography variant="caption" color="text.secondary">{p.client_name}</Typography>}
                          <Media fileId={p.file_id || p.cover_file_id} capaId={p.cover_file_id} natural
                            streamUrl={p.media_url} ehVideoDica={pecaEhVideo(p)} />
                          <Typography sx={{ fontWeight: 600 }} noWrap>{p.title}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {p.scheduled_at
                              ? new Date(p.scheduled_at.replace(" ", "T")).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
                              : "Sem data"}
                          </Typography>
                          <Stack direction="row" spacing={1}>
                            <Button size="small" variant="outlined" onClick={() => setSelected(p)}>Abrir</Button>
                          </Stack>
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                }}
              </PorMes>
            )
          ) : postFilter === "aguardando" ? (
            waiting.length === 0 ? (
              <EmptyState message="Nada esperando aprovação. O que você enviar para o cliente aparece aqui até ele responder." />
            ) : (
              <PorMes itens={waiting}>
                {(w) => {
                  const ct = CONTENT_TYPES[w.content_type];
                  const pediuAjuste = w.approval_status === "changes_requested";
                  return (
                    <Card key={w.id}>
                      <CardContent>
                        <Stack spacing={1}>
                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: "wrap", gap: 0.5 }}>
                            {ct && <Chip size="small" color="primary" label={`${ct.emoji} ${ct.label}`} />}
                            <Chip size="small" color={pediuAjuste ? "warning" : "info"}
                              label={pediuAjuste ? "Pediu ajuste ✏️" : "Com o cliente ⏳"} />
                          </Stack>
                          {w.client_name && <Typography variant="caption" color="text.secondary">{w.client_name}</Typography>}
                          <Media fileId={w.file_id || w.cover_file_id} capaId={w.cover_file_id} natural
                            streamUrl={w.media_url} ehVideoDica={pecaEhVideo(w)} />
                          <Typography sx={{ fontWeight: 600 }} noWrap>{w.title}</Typography>
                          <Typography variant="caption" color={w.scheduled_at ? "text.secondary" : "error.main"}>
                            {w.scheduled_at
                              ? new Date(w.scheduled_at.replace(" ", "T")).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
                              : "Sem data"}
                          </Typography>
                          {pediuAjuste && w.client_note && (
                            <Alert severity="warning" sx={{ py: 0.25 }}>
                              <Typography variant="caption">{w.client_note}</Typography>
                            </Alert>
                          )}
                          <Button size="small" variant="outlined" onClick={() => setSelected(w)}>Abrir</Button>
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                }}
              </PorMes>
            )
          ) : postFilter === "aprovados" ? (
            approved.length === 0 ? (
              <EmptyState message="Nada aprovado aguardando programação. Quando o cliente aprova, o conteúdo aparece aqui para programar." />
            ) : (
              <PorMes itens={approved}>
                {(a) => {
                  const ct = CONTENT_TYPES[a.content_type];
                  return (
                    <Card key={a.id}>
                      <CardContent>
                        <Stack spacing={1}>
                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: "wrap", gap: 0.5 }}>
                            {ct && <Chip size="small" color="primary" label={`${ct.emoji} ${ct.label}`} />}
                            <Chip size="small" color="success" label="Aprovado ✓" />
                          </Stack>
                          {a.client_name && <Typography variant="caption" color="text.secondary">{a.client_name}</Typography>}
                          <Media fileId={a.file_id || a.cover_file_id} capaId={a.cover_file_id} natural
                            streamUrl={a.media_url} ehVideoDica={pecaEhVideo(a)} />
                          <Typography sx={{ fontWeight: 600 }} noWrap>{a.title}</Typography>
                          <Typography variant="caption" color={a.scheduled_at ? "text.secondary" : "error.main"}>
                            {a.scheduled_at
                              ? new Date(a.scheduled_at.replace(" ", "T")).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
                              : "Sem data — edite antes de programar"}
                          </Typography>
                          <Stack direction="row" spacing={1}>
                            <Button size="small" variant="outlined" onClick={() => setSelected(a)}>Editar</Button>
                            <Button size="small" variant="contained" startIcon={<ScheduleSendIcon />}
                              disabled={!a.scheduled_at} onClick={() => programar(a)}>
                              Programar
                            </Button>
                          </Stack>
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                }}
              </PorMes>
            )
          ) : items.length === 0 ? (
            <EmptyState message="Nenhuma peça para preparar. Mova as tarefas prontas para a coluna 'Distribuição' no quadro de Tarefas." />
          ) : (
          <>
            {/* Barra de seleção: marcar várias peças e enviar de uma vez. */}
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: "wrap", gap: 1 }}>
              {!selectMode ? (
                <Button size="small" variant="outlined" startIcon={<CheckBoxIcon />} onClick={() => setSelectMode(true)}>
                  Selecionar para enviar
                </Button>
              ) : (
                <>
                  <Button size="small" color="inherit" onClick={sairDaSelecao}>Cancelar</Button>
                  <Button size="small" onClick={() => setChecked(new Set(items.map((i) => i.id)))}>Marcar todas</Button>
                  <Typography variant="body2" color="text.secondary">{checked.size} marcada(s)</Typography>
                  <Box sx={{ flex: 1 }} />
                  <Button size="small" variant="contained" startIcon={<SendIcon />}
                    disabled={sendingBulk || checked.size === 0} onClick={enviarSelecionadas}>
                    {sendingBulk ? "Enviando..." : `Enviar ${checked.size || ""} para aprovação`}
                  </Button>
                </>
              )}
            </Stack>
            <PorMes itens={items}>
              {(it) => (
                <Box key={it.id} sx={{ position: "relative" }}>
                  {selectMode && (
                    <Checkbox
                      checked={checked.has(it.id)}
                      onChange={() => toggleCheck(it.id)}
                      sx={{ position: "absolute", top: 4, right: 4, zIndex: 2, bgcolor: "background.paper", borderRadius: 1, "&:hover": { bgcolor: "background.paper" } }}
                    />
                  )}
                  <Box onClick={selectMode ? () => toggleCheck(it.id) : undefined}
                    sx={selectMode ? {
                      cursor: "pointer",
                      outline: checked.has(it.id) ? "2px solid" : "2px solid transparent",
                      outlineColor: "primary.main", borderRadius: 3,
                      "& *": { pointerEvents: "none" },
                    } : undefined}>
                    <PieceCard item={it} flash={flash} onChanged={load} />
                  </Box>
                </Box>
              )}
            </PorMes>
          </>
          )}
        </>
      ) : view === "list" ? (
        <>
          <StatusLegend />
          {/* Seleção também na Lista: marca as "laranja" (não enviadas) e manda de uma vez. */}
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: "wrap", gap: 1 }}>
            {!selectMode ? (
              <Button size="small" variant="outlined" startIcon={<CheckBoxIcon />} onClick={() => setSelectMode(true)}>
                Selecionar para enviar
              </Button>
            ) : (
              <>
                <Button size="small" color="inherit" onClick={sairDaSelecao}>Cancelar</Button>
                <Button size="small" onClick={() => setChecked(new Set(scheduled.filter((i) => statusOf(i) === "nao_enviado" && i.scheduled_at).map((i) => i.id)))}>
                  Marcar todas
                </Button>
                <Typography variant="body2" color="text.secondary">{checked.size} marcada(s)</Typography>
                <Box sx={{ flex: 1 }} />
                <Button size="small" variant="contained" startIcon={<SendIcon />}
                  disabled={sendingBulk || checked.size === 0} onClick={enviarSelecionadas}>
                  {sendingBulk ? "Enviando..." : `Enviar ${checked.size || ""} para aprovação`}
                </Button>
              </>
            )}
          </Stack>
          <ListView items={scheduled} onSelect={setSelected}
            selectMode={selectMode} checked={checked} onToggle={toggleCheck} />
        </>
      ) : view === "feed" ? (
        clientFilter ? (
          <Card><CardContent>
            <ReorderableFeed posts={feedPosts} onSelect={setSelected} onReorder={reorderPosition}
              titulo="Como o perfil vai ficar" />
          </CardContent></Card>
        ) : feedGroups.length === 0 ? (
          <Card><CardContent><Typography color="text.secondary">Nenhuma peça ainda.</Typography></CardContent></Card>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Cada empresa tem o seu perfil. Escolha uma empresa acima para focar em uma só.
            </Typography>
            {feedGroups.map((g) => (
              <Card key={g.clientId}><CardContent>
                <ReorderableFeed posts={g.posts} onSelect={setSelected} onReorder={reorderPosition}
                  titulo={`Perfil — ${g.clientName}`} />
              </CardContent></Card>
            ))}
          </Stack>
        )
      ) : (
        <MonthGrid items={scheduled} onSelect={setSelected} />
      )}

      {/* Editor aberto a partir da lista / perfil / calendário */}
      <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} fullWidth maxWidth="sm">
        <DialogTitle>Editar peça</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          {selectedFresh && (
            <PieceCard key={selectedFresh.id} item={selectedFresh} flash={flash}
              onChanged={() => { load(); setSelected(null); }} />
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setSelected(null)}>Fechar</Button></DialogActions>
      </Dialog>
    </>
  );
}
