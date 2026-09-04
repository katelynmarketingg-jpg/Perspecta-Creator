import { useEffect, useRef, useState } from "react";
import {
  Box, Button, Card, CardContent, Typography, IconButton, Stack, TextField,
  MenuItem, Breadcrumbs, Link, Dialog, DialogTitle, DialogContent, DialogActions,
  Grid, Tooltip, Menu, Alert,
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
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import DriveFileMoveIcon from "@mui/icons-material/DriveFileMove";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import api from "../api/client.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { useUploads } from "../upload/UploadContext.jsx";
import { PageHeader } from "../components/ui.jsx";
import { fileSize } from "../utils.js";

// Ordem lógica das pastas padrão (as que nascem dentro de cada cliente).
const DEFAULT_ORDER = ["Originais", "Editados", "Para aprovação", "Aprovados", "Programados"];
function ordenarPastas(arr) {
  const pos = (nome) => { const i = DEFAULT_ORDER.indexOf(nome); return i === -1 ? 999 : i; };
  return [...arr].sort((a, b) => {
    const pa = pos(a.name), pb = pos(b.name);
    if (pa !== pb) return pa - pb;            // padrão primeiro, na ordem certa
    return a.name.localeCompare(b.name, "pt"); // o resto, alfabético
  });
}

function fileIcon(mime = "") {
  if (mime.startsWith("image/")) return <ImageIcon color="primary" />;
  if (mime.startsWith("video/")) return <MovieIcon color="primary" />;
  return <InsertDriveFileIcon color="disabled" />;
}

function authFetchBlob(id) {
  const token = localStorage.getItem("token");
  return fetch(`/api/files/${id}/download`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.blob());
}

// Cartão de um arquivo: a prévia sai NA PROPORÇÃO REAL da foto/vídeo (retrato de
// reel fica em pé, paisagem fica deitado). A grade usa a MINIATURA leve gerada
// no envio — antes cada quadradinho baixava o arquivo original inteiro, o que
// deixava a tela lenta e vídeo grande nem desenhava. Clicar abre o arquivo de
// verdade, em tamanho grande e sem baixar.
// O nome fica embaixo e é editável com UM CLIQUE (clica fora ou Enter → salva).
function FileCard({ f, onDownload, onDelete, onSaveName, onMoveFolder }) {
  const [moreAnchor, setMoreAnchor] = useState(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(f.original_name || "");
  const [viewing, setViewing] = useState(false);
  const ehImg = f.mime?.startsWith("image/");
  const ehVideo = f.mime?.startsWith("video/");
  useEffect(() => { setName(f.original_name || ""); }, [f.original_name]);

  function salvar() {
    setEditing(false);
    const novo = name.trim();
    if (novo && novo !== f.original_name && onSaveName) onSaveName(f.id, novo);
    else setName(f.original_name || "");
  }

  const podeAbrir = (ehImg || ehVideo) && f.media_url;
  // Miniatura quando existe (arquivos enviados a partir de agora); senão, o
  // original — assim o que já está lá continua aparecendo.
  const previa = f.thumb || f.media_url;
  const midiaSx = { width: "100%", height: "auto", maxHeight: 280, objectFit: "contain", display: "block", bgcolor: ehVideo ? "#000" : "action.hover" };

  return (
    <Card variant="outlined" sx={{ overflow: "hidden" }}>
      <Box sx={{ position: "relative", minHeight: 90, bgcolor: "action.hover", display: "grid", placeItems: "center",
        cursor: podeAbrir ? "zoom-in" : "default" }}
        onClick={() => podeAbrir && setViewing(true)}>
        {ehImg && previa ? (
          <Box component="img" src={previa} alt={f.original_name} loading="lazy" sx={midiaSx} />
        ) : ehVideo && f.thumb ? (
          <>
            <Box component="img" src={f.thumb} alt={f.original_name} loading="lazy" sx={midiaSx} />
            <PlayCircleIcon sx={{ position: "absolute", fontSize: 44, color: "rgba(255,255,255,0.92)",
              filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.6))", pointerEvents: "none" }} />
          </>
        ) : ehVideo && f.media_url ? (
          // Vídeo antigo (sem miniatura): mostra o 1º quadro, como antes.
          <>
            <Box component="video" src={`${f.media_url}#t=0.1`} preload="metadata" muted playsInline sx={midiaSx} />
            <PlayCircleIcon sx={{ position: "absolute", fontSize: 44, color: "rgba(255,255,255,0.92)",
              filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.6))", pointerEvents: "none" }} />
          </>
        ) : (
          <Box sx={{ py: 2 }}>{fileIcon(f.mime)}</Box>
        )}
      </Box>
      <Box sx={{ p: 1 }}>
        {editing ? (
          <TextField value={name} onChange={(e) => setName(e.target.value)} autoFocus fullWidth variant="standard"
            onBlur={salvar}
            onKeyDown={(e) => { if (e.key === "Enter") salvar(); if (e.key === "Escape") { setName(f.original_name || ""); setEditing(false); } }}
            inputProps={{ style: { fontSize: 12, fontWeight: 600 } }} />
        ) : (
          <Tooltip title="Clique no nome para renomear">
            <Typography noWrap variant="caption" onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              sx={{ display: "block", fontWeight: 600, cursor: "text", "&:hover": { textDecoration: "underline dotted" } }}>
              {f.original_name || "Sem nome"}
            </Typography>
          </Tooltip>
        )}
        <Typography variant="caption" color="text.secondary">{fileSize(f.size)}</Typography>
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
          <Tooltip title="Baixar original">
            <IconButton size="small" color="primary" onClick={() => onDownload(f)}><DownloadIcon sx={{ fontSize: 17 }} /></IconButton>
          </Tooltip>
          {onMoveFolder && (
            <Tooltip title="Mover para pasta">
              <IconButton size="small" onClick={(e) => setMoreAnchor(e.currentTarget)}><MoreVertIcon sx={{ fontSize: 17 }} /></IconButton>
            </Tooltip>
          )}
          <Tooltip title="Excluir">
            <IconButton size="small" color="error" onClick={() => onDelete(f.id)}><DeleteIcon sx={{ fontSize: 17 }} /></IconButton>
          </Tooltip>
        </Stack>
      </Box>
      {onMoveFolder && (
        <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
          <MenuItem onClick={() => { setMoreAnchor(null); onMoveFolder(f); }}>
            <DriveFileMoveIcon sx={{ fontSize: 17, mr: 1 }} /> Mover para pasta
          </MenuItem>
        </Menu>
      )}
      {/* Abrir em tela cheia: foto amplia, vídeo toca (na proporção real). */}
      <Dialog open={viewing} onClose={() => setViewing(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ pr: 6 }}>
          {f.original_name}
          <IconButton onClick={() => setViewing(false)} sx={{ position: "absolute", right: 8, top: 8 }}>✕</IconButton>
        </DialogTitle>
        <DialogContent sx={{ display: "grid", placeItems: "center", bgcolor: "#000", p: 1 }}>
          {ehVideo ? (
            <Box component="video" src={f.media_url} controls autoPlay playsInline
              sx={{ width: "100%", maxHeight: "72vh", objectFit: "contain" }} />
          ) : (
            <Box component="img" src={f.media_url} alt={f.original_name}
              sx={{ width: "100%", maxHeight: "72vh", objectFit: "contain" }} />
          )}
        </DialogContent>
        <DialogActions>
          <Button startIcon={<DownloadIcon />} onClick={() => onDownload(f)}>Baixar original</Button>
          <Button onClick={() => setViewing(false)}>Fechar</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

export default function Files() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  // Navegação por pastas: trilha [{id,name}], pastas e arquivos da pasta atual.
  const [path, setPath] = useState([]);
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [uploadingZip, setUploadingZip] = useState(false);
  const { enqueue } = useUploads();
  const docInputRef = useRef(null);
  const zipInputRef = useRef(null);
  const [zipMsg, setZipMsg] = useState("");
  const [allFolders, setAllFolders] = useState([]); // todas as pastas do cliente (p/ mover)
  const [moveTarget, setMoveTarget] = useState(null); // { id, folder_id }

  const currentFolder = path[path.length - 1]?.id || null;

  useEffect(() => { api.get("/clients").then((r) => setClients(r.data)); }, []);

  const loadDocs = () => {
    if (!clientId) { setFolders([]); setFiles([]); return; }
    // Pastas da pasta atual (na raiz, as sem "pai").
    const fParams = { client_id: clientId };
    if (currentFolder) fParams.parent_id = currentFolder;
    api.get("/files/folders", { params: fParams }).then((r) => setFolders(ordenarPastas(r.data))).catch(() => setFolders([]));
    // Arquivos da pasta atual (na raiz, os "soltos" sem pasta).
    const aParams = { client_id: clientId };
    if (currentFolder) aParams.folder_id = currentFolder;
    api.get("/files", { params: aParams }).then((r) => setFiles(r.data)).catch(() => setFiles([]));
  };
  const loadAllFolders = () => {
    if (!clientId) { setAllFolders([]); return; }
    api.get("/files/folders", { params: { client_id: clientId, all: 1 } }).then((r) => setAllFolders(r.data)).catch(() => setAllFolders([]));
  };
  // Ao abrir um cliente, garante as pastas padrão (Originais, Editados…) dentro dele.
  useEffect(() => {
    if (!clientId) return;
    api.post("/files/folders/ensure-defaults", { client_id: clientId }).then(loadDocs).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  // Ao vivo: 'vFiles' muda quando alguém envia/move/apaga arquivos.
  const vFiles = useLiveVersion("files");
  useEffect(() => { loadDocs(); }, [clientId, currentFolder, vFiles]);
  useEffect(() => { loadAllFolders(); }, [clientId, vFiles]);

  // Renomear direto pelo nome embaixo da foto (inline). Atualiza na hora.
  async function salvarNome(id, nome) {
    setFiles((prev) => prev.map((x) => (x.id === id ? { ...x, original_name: nome } : x)));
    try { await api.put(`/files/${id}`, { original_name: nome }); }
    catch { loadDocs(); }
  }
  async function moverArquivoPasta() {
    await api.put(`/files/${moveTarget.id}`, { folder_id: moveTarget.folder_id || null });
    setMoveTarget(null); loadDocs();
  }

  function selectClient(id) { setClientId(id); setPath([]); }

  // ---- Pastas ----
  async function createFolder() {
    if (!newFolderName.trim()) return;
    await api.post("/files/folders", { name: newFolderName.trim(), client_id: clientId || null, parent_id: currentFolder });
    setNewFolderName(""); setNewFolderOpen(false); loadDocs();
  }
  async function removeFolder(id) {
    if (!confirm("Excluir pasta e todo o conteúdo dela?")) return;
    await api.delete(`/files/folders/${id}`); loadDocs();
  }
  // Envia em SEGUNDO PLANO: solta os arquivos na fila e retorna na hora. A Katelyn
  // pode sair da galeria e seguir usando o sistema; o painel no canto mostra o
  // progresso e, ao terminar, o canal ao vivo recarrega esta tela sozinho.
  function enviarDocs(fileList) {
    if (!fileList?.length) return;
    enqueue(fileList, { clientId: clientId || null, folderId: currentFolder || null });
    if (docInputRef.current) docInputRef.current.value = "";
  }

  // ---- Importar em massa por .ZIP (para a pasta atual) ----
  async function enviarZip(file) {
    if (!file) return;
    setUploadingZip(true);
    setZipMsg("Importando o .ZIP… pode continuar usando o sistema.");
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
      setUploadingZip(false);
      if (zipInputRef.current) zipInputRef.current.value = "";
      setTimeout(() => setZipMsg(""), 8000);
    }
  }

  async function removeFile(id) {
    if (!confirm("Excluir arquivo?")) return;
    await api.delete(`/files/${id}`); loadDocs();
  }
  function download(file) {
    authFetchBlob(file.id).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = file.original_name; a.click();
      URL.revokeObjectURL(url);
    });
  }

  const vazio = folders.length === 0 && files.length === 0;

  return (
    <>
      <PageHeader
        title="Galeria"
        subtitle="Material por cliente, em pastas que você cria — enviado e baixado na qualidade original"
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

          <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: "wrap", gap: 1 }} alignItems="center">
            <Button variant="outlined" startIcon={<CreateNewFolderIcon />} onClick={() => setNewFolderOpen(true)}>Nova pasta</Button>
            <Button variant="contained" startIcon={<UploadFileIcon />} onClick={() => docInputRef.current?.click()}>
              {currentFolder ? "Enviar para a pasta" : "Enviar arquivo"}
            </Button>
            <input ref={docInputRef} type="file" multiple hidden onChange={(e) => enviarDocs(e.target.files)} />
            <Tooltip title="Envie um .ZIP com fotos/vídeos — importa tudo de uma vez para aqui">
              <Button variant="outlined" startIcon={<DriveFileMoveIcon />} disabled={uploadingZip} onClick={() => zipInputRef.current?.click()}>Importar .ZIP</Button>
            </Tooltip>
            <input ref={zipInputRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => enviarZip(e.target.files?.[0])} />
            <Breadcrumbs>
              <Link component="button" underline="hover" color={path.length ? "primary" : "text.primary"} onClick={() => setPath([])}>Início</Link>
              {path.map((p, i) => (
                <Link key={p.id} component="button" underline="hover"
                  color={i === path.length - 1 ? "text.primary" : "primary"}
                  onClick={() => setPath(path.slice(0, i + 1))}>{p.name}</Link>
              ))}
            </Breadcrumbs>
          </Stack>

          {zipMsg && <Alert severity="info" sx={{ mb: 2 }}>{zipMsg}</Alert>}

          {/* Pastas */}
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

          {/* Arquivos da pasta atual (na raiz, os soltos) */}
          {files.length > 0 && (
            <Grid container spacing={1.5}>
              {files.map((f) => (
                <Grid item xs={4} sm={3} md={2} key={f.id}>
                  <FileCard f={f} onDownload={download}
                    onDelete={removeFile}
                    onSaveName={salvarNome}
                    onMoveFolder={(file) => setMoveTarget({ id: file.id, folder_id: file.folder_id || "" })} />
                </Grid>
              ))}
            </Grid>
          )}

          {vazio && (
            <Card><CardContent sx={{ textAlign: "center", py: 5 }}>
              <Typography color="text.secondary">
                {currentFolder
                  ? 'Pasta vazia. Use "Enviar para a pasta" ou "Importar .ZIP".'
                  : 'Crie uma pasta com "Nova pasta" ou envie um arquivo direto para começar.'}
              </Typography>
            </CardContent></Card>
          )}
        </>
      )}


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
