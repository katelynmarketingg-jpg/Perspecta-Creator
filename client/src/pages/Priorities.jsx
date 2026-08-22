import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Card, CardContent, Typography, Stack, Button, IconButton, Chip, TextField,
  MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, Tooltip, Avatar,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import FlagIcon from "@mui/icons-material/Flag";
import api from "../api/client.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader, EmptyState } from "../components/ui.jsx";

const COLUMNS = [
  { key: "pending", label: "Pendente" },
  { key: "doing", label: "Em andamento" },
  { key: "done", label: "Concluído" },
];
const LEVELS = [
  { key: "alta", label: "Alta", color: "#DC2626" },
  { key: "media", label: "Média", color: "#D97706" },
  { key: "baixa", label: "Baixa", color: "#6B7280" },
];
const levelOf = (k) => LEVELS.find((l) => l.key === k) || LEVELS[1];

const iniciais = (nome) => (nome || "?").split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();

function PriorityCard({ p, onDragStart, onEdit, onDelete }) {
  const lv = levelOf(p.level);
  return (
    <Card variant="outlined" draggable onDragStart={onDragStart}
      sx={{ cursor: "grab", "&:active": { cursor: "grabbing" }, borderLeft: 4, borderLeftColor: lv.color }}>
      <CardContent sx={{ p: 1.25, "&:last-child": { pb: 1.25 } }}>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5, flexWrap: "wrap", gap: 0.5 }}>
          <Chip size="small" label={lv.label} sx={{ bgcolor: lv.color, color: "#fff", fontWeight: 700, height: 20 }} />
          {p.client_name && <Chip size="small" variant="outlined" label={p.client_name} sx={{ height: 20 }} />}
          <Box sx={{ flex: 1 }} />
          <IconButton size="small" onClick={() => onEdit(p)}><EditIcon sx={{ fontSize: 15 }} /></IconButton>
          <IconButton size="small" color="error" onClick={() => onDelete(p.id)}><DeleteIcon sx={{ fontSize: 15 }} /></IconButton>
        </Stack>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mb: 0.75 }}>{p.message}</Typography>
        <Stack direction="row" spacing={0.75} alignItems="center">
          {p.assignee_name ? (
            <Tooltip title={`Para ${p.assignee_name}`}>
              <Avatar sx={{ width: 22, height: 22, fontSize: 10, bgcolor: "primary.main" }}>{iniciais(p.assignee_name)}</Avatar>
            </Tooltip>
          ) : (
            <Chip size="small" variant="outlined" label="Sem responsável" sx={{ height: 20 }} />
          )}
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} noWrap>
            {p.assignee_name ? `para ${p.assignee_name}` : ""}{p.creator_name ? ` · por ${p.creator_name}` : ""}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function Priorities() {
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [filtroPessoa, setFiltroPessoa] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const dragId = useRef(null);

  const load = () => {
    const params = filtroPessoa ? { assignee_id: filtroPessoa } : {};
    api.get("/priorities", { params }).then((r) => setRows(r.data)).catch(() => setRows([]));
  };
  const vPri = useLiveVersion("priorities");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [filtroPessoa, vPri]);
  useEffect(() => {
    api.get("/clients").then((r) => setClients(r.data)).catch(() => {});
    api.get("/users/team").then((r) => setUsers(r.data)).catch(() => {});
  }, []);

  const porColuna = useMemo(() => {
    const map = { pending: [], doing: [], done: [] };
    rows.forEach((p) => { (map[p.status] || map.pending).push(p); });
    return map;
  }, [rows]);

  function novo() { setDraft({ client_id: "", message: "", level: "media", assignee_id: "" }); setOpen(true); }
  function editar(p) { setDraft({ id: p.id, client_id: p.client_id || "", message: p.message, level: p.level, assignee_id: p.assignee_id || "" }); setOpen(true); }

  async function salvar() {
    const payload = { ...draft, client_id: draft.client_id || null, assignee_id: draft.assignee_id || null };
    if (draft.id) await api.put(`/priorities/${draft.id}`, payload);
    else await api.post("/priorities", payload);
    setOpen(false); setDraft(null); load();
  }
  async function excluir(id) {
    if (!confirm("Excluir este recado?")) return;
    await api.delete(`/priorities/${id}`); load();
  }
  async function mover(id, status) {
    await api.put(`/priorities/${id}/status`, { status });
    load();
  }

  return (
    <>
      <PageHeader title="Prioridades" subtitle="O que é prioridade em cada cliente e para quem — recado interno da equipe"
        action={
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: "wrap", gap: 1 }}>
            <TextField select size="small" label="Para quem" value={filtroPessoa}
              onChange={(e) => setFiltroPessoa(e.target.value)} sx={{ minWidth: 160 }}>
              <MenuItem value="">Todos</MenuItem>
              {users.map((u) => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
            </TextField>
            <Button variant="contained" startIcon={<AddIcon />} onClick={novo}>Nova prioridade</Button>
          </Stack>
        } />

      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, alignItems: "start" }}>
        {COLUMNS.map((col) => (
          <Card key={col.key} sx={{ bgcolor: "action.hover" }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragId.current) { mover(dragId.current, col.key); dragId.current = null; } }}>
            <CardContent sx={{ p: 1.5 }}>
              <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1 }}>
                <FlagIcon fontSize="small" color={col.key === "done" ? "success" : col.key === "doing" ? "warning" : "action"} />
                <Typography sx={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{col.label}</Typography>
                <Chip size="small" label={porColuna[col.key].length} />
              </Stack>
              <Stack spacing={1}>
                {porColuna[col.key].map((p) => (
                  <PriorityCard key={p.id} p={p}
                    onDragStart={() => { dragId.current = p.id; }}
                    onEdit={editar} onDelete={excluir} />
                ))}
                {porColuna[col.key].length === 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center", py: 1 }}>
                    {col.key === "pending" ? "Nada aqui. Clique em “Nova prioridade”." : "Vazio"}
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Box>

      {rows.length === 0 && (
        <Box sx={{ mt: 2 }}>
          <EmptyState message="Arraste os cards entre as colunas conforme a equipe vai resolvendo. Comece criando uma prioridade." />
        </Box>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{draft?.id ? "Editar prioridade" : "Nova prioridade"}</DialogTitle>
        <DialogContent>
          {draft && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField select label="Cliente" value={draft.client_id}
                onChange={(e) => setDraft((d) => ({ ...d, client_id: e.target.value }))} fullWidth>
                <MenuItem value="">Geral (sem cliente específico)</MenuItem>
                {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </TextField>
              <TextField label="Recado / por que é prioridade *" value={draft.message} autoFocus multiline minRows={2} fullWidth
                onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))}
                placeholder="Ex: cliente novo, caprichar no primeiro mês; ou: campanha de Dia dos Pais é prioridade." />
              <TextField select label="Nível" value={draft.level}
                onChange={(e) => setDraft((d) => ({ ...d, level: e.target.value }))} fullWidth>
                {LEVELS.map((l) => (
                  <MenuItem key={l.key} value={l.key}>
                    <Box component="span" sx={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", bgcolor: l.color, mr: 1 }} />
                    {l.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select label="Para quem" value={draft.assignee_id}
                onChange={(e) => setDraft((d) => ({ ...d, assignee_id: e.target.value }))} fullWidth>
                <MenuItem value="">Sem responsável</MenuItem>
                {users.map((u) => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
              </TextField>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={salvar} disabled={!draft?.message?.trim()}>Salvar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
