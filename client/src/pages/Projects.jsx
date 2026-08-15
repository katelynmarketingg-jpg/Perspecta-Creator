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
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { formatDate, CONTENT_TYPES } from "../utils.js";

const EMPTY = { name: "", client_id: "", description: "", status: "active", start_date: "", end_date: "" };
const MESES_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
// Próximo mês em "YYYY-MM" — você lança em julho o mês de agosto.
function nextMonthKey() {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabelPt(key) {
  if (!key) return "";
  const [y, m] = key.split("-").map(Number);
  return `${MESES_PT[m - 1]}/${y}`;
}
// Zera todos os tipos configurados (vêm de /task-types).
const emptyQuantities = (list) => Object.fromEntries((list || []).map((t) => [t.key, 0]));
// Rótulo/emoji de um tipo: usa os tipos do escritório, cai no padrão se for antigo.
const tinfo = (list, key) =>
  list.find((t) => t.key === key) || CONTENT_TYPES[key] && { label: CONTENT_TYPES[key].label, emoji: CONTENT_TYPES[key].emoji } || { label: key, emoji: "" };

export default function Projects() {
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [team, setTeam] = useState([]);
  const [types, setTypes] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  // Quantidades por tipo, preenchidas no próprio cadastro do projeto.
  const [qty, setQty] = useState({});
  // Datas fixas por tipo (dias do mês como texto, ex.: "5, 12, 19, 26").
  const [dates, setDates] = useState({});
  // Lançamento do mês.
  const [launch, setLaunch] = useState(null); // { project, month, assignee_id }
  const [pieces, setPieces] = useState([]);   // lista editável: uma peça = uma data
  const [flash, setFlash] = useState("");
  // Mês de referência do quadro (padrão: o próximo). Filtra o status "lançado".
  const [refMonth, setRefMonth] = useState(nextMonthKey());

  // Um dia do mês vira uma data completa (respeitando o último dia do mês).
  function monthDay(month, day) {
    const [y, mm] = month.split("-").map(Number);
    const last = new Date(y, mm, 0).getDate();
    return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
  }
  // Monta a lista de peças (tipo × quantidade), pré-preenchendo as datas fixas.
  function buildPieces(project, month) {
    const out = [];
    (project.plan || []).forEach((it) => {
      const info = tinfo(types, it.content_type);
      const dias = it.days || [];
      for (let i = 1; i <= it.quantity; i++) {
        out.push({
          content_type: it.content_type, label: it.label || info.label, emoji: info.emoji,
          i, total: it.quantity, date: dias.length ? monthDay(month, dias[(i - 1) % dias.length]) : "",
        });
      }
    });
    return out;
  }
  function openLaunch(p) {
    const month = refMonth;
    setLaunch({ project: p, month, assignee_id: "" });
    setPieces(buildPieces(p, month));
  }
  function changeLaunchMonth(month) {
    setLaunch((l) => ({ ...l, month }));
    setPieces((ps) => ps.map((p) => ({ ...p, date: p.date ? monthDay(month, Number(p.date.slice(-2))) : "" })));
  }

  const load = () => api.get("/projects").then((r) => setRows(r.data));
  useEffect(() => {
    load();
    api.get("/clients").then((r) => setClients(r.data));
    api.get("/users/team").then((r) => setTeam(r.data)).catch(() => {});
    api.get("/task-types").then((r) => setTypes(r.data)).catch(() => {});
  }, []);

  // Ao vivo: recarrega quando alguém mexe em projetos.
  const vProjects = useLiveVersion("projects");
  useEffect(() => { if (vProjects) load(); }, [vProjects]);

  async function openNew() {
    setDraft(EMPTY);
    setQty(emptyQuantities(types));
    setDates({});
    setOpen(true);
  }

  async function openEdit(p) {
    setDraft({ ...p, client_id: p.client_id || "" });
    // Carrega o plano atual do projeto e transforma em quantidades + datas por tipo.
    const base = emptyQuantities(types);
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
        content_type, label: tinfo(types, content_type).label || null,
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

  // Resumo agrupado do lançamento: 1 linha por tipo com a quantidade total.
  const launchGroups = Object.values(
    pieces.reduce((acc, p) => {
      acc[p.content_type] ||= { content_type: p.content_type, emoji: p.emoji, label: p.label, total: p.total };
      return acc;
    }, {})
  );

  async function doLaunch() {
    const { project, month, assignee_id } = launch;
    // Cria 1 tarefa por tipo com a quantidade dentro (agrupado). As datas de
    // cada peça são definidas depois, na aba Distribuição.
    const { data } = await api.post(`/projects/${project.id}/launch`, {
      month, assignee_id: assignee_id || null,
    });
    setLaunch(null);
    setFlash(`✅ ${data.created} tarefa(s) criadas (${data.pieces} peças) para ${data.month}. Veja na aba Tarefas — cada uma abre nas peças ao entrar na Distribuição.`);
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

      {rows.length > 0 && (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2.5 }}>
          <TextField
            type="month" size="small" label="Mês de referência" InputLabelProps={{ shrink: true }}
            value={refMonth} onChange={(e) => setRefMonth(e.target.value)} sx={{ width: 200 }}
          />
          <Typography variant="body2" color="text.secondary">
            Mostra o que já foi lançado para <strong>{monthLabelPt(refMonth)}</strong>. "Lançar mês" já vem nesse mês.
          </Typography>
        </Stack>
      )}

      {rows.length === 0 ? (
        <EmptyState message="Nenhum projeto cadastrado." />
      ) : (
        <Grid container spacing={2.5}>
          {rows.map((p) => (
            <Grid item xs={12} sm={6} md={4} key={p.id}>
              <Card sx={{ height: "100%" }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
                      <Chip size="small" label={p.status === "done" ? "Concluído" : "Ativo"} color={p.status === "done" ? "success" : "primary"} />
                      {(p.launched_months || []).includes(refMonth)
                        ? <Chip size="small" color="success" variant="outlined" label={`✓ ${monthLabelPt(refMonth)} lançado`} />
                        : <Chip size="small" variant="outlined" label={`${monthLabelPt(refMonth)}: a lançar`} />}
                    </Stack>
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
                          label={`${tinfo(types, it.content_type).emoji || ""} ${it.quantity} ${tinfo(types, it.content_type).label}`} />
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
                    fullWidth size="small" startIcon={<RocketLaunchIcon />} sx={{ mt: 1.5 }}
                    variant={(p.launched_months || []).includes(refMonth) ? "outlined" : "contained"}
                    disabled={(p.plan || []).length === 0}
                    onClick={() => openLaunch(p)}
                  >
                    {(p.launched_months || []).includes(refMonth) ? `Relançar ${monthLabelPt(refMonth)}` : `Lançar ${monthLabelPt(refMonth)}`}
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
              {types.map((t) => (
                <Grid item xs={6} sm={4} key={t.key}>
                  <TextField
                    type="number" size="small" fullWidth
                    label={`${t.emoji || ""} ${t.label}`}
                    value={qty[t.key] ?? 0}
                    inputProps={{ min: 0 }}
                    onChange={(e) => setQ(t.key, e.target.value)}
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
                    label={`${tinfo(types, k).emoji || ""} Dias de ${tinfo(types, k).label}`}
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

      {/* Lançar mês — lista data por data */}
      <Dialog open={Boolean(launch)} onClose={() => setLaunch(null)} fullWidth maxWidth="sm">
        <DialogTitle>Lançar mês — {launch?.project?.client_name || launch?.project?.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Mês" type="month" InputLabelProps={{ shrink: true }} fullWidth
                value={launch?.month || ""}
                onChange={(e) => changeLaunchMonth(e.target.value)} />
              <TextField select label="Responsável (opcional)" fullWidth
                helperText="Vazio = quem faz o tipo (Configurações)."
                value={launch?.assignee_id || ""}
                onChange={(e) => setLaunch((l) => ({ ...l, assignee_id: e.target.value }))}>
                <MenuItem value="">Por função (automático)</MenuItem>
                {team.map((u) => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
              </TextField>
            </Stack>

            <Divider>O que vai ser criado</Divider>
            <Typography variant="body2" color="text.secondary">
              Cria <strong>1 tarefa por tipo</strong>, com a quantidade dentro. As datas de cada peça
              você define depois, na aba <strong>Distribuição</strong> (a tarefa se abre nas peças ao chegar lá).
            </Typography>
            <Stack spacing={1} sx={{ maxHeight: "45vh", overflowY: "auto", pr: 0.5 }}>
              {launchGroups.map((g) => (
                <Stack key={g.content_type} direction="row" spacing={1.5} alignItems="center"
                  sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, px: 1.5, py: 1 }}>
                  <Typography sx={{ flex: 1, fontSize: 14, fontWeight: 600 }} noWrap>
                    {g.emoji} {g.label}
                  </Typography>
                  <Chip size="small" color="secondary" label={`×${g.total}`} />
                </Stack>
              ))}
              {launchGroups.length === 0 && (
                <Typography variant="body2" color="text.secondary">Este projeto não tem quantidades definidas.</Typography>
              )}
            </Stack>
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
