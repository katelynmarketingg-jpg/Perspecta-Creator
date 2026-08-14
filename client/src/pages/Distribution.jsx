import { useEffect, useState } from "react";
import {
  Box, Card, CardContent, Typography, TextField, MenuItem, Button, Stack,
  Chip, Alert, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import UploadIcon from "@mui/icons-material/Upload";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import api from "../api/client.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { CONTENT_TYPES } from "../utils.js";

// data do banco "YYYY-MM-DD HH:MM" <-> input "YYYY-MM-DDTHH:MM"
const toInput = (v) => (v ? v.replace(" ", "T").slice(0, 16) : "");
const fromInput = (v) => (v ? v.replace("T", " ").slice(0, 16) : "");

// Mostra a arte anexada (foto ou vídeo), carregada em alta qualidade.
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
function GalleryPicker({ clientId, open, onClose, onPick }) {
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
      <DialogTitle>Selecionar da galeria de arquivos</DialogTitle>
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
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [picker, setPicker] = useState(false);
  const ct = CONTENT_TYPES[item.content_type];

  async function pickFromGallery(id) {
    setFileId(id);
    try { await api.put(`/distribution/${item.id}`, { file_id: id }); }
    catch (err) { flash(err.response?.data?.error || "Não foi possível anexar.", "error"); }
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
      if (newId) {
        setFileId(newId);
        await api.put(`/distribution/${item.id}`, { file_id: newId });
      }
    } catch (err) { flash(err.response?.data?.error || "Falha no upload.", "error"); }
    setUploading(false);
  }

  async function save() {
    setSaving(true);
    try {
      await api.put(`/distribution/${item.id}`, { caption, description: obs, scheduled_at: fromInput(when) });
      flash("Salvo.", "success");
    } catch (err) { flash(err.response?.data?.error || "Não foi possível salvar.", "error"); }
    setSaving(false);
  }

  async function send() {
    setSending(true);
    try {
      // salva o que está na tela antes de enviar
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
          <GalleryPicker clientId={item.client_id} open={picker} onClose={() => setPicker(false)} onPick={pickFromGallery} />

          <TextField label="Legenda" multiline minRows={2} value={caption} onChange={(e) => setCaption(e.target.value)} fullWidth />
          <TextField label="Observação (interna)" multiline minRows={1} value={obs} onChange={(e) => setObs(e.target.value)} fullWidth />
          <TextField label="Data e hora" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
            fullWidth InputLabelProps={{ shrink: true }} />

          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={save} disabled={saving}>Salvar</Button>
            <Button variant="contained" startIcon={<SendIcon />} onClick={send} disabled={sending || !canSend}>
              Enviar p/ aprovação
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function Distribution() {
  const [clients, setClients] = useState([]);
  const [clientFilter, setClientFilter] = useState("");
  const [items, setItems] = useState([]);
  const [stage, setStage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);

  const flash = (texto, tipo = "success") => { setMsg({ texto, tipo }); setTimeout(() => setMsg(null), 4000); };

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

  return (
    <>
      <PageHeader title="Distribuição" subtitle="Prepare cada peça e envie para o cliente aprovar"
        action={
          <TextField select size="small" label="Empresa" value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)} sx={{ minWidth: 200 }}>
            <MenuItem value="">Todas</MenuItem>
            {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
        } />

      {msg && <Alert severity={msg.tipo} sx={{ mb: 2 }}>{msg.texto}</Alert>}

      {!stage && !loading ? (
        <EmptyState message="Crie uma etapa chamada 'Distribuição' no quadro de Tarefas para usar esta aba." />
      ) : loading ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 6 }}><CircularProgress /></Box>
      ) : items.length === 0 ? (
        <EmptyState message="Nenhuma peça na Distribuição ainda. Mova as tarefas prontas para a coluna 'Distribuição' no quadro de Tarefas." />
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" }, gap: 2, alignItems: "start" }}>
          {items.map((it) => <PieceCard key={it.id} item={it} flash={flash} onChanged={load} />)}
        </Box>
      )}
    </>
  );
}
