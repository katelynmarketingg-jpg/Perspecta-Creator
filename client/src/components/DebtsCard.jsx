import { useEffect, useState } from "react";
import {
  Card, CardContent, Typography, Stack, Button, IconButton, TextField, Box,
  LinearProgress, Collapse, Dialog, DialogTitle, DialogContent, DialogActions, Tooltip, Chip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import PaidIcon from "@mui/icons-material/Paid";
import api from "../api/client.js";
import { currency } from "../utils.js";

// ---------------------------------------------------------------------------
// DÍVIDAS pessoais — "estou devendo pra fulano e vou pagando aos poucos".
// Fica na aba Minhas Finanças (privada por login). Separada das contas do mês:
// cada dívida tem um total e pagamentos parciais que abatem o saldo.
// ---------------------------------------------------------------------------
export default function DebtsCard() {
  const [debts, setDebts] = useState([]);
  const [open, setOpen] = useState({});         // dívidas expandidas
  const [novo, setNovo] = useState(null);        // { name, total, note }
  const [pgto, setPgto] = useState({});          // rascunho de pagamento por dívida

  const load = () => api.get("/personal-finance/debts").then((r) => setDebts(r.data || [])).catch(() => setDebts([]));
  useEffect(() => { load(); }, []);

  async function criar() {
    if (!novo?.name?.trim()) return;
    await api.post("/personal-finance/debts", { name: novo.name.trim(), total: Number(novo.total) || 0, note: novo.note });
    setNovo(null); load();
  }
  async function excluir(d) {
    if (!confirm(`Apagar a dívida com "${d.name}" e todos os pagamentos dela?`)) return;
    await api.delete(`/personal-finance/debts/${d.id}`); load();
  }
  async function pagar(d) {
    const val = Number(pgto[d.id]?.amount) || 0;
    if (val <= 0) return;
    await api.post(`/personal-finance/debts/${d.id}/payments`, { amount: val, note: pgto[d.id]?.note, paid_on: pgto[d.id]?.paid_on });
    setPgto((p) => ({ ...p, [d.id]: {} })); load();
  }
  async function apagarPagamento(d, p) {
    await api.delete(`/personal-finance/debts/${d.id}/payments/${p.id}`); load();
  }

  const totalDevendo = debts.reduce((s, d) => s + (d.saldo || 0), 0);

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <PaidIcon color="primary" />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Dívidas — o que eu devo</Typography>
            <Typography variant="caption" color="text.secondary">
              O que você deve pra alguém (mãe, João do Score…) e vai pagando aos poucos. Só você vê.
            </Typography>
          </Box>
          {debts.length > 0 && (
            <Chip color={totalDevendo > 0 ? "warning" : "success"} label={`Devendo: ${currency(totalDevendo)}`} sx={{ fontWeight: 700 }} />
          )}
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setNovo({ name: "", total: "", note: "" })}>
            Nova dívida
          </Button>
        </Stack>

        {debts.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            Nenhuma dívida por aqui. Clique em <b>Nova dívida</b> pra registrar algo que você deve e ir abatendo.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {debts.map((d) => {
              const pct = d.total > 0 ? Math.min(100, Math.round((d.pago / d.total) * 100)) : 0;
              const aberto = open[d.id];
              return (
                <Box key={d.id} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.25 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
                        <Typography sx={{ fontWeight: 700 }} noWrap>{d.name}</Typography>
                        {d.quitada && <Chip size="small" color="success" label="Quitada 🎉" sx={{ height: 20 }} />}
                        {d.note && <Typography variant="caption" color="text.secondary" noWrap>· {d.note}</Typography>}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        Devia {currency(d.total)} · pagou {currency(d.pago)} · <b>falta {currency(d.saldo)}</b>
                      </Typography>
                      <LinearProgress variant="determinate" value={pct} color={d.quitada ? "success" : "primary"}
                        sx={{ mt: 0.5, height: 7, borderRadius: 3 }} />
                    </Box>
                    <Tooltip title="Ver pagamentos">
                      <IconButton size="small" onClick={() => setOpen((o) => ({ ...o, [d.id]: !o[d.id] }))}>
                        {aberto ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Apagar dívida">
                      <IconButton size="small" color="error" onClick={() => excluir(d)}><DeleteIcon sx={{ fontSize: 18 }} /></IconButton>
                    </Tooltip>
                  </Stack>

                  <Collapse in={aberto}>
                    <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: "divider" }}>
                      {/* Lançar um pagamento */}
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} sx={{ mb: 1 }}>
                        <TextField size="small" type="number" label="Paguei (R$)" value={pgto[d.id]?.amount || ""}
                          onChange={(e) => setPgto((p) => ({ ...p, [d.id]: { ...p[d.id], amount: e.target.value } }))} sx={{ width: 130 }} />
                        <TextField size="small" type="date" label="Quando" InputLabelProps={{ shrink: true }} value={pgto[d.id]?.paid_on || ""}
                          onChange={(e) => setPgto((p) => ({ ...p, [d.id]: { ...p[d.id], paid_on: e.target.value } }))} sx={{ width: 160 }} />
                        <TextField size="small" label="Obs. (opcional)" value={pgto[d.id]?.note || ""}
                          onChange={(e) => setPgto((p) => ({ ...p, [d.id]: { ...p[d.id], note: e.target.value } }))} sx={{ flex: 1 }} />
                        <Button size="small" variant="outlined" onClick={() => pagar(d)}
                          disabled={!(Number(pgto[d.id]?.amount) > 0)}>Lançar</Button>
                      </Stack>
                      {/* Histórico de pagamentos */}
                      {d.payments.length === 0 ? (
                        <Typography variant="caption" color="text.secondary">Nenhum pagamento ainda.</Typography>
                      ) : (
                        <Stack spacing={0.5}>
                          {d.payments.map((p) => (
                            <Stack key={p.id} direction="row" alignItems="center" spacing={1}>
                              <Typography variant="caption" sx={{ fontWeight: 600, minWidth: 84 }}>{currency(p.amount)}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                {p.paid_on ? new Date(p.paid_on + "T00:00").toLocaleDateString("pt-BR") : ""}
                                {p.note ? ` · ${p.note}` : ""}
                              </Typography>
                              <Box sx={{ flex: 1 }} />
                              <IconButton size="small" onClick={() => apagarPagamento(d, p)}><DeleteIcon sx={{ fontSize: 15 }} /></IconButton>
                            </Stack>
                          ))}
                        </Stack>
                      )}
                    </Box>
                  </Collapse>
                </Box>
              );
            })}
          </Stack>
        )}
      </CardContent>

      {/* Nova dívida */}
      <Dialog open={Boolean(novo)} onClose={() => setNovo(null)} fullWidth maxWidth="xs">
        <DialogTitle>Nova dívida</DialogTitle>
        <DialogContent>
          {novo && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField label="Pra quem você deve *" autoFocus value={novo.name} placeholder="Mãe, João do Score…"
                onChange={(e) => setNovo((n) => ({ ...n, name: e.target.value }))} fullWidth />
              <TextField label="Quanto era a dívida (R$)" type="number" value={novo.total}
                onChange={(e) => setNovo((n) => ({ ...n, total: e.target.value }))} fullWidth />
              <TextField label="Do que é (opcional)" value={novo.note}
                onChange={(e) => setNovo((n) => ({ ...n, note: e.target.value }))} fullWidth
                placeholder="Ex.: compras no cartão dela" />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNovo(null)}>Cancelar</Button>
          <Button variant="contained" onClick={criar} disabled={!novo?.name?.trim()}>Criar</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
