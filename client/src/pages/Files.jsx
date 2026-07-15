import { useEffect, useRef, useState } from "react";
import {
  Box, Button, Card, CardContent, Typography, IconButton, Stack, TextField,
  MenuItem, Breadcrumbs, Link, Table, TableBody, TableCell, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, LinearProgress, Grid, Tooltip,
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
import api from "../api/client.js";
import { PageHeader } from "../components/ui.jsx";
import { fileSize, formatDateTime } from "../utils.js";

function fileIcon(mime = "") {
  if (mime.startsWith("image/")) return <ImageIcon color="primary" />;
  if (mime.startsWith("video/")) return <MovieIcon color="primary" />;
  return <InsertDriveFileIcon color="disabled" />;
}

export default function Files() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [path, setPath] = useState([]); // breadcrumb: [{id, name}]
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  const currentFolder = path[path.length - 1]?.id || null;

  useEffect(() => { api.get("/clients").then((r) => setClients(r.data)); }, []);

  const load = () => {
    const params = {};
    if (clientId) params.client_id = clientId;
    if (currentFolder) params.folder_id = currentFolder;
    api.get("/files/folders", { params }).then((r) => setFolders(r.data));
    api.get("/files", { params }).then((r) => setFiles(r.data));
  };
  useEffect(() => { load(); }, [clientId, currentFolder]);

  function selectClient(id) {
    setClientId(id);
    setPath([]);
  }

  async function createFolder() {
    if (!newFolderName.trim()) return;
    await api.post("/files/folders", {
      name: newFolderName.trim(),
      client_id: clientId || null,
      parent_id: currentFolder,
    });
    setNewFolderName("");
    setNewFolderOpen(false);
    load();
  }

  async function removeFolder(id) {
    if (!confirm("Excluir pasta e todo o conteúdo dela?")) return;
    await api.delete(`/files/folders/${id}`);
    load();
  }

  async function uploadFiles(fileList) {
    if (!fileList?.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      [...fileList].forEach((f) => form.append("files", f));
      if (clientId) form.append("client_id", clientId);
      if (currentFolder) form.append("folder_id", currentFolder);
      await api.post("/files/upload", form, { headers: { "Content-Type": "multipart/form-data" } });
      load();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removeFile(id) {
    if (!confirm("Excluir arquivo?")) return;
    await api.delete(`/files/${id}`);
    load();
  }

  function download(file) {
    // O download vem byte a byte do original — sem compressão, sem perda.
    const token = localStorage.getItem("token");
    fetch(`/api/files/${file.id}/download`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.original_name;
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  return (
    <>
      <PageHeader
        title="Arquivos"
        subtitle="Materiais por cliente — enviados e baixados na qualidade original"
        action={
          <Stack direction="row" spacing={1.5}>
            <Button variant="outlined" startIcon={<CreateNewFolderIcon />} onClick={() => setNewFolderOpen(true)}>
              Nova pasta
            </Button>
            <Button variant="contained" startIcon={<UploadFileIcon />} onClick={() => inputRef.current?.click()}>
              Enviar arquivos
            </Button>
            <input ref={inputRef} type="file" multiple hidden onChange={(e) => uploadFiles(e.target.files)} />
          </Stack>
        }
      />

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} sx={{ mb: 2.5 }}>
        <TextField select size="small" label="Cliente" value={clientId}
          onChange={(e) => selectClient(e.target.value)} sx={{ minWidth: 200 }}>
          <MenuItem value="">Geral (todos)</MenuItem>
          {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
        </TextField>
        <Breadcrumbs>
          <Link component="button" underline="hover" color={path.length ? "primary" : "text.primary"}
            onClick={() => setPath([])}>
            Início
          </Link>
          {path.map((p, i) => (
            <Link key={p.id} component="button" underline="hover"
              color={i === path.length - 1 ? "text.primary" : "primary"}
              onClick={() => setPath(path.slice(0, i + 1))}>
              {p.name}
            </Link>
          ))}
        </Breadcrumbs>
      </Stack>

      {uploading && <LinearProgress sx={{ mb: 2, borderRadius: 2 }} />}

      {/* Pastas */}
      {folders.length > 0 && (
        <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
          {folders.map((f) => (
            <Grid item xs={6} sm={4} md={3} lg={2} key={f.id}>
              <Card
                onClick={() => setPath([...path, { id: f.id, name: f.name }])}
                sx={{
                  cursor: "pointer", transition: "border-color .15s ease, background-color .15s ease",
                  "&:hover": { borderColor: "primary.main", bgcolor: (t) => alpha(t.palette.primary.main, 0.04) },
                }}
              >
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

      {/* Arquivos */}
      <Card
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); uploadFiles(e.dataTransfer.files); }}
      >
        {files.length === 0 ? (
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <UploadFileIcon sx={{ fontSize: 40, color: "text.secondary", mb: 1 }} />
            <Typography color="text.secondary">
              Nenhum arquivo aqui. Arraste arquivos para esta área ou use "Enviar arquivos".
            </Typography>
          </CardContent>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Arquivo</TableCell>
                <TableCell>Tamanho</TableCell>
                <TableCell>Enviado em</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {files.map((f) => (
                <TableRow key={f.id} hover>
                  <TableCell>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      {fileIcon(f.mime)}
                      <Typography sx={{ fontWeight: 500 }}>{f.original_name}</Typography>
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ fontVariantNumeric: "tabular-nums" }}>{fileSize(f.size)}</TableCell>
                  <TableCell>{formatDateTime(f.created_at)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Baixar original">
                      <IconButton size="small" color="primary" onClick={() => download(f)}>
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <IconButton size="small" color="error" onClick={() => removeFile(f.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Nova pasta */}
      <Dialog open={newFolderOpen} onClose={() => setNewFolderOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Nova pasta</DialogTitle>
        <DialogContent>
          <TextField
            label="Nome da pasta" fullWidth autoFocus sx={{ mt: 1 }}
            value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createFolder()}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewFolderOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={createFolder} disabled={!newFolderName.trim()}>Criar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
