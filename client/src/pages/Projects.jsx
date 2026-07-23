import { useEffect, useState } from "react";
import {
  Button, Card, CardContent, Grid, Chip, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, Stack, MenuItem, Typography, Box,
  Alert,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import TuneIcon from "@mui/icons-material/Tune";
import api from "../api/client.js";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { formatDate, CONTENT_TYPES } from "../utils.js";

const LINHA_VAZIA = { content_type: "post", label: "", quantity: 1, assignee_id: "" };

const EMPTY = { name: "", client_id: "", description: "", status: "active", start_date: "", end_date: "" };

export default function Projects() {
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [team, setTeam] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  // Lançamento do mês: cria as tarefas do plano de uma vez.
  const [launch, setLaunch] = useState(null); // { project, month, assignee_id }
  const [launched, setLaunched] = useState("");
  // Plano mensal configurável.
  const [plan, setPlan] = useState(null); // { project, items: [] }

  async function openPlan(project) {
    const { data } = await api.get(`/projects/${project.id}/plan`);
    setPlan({
      project,
      items: data.map((i) => ({ ...i, assignee_id: i.assignee_id || "" })),
    });
  }

  async function savePlan() {
    await api.put(`/projects/${plan.project.id}/plan`, {
      items: plan.items
        .filter((i) => i.content_type)
        .map((i) => ({ ...i, assignee_id: i.assignee_id || null, quantity: Number(i.quantity) || 1 })),
    });
    setPlan(null);
    setLaunched("Plano salvo. Agora é só 'Lançar mês' todo mês.");
    setTimeout(() => setLaunched(""), 5000);
  }

  const setLinha = (idx, campo, valor) =>
    setPlan((p) => ({ ...p, items: p.items.map((it, i) => (i === idx ? { ...it, [campo]: valor } : it)) }));
  const addLinha = () => setPlan((p) => ({ ...p, items: [...p.items, { ...LINHA_VAZIA }] }));
  const rmLinha = (idx) => setPlan((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));

  const load = () => api.get("/projects").then((r) => setRows(r.data));
  useEffect(() => {
    load();
    api.get("/clients").then((r) => setClients(r.data));
    api.get("/users/team").then((r) => setTeam(r.data)).catch(() => {});
  }, []);

  async function doLaunch() {
    const { project, month, assignee_id } = launch;
    const { data } = await api.post(`/projects/${project.id}/launch`, { month, assignee_id: assignee_id || null });
    setLaunch(null);
    setLaunched(`${data.created} tarefas criadas para ${data.month} — veja na aba Tarefas.`);
    setTimeout(() => setLaunched(""), 6000);
  }

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  async function save() {
    const payload = { ...draft, client_id: draft.client_id || null };
    if (draft.id) await api.put(`/projects/${draft.id}`, payload);
    else await api.post("/projects", payload);
    setOpen(false);
    load();
  }
  async function remove(id) {
    if (!confirm("Excluir projeto?")) return;
    await api.delete(`/projects/${id}`);
    load();
  }

  return (
    <>
      <PageHeader
        title="Projetos"
        subtitle="Projetos ativos e concluídos"
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => { setDraft(EMPTY); setOpen(true); }}>Novo projeto</Button>}
      />

      {launched && <Alert severity="success" sx={{ mb: 2 }}>{launched}</Alert>}

      {rows.length === 0 ? (
        <EmptyState message="Nenhum projeto cadastrado." />
      ) : (
        <Grid container spacing={2.5}>
          {rows.map((p) => (
            <Grid item xs={12} sm={6} md={4} key={p.id}>
              <Card sx={{ height: "100%" }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Chip size="small" label={p.status === "done" ? "Concluído" : "Ativo"} color={p.status === "done" ? "success" : "primary"} />
                    <Box>
                      <IconButton size="small" onClick={() => { setDraft({ ...p, client_id: p.client_id || "" }); setOpen(true); }}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => remove(p.id)}><DeleteIcon fontSize="small" /></IconButton>
                    </Box>
                  </Stack>
                  <Typography variant="h6" sx={{ mt: 1 }}>{p.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{p.client_name || "Sem cliente"}</Typography>
                  {p.description && <Typography variant="body2" sx={{ mt: 1 }}>{p.description}</Typography>}
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
                    {formatDate(p.start_date)} → {formatDate(p.end_date)}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                    <Button
                      fullWidth variant="outlined" size="small" startIcon={<TuneIcon />}
                      onClick={() => openPlan(p)}
                    >
                      Plano mensal
                    </Button>
                    <Button
                      fullWidth variant="contained" size="small" startIcon={<RocketLaunchIcon />}
                      onClick={() => setLaunch({ project: p, month: new Date().toISOString().slice(0, 7), assignee_id: "" })}
                    >
                      Lançar mês
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{draft.id ? "Editar projeto" : "Novo projeto"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Nome *" value={draft.name} onChange={set("name")} fullWidth />
            <TextField select label="Cliente" value={draft.client_id} onChange={set("client_id")} fullWidth>
              <MenuItem value="">Sem cliente</MenuItem>
              {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <TextField label="Descrição" value={draft.description || ""} onChange={set("description")} fullWidth multiline rows={2} />
            <TextField select label="Status" value={draft.status} onChange={set("status")} fullWidth>
              <MenuItem value="active">Ativo</MenuItem>
              <MenuItem value="done">Concluído</MenuItem>
            </TextField>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Início" type="date" InputLabelProps={{ shrink: true }} value={draft.start_date || ""} onChange={set("start_date")} fullWidth />
              <TextField label="Fim" type="date" InputLabelProps={{ shrink: true }} value={draft.end_date || ""} onChange={set("end_date")} fullWidth />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={save} disabled={!draft.name}>Salvar</Button>
        </DialogActions>
      </Dialog>

      {/* Lançar mês: cria todas as tarefas do plano de uma vez */}
      {/* Plano mensal: monta uma vez, lança todo mês com um clique */}
      <Dialog open={Boolean(plan)} onClose={() => setPlan(null)} fullWidth maxWidth="md">
        <DialogTitle>Plano mensal — {plan?.project?.client_name || plan?.project?.name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Configure o que entra todo mês: o tipo, um nome, quantas peças e para quem vão.
            Deixe o responsável em "Por função" para ir automático para quem produz aquele tipo.
          </Typography>
          <Stack spacing={1.5}>
            {(plan?.items || []).map((linha, idx) => (
              <Stack key={idx} direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
                <TextField select size="small" label="Tipo" value={linha.content_type} sx={{ minWidth: 130 }}
                  onChange={(e) => setLinha(idx, "content_type", e.target.value)}>
                  {Object.entries(CONTENT_TYPES).map(([k, v]) => (
                    <MenuItem key={k} value={k}>{v.emoji} {v.label}</MenuItem>
                  ))}
                </TextField>
                <TextField size="small" label="Nome (opcional)" value={linha.label || ""} sx={{ flex: 1 }}
                  placeholder="Ex: Post institucional"
                  onChange={(e) => setLinha(idx, "label", e.target.value)} />
                <TextField size="small" type="number" label="Qtde" value={linha.quantity} sx={{ width: 80 }}
                  onChange={(e) => setLinha(idx, "quantity", e.target.value)} />
                <TextField select size="small" label="Responsável" value={linha.assignee_id || ""} sx={{ minWidth: 160 }}
                  onChange={(e) => setLinha(idx, "assignee_id", e.target.value)}>
                  <MenuItem value="">Por função</MenuItem>
                  {team.map((u) => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
                </TextField>
                <IconButton size="small" color="error" onClick={() => rmLinha(idx)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
            {(plan?.items || []).length === 0 && (
              <Typography variant="body2" color="text.secondary">Nenhuma linha. Adicione abaixo.</Typography>
            )}
            <Box>
              <Button size="small" startIcon={<AddIcon />} onClick={addLinha}>Adicionar linha</Button>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPlan(null)}>Cancelar</Button>
          <Button variant="contained" onClick={savePlan}>Salvar plano</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(launch)} onClose={() => setLaunch(null)} fullWidth maxWidth="xs">
        <DialogTitle>Lançar mês — {launch?.project?.client_name || launch?.project?.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Serão criadas {(launch?.project?.monthly_posts || 0)} tarefas de post e{" "}
              {(launch?.project?.monthly_videos || 0)} de vídeo na coluna "A fazer".
            </Typography>
            <TextField label="Mês" type="month" InputLabelProps={{ shrink: true }} fullWidth
              value={launch?.month || ""}
              onChange={(e) => setLaunch((l) => ({ ...l, month: e.target.value }))} />
            <TextField select label="Colaborador responsável" fullWidth
              value={launch?.assignee_id || ""}
              onChange={(e) => setLaunch((l) => ({ ...l, assignee_id: e.target.value }))}>
              <MenuItem value="">Sem responsável</MenuItem>
              {team.map((u) => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLaunch(null)}>Cancelar</Button>
          <Button variant="contained" startIcon={<RocketLaunchIcon />} onClick={doLaunch} disabled={!launch?.month}>
            Lançar
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
