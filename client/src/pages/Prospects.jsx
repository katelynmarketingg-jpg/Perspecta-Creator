import { useEffect, useState } from "react";
import {
  Box, Button, Card, CardContent, Typography, Chip, IconButton, Stack, Dialog,
  DialogTitle, DialogContent, DialogActions, TextField, MenuItem, Divider, Tooltip,
  Alert,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import ChatIcon from "@mui/icons-material/Chat";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import api from "../api/client.js";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { formatDate } from "../utils.js";

const COLUNAS = [
  { key: "novo", label: "A contatar" },
  { key: "conversando", label: "Conversando" },
  { key: "proposta", label: "Proposta enviada" },
  { key: "fechado", label: "Fechou" },
  { key: "perdido", label: "Não rolou" },
];

const EMPTY = {
  name: "", company: "", segment: "", phone: "", email: "", instagram: "",
  status: "novo", notes: "",
};

export default function Prospects() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [contato, setContato] = useState(null); // prospect recebendo novo contato
  const [novoContato, setNovoContato] = useState({ channel: "whatsapp", summary: "", touch_date: "" });
  const [msg, setMsg] = useState("");

  const load = () => api.get("/prospects").then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  async function salvar() {
    if (draft.id) await api.put(`/prospects/${draft.id}`, draft);
    else await api.post("/prospects", draft);
    setOpen(false);
    load();
  }

  async function remover(p) {
    if (!confirm(`Excluir ${p.name} da prospecção?`)) return;
    await api.delete(`/prospects/${p.id}`);
    load();
  }

  async function registrarContato() {
    await api.post(`/prospects/${contato.id}/touches`, novoContato);
    setContato(null);
    setNovoContato({ channel: "whatsapp", summary: "", touch_date: "" });
    load();
  }

  async function virarCliente(p) {
    if (!confirm(`Transformar ${p.name} em cliente? Ele vai aparecer na aba Clientes.`)) return;
    await api.post(`/prospects/${p.id}/convert`);
    setMsg(`${p.name} agora é cliente. Complete o cadastro em Clientes.`);
    setTimeout(() => setMsg(""), 6000);
    load();
  }

  const porStatus = (key) => rows.filter((p) => p.status === key);

  return (
    <>
      <PageHeader
        title="Prospecção"
        subtitle="Quem ainda não é cliente e o histórico de cada conversa"
        action={
          <Button variant="contained" startIcon={<AddIcon />}
            onClick={() => { setDraft(EMPTY); setOpen(true); }}>
            Novo contato
          </Button>
        }
      />

      {msg && <Alert severity="success" sx={{ mb: 2 }}>{msg}</Alert>}

      {rows.length === 0 ? (
        <EmptyState message="Ninguém na prospecção ainda. Anote quem você quer atender."
          action={<Button onClick={() => { setDraft(EMPTY); setOpen(true); }}>Adicionar</Button>} />
      ) : (
        <Box sx={{ display: "flex", gap: 2, overflowX: "auto", pb: 2, alignItems: "flex-start" }}>
          {COLUNAS.map((col) => (
            <Box key={col.key} sx={{ minWidth: 290, width: 290, flexShrink: 0 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 0.5, mb: 1 }}>
                <Typography sx={{ fontWeight: 700 }}>{col.label}</Typography>
                <Chip size="small" label={porStatus(col.key).length} />
              </Stack>
              <Stack spacing={1.5}>
                {porStatus(col.key).map((p) => (
                  <Card key={p.id} sx={{ "&:hover": { borderColor: "primary.main" }, transition: "border-color .15s ease" }}>
                    <CardContent sx={{ p: 1.75, "&:last-child": { pb: 1.75 } }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 600, fontSize: 14.5 }}>{p.name}</Typography>
                          {p.company && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                              {p.company}
                            </Typography>
                          )}
                        </Box>
                        <Box sx={{ flexShrink: 0 }}>
                          <IconButton size="small" onClick={() => { setDraft({ ...p }); setOpen(true); }}>
                            <EditIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                          <IconButton size="small" color="error" onClick={() => remover(p)}>
                            <DeleteIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Box>
                      </Stack>

                      <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: "wrap", gap: 0.5 }}>
                        {p.segment && <Chip size="small" variant="outlined" label={p.segment} />}
                        {p.instagram && <Chip size="small" variant="outlined" label={p.instagram} />}
                      </Stack>
                      {(p.phone || p.email) && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
                          {[p.phone, p.email].filter(Boolean).join(" · ")}
                        </Typography>
                      )}

                      {/* Histórico: 1º contato, 2º contato... */}
                      {p.touches?.length > 0 && (
                        <Box sx={{ mt: 1.25, pt: 1.25, borderTop: 1, borderColor: "divider" }}>
                          {p.touches.slice(-2).map((t, i) => {
                            const n = p.touches.indexOf(t) + 1;
                            return (
                              <Box key={t.id} sx={{ mb: i === 0 && p.touches.length > 1 ? 0.75 : 0 }}>
                                <Typography variant="caption" sx={{ fontWeight: 700, color: "primary.main" }}>
                                  {n}º contato · {formatDate(t.touch_date)}{t.channel ? ` · ${t.channel}` : ""}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.35 }}>
                                  {t.summary}
                                </Typography>
                              </Box>
                            );
                          })}
                          {p.touches.length > 2 && (
                            <Typography variant="caption" color="text.disabled">
                              +{p.touches.length - 2} contato(s) antes
                            </Typography>
                          )}
                        </Box>
                      )}

                      <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
                        <Button size="small" startIcon={<ChatIcon sx={{ fontSize: 15 }} />}
                          onClick={() => setContato(p)}>
                          {p.touches?.length ? `${p.touches.length + 1}º contato` : "1º contato"}
                        </Button>
                        {p.status !== "fechado" && (
                          <Tooltip title="Virou cliente">
                            <IconButton size="small" color="success" onClick={() => virarCliente(p)}>
                              <HowToRegIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
                {porStatus(col.key).length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 2 }}>
                    Ninguém aqui
                  </Typography>
                )}
              </Stack>
            </Box>
          ))}
        </Box>
      )}

      {/* Cadastro */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{draft.id ? "Editar contato" : "Novo contato"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Nome da pessoa *" value={draft.name} onChange={set("name")} fullWidth
              placeholder="Ex: Marina Rocha" />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Empresa" value={draft.company || ""} onChange={set("company")} fullWidth />
              <TextField label="Segmento" value={draft.segment || ""} onChange={set("segment")} fullWidth />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Telefone" value={draft.phone || ""} onChange={set("phone")} fullWidth />
              <TextField label="Instagram" value={draft.instagram || ""} onChange={set("instagram")} fullWidth
                placeholder="@perfil" />
            </Stack>
            <TextField label="E-mail" value={draft.email || ""} onChange={set("email")} fullWidth />
            <TextField select label="Situação" value={draft.status} onChange={set("status")} fullWidth>
              {COLUNAS.map((c) => <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>)}
            </TextField>
            <TextField label="Observações" value={draft.notes || ""} onChange={set("notes")}
              fullWidth multiline rows={3}
              placeholder="O que sabemos: porte, o que precisa, quem indicou…" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={salvar} disabled={!draft.name}>Salvar</Button>
        </DialogActions>
      </Dialog>

      {/* Registrar contato */}
      <Dialog open={Boolean(contato)} onClose={() => setContato(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          {contato?.touches?.length ? `${contato.touches.length + 1}º contato` : "1º contato"} — {contato?.name}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction="row" spacing={2}>
              <TextField select label="Por onde" value={novoContato.channel} sx={{ minWidth: 140 }}
                onChange={(e) => setNovoContato((c) => ({ ...c, channel: e.target.value }))}>
                <MenuItem value="whatsapp">WhatsApp</MenuItem>
                <MenuItem value="ligação">Ligação</MenuItem>
                <MenuItem value="e-mail">E-mail</MenuItem>
                <MenuItem value="presencial">Presencial</MenuItem>
                <MenuItem value="instagram">Instagram</MenuItem>
              </TextField>
              <TextField label="Quando" type="date" InputLabelProps={{ shrink: true }} fullWidth
                value={novoContato.touch_date}
                onChange={(e) => setNovoContato((c) => ({ ...c, touch_date: e.target.value }))} />
            </Stack>
            <TextField label="O que aconteceu *" multiline rows={4} fullWidth autoFocus
              value={novoContato.summary}
              onChange={(e) => setNovoContato((c) => ({ ...c, summary: e.target.value }))}
              placeholder="Mandei a apresentação. Pediu para retomar depois do dia 20." />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setContato(null)}>Cancelar</Button>
          <Button variant="contained" onClick={registrarContato} disabled={!novoContato.summary.trim()}>
            Registrar
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
