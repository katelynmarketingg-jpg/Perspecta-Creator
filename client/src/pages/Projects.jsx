import { useEffect, useState } from "react";
import {
  Button, Card, CardContent, Grid, Chip, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, Stack, MenuItem, Typography, Box,
  Alert, Divider,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import api from "../api/client.js";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { formatDate, CONTENT_TYPES } from "../utils.js";

const EMPTY = { name: "", client_id: "", description: "", status: "active", start_date: "", end_date: "" };
// Toda vez que um projeto abre, começamos com todos os tipos em zero.
const emptyQuantities = () => Object.fromEntries(Object.keys(CONTENT_TYPES).map((k) => [k, 0]));

export default function Projects() {
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [team, setTeam] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  // Quantidades por tipo, preenchidas no próprio cadastro do projeto.
  const [qty, setQty] = useState(emptyQuantities());
  // Datas fixas por tipo (dias do mês como texto, ex.: "5, 12, 19, 26").
  const [dates, setDates] = useState({});
  // Lançamento do mês.
  const [launch, setLaunch] = useState(null); // { project, month, assignee_id }
  const [flash, setFlash] = useState("");

  const load = () => api.get("/projects").then((r) => setRows(r.data));
  useEffect(() => {
    load();
    api.get("/clients").then((r) => setClients(r.data));
    api.get("/users/team").then((r) => setTeam(r.data)).catch(() => {});
  }, []);

  async function openNew() {
    setDraft(EMPTY);
    setQty(emptyQuantities());
    setDates({});
    setOpen(true);
  }

  async function openEdit(p) {
    setDraft({ ...p, client_id: p.client_id || "" });
    // Carrega o plano atual do projeto e transforma em quantidades + datas por tipo.
    const base = emptyQuantities();
    const dmap = {};
    try {
      const { data } = await api.get(`/projects/${p.id}/plan`);
      data.forEach((it) => {
        if (base[it.content_type] != null) base[it.content_type] = it.quantity;
        if (it.days?.length) dmap[it.content_type] = it.days.join(", ");
      });
    } catch { /* projeto sem plano ainda */ }
    setQty(base);
    setDates(dmap);
    setOpen(true);
  }

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const setQ = (k, v) => setQty((q) => ({ ...q, [k]: Math.max(0, Number(v) || 0) }));
  const setDatesFor = (k, v) => setDates((d) => ({ ...d, [k]: v }));
  // Converte "5, 12, 19" em [5,12,19] (só dias válidos 1–31).
  const parseDays = (txt) =>
    String(txt || "").split(/[,\s]+/).map((n) => Number(n)).filter((n) => n >= 1 && n <= 31);

  async function save() {
    const payload = { ...draft, client_id: draft.client_id || null };
    let projectId = draft.id;
    if (projectId) await api.put(`/projects/${projectId}`, payload);
    else projectId = (await api.post("/projects", payload)).data.id;

    // Salva as quantidades como plano mensal (só os tipos com quantidade > 0).
    // Responsável fica "por função" — quem faz cada tipo vem de Configurações.
    const items = Object.entries(qty)
      .filter(([, q]) => Number(q) > 0)
      .map(([content_type, quantity]) => ({
        content_type, label: CONTENT_TYPES[content_type]?.label || null,
        quantity: Number(quantity), assignee_id: null,
        days: parseDays(dates[content_type]),
      }));
    await api.put(`/projects/${projectId}/plan`, { items });

    setOpen(false);
    setFlash("Projeto salvo com as quantidades do mês. Use 'Lançar mês' para gerar as tarefas.");
    setTimeout(() => setFlash(""), 5000);
    load();
  }

  async function remove(id) {
    if (!confirm("Excluir projeto?")) return;
    await api.delete(`/projects/${id}`);
    load();
  }

  const totalPlan = Object.values(qty).reduce((a, b) => a + Number(b || 0), 0);

  async function doLaunch() {
    const { project, month, assignee_id } = launch;
    const { data } = await api.post(`/projects/${project.id}/launch`, { month, assignee_id: assignee_id || null });
    setLaunch(null);
    setFlash(`✅ ${data.created} tarefas criadas para ${data.month}. Veja na aba Tarefas — e as notificações foram enviadas aos responsáveis.`);
    setTimeout(() => setFlash(""), 7000);
    load();
  }

  // Soma total de peças do plano de um projeto (para o diálogo de lançar).
  const planTotal = (p) => (p?.plan || []).reduce((a, it) => a + Number(it.quantity || 0), 0);

  return (
    <>
      <PageHeader
        title="Projetos"
        subtitle="Cada projeto guarda as quantidades do mês; lance tudo com um clique."
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>Novo projeto</Button>}
      />

      {flash && <Alert severity="success" sx={{ mb: 2 }}>{flash}</Alert>}

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
                      <IconButton size="small" onClick={() => openEdit(p)}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => remove(p.id)}><DeleteIcon fontSize="small" /></IconButton>
                    </Box>
                  </Stack>
                  <Typography variant="h6" sx={{ mt: 1 }}>{p.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{p.client_name || "Sem cliente"}</Typography>

                  {/* Quantidades discriminadas do mês */}
                  {(p.plan || []).length > 0 ? (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.6, mt: 1.5 }}>
                      {p.plan.map((it) => (
                        <Chip key={it.content_type} size="small" variant="outlined"
                          label={`${CONTENT_TYPES[it.content_type]?.emoji || ""} ${it.quantity} ${CONTENT_TYPES[it.content_type]?.label || it.content_type}`} />
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
                      Sem quantidades definidas — edite o projeto para preencher.
                    </Typography>
                  )}

                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
                    {formatDate(p.start_date)} → {formatDate(p.end_date)}
                  </Typography>
                  <Button
                    fullWidth variant="contained" size="small" startIcon={<RocketLaunchIcon />} sx={{ mt: 1.5 }}
                    disabled={(p.plan || []).length === 0}
                    onClick={() => setLaunch({ project: p, month: new Date().toISOString().slice(0, 7), assignee_id: "" })}
                  >
                    Lançar mês
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Criar / editar projeto — com as quantidades do mês embutidas */}
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
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField select label="Status" value={draft.status} onChange={set("status")} fullWidth>
                <MenuItem value="active">Ativo</MenuItem>
                <MenuItem value="done">Concluído</MenuItem>
              </TextField>
              <TextField label="Início" type="date" InputLabelProps={{ shrink: true }} value={draft.start_date || ""} onChange={set("start_date")} fullWidth />
              <TextField label="Fim" type="date" InputLabelProps={{ shrink: true }} value={draft.end_date || ""} onChange={set("end_date")} fullWidth />
            </Stack>

            <Divider>Quantidades do mês</Divider>
            <Typography variant="body2" color="text.secondary">
              Quantas peças de cada tipo entram por mês. Ao "Lançar mês", cada peça vira uma tarefa
              e vai automático para quem faz aquele tipo (definido em Configurações).
            </Typography>
            <Grid container spacing={1.5}>
              {Object.entries(CONTENT_TYPES).map(([k, v]) => (
                <Grid item xs={6} sm={4} key={k}>
                  <TextField
                    type="number" size="small" fullWidth
                    label={`${v.emoji} ${v.label}`}
                    value={qty[k] ?? 0}
                    inputProps={{ min: 0 }}
                    onChange={(e) => setQ(k, e.target.value)}
                  />
                </Grid>
              ))}
            </Grid>
            <Typography variant="caption" color={totalPlan ? "primary" : "text.secondary"}>
              Total: {totalPlan} tarefa(s) por mês.
            </Typography>

            {Object.entries(qty).some(([, q]) => Number(q) > 0) && (
              <>
                <Divider>Datas de publicação (opcional)</Divider>
                <Typography variant="body2" color="text.secondary">
                  Dias do mês em que cada tipo é publicado (ex.: <strong>5, 12, 19, 26</strong>).
                  Ao "Lançar mês", as peças já saem agendadas nesses dias — no mês que você escolher.
                  Deixe em branco para sem data fixa.
                </Typography>
                {Object.entries(qty).filter(([, q]) => Number(q) > 0).map(([k]) => (
                  <TextField
                    key={k} size="small" fullWidth
                    label={`${CONTENT_TYPES[k]?.emoji || ""} Dias de ${CONTENT_TYPES[k]?.label || k}`}
                    placeholder="Ex: 5, 12, 19, 26"
                    value={dates[k] || ""}
                    onChange={(e) => setDatesFor(k, e.target.value)}
                  />
                ))}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={save} disabled={!draft.name}>Salvar</Button>
        </DialogActions>
      </Dialog>

      {/* Lançar mês */}
      <Dialog open={Boolean(launch)} onClose={() => setLaunch(null)} fullWidth maxWidth="xs">
        <DialogTitle>Lançar mês — {launch?.project?.client_name || launch?.project?.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Serão criadas <strong>{planTotal(launch?.project)} tarefas</strong> na primeira coluna do quadro:
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.6 }}>
              {(launch?.project?.plan || []).map((it) => (
                <Chip key={it.content_type} size="small"
                  label={`${CONTENT_TYPES[it.content_type]?.emoji || ""} ${it.quantity} ${CONTENT_TYPES[it.content_type]?.label || it.content_type}`} />
              ))}
            </Box>
            <TextField label="Mês" type="month" InputLabelProps={{ shrink: true }} fullWidth
              value={launch?.month || ""}
              onChange={(e) => setLaunch((l) => ({ ...l, month: e.target.value }))} />
            <TextField select label="Responsável (opcional)" fullWidth
              helperText="Vazio = cada tipo vai para quem o faz (Configurações)."
              value={launch?.assignee_id || ""}
              onChange={(e) => setLaunch((l) => ({ ...l, assignee_id: e.target.value }))}>
              <MenuItem value="">Por função (automático)</MenuItem>
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
