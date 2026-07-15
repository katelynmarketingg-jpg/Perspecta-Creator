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
import api from "../api/client.js";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { formatDate } from "../utils.js";

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
                  {(p.monthly_posts > 0 || p.monthly_videos > 0) && (
                    <>
                      <Stack direction="row" spacing={0.5} sx={{ mt: 1.5, flexWrap: "wrap", gap: 0.5 }}>
                        {p.monthly_posts > 0 && <Chip size="small" variant="outlined" label={`🖼️ ${p.monthly_posts} posts/mês`} />}
                        {p.monthly_videos > 0 && <Chip size="small" variant="outlined" label={`🎬 ${p.monthly_videos} vídeos/mês`} />}
                      </Stack>
                      <Button
                        fullWidth variant="contained" size="small" startIcon={<RocketLaunchIcon />} sx={{ mt: 1.5 }}
                        onClick={() => setLaunch({ project: p, month: new Date().toISOString().slice(0, 7), assignee_id: "" })}
                      >
                        Lançar mês
                      </Button>
                    </>
                  )}
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
