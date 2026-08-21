import { useEffect, useRef, useState } from "react";
import {
  Box, Button, Card, CardContent, Typography, IconButton, Stack, TextField,
  MenuItem, Breadcrumbs, Link, Table, TableBody, TableCell, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, LinearProgress, Grid, Tooltip,
  Tabs, Tab, Chip, Menu, Alert,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import FolderIcon from "@mui/icons-material/Folder";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import ImageIcon from "@mui/icons-material/Image";
import MovieIcon from "@mui/icons-material/Movie";
import DriveFileMoveIcon from "@mui/icons-material/DriveFileMove";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import EditIcon from "@mui/icons-material/Edit";
import api from "../api/client.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader } from "../components/ui.jsx";
import { fileSize, formatDateTime } from "../utils.js";

// As mesmas etapas do fluxo, na ordem em que o material caminha.
const STAGES = [
  { key: "originais", label: "Originais", emoji: "📥" },
  { key: "editados", label: "Editados", emoji: "✂️" },
  { key: "aprovacao", label: "Para aprovação", emoji: "👀" },
  { key: "aprovados", label: "Aprovados", emoji: "✅" },
  { key: "programados", label: "Programados", emoji: "📅" },
];

function fileIcon(mime = "") {
  if (mime.startsWith("image/")) return <ImageIcon color="primary" />;
  if (mime.startsWith("video/")) return <MovieIcon color="primary" />;
  return <InsertDriveFileIcon color="disabled" />;
}

function authFetchBlob(id) {
  const token = localStorage.getItem("token");
  return fetch(`/api/files/${id}/download`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.blob());
}

// Cartão de um arquivo no quadro: mostra a miniatura (imagem) ou ícone + ações.
function FileCard({ f, onDownload, onDelete, onMove, onRename, onMoveFolder, compact }) {
  const [src, setSrc] = useState(null);
  const [anchor, setAnchor] = useState(null);
  const [moreAnchor, setMoreAnchor] = useState(null);
  const ehImg = f.mime?.startsWith("image/");
  useEffect(() => {
    if (!ehImg) return undefined;
    let url; let vivo = true;
    authFetchBlob(f.id).then((b) => { if (vivo) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => {});
    return () => { vivo = false; if (url) URL.revokeObjectURL(url); };
  }, [f.id, ehImg]);

  return (
    <Card variant="outlined" sx={{ overflow: "hidden" }}>
      <Box sx={{ position: "relative", height: compact ? 110 : 150, bgcolor: "action.hover", display: "grid", placeItems: "center" }}>
        {src ? <Box component="img" src={src} alt={f.original_name} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : fileIcon(f.mime)}
      </Box>
      <Box sx={{ p: 1 }}>
        <Typography noWrap variant="caption" sx={{ display: "block", fontWeight: 600 }}>{f.original_name}</Typography>
        <Typography variant="caption" color="text.secondary">{fileSize(f.size)}</Typography>
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
          <Tooltip title="Baixar original">
            <IconButton size="small" color="primary" onClick={() => onDownload(f)}><DownloadIcon sx={{ fontSize: 17 }} /></IconButton>
          </Tooltip>
          {onMove && (
            <Tooltip title="Mover de etapa">
              <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)}><DriveFileMoveIcon sx={{ fontSize: 17 }} /></IconButton>
            </Tooltip>
          )}
          {(onRename || onMoveFolder) && (
            <Tooltip title="Mais">
              <IconButton size="small" onClick={(e) => setMoreAnchor(e.currentTarget)}><MoreVertIcon sx={{ fontSize: 17 }} /></IconButton>
            </Tooltip>
          )}
          <Tooltip title="Excluir">
            <IconButton size="small" color="error" onClick={() => onDelete(f.id)}><DeleteIcon sx={{ fontSize: 17 }} /></IconButton>
          </Tooltip>
        </Stack>
      </Box>
      {(onRename || onMoveFolder) && (
        <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
          {onRename && (
            <MenuItem onClick={() => { setMoreAnchor(null); onRename(f); }}>
              <EditIcon sx={{ fontSize: 17, mr: 1 }} /> Renomear
            </MenuItem>
          )}
          {onMoveFolder && (
            <MenuItem onClick={() => { setMoreAnchor(null); onMoveFolder(f); }}>
              <DriveFileMoveIcon sx={{ fontSize: 17, mr: 1 }} /> Mover para pasta
            </MenuItem>
          )}
        </Menu>
      )}
      {onMove && (
        <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
          {STAGES.filter((s) => s.key !== f.stage).map((s) => (
            <MenuItem key={s.key} onClick={() => { setAnchor(null); onMove(f.id, s.key); }}>
              {s.emoji} Mover para {s.label}
            </MenuItem>
          ))}
        </Menu>
      )}
    </Card>
  );
}

export default function Files() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [tab, setTab] = useState("etapas");
  // Quadro de etapas (arquivos do cliente na raiz, sem pasta).
  const [board, setBoard] = useState([]);
  // Documentos (pastas).
  const [path, setPath] = useState([]);
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [uploading, setUploading] = useState(false);
  const stageUpRef = useRef(null); // input de upload por etapa
  const uploadStage = useRef("originais");
  const docInputRef = useRef(null);
  const zipInputRef = useRef(null);
  const [zipMsg, setZipMsg] = useState("");
  const [allFolders, setAllFolders] = useState([]); // todas as pastas do cliente (p/ mover)
  const [renameTarget, setRenameTarget] = useState(null); // { id, name }
  const [moveTarget, setMoveTarget] = useState(null); // { id, folder_id }

  const currentFolder = path[path.length - 1]?.id || null;

  useEffect(() => { api.get("/clients").then((r) => setClients(r.data)); }, []);

  const loadBoard = () => {
    if (!clientId) { setBoard([]); return; }
    api.get("/files", { params: { client_id: clientId } }).then((r) => setBoard(r.data));
  };
  const loadDocs = () => {
    if (!clientId) { setFolders([]); setFiles([]); return; }
    const params = { client_id: clientId };
    if (currentFolder) params.folder_id = currentFolder;
    api.get("/files/folders", { params }).then((r) => setFolders(r.data));
    if (currentFolder) api.get("/files", { params }).then((r) => setFiles(r.data));
    else setFiles([]);
  };
  // Ao vivo: 'vFiles' muda quando alguém envia/move/apaga arquivos.
  const loadAllFolders = () => {
    if (!clientId) { setAllFolders([]); return; }
    api.get("/files/folders", { params: { client_id: clientId, all: 1 } }).then((r) => setAllFolders(r.data)).catch(() => setAllFolders([]));
  };
  const vFiles = useLiveVersion("files");
  useEffect(() => { loadBoard(); }, [clientId, vFiles]);
  useEffect(() => { loadDocs(); }, [clientId, currentFolder, vFiles]);
  useEffect(() => { loadAllFolders(); }, [clientId, vFiles]);

  async function renomearArquivo() {
    if (!renameTarget?.name.trim()) return;
    await api.put(`/files/${renameTarget.id}`, { original_name: renameTarget.name.trim() });
    setRenameTarget(null); loadDocs();
  }
  async function moverArquivoPasta() {
    await api.put(`/files/${moveTarget.id}`, { folder_id: moveTarget.folder_id || null });
    setMoveTarget(null); loadDocs();
  }

  function selectClient(id) { setClientId(id); setPath([]); }

  // ---- Upload no quadro (etapa) ----
  function pedirUploadEtapa(stage) {
    uploadStage.current = stage;
    stageUpRef.current?.click();
  }
  async function enviarNoQuadro(fileList) {
    if (!fileList?.length || !clientId) return;
    setUploading(true);
    try {
      const form = new FormData();
      [...fileList].forEach((f) => form.append("files", f));
      form.append("client_id", clientId);
      form.append("stage", uploadStage.current);
      await api.post("/files/upload", form, { headers: { "Content-Type": "multipart/form-data" } });
      loadBoard();
    } finally {
      setUploading(false);
      if (stageUpRef.current) stageUpRef.current.value = "";
    }
  }
  async function moverEtapa(id, stage) {
    await api.put(`/files/${id}/stage`, { stage });
    loadBoard();
  }

  // ---- Documentos (pastas) ----
  async function createFolder() {
    if (!newFolderName.trim()) return;
    await api.post("/files/folders", { name: newFolderName.trim(), client_id: clientId || null, parent_id: currentFolder });
    setNewFolderName(""); setNewFolderOpen(false); loadDocs();
  }
  async function removeFolder(id) {
    if (!confirm("Excluir pasta e todo o conteúdo dela?")) return;
    await api.delete(`/files/folders/${id}`); loadDocs();
  }
  async function enviarDocs(fileList) {
    if (!fileList?.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      [...fileList].forEach((f) => form.append("files", f));
      if (clientId) form.append("client_id", clientId);
      if (currentFolder) form.append("folder_id", currentFolder);
      await api.post("/files/upload", form, { headers: { "Content-Type": "multipart/form-data" } });
      loadDocs();
    } finally {
      setUploading(false);
      if (docInputRef.current) docInputRef.current.value = "";
    }
  }

  // ---- Importar em massa por .ZIP (para a pasta atual) ----
  async function enviarZip(file) {
    if (!file) return;
    setUploading(true);
    setZipMsg("");
    try {
      const form = new FormData();
      form.append("zip", file);
      if (clientId) form.append("client_id", clientId);
      if (currentFolder) form.append("folder_id", currentFolder);
      const { data } = await api.post("/files/upload-zip", form, { headers: { "Content-Type": "multipart/form-data" } });
      setZipMsg(`Importei ${data.count} arquivo(s) do ZIP${data.ignorados ? ` (${data.ignorados} ignorado(s) por não serem foto/vídeo)` : ""}.`);
      loadDocs();
    } catch (e) {
      setZipMsg(e.response?.data?.error || "Não foi possível importar o ZIP.");
    } finally {
      setUploading(false);
      if (zipInputRef.current) zipInputRef.current.value = "";
      setTimeout(() => setZipMsg(""), 8000);
    }
  }

  async function removeFile(id, recarregar) {
    if (!confirm("Excluir arquivo?")) return;
    await api.delete(`/files/${id}`); recarregar();
  }
  function download(file) {
    authFetchBlob(file.id).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = file.original_name; a.click();
      URL.revokeObjectURL(url);
    });
  }

  const porEtapa = (key) => board.filter((f) => (f.stage || "originais") === key);

  return (
    <>
      <PageHeader
        title="Galeria"
        subtitle="Material por cliente, em pastas — enviado e baixado na qualidade original"
      />

      <TextField select size="small" label="Cliente" value={clientId}
        onChange={(e) => selectClient(e.target.value)} sx={{ minWidth: 240, mb: 2.5 }}>
        <MenuItem value="">Selecione um cliente…</MenuItem>
        {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
      </TextField>

      {!clientId ? (
        clients.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>Nenhum cliente cadastrado ainda.</Typography>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 2 }}>
            {clients.map((c) => (
              <Card key={c.id} onClick={() => selectClient(c.id)}
                sx={{ cursor: "pointer", border: 1, borderColor: "divider", "&:hover": { borderColor: "primary.main" } }}>
                <CardContent sx={{ textAlign: "center", py: 3 }}>
                  <FolderIcon sx={{ fontSize: 44, color: "primary.main" }} />
                  <Typography sx={{ fontWeight: 600, mt: 0.5 }} noWrap>{c.name}</Typography>
                </CardContent>
              </Card>
            ))}
          </Box>
        )
      ) : (
        <>
          <Button size="small" onClick={() => selectClient("")} sx={{ mb: 1 }}>← Todos os clientes</Button>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
            <Tab value="etapas" label="Etapas do material" />
            <Tab value="docs" label="Pastas" />
          </Tabs>

          {uploading && <LinearProgress sx={{ mb: 2, borderRadius: 2 }} />}
          <input ref={stageUpRef} type="file" multiple hidden onChange={(e) => enviarNoQuadro(e.target.files)} />

          {tab === "etapas" ? (
            <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "repeat(5, 1fr)" }, alignItems: "start" }}>
              {STAGES.map((s) => {
                const arquivos = porEtapa(s.key);
                return (
                  <Card key={s.key} sx={{ bgcolor: "action.hover" }}>
                    <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
                        <Typography sx={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{s.emoji} {s.label}</Typography>
                        <Chip size="small" label={arquivos.length} />
                      </Stack>
                      <Button fullWidth size="small" variant="outlined" startIcon={<UploadFileIcon />}
                        sx={{ mb: 1 }} onClick={() => pedirUploadEtapa(s.key)}>
                        Enviar
                      </Button>
                      <Stack spacing={1}>
                        {arquivos.map((f) => (
                          <FileCard key={f.id} f={f} onDownload={download}
                            onDelete={(id) => removeFile(id, loadBoard)} onMove={moverEtapa} />
                        ))}
                        {arquivos.length === 0 && (
                          <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center", py: 1 }}>
                            Vazio
                          </Typography>
                        )}
                      </Stack>
                    </CardContent>
                  </Card>
                );
              })}
            </Box>
          ) : (
            <>
              <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: "wrap", gap: 1 }} alignItems="center">
                <Button variant="outlined" startIcon={<CreateNewFolderIcon />} onClick={() => setNewFolderOpen(true)}>Nova pasta</Button>
                <Button variant="contained" startIcon={<UploadFileIcon />} onClick={() => docInputRef.current?.click()}
                  disabled={!currentFolder}>Enviar para a pasta</Button>
                <input ref={docInputRef} type="file" multiple hidden onChange={(e) => enviarDocs(e.target.files)} />
                <Tooltip title={currentFolder ? "Envie um .ZIP com fotos/vídeos — importa tudo de uma vez para esta pasta" : "Abra uma pasta primeiro"}>
                  <span>
                    <Button variant="outlined" startIcon={<DriveFileMoveIcon />} onClick={() => zipInputRef.current?.click()}
                      disabled={!currentFolder}>Importar .ZIP</Button>
                  </span>
                </Tooltip>
                <input ref={zipInputRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => enviarZip(e.target.files?.[0])} />
                <Breadcrumbs>
                  <Link component="button" underline="hover" color={path.length ? "primary" : "text.primary"} onClick={() => setPath([])}>Pastas</Link>
                  {path.map((p, i) => (
                    <Link key={p.id} component="button" underline="hover"
                      color={i === path.length - 1 ? "text.primary" : "primary"}
                      onClick={() => setPath(path.slice(0, i + 1))}>{p.name}</Link>
                  ))}
                </Breadcrumbs>
              </Stack>

              {folders.length > 0 && (
                <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
                  {folders.map((f) => (
                    <Grid item xs={6} sm={4} md={3} lg={2} key={f.id}>
                      <Card onClick={() => setPath([...path, { id: f.id, name: f.name }])}
                        sx={{ cursor: "pointer", "&:hover": { borderColor: "primary.main", bgcolor: (t) => alpha(t.palette.primary.main, 0.04) } }}>
                        <CardContent sx={{ display: "flex", alignItems: "center", gap: 1, p: 1.5, "&:last-child": { pb: 1.5 } }}>
                          <FolderIcon sx={{ color: "primary.main" }} />
                          <Typography noWrap sx={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{f.name}</Typography>
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); removeFolder(f.id); }}>
                            <DeleteIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              )}

              {zipMsg && <Alert severity="info" sx={{ mb: 2 }}>{zipMsg}</Alert>}

              {!currentFolder ? (
                <Card><CardContent sx={{ textAlign: "center", py: 5 }}>
                  <Typography color="text.secondary">
                    {folders.length ? "Abra uma pasta (acima) para ver as fotos/vídeos, ou entre numa subpasta." : "Crie uma pasta para começar."}
                  </Typography>
                </CardContent></Card>
              ) : files.length === 0 ? (
                <Card><CardContent sx={{ textAlign: "center", py: 5 }}>
                  <Typography color="text.secondary">Pasta vazia. Use "Enviar para a pasta" ou "Importar .ZIP".</Typography>
                </CardContent></Card>
              ) : (
                <Grid container spacing={1.5}>
                  {files.map((f) => (
                    <Grid item xs={4} sm={3} md={2} key={f.id}>
                      <FileCard f={f} compact onDownload={download}
                        onDelete={(id) => removeFile(id, loadDocs)}
                        onRename={(file) => setRenameTarget({ id: file.id, name: file.original_name })}
                        onMoveFolder={(file) => setMoveTarget({ id: file.id, folder_id: file.folder_id || "" })} />
                    </Grid>
                  ))}
                </Grid>
              )}
            </>
          )}
        </>
      )}

      {/* Renomear arquivo */}
      <Dialog open={Boolean(renameTarget)} onClose={() => setRenameTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>Renomear arquivo</DialogTitle>
        <DialogContent>
          <TextField label="Nome do arquivo" fullWidth autoFocus sx={{ mt: 1 }}
            value={renameTarget?.name || ""}
            onChange={(e) => setRenameTarget((t) => ({ ...t, name: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && renomearArquivo()} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameTarget(null)}>Cancelar</Button>
          <Button variant="contained" onClick={renomearArquivo} disabled={!renameTarget?.name?.trim()}>Salvar</Button>
        </DialogActions>
      </Dialog>

      {/* Mover arquivo para outra pasta */}
      <Dialog open={Boolean(moveTarget)} onClose={() => setMoveTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>Mover para pasta</DialogTitle>
        <DialogContent>
          <TextField select label="Pasta de destino" fullWidth sx={{ mt: 1 }}
            value={moveTarget?.folder_id ?? ""}
            onChange={(e) => setMoveTarget((t) => ({ ...t, folder_id: e.target.value }))}>
            <MenuItem value="">Raiz (sem pasta)</MenuItem>
            {allFolders.map((f) => <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>)}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveTarget(null)}>Cancelar</Button>
          <Button variant="contained" onClick={moverArquivoPasta}>Mover</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={newFolderOpen} onClose={() => setNewFolderOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Nova pasta</DialogTitle>
        <DialogContent>
          <TextField label="Nome da pasta" fullWidth autoFocus sx={{ mt: 1 }}
            value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createFolder()} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewFolderOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={createFolder} disabled={!newFolderName.trim()}>Criar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
