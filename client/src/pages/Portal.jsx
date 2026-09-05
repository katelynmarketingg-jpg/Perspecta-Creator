import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AppBar, Toolbar, Box, Container, Tabs, Tab, Badge, Card, CardContent,
  Typography, Chip, Button, Stack, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Divider, IconButton, Tooltip, Alert, Link,
  Checkbox, FormControlLabel, ToggleButtonGroup, ToggleButton, CircularProgress,
} from "@mui/material";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import FeedPreview from "../components/FeedPreview.jsx";
import PostComments from "../components/PostComments.jsx";
import Galeria from "../components/Galeria.jsx";
import { alpha } from "@mui/material/styles";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import EditNoteIcon from "@mui/icons-material/EditNote";
import LogoutIcon from "@mui/icons-material/Logout";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import PixIcon from "@mui/icons-material/Pix";
import LinkIcon from "@mui/icons-material/Link";
import DescriptionIcon from "@mui/icons-material/Description";
import portalApi from "../api/portal.js";
import { currency, formatDate, formatTime, CONTENT_TYPES } from "../utils.js";
import { printReceipt } from "../receipt.js";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Imagem/vídeo anexado, carregado com o token do portal.
function AuthImg({ fileId, alt, mime, maxHeight = 360, mediaUrl }) {
  const [src, setSrc] = useState(mediaUrl || null);
  useEffect(() => {
    // Com media_url (link inline), toca/mostra direto por streaming — sem baixar
    // o arquivo inteiro (essencial para vídeo grande, que travava antes).
    if (mediaUrl) { setSrc(mediaUrl); return undefined; }
    let url;
    portalApi
      .get(`/files/${fileId}/download`, { responseType: "blob" })
      .then((r) => { url = URL.createObjectURL(r.data); setSrc(url); })
      .catch(() => {});
    return () => url && URL.revokeObjectURL(url);
  }, [fileId, mediaUrl]);
  if (!src) return null;
  if (mime?.startsWith("video/")) {
    return <Box component="video" src={src} controls sx={{ width: "100%", maxHeight, borderRadius: 2, bgcolor: "#000" }} />;
  }
  return (
    <Box component="img" src={src} alt={alt}
      sx={{ width: "100%", maxHeight, objectFit: "contain", borderRadius: 2, bgcolor: "action.hover" }} />
  );
}

// Miniatura pequena da arte (foto ou 1º quadro do vídeo) para as listas.
function PortalThumb({ fileId, size = 56, mime, thumb, mediaUrl }) {
  const [src, setSrc] = useState(null);
  const [isVideo, setIsVideo] = useState(false);
  useEffect(() => {
    if (thumb) { setSrc(thumb); setIsVideo(false); return undefined; }
    // Vídeo com link inline: NÃO baixa (usa media_url no <video>); evita puxar
    // um arquivo gigante só para a miniatura, que antes deixava o tile em branco.
    if ((mime || "").startsWith("video/") && mediaUrl) { setIsVideo(true); setSrc(null); return undefined; }
    if (!fileId) return undefined;
    let url;
    portalApi.get(`/files/${fileId}/download`, { responseType: "blob" })
      .then((r) => { url = URL.createObjectURL(r.data); setSrc(url); setIsVideo((r.data.type || "").startsWith("video")); })
      .catch(() => {});
    return () => url && URL.revokeObjectURL(url);
  }, [fileId, thumb, mediaUrl, mime]);
  const sx = { width: size, height: size, borderRadius: 1.5, objectFit: "cover", flexShrink: 0, bgcolor: isVideo ? "#000" : "action.hover" };
  if (src) return isVideo
    ? <Box component="video" src={src} muted sx={sx} />
    : <Box component="img" src={src} alt="" sx={sx} />;
  if ((mime || "").startsWith("video/") && mediaUrl) return <Box component="video" src={`${mediaUrl}#t=0.1`} preload="metadata" muted sx={sx} />;
  return <Box sx={sx} />;
}

// Navegador da galeria do cliente POR PASTAS (mesma estrutura da equipe).
// Com onPick vira um "seletor" (para apontar um arquivo); sem onPick, é só
// para ver (clicar amplia).
function GalleryBrowser({ onPick }) {
  const [path, setPath] = useState([]);
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState(null);
  const current = path[path.length - 1]?.id || null;

  useEffect(() => {
    setLoading(true);
    const fp = current ? { parent_id: current } : {};
    const ff = current ? { folder_id: current } : {};
    const p1 = portalApi.get("/gallery-folders", { params: fp }).then((r) => setFolders(r.data || [])).catch(() => setFolders([]));
    const p2 = portalApi.get("/gallery-files", { params: ff }).then((r) => setFiles(r.data || [])).catch(() => setFiles([]));
    Promise.all([p1, p2]).finally(() => setLoading(false));
  }, [current]);

  const vazio = !loading && folders.length === 0 && files.length === 0;
  return (
    <Box>
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
        <Typography color="text.secondary" sx={{ py: 2 }}>Nada nesta pasta.</Typography>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 1.5 }}>
          {folders.map((fd) => (
            <Box key={`d${fd.id}`} onClick={() => setPath([...path, { id: fd.id, name: fd.name }])}
              sx={{ cursor: "pointer", borderRadius: 1.5, p: 1, border: 1, borderColor: "divider", display: "grid", placeItems: "center", gap: 0.5, "&:hover": { borderColor: "primary.main" } }}>
              <Typography sx={{ fontSize: 32, lineHeight: 1 }}>📁</Typography>
              <Typography variant="caption" noWrap sx={{ maxWidth: "100%" }}>{fd.name}</Typography>
            </Box>
          ))}
          {files.map((f) => (
            <Box key={`f${f.id}`} onClick={() => (onPick ? onPick(f) : setView(f))}
              sx={{ cursor: "pointer", borderRadius: 1.5, overflow: "hidden", border: 1, borderColor: "divider", "&:hover": { borderColor: "primary.main" } }}>
              <PortalThumb fileId={f.id} size={110} mime={f.mime} thumb={f.thumb} mediaUrl={f.media_url} />
              <Typography variant="caption" noWrap sx={{ display: "block", px: 0.5, py: 0.25 }}>{f.original_name}</Typography>
            </Box>
          ))}
        </Box>
      )}
      <Dialog open={Boolean(view)} onClose={() => setView(null)} fullWidth maxWidth="md">
        <DialogTitle>{view?.original_name}</DialogTitle>
        <DialogContent>{view && <AuthImg fileId={view.id} alt={view.original_name} mime={view.mime} maxHeight={520} mediaUrl={view.media_url} />}</DialogContent>
        <DialogActions><Button onClick={() => setView(null)}>Fechar</Button></DialogActions>
      </Dialog>
    </Box>
  );
}

// Post do calendário ampliado: a arte em destaque, legenda logo abaixo.
function PostDialog({ post, onClose }) {
  const [attachments, setAttachments] = useState([]);
  useEffect(() => {
    setAttachments([]);
    if (!post) return;
    portalApi.get(`/tasks/${post.id}/attachments`).then((r) => setAttachments(r.data)).catch(() => {});
  }, [post]);

  return (
    <Dialog open={Boolean(post)} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{post?.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
            {post?.content_type && CONTENT_TYPES[post.content_type] && (
              <Chip size="small" color="primary"
                label={`${CONTENT_TYPES[post.content_type].emoji} ${CONTENT_TYPES[post.content_type].label}`} />
            )}
            {post?.scheduled_at && (
              <Chip size="small" variant="outlined"
                label={new Date(post.scheduled_at).toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" })} />
            )}
          </Stack>
          {attachments.map((f) => (
            <AuthImg key={f.id} fileId={f.id} alt={f.original_name} mime={f.mime} maxHeight={460} />
          ))}
          <Divider />
          <Typography variant="subtitle2" color="text.secondary">Legenda</Typography>
          <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
            {post?.caption || "Sem legenda."}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}

function ApprovalCard({ post, onDone }) {
  const [attachments, setAttachments] = useState([]);
  const [ajuste, setAjuste] = useState(null); // { caption, note, refFile }
  const [busy, setBusy] = useState(false);
  const [pickRef, setPickRef] = useState(false); // seletor da galeria aberto

  useEffect(() => {
    portalApi.get(`/tasks/${post.id}/attachments`).then((r) => setAttachments(r.data)).catch(() => {});
  }, [post.id]);

  async function approve() {
    setBusy(true);
    try { await portalApi.post(`/approvals/${post.id}/approve`); onDone(); }
    finally { setBusy(false); }
  }

  async function sendChanges() {
    setBusy(true);
    try {
      await portalApi.post(`/approvals/${post.id}/request-changes`, {
        client_caption: ajuste.caption !== post.caption ? ajuste.caption : null,
        client_note: ajuste.note || null,
        client_ref_file_id: ajuste.refFile?.id || null,
      });
      setAjuste(null);
      onDone();
    } finally { setBusy(false); }
  }

  const images = attachments.filter((a) => a.mime?.startsWith("image/"));

  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap", gap: 0.5, mb: 1.5 }}>
          {post.content_type && CONTENT_TYPES[post.content_type] && (
            <Chip size="small" color="primary"
              label={`${CONTENT_TYPES[post.content_type].emoji} ${CONTENT_TYPES[post.content_type].label}`} />
          )}
          {post.scheduled_at && (
            <Chip size="small" variant="outlined"
              label={`Previsto: ${new Date(post.scheduled_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`} />
          )}
        </Stack>

        <Typography variant="h6" sx={{ mb: 1 }}>{post.title}</Typography>

        {images.length > 0 && (
          <Stack spacing={1} sx={{ mb: 2 }}>
            {images.map((img) => <AuthImg key={img.id} fileId={img.id} alt={img.original_name} mime={img.mime} />)}
          </Stack>
        )}

        <Typography variant="subtitle2" color="text.secondary">Legenda</Typography>
        <Typography variant="body1" sx={{ whiteSpace: "pre-wrap", mb: 2 }}>
          {post.caption || "Sem legenda."}
        </Typography>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <Button
            variant="contained" color="success" size="large" fullWidth
            startIcon={<CheckCircleIcon />} disabled={busy} onClick={approve}
          >
            Aprovar
          </Button>
          <Button
            variant="outlined" size="large" fullWidth
            startIcon={<EditNoteIcon />} disabled={busy}
            onClick={() => setAjuste({ caption: post.caption || "", note: "" })}
          >
            Pedir ajustes
          </Button>
        </Stack>

        <Divider sx={{ my: 2 }} />
        <PostComments
          taskId={post.id}
          api={portalApi}
          listPath={`/tasks/${post.id}/comments`}
          postPath={`/tasks/${post.id}/comments`}
          eu="client"
          compacto
        />
      </CardContent>

      <Dialog open={Boolean(ajuste)} onClose={() => setAjuste(null)} fullWidth maxWidth="sm">
        <DialogTitle>Pedir ajustes — {post.title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Edite a legenda do jeito que preferir e/ou escreva o que gostaria de mudar. A agência recebe na hora.
            </Typography>
            <TextField
              label="Legenda (edite à vontade)" multiline rows={5} fullWidth
              value={ajuste?.caption || ""}
              onChange={(e) => setAjuste((a) => ({ ...a, caption: e.target.value }))}
            />
            <TextField
              label="Como podemos melhorar aqui?" multiline rows={3} fullWidth
              placeholder="Ex: prefiro outra foto, trocar o horário, destacar a promoção..."
              value={ajuste?.note || ""}
              onChange={(e) => setAjuste((a) => ({ ...a, note: e.target.value }))}
            />
            {/* Apontar um arquivo da própria galeria como referência */}
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Button variant="outlined" size="small" startIcon={<PhotoLibraryIcon />} onClick={() => setPickRef(true)}>
                {ajuste?.refFile ? "Trocar foto/vídeo citado" : "Apontar foto/vídeo da galeria"}
              </Button>
              {ajuste?.refFile && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <PortalThumb fileId={ajuste.refFile.id} size={40} />
                  <Typography variant="caption" noWrap sx={{ maxWidth: 160 }}>{ajuste.refFile.original_name}</Typography>
                  <IconButton size="small" onClick={() => setAjuste((a) => ({ ...a, refFile: null }))}>✕</IconButton>
                </Stack>
              )}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAjuste(null)}>Cancelar</Button>
          <Button variant="contained" onClick={sendChanges}
            disabled={busy || (!ajuste?.note && !ajuste?.refFile && ajuste?.caption === (post.caption || ""))}>
            Enviar para a agência
          </Button>
        </DialogActions>
      </Dialog>

      {/* Seletor: apontar um arquivo da galeria do cliente */}
      <Dialog open={pickRef} onClose={() => setPickRef(false)} fullWidth maxWidth="md">
        <DialogTitle>Escolher da sua galeria</DialogTitle>
        <DialogContent>
          <GalleryBrowser onPick={(f) => { setAjuste((a) => ({ ...a, refFile: f })); setPickRef(false); }} />
        </DialogContent>
        <DialogActions><Button onClick={() => setPickRef(false)}>Fechar</Button></DialogActions>
      </Dialog>
    </Card>
  );
}

export default function Portal() {
  const navigate = useNavigate();
  const client = JSON.parse(localStorage.getItem("portal_client") || "null");
  const [tab, setTab] = useState("approvals");
  const [galleryMode, setGalleryMode] = useState("pastas"); // pastas | etapas
  const [calView, setCalView] = useState("lista"); // lista | grade
  const [approvals, setApprovals] = useState([]);
  const [approved, setApproved] = useState([]);
  const [aprovMode, setAprovMode] = useState("pendentes"); // pendentes | aprovados
  const [payments, setPayments] = useState([]);
  const [payMethods, setPayMethods] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [cursor, setCursor] = useState(() => new Date());
  const [posts, setPosts] = useState([]);
  const [copied, setCopied] = useState(false);
  const [openPost, setOpenPost] = useState(null);
  const [events, setEvents] = useState([]);
  const [plan, setPlan] = useState(null);
  const [avisos, setAvisos] = useState([]);
  const [feed, setFeed] = useState([]);
  const [galeria, setGaleria] = useState(null);
  const [assinando, setAssinando] = useState(null);
  const [assinatura, setAssinatura] = useState({ nome: "", documento: "", aceito: false });
  const [erroAssinatura, setErroAssinatura] = useState("");
  const [erroRecibo, setErroRecibo] = useState("");
  const [baixando, setBaixando] = useState(null); // id da cobrança em que cliquei

  // Baixar recibo da cobrança: o servidor só entrega se ela estiver paga, e
  // emite o documento na hora se ainda não existir.
  async function baixarRecibo(pagamento) {
    setErroRecibo("");
    setBaixando(pagamento.id);
    try {
      const { data } = await portalApi.get(`/receipts/entry/${pagamento.id}`);
      printReceipt(data);
    } catch (e) {
      setErroRecibo(e.response?.data?.error || "Não foi possível abrir o recibo.");
      setTimeout(() => setErroRecibo(""), 6000);
    }
    setBaixando(null);
  }

  const loadApprovals = () => {
    portalApi.get("/approvals").then((r) => setApprovals(r.data.filter((a) => a.approval_status !== "approved")));
    portalApi.get("/approved").then((r) => setApproved(r.data)).catch(() => {});
  };

  useEffect(() => {
    if (!localStorage.getItem("portal_token")) { navigate("/portal/login"); return; }
    loadApprovals();
    portalApi.get("/payments").then((r) => setPayments(r.data));
    portalApi.get("/payment-methods").then((r) => setPayMethods(r.data)).catch(() => {});
    portalApi.get("/contracts").then((r) => setContracts(r.data));
    portalApi.get("/events", { params: { days: 90 } }).then((r) => setEvents(r.data)).catch(() => {});
    portalApi.get("/notifications").then((r) => setAvisos(r.data.filter((n) => !n.is_read))).catch(() => {});
    portalApi.get("/feed").then((r) => setFeed(r.data)).catch(() => {});
    portalApi.get("/gallery").then((r) => setGaleria(r.data)).catch(() => {});
  }, []);

  const buscarArquivo = useCallback(
    (fileId) => portalApi.get(`/files/${fileId}/download`, { responseType: "blob" }).then((r) => r.data),
    []
  );

  async function assinarContrato() {
    setErroAssinatura("");
    try {
      await portalApi.post(`/contracts/${assinando.id}/sign`, {
        signer_name: assinatura.nome.trim(),
        signer_document: assinatura.documento.trim() || null,
        agreed: assinatura.aceito,
      });
      const { data } = await portalApi.get("/contracts");
      setContracts(data);
      setAssinando(null);
      setAssinatura({ nome: "", documento: "", aceito: false });
    } catch (e) {
      setErroAssinatura(e.response?.data?.error || "Não foi possível assinar.");
    }
  }

  async function lerAvisos() {
    await portalApi.put("/notifications/read-all").catch(() => {});
    setAvisos([]);
  }

  useEffect(() => {
    const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    portalApi.get("/calendar", { params: { month } }).then((r) => setPosts(r.data)).catch(() => setPosts([]));
  }, [cursor]);

  const byDay = useMemo(() => {
    const map = {};
    posts.forEach((p) => { const d = Number(p.scheduled_at.slice(8, 10)); (map[d] ||= []).push(p); });
    return map;
  }, [posts]);
  const sortedDays = Object.keys(byDay).map(Number).sort((a, b) => a - b);
  const gridCells = useMemo(() => {
    const y = cursor.getFullYear(), m = cursor.getMonth();
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  function logout() {
    localStorage.removeItem("portal_token");
    localStorage.removeItem("portal_client");
    navigate("/portal/login");
  }

  function copyPix(code) {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <AppBar position="sticky" elevation={0} color="transparent"
        sx={{ borderBottom: 1, borderColor: "divider", bgcolor: (t) => alpha(t.palette.background.default, 0.9), backdropFilter: "blur(8px)" }}>
        <Toolbar>
          <Box sx={{ width: 34, height: 34, borderRadius: 2, bgcolor: "primary.main", color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontFamily: '"Outfit", sans-serif', mr: 1.5 }}>
            SA
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 700, lineHeight: 1.1 }}>{client?.name}</Typography>
            <Typography variant="caption" color="text.secondary">Área do Cliente</Typography>
          </Box>
          <Tooltip title="Sair">
            <IconButton onClick={logout}><LogoutIcon /></IconButton>
          </Tooltip>
        </Toolbar>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" sx={{ px: 2 }}>
          <Tab value="approvals" label={
            <Badge color="primary" badgeContent={approvals.length} max={99}
              sx={{ "& .MuiBadge-badge": { position: "static", transform: "none", ml: 0.75 } }}>
              Aprovações
            </Badge>
          } />
          <Tab value="feed" label="Prévia do feed" />
          <Tab value="gallery" label="Galeria" />
          <Tab value="calendar" label="Calendário" />
          <Tab value="agenda" label="Agenda" />
          <Tab value="payments" label="Pagamentos" />
          <Tab value="contract" label="Contrato" />
        </Tabs>
      </AppBar>

      <Container maxWidth="md" sx={{ py: 3.5 }}>
        {avisos.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2.5 }} onClose={lerAvisos}>
            {avisos.map((a) => (
              <Typography key={a.id} variant="body2">{a.message}</Typography>
            ))}
          </Alert>
        )}

        {/* ---- Aprovações ---- */}
        {tab === "approvals" && (
          <>
            <Stack direction="row" justifyContent="center" sx={{ mb: 2 }}>
              <ToggleButtonGroup size="small" exclusive value={aprovMode} onChange={(_, v) => v && setAprovMode(v)}>
                <ToggleButton value="pendentes">Aguardando{approvals.length ? ` (${approvals.length})` : ""}</ToggleButton>
                <ToggleButton value="aprovados">Aprovados{approved.length ? ` (${approved.length})` : ""}</ToggleButton>
              </ToggleButtonGroup>
            </Stack>

            {aprovMode === "pendentes" ? (
              approvals.length === 0 ? (
                <Card><CardContent sx={{ textAlign: "center", py: 6 }}>
                  <CheckCircleIcon color="success" sx={{ fontSize: 44, mb: 1 }} />
                  <Typography color="text.secondary">Tudo em dia — nada aguardando a sua aprovação.</Typography>
                </CardContent></Card>
              ) : (
                <Stack spacing={2.5}>
                  <Alert severity="info">
                    {approvals.length === 1 ? "1 post aguardando" : `${approvals.length} posts aguardando`} sua aprovação.
                  </Alert>
                  {approvals.map((p) => <ApprovalCard key={p.id} post={p} onDone={loadApprovals} />)}
                </Stack>
              )
            ) : (
              approved.length === 0 ? (
                <Card><CardContent sx={{ textAlign: "center", py: 6 }}>
                  <Typography color="text.secondary">Você ainda não aprovou nenhum conteúdo.</Typography>
                </CardContent></Card>
              ) : (
                <Stack spacing={1.5}>
                  {approved.map((p) => (
                    <Card key={p.id}>
                      <Box onClick={() => setOpenPost(p)} sx={{ display: "flex", gap: 1.5, p: 1.5, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
                            {p.content_type && CONTENT_TYPES[p.content_type] && (
                              <Chip size="small" color="primary" variant="outlined"
                                label={`${CONTENT_TYPES[p.content_type].emoji} ${CONTENT_TYPES[p.content_type].label}`} />
                            )}
                            <Chip size="small" color="success" icon={<CheckCircleIcon />} label="Aprovado" />
                          </Stack>
                          <Typography sx={{ fontWeight: 600, mt: 0.3 }}>{p.title}</Typography>
                          {p.scheduled_at && (
                            <Typography variant="caption" color="text.secondary">
                              {new Date(p.scheduled_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    </Card>
                  ))}
                </Stack>
              )
            )}
          </>
        )}

        {/* ---- Calendário ---- */}
        {tab === "calendar" && (
          <>
            <Stack direction="row" alignItems="center" justifyContent="center" spacing={2} sx={{ mb: 1.5 }}>
              <IconButton onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}><ChevronLeftIcon /></IconButton>
              <Typography variant="h6" sx={{ minWidth: 190, textAlign: "center" }}>
                {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
              </Typography>
              <IconButton onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}><ChevronRightIcon /></IconButton>
            </Stack>
            <Stack direction="row" justifyContent="center" sx={{ mb: 2.5 }}>
              <ToggleButtonGroup size="small" exclusive value={calView} onChange={(_, v) => v && setCalView(v)}>
                <ToggleButton value="grade">Calendário</ToggleButton>
                <ToggleButton value="lista">Lista</ToggleButton>
              </ToggleButtonGroup>
            </Stack>

            {calView === "grade" ? (
              sortedDays.length === 0 ? (
                <Card><CardContent sx={{ textAlign: "center", py: 5 }}>
                  <Typography color="text.secondary">Nada programado neste mês.</Typography>
                </CardContent></Card>
              ) : (
                <Card>
                  <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: 1, borderColor: "divider" }}>
                    {WEEKDAYS.map((w) => (
                      <Typography key={w} variant="caption" sx={{ p: 1, textAlign: "center", fontWeight: 700, color: "text.secondary" }}>{w}</Typography>
                    ))}
                  </Box>
                  <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
                    {gridCells.map((day, i) => (
                      <Box key={i} sx={{ minHeight: 92, p: 0.5, borderRight: (i + 1) % 7 !== 0 ? 1 : 0, borderBottom: i < gridCells.length - 7 ? 1 : 0, borderColor: "divider" }}>
                        {day && (
                          <>
                            <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>{day}</Typography>
                            <Stack spacing={0.5} sx={{ mt: 0.4 }}>
                              {(byDay[day] || []).slice(0, 2).map((p) => (
                                <Box key={p.id} onClick={() => setOpenPost(p)}
                                  sx={{ cursor: "pointer", borderRadius: 1, overflow: "hidden", border: 1, borderColor: "divider", position: "relative", "&:hover": { borderColor: "primary.main" } }}>
                                  {p.file_id ? <PortalThumb fileId={p.file_id} size={44} /> : <Box sx={{ height: 44, bgcolor: "action.hover" }} />}
                                  <Box sx={{ position: "absolute", left: 3, bottom: 3, px: 0.5, borderRadius: 0.5, bgcolor: "rgba(0,0,0,0.62)", color: "#fff", fontSize: 10, fontWeight: 700 }}>
                                    {formatTime(p.scheduled_at)}
                                  </Box>
                                </Box>
                              ))}
                              {(byDay[day] || []).length > 2 && (
                                <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5 }}>+{byDay[day].length - 2}</Typography>
                              )}
                            </Stack>
                          </>
                        )}
                      </Box>
                    ))}
                  </Box>
                </Card>
              )
            ) : sortedDays.length === 0 ? (
              <Card><CardContent sx={{ textAlign: "center", py: 5 }}>
                <Typography color="text.secondary">Nada programado neste mês.</Typography>
              </CardContent></Card>
            ) : (
              <Stack spacing={2}>
                {sortedDays.map((day) => (
                  <Card key={day}>
                    <CardContent>
                      <Typography variant="h6" sx={{ mb: 1.5 }}>
                        {String(day).padStart(2, "0")} de {MONTHS[cursor.getMonth()].toLowerCase()}
                      </Typography>
                      <Stack divider={<Divider />} spacing={1.5}>
                        {byDay[day].map((p) => (
                          <Box key={p.id} onClick={() => setOpenPost(p)}
                            sx={{ display: "flex", gap: 1.5, cursor: "pointer", borderRadius: 2, p: 0.5, m: -0.5, "&:hover": { bgcolor: "action.hover" } }}>
                            <Typography sx={{ fontWeight: 700, minWidth: 46 }}>{formatTime(p.scheduled_at)}</Typography>
                            {p.file_id && <PortalThumb fileId={p.file_id} />}
                            <Box sx={{ minWidth: 0 }}>
                              <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
                                {p.content_type && CONTENT_TYPES[p.content_type] && (
                                  <Chip size="small" color="primary" variant="outlined"
                                    label={`${CONTENT_TYPES[p.content_type].emoji} ${CONTENT_TYPES[p.content_type].label}`} />
                                )}
                                <Chip size="small" variant="outlined" label={p.stage_done ? "Programado" : p.stage_name} color={p.stage_done ? "success" : "default"} />
                              </Stack>
                              <Typography sx={{ fontWeight: 600, mt: 0.3 }}>{p.title}</Typography>
                              {p.caption && (
                                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
                                  {p.caption}
                                </Typography>
                              )}
                            </Box>
                          </Box>
                        ))}
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}
          </>
        )}

        {/* ---- Prévia do feed ---- */}
        {tab === "feed" && (
          <Card><CardContent>
            <FeedPreview posts={feed} fetchFile={buscarArquivo} onSelect={setOpenPost}
              titulo="Como o seu perfil vai ficar" />
          </CardContent></Card>
        )}

        {/* ---- Galeria: por pastas (como a equipe organiza) ou por etapa ---- */}
        {tab === "gallery" && (
          <>
            <ToggleButtonGroup size="small" exclusive value={galleryMode}
              onChange={(_, v) => v && setGalleryMode(v)} sx={{ mb: 2 }}>
              <ToggleButton value="pastas">Pastas</ToggleButton>
              <ToggleButton value="etapas">Por etapa</ToggleButton>
            </ToggleButtonGroup>
            {galleryMode === "pastas"
              ? <Card><CardContent><GalleryBrowser /></CardContent></Card>
              : <Galeria dados={galeria} fetchFile={buscarArquivo} />}
          </>
        )}

        {/* ---- Agenda (captações, reuniões...) ---- */}
        {tab === "agenda" && (
          <Stack spacing={2}>
            {events.length === 0 ? (
              <Card><CardContent sx={{ textAlign: "center", py: 5 }}>
                <Typography color="text.secondary">Nenhum compromisso agendado.</Typography>
              </CardContent></Card>
            ) : (
              events.map((e) => (
                <Card key={e.id}>
                  <CardContent>
                    <Stack direction="row" spacing={2} alignItems="flex-start">
                      <Box sx={{ textAlign: "center", minWidth: 64 }}>
                        <Typography variant="h6" sx={{ lineHeight: 1 }}>
                          {new Date(e.start_at).getDate()}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(e.start_at).toLocaleDateString("pt-BR", { month: "short" })} · {formatTime(e.start_at)}
                        </Typography>
                      </Box>
                      <Box sx={{ width: 4, alignSelf: "stretch", borderRadius: 2, bgcolor: e.type_color || "primary.main" }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 600 }}>{e.title}</Typography>
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
                          {e.type_name && <Chip size="small" label={e.type_name} sx={{ bgcolor: e.type_color, color: "#fff" }} />}
                          {e.owner_name && <Chip size="small" variant="outlined" label={`com ${e.owner_name}`} />}
                        </Stack>
                        {e.notes && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{e.notes}</Typography>}
                        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                          {e.doc_content && (
                            <Button size="small" variant="contained" onClick={() => setPlan(e)}>
                              Ver o que vamos fazer
                            </Button>
                          )}
                          {e.link_url && (
                            <Button size="small" variant="outlined" component={Link} href={e.link_url} target="_blank" rel="noopener">
                              Abrir link
                            </Button>
                          )}
                        </Stack>
                      </Box>
                    </Stack>
                  </CardContent>
                </Card>
              ))
            )}
          </Stack>
        )}

        {/* ---- Pagamentos ---- */}
        {tab === "payments" && (
          <Stack spacing={2}>
            {copied && <Alert severity="success">Código PIX copiado.</Alert>}
            {erroRecibo && <Alert severity="error">{erroRecibo}</Alert>}
            {payments.length === 0 && (
              <Card><CardContent sx={{ textAlign: "center", py: 5 }}>
                <Typography color="text.secondary">Nenhuma cobrança registrada.</Typography>
              </CardContent></Card>
            )}
            {payments.map((p) => (
              <Card key={p.id}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ flexWrap: "wrap", gap: 1 }}>
                    <Box>
                      <Typography sx={{ fontWeight: 600 }}>{p.description}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Vencimento: {formatDate(p.due_date)}
                      </Typography>
                    </Box>
                    <Stack alignItems="flex-end" spacing={0.5}>
                      <Typography variant="h6" sx={{ fontVariantNumeric: "tabular-nums" }}>{currency(p.amount)}</Typography>
                      <Chip size="small" label={p.status === "paid" ? "Pago" : "Em aberto"}
                        color={p.status === "paid" ? "success" : "warning"} />
                    </Stack>
                  </Stack>
                  {(p.can_receipt || p.pix_code || p.boleto_url || p.payment_link || p.invoice_url) && (
                    <>
                      <Divider sx={{ my: 1.5 }} />
                      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                        {/* Recibo: só aparece quando a cobrança já está paga. */}
                        {p.can_receipt ? (
                          <Button size="small" variant="contained" startIcon={<ReceiptLongIcon />}
                            disabled={baixando === p.id} onClick={() => baixarRecibo(p)}>
                            {baixando === p.id ? "Gerando…" : "Baixar recibo"}
                          </Button>
                        ) : null}
                        {p.pix_code && (
                          <Button size="small" variant="outlined" startIcon={<PixIcon />} onClick={() => copyPix(p.pix_code)}>
                            Copiar PIX
                          </Button>
                        )}
                        {p.boleto_url && (
                          <Button size="small" variant="outlined" startIcon={<ReceiptLongIcon />}
                            component={Link} href={p.boleto_url} target="_blank">
                            2ª via do boleto
                          </Button>
                        )}
                        {p.payment_link && (
                          <Button size="small" variant="contained" startIcon={<LinkIcon />}
                            component={Link} href={p.payment_link} target="_blank">
                            Pagar agora
                          </Button>
                        )}
                        {p.invoice_url && (
                          <Button size="small" variant="outlined" startIcon={<DescriptionIcon />}
                            component={Link} href={p.invoice_url} target="_blank">
                            Baixar nota
                          </Button>
                        )}
                      </Stack>
                    </>
                  )}

                  {/* Formas de pagamento oferecidas pelo escritório (Mercado Pago / Infinite Pay) */}
                  {p.status !== "paid" && (payMethods?.mercadopago?.link || payMethods?.infinitepay?.link) && (
                    <>
                      <Divider sx={{ my: 1.5 }} />
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>
                        Ou pague por outra forma (informe o valor {currency(p.amount)}
                        {payMethods?.pass_interest ? "; o juro do parcelamento fica por sua conta" : ""}):
                      </Typography>
                      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                        {payMethods?.mercadopago?.link && (
                          <Button size="small" variant="outlined" component={Link} href={payMethods.mercadopago.link} target="_blank">
                            Pagar no Mercado Pago
                          </Button>
                        )}
                        {payMethods?.infinitepay?.link && (
                          <Button size="small" variant="outlined" component={Link} href={payMethods.infinitepay.link} target="_blank">
                            Pagar no Infinite Pay
                          </Button>
                        )}
                      </Stack>
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}

        {/* ---- Contrato ---- */}
        {tab === "contract" && (
          <Stack spacing={2}>
            {contracts.length === 0 && (
              <Card><CardContent sx={{ textAlign: "center", py: 5 }}>
                <Typography color="text.secondary">Nenhum contrato registrado.</Typography>
              </CardContent></Card>
            )}
            {contracts.map((c) => (
              <Card key={c.id}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ flexWrap: "wrap", gap: 1 }}>
                    <Typography variant="h6">{c.title}</Typography>
                    <Chip size="small" label={c.status === "active" ? "Vigente" : c.status} color="success" />
                  </Stack>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 0.5, sm: 4 }} sx={{ mt: 1.5 }}>
                    <Typography variant="body2"><strong>Valor:</strong> {currency(c.value)}/mês</Typography>
                    <Typography variant="body2">
                      <strong>Duração:</strong> {c.duration_months ? `${c.duration_months} meses` : "Indeterminado"}
                    </Typography>
                    <Typography variant="body2"><strong>Início:</strong> {formatDate(c.start_date)}</Typography>
                  </Stack>
                  {c.notes && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, whiteSpace: "pre-wrap" }}>
                      {c.notes}
                    </Typography>
                  )}

                  <Divider sx={{ my: 2 }} />
                  {c.signed_at ? (
                    <Alert severity="success" icon={<CheckCircleIcon />}>
                      Assinado por <strong>{c.signer_name}</strong> em{" "}
                      {new Date(c.signed_at.replace(" ", "T") + "Z").toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.
                    </Alert>
                  ) : (
                    <Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                        Leia o contrato acima. Ao assinar, registramos seu nome, a data e o
                        endereço de onde você assinou.
                      </Typography>
                      <Button variant="contained" onClick={() => setAssinando(c)}>
                        Assinar contrato
                      </Button>
                    </Box>
                  )}
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Container>

      {/* Post ampliado (foto acima, legenda abaixo) */}
      <PostDialog post={openPost} onClose={() => setOpenPost(null)} />

      {/* Assinatura do contrato */}
      <Dialog open={Boolean(assinando)} onClose={() => setAssinando(null)} fullWidth maxWidth="xs">
        <DialogTitle>Assinar — {assinando?.title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {erroAssinatura && <Alert severity="error">{erroAssinatura}</Alert>}
            <TextField label="Seu nome completo *" fullWidth autoFocus
              value={assinatura.nome}
              onChange={(e) => setAssinatura((a) => ({ ...a, nome: e.target.value }))} />
            <TextField label="CPF ou CNPJ" fullWidth
              value={assinatura.documento}
              onChange={(e) => setAssinatura((a) => ({ ...a, documento: e.target.value }))} />
            <FormControlLabel
              control={<Checkbox checked={assinatura.aceito}
                onChange={(e) => setAssinatura((a) => ({ ...a, aceito: e.target.checked }))} />}
              label={<Typography variant="body2">Li o contrato e concordo com os termos.</Typography>}
            />
            <Typography variant="caption" color="text.secondary">
              Ao confirmar, guardamos seu nome, documento, data, hora e endereço de rede
              como comprovante do aceite.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssinando(null)}>Cancelar</Button>
          <Button variant="contained" onClick={assinarContrato}
            disabled={!assinatura.nome.trim() || !assinatura.aceito}>
            Assinar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Plano do compromisso */}
      <Dialog open={Boolean(plan)} onClose={() => setPlan(null)} fullWidth maxWidth="sm">
        <DialogTitle>{plan?.title}</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>{plan?.doc_content}</Typography>
          {plan?.link_url && (
            <Button sx={{ mt: 2 }} variant="outlined" component={Link} href={plan.link_url} target="_blank" rel="noopener">
              Abrir link
            </Button>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPlan(null)}>Fechar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
