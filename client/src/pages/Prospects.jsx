import { useEffect, useRef, useState } from "react";
import {
  Box, Button, Card, CardContent, Typography, Chip, IconButton, Stack, Dialog,
  DialogTitle, DialogContent, DialogActions, TextField, MenuItem, Tooltip,
  Alert,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import ChatIcon from "@mui/icons-material/Chat";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import LockIcon from "@mui/icons-material/Lock";
import api from "../api/client.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { formatDate } from "../utils.js";

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
  // Arraste-e-solte entre colunas.
  const dragId = useRef(null);
  const [overCol, setOverCol] = useState(null);
  // Colunas editáveis.
  const [stages, setStages] = useState([]);
  const [editCols, setEditCols] = useState(false);
  const [novaColuna, setNovaColuna] = useState("");

  const load = () => api.get("/prospects").then((r) => setRows(r.data)).catch(() => {});
  const loadStages = () => api.get("/prospects/stages").then((r) => setStages(r.data)).catch(() => {});
  // Ao vivo: recarrega quando alguém mexe na prospecção.
  const vProspects = useLiveVersion("prospects");
  useEffect(() => { load(); }, [vProspects]);
  useEffect(() => { loadStages(); }, []);

  const wonKey = stages.find((s) => s.kind === "won")?.key || "fechado";
  const lostKey = stages.find((s) => s.kind === "lost")?.key || "perdido";

  async function addColuna() {
    if (!novaColuna.trim()) return;
    await api.post("/prospects/stages", { label: novaColuna.trim() });
    setNovaColuna("");
    loadStages();
  }
  async function renomearColuna(s, label) {
    await api.put(`/prospects/stages/${s.id}`, { label });
    loadStages();
  }
  async function excluirColuna(s) {
    if (!confirm(`Excluir a coluna "${s.label}"? Os contatos dela vão para a primeira coluna.`)) return;
    await api.delete(`/prospects/stages/${s.id}`);
    loadStages(); load();
  }
  async function moverColuna(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= stages.length) return;
    const arr = [...stages];
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    const withPos = arr.map((s, i) => ({ ...s, position: i }));
    setStages(withPos);
    try {
      await Promise.all([idx, j].map((k) => {
        const s = withPos.find((x) => x.id === stages[k].id);
        return api.put(`/prospects/stages/${s.id}`, { position: s.position });
      }));
      loadStages();
    } catch { loadStages(); }
  }

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

  // "Finalizar" = encerrar a negociação que não virou cliente (vai para "Não rolou").
  async function finalizar(p) {
    if (!confirm(`Finalizar ${p.name}? Ele vai para "Não rolou" e sai do funil ativo.`)) return;
    await mudarStatus(p, lostKey);
    setMsg(`${p.name} foi finalizado (Não rolou).`);
    setTimeout(() => setMsg(""), 5000);
  }

  // Muda a situação (ao arrastar entre colunas ou pelos botões). Atualiza na hora
  // e, se der erro, recarrega para voltar ao estado real.
  async function mudarStatus(p, status) {
    if (p.status === status) return;
    setRows((rs) => rs.map((r) => (r.id === p.id ? { ...r, status } : r)));
    try { await api.put(`/prospects/${p.id}`, { status }); }
    catch { load(); }
  }

  function onDrop(colKey) {
    const id = dragId.current;
    dragId.current = null;
    setOverCol(null);
    const p = rows.find((r) => r.id === id);
    if (p) mudarStatus(p, colKey);
  }

  const porStatus = (key) => rows.filter((p) => p.status === key);

  // Resumo (mini-relatório): quantos em cada fase, quantos viraram cliente e a
  // taxa de conversão sobre o total já trabalhado.
  const total = rows.length;
  const fechados = porStatus(wonKey).length;
  const perdidos = porStatus(lostKey).length;
  const ativos = total - fechados - perdidos;
  const encerrados = fechados + perdidos;
  const conversao = encerrados ? Math.round((fechados / encerrados) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Prospecção"
        subtitle="Arraste os cartões entre as colunas conforme a conversa anda"
        action={
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            <Button variant={editCols ? "contained" : "outlined"} startIcon={<ViewColumnIcon />}
              onClick={() => setEditCols((v) => !v)}>
              {editCols ? "Concluir colunas" : "Editar colunas"}
            </Button>
            <Button variant="contained" startIcon={<AddIcon />}
              onClick={() => { setDraft(EMPTY); setOpen(true); }}>
              Novo contato
            </Button>
          </Stack>
        }
      />

      {msg && <Alert severity="success" sx={{ mb: 2 }}>{msg}</Alert>}

      {/* Mini-relatório do funil */}
      {rows.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 2.5, flexWrap: "wrap", gap: 1 }}>
          <Chip color="primary" variant="outlined" label={`No funil: ${ativos}`} />
          <Chip color="success" variant="outlined" label={`Viraram cliente: ${fechados}`} />
          <Chip variant="outlined" label={`Não rolou: ${perdidos}`} />
          <Chip color="success" label={`Conversão: ${conversao}%`}
            title="Fechados ÷ (fechados + não rolou)" />
        </Stack>
      )}

      {editCols && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, maxWidth: 420 }}>
          <TextField size="small" label="Nova coluna" value={novaColuna} fullWidth
            onChange={(e) => setNovaColuna(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addColuna()} />
          <Button variant="contained" onClick={addColuna} disabled={!novaColuna.trim()}>Adicionar</Button>
        </Stack>
      )}

      {rows.length === 0 && !editCols ? (
        <EmptyState message="Ninguém na prospecção ainda. Anote quem você quer atender."
          action={<Button onClick={() => { setDraft(EMPTY); setOpen(true); }}>Adicionar</Button>} />
      ) : (
        <Box sx={{ display: "flex", gap: 2, overflowX: "auto", pb: 2, alignItems: "flex-start" }}>
          {stages.map((col, colIdx) => (
            <Box key={col.key}
              onDragOver={(e) => { e.preventDefault(); setOverCol(col.key); }}
              onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
              onDrop={() => onDrop(col.key)}
              sx={{
                minWidth: 290, width: 290, flexShrink: 0, borderRadius: 2, p: 0.75,
                transition: "background-color .15s ease",
                bgcolor: overCol === col.key ? "action.hover" : "transparent",
                outline: overCol === col.key ? "2px dashed" : "none",
                outlineColor: "primary.main",
              }}>
              {editCols ? (
                <Stack direction="row" alignItems="center" spacing={0.25} sx={{ px: 0.25, mb: 1 }}>
                  <IconButton size="small" disabled={colIdx === 0} onClick={() => moverColuna(colIdx, -1)}><ChevronLeftIcon sx={{ fontSize: 18 }} /></IconButton>
                  <TextField size="small" variant="standard" defaultValue={col.label} fullWidth
                    onBlur={(e) => e.target.value.trim() && e.target.value !== col.label && renomearColuna(col, e.target.value.trim())} />
                  <IconButton size="small" disabled={colIdx === stages.length - 1} onClick={() => moverColuna(colIdx, 1)}><ChevronRightIcon sx={{ fontSize: 18 }} /></IconButton>
                  {col.kind === "open" ? (
                    <IconButton size="small" color="error" onClick={() => excluirColuna(col)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                  ) : (
                    <Tooltip title="Coluna fixa (usada nos relatórios)"><LockIcon sx={{ fontSize: 15, color: "text.disabled" }} /></Tooltip>
                  )}
                </Stack>
              ) : (
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 0.5, mb: 1 }}>
                  <Typography sx={{ fontWeight: 700 }}>{col.label}</Typography>
                  <Chip size="small" label={porStatus(col.key).length} />
                </Stack>
              )}
              <Stack spacing={1.5}>
                {porStatus(col.key).map((p) => (
                  <Card key={p.id} draggable
                    onDragStart={() => { dragId.current = p.id; }}
                    onDragEnd={() => { dragId.current = null; setOverCol(null); }}
                    sx={{ cursor: "grab", "&:hover": { borderColor: "primary.main" }, transition: "border-color .15s ease", "&:active": { cursor: "grabbing" } }}>
                    <CardContent sx={{ p: 1.75, "&:last-child": { pb: 1.75 } }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                        <Stack direction="row" spacing={0.5} sx={{ minWidth: 0 }}>
                          <DragIndicatorIcon sx={{ fontSize: 18, color: "text.disabled", mt: 0.25, flexShrink: 0 }} />
                          <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 600, fontSize: 14.5 }}>{p.name}</Typography>
                            {p.company && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                                {p.company}
                              </Typography>
                            )}
                          </Box>
                        </Stack>
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

                      <Stack direction="row" spacing={0.75} sx={{ mt: 1.25, flexWrap: "wrap", gap: 0.5 }}>
                        <Button size="small" startIcon={<ChatIcon sx={{ fontSize: 15 }} />}
                          onClick={() => setContato(p)}>
                          {p.touches?.length ? `${p.touches.length + 1}º contato` : "1º contato"}
                        </Button>
                        {p.status !== "fechado" && (
                          <Button size="small" color="success" variant="outlined"
                            startIcon={<HowToRegIcon sx={{ fontSize: 16 }} />}
                            onClick={() => virarCliente(p)}>
                            Tornar cliente
                          </Button>
                        )}
                        {p.status !== "perdido" && p.status !== "fechado" && (
                          <Tooltip title="Encerrar — não virou cliente">
                            <Button size="small" color="inherit"
                              startIcon={<DoneAllIcon sx={{ fontSize: 16 }} />}
                              onClick={() => finalizar(p)}>
                              Finalizar
                            </Button>
                          </Tooltip>
                        )}
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
                {porStatus(col.key).length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 2 }}>
                    Arraste um cartão para cá
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
              {stages.map((c) => <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>)}
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
