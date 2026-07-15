import { useEffect, useState } from "react";
import {
  Card, CardContent, TextField, Stack, Typography, Chip, Box, Divider, Button,
  MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, IconButton,
  FormControlLabel, Switch, Link, Tooltip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import LinkIcon from "@mui/icons-material/Link";
import DescriptionIcon from "@mui/icons-material/Description";
import api from "../api/client.js";
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

  const load = () => {
    const params = { date };
    if (owner === "me") params.owner_id = user?.id;
    else if (owner !== "all") params.owner_id = owner;
    api.get("/agenda/day", { params }).then((r) => setRows(r.data)).catch(() => setRows([]));
  };
  useEffect(() => { load(); }, [date, owner]);

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
          <Stack direction="row" spacing={1.5} alignItems="center">
            <TextField select size="small" label="Agenda de" value={owner}
              onChange={(e) => setOwner(e.target.value)} sx={{ minWidth: 160 }}>
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

      {rows.length === 0 ? (
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
