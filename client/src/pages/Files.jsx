import { useEffect, useRef, useState } from "react";
import {
  Box, Button, Card, CardContent, Typography, IconButton, Stack, TextField,
  MenuItem, Breadcrumbs, Link, Table, TableBody, TableCell, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, LinearProgress, Grid, Tooltip,
  Tabs, Tab, Chip, Menu,
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
import api from "../api/client.js";
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
function FileCard({ f, onDownload, onDelete, onMove }) {
  const [src, setSrc] = useState(null);
  const [anchor, setAnchor] = useState(null);
  const ehImg = f.mime?.startsWith("image/");
  useEffect(() => {
    if (!ehImg) return undefined;
    let url; let vivo = true;
    authFetchBlob(f.id).then((b) => { if (vivo) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => {});
    return () => { vivo = false; if (url) URL.revokeObjectURL(url); };
  }, [f.id, ehImg]);

  return (
    <Card variant="outlined" sx={{ overflow: "hidden" }}>
      <Box sx={{ position: "relative", aspectRatio: "1", bgcolor: "action.hover", display: "grid", placeItems: "center" }}>
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
          <Tooltip title="Mover de etapa">
            <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)}><DriveFileMoveIcon sx={{ fontSize: 17 }} /></IconButton>
          </Tooltip>
          <Tooltip title="Excluir">
            <IconButton size="small" color="error" onClick={() => onDelete(f.id)}><DeleteIcon sx={{ fontSize: 17 }} /></IconButton>
          </Tooltip>
        </Stack>
      </Box>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {STAGES.filter((s) => s.key !== f.stage).map((s) => (
          <MenuItem key={s.key} onClick={() => { setAnchor(null); onMove(f.id, s.key); }}>
            {s.emoji} Mover para {s.label}
          </MenuItem>
        ))}
      </Menu>
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
  useEffect(() => { loadBoard(); }, [clientId]);
  useEffect(() => { loadDocs(); }, [clientId, currentFolder]);

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
        title="Arquivos"
        subtitle="Material por cliente, em etapas — enviado e baixado na qualidade original"
      />

      <TextField select size="small" label="Cliente" value={clientId}
        onChange={(e) => selectClient(e.target.value)} sx={{ minWidth: 240, mb: 2.5 }}>
        <MenuItem value="">Selecione um cliente…</MenuItem>
        {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
      </TextField>

      {!clientId ? (
        <Card><CardContent sx={{ textAlign: "center", py: 6 }}>
          <FolderIcon sx={{ fontSize: 40, color: "text.secondary", mb: 1 }} />
          <Typography color="text.secondary">Escolha um cliente para ver as pastas por etapa e os documentos.</Typography>
        </CardContent></Card>
      ) : (
        <>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
            <Tab value="etapas" label="Etapas do material" />
            <Tab value="docs" label="Documentos" />
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
              <Stack direction="row" spacing={1.5} sx={{ mb: 2 }} alignItems="center">
                <Button variant="outlined" startIcon={<CreateNewFolderIcon />} onClick={() => setNewFolderOpen(true)}>Nova pasta</Button>
                <Button variant="contained" startIcon={<UploadFileIcon />} onClick={() => docInputRef.current?.click()}
                  disabled={!currentFolder}>Enviar para a pasta</Button>
                <input ref={docInputRef} type="file" multiple hidden onChange={(e) => enviarDocs(e.target.files)} />
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

              <Card>
                {!currentFolder ? (
                  <CardContent sx={{ textAlign: "center", py: 5 }}>
                    <Typography color="text.secondary">Abra uma pasta para ver e enviar documentos, ou crie uma nova.</Typography>
                  </CardContent>
                ) : files.length === 0 ? (
                  <CardContent sx={{ textAlign: "center", py: 5 }}>
                    <Typography color="text.secondary">Pasta vazia. Use "Enviar para a pasta".</Typography>
                  </CardContent>
                ) : (
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Arquivo</TableCell><TableCell>Tamanho</TableCell>
                        <TableCell>Enviado em</TableCell><TableCell align="right">Ações</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {files.map((f) => (
                        <TableRow key={f.id} hover>
                          <TableCell>
                            <Stack direction="row" spacing={1.5} alignItems="center">
                              {fileIcon(f.mime)}<Typography sx={{ fontWeight: 500 }}>{f.original_name}</Typography>
                            </Stack>
                          </TableCell>
                          <TableCell>{fileSize(f.size)}</TableCell>
                          <TableCell>{formatDateTime(f.created_at)}</TableCell>
                          <TableCell align="right">
                            <IconButton size="small" color="primary" onClick={() => download(f)}><DownloadIcon fontSize="small" /></IconButton>
                            <IconButton size="small" color="error" onClick={() => removeFile(f.id, loadDocs)}><DeleteIcon fontSize="small" /></IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>
            </>
          )}
        </>
      )}

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
