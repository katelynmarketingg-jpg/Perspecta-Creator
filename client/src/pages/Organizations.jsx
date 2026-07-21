import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Button, Card, CardContent, Typography, Chip, IconButton, Stack, Grid,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Divider, Tooltip,
  Alert,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import LoginIcon from "@mui/icons-material/Login";
import DeleteIcon from "@mui/icons-material/Delete";
import BlockIcon from "@mui/icons-material/Block";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import api from "../api/client.js";
import { PageHeader } from "../components/ui.jsx";
import { currency } from "../utils.js";
import { useAuth } from "../auth/AuthContext.jsx";

const EMPTY = { name: "", admin_name: "", admin_username: "", admin_password: "", notes: "" };

export default function Organizations() {
  const { enterOrg } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [created, setCreated] = useState("");

  const load = () => api.get("/organizations").then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

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
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setDraft(EMPTY); setOpen(true); }}>
            Novo escritório
          </Button>
        }
      />

      {created && <Alert severity="success" sx={{ mb: 2 }}>{created}</Alert>}

      <Grid container spacing={2.5}>
        {rows.map((o) => (
          <Grid item xs={12} sm={6} md={4} key={o.id}>
            <Card sx={{ height: "100%", opacity: o.active ? 1 : 0.6 }}>
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" noWrap sx={{ letterSpacing: "-0.02em" }}>{o.name}</Typography>
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
                      {Boolean(o.is_master) && <Chip size="small" color="primary" label="Master" />}
                      <Chip size="small" variant="outlined" color={o.active ? "success" : "default"}
                        label={o.active ? "Ativo" : "Desativado"} />
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
                      <Typography variant="caption" color="text.secondary">Recebido</Typography>
                      <Typography sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{currency(o.revenue)}</Typography>
                    </Box>
                    <Button fullWidth variant="outlined" startIcon={<LoginIcon />} onClick={() => enter(o)}>
                      Entrar neste escritório
                    </Button>
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
            <Divider>Primeiro acesso</Divider>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Nome de quem entra" value={draft.admin_username} onChange={set("admin_username")}
                fullWidth placeholder="Bruno" />
              <TextField label="Senha" value={draft.admin_password} onChange={set("admin_password")} fullWidth />
            </Stack>
            <TextField label="Observações" value={draft.notes} onChange={set("notes")} fullWidth multiline rows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={save} disabled={!draft.name}>Criar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
