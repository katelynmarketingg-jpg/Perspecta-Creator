import { useEffect, useState } from "react";
import {
  Button, Card, Table, TableBody, TableCell, TableHead, TableRow, IconButton, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, MenuItem,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import api from "../api/client.js";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { currency, formatDate } from "../utils.js";

const EMPTY = { title: "", client_id: "", value: "", duration_months: "", start_date: "", first_due_date: "", status: "active", notes: "" };

export default function Contracts() {
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);

  const load = () => api.get("/contracts").then((r) => setRows(r.data));
  useEffect(() => { load(); api.get("/clients").then((r) => setClients(r.data)); }, []);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  async function save() {
    const payload = {
      ...draft,
      value: Number(draft.value) || 0,
      client_id: draft.client_id || null,
      duration_months: draft.duration_months ? Number(draft.duration_months) : null,
    };
    if (draft.id) await api.put(`/contracts/${draft.id}`, payload);
    else await api.post("/contracts", payload);
    setOpen(false);
    load();
  }
  async function remove(id) {
    if (!confirm("Excluir contrato?")) return;
    await api.delete(`/contracts/${id}`);
    load();
  }

  return (
    <>
      <PageHeader
        title="Contratos"
        subtitle="Contratos com prazo definido ou indeterminado"
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => { setDraft(EMPTY); setOpen(true); }}>Novo contrato</Button>}
      />

      {rows.length === 0 ? <EmptyState message="Nenhum contrato cadastrado." /> : (
        <Card>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Contrato</TableCell>
                <TableCell>Cliente</TableCell>
                <TableCell>Duração</TableCell>
                <TableCell>1º vencimento</TableCell>
                <TableCell align="right">Valor</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id} hover>
                  <TableCell>{c.title}</TableCell>
                  <TableCell>{c.client_name || "—"}</TableCell>
                  <TableCell>{c.duration_months ? `${c.duration_months} meses` : <Chip size="small" label="Indeterminado" />}</TableCell>
                  <TableCell>{formatDate(c.first_due_date)}</TableCell>
                  <TableCell align="right">{currency(c.value)}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => { setDraft({ ...c, client_id: c.client_id || "" }); setOpen(true); }}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => remove(c.id)}><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{draft.id ? "Editar contrato" : "Novo contrato"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Título *" value={draft.title} onChange={set("title")} fullWidth />
            <TextField select label="Cliente" value={draft.client_id} onChange={set("client_id")} fullWidth>
              <MenuItem value="">Sem cliente</MenuItem>
              {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Valor" type="number" value={draft.value} onChange={set("value")} fullWidth />
              <TextField label="Duração (meses) — vazio = indeterminado" type="number" value={draft.duration_months || ""} onChange={set("duration_months")} fullWidth />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Início" type="date" InputLabelProps={{ shrink: true }} value={draft.start_date || ""} onChange={set("start_date")} fullWidth />
              <TextField label="1º vencimento" type="date" InputLabelProps={{ shrink: true }} value={draft.first_due_date || ""} onChange={set("first_due_date")} fullWidth />
            </Stack>
            <TextField label="Observações" value={draft.notes || ""} onChange={set("notes")} fullWidth multiline rows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={save} disabled={!draft.title}>Salvar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
