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
import api from "../api/client.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { CONTENT_TYPES, formatTime, whatsappLink } from "../utils.js";
import PlanningRefDialog from "../components/PlanningRefDialog.jsx";

// Cache de mídias por sessão: cada arquivo é baixado UMA vez e reaproveitado
// entre telas, filtros e re-renderizações. Antes cada componente rebaixava o
// blob e o revogava ao desmontar — trocar de visão/rolar recarregava tudo, o
// que deixava a Distribuição lenta. Aqui a URL do objeto vive enquanto a página
// estiver aberta (o cache é o dono; ninguém revoga).
const _mediaCache = new Map();    // fileId -> { url, type }
const _mediaInflight = new Map(); // fileId -> Promise<{url,type}>
function loadMedia(fileId) {
  if (!fileId) return Promise.resolve(null);
  if (_mediaCache.has(fileId)) return Promise.resolve(_mediaCache.get(fileId));
  if (_mediaInflight.has(fileId)) return _mediaInflight.get(fileId);
  const p = api.get(`/files/${fileId}/download`, { responseType: "blob" })
    .then((r) => {
      const v = { url: URL.createObjectURL(r.data), type: r.data.type || "" };
      _mediaCache.set(fileId, v); _mediaInflight.delete(fileId); return v;
    })
    .catch((e) => { _mediaInflight.delete(fileId); throw e; });
  _mediaInflight.set(fileId, p);
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
function Media({ fileId, height = 200 }) {
  const [src, setSrc] = useState(null);
  const [video, setVideo] = useState(false);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    setSrc(null); setErro(false);
    if (!fileId) return;
    let alive = true;
    loadMedia(fileId)
      .then((m) => { if (alive && m) { setSrc(m.url); setVideo((m.type || "").startsWith("video")); } })
      .catch(() => { if (alive) setErro(true); });
    return () => { alive = false; };  // não revoga: o cache é dono da URL
  }, [fileId]);
  const sx = { width: "100%", height, objectFit: "cover", borderRadius: 2, bgcolor: "action.hover", display: "block" };
  if (!fileId) return <Box sx={{ ...sx, display: "grid", placeItems: "center", textAlign: "center", color: "text.secondary", fontSize: height <= 90 ? 9 : 13, lineHeight: 1.1, p: 0.25 }}>Sem mídia</Box>;
  if (erro) return <Box sx={{ ...sx, display: "grid", placeItems: "center", textAlign: "center", color: "error.main", fontSize: height <= 90 ? 9 : 12, lineHeight: 1.15, p: 0.5 }}>Imagem não carregou<br/>(reenvie)</Box>;
  if (!src) return <Box sx={{ ...sx, display: "grid", placeItems: "center" }}><CircularProgress size={22} /></Box>;
  return video
    ? <Box component="video" src={src} controls={height > 120} muted sx={{ ...sx, objectFit: "contain", bgcolor: "#000" }} />
    : <Box component="img" src={src} alt="" sx={sx} />;
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
                <Media fileId={f.id} height={110} />
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

// Capturar um quadro do vídeo anexado e usá-lo como capa do perfil.
// Tudo no navegador (canvas) — não processa vídeo no servidor.
function VideoCoverDialog({ fileId, clientId, open, onClose, onCaptured, flash }) {
  const videoRef = useRef(null);
  const [src, setSrc] = useState(null);
  const [isVideo, setIsVideo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);
  useEffect(() => {
    if (!open || !fileId) { setSrc(null); setDur(0); setCur(0); return; }
    let alive = true;
    loadMedia(fileId)
      .then((m) => { if (alive && m) { setSrc(m.url); setIsVideo((m.type || "").startsWith("video")); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [open, fileId]);

  const fmt = (s) => {
    if (!Number.isFinite(s)) return "0:00";
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return `${m}:${String(ss).padStart(2, "0")}`;
  };
  // Arrasta a barra → move o vídeo pro instante escolhido (mostra o frame ao vivo).
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
          <Stack spacing={1}>
            <Box component="video" ref={videoRef} src={src} playsInline
              onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => setCur(e.currentTarget.currentTime || 0)}
              sx={{ width: "100%", maxHeight: 420, bgcolor: "#000", borderRadius: 2 }} />
            <Typography variant="caption" color="text.secondary">
              Arraste a barra até o momento do vídeo que você quer como capa — o quadro aparece acima.
            </Typography>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums", minWidth: 34 }}>{fmt(cur)}</Typography>
              <Slider size="small" min={0} max={dur || 0} step={0.05} value={Math.min(cur, dur || 0)}
                onChange={(_, v) => seek(Array.isArray(v) ? v[0] : v)} sx={{ flex: 1 }} disabled={!dur} />
              <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums", minWidth: 34 }}>{fmt(dur)}</Typography>
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="outlined" onClick={() => { const v = videoRef.current; if (v) v.paused ? v.play() : v.pause(); }}>
                Play / Pause
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
                (dá pra dar play pra achar o trecho e depois ajustar na barra)
              </Typography>
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
  const ct = CONTENT_TYPES[item.content_type];
  const isCarousel = item.content_type === "carrossel";

  async function saveSlides(next) {
    setSlides(next);
    if (next[0]) { setCoverId(next[0]); setFileId(next[0]); }
    try { await api.put(`/distribution/${item.id}`, { media_ids: next }); }
    catch (err) { flash(err.response?.data?.error || "Não foi possível salvar as slides.", "error"); }
  }
  const addSlide = (id) => { if (id && !slides.includes(id)) saveSlides([...slides, id]); };
  const removeSlide = (id) => saveSlides(slides.filter((s) => s !== id));
  const makeInitial = (id) => saveSlides([id, ...slides.filter((s) => s !== id)]);
  async function uploadSlide(e) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setSlideUploading(true);
    try {
      const fd = new FormData();
      fd.append("files", file);
      if (item.client_id) fd.append("client_id", item.client_id);
      fd.append("stage", "editados");
      const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      const newId = data?.[0]?.id;
      if (newId) saveSlides([...slides, newId]);
    } catch (err) { flash(err.response?.data?.error || "Falha no upload.", "error"); }
    setSlideUploading(false);
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

          <Media fileId={fileId} />

          {isCarousel ? (
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                Slides do carrossel — a primeira (★ inicial) é a capa que aparece no perfil.
              </Typography>
              <Stack direction="row" spacing={1} sx={{ overflowX: "auto", pb: 0.5 }}>
                {slides.map((id, i) => (
                  <Box key={id} sx={{ position: "relative", width: 74, flex: "0 0 auto" }}>
                    <Box sx={{ borderRadius: 1, overflow: "hidden", border: 2, borderColor: i === 0 ? "primary.main" : "divider" }}>
                      <Media fileId={id} height={98} />
                    </Box>
                    {i === 0
                      ? <Chip size="small" color="primary" label="★ inicial" sx={{ position: "absolute", top: 3, left: 3, height: 18, fontSize: 9, "& .MuiChip-label": { px: 0.6 } }} />
                      : <Button size="small" onClick={() => makeInitial(id)} sx={{ position: "absolute", bottom: 3, left: 3, minWidth: 0, px: 0.5, py: 0, fontSize: 9, lineHeight: 1.4, bgcolor: "rgba(0,0,0,0.55)", color: "#fff", "&:hover": { bgcolor: "rgba(0,0,0,0.75)" } }}>tornar inicial</Button>}
                    <IconButton size="small" onClick={() => removeSlide(id)} sx={{ position: "absolute", top: 0, right: 0, p: 0.25, color: "#fff", bgcolor: "rgba(0,0,0,0.5)", "&:hover": { bgcolor: "error.main" } }}>
                      <Typography sx={{ fontSize: 13, lineHeight: 1, fontWeight: 700 }}>×</Typography>
                    </IconButton>
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
              <Button size="small" startIcon={<DescriptionIcon />} onClick={() => setPlanRef(true)} disabled={!item.client_id}>
                Do planejamento
              </Button>
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

          <GalleryPicker clientId={item.client_id} open={picker} onClose={() => setPicker(false)} onPick={pickFromGallery} />
          <GalleryPicker clientId={item.client_id} open={coverPicker} onClose={() => setCoverPicker(false)}
            onPick={setCover} titulo="Escolher a capa do perfil (uma foto)" />
          <GalleryPicker clientId={item.client_id} open={slidePicker} onClose={() => setSlidePicker(false)}
            onPick={addSlide} titulo="Adicionar slide ao carrossel" />
          <VideoCoverDialog fileId={fileId} clientId={item.client_id} open={videoCover}
            onClose={() => setVideoCover(false)} onCaptured={setCover} flash={flash} />
          <PlanningRefDialog clientId={item.client_id} ym={ymOf(when || item.scheduled_at)}
            open={planRef} onClose={() => setPlanRef(false)}
            onUse={(txt) => { setCaption(txt); flash("Legenda trazida do planejamento. Ajuste e salve.", "success"); }} />
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
                <Box sx={{ width: 56, height: 56, flexShrink: 0 }}><Media fileId={it.cover_file_id || it.file_id} height={56} /></Box>
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
                          <Media fileId={it.cover_file_id || it.file_id} height="100%" />
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

// Miniatura da grade — usa o cache de mídia (baixa uma vez por sessão).
function FeedThumb({ fileId }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!fileId) { setSrc(null); return; }
    let alive = true;
    loadMedia(fileId).then((m) => { if (alive && m) setSrc(m.url); }).catch(() => {});
    return () => { alive = false; };  // não revoga: o cache é dono da URL
  }, [fileId]);
  if (!src) return <Box sx={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "text.disabled", fontSize: 10 }}>sem arte</Box>;
  return <Box component="img" src={src} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />;
}

const dtISO = (v) => (v ? new Date(v.replace(" ", "T")) : null);

// Prévia do perfil ARRASTÁVEL: organiza o feed (salva a ORDEM). As datas ficam
// paradas — cada peça mantém a sua. Sem data ou no passado aparece em vermelho
// (clique para ajustar). O 1º fica em cima à esquerda; enche → direita → baixo.
function ReorderableFeed({ posts, fetchFile, onSelect, onReorder, titulo }) {
  const [order, setOrder] = useState(posts);
  const [dragId, setDragId] = useState(null); // qual peça está sendo arrastada
  const dragIndex = useRef(null);
  const movedRef = useRef(false);
  // Só ressincroniza com o servidor quando NÃO está arrastando (evita "pulo").
  useEffect(() => { if (dragIndex.current == null) setOrder(posts); }, [posts]);

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

  if (!posts.length) {
    return <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
      Nada por aqui ainda. As peças que estiverem na Distribuição aparecem aqui para organizar.
    </Typography>;
  }

  return (
    <Box>
      <Typography variant="subtitle2">{titulo}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
        Arraste para organizar (encaixa entre um e outro) — a ordem fica salva e as datas não mudam.
        A data só aparece quando você coloca; em vermelho = sem data ou no passado (clique para ajustar).
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
              <FeedThumb fileId={p.cover_file_id || p.file_id} fetchFile={fetchFile} />
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
  const [postFilter, setPostFilter] = useState("para_aprovar"); // para_aprovar | aprovados

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
      .then((r) => { setItems(r.data.items || []); setScheduled(r.data.scheduled || []); setApproved(r.data.approved || []); setStage(r.data.stage); })
      .catch(() => { setItems([]); setScheduled([]); setApproved([]); })
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
            <ToggleButtonGroup size="small" exclusive value={postFilter} onChange={(_, v) => v && setPostFilter(v)}>
              <ToggleButton value="para_aprovar">Para aprovar{items.length ? ` (${items.length})` : ""}</ToggleButton>
              <ToggleButton value="aprovados">Aprovados{approved.length ? ` (${approved.length})` : ""}</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {postFilter === "aprovados" ? (
            approved.length === 0 ? (
              <EmptyState message="Nada aprovado aguardando programação. Quando o cliente aprova, o conteúdo aparece aqui para programar." />
            ) : (
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" }, gap: 2, alignItems: "start" }}>
                {approved.map((a) => {
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
                          <Media fileId={a.cover_file_id || a.file_id} height={150} />
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
                })}
              </Box>
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
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" }, gap: 2, alignItems: "start" }}>
              {items.map((it) => (
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
              ))}
            </Box>
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
