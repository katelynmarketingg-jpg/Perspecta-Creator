import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button, Box, Card, CardContent, Typography, Chip, IconButton, Dialog,
  DialogTitle, DialogContent, DialogActions, TextField, Stack, MenuItem,
  Tooltip, Divider, Autocomplete, Alert,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import api from "../api/client.js";
import { PageHeader, CardSkeleton } from "../components/ui.jsx";
import { formatDate, formatDateTime, PRIORITY, CONTENT_TYPES } from "../utils.js";

const EMPTY = {
  title: "", description: "", client_id: "", project_id: "", assignee_id: "",
  stage_id: "", priority: "medium", tags: "", due_date: "", quantity: 1,
  content_type: "", caption: "", scheduled_at: "",
};

export default function Tasks() {
  const [stages, setStages] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [clients, setClients] = useState([]);
  const [team, setTeam] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(null);
  // Diálogo de programação: aberto quando a tarefa vai para "Concluído" sem data.
  const [schedule, setSchedule] = useState(null); // { taskId, stageId, value }
  // Anexos (arte do post): arquivos do cliente selecionados na tarefa.
  const [clientFiles, setClientFiles] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [filterClient, setFilterClient] = useState("");
  // Abre mostrando as tarefas de quem está logado; dá para trocar no topo.
  const [filterAssignee, setFilterAssignee] = useState("__me");
  const [search, setSearch] = useState("");
  const [apontamentos, setApontamentos] = useState([]);
  const [novoTempo, setNovoTempo] = useState({ minutes: "", note: "" });
  const draggingRef = useRef(false);
  const me = JSON.parse(localStorage.getItem("user") || "null");
  const totalMinutos = apontamentos.reduce((s, a) => s + a.minutes, 0);
  // Cronômetros em andamento: task_id -> started_at (UTC). nowTs faz o relógio "andar".
  const [timers, setTimers] = useState({});
  const [nowTs, setNowTs] = useState(Date.now());
  const loadTimers = () => api.get("/time/active").then((r) => {
    const m = {}; r.data.forEach((t) => { m[t.task_id] = t.started_at; }); setTimers(m);
  }).catch(() => {});

  async function startTimer(taskId) {
    await api.post("/time/start", { task_id: taskId });
    loadTimers();
  }
  async function stopTimer(taskId) {
    await api.post("/time/stop", { task_id: taskId });
    setTimers((m) => { const c = { ...m }; delete c[taskId]; return c; });
  }
  // Relógio "hh:mm:ss" ou "mm:ss" desde o início.
  function elapsedLabel(startedAt) {
    const ini = new Date(startedAt.replace(" ", "T") + "Z").getTime();
    let s = Math.max(0, Math.floor((nowTs - ini) / 1000));
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const p = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  }

  // Carrega os arquivos do cliente escolhido para o seletor de anexos.
  useEffect(() => {
    if (!open) return;
    const params = { all: 1 };
    if (draft.client_id) params.client_id = draft.client_id;
    api.get("/files", { params }).then((r) => setClientFiles(r.data)).catch(() => setClientFiles([]));
  }, [open, draft.client_id]);

  const load = () => {
    api.get("/tasks/stages").then((r) => setStages(r.data));
    api.get("/tasks").then((r) => { setTasks(r.data); setLoading(false); });
  };
  useEffect(() => {
    load();
    loadTimers();
    api.get("/clients").then((r) => setClients(r.data));
    api.get("/users/team").then((r) => setTeam(r.data)).catch(() => {});
  }, []);

  // Relógio dos cronômetros: só liga o intervalo quando há algum rodando.
  useEffect(() => {
    if (Object.keys(timers).length === 0) return undefined;
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timers]);

  // Filtros: com dezenas de tarefas o quadro vira uma parede sem isso.
  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (filterClient && t.client_id !== filterClient) return false;
      if (filterAssignee === "__me" && t.assignee_id !== me?.id) return false;
      if (filterAssignee === "__none" && t.assignee_id) return false;
      if (filterAssignee && !String(filterAssignee).startsWith("__") && t.assignee_id !== filterAssignee) return false;
      if (search && !`${t.title} ${t.client_name || ""} ${(t.tags || []).join(" ")}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [tasks, filterClient, filterAssignee, search, me]);

  const byStage = useMemo(() => {
    const map = {};
    stages.forEach((s) => (map[s.id] = []));
    filtered.forEach((t) => { (map[t.stage_id] ||= []).push(t); });
    return map;
  }, [stages, filtered]);

  // Tarefas sem etapa não apareceriam em coluna nenhuma — avisa em vez de sumir.
  const orfas = filtered.filter((t) => !stages.some((s) => s.id === t.stage_id));

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  function openNew() {
    setDraft({ ...EMPTY, stage_id: stages[0]?.id || "" });
    setAttachments([]);
    setOpen(true);
  }

  const carregarTempo = (taskId) =>
    api.get(`/time/task/${taskId}`).then((r) => setApontamentos(r.data)).catch(() => setApontamentos([]));

  async function apontarTempo() {
    await api.post("/time", {
      task_id: draft.id,
      minutes: Number(novoTempo.minutes),
      note: novoTempo.note || null,
    });
    setNovoTempo({ minutes: "", note: "" });
    carregarTempo(draft.id);
  }

  async function removerApontamento(id) {
    await api.delete(`/time/${id}`);
    carregarTempo(draft.id);
  }

  function openEdit(task) {
    if (draggingRef.current) { draggingRef.current = false; return; }
    setAttachments([]);
    setApontamentos([]);
    setNovoTempo({ minutes: "", note: "" });
    carregarTempo(task.id);
    api.get(`/tasks/${task.id}/attachments`).then((r) => setAttachments(r.data)).catch(() => {});
    setDraft({
      ...task,
      client_id: task.client_id || "",
      assignee_id: task.assignee_id || "",
      stage_id: task.stage_id || "",
      content_type: task.content_type || "",
      caption: task.caption || "",
      scheduled_at: task.scheduled_at ? task.scheduled_at.slice(0, 16) : "",
      due_date: task.due_date || "",
      tags: (task.tags || []).join(", "),
    });
    setOpen(true);
  }

  async function save() {
    const payload = {
      ...draft,
      client_id: draft.client_id || null,
      assignee_id: draft.assignee_id || null,
      stage_id: draft.stage_id || stages[0]?.id || null,
      content_type: draft.content_type || null,
      caption: draft.caption || null,
      scheduled_at: draft.scheduled_at || null,
      tags: typeof draft.tags === "string"
        ? draft.tags.split(",").map((s) => s.trim()).filter(Boolean)
        : draft.tags,
      quantity: Number(draft.quantity) || 1,
    };
    let savedId = draft.id;
    if (draft.id) {
      await api.put(`/tasks/${draft.id}`, payload);
    } else {
      const { data } = await api.post("/tasks", payload);
      // Em lote (quantity > 1) a resposta é um array — anexos só no unitário.
      savedId = Array.isArray(data) ? null : data.id;
    }
    if (savedId) {
      await api.put(`/tasks/${savedId}/attachments`, { file_ids: attachments.map((a) => a.id) }).catch(() => {});
    }
    setOpen(false);
    load();
  }

  // Move com update otimista; se a etapa exigir data de programação, pergunta.
  async function moveToStage(taskId, stageId, scheduledAt) {
    const task = tasks.find((t) => t.id === taskId);
    const stage = stages.find((s) => s.id === stageId);
    if (!task || task.stage_id === stageId) return;

    if (stage?.is_done && !task.scheduled_at && !scheduledAt) {
      setSchedule({ taskId, stageId, value: "" });
      return;
    }

    const previous = tasks;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, stage_id: stageId } : t)));
    try {
      await api.put(`/tasks/${taskId}/status`, { stage_id: stageId, position: 0, scheduled_at: scheduledAt || undefined });
      load();
      // O backend finaliza o cronômetro ao mudar de etapa — reflete aqui.
      if (timers[taskId]) setTimers((m) => { const c = { ...m }; delete c[taskId]; return c; });
      loadTimers();
    } catch (err) {
      setTasks(previous);
      if (err.response?.data?.needs_schedule) setSchedule({ taskId, stageId, value: "" });
    }
  }

  function move(task, dir) {
    const idx = stages.findIndex((s) => s.id === task.stage_id);
    const next = stages[idx + dir];
    if (next) moveToStage(task.id, next.id);
  }

  function handleDragStart(e, task) {
    draggingRef.current = true;
    e.dataTransfer.setData("text/plain", String(task.id));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDrop(e, stage) {
    e.preventDefault();
    setDragOver(null);
    const id = Number(e.dataTransfer.getData("text/plain"));
    if (id) moveToStage(id, stage.id);
  }

  async function remove(id) {
    if (!confirm("Excluir tarefa?")) return;
    await api.delete(`/tasks/${id}`);
    load();
  }

  return (
    <>
      <PageHeader
        title="Tarefas"
        subtitle="Kanban de produção de conteúdo"
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>Nova tarefa</Button>}
      />

      {/* Filtros */}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 2.5, flexWrap: "wrap", gap: 1.5 }}>
        <TextField size="small" placeholder="Buscar por título, cliente ou tag…" value={search}
          onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: 260, flex: 1 }} />
        <TextField select size="small" label="Cliente" value={filterClient}
          onChange={(e) => setFilterClient(e.target.value)} sx={{ minWidth: 170 }}>
          <MenuItem value="">Todos os clientes</MenuItem>
          {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Responsável" value={filterAssignee}
          onChange={(e) => setFilterAssignee(e.target.value)} sx={{ minWidth: 170 }}>
          <MenuItem value="">Todo mundo</MenuItem>
          <MenuItem value="__me">Só as minhas</MenuItem>
          <MenuItem value="__none">Sem responsável</MenuItem>
          {team.map((u) => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
        </TextField>
        {(search || filterClient || filterAssignee) && (
          <Button size="small" onClick={() => { setSearch(""); setFilterClient(""); setFilterAssignee(""); }}>
            Limpar
          </Button>
        )}
      </Stack>

      {orfas.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {orfas.length} tarefa(s) sem etapa não aparecem no quadro. Abra e escolha uma etapa,
          ou crie as etapas em Configurações.
        </Alert>
      )}

      <Box sx={{ display: "flex", gap: 2, overflowX: "auto", pb: 2, alignItems: "flex-start" }}>
        {stages.map((stage, sIdx) => (
          <Box
            key={stage.id}
            onDragOver={(e) => { e.preventDefault(); setDragOver(stage.id); }}
            onDragLeave={() => setDragOver((v) => (v === stage.id ? null : v))}
            onDrop={(e) => handleDrop(e, stage)}
            sx={{
              minWidth: 290, width: 290, flexShrink: 0,
              borderRadius: 3, p: 1, m: -1,
              transition: "background-color .15s ease, outline-color .15s ease",
              outline: "2px dashed transparent",
              ...(dragOver === stage.id && {
                bgcolor: (t) => alpha(t.palette.primary.main, 0.06),
                outlineColor: (t) => alpha(t.palette.primary.main, 0.5),
              }),
            }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 0.5, mb: 1 }}>
              <Typography sx={{ fontWeight: 600 }}>
                {stage.name} {stage.is_done ? "✓" : ""}
              </Typography>
              <Chip size="small" label={(byStage[stage.id] || []).length} />
            </Stack>
            <Stack spacing={1.5}>
              {loading && [0, 1].map((i) => <CardSkeleton key={i} />)}
              {(byStage[stage.id] || []).map((t) => (
                <Card
                  key={t.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, t)}
                  onDragEnd={() => setTimeout(() => { draggingRef.current = false; }, 50)}
                  onClick={() => openEdit(t)}
                  sx={{ cursor: "grab", "&:active": { cursor: "grabbing" }, "&:hover": { borderColor: "primary.main" }, transition: "border-color .15s ease" }}
                >
                  <CardContent sx={{ p: 1.75, "&:last-child": { pb: 1.75 } }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Typography sx={{ fontWeight: 600, fontSize: 14.5 }}>{t.title}</Typography>
                      <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); remove(t.id); }}>
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Stack>
                    {t.client_name && <Typography variant="caption" color="text.secondary">{t.client_name}</Typography>}
                    <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: "wrap", gap: 0.5 }}>
                      {t.content_type && CONTENT_TYPES[t.content_type] && (
                        <Chip size="small" color="primary" variant="outlined"
                          label={`${CONTENT_TYPES[t.content_type].emoji} ${CONTENT_TYPES[t.content_type].label}`} />
                      )}
                      <Chip size="small" color={PRIORITY[t.priority]?.color} label={PRIORITY[t.priority]?.label} />
                      {t.scheduled_at && (
                        <Chip size="small" color="primary" icon={<EventAvailableIcon sx={{ fontSize: 14 }} />}
                          label={formatDateTime(t.scheduled_at)} />
                      )}
                      {t.due_date && !t.scheduled_at && <Chip size="small" variant="outlined" label={formatDate(t.due_date)} />}
                      {t.attachment_count > 0 && <Chip size="small" variant="outlined" label={`📎 ${t.attachment_count}`} />}
                      {/* O que falta para este post poder ir à aprovação */}
                      {t.content_type && !t.completed_at && !t.caption && (
                        <Tooltip title="Sem legenda — o cliente não consegue aprovar assim">
                          <Chip size="small" color="warning" variant="outlined" label="sem legenda" />
                        </Tooltip>
                      )}
                      {t.content_type && !t.completed_at && !t.attachment_count && (
                        <Tooltip title="Sem arte anexada — anexe o arquivo na tarefa">
                          <Chip size="small" color="warning" variant="outlined" label="sem arte" />
                        </Tooltip>
                      )}
                      {!t.assignee_name && !t.completed_at && (
                        <Tooltip title="Ninguém designado para esta tarefa">
                          <Chip size="small" variant="outlined" label="sem responsável" />
                        </Tooltip>
                      )}
                      {t.approval_status === "approved" && <Chip size="small" color="success" label="Aprovado ✓" />}
                      {t.approval_status === "changes_requested" && (
                        <Tooltip title={t.client_note || "O cliente pediu ajustes"}>
                          <Chip size="small" color="warning" label="Ajustes pedidos" />
                        </Tooltip>
                      )}
                      {(t.tags || []).map((tag) => <Chip key={tag} size="small" variant="outlined" label={tag} />)}
                    </Stack>
                    {t.assignee_name && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                        👤 {t.assignee_name}
                      </Typography>
                    )}
                    <Divider sx={{ my: 1 }} />
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Tooltip title="Etapa anterior">
                        <span>
                          <IconButton size="small" disabled={sIdx === 0} onClick={(e) => { e.stopPropagation(); move(t, -1); }}>
                            <ChevronLeftIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      {/* Cronômetro: começar a marcar o tempo / parar. Opcional. */}
                      {timers[t.id] ? (
                        <Button size="small" color="error" variant="outlined"
                          startIcon={<StopCircleIcon sx={{ fontSize: 16 }} />}
                          onClick={(e) => { e.stopPropagation(); stopTimer(t.id); }}
                          sx={{ minWidth: 0, px: 1, fontVariantNumeric: "tabular-nums" }}>
                          {elapsedLabel(timers[t.id])}
                        </Button>
                      ) : (
                        !t.completed_at && (
                          <Tooltip title="Começar a marcar o tempo">
                            <Button size="small" variant="text"
                              startIcon={<PlayArrowIcon sx={{ fontSize: 16 }} />}
                              onClick={(e) => { e.stopPropagation(); startTimer(t.id); }}
                              sx={{ minWidth: 0, px: 1 }}>
                              Começar
                            </Button>
                          </Tooltip>
                        )
                      )}
                      <Tooltip title="Próxima etapa">
                        <span>
                          <IconButton size="small" disabled={sIdx === stages.length - 1} onClick={(e) => { e.stopPropagation(); move(t, 1); }}>
                            <ChevronRightIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
              {!loading && (byStage[stage.id] || []).length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 3 }}>
                  Sem tarefas — arraste um card para cá
                </Typography>
              )}
            </Stack>
          </Box>
        ))}
        {stages.length === 0 && !loading && (
          <Typography color="text.secondary">Configure as etapas do Kanban em Configurações.</Typography>
        )}
      </Box>

      {/* Criar / editar tarefa */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{draft.id ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {/* Feedback do cliente vindo do portal */}
            {draft.approval_status === "changes_requested" && (draft.client_note || draft.client_caption) && (
              <Alert severity="warning">
                <strong>O cliente pediu ajustes:</strong>
                {draft.client_note && <div style={{ marginTop: 4 }}>💬 {draft.client_note}</div>}
                {draft.client_caption && (
                  <div style={{ marginTop: 4 }}>✏️ Legenda sugerida por ele: “{draft.client_caption}”</div>
                )}
              </Alert>
            )}
            {draft.approval_status === "approved" && (
              <Alert severity="success">Este post foi aprovado pelo cliente.</Alert>
            )}
            <TextField label="Título *" value={draft.title} onChange={set("title")} fullWidth />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField select label="Tipo de conteúdo" value={draft.content_type} onChange={set("content_type")} fullWidth>
                <MenuItem value="">Nenhum</MenuItem>
                {Object.entries(CONTENT_TYPES).map(([key, v]) => (
                  <MenuItem key={key} value={key}>{v.emoji} {v.label}</MenuItem>
                ))}
              </TextField>
              <TextField select label="Cliente" value={draft.client_id} onChange={set("client_id")} fullWidth>
                <MenuItem value="">Sem cliente</MenuItem>
                {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </TextField>
            </Stack>
            <TextField label="Descrição / briefing" value={draft.description || ""} onChange={set("description")} fullWidth multiline rows={2} />
            <TextField
              label="Legenda (caption)" value={draft.caption} onChange={set("caption")}
              fullWidth multiline rows={3}
              helperText="A legenda que vai acompanhar o post — aparece no calendário."
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField select label="Responsável" value={draft.assignee_id} onChange={set("assignee_id")} fullWidth>
                <MenuItem value="">Ninguém</MenuItem>
                {team.map((u) => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
              </TextField>
              <TextField select label="Etapa" value={draft.stage_id} onChange={set("stage_id")} fullWidth>
                {stages.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
              </TextField>
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField select label="Prioridade" value={draft.priority} onChange={set("priority")} fullWidth>
                <MenuItem value="low">Baixa</MenuItem>
                <MenuItem value="medium">Média</MenuItem>
                <MenuItem value="high">Alta</MenuItem>
              </TextField>
              <TextField label="Prazo interno" type="date" InputLabelProps={{ shrink: true }} value={draft.due_date} onChange={set("due_date")} fullWidth />
            </Stack>
            <TextField
              label="Data de programação" type="datetime-local" InputLabelProps={{ shrink: true }}
              value={draft.scheduled_at} onChange={set("scheduled_at")} fullWidth
              helperText="Quando o conteúdo entra no ar — obrigatória para concluir."
            />
            <Autocomplete
              multiple
              options={clientFiles}
              value={attachments}
              onChange={(_, v) => setAttachments(v)}
              getOptionLabel={(o) => o.original_name}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              renderInput={(params) => (
                <TextField {...params} label="Anexar arte (arquivos do cliente)"
                  helperText="Arquivos da aba Arquivos — o cliente vê no portal na hora de aprovar." />
              )}
            />
            {/* Apontamento de horas: só faz sentido numa tarefa que já existe */}
            {draft.id && (
              <Box sx={{ p: 1.5, borderRadius: 2, border: 1, borderColor: "divider" }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2">Tempo gasto</Typography>
                  <Chip size="small" color={totalMinutos ? "primary" : "default"} variant="outlined"
                    label={totalMinutos ? `${(totalMinutos / 60).toFixed(1)}h no total` : "nada apontado"} />
                </Stack>
                {apontamentos.map((a) => (
                  <Stack key={a.id} direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                    <Typography variant="body2" sx={{ minWidth: 62, fontVariantNumeric: "tabular-nums" }}>
                      {a.minutes} min
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} noWrap>
                      {a.user_name} · {a.note || "sem observação"}
                    </Typography>
                    <IconButton size="small" color="error" onClick={() => removerApontamento(a.id)}>
                      <DeleteIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  </Stack>
                ))}
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <TextField size="small" type="number" label="Minutos" sx={{ width: 110 }}
                    value={novoTempo.minutes}
                    onChange={(e) => setNovoTempo((t) => ({ ...t, minutes: e.target.value }))} />
                  <TextField size="small" label="O que fez" fullWidth
                    value={novoTempo.note}
                    onChange={(e) => setNovoTempo((t) => ({ ...t, note: e.target.value }))}
                    placeholder="Ex: edição do vídeo" />
                  <Button variant="outlined" onClick={apontarTempo} disabled={!Number(novoTempo.minutes)}>
                    Apontar
                  </Button>
                </Stack>
              </Box>
            )}
            <TextField label="Tags (separadas por vírgula)" value={draft.tags} onChange={set("tags")} fullWidth />
            {!draft.id && (
              <TextField label="Quantidade (lote, máx 100)" type="number" inputProps={{ min: 1, max: 100 }} value={draft.quantity} onChange={set("quantity")} fullWidth />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={save} disabled={!draft.title}>
            {draft.id ? "Salvar" : "Criar"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Data de programação obrigatória ao concluir */}
      <Dialog open={Boolean(schedule)} onClose={() => setSchedule(null)} fullWidth maxWidth="xs">
        <DialogTitle>Programar publicação</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Para concluir, informe quando este conteúdo entra no ar. Ele vai aparecer no calendário.
          </Typography>
          <TextField
            label="Data e hora da publicação" type="datetime-local" fullWidth autoFocus
            InputLabelProps={{ shrink: true }}
            value={schedule?.value || ""}
            onChange={(e) => setSchedule((s) => ({ ...s, value: e.target.value }))}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSchedule(null)}>Cancelar</Button>
          <Button
            variant="contained"
            disabled={!schedule?.value}
            onClick={() => {
              const { taskId, stageId, value } = schedule;
              setSchedule(null);
              moveToStage(taskId, stageId, value);
            }}
          >
            Programar e concluir
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
