import { useEffect, useState } from "react";
import {
  Button, Card, Grid, Table, TableBody, TableCell, TableHead, TableRow, IconButton,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, MenuItem, Tabs, Tab, Divider,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import Tooltip from "@mui/material/Tooltip";
import api from "../api/client.js";
import { PageHeader, StatCard } from "../components/ui.jsx";
import { currency, formatDate } from "../utils.js";

const EMPTY = { type: "income", description: "", amount: "", client_id: "", category: "", status: "pending", due_date: "" };

export default function Financial() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [clients, setClients] = useState([]);
  const [tab, setTab] = useState("all");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);

  const load = () => {
    api.get("/financial").then((r) => setRows(r.data));
    api.get("/financial/summary").then((r) => setSummary(r.data));
  };
  useEffect(() => { load(); api.get("/clients").then((r) => setClients(r.data)); }, []);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const filtered = rows.filter((r) => tab === "all" || r.type === tab);

  async function save() {
    const payload = { ...draft, amount: Number(draft.amount) || 0, client_id: draft.client_id || null };
    if (draft.id) await api.put(`/financial/${draft.id}`, payload);
    else await api.post("/financial", payload);
    setOpen(false);
    load();
  }
  async function remove(id) {
    if (!confirm("Excluir lançamento?")) return;
    await api.delete(`/financial/${id}`);
    load();
  }

  // Um clique para marcar como pago.
  async function markPaid(row) {
    await api.put(`/financial/${row.id}`, { status: "paid" });
    load();
  }

  return (
    <>
      <PageHeader
        title="Financeiro"
        subtitle="Receitas, despesas e lucro"
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => { setDraft(EMPTY); setOpen(true); }}>Novo lançamento</Button>}
      />

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Previsão de entrada" value={summary ? currency(summary.income) : undefined} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Já entrou" value={summary ? currency(summary.paidIncome) : undefined} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Falta entrar" value={summary ? currency(summary.income - summary.paidIncome) : undefined} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Lucro líquido" value={summary ? currency(summary.profit) : undefined} />
        </Grid>
      </Grid>

      <Card>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2, borderBottom: 1, borderColor: "divider" }}>
          <Tab value="all" label="Todos" />
          <Tab value="income" label="Receitas" />
          <Tab value="expense" label="Despesas" />
        </Tabs>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Descrição</TableCell>
              <TableCell>Cliente</TableCell>
              <TableCell>Vencimento</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Valor</TableCell>
              <TableCell align="right">Ações</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((f) => (
              <TableRow key={f.id} hover>
                <TableCell>{f.description}</TableCell>
                <TableCell>{f.client_name || "—"}</TableCell>
                <TableCell>{formatDate(f.due_date)}</TableCell>
                <TableCell><Chip size="small" label={f.status === "paid" ? "Pago" : "Pendente"} color={f.status === "paid" ? "success" : "warning"} /></TableCell>
                <TableCell align="right" sx={{ color: f.type === "income" ? "primary.main" : "text.secondary", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {f.type === "income" ? "+" : "−"} {currency(f.amount)}
                </TableCell>
                <TableCell align="right">
                  {f.status !== "paid" && (
                    <Tooltip title="Marcar como pago">
                      <IconButton size="small" color="success" onClick={() => markPaid(f)}>
                        <CheckCircleIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  <IconButton size="small" onClick={() => { setDraft({ ...f, client_id: f.client_id || "" }); setOpen(true); }}><EditIcon fontSize="small" /></IconButton>
                  <IconButton size="small" color="error" onClick={() => remove(f.id)}><DeleteIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} align="center" style={{ padding: 32, color: "#888" }}>Nenhum lançamento.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{draft.id ? "Editar lançamento" : "Novo lançamento"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField select label="Tipo" value={draft.type} onChange={set("type")} fullWidth>
              <MenuItem value="income">Receita</MenuItem>
              <MenuItem value="expense">Despesa</MenuItem>
            </TextField>
            <TextField label="Descrição *" value={draft.description} onChange={set("description")} fullWidth />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Valor *" type="number" value={draft.amount} onChange={set("amount")} fullWidth />
              <TextField label="Categoria" value={draft.category || ""} onChange={set("category")} fullWidth />
            </Stack>
            <TextField select label="Cliente" value={draft.client_id} onChange={set("client_id")} fullWidth>
              <MenuItem value="">Sem cliente</MenuItem>
              {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Vencimento" type="date" InputLabelProps={{ shrink: true }} value={draft.due_date || ""} onChange={set("due_date")} fullWidth />
              <TextField select label="Status" value={draft.status} onChange={set("status")} fullWidth>
                <MenuItem value="pending">Pendente</MenuItem>
                <MenuItem value="paid">Pago</MenuItem>
              </TextField>
            </Stack>

            <Divider>Pagamento pelo portal do cliente (opcional)</Divider>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Link de pagamento" value={draft.payment_link || ""} onChange={set("payment_link")} fullWidth placeholder="https://..." />
              <TextField label="URL do boleto (2ª via)" value={draft.boleto_url || ""} onChange={set("boleto_url")} fullWidth placeholder="https://..." />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Código PIX (copia e cola)" value={draft.pix_code || ""} onChange={set("pix_code")} fullWidth />
              <TextField label="URL da nota fiscal" value={draft.invoice_url || ""} onChange={set("invoice_url")} fullWidth placeholder="https://..." />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={save} disabled={!draft.description || !draft.amount}>Salvar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
