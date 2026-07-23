import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Button, Card, CardContent, Typography, Chip, IconButton, Stack, Grid,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Divider, Tooltip,
  Alert, MenuItem, FormControlLabel, Switch,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import LoginIcon from "@mui/icons-material/Login";
import DeleteIcon from "@mui/icons-material/Delete";
import BlockIcon from "@mui/icons-material/Block";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PriceChangeIcon from "@mui/icons-material/PriceChange";
import api from "../api/client.js";
import { PageHeader } from "../components/ui.jsx";
import { currency } from "../utils.js";
import { useAuth } from "../auth/AuthContext.jsx";

const EMPTY = { name: "", admin_name: "", admin_username: "", admin_password: "", notes: "", whatsapp: "", plan_id: "" };
const STATUS = {
  master: { label: "Master", color: "primary" },
  pagante: { label: "Pagante", color: "success" },
  teste: { label: "Em teste", color: "warning" },
  expirado: { label: "Teste expirado", color: "error" },
};

export default function Organizations() {
  const { enterOrg } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [revenue, setRevenue] = useState(null);
  const [plans, setPlans] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [created, setCreated] = useState("");
  const [manage, setManage] = useState(null);   // agência sendo gerida
  const [plansOpen, setPlansOpen] = useState(false);
  const [planDraft, setPlanDraft] = useState(null);

  const load = () => {
    api.get("/organizations").then((r) => setRows(r.data)).catch(() => {});
    api.get("/organizations/revenue").then((r) => setRevenue(r.data)).catch(() => {});
    api.get("/plans").then((r) => setPlans(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  async function salvarPlano() {
    if (planDraft.id) await api.put(`/plans/${planDraft.id}`, planDraft);
    else await api.post("/plans", planDraft);
    setPlanDraft(null);
    load();
  }
  async function removerPlano(id) {
    if (!confirm("Excluir plano? As agências ficam sem plano.")) return;
    await api.delete(`/plans/${id}`);
    load();
  }
  async function salvarGestao() {
    await api.put(`/organizations/${manage.id}`, {
      plan_id: manage.plan_id || null,
      whatsapp: manage.whatsapp || null,
      billing_active: manage.billing_active,
      trial_ends: manage.trial_ends || null,
    });
    setManage(null);
    load();
  }
  async function estenderTeste(org) {
    await api.post(`/organizations/${org.id}/extend-trial`, { days: 15 });
    load();
  }

  async function save() {
    await api.post("/organizations", draft);
    setCreated(`${draft.name} criado. ${draft.admin_username} já pode entrar com a senha definida.`);
    setTimeout(() => setCreated(""), 8000);
    setDraft(EMPTY);
    setOpen(false);
    load();
  }

  async function toggleActive(org) {
    await api.put(`/organizations/${org.id}`, { active: !org.active });
    load();
  }

  async function remove(org) {
    if (!confirm(`Excluir ${org.name} e TODOS os dados desse escritório? Isso não tem volta.`)) return;
    await api.delete(`/organizations/${org.id}`);
    load();
  }

  function enter(org) {
    enterOrg({ id: org.id, name: org.name });
    navigate("/");
  }

  return (
    <>
      <PageHeader
        title="Escritórios"
        subtitle="Todas as agências que usam o sistema"
        action={
          <Stack direction="row" spacing={1.5}>
            <Button variant="outlined" startIcon={<PriceChangeIcon />} onClick={() => setPlansOpen(true)}>Planos</Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setDraft(EMPTY); setOpen(true); }}>
              Novo escritório
            </Button>
          </Stack>
        }
      />

      {created && <Alert severity="success" sx={{ mb: 2 }}>{created}</Alert>}

      {/* Receita do Perspecta Media */}
      {revenue && (
        <Grid container spacing={2.5} sx={{ mb: 3 }}>
          <Grid item xs={6} md={3}>
            <Card><CardContent>
              <Typography variant="h5" sx={{ fontVariantNumeric: "tabular-nums" }}>{currency(revenue.mrr)}</Typography>
              <Typography variant="body2" color="text.secondary">Entra por mês (pagantes)</Typography>
            </CardContent></Card>
          </Grid>
          <Grid item xs={6} md={3}>
            <Card><CardContent>
              <Typography variant="h5" sx={{ fontVariantNumeric: "tabular-nums" }}>{currency(revenue.previsto)}</Typography>
              <Typography variant="body2" color="text.secondary">Previsto (se testes converterem)</Typography>
            </CardContent></Card>
          </Grid>
          <Grid item xs={6} md={3}>
            <Card><CardContent>
              <Typography variant="h5" sx={{ fontVariantNumeric: "tabular-nums" }}>{revenue.pagantes}</Typography>
              <Typography variant="body2" color="text.secondary">Agências pagantes</Typography>
            </CardContent></Card>
          </Grid>
          <Grid item xs={6} md={3}>
            <Card><CardContent>
              <Typography variant="h5" sx={{ fontVariantNumeric: "tabular-nums" }}>{revenue.em_teste}</Typography>
              <Typography variant="body2" color="text.secondary">Em teste grátis</Typography>
            </CardContent></Card>
          </Grid>
        </Grid>
      )}

      <Grid container spacing={2.5}>
        {rows.map((o) => (
          <Grid item xs={12} sm={6} md={4} key={o.id}>
            <Card sx={{ height: "100%", opacity: o.active ? 1 : 0.6 }}>
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" noWrap sx={{ letterSpacing: "-0.02em" }}>{o.name}</Typography>
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
                      <Chip size="small" color={STATUS[o.subscription]?.color} label={STATUS[o.subscription]?.label} />
                      {!o.is_master && o.plan_name && <Chip size="small" variant="outlined" label={o.plan_name} />}
                      {o.subscription === "teste" && o.trial_days_left != null && (
                        <Chip size="small" variant="outlined" color="warning" label={`${o.trial_days_left}d de teste`} />
                      )}
                    </Stack>
                  </Box>
                  {!o.is_master && (
                    <Box>
                      <Tooltip title={o.active ? "Desativar" : "Reativar"}>
                        <IconButton size="small" onClick={() => toggleActive(o)}>
                          {o.active ? <BlockIcon fontSize="small" /> : <CheckCircleIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                      <IconButton size="small" color="error" onClick={() => remove(o)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  )}
                </Stack>

                {!o.is_master && (
                  <>
                    <Divider sx={{ my: 1.5 }} />
                    <Stack direction="row" spacing={2.5} sx={{ mb: 1.5, flexWrap: "wrap" }}>
                      <Box>
                        <Typography variant="h6" sx={{ lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{o.clients_count}</Typography>
                        <Typography variant="caption" color="text.secondary">clientes</Typography>
                      </Box>
                      <Box>
                        <Typography variant="h6" sx={{ lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{o.users_count}</Typography>
                        <Typography variant="caption" color="text.secondary">na equipe</Typography>
                      </Box>
                      <Box>
                        <Typography variant="h6" sx={{ lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{o.tasks_count}</Typography>
                        <Typography variant="caption" color="text.secondary">tarefas</Typography>
                      </Box>
                    </Stack>
                    <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: (t) => alpha(t.palette.primary.main, 0.09), mb: 1.5 }}>
                      <Typography variant="caption" color="text.secondary">
                        {o.plan_price ? "Assinatura" : "Sem plano"}
                      </Typography>
                      <Typography sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {o.plan_price ? `${currency(o.plan_price)}/mês` : "—"}
                      </Typography>
                    </Box>
                    {o.whatsapp && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                        📱 <a href={`https://wa.me/${o.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener" style={{ color: "inherit" }}>{o.whatsapp}</a>
                      </Typography>
                    )}
                    <Stack direction="row" spacing={1}>
                      <Button fullWidth size="small" variant="outlined" onClick={() => setManage({ ...o, plan_id: o.plan_id || "", billing_active: !!o.billing_active })}>
                        Gerenciar
                      </Button>
                      <Button fullWidth size="small" variant="contained" startIcon={<LoginIcon />} onClick={() => enter(o)}>
                        Entrar
                      </Button>
                    </Stack>
                  </>
                )}
                {Boolean(o.is_master) && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Este é o seu acesso. Daqui você administra todos os escritórios.
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Novo escritório</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Nome do escritório *" value={draft.name} onChange={set("name")} fullWidth
              placeholder="Ex: Estúdio Norte" helperText="É o que a pessoa digita no login." />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="WhatsApp (contato)" value={draft.whatsapp} onChange={set("whatsapp")} fullWidth
                placeholder="(51) 99999-9999" helperText="Para confirmar e acompanhar o teste." />
              <TextField select label="Plano" value={draft.plan_id} onChange={set("plan_id")} fullWidth>
                <MenuItem value="">Definir depois</MenuItem>
                {plans.filter((p) => p.active).map((p) => (
                  <MenuItem key={p.id} value={p.id}>{p.name} — {currency(p.price)}</MenuItem>
                ))}
              </TextField>
            </Stack>
            <Divider>Primeiro acesso</Divider>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Nome de quem entra" value={draft.admin_username} onChange={set("admin_username")}
                fullWidth placeholder="Bruno" />
              <TextField label="Senha" value={draft.admin_password} onChange={set("admin_password")} fullWidth />
            </Stack>
            <TextField label="Observações" value={draft.notes} onChange={set("notes")} fullWidth multiline rows={2} />
            <Alert severity="info">Todo escritório começa com 30 dias de teste grátis.</Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={save} disabled={!draft.name}>Criar</Button>
        </DialogActions>
      </Dialog>

      {/* Gerenciar assinatura de uma agência */}
      <Dialog open={Boolean(manage)} onClose={() => setManage(null)} fullWidth maxWidth="xs">
        <DialogTitle>Gerenciar — {manage?.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
              <Chip label={`${manage?.clients_count} clientes`} variant="outlined" />
              <Chip label={`${manage?.users_count} pessoas`} variant="outlined" />
              <Chip label={STATUS[manage?.subscription]?.label} color={STATUS[manage?.subscription]?.color} />
            </Stack>
            <TextField select label="Plano" value={manage?.plan_id || ""}
              onChange={(e) => setManage((m) => ({ ...m, plan_id: e.target.value }))} fullWidth>
              <MenuItem value="">Sem plano</MenuItem>
              {plans.map((p) => (
                <MenuItem key={p.id} value={p.id}>{p.name} — {currency(p.price)}{p.max_users ? ` (até ${p.max_users})` : ""}</MenuItem>
              ))}
            </TextField>
            <TextField label="WhatsApp" value={manage?.whatsapp || ""}
              onChange={(e) => setManage((m) => ({ ...m, whatsapp: e.target.value }))} fullWidth />
            <FormControlLabel
              control={<Switch checked={!!manage?.billing_active}
                onChange={(e) => setManage((m) => ({ ...m, billing_active: e.target.checked }))} />}
              label="Já é pagante (converteu o teste)" />
            {manage?.subscription === "teste" && (
              <Button size="small" onClick={() => { estenderTeste(manage); setManage(null); }}>
                + 15 dias de teste
              </Button>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManage(null)}>Cancelar</Button>
          <Button variant="contained" onClick={salvarGestao}>Salvar</Button>
        </DialogActions>
      </Dialog>

      {/* Planos */}
      <Dialog open={plansOpen} onClose={() => setPlansOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Planos</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Cobre por número de pessoas: quanto maior a equipe da agência, maior o valor.
          </Typography>
          <Stack spacing={1.25}>
            {plans.map((p) => (
              <Card key={p.id} variant="outlined">
                <CardContent sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", py: 1.25, "&:last-child": { pb: 1.25 } }}>
                  <Box>
                    <Typography sx={{ fontWeight: 600 }}>{p.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {currency(p.price)}/mês · {p.max_users ? `até ${p.max_users} pessoas` : "pessoas ilimitadas"}
                    </Typography>
                  </Box>
                  <Box>
                    <IconButton size="small" onClick={() => setPlanDraft({ ...p })}><LoginIcon sx={{ display: "none" }} /><CheckCircleIcon sx={{ display: "none" }} /></IconButton>
                    <Button size="small" onClick={() => setPlanDraft({ ...p })}>Editar</Button>
                    <IconButton size="small" color="error" onClick={() => removerPlano(p.id)}><DeleteIcon fontSize="small" /></IconButton>
                  </Box>
                </CardContent>
              </Card>
            ))}
            {plans.length === 0 && <Typography variant="body2" color="text.secondary">Nenhum plano ainda.</Typography>}
          </Stack>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{planDraft?.id ? "Editar plano" : "Novo plano"}</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField size="small" label="Nome" value={planDraft?.name || ""}
              onChange={(e) => setPlanDraft((d) => ({ ...(d || {}), name: e.target.value }))} sx={{ flex: 1 }}
              placeholder="Ex: Essencial, Pro, Grande" />
            <TextField size="small" label="Até (pessoas)" type="number" value={planDraft?.max_users || ""}
              onChange={(e) => setPlanDraft((d) => ({ ...(d || {}), max_users: e.target.value }))} sx={{ width: 120 }}
              placeholder="ilimit." />
            <TextField size="small" label="R$/mês" type="number" value={planDraft?.price || ""}
              onChange={(e) => setPlanDraft((d) => ({ ...(d || {}), price: e.target.value }))} sx={{ width: 110 }} />
            <Button variant="contained" onClick={salvarPlano} disabled={!planDraft?.name}>
              {planDraft?.id ? "Salvar" : "Adicionar"}
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setPlansOpen(false); setPlanDraft(null); }}>Fechar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
