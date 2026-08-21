import { useEffect, useMemo, useState } from "react";
import {
  Card, CardContent, TextField, Stack, Typography, Chip, Box, Divider, Button,
  MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, IconButton,
  FormControlLabel, Switch, Link, Tooltip, ToggleButtonGroup, ToggleButton,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import LinkIcon from "@mui/icons-material/Link";
import DescriptionIcon from "@mui/icons-material/Description";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WD = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseD = (s) => new Date(s + "T12:00:00");
// Segunda-feira da semana que contém a data.
function monday(d) { const x = new Date(d); x.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return x; }
import api from "../api/client.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { useAuth } from "../auth/AuthContext.jsx";

const EMPTY = {
  title: "", type_id: "", client_id: "", start_at: "", end_at: "",
  owner_id: "", notes: "", doc_content: "", link_url: "", visible_to_client: true,
};

export default function Agenda() {
  const { user } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [view, setView] = useState("dia"); // dia | semana | mes
  const [owner, setOwner] = useState("me"); // 'me' | 'all' | userId
  const [team, setTeam] = useState([]);
  const [types, setTypes] = useState([]);
  const [clients, setClients] = useState([]);
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [plan, setPlan] = useState(null); // evento com plano aberto

  useEffect(() => {
    api.get("/users/team").then((r) => setTeam(r.data)).catch(() => {});
    api.get("/events/types").then((r) => setTypes(r.data)).catch(() => {});
    api.get("/clients").then((r) => setClients(r.data)).catch(() => {});
  }, []);

  // Intervalo (from/to) da semana ou do mês que contém a data.
  function rangeFor() {
    const d = parseD(date);
    if (view === "semana") { const ini = monday(d); const fim = new Date(ini); fim.setDate(ini.getDate() + 6); return { from: ymd(ini), to: ymd(fim) }; }
    if (view === "mes") { return { from: ymd(new Date(d.getFullYear(), d.getMonth(), 1)), to: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }; }
    return null;
  }
  const load = () => {
    const params = {};
    if (owner === "me") params.owner_id = user?.id;
    else if (owner !== "all") params.owner_id = owner;
    if (view === "dia") {
      api.get("/agenda/day", { params: { ...params, date } }).then((r) => setRows(r.data)).catch(() => setRows([]));
    } else {
      api.get("/agenda", { params: { ...params, ...rangeFor() } }).then((r) => setRows(r.data)).catch(() => setRows([]));
    }
  };
  // Ao vivo: a agenda grava via /events, então escuta o recurso "events".
  const vEvents = useLiveVersion("events");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [date, view, owner, vEvents]);

  // Eventos agrupados por dia (para semana/mês).
  const byDay = useMemo(() => {
    const map = {};
    rows.forEach((e) => { const k = (e.start_at || "").slice(0, 10); if (k) (map[k] ||= []).push(e); });
    return map;
  }, [rows]);

  // Anda ◀ ▶ conforme a visão (1 dia / 7 dias / 1 mês).
  function shift(dir) {
    const d = parseD(date);
    if (view === "dia") d.setDate(d.getDate() + dir);
    else if (view === "semana") d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setDate(ymd(d));
  }
  function abrirDia(iso) { setDate(iso); setView("dia"); }

  // Células do mês (segunda-feira como 1ª coluna).
  const monthCells = useMemo(() => {
    const d = parseD(date), y = d.getFullYear(), m = d.getMonth();
    const first = (new Date(y, m, 1).getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(null);
    for (let dd = 1; dd <= days; dd++) cells.push(dd);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [date]);
  const cellIso = (day) => { const d = parseD(date); return ymd(new Date(d.getFullYear(), d.getMonth(), day)); };
  const weekDays = useMemo(() => {
    const ini = monday(parseD(date));
    return [0, 1, 2, 3, 4, 5, 6].map((i) => { const d = new Date(ini); d.setDate(ini.getDate() + i); return d; });
  }, [date]);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const time = (v) => (v ? new Date(v).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");

  function openNew() {
    setDraft({
      ...EMPTY,
      owner_id: owner === "all" ? user?.id || "" : owner === "me" ? user?.id || "" : owner,
      start_at: `${date}T09:00`,
    });
    setOpen(true);
  }

  function openEdit(ev) {
    setDraft({
      ...EMPTY,
      ...ev,
      type_id: ev.type_id || "",
      client_id: ev.client_id || "",
      owner_id: ev.owner_id || "",
      start_at: ev.start_at ? ev.start_at.slice(0, 16) : "",
      end_at: ev.end_at ? ev.end_at.slice(0, 16) : "",
      doc_content: ev.doc_content || "",
      link_url: ev.link_url || "",
      visible_to_client: Boolean(ev.visible_to_client),
    });
    setOpen(true);
  }

  async function save() {
    const payload = {
      ...draft,
      type_id: draft.type_id || null,
      client_id: draft.client_id || null,
      owner_id: draft.owner_id || null,
    };
    if (draft.id) await api.put(`/events/${draft.id}`, payload);
    else await api.post("/events", payload);
    setOpen(false);
    load();
  }

  async function remove(id) {
    if (!confirm("Excluir compromisso?")) return;
    await api.delete(`/events/${id}`);
    load();
  }

  return (
    <>
      <PageHeader
        title="Agenda"
        subtitle="Compromissos de cada pessoa da equipe"
        action={
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: "wrap", gap: 1 }}>
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
              <ToggleButton value="dia">Dia</ToggleButton>
              <ToggleButton value="semana">Semana</ToggleButton>
              <ToggleButton value="mes">Mês</ToggleButton>
            </ToggleButtonGroup>
            <TextField select size="small" label="Agenda de" value={owner}
              onChange={(e) => setOwner(e.target.value)} sx={{ minWidth: 150 }}>
              <MenuItem value="me">Minha agenda</MenuItem>
              <MenuItem value="all">Todos</MenuItem>
              {team.filter((u) => u.id !== user?.id).map((u) => (
                <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
              ))}
            </TextField>
            <TextField type="date" size="small" value={date} onChange={(e) => setDate(e.target.value)} />
            <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>Novo</Button>
          </Stack>
        }
      />

      {/* Navegação ◀ período ▶ */}
      <Stack direction="row" alignItems="center" justifyContent="center" spacing={2} sx={{ mb: 2 }}>
        <IconButton onClick={() => shift(-1)}><ChevronLeftIcon /></IconButton>
        <Typography variant="h6" sx={{ minWidth: 240, textAlign: "center", textTransform: "capitalize" }}>
          {view === "dia"
            ? parseD(date).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })
            : view === "mes"
              ? `${MONTHS[parseD(date).getMonth()]} ${parseD(date).getFullYear()}`
              : (() => { const i = monday(parseD(date)); const f = new Date(i); f.setDate(i.getDate() + 6);
                  return `${String(i.getDate()).padStart(2, "0")}/${String(i.getMonth() + 1).padStart(2, "0")} – ${String(f.getDate()).padStart(2, "0")}/${String(f.getMonth() + 1).padStart(2, "0")}`; })()}
        </Typography>
        <IconButton onClick={() => shift(1)}><ChevronRightIcon /></IconButton>
      </Stack>

      {view === "semana" ? (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(7, 1fr)" }, gap: 1, alignItems: "start" }}>
          {weekDays.map((d, i) => {
            const iso = ymd(d);
            const evs = (byDay[iso] || []).slice().sort((a, b) => (a.start_at || "").localeCompare(b.start_at || ""));
            return (
              <Card key={iso} variant="outlined">
                <Box sx={{ px: 1, py: 0.75, borderBottom: 1, borderColor: "divider", bgcolor: iso === today ? "action.selected" : "action.hover", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>{WD[i]} {String(d.getDate()).padStart(2, "0")}</Typography>
                  <IconButton size="small" onClick={() => { setDraft({ ...EMPTY, owner_id: (owner !== "all" && owner !== "me") ? owner : user?.id || "", start_at: `${iso}T09:00` }); setOpen(true); }}>
                    <AddIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Box>
                <Stack spacing={0.5} sx={{ p: 0.75, minHeight: 80 }}>
                  {evs.map((e) => (
                    <Box key={e.id} onClick={() => openEdit(e)} sx={{ cursor: "pointer", borderLeft: 3, borderColor: e.type_color || "primary.main", pl: 0.75, py: 0.25, borderRadius: 0.5, "&:hover": { bgcolor: "action.hover" } }}>
                      <Typography variant="caption" sx={{ fontWeight: 700 }}>{time(e.start_at)}</Typography>
                      <Typography variant="caption" sx={{ display: "block" }} noWrap>{e.title}</Typography>
                    </Box>
                  ))}
                  {evs.length === 0 && <Typography variant="caption" color="text.disabled" sx={{ textAlign: "center", py: 1 }}>—</Typography>}
                </Stack>
              </Card>
            );
          })}
        </Box>
      ) : view === "mes" ? (
        <Card>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: 1, borderColor: "divider" }}>
            {WD.map((w) => <Typography key={w} variant="caption" sx={{ p: 1, textAlign: "center", fontWeight: 700, color: "text.secondary" }}>{w}</Typography>)}
          </Box>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
            {monthCells.map((day, i) => {
              const iso = day ? cellIso(day) : null;
              const evs = iso ? (byDay[iso] || []) : [];
              return (
                <Box key={i} onClick={() => day && abrirDia(iso)}
                  sx={{ minHeight: 96, p: 0.5, borderRight: (i + 1) % 7 !== 0 ? 1 : 0, borderBottom: i < monthCells.length - 7 ? 1 : 0, borderColor: "divider", cursor: day ? "pointer" : "default", bgcolor: iso === today ? "action.selected" : "transparent", "&:hover": day ? { bgcolor: "action.hover" } : {} }}>
                  {day && (
                    <>
                      <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>{day}</Typography>
                      <Stack spacing={0.25} sx={{ mt: 0.3 }}>
                        {evs.slice(0, 3).map((e) => (
                          <Box key={e.id} sx={{ px: 0.5, py: 0.15, borderRadius: 0.5, bgcolor: e.type_color || "primary.main", color: "#fff", fontSize: 10, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {time(e.start_at)} {e.title}
                          </Box>
                        ))}
                        {evs.length > 3 && <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>+{evs.length - 3}</Typography>}
                      </Stack>
                    </>
                  )}
                </Box>
              );
            })}
          </Box>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState message="Nenhum compromisso neste dia."
          action={<Button startIcon={<AddIcon />} onClick={openNew}>Agendar</Button>} />
      ) : (
        <Card>
          <CardContent>
            <Stack divider={<Divider />} spacing={0}>
              {rows.map((e) => (
                <Box key={e.id} sx={{ display: "flex", gap: 2, py: 1.5, alignItems: "flex-start" }}>
                  <Box sx={{ width: 64, textAlign: "center" }}>
                    <Typography sx={{ fontWeight: 700 }}>{time(e.start_at)}</Typography>
                    {e.end_at && <Typography variant="caption" color="text.secondary">{time(e.end_at)}</Typography>}
                  </Box>
                  <Box sx={{ width: 4, alignSelf: "stretch", borderRadius: 2, bgcolor: e.type_color || "primary.main" }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600 }}>{e.title}</Typography>
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
                      {e.type_name && <Chip size="small" label={e.type_name} sx={{ bgcolor: e.type_color, color: "#fff" }} />}
                      {e.client_name && <Chip size="small" variant="outlined" color="primary" label={e.client_name} />}
                      {e.owner_name && <Chip size="small" variant="outlined" label={`👤 ${e.owner_name}`} />}
                      {Boolean(e.visible_to_client) && e.client_id && (
                        <Tooltip title="O cliente vê este compromisso no portal">
                          <Chip size="small" variant="outlined" label="👁 visível ao cliente" />
                        </Tooltip>
                      )}
                    </Stack>
                    {e.notes && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{e.notes}</Typography>}
                    <Stack direction="row" spacing={1} sx={{ mt: 0.75 }}>
                      {e.doc_content && (
                        <Button size="small" variant="outlined" startIcon={<DescriptionIcon />} onClick={() => setPlan(e)}>
                          Ver plano
                        </Button>
                      )}
                      {e.link_url && (
                        <Button size="small" variant="outlined" startIcon={<LinkIcon />}
                          component={Link} href={e.link_url} target="_blank" rel="noopener">
                          Abrir link
                        </Button>
                      )}
                    </Stack>
                  </Box>
                  <Box>
                    <IconButton size="small" onClick={() => openEdit(e)}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => remove(e.id)}><DeleteIcon fontSize="small" /></IconButton>
                  </Box>
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* Criar / editar compromisso */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{draft.id ? "Editar compromisso" : "Novo compromisso"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Título *" value={draft.title} onChange={set("title")} fullWidth
              placeholder="Ex: Dia de captação, Reunião de pauta..." />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField select label="Tipo" value={draft.type_id} onChange={set("type_id")} fullWidth>
                <MenuItem value="">Sem tipo</MenuItem>
                {types.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
              </TextField>
              <TextField select label="Responsável (agenda de quem)" value={draft.owner_id} onChange={set("owner_id")} fullWidth>
                <MenuItem value="">Ninguém</MenuItem>
                {team.map((u) => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
              </TextField>
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Início *" type="datetime-local" InputLabelProps={{ shrink: true }}
                value={draft.start_at} onChange={set("start_at")} fullWidth />
              <TextField label="Fim" type="datetime-local" InputLabelProps={{ shrink: true }}
                value={draft.end_at} onChange={set("end_at")} fullWidth />
            </Stack>
            <TextField select label="Cliente vinculado" value={draft.client_id} onChange={set("client_id")} fullWidth
              helperText="Se marcado como visível, aparece no portal do cliente.">
              <MenuItem value="">Sem cliente</MenuItem>
              {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            {draft.client_id && (
              <FormControlLabel
                control={<Switch checked={draft.visible_to_client}
                  onChange={(e) => setDraft((d) => ({ ...d, visible_to_client: e.target.checked }))} />}
                label="Visível no portal do cliente" />
            )}
            <TextField label="Observações" value={draft.notes || ""} onChange={set("notes")} fullWidth multiline rows={2} />
            <Divider>Plano do dia (o cliente pode acessar)</Divider>
            <TextField label="Documento — o que vamos fazer" value={draft.doc_content} onChange={set("doc_content")}
              fullWidth multiline rows={5}
              placeholder={"Ex:\n- 3 vídeos de bastidores\n- Fotos dos pratos novos\n- Depoimento da equipe"} />
            <TextField label="Link (roteiro, pasta, referências...)" value={draft.link_url} onChange={set("link_url")}
              fullWidth placeholder="https://..." />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={save} disabled={!draft.title || !draft.start_at}>Salvar</Button>
        </DialogActions>
      </Dialog>

      {/* Plano do compromisso */}
      <Dialog open={Boolean(plan)} onClose={() => setPlan(null)} fullWidth maxWidth="sm">
        <DialogTitle>{plan?.title} — plano</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>{plan?.doc_content}</Typography>
          {plan?.link_url && (
            <Button sx={{ mt: 2 }} variant="outlined" startIcon={<LinkIcon />}
              component={Link} href={plan.link_url} target="_blank" rel="noopener">
              Abrir link
            </Button>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPlan(null)}>Fechar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
