import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Box, Card, CardContent, Typography, TextField, MenuItem, Button, Stack,
  Chip, Alert, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  ToggleButtonGroup, ToggleButton, IconButton, Divider,
} from "@mui/material";
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
import api from "../api/client.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import FeedPreview from "../components/FeedPreview.jsx";
import { CONTENT_TYPES, formatTime } from "../utils.js";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// data do banco "YYYY-MM-DD HH:MM" <-> input "YYYY-MM-DDTHH:MM"
const toInput = (v) => (v ? v.replace(" ", "T").slice(0, 16) : "");
const fromInput = (v) => (v ? v.replace("T", " ").slice(0, 16) : "");

// Mostra a arte (foto ou vídeo), carregada em alta qualidade.
function Media({ fileId, height = 200 }) {
  const [src, setSrc] = useState(null);
  const [video, setVideo] = useState(false);
  useEffect(() => {
    setSrc(null);
    if (!fileId) return;
    let url;
    api.get(`/files/${fileId}/download`, { responseType: "blob" })
      .then((r) => { url = URL.createObjectURL(r.data); setSrc(url); setVideo((r.data.type || "").startsWith("video")); })
      .catch(() => {});
    return () => url && URL.revokeObjectURL(url);
  }, [fileId]);
  const sx = { width: "100%", height, objectFit: "cover", borderRadius: 2, bgcolor: "action.hover", display: "block" };
  if (!fileId) return <Box sx={{ ...sx, display: "grid", placeItems: "center", color: "text.secondary", fontSize: 13 }}>Sem mídia</Box>;
  if (!src) return <Box sx={{ ...sx, display: "grid", placeItems: "center" }}><CircularProgress size={22} /></Box>;
  return video
    ? <Box component="video" src={src} controls={height > 120} muted sx={{ ...sx, objectFit: "contain", bgcolor: "#000" }} />
    : <Box component="img" src={src} alt="" sx={sx} />;
}

// Escolher um arquivo que já está na galeria de Arquivos daquele cliente.
function GalleryPicker({ clientId, open, onClose, onPick, titulo = "Selecionar da galeria de arquivos" }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !clientId) return;
    setLoading(true);
    api.get("/files", { params: { client_id: clientId, all: 1 } })
      .then((r) => setFiles((r.data || []).filter((f) => /^(image|video)\//.test(f.mime || ""))))
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, [open, clientId]);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{titulo}</DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ display: "grid", placeItems: "center", py: 4 }}><CircularProgress /></Box>
        ) : files.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            Nenhuma foto/vídeo deste cliente na galeria. Suba primeiro na aba Arquivos.
          </Typography>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 1.5, pt: 1 }}>
            {files.map((f) => (
              <Box key={f.id} onClick={() => { onPick(f.id); onClose(); }}
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
  const ct = CONTENT_TYPES[item.content_type];

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

          <Button variant="text" startIcon={<StarIcon />} size="small" onClick={() => setCoverPicker(true)}
            disabled={!item.client_id} sx={{ alignSelf: "flex-start" }}>
            {coverId ? "Trocar capa do perfil" : "Definir capa do perfil (opcional)"}
          </Button>

          <TextField label="Legenda" multiline minRows={2} value={caption} onChange={(e) => setCaption(e.target.value)} fullWidth />
          <TextField label="Observação (interna)" multiline minRows={1} value={obs} onChange={(e) => setObs(e.target.value)} fullWidth />
          <TextField label="Data e hora" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
            fullWidth InputLabelProps={{ shrink: true }} />

          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => save(false)} disabled={saving}>Salvar</Button>
            <Button variant="contained" startIcon={<SendIcon />} onClick={send} disabled={sending || !canSend}>
              Enviar p/ aprovação
            </Button>
          </Stack>

          <GalleryPicker clientId={item.client_id} open={picker} onClose={() => setPicker(false)} onPick={pickFromGallery} />
          <GalleryPicker clientId={item.client_id} open={coverPicker} onClose={() => setCoverPicker(false)}
            onPick={setCover} titulo="Escolher a capa do perfil (uma foto)" />
        </Stack>
      </CardContent>
    </Card>
  );
}

// Visão em lista: uma linha por peça, clique abre o editor.
function ListView({ items, onSelect }) {
  return (
    <Stack spacing={1}>
      {items.map((it) => {
        const ct = CONTENT_TYPES[it.content_type];
        return (
          <Card key={it.id}>
            <Box onClick={() => onSelect(it)} sx={{ display: "flex", gap: 1.5, p: 1, cursor: "pointer", alignItems: "center", "&:hover": { bgcolor: "action.hover" } }}>
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
                        <Box sx={{ position: "relative" }}>
                          <Media fileId={it.cover_file_id || it.file_id} height={44} />
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

export default function Distribution() {
  const [clients, setClients] = useState([]);
  const [clientFilter, setClientFilter] = useState("");
  const [items, setItems] = useState([]);
  const [stage, setStage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [view, setView] = useState("post"); // post | list | feed | calendar
  const [selected, setSelected] = useState(null); // peça no editor (lista/perfil/calendário)

  const flash = (texto, tipo = "success") => { setMsg({ texto, tipo }); setTimeout(() => setMsg(null), 4000); };
  const fetchFile = useCallback((id) => api.get(`/files/${id}/download`, { responseType: "blob" }).then((r) => r.data), []);

  useEffect(() => { api.get("/clients").then((r) => setClients(r.data)).catch(() => {}); }, []);

  const vTasks = useLiveVersion("tasks");
  const vDist = useLiveVersion("distribution");
  const load = () => {
    setLoading(true);
    const params = clientFilter ? { client_id: clientFilter } : {};
    api.get("/distribution", { params })
      .then((r) => { setItems(r.data.items || []); setStage(r.data.stage); })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [clientFilter, vTasks, vDist]);

  // Quando algo muda ao vivo, reflete na peça aberta no editor.
  const selectedFresh = selected ? items.find((i) => i.id === selected.id) || selected : null;

  const feedPosts = useMemo(
    () => items.filter((i) => i.scheduled_at)
      .map((i) => ({ ...i, file_id: i.cover_file_id || i.file_id }))
      .sort((a, b) => (b.scheduled_at > a.scheduled_at ? 1 : -1)),
    [items]
  );

  return (
    <>
      <PageHeader title="Distribuição" subtitle="Prepare cada peça e envie para o cliente aprovar"
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
      ) : items.length === 0 ? (
        <EmptyState message="Nenhuma peça na Distribuição ainda. Mova as tarefas prontas para a coluna 'Distribuição' no quadro de Tarefas." />
      ) : view === "post" ? (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" }, gap: 2, alignItems: "start" }}>
          {items.map((it) => <PieceCard key={it.id} item={it} flash={flash} onChanged={load} />)}
        </Box>
      ) : view === "list" ? (
        <ListView items={items} onSelect={setSelected} />
      ) : view === "feed" ? (
        <Card><CardContent>
          <FeedPreview posts={feedPosts} fetchFile={fetchFile} onSelect={setSelected}
            titulo={clientFilter ? "Como o perfil vai ficar" : "Prévia do perfil (todos os clientes)"} />
        </CardContent></Card>
      ) : (
        <MonthGrid items={items} onSelect={setSelected} />
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
