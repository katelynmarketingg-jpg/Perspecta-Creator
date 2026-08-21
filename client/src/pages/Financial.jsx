import { useEffect, useState } from "react";
import {
  Button, Card, Grid, Table, TableBody, TableCell, TableHead, TableRow, IconButton,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, MenuItem, Tabs, Tab, Divider,
  FormControlLabel, Switch, Typography,
} from "@mui/material";
import RepeatIcon from "@mui/icons-material/Repeat";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import Tooltip from "@mui/material/Tooltip";
import { Alert } from "@mui/material";
import api from "../api/client.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader, StatCard } from "../components/ui.jsx";
import { currency, formatDate } from "../utils.js";

const EMPTY = {
  type: "income", description: "", amount: "", client_id: "", category: "", status: "pending",
  due_date: "", recurring: false, recurring_day: "", months: 12,
};

// Intervalos de período. Abre no mês atual; dá para ampliar.
function periodoRange(chave) {
  const hoje = new Date();
  const ym = (d) => d.toISOString().slice(0, 10);
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  if (chave === "mes") return { from: ym(inicioMes), to: ym(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)) };
  if (chave === "proximo") return { from: ym(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1)), to: ym(new Date(hoje.getFullYear(), hoje.getMonth() + 2, 0)) };
  if (chave === "3m") return { from: ym(inicioMes), to: ym(new Date(hoje.getFullYear(), hoje.getMonth() + 3, 0)) };
  if (chave === "6m") return { from: ym(inicioMes), to: ym(new Date(hoje.getFullYear(), hoje.getMonth() + 6, 0)) };
  return {}; // tudo
}

const PERIODOS = [
  ["mes", "Este mês"], ["proximo", "Próximo mês"], ["3m", "Próximos 3 meses"],
  ["6m", "Próximos 6 meses"], ["all", "Tudo"],
];

export default function Financial() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [clients, setClients] = useState([]);
  const [renewals, setRenewals] = useState([]);
  const [tab, setTab] = useState("all");
  const [periodo, setPeriodo] = useState("mes"); // abre no mês atual
  const [mesCursor, setMesCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [flash, setFlash] = useState("");
  const [gerarOpen, setGerarOpen] = useState(false);
  const [gerarMeses, setGerarMeses] = useState(12);

  // No modo "Este mês", o mês é o do cursor (dá para andar ◀ ▶). Nos demais, o range fixo.
  const ymd = (d) => d.toISOString().slice(0, 10);
  const rangeAtual = () => periodo === "mes"
    ? {
        from: ymd(new Date(mesCursor.getFullYear(), mesCursor.getMonth(), 1)),
        to: ymd(new Date(mesCursor.getFullYear(), mesCursor.getMonth() + 1, 0)),
      }
    : periodoRange(periodo);

  const load = () => {
    const params = rangeAtual();
    api.get("/financial", { params }).then((r) => setRows(r.data));
    api.get("/financial/summary", { params }).then((r) => setSummary(r.data));
  };
  // Ao vivo: 'vFinancial' muda quando alguém lança/edita no financeiro.
  const vFinancial = useLiveVersion("financial");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [periodo, mesCursor, vFinancial]);
  useEffect(() => {
    api.get("/clients").then((r) => setClients(r.data));
    api.get("/financial/renewals").then((r) => setRenewals(r.data)).catch(() => {});
  }, []);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const filtered = rows.filter((r) => tab === "all" || r.type === tab);

  async function save() {
    const payload = { ...draft, amount: Number(draft.amount) || 0, client_id: draft.client_id || null };
    if (draft.id) {
      await api.put(`/financial/${draft.id}`, payload);
    } else if (draft.recurring) {
      // Recorrente: o backend cria uma parcela por mês.
      const r = await api.post("/financial", {
        ...payload, recurring: true,
        recurring_day: Number(draft.recurring_day) || undefined,
        months: Number(draft.months) || 12,
      });
      const n = r.data?.count || 0;
      setFlash(`Criei ${n} parcela(s) mensais no dia ${draft.recurring_day || "escolhido"}.`);
      setTimeout(() => setFlash(""), 6000);
    } else {
      await api.post("/financial", payload);
    }
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

  // Gera as mensalidades (receita recorrente) a partir do que está cadastrado
  // nos clientes: valor dos serviços + dia de pagamento. `meses` = quantos meses
  // à frente (a partir do mês em foco). Idempotente por cliente/mês.
  async function gerarMensalidades(meses) {
    const month = periodo === "mes"
      ? `${mesCursor.getFullYear()}-${String(mesCursor.getMonth() + 1).padStart(2, "0")}`
      : new Date().toISOString().slice(0, 7);
    setGerarOpen(false);
    try {
      const r = await api.post("/financial/generate-monthly", { month, months: meses });
      const escopo = meses > 1 ? `${meses} meses a partir de ${month}` : month;
      setFlash(`Mensalidades (${escopo}): ${r.data.created} criada(s), ${r.data.skipped} já existiam ou sem valor definido.`);
    } catch (e) {
      setFlash(e.response?.data?.error || "Não foi possível gerar as mensalidades.");
    }
    setTimeout(() => setFlash(""), 7000);
    load();
  }

  return (
    <>
      <PageHeader
        title="Financeiro"
        subtitle="Entradas e despesas do período"
        action={
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: "wrap", gap: 1 }}>
            {periodo === "mes" && (
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <IconButton size="small" onClick={() => setMesCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}>
                  <ChevronLeftIcon />
                </IconButton>
                <Typography variant="body2" sx={{ minWidth: 118, textAlign: "center", fontWeight: 600, textTransform: "capitalize" }}>
                  {mesCursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
                </Typography>
                <IconButton size="small" onClick={() => setMesCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}>
                  <ChevronRightIcon />
                </IconButton>
              </Stack>
            )}
            <TextField select size="small" value={periodo} onChange={(e) => setPeriodo(e.target.value)} sx={{ minWidth: 160 }}>
              {PERIODOS.map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}
            </TextField>
            <Tooltip title="Puxa a mensalidade de cada cliente (valor + dia de pagamento cadastrados) como receita recorrente">
              <Button variant="outlined" startIcon={<RepeatIcon />} onClick={() => setGerarOpen(true)}>Gerar mensalidades</Button>
            </Tooltip>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setDraft(EMPTY); setOpen(true); }}>Lançar</Button>
          </Stack>
        }
      />

      {flash && <Alert severity="success" sx={{ mb: 2.5 }}>{flash}</Alert>}

      {/* Contratos encerrando no próximo mês */}
      {renewals.length > 0 && (
        <Alert severity="warning" icon={<EventBusyIcon />} sx={{ mb: 2.5 }}>
          <strong>{renewals.length === 1 ? "1 contrato encerra" : `${renewals.length} contratos encerram`} no próximo mês</strong> —
          hora de conversar e renovar:{" "}
          {renewals.map((r) => `${r.name} (${formatDate(r.work_end)})`).join(", ")}.
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={4} md={2}>
          <StatCard label="Previsão de entrada" value={summary ? currency(summary.income) : undefined} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <StatCard label="A receber" value={summary ? currency(Math.max(0, (summary.income || 0) - (summary.paidIncome || 0))) : undefined} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <StatCard label="Já entrou" value={summary ? currency(summary.paidIncome) : undefined} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <StatCard label="Despesas previstas" value={summary ? currency(summary.expense) : undefined} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <StatCard label="A pagar" value={summary ? currency(Math.max(0, (summary.expense || 0) - (summary.paidExpense || 0))) : undefined} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <StatCard label="Lucro realizado" value={summary ? currency(summary.lucroRealizado) : undefined} />
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
                <TableCell>
                  {f.description}
                  {f.recurring ? (
                    <Chip size="small" variant="outlined" icon={<RepeatIcon sx={{ fontSize: 14 }} />}
                      label="Mensal" sx={{ ml: 1, height: 20 }} />
                  ) : null}
                </TableCell>
                <TableCell>{f.client_name || "—"}</TableCell>
                <TableCell>{formatDate(f.due_date)}</TableCell>
                <TableCell><Chip size="small" label={f.status === "paid" ? "Pago" : "Pendente"} color={f.status === "paid" ? "success" : "warning"} /></TableCell>
                <TableCell align="right" sx={{ color: f.type === "income" ? "primary.main" : "text.secondary", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {f.type === "income" ? "+" : "−"} {currency(f.amount)}
                </TableCell>
                <TableCell align="right">
                  {f.status !== "paid" && (
                    <Tooltip title={f.type === "income" ? "Marcar como recebido" : "Marcar como pago"}>
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

      {/* Gerar mensalidades recorrentes a partir dos clientes cadastrados */}
      <Dialog open={gerarOpen} onClose={() => setGerarOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Gerar mensalidades</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Vou puxar cada cliente ativo com valor cadastrado e lançar a mensalidade como
              receita prevista, no dia de pagamento de cada um. Já existentes não são duplicadas.
            </Typography>
            <TextField select label="Por quantos meses" value={gerarMeses}
              onChange={(e) => setGerarMeses(Number(e.target.value))} fullWidth
              helperText="A partir do mês em foco. Mais de 1 mês fica marcado como 'Mensal'.">
              <MenuItem value={1}>Somente este mês</MenuItem>
              <MenuItem value={3}>Próximos 3 meses</MenuItem>
              <MenuItem value={6}>Próximos 6 meses</MenuItem>
              <MenuItem value={12}>Próximos 12 meses</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGerarOpen(false)}>Cancelar</Button>
          <Button variant="contained" startIcon={<RepeatIcon />} onClick={() => gerarMensalidades(gerarMeses)}>
            Gerar
          </Button>
        </DialogActions>
      </Dialog>

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

            {/* Recorrência mensal — só ao criar um lançamento novo. */}
            {!draft.id && (
              <>
                <FormControlLabel
                  control={
                    <Switch checked={!!draft.recurring}
                      onChange={(e) => setDraft((d) => ({ ...d, recurring: e.target.checked }))} />
                  }
                  label="Repetir todo mês"
                />
                {draft.recurring && (
                  <Stack spacing={1}>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField label="Dia do mês" type="number" inputProps={{ min: 1, max: 31 }}
                        value={draft.recurring_day}
                        onChange={(e) => setDraft((d) => ({ ...d, recurring_day: e.target.value }))}
                        fullWidth helperText="Ex.: 10 = todo dia 10" />
                      <TextField label="Por quantos meses" type="number" inputProps={{ min: 1, max: 36 }}
                        value={draft.months}
                        onChange={(e) => setDraft((d) => ({ ...d, months: e.target.value }))}
                        fullWidth helperText="Cria uma parcela por mês" />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      Vou criar {Number(draft.months) || 12} lançamento(s), um por mês, sempre no dia{" "}
                      {draft.recurring_day || "informado"}. Cada um pode ser editado ou excluído depois.
                    </Typography>
                  </Stack>
                )}
              </>
            )}

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
