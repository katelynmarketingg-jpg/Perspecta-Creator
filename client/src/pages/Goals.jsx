import { useEffect, useState } from "react";
import {
  Button, Card, CardContent, Grid, LinearProgress, IconButton, Typography, Box,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, MenuItem, Chip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import PaidIcon from "@mui/icons-material/Paid";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import FlagIcon from "@mui/icons-material/Flag";
import NumbersIcon from "@mui/icons-material/Numbers";
import api from "../api/client.js";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { formatDate, currency } from "../utils.js";

const GOAL_TYPES = {
  money: { label: "Valor (R$)", icon: <PaidIcon fontSize="small" />, unit: (v) => currency(v) },
  clients: { label: "Clientes novos", icon: <GroupAddIcon fontSize="small" />, unit: (v) => `${v} clientes` },
  project: { label: "Finalizar projeto até a data", icon: <FlagIcon fontSize="small" />, unit: () => "" },
  quantity: { label: "Quantidade livre", icon: <NumbersIcon fontSize="small" />, unit: (v) => String(v) },
};

const EMPTY = { title: "", description: "", goal_type: "money", target: "", current: "", due_date: "", owner_id: "", project_id: "" };

export default function Goals() {
  const [rows, setRows] = useState([]);
  const [team, setTeam] = useState([]);
  const [projects, setProjects] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);

  const load = () => api.get("/goals").then((r) => setRows(r.data));
  useEffect(() => {
    load();
    api.get("/users/team").then((r) => setTeam(r.data)).catch(() => {});
    api.get("/projects").then((r) => setProjects(r.data)).catch(() => {});
  }, []);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  async function save() {
    const payload = {
      ...draft,
      target: Number(draft.target) || 0,
      current: Number(draft.current) || 0,
      owner_id: draft.owner_id || null,
      project_id: draft.goal_type === "project" ? draft.project_id || null : null,
    };
    if (draft.id) await api.put(`/goals/${draft.id}`, payload);
    else await api.post("/goals", payload);
    setOpen(false);
    load();
  }

  async function remove(id) {
    if (!confirm("Excluir meta?")) return;
    await api.delete(`/goals/${id}`);
    load();
  }

  function progressOf(g) {
    if (g.goal_type === "project") return g.project_status === "done" ? 100 : 0;
    return g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
  }

  const overdue = (g) => g.due_date && new Date(`${g.due_date}T23:59:59`) < new Date() && progressOf(g) < 100;

  return (
    <>
      <PageHeader
        title="Metas"
        subtitle="Objetivos da agência e da equipe"
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => { setDraft(EMPTY); setOpen(true); }}>Criar meta</Button>}
      />

      {rows.length === 0 ? <EmptyState message="Nenhuma meta criada." /> : (
        <Grid container spacing={2.5}>
          {rows.map((g) => {
            const type = GOAL_TYPES[g.goal_type] || GOAL_TYPES.quantity;
            const pct = progressOf(g);
            return (
              <Grid item xs={12} sm={6} md={4} key={g.id}>
                <Card sx={{ height: "100%" }}>
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Chip size="small" color="primary" variant="outlined" icon={type.icon} label={type.label} />
                      <Box>
                        <IconButton size="small" onClick={() => setDraft({ ...EMPTY, ...g, owner_id: g.owner_id || "", project_id: g.project_id || "", due_date: g.due_date || "" }) || setOpen(true)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" color="error" onClick={() => remove(g.id)}><DeleteIcon fontSize="small" /></IconButton>
                      </Box>
                    </Stack>
                    <Typography variant="h6" sx={{ mt: 1 }}>{g.title}</Typography>
                    {g.description && <Typography variant="body2" color="text.secondary">{g.description}</Typography>}

                    {g.goal_type === "project" ? (
                      <Box sx={{ mt: 1.5 }}>
                        <Typography variant="body2">
                          🎯 Concluir <strong>{g.project_name || "projeto"}</strong>
                          {g.due_date ? ` até ${formatDate(g.due_date)}` : ""}
                        </Typography>
                        <Chip size="small" sx={{ mt: 1 }}
                          label={g.project_status === "done" ? "Projeto concluído ✓" : overdue(g) ? "Atrasada" : "Em andamento"}
                          color={g.project_status === "done" ? "success" : overdue(g) ? "error" : "default"} />
                      </Box>
                    ) : (
                      <Box sx={{ mt: 2 }}>
                        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                          <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                            {type.unit(g.current)} / {type.unit(g.target)}
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{pct}%</Typography>
                        </Stack>
                        <LinearProgress variant="determinate" value={pct} sx={{ height: 8, borderRadius: 4 }}
                          color={pct >= 100 ? "success" : overdue(g) ? "error" : "primary"} />
                      </Box>
                    )}

                    <Stack direction="row" spacing={0.5} sx={{ mt: 1.5, flexWrap: "wrap", gap: 0.5 }}>
                      {g.due_date && g.goal_type !== "project" && (
                        <Chip size="small" variant="outlined" label={`Prazo: ${formatDate(g.due_date)}`}
                          color={overdue(g) ? "error" : "default"} />
                      )}
                      {g.owner_name && <Chip size="small" variant="outlined" label={`👤 ${g.owner_name}`} />}
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{draft.id ? "Editar meta" : "Criar meta"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField select label="Tipo de meta" value={draft.goal_type} onChange={set("goal_type")} fullWidth>
              {Object.entries(GOAL_TYPES).map(([key, t]) => (
                <MenuItem key={key} value={key}>{t.label}</MenuItem>
              ))}
            </TextField>
            <TextField label="Título *" value={draft.title} onChange={set("title")} fullWidth
              placeholder={
                draft.goal_type === "money" ? "Ex: Faturar R$ 20 mil no trimestre"
                : draft.goal_type === "clients" ? "Ex: Fechar 3 clientes novos"
                : draft.goal_type === "project" ? "Ex: Entregar o site da Alves & Teixeira"
                : "Ex: Publicar 60 posts no mês"
              } />
            <TextField label="Descrição" value={draft.description || ""} onChange={set("description")} fullWidth multiline rows={2} />

            {draft.goal_type === "project" ? (
              <TextField select label="Projeto a concluir *" value={draft.project_id} onChange={set("project_id")} fullWidth>
                {projects.filter((p) => p.status !== "done").map((p) => (
                  <MenuItem key={p.id} value={p.id}>{p.name}{p.client_name ? ` — ${p.client_name}` : ""}</MenuItem>
                ))}
              </TextField>
            ) : (
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label={draft.goal_type === "money" ? "Meta (R$)" : "Meta (alvo)"} type="number"
                  value={draft.target} onChange={set("target")} fullWidth />
                <TextField label="Atual" type="number" value={draft.current} onChange={set("current")} fullWidth />
              </Stack>
            )}

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Prazo" type="date" InputLabelProps={{ shrink: true }}
                value={draft.due_date || ""} onChange={set("due_date")} fullWidth />
              <TextField select label="Responsável" value={draft.owner_id} onChange={set("owner_id")} fullWidth>
                <MenuItem value="">Ninguém</MenuItem>
                {team.map((u) => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
              </TextField>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={save}
            disabled={!draft.title || (draft.goal_type === "project" && !draft.project_id)}>
            Salvar
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
