import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Button, Card, CardContent, Typography, Chip, IconButton, Dialog,
  DialogTitle, DialogContent, DialogActions, TextField, Stack, MenuItem,
  Tooltip, Link, Tabs, Tab, Checkbox, LinearProgress,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import KeyIcon from "@mui/icons-material/Key";
import DescriptionIcon from "@mui/icons-material/Description";
import LinkIcon from "@mui/icons-material/Link";
import StickyNote2Icon from "@mui/icons-material/StickyNote2";
import CollectionsIcon from "@mui/icons-material/Collections";
import ChecklistIcon from "@mui/icons-material/Checklist";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import MovieIcon from "@mui/icons-material/Movie";
import CloseIcon from "@mui/icons-material/Close";
import api from "../api/client.js";
import { PageHeader, EmptyState } from "../components/ui.jsx";

const KINDS = {
  credential: { label: "Senha / acesso", icon: <KeyIcon fontSize="small" /> },
  gallery: { label: "Galeria (fotos e vídeos)", icon: <CollectionsIcon fontSize="small" /> },
  doc: { label: "Planejamento / documento", icon: <DescriptionIcon fontSize="small" /> },
  checklist: { label: "Lista de seleção", icon: <ChecklistIcon fontSize="small" /> },
  link: { label: "Link", icon: <LinkIcon fontSize="small" /> },
  note: { label: "Nota", icon: <StickyNote2Icon fontSize="small" /> },
};

const FILTERS = [
  { value: "all", label: "Todos" },
  { value: "credential", label: "🔑 Acessos" },
  { value: "gallery", label: "🖼️ Galeria" },
  { value: "doc", label: "📄 Documentos" },
  { value: "checklist", label: "✅ Listas" },
  { value: "link", label: "🔗 Links" },
  { value: "note", label: "📝 Notas" },
];

const EMPTY = {
  client_id: "", kind: "credential", title: "", content: "",
  username: "", secret: "", url: "", gallery: [], checklist: [],
};

function parseJson(str, fallback) {
  try { return JSON.parse(str) ?? fallback; } catch { return fallback; }
}

// Miniatura autenticada (imagem) ou bloco de vídeo.
function MediaThumb({ file, size = 64, onRemove }) {
  const [src, setSrc] = useState(null);
  const isImage = file.mime?.startsWith("image/");
  useEffect(() => {
    if (!isImage) return undefined;
    let url;
    api.get(`/files/${file.id}/download`, { responseType: "blob" })
      .then((r) => { url = URL.createObjectURL(r.data); setSrc(url); })
      .catch(() => {});
    return () => url && URL.revokeObjectURL(url);
  }, [file.id, isImage]);

  return (
    <Box sx={{ position: "relative", width: size, height: size, borderRadius: 1.5, overflow: "hidden", bgcolor: "action.hover", flexShrink: 0 }}>
      {isImage && src ? (
        <Box component="img" src={src} alt={file.name} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <Box sx={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
          <MovieIcon color="primary" sx={{ fontSize: size * 0.4 }} />
        </Box>
      )}
      {onRemove && (
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); onRemove(); }}
          sx={{ position: "absolute", top: 0, right: 0, bgcolor: "rgba(0,0,0,0.55)", color: "#fff", p: 0.2, "&:hover": { bgcolor: "rgba(0,0,0,0.8)" } }}>
          <CloseIcon sx={{ fontSize: 13 }} />
        </IconButton>
      )}
    </Box>
  );
}

function CredentialRow({ item }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  function copy(text) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Box sx={{ mt: 0.75 }}>
      {item.username && (
        <Typography variant="body2" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          {item.username}
          <Tooltip title="Copiar login">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); copy(item.username); }}>
              <ContentCopyIcon sx={{ fontSize: 13 }} />
            </IconButton>
          </Tooltip>
        </Typography>
      )}
      {item.secret && (
        <Typography variant="body2" sx={{ display: "flex", alignItems: "center", gap: 0.5, fontFamily: "monospace" }}>
          {show ? item.secret : "••••••••"}
          <Tooltip title={show ? "Ocultar" : "Mostrar"}>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); setShow(!show); }}>
              {show ? <VisibilityOffIcon sx={{ fontSize: 14 }} /> : <VisibilityIcon sx={{ fontSize: 14 }} />}
            </IconButton>
          </Tooltip>
          <Tooltip title={copied ? "Copiado!" : "Copiar senha"}>
            <IconButton size="small" color={copied ? "success" : "default"}
              onClick={(e) => { e.stopPropagation(); copy(item.secret); }}>
              {copied ? <CheckIcon sx={{ fontSize: 14 }} /> : <ContentCopyIcon sx={{ fontSize: 13 }} />}
            </IconButton>
          </Tooltip>
        </Typography>
      )}
    </Box>
  );
}

export default function Workspace() {
  const [clients, setClients] = useState([]);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(null); // client_id em destaque
  const galleryInputRef = useRef(null);
  const draggingRef = useRef(false);

  const load = () => api.get("/workspace").then((r) => setItems(r.data));
  useEffect(() => {
    api.get("/clients").then((r) => setClients(r.data.filter((c) => c.status === "active")));
    load();
  }, []);

  const byClient = useMemo(() => {
    const map = {};
    items
      .filter((i) => filter === "all" || i.kind === filter)
      .forEach((i) => { (map[i.client_id] ||= []).push(i); });
    return map;
  }, [items, filter]);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  function openNew(clientId) {
    setDraft({ ...EMPTY, client_id: clientId, kind: filter !== "all" ? filter : "credential" });
    setOpen(true);
  }

  function openEdit(item) {
    if (draggingRef.current) { draggingRef.current = false; return; }
    setDraft({
      ...item,
      content: item.content || "",
      username: item.username || "",
      secret: item.secret || "",
      url: item.url || "",
      gallery: item.kind === "gallery" ? parseJson(item.content, []) : [],
      checklist: item.kind === "checklist" ? parseJson(item.content, []) : [],
    });
    setOpen(true);
  }

  async function save() {
    let content = draft.content || null;
    if (draft.kind === "gallery") content = JSON.stringify(draft.gallery);
    if (draft.kind === "checklist") content = JSON.stringify(draft.checklist.filter((i) => i.text.trim()));
    const payload = {
      client_id: draft.client_id,
      kind: draft.kind,
      title: draft.title,
      content,
      username: draft.username || null,
      secret: draft.secret || null,
      url: draft.url || null,
    };
    if (draft.id) await api.put(`/workspace/${draft.id}`, payload);
    else await api.post("/workspace", payload);
    setOpen(false);
    load();
  }

  async function remove(id) {
    if (!confirm("Excluir item?")) return;
    await api.delete(`/workspace/${id}`);
    load();
  }

  // Upload de mídia da galeria — vai para os Arquivos do cliente.
  async function uploadGallery(fileList) {
    if (!fileList?.length || !draft.client_id) return;
    setUploading(true);
    try {
      const form = new FormData();
      [...fileList].forEach((f) => form.append("files", f));
      form.append("client_id", draft.client_id);
      const { data } = await api.post("/files/upload", form, { headers: { "Content-Type": "multipart/form-data" } });
      setDraft((d) => ({
        ...d,
        gallery: [...d.gallery, ...data.map((f) => ({ id: f.id, name: f.original_name, mime: f.mime }))],
      }));
    } finally {
      setUploading(false);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
  }

  // Checkbox da lista direto no card (persiste na hora).
  async function toggleCheck(item, index) {
    const list = parseJson(item.content, []);
    list[index] = { ...list[index], done: !list[index].done };
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, content: JSON.stringify(list) } : i)));
    await api.put(`/workspace/${item.id}`, { content: JSON.stringify(list) }).catch(() => load());
  }

  // ---- Arrastar e soltar (reordenar / mover de cliente) --------------------
  function handleDragStart(e, item) {
    draggingRef.current = true;
    e.dataTransfer.setData("text/plain", String(item.id));
    e.dataTransfer.effectAllowed = "move";
  }

  async function handleDrop(e, targetClientId, targetItemId = null) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);
    const id = Number(e.dataTransfer.getData("text/plain"));
    const dragged = items.find((i) => i.id === id);
    if (!dragged || (dragged.id === targetItemId)) return;

    // monta a nova ordem da coluna de destino
    const target = items.filter((i) => i.client_id === targetClientId && i.id !== id);
    let insertAt = target.length;
    if (targetItemId) {
      const idx = target.findIndex((i) => i.id === targetItemId);
      if (idx >= 0) insertAt = idx;
    }
    target.splice(insertAt, 0, { ...dragged, client_id: targetClientId });

    const moves = target.map((i, pos) => ({ id: i.id, client_id: targetClientId, position: pos }));
    // reposiciona também a coluna de origem, se mudou de cliente
    if (dragged.client_id !== targetClientId) {
      items
        .filter((i) => i.client_id === dragged.client_id && i.id !== id)
        .forEach((i, pos) => moves.push({ id: i.id, client_id: i.client_id, position: pos }));
    }

    // otimista
    setItems((prev) => {
      const rest = prev.filter((i) => i.id !== id);
      const updated = [...rest, { ...dragged, client_id: targetClientId }];
      const posMap = Object.fromEntries(moves.map((m) => [m.id, m.position]));
      return updated
        .map((i) => (posMap[i.id] !== undefined ? { ...i, position: posMap[i.id] } : i))
        .sort((a, b) => a.position - b.position || a.id - b.id);
    });
    await api.put("/workspace/reorder", { items: moves }).catch(() => load());
  }

  return (
    <>
      <PageHeader
        title="Central de Clientes"
        subtitle="Acessos, galerias, planejamentos e tudo de cada cliente — arraste para organizar"
      />

      {/* Filtros por tipo, como no Notion */}
      <Tabs value={filter} onChange={(_, v) => setFilter(v)} variant="scrollable"
        sx={{ mb: 2.5, borderBottom: 1, borderColor: "divider" }}>
        {FILTERS.map((f) => <Tab key={f.value} value={f.value} label={f.label} />)}
      </Tabs>

      {clients.length === 0 ? (
        <EmptyState message="Cadastre clientes para montar a central." />
      ) : (
        <Box sx={{ display: "flex", gap: 2, overflowX: "auto", pb: 2, alignItems: "flex-start" }}>
          {clients.map((client) => (
            <Box
              key={client.id}
              onDragOver={(e) => { e.preventDefault(); setDragOver(client.id); }}
              onDragLeave={() => setDragOver((v) => (v === client.id ? null : v))}
              onDrop={(e) => handleDrop(e, client.id)}
              sx={{
                minWidth: 300, width: 300, flexShrink: 0, borderRadius: 3, p: 1, m: -1,
                outline: "2px dashed transparent",
                transition: "background-color .15s ease, outline-color .15s ease",
                ...(dragOver === client.id && {
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.06),
                  outlineColor: (t) => alpha(t.palette.primary.main, 0.5),
                }),
              }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 0.5, mb: 1 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap sx={{ fontWeight: 700 }}>{client.name}</Typography>
                  {client.segment && (
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                      {client.segment}
                    </Typography>
                  )}
                </Box>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Chip size="small" label={(byClient[client.id] || []).length} />
                  <Tooltip title="Adicionar item">
                    <IconButton size="small" color="primary" onClick={() => openNew(client.id)}>
                      <AddIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Stack>

              <Stack spacing={1.5}>
                {(byClient[client.id] || []).map((item) => {
                  const gallery = item.kind === "gallery" ? parseJson(item.content, []) : [];
                  const checklist = item.kind === "checklist" ? parseJson(item.content, []) : [];
                  const doneCount = checklist.filter((c) => c.done).length;
                  return (
                    <Card
                      key={item.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, item)}
                      onDragEnd={() => setTimeout(() => { draggingRef.current = false; }, 50)}
                      onDrop={(e) => handleDrop(e, client.id, item.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onClick={() => openEdit(item)}
                      sx={{ cursor: "grab", "&:active": { cursor: "grabbing" }, "&:hover": { borderColor: "primary.main" }, transition: "border-color .15s ease" }}
                    >
                      <CardContent sx={{ p: 1.75, "&:last-child": { pb: 1.75 } }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                            <Box sx={{
                              width: 28, height: 28, borderRadius: 1.5, flexShrink: 0,
                              display: "grid", placeItems: "center",
                              bgcolor: (t) => alpha(t.palette.primary.main, 0.14), color: "primary.main",
                            }}>
                              {KINDS[item.kind]?.icon}
                            </Box>
                            <Typography noWrap sx={{ fontWeight: 600, fontSize: 14.5 }}>{item.title}</Typography>
                          </Stack>
                          <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); remove(item.id); }}>
                            <DeleteIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Stack>

                        {item.kind === "credential" && <CredentialRow item={item} />}

                        {item.kind === "link" && item.url && (
                          <Link href={item.url} target="_blank" rel="noopener" variant="body2"
                            onClick={(e) => e.stopPropagation()}
                            sx={{ display: "block", mt: 0.75, wordBreak: "break-all" }}>
                            {item.url}
                          </Link>
                        )}

                        {(item.kind === "doc" || item.kind === "note") && item.content && (
                          <Typography variant="body2" color="text.secondary" sx={{
                            mt: 0.75, display: "-webkit-box", WebkitLineClamp: 3,
                            WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-wrap",
                          }}>
                            {item.content}
                          </Typography>
                        )}

                        {item.kind === "gallery" && (
                          <Box sx={{ display: "flex", gap: 0.75, mt: 1, flexWrap: "wrap" }}>
                            {gallery.slice(0, 4).map((f) => <MediaThumb key={f.id} file={f} size={60} />)}
                            {gallery.length > 4 && (
                              <Box sx={{ width: 60, height: 60, borderRadius: 1.5, display: "grid", placeItems: "center", bgcolor: "action.hover", fontWeight: 700, fontSize: 13 }}>
                                +{gallery.length - 4}
                              </Box>
                            )}
                            {gallery.length === 0 && (
                              <Typography variant="caption" color="text.secondary">Galeria vazia</Typography>
                            )}
                          </Box>
                        )}

                        {item.kind === "checklist" && (
                          <Box sx={{ mt: 0.75 }}>
                            {checklist.slice(0, 4).map((c, idx) => (
                              <Stack key={idx} direction="row" alignItems="center" spacing={0.5}>
                                <Checkbox size="small" checked={!!c.done} sx={{ p: 0.4 }}
                                  onClick={(e) => { e.stopPropagation(); toggleCheck(item, idx); }} />
                                <Typography variant="body2" sx={{ textDecoration: c.done ? "line-through" : "none", color: c.done ? "text.secondary" : "text.primary" }}>
                                  {c.text}
                                </Typography>
                              </Stack>
                            ))}
                            {checklist.length > 0 && (
                              <Typography variant="caption" color="text.secondary">
                                {doneCount}/{checklist.length} concluídos
                                {checklist.length > 4 ? ` · +${checklist.length - 4} itens` : ""}
                              </Typography>
                            )}
                          </Box>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
                {(byClient[client.id] || []).length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 2 }}>
                    {filter === "all" ? "Nada aqui ainda — arraste um card para cá" : "Nada deste tipo"}
                  </Typography>
                )}
              </Stack>
            </Box>
          ))}
        </Box>
      )}

      {/* Criar / editar item */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{draft.id ? "Editar item" : "Novo item"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField select label="Tipo" value={draft.kind} onChange={set("kind")} fullWidth>
                {Object.entries(KINDS).map(([key, v]) => (
                  <MenuItem key={key} value={key}>{v.label}</MenuItem>
                ))}
              </TextField>
              <TextField select label="Cliente" value={draft.client_id} onChange={set("client_id")} fullWidth>
                {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </TextField>
            </Stack>
            <TextField label="Título *" value={draft.title} onChange={set("title")} fullWidth
              placeholder={
                draft.kind === "credential" ? "Ex: Instagram, Gmail, Canva..."
                : draft.kind === "doc" ? "Ex: Planejamento Julho/2026"
                : draft.kind === "gallery" ? "Ex: Fotos do cardápio"
                : draft.kind === "checklist" ? "Ex: Checklist de onboarding" : ""
              } />

            {draft.kind === "credential" && (
              <>
                <TextField label="Login / usuário" value={draft.username} onChange={set("username")} fullWidth />
                <TextField label="Senha" value={draft.secret} onChange={set("secret")} fullWidth
                  helperText="Guardada criptografada no servidor." />
              </>
            )}

            {draft.kind === "link" && (
              <TextField label="URL" value={draft.url} onChange={set("url")} fullWidth placeholder="https://..." />
            )}

            {(draft.kind === "doc" || draft.kind === "note") && (
              <TextField label={draft.kind === "doc" ? "Conteúdo do planejamento" : "Nota"}
                value={draft.content} onChange={set("content")} fullWidth multiline
                rows={draft.kind === "doc" ? 10 : 4} />
            )}

            {draft.kind === "gallery" && (
              <>
                {uploading && <LinearProgress sx={{ borderRadius: 2 }} />}
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  {draft.gallery.map((f, idx) => (
                    <MediaThumb key={f.id} file={f} size={76}
                      onRemove={() => setDraft((d) => ({ ...d, gallery: d.gallery.filter((_, i) => i !== idx) }))} />
                  ))}
                </Box>
                <Button variant="outlined" startIcon={<UploadFileIcon />}
                  disabled={!draft.client_id || uploading}
                  onClick={() => galleryInputRef.current?.click()}>
                  Enviar fotos / vídeos
                </Button>
                <input ref={galleryInputRef} type="file" multiple accept="image/*,video/*" hidden
                  onChange={(e) => uploadGallery(e.target.files)} />
                <Typography variant="caption" color="text.secondary">
                  Os arquivos vão para a aba Arquivos do cliente, na qualidade original.
                </Typography>
              </>
            )}

            {draft.kind === "checklist" && (
              <>
                {draft.checklist.map((c, idx) => (
                  <Stack key={idx} direction="row" spacing={1} alignItems="center">
                    <Checkbox checked={!!c.done}
                      onChange={() => setDraft((d) => ({ ...d, checklist: d.checklist.map((x, i) => i === idx ? { ...x, done: !x.done } : x) }))} />
                    <TextField size="small" fullWidth value={c.text} placeholder={`Item ${idx + 1}`}
                      onChange={(e) => setDraft((d) => ({ ...d, checklist: d.checklist.map((x, i) => i === idx ? { ...x, text: e.target.value } : x) }))} />
                    <IconButton size="small" color="error"
                      onClick={() => setDraft((d) => ({ ...d, checklist: d.checklist.filter((_, i) => i !== idx) }))}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
                <Button size="small" startIcon={<AddIcon />}
                  onClick={() => setDraft((d) => ({ ...d, checklist: [...d.checklist, { text: "", done: false }] }))}>
                  Adicionar item
                </Button>
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={save} disabled={!draft.title || !draft.client_id}>Salvar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
