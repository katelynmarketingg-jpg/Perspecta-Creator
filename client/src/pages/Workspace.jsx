import { useEffect, useRef, useState } from "react";
import {
  Box, Button, Card, CardContent, Typography, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, Stack, MenuItem, Tooltip, Chip, Link,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import KeyIcon from "@mui/icons-material/Key";
import LinkIcon from "@mui/icons-material/Link";
import StickyNote2Icon from "@mui/icons-material/StickyNote2";
import ImageIcon from "@mui/icons-material/Image";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import api from "../api/client.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader, EmptyState } from "../components/ui.jsx";

// A Central é enxuta: por cliente, só o essencial — banner, notas e acessos
// (galeria, planejamento etc. vivem nas próprias abas).
const KINDS = {
  credential: { label: "Acesso", icon: <KeyIcon fontSize="small" />, color: "#EA580C" },
  link: { label: "Link", icon: <LinkIcon fontSize="small" />, color: "#2563EB" },
  note: { label: "Nota", icon: <StickyNote2Icon fontSize="small" />, color: "#7C3AED" },
};

function authBlob(id) {
  const token = localStorage.getItem("token");
  return fetch(`/api/files/${id}/download`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.blob() : Promise.reject()));
}

// Imagem do banner do cliente (autenticada).
function Banner({ fileId, height = 150 }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    setSrc(null);
    if (!fileId) return undefined;
    let url, vivo = true;
    authBlob(fileId).then((b) => { if (vivo) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => {});
    return () => { vivo = false; if (url) URL.revokeObjectURL(url); };
  }, [fileId]);
  return (
    <Box sx={{ height, bgcolor: "action.hover", borderRadius: 2, overflow: "hidden", display: "grid", placeItems: "center" }}>
      {src ? <Box component="img" src={src} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : <ImageIcon sx={{ fontSize: 40, color: "text.disabled" }} />}
    </Box>
  );
}

// Campo de senha com mostrar/copiar.
function Secret({ value }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!value) return <Typography variant="body2" color="text.secondary">—</Typography>;
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Typography variant="body2" sx={{ fontFamily: "monospace" }}>{show ? value : "••••••••"}</Typography>
      <IconButton size="small" onClick={() => setShow((s) => !s)}>{show ? <VisibilityOffIcon sx={{ fontSize: 16 }} /> : <VisibilityIcon sx={{ fontSize: 16 }} />}</IconButton>
      <Tooltip title={copied ? "Copiado!" : "Copiar"}>
        <IconButton size="small" onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? <CheckIcon sx={{ fontSize: 16 }} color="success" /> : <ContentCopyIcon sx={{ fontSize: 16 }} />}
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

const EMPTY_ITEM = { kind: "credential", title: "", username: "", secret: "", url: "", content: "" };

export default function Workspace() {
  const [clients, setClients] = useState([]);
  const [sel, setSel] = useState(null);       // cliente selecionado
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState(null);   // item em edição
  const [notas, setNotas] = useState("");
  const bannerInput = useRef(null);

  const vClients = useLiveVersion("clients");
  const load = () => api.get("/clients").then((r) => setClients(r.data)).catch(() => {});
  useEffect(() => { load(); }, [vClients]);

  // Mantém o cliente selecionado sincronizado com a lista.
  useEffect(() => {
    if (!sel) return;
    const fresh = clients.find((c) => c.id === sel.id);
    if (fresh) { setSel(fresh); setNotas(fresh.notes || ""); }
  }, [clients]); // eslint-disable-line react-hooks/exhaustive-deps

  const vWork = useLiveVersion("workspace");
  useEffect(() => {
    if (!sel) { setItems([]); return; }
    api.get("/workspace", { params: { client_id: sel.id } }).then((r) => setItems(r.data)).catch(() => setItems([]));
  }, [sel?.id, vWork]);

  function abrir(c) { setSel(c); setNotas(c.notes || ""); }

  async function salvarNotas() {
    if (!sel) return;
    await api.put(`/clients/${sel.id}`, { notes: notas }).catch(() => {});
  }

  async function enviarBanner(file) {
    if (!file || !sel) return;
    const fd = new FormData();
    fd.append("files", file);
    fd.append("client_id", sel.id);
    const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
    const fid = data?.[0]?.id;
    if (fid) { await api.put(`/clients/${sel.id}/banner`, { banner_file_id: fid }); load(); }
  }

  async function salvarItem() {
    if (!draft.title.trim()) return;
    const payload = { ...draft, client_id: sel.id };
    if (draft.id) await api.put(`/workspace/${draft.id}`, payload);
    else await api.post("/workspace", payload);
    setDraft(null);
    api.get("/workspace", { params: { client_id: sel.id } }).then((r) => setItems(r.data));
  }
  async function excluirItem(id) {
    if (!confirm("Excluir este item?")) return;
    await api.delete(`/workspace/${id}`);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  // Só os tipos enxutos da Central.
  const acessos = items.filter((i) => i.kind === "credential");
  const links = items.filter((i) => i.kind === "link");
  const notasItens = items.filter((i) => i.kind === "note");

  // ---------- Lista de clientes ----------
  if (!sel) {
    return (
      <>
        <PageHeader title="Central" subtitle="O essencial de cada cliente — acessos, notas e banner" />
        {clients.length === 0 ? (
          <EmptyState message="Nenhum cliente ainda. Cadastre em Clientes." />
        ) : (
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)" } }}>
            {clients.map((c) => (
              <Card key={c.id} onClick={() => abrir(c)}
                sx={{ cursor: "pointer", overflow: "hidden", "&:hover": { borderColor: "primary.main" }, border: 1, borderColor: "divider" }}>
                <Banner fileId={c.banner_file_id} height={110} />
                <CardContent sx={{ py: 1.5 }}>
                  <Typography sx={{ fontWeight: 700 }} noWrap>{c.name}</Typography>
                  {c.company && <Typography variant="caption" color="text.secondary" noWrap>{c.company}</Typography>}
                </CardContent>
              </Card>
            ))}
          </Box>
        )}
      </>
    );
  }

  // ---------- Detalhe do cliente ----------
  return (
    <>
      <Button size="small" onClick={() => setSel(null)} sx={{ mb: 1 }}>← Todos os clientes</Button>
      <PageHeader title={sel.name} subtitle={sel.company || "Central do cliente"}
        action={
          <Button variant="outlined" startIcon={<ImageIcon />} onClick={() => bannerInput.current?.click()}>
            {sel.banner_file_id ? "Trocar banner" : "Adicionar banner"}
          </Button>
        } />
      <input ref={bannerInput} type="file" accept="image/*" hidden onChange={(e) => enviarBanner(e.target.files?.[0])} />

      <Banner fileId={sel.banner_file_id} height={180} />

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, mt: 2 }}>
        {/* Notas */}
        <Card>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>📝 Notas</Typography>
            <TextField multiline minRows={5} fullWidth value={notas}
              onChange={(e) => setNotas(e.target.value)} onBlur={salvarNotas}
              placeholder="Anotações importantes deste cliente (some ao clicar fora = salvo)." />
          </CardContent>
        </Card>

        {/* Acessos */}
        <Card>
          <CardContent>
            <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>🔑 Acessos</Typography>
              <Button size="small" startIcon={<AddIcon />} onClick={() => setDraft({ ...EMPTY_ITEM, kind: "credential" })}>Novo</Button>
            </Stack>
            <Stack spacing={1}>
              {acessos.map((it) => (
                <Box key={it.id} sx={{ p: 1, border: 1, borderColor: "divider", borderRadius: 1.5 }}>
                  <Stack direction="row" alignItems="center">
                    <Typography sx={{ fontWeight: 600, flex: 1 }}>{it.title}</Typography>
                    <IconButton size="small" onClick={() => setDraft({ ...it })}><EditIcon sx={{ fontSize: 16 }} /></IconButton>
                    <IconButton size="small" color="error" onClick={() => excluirItem(it.id)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                  </Stack>
                  {it.username && <Typography variant="body2" color="text.secondary">login: {it.username}</Typography>}
                  <Secret value={it.secret} />
                </Box>
              ))}
              {acessos.length === 0 && <Typography variant="body2" color="text.secondary">Nenhum acesso salvo.</Typography>}
            </Stack>
          </CardContent>
        </Card>

        {/* Links */}
        <Card>
          <CardContent>
            <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>🔗 Links</Typography>
              <Button size="small" startIcon={<AddIcon />} onClick={() => setDraft({ ...EMPTY_ITEM, kind: "link" })}>Novo</Button>
            </Stack>
            <Stack spacing={1}>
              {links.map((it) => (
                <Stack key={it.id} direction="row" alignItems="center" spacing={1}>
                  <LinkIcon fontSize="small" color="primary" />
                  <Link href={it.url} target="_blank" rel="noreferrer" sx={{ flex: 1 }} noWrap>{it.title}</Link>
                  <IconButton size="small" onClick={() => setDraft({ ...it })}><EditIcon sx={{ fontSize: 16 }} /></IconButton>
                  <IconButton size="small" color="error" onClick={() => excluirItem(it.id)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                </Stack>
              ))}
              {links.length === 0 && <Typography variant="body2" color="text.secondary">Nenhum link.</Typography>}
            </Stack>
          </CardContent>
        </Card>

        {/* Recados / notas soltas */}
        <Card>
          <CardContent>
            <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>📌 Lembretes</Typography>
              <Button size="small" startIcon={<AddIcon />} onClick={() => setDraft({ ...EMPTY_ITEM, kind: "note" })}>Novo</Button>
            </Stack>
            <Stack spacing={1}>
              {notasItens.map((it) => (
                <Box key={it.id} sx={{ p: 1, border: 1, borderColor: "divider", borderRadius: 1.5 }}>
                  <Stack direction="row" alignItems="center">
                    <Typography sx={{ fontWeight: 600, flex: 1 }}>{it.title}</Typography>
                    <IconButton size="small" onClick={() => setDraft({ ...it })}><EditIcon sx={{ fontSize: 16 }} /></IconButton>
                    <IconButton size="small" color="error" onClick={() => excluirItem(it.id)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                  </Stack>
                  {it.content && <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>{it.content}</Typography>}
                </Box>
              ))}
              {notasItens.length === 0 && <Typography variant="body2" color="text.secondary">Nenhum lembrete.</Typography>}
            </Stack>
          </CardContent>
        </Card>
      </Box>

      {/* Dialog de item */}
      <Dialog open={Boolean(draft)} onClose={() => setDraft(null)} fullWidth maxWidth="xs">
        <DialogTitle>{draft?.id ? "Editar" : "Novo"} {KINDS[draft?.kind]?.label?.toLowerCase()}</DialogTitle>
        <DialogContent>
          {draft && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField label="Título *" value={draft.title} autoFocus fullWidth
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
              {draft.kind === "credential" && (
                <>
                  <TextField label="Login" value={draft.username} fullWidth autoComplete="off"
                    onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))} />
                  <TextField label="Senha" value={draft.secret} fullWidth autoComplete="new-password"
                    onChange={(e) => setDraft((d) => ({ ...d, secret: e.target.value }))} />
                </>
              )}
              {draft.kind === "link" && (
                <TextField label="URL" value={draft.url} fullWidth placeholder="https://..."
                  onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))} />
              )}
              {draft.kind === "note" && (
                <TextField label="Texto" value={draft.content} fullWidth multiline minRows={3}
                  onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))} />
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>Cancelar</Button>
          <Button variant="contained" onClick={salvarItem} disabled={!draft?.title?.trim()}>Salvar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
