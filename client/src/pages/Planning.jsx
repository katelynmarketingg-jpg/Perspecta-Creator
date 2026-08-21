import { useEffect, useMemo, useState } from "react";
import {
  Box, Card, CardContent, Typography, Stack, Button, IconButton, TextField,
  MenuItem, ToggleButtonGroup, ToggleButton, Dialog, DialogTitle, DialogContent,
  DialogActions, Chip, Divider, Tooltip,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CalendarViewMonthIcon from "@mui/icons-material/CalendarViewMonth";
import CalendarViewWeekIcon from "@mui/icons-material/CalendarViewWeek";
import DateRangeIcon from "@mui/icons-material/DateRange";
import GridViewIcon from "@mui/icons-material/GridView";
import ArticleIcon from "@mui/icons-material/Article";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import EventIcon from "@mui/icons-material/Event";
import CelebrationIcon from "@mui/icons-material/Celebration";
import api from "../api/client.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { seasonalFor, CATEGORY_COLOR } from "../data/seasonalDates.js";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WD = ["D", "S", "T", "Q", "Q", "S", "S"];

const pad = (n) => String(n).padStart(2, "0");
const dstr = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const brDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${pad(d)}/${pad(m)}/${y}`;
};

// Bloco de um mês. `full` = mês grande (mostra os títulos); senão, miniatura.
function MonthBlock({ year, month, byDay, onDay, full }) {
  const first = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <Card variant="outlined" sx={{ overflow: "hidden" }}>
      <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider", bgcolor: "action.hover" }}>
        <Typography sx={{ fontWeight: 700, fontSize: full ? 16 : 13.5 }}>
          {MONTHS[month]} <Typography component="span" color="text.secondary" sx={{ fontSize: "inherit" }}>{year}</Typography>
        </Typography>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {WD.map((w, i) => (
          <Typography key={i} variant="caption" sx={{ textAlign: "center", py: 0.3, color: "text.secondary", fontWeight: 700, fontSize: full ? 12 : 10 }}>{w}</Typography>
        ))}
        {cells.map((d, i) => {
          const iso = d ? dstr(year, month, d) : null;
          const arr = (d && byDay[iso]) || [];
          const has = arr.length > 0;
          return (
            <Box key={i}
              onClick={() => d && onDay(iso)}
              sx={{
                minHeight: full ? 78 : 34, p: full ? 0.5 : 0.25,
                borderRight: (i + 1) % 7 !== 0 ? 1 : 0, borderTop: 1, borderColor: "divider",
                cursor: d ? "pointer" : "default",
                bgcolor: has ? (t) => t.palette.action.selected : "transparent",
                "&:hover": d ? { bgcolor: "action.hover" } : {},
                display: "flex", flexDirection: "column", gap: 0.25,
              }}>
              {d && (
                <>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Typography sx={{ fontSize: full ? 12.5 : 10, fontWeight: has ? 800 : 500, color: has ? "primary.main" : "text.secondary" }}>{d}</Typography>
                    {!full && has && <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "primary.main" }} />}
                  </Stack>
                  {full && arr.slice(0, 2).map((e) => (
                    <Box key={e.id} sx={{ px: 0.5, py: 0.15, borderRadius: 0.75, bgcolor: "primary.main", color: "#fff", fontSize: 10.5, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.title}
                    </Box>
                  ))}
                  {full && arr.length > 2 && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>+{arr.length - 2}</Typography>
                  )}
                </>
              )}
            </Box>
          );
        })}
      </Box>
    </Card>
  );
}

export default function Planning() {
  const [clients, setClients] = useState([]);
  const [clientFilter, setClientFilter] = useState("");
  const [dates, setDates] = useState([]);
  const [view, setView] = useState("mes"); // mes | trimestre | semestre | ano | documento
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [dayOpen, setDayOpen] = useState(null); // iso do dia aberto
  const [draft, setDraft] = useState(null);      // { id?, date, title, notes, client_id }
  const [seasonalOpen, setSeasonalOpen] = useState(false);

  // Datas comemorativas do ano em foco + quais já foram adicionadas.
  const catalogo = useMemo(() => seasonalFor(cursor.getFullYear()), [cursor]);
  const jaAdicionadas = useMemo(() => new Set(dates.map((e) => `${e.date}|${e.title}`)), [dates]);

  // Selecionar uma data comemorativa: abre o editor já preenchido para você
  // escrever a observação (ideia de post, o que preparar…) antes de salvar.
  function adicionarSazonal(d) {
    setSeasonalOpen(false);
    setDayOpen(null);
    setDraft({ date: d.date, title: d.name, notes: "", client_id: clientFilter || "" });
  }

  const load = () => {
    const params = clientFilter ? { client_id: clientFilter } : {};
    api.get("/planning", { params }).then((r) => setDates(r.data || [])).catch(() => setDates([]));
  };
  const vPlanning = useLiveVersion("planning");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [clientFilter, vPlanning]);
  useEffect(() => { api.get("/clients").then((r) => setClients(r.data)).catch(() => {}); }, []);

  const byDay = useMemo(() => {
    const map = {};
    dates.forEach((e) => { (map[e.date] ||= []).push(e); });
    return map;
  }, [dates]);

  // Quantos meses o passo de navegação anda e quantos blocos aparecem.
  const span = view === "trimestre" ? 3 : view === "semestre" ? 6 : view === "ano" ? 12 : 1;
  const shift = (n) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n * span, 1));

  const blocks = useMemo(() => {
    const out = [];
    const y = cursor.getFullYear(), m = cursor.getMonth();
    const count = view === "ano" ? 12 : span;
    for (let i = 0; i < count; i++) {
      const d = new Date(y, m + i, 1);
      out.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    return out;
  }, [cursor, view, span]);

  const rangeLabel = () => {
    if (view === "mes") return `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
    if (view === "ano") return `${cursor.getFullYear()}`;
    const last = blocks[blocks.length - 1];
    return `${MONTHS[cursor.getMonth()]}/${cursor.getFullYear()} — ${MONTHS[last.month]}/${last.year}`;
  };

  function openDay(iso) { setDayOpen(iso); setDraft(null); }
  function novo(iso) {
    setDraft({ date: iso, title: "", notes: "", client_id: clientFilter || "" });
  }
  function editar(e) {
    setDraft({ id: e.id, date: e.date, title: e.title, notes: e.notes || "", client_id: e.client_id || "" });
  }
  async function salvar() {
    const payload = { ...draft, client_id: draft.client_id || null };
    if (draft.id) await api.put(`/planning/${draft.id}`, payload);
    else await api.post("/planning", payload);
    setDraft(null);
    load();
  }
  async function excluir(e) {
    if (!confirm(`Excluir "${e.title}"?`)) return;
    await api.delete(`/planning/${e.id}`);
    setDraft(null);
    load();
  }

  const clientName = (id) => clients.find((c) => String(c.id) === String(id))?.name;
  const dayEntries = dayOpen ? (byDay[dayOpen] || []) : [];

  // Documento: todas as datas em ordem, agrupadas por mês.
  const doc = useMemo(() => {
    const groups = {};
    [...dates].sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((e) => {
      const key = e.date.slice(0, 7);
      (groups[key] ||= []).push(e);
    });
    return Object.entries(groups);
  }, [dates]);

  return (
    <>
      <PageHeader title="Planejamento"
        subtitle="Datas importantes de cada empresa — clique num dia e escreva o que é"
        action={
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: "wrap", gap: 1 }}>
            <TextField select size="small" label="Empresa" value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">Todas</MenuItem>
              {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <Button size="small" variant="outlined" startIcon={<CelebrationIcon />} onClick={() => setSeasonalOpen(true)}>
              Datas comemorativas
            </Button>
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
              <ToggleButton value="mes" aria-label="Mês"><Tooltip title="Mês"><CalendarViewMonthIcon fontSize="small" /></Tooltip></ToggleButton>
              <ToggleButton value="trimestre" aria-label="Trimestre"><Tooltip title="Trimestre"><CalendarViewWeekIcon fontSize="small" /></Tooltip></ToggleButton>
              <ToggleButton value="semestre" aria-label="Semestre"><Tooltip title="Semestre"><DateRangeIcon fontSize="small" /></Tooltip></ToggleButton>
              <ToggleButton value="ano" aria-label="Ano (12 meses)"><Tooltip title="Ano (12 meses)"><GridViewIcon fontSize="small" /></Tooltip></ToggleButton>
              <ToggleButton value="documento" aria-label="Documento"><Tooltip title="Documento"><ArticleIcon fontSize="small" /></Tooltip></ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        } />

      {view !== "documento" && (
        <Stack direction="row" alignItems="center" justifyContent="center" spacing={2} sx={{ mb: 2 }}>
          <IconButton onClick={() => shift(-1)}><ChevronLeftIcon /></IconButton>
          <Typography variant="h6" sx={{ minWidth: 260, textAlign: "center" }}>{rangeLabel()}</Typography>
          <IconButton onClick={() => shift(1)}><ChevronRightIcon /></IconButton>
        </Stack>
      )}

      {view === "documento" ? (
        <Card>
          <CardContent>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
              <Typography variant="h6">
                Datas importantes {clientFilter ? `— ${clientName(clientFilter)}` : "(todas as empresas)"}
              </Typography>
              <Button size="small" startIcon={<AddIcon />}
                onClick={() => { const t = new Date(); novo(dstr(t.getFullYear(), t.getMonth(), t.getDate())); }}>
                Nova data
              </Button>
            </Stack>
            {doc.length === 0 ? (
              <EmptyState message="Nenhuma data importante ainda. Clique num dia no calendário (ou em 'Nova data')." />
            ) : (
              doc.map(([key, arr]) => {
                const [y, m] = key.split("-").map(Number);
                return (
                  <Box key={key} sx={{ mb: 2.5 }}>
                    <Typography variant="subtitle2" color="primary" sx={{ fontWeight: 800, mb: 0.5 }}>
                      {MONTHS[m - 1]} {y}
                    </Typography>
                    <Divider sx={{ mb: 1 }} />
                    <Stack spacing={1}>
                      {arr.map((e) => (
                        <Stack key={e.id} direction="row" spacing={1.5} alignItems="flex-start"
                          sx={{ "&:hover .acts": { opacity: 1 } }}>
                          <Chip size="small" icon={<EventIcon sx={{ fontSize: 15 }} />} label={brDate(e.date)}
                            sx={{ fontWeight: 700, flexShrink: 0 }} />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 600 }}>
                              {e.title}
                              {!clientFilter && e.client_name && (
                                <Typography component="span" variant="caption" color="text.secondary"> · {e.client_name}</Typography>
                              )}
                            </Typography>
                            {e.notes && <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>{e.notes}</Typography>}
                          </Box>
                          <Box className="acts" sx={{ opacity: { xs: 1, md: 0 }, transition: "opacity .15s", flexShrink: 0 }}>
                            <IconButton size="small" onClick={() => editar(e)}><EditIcon sx={{ fontSize: 16 }} /></IconButton>
                            <IconButton size="small" color="error" onClick={() => excluir(e)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                          </Box>
                        </Stack>
                      ))}
                    </Stack>
                  </Box>
                );
              })
            )}
          </CardContent>
        </Card>
      ) : view === "mes" ? (
        <MonthBlock {...blocks[0]} byDay={byDay} onDay={openDay} full />
      ) : (
        <Box sx={{
          display: "grid", gap: 2,
          gridTemplateColumns: view === "ano"
            ? { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)", lg: "repeat(4, 1fr)" }
            : view === "semestre"
              ? { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)" }
              : { xs: "1fr", sm: "repeat(3, 1fr)" },
        }}>
          {blocks.map((b) => <MonthBlock key={`${b.year}-${b.month}`} {...b} byDay={byDay} onDay={openDay} />)}
        </Box>
      )}

      {/* Dia aberto: lista as datas daquele dia e permite adicionar/editar */}
      <Dialog open={Boolean(dayOpen)} onClose={() => { setDayOpen(null); setDraft(null); }} fullWidth maxWidth="xs">
        <DialogTitle>{dayOpen && brDate(dayOpen)}</DialogTitle>
        <DialogContent>
          {!draft && (
            <Stack spacing={1} sx={{ mt: 0.5 }}>
              {dayEntries.length === 0 && (
                <Typography variant="body2" color="text.secondary">Nada marcado neste dia ainda.</Typography>
              )}
              {dayEntries.map((e) => (
                <Card key={e.id} variant="outlined">
                  <CardContent sx={{ p: 1.25, "&:last-child": { pb: 1.25 } }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 600 }}>{e.title}</Typography>
                        {!clientFilter && e.client_name && (
                          <Typography variant="caption" color="text.secondary">{e.client_name}</Typography>
                        )}
                        {e.notes && <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>{e.notes}</Typography>}
                      </Box>
                      <Box sx={{ flexShrink: 0 }}>
                        <IconButton size="small" onClick={() => editar(e)}><EditIcon sx={{ fontSize: 16 }} /></IconButton>
                        <IconButton size="small" color="error" onClick={() => excluir(e)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                      </Box>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
              <Button startIcon={<AddIcon />} onClick={() => novo(dayOpen)} sx={{ alignSelf: "flex-start" }}>
                Adicionar data importante
              </Button>
            </Stack>
          )}

          {draft && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField label="Data" type="date" InputLabelProps={{ shrink: true }} value={draft.date}
                onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} fullWidth />
              <TextField label="O que é? *" value={draft.title} autoFocus fullWidth
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="Ex: Dia das Mães, lançamento da coleção, prazo do material…" />
              <TextField select label="Empresa" value={draft.client_id}
                onChange={(e) => setDraft((d) => ({ ...d, client_id: e.target.value }))} fullWidth>
                <MenuItem value="">Geral (todas)</MenuItem>
                {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </TextField>
              <TextField label="Observação" value={draft.notes} multiline rows={3} fullWidth
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="Detalhes, ideias, o que precisa estar pronto…" />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {draft ? (
            <>
              <Button onClick={() => setDraft(null)}>Voltar</Button>
              <Button variant="contained" onClick={salvar} disabled={!draft.title || !draft.date}>Salvar</Button>
            </>
          ) : (
            <Button onClick={() => setDayOpen(null)}>Fechar</Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Editor aberto pelo documento (sem um dia específico) */}
      <Dialog open={Boolean(draft && !dayOpen)} onClose={() => setDraft(null)} fullWidth maxWidth="xs">
        <DialogTitle>{draft?.id ? "Editar data" : "Nova data importante"}</DialogTitle>
        <DialogContent>
          {draft && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField label="Data" type="date" InputLabelProps={{ shrink: true }} value={draft.date}
                onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} fullWidth />
              <TextField label="O que é? *" value={draft.title} autoFocus fullWidth
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
              <TextField select label="Empresa" value={draft.client_id}
                onChange={(e) => setDraft((d) => ({ ...d, client_id: e.target.value }))} fullWidth>
                <MenuItem value="">Geral (todas)</MenuItem>
                {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </TextField>
              <TextField label="Observação" value={draft.notes} multiline rows={3} fullWidth
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>Cancelar</Button>
          <Button variant="contained" onClick={salvar} disabled={!draft?.title || !draft?.date}>Salvar</Button>
        </DialogActions>
      </Dialog>

      {/* Catálogo de datas comemorativas — clicar adiciona ao planejamento */}
      <Dialog open={seasonalOpen} onClose={() => setSeasonalOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <span>Datas comemorativas</span>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <IconButton size="small" onClick={() => setCursor((c) => new Date(c.getFullYear() - 1, c.getMonth(), 1))}><ChevronLeftIcon /></IconButton>
              <Typography sx={{ fontWeight: 700, minWidth: 48, textAlign: "center" }}>{cursor.getFullYear()}</Typography>
              <IconButton size="small" onClick={() => setCursor((c) => new Date(c.getFullYear() + 1, c.getMonth(), 1))}><ChevronRightIcon /></IconButton>
            </Stack>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Clique em <b>Selecionar</b> para adicionar ao planejamento {clientFilter ? `de ${clientName(clientFilter)}` : "(Geral — todas as empresas)"} —
            abre para você escrever a observação (ideia de post, o que preparar…) antes de salvar.
            As datas móveis (Mães, Pais, Black Friday, Páscoa…) já vêm no dia certo do ano.
          </Typography>
          <Stack spacing={0}>
            {catalogo.map((d) => {
              const added = jaAdicionadas.has(`${d.date}|${d.name}`);
              return (
                <Stack key={d.date + d.name} direction="row" spacing={1} alignItems="center"
                  sx={{ borderBottom: 1, borderColor: "divider", py: 0.6 }}>
                  <Chip size="small" label={brDate(d.date)} sx={{ fontWeight: 700, minWidth: 78 }} />
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>{d.name}</Typography>
                  <Chip size="small" variant="outlined" color={CATEGORY_COLOR[d.category] || "default"} label={d.category} />
                  <Button size="small" onClick={() => adicionarSazonal(d)}>
                    {added ? "✓ Adicionar de novo" : "Selecionar"}
                  </Button>
                </Stack>
              );
            })}
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setSeasonalOpen(false)}>Fechar</Button></DialogActions>
      </Dialog>
    </>
  );
}
