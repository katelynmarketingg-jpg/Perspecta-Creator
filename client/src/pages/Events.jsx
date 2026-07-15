import { useEffect, useState } from "react";
import {
  Button, Card, Table, TableBody, TableCell, TableHead, TableRow, IconButton, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, MenuItem, Box, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import api from "../api/client.js";
import { PageHeader, EmptyState } from "../components/ui.jsx";

const EMPTY = { title: "", type_id: "", client_id: "", start_at: "", end_at: "", notes: "" };

export default function Events() {
  const [rows, setRows] = useState([]);
  const [types, setTypes] = useState([]);
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [newType, setNewType] = useState("");

  const load = () => api.get("/events").then((r) => setRows(r.data));
  const loadTypes = () => api.get("/events/types").then((r) => setTypes(r.data));
  useEffect(() => { load(); loadTypes(); api.get("/clients").then((r) => setClients(r.data)); }, []);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  async function save() {
    const payload = { ...draft, type_id: draft.type_id || null, client_id: draft.client_id || null };
    if (draft.id) await api.put(`/events/${draft.id}`, payload);
    else await api.post("/events", payload);
    setOpen(false);
    load();
  }
  async function remove(id) {
    if (!confirm("Excluir evento?")) return;
    await api.delete(`/events/${id}`);
    load();
  }
  async function addType() {
    if (!newType.trim()) return;
    await api.post("/events/types", { name: newType.trim() });
    setNewType("");
    loadTypes();
  }

  const fmt = (v) => (v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

  return (
    <>
      <PageHeader
        title="Eventos"
        subtitle="Reuniões, entregas e marcos"
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => { setDraft(EMPTY); setOpen(true); }}>Criar evento</Button>}
      />

      <Card sx={{ p: 2, mb: 2.5 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Tipos de evento</Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
          {types.map((t) => <Chip key={t.id} label={t.name} sx={{ bgcolor: t.color, color: "#fff" }}
            onDelete={async () => { await api.delete(`/events/types/${t.id}`); loadTypes(); }} />)}
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <TextField size="small" placeholder="Novo tipo" value={newType} onChange={(e) => setNewType(e.target.value)} />
            <Button size="small" onClick={addType}>Adicionar</Button>
          </Box>
        </Stack>
      </Card>

      {rows.length === 0 ? <EmptyState message="Nenhum evento cadastrado." /> : (
        <Card>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Evento</TableCell>
                <TableCell>Tipo</TableCell>
                <TableCell>Cliente</TableCell>
                <TableCell>Início</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id} hover>
                  <TableCell>{e.title}</TableCell>
                  <TableCell>{e.type_name ? <Chip size="small" label={e.type_name} sx={{ bgcolor: e.type_color, color: "#fff" }} /> : "—"}</TableCell>
                  <TableCell>{e.client_name || "—"}</TableCell>
                  <TableCell>{fmt(e.start_at)}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => { setDraft({ ...e, type_id: e.type_id || "", client_id: e.client_id || "" }); setOpen(true); }}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => remove(e.id)}><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{draft.id ? "Editar evento" : "Criar evento"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Título *" value={draft.title} onChange={set("title")} fullWidth />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField select label="Tipo" value={draft.type_id} onChange={set("type_id")} fullWidth>
                <MenuItem value="">Sem tipo</MenuItem>
                {types.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
              </TextField>
              <TextField select label="Cliente" value={draft.client_id} onChange={set("client_id")} fullWidth>
                <MenuItem value="">Sem cliente</MenuItem>
                {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </TextField>
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Início *" type="datetime-local" InputLabelProps={{ shrink: true }} value={draft.start_at || ""} onChange={set("start_at")} fullWidth />
              <TextField label="Fim" type="datetime-local" InputLabelProps={{ shrink: true }} value={draft.end_at || ""} onChange={set("end_at")} fullWidth />
            </Stack>
            <TextField label="Observações" value={draft.notes || ""} onChange={set("notes")} fullWidth multiline rows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={save} disabled={!draft.title || !draft.start_at}>Salvar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
