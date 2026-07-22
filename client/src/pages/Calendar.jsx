import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Card, CardContent, Typography, Chip, IconButton, Stack, TextField,
  MenuItem, ToggleButtonGroup, ToggleButton, Dialog, DialogTitle, DialogContent,
  DialogActions, Button, Divider,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CalendarViewMonthIcon from "@mui/icons-material/CalendarViewMonth";
import ViewListIcon from "@mui/icons-material/ViewList";
import GridOnIcon from "@mui/icons-material/GridOn";
import FeedPreview from "../components/FeedPreview.jsx";
import PostComments from "../components/PostComments.jsx";
import api from "../api/client.js";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { CONTENT_TYPES, formatTime } from "../utils.js";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Imagem/vídeo do post, carregado autenticado e exibido em destaque.
function PostMedia({ file }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url;
    api.get(`/files/${file.id}/download`, { responseType: "blob" })
      .then((r) => { url = URL.createObjectURL(r.data); setSrc(url); })
      .catch(() => {});
    return () => url && URL.revokeObjectURL(url);
  }, [file.id]);
  if (!src) return null;
  if (file.mime?.startsWith("video/")) {
    return <Box component="video" src={src} controls sx={{ width: "100%", maxHeight: 440, borderRadius: 2, bgcolor: "#000" }} />;
  }
  return <Box component="img" src={src} alt={file.original_name} sx={{ width: "100%", maxHeight: 440, objectFit: "contain", borderRadius: 2, bgcolor: "action.hover" }} />;
}

export default function Calendar() {
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState("grid");
  const [clientFilter, setClientFilter] = useState("");
  const [clients, setClients] = useState([]);
  const [posts, setPosts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [feed, setFeed] = useState([]);

  // Ao abrir um post, busca a arte anexada para exibir em destaque.
  useEffect(() => {
    setAttachments([]);
    if (!selected) return;
    api.get(`/tasks/${selected.id}/attachments`).then((r) => setAttachments(r.data)).catch(() => {});
  }, [selected]);

  useEffect(() => { api.get("/clients").then((r) => setClients(r.data)); }, []);

  useEffect(() => {
    const params = { month: monthKey(cursor) };
    if (clientFilter) params.client_id = clientFilter;
    api.get("/calendar", { params }).then((r) => setPosts(r.data)).catch(() => setPosts([]));
  }, [cursor, clientFilter]);

  // A prévia do feed ignora o mês: o perfil é uma sequência contínua.
  useEffect(() => {
    if (view !== "feed") return;
    const params = clientFilter ? { client_id: clientFilter } : {};
    api.get("/calendar/feed", { params }).then((r) => setFeed(r.data)).catch(() => setFeed([]));
  }, [view, clientFilter]);

  const buscarArquivo = useCallback(
    (fileId) => api.get(`/files/${fileId}/download`, { responseType: "blob" }).then((r) => r.data),
    []
  );

  // Agrupa por dia do mês
  const byDay = useMemo(() => {
    const map = {};
    posts.forEach((p) => {
      const day = Number(p.scheduled_at.slice(8, 10));
      (map[day] ||= []).push(p);
    });
    return map;
  }, [posts]);

  // Monta a grade do mês (células vazias antes do dia 1)
  const grid = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const today = new Date();
  const isToday = (d) =>
    d === today.getDate() && cursor.getMonth() === today.getMonth() && cursor.getFullYear() === today.getFullYear();

  function shiftMonth(delta) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }

  const sortedDays = Object.keys(byDay).map(Number).sort((a, b) => a - b);

  return (
    <>
      <PageHeader
        title="Calendário"
        subtitle="Tudo que está programado para entrar no ar"
        action={
          <Stack direction="row" spacing={1.5} alignItems="center">
            <TextField select size="small" label="Empresa" value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">Todas</MenuItem>
              {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
              <ToggleButton value="grid" aria-label="Calendário"><CalendarViewMonthIcon fontSize="small" /></ToggleButton>
              <ToggleButton value="list" aria-label="Lista"><ViewListIcon fontSize="small" /></ToggleButton>
              <ToggleButton value="feed" aria-label="Prévia do feed"><GridOnIcon fontSize="small" /></ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        }
      />

      {/* Navegação de mês */}
      <Stack direction="row" alignItems="center" justifyContent="center" spacing={2} sx={{ mb: 2.5 }}>
        <IconButton onClick={() => shiftMonth(-1)}><ChevronLeftIcon /></IconButton>
        <Typography variant="h6" sx={{ minWidth: 200, textAlign: "center" }}>
          {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
        </Typography>
        <IconButton onClick={() => shiftMonth(1)}><ChevronRightIcon /></IconButton>
      </Stack>

      {view === "feed" ? (
        <Card>
          <CardContent>
            <FeedPreview posts={feed} fetchFile={buscarArquivo} onSelect={setSelected}
              titulo={clientFilter ? "Como o perfil vai ficar" : "Prévia do feed (todos os clientes)"} />
          </CardContent>
        </Card>
      ) : view === "grid" ? (
        <Card>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: 1, borderColor: "divider" }}>
            {WEEKDAYS.map((w) => (
              <Typography key={w} variant="caption" sx={{ p: 1, textAlign: "center", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "text.secondary" }}>
                {w}
              </Typography>
            ))}
          </Box>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
            {grid.map((day, i) => (
              <Box
                key={i}
                sx={{
                  minHeight: 108, p: 0.75,
                  borderRight: (i + 1) % 7 !== 0 ? 1 : 0,
                  borderBottom: i < grid.length - 7 ? 1 : 0,
                  borderColor: "divider",
                  bgcolor: day && isToday(day) ? (t) => alpha(t.palette.primary.main, 0.06) : "transparent",
                }}
              >
                {day && (
                  <>
                    <Typography variant="caption" sx={{
                      fontWeight: isToday(day) ? 800 : 600,
                      color: isToday(day) ? "primary.main" : "text.secondary",
                    }}>
                      {day}
                    </Typography>
                    <Stack spacing={0.4} sx={{ mt: 0.4 }}>
                      {(byDay[day] || []).slice(0, 3).map((p) => (
                        <Chip
                          key={p.id}
                          size="small"
                          onClick={() => setSelected(p)}
                          label={`${formatTime(p.scheduled_at)} ${p.client_name || p.title}`}
                          sx={{
                            justifyContent: "flex-start", height: 22, fontSize: 11.5,
                            bgcolor: (t) => alpha(t.palette.primary.main, 0.14),
                            color: "primary.main", fontWeight: 600,
                            "&:hover": { bgcolor: (t) => alpha(t.palette.primary.main, 0.25) },
                          }}
                        />
                      ))}
                      {(byDay[day] || []).length > 3 && (
                        <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5 }}>
                          +{byDay[day].length - 3} mais
                        </Typography>
                      )}
                    </Stack>
                  </>
                )}
              </Box>
            ))}
          </Box>
        </Card>
      ) : sortedDays.length === 0 ? (
        <EmptyState message="Nada programado neste mês." />
      ) : (
        <Stack spacing={2}>
          {sortedDays.map((day) => (
            <Card key={day}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 1.5 }}>
                  {String(day).padStart(2, "0")} de {MONTHS[cursor.getMonth()].toLowerCase()}
                </Typography>
                <Stack divider={<Divider />} spacing={1.5}>
                  {byDay[day].map((p) => (
                    <Box key={p.id} sx={{ display: "flex", gap: 2, alignItems: "flex-start", cursor: "pointer" }} onClick={() => setSelected(p)}>
                      <Typography sx={{ fontWeight: 700, minWidth: 52, fontVariantNumeric: "tabular-nums" }}>
                        {formatTime(p.scheduled_at)}
                      </Typography>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap", gap: 0.5 }}>
                          <Typography sx={{ fontWeight: 600 }}>{p.client_name || "Sem cliente"}</Typography>
                          {p.content_type && CONTENT_TYPES[p.content_type] && (
                            <Chip size="small" color="primary" variant="outlined"
                              label={`${CONTENT_TYPES[p.content_type].emoji} ${CONTENT_TYPES[p.content_type].label}`} />
                          )}
                          <Chip size="small" label={p.stage_done ? "Concluído" : p.stage_name || "—"}
                            color={p.stage_done ? "success" : "default"} variant="outlined" />
                        </Stack>
                        <Typography variant="body2" sx={{ mt: 0.3 }}>{p.title}</Typography>
                        {p.caption && (
                          <Typography variant="body2" color="text.secondary" sx={{
                            mt: 0.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                          }}>
                            {p.caption}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* Detalhe do post — a arte em destaque, legenda logo abaixo */}
      <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} fullWidth maxWidth="md">
        <DialogTitle>{selected?.title}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 0.5 }}>
              {selected?.client_name && <Chip size="small" color="primary" label={selected.client_name} />}
              {selected?.content_type && CONTENT_TYPES[selected.content_type] && (
                <Chip size="small" variant="outlined"
                  label={`${CONTENT_TYPES[selected.content_type].emoji} ${CONTENT_TYPES[selected.content_type].label}`} />
              )}
              <Chip size="small" variant="outlined" label={selected ? new Date(selected.scheduled_at).toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" }) : ""} />
              {selected?.assignee_name && <Chip size="small" variant="outlined" label={`👤 ${selected.assignee_name}`} />}
            </Stack>

            {attachments.length > 0 && (
              <Stack spacing={1.5}>
                {attachments.map((f) => <PostMedia key={f.id} file={f} />)}
              </Stack>
            )}

            {selected?.description && (
              <>
                <Divider />
                <Typography variant="subtitle2">Briefing</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
                  {selected.description}
                </Typography>
              </>
            )}

            <Divider />
            {selected && (
              <PostComments
                taskId={selected.id}
                caption={selected.client_caption || selected.caption}
                api={api}
                listPath={`/comments/${selected.id}`}
                postPath={`/comments/${selected.id}`}
                eu="agency"
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelected(null)}>Fechar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
