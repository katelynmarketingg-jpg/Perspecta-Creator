import { useEffect, useState } from "react";
import {
  Button, Card, Table, TableBody, TableCell, TableHead, TableRow, IconButton, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, MenuItem,
  FormControlLabel, Switch, Typography, Divider, Alert, Box,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import SecurityIcon from "@mui/icons-material/Security";
import api from "../api/client.js";
import { PageHeader } from "../components/ui.jsx";
import { useAuth } from "../auth/AuthContext.jsx";

// As chaves têm que bater com as usadas em moduleAllowed() no servidor —
// senão a permissão marcada aqui não bloqueia nada de verdade.
const MODULES = [
  ["clientes", "Clientes"], ["central", "Central"], ["projetos", "Projetos"],
  ["tarefas", "Tarefas"], ["financeiro", "Financeiro"], ["contratos", "Contratos"],
  ["metas", "Metas"], ["calendario", "Calendário"], ["arquivos", "Arquivos"],
  ["agenda", "Agenda"], ["relatorios", "Relatórios"],
];
const EMPTY = { name: "", username: "", email: "", password: "", role: "member", active: true, job_title: "", duties: [], can_approve: false };

// Tipos de conteúdo que uma pessoa pode ser responsável por produzir.
const DUTIES = [
  { key: "post", label: "🖼️ Posts" },
  { key: "reel", label: "🎬 Reels" },
  { key: "foto", label: "📸 Fotos" },
  { key: "stories", label: "⚡ Stories" },
  { key: "trafego", label: "📊 Tráfego" },
  { key: "atendimento", label: "💬 Atendimento" },
];

export default function Users() {
  const { isAdmin, user, viewingOrg } = useAuth();
  const orgName = viewingOrg?.name || user?.org_name || "seu escritório";
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [permOpen, setPermOpen] = useState(false);
  const [permUser, setPermUser] = useState(null);
  const [perms, setPerms] = useState({});
  const [msg, setMsg] = useState("");

  const load = () => api.get("/users").then((r) => setRows(r.data));
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  if (!isAdmin) return <PageHeader title="Usuários" subtitle="Acesso restrito a administradores." />;

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: k === "active" ? e.target.checked : e.target.value }));

  async function save() {
    if (draft.id) await api.put(`/users/${draft.id}`, draft);
    else await api.post("/users", draft);
    setOpen(false);
    load();
  }
  async function remove(id) {
    if (!confirm("Remover usuário?")) return;
    await api.delete(`/users/${id}`);
    load();
  }
  async function openPerms(u) {
    setPermUser(u);
    setMsg("");
    const { data } = await api.get(`/users/${u.id}/permissions`);
    setPerms(data || {});
    setPermOpen(true);
  }
  async function savePerms() {
    await api.put(`/users/${permUser.id}/permissions`, perms);
    setMsg("Permissões salvas com sucesso!");
  }

  return (
    <>
      <PageHeader
        title="Usuários"
        subtitle="Equipe e permissões de acesso"
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => { setDraft(EMPTY); setOpen(true); }}>Novo usuário</Button>}
      />

      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Nome</TableCell><TableCell>Entra como</TableCell>
              <TableCell>Função</TableCell><TableCell>Responsável por</TableCell>
              <TableCell>Papel</TableCell><TableCell>Status</TableCell>
              <TableCell align="right">Ações</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((u) => (
              <TableRow key={u.id} hover>
                <TableCell>{u.name}</TableCell>
                <TableCell sx={{ fontFamily: "monospace" }}>{u.username || "—"}</TableCell>
                <TableCell>{u.job_title || "—"}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
                    {(u.duties || []).map((d) => {
                      const info = DUTIES.find((x) => x.key === d);
                      return <Chip key={d} size="small" variant="outlined" label={info?.label || d} />;
                    })}
                    {u.can_approve ? <Chip size="small" color="primary" label="✓ aprova" /> : null}
                    {(!u.duties || u.duties.length === 0) && !u.can_approve ? "—" : null}
                  </Stack>
                </TableCell>
                <TableCell><Chip size="small" label={u.role === "admin" ? "Administrador" : "Colaborador"} color={u.role === "admin" ? "primary" : "default"} /></TableCell>
                <TableCell><Chip size="small" label={u.active ? "Ativo" : "Inativo"} color={u.active ? "success" : "default"} /></TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => openPerms(u)} title="Permissões"><SecurityIcon fontSize="small" /></IconButton>
                  <IconButton size="small" onClick={() => { setDraft({ ...u, password: "" }); setOpen(true); }}><EditIcon fontSize="small" /></IconButton>
                  <IconButton size="small" color="error" onClick={() => remove(u.id)}><DeleteIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Dialog usuário */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{draft.id ? "Editar usuário" : "Novo usuário"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Nome *" value={draft.name} onChange={set("name")} fullWidth
              placeholder="Ex: Bruno Ferreira" helperText="Como aparece nas tarefas e na agenda." />
            <TextField label="Nome de acesso *" value={draft.username || ""} onChange={set("username")} fullWidth
              placeholder="Ex: bruno"
              helperText={`É o que a pessoa digita no login, junto com o escritório "${orgName}".`} />
            <TextField label={draft.id ? "Nova senha (deixe vazio p/ manter)" : "Senha *"} type="password" value={draft.password} onChange={set("password")} fullWidth />
            <TextField select label="Papel" value={draft.role} onChange={set("role")} fullWidth
              helperText="Administrador vê tudo e gerencia a equipe. Colaborador vê o que você liberar em Permissões.">
              <MenuItem value="member">Colaborador</MenuItem>
              <MenuItem value="admin">Administrador</MenuItem>
            </TextField>

            <Divider>Função na equipe</Divider>
            <TextField label="Função (cargo)" value={draft.job_title || ""} onChange={set("job_title")} fullWidth
              placeholder="Ex: Social Media, Designer, Gestor de Tráfego" />
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Responsável por produzir — as tarefas desses tipos vão direto para esta pessoa ao lançar o mês:
              </Typography>
              <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", gap: 0.75 }}>
                {DUTIES.map((d) => {
                  const marcado = (draft.duties || []).includes(d.key);
                  return (
                    <Chip key={d.key} label={d.label} clickable
                      color={marcado ? "primary" : "default"}
                      variant={marcado ? "filled" : "outlined"}
                      onClick={() => setDraft((dr) => ({
                        ...dr,
                        duties: marcado
                          ? dr.duties.filter((x) => x !== d.key)
                          : [...(dr.duties || []), d.key],
                      }))} />
                  );
                })}
              </Stack>
            </Box>
            <FormControlLabel
              control={<Switch checked={!!draft.can_approve}
                onChange={(e) => setDraft((d) => ({ ...d, can_approve: e.target.checked }))} />}
              label="Recebe os avisos de aprovação e retorno do cliente" />

            <Divider />
            <FormControlLabel control={<Switch checked={!!draft.active} onChange={set("active")} />} label="Ativo" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={save}
            disabled={!draft.name || !draft.username || (!draft.id && !draft.password)}>Salvar</Button>
        </DialogActions>
      </Dialog>

      {/* Dialog permissões */}
      <Dialog open={permOpen} onClose={() => setPermOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Permissões — {permUser?.name}</DialogTitle>
        <DialogContent>
          {msg && <Alert severity="success" sx={{ mb: 1 }}>{msg}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Módulos que este usuário pode acessar:</Typography>
          <Divider sx={{ mb: 1 }} />
          {MODULES.map(([key, label]) => (
            <FormControlLabel key={key} sx={{ display: "flex" }}
              control={<Switch checked={!!perms[key]} onChange={(e) => setPerms((p) => ({ ...p, [key]: e.target.checked }))} />}
              label={label} />
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPermOpen(false)}>Fechar</Button>
          <Button variant="contained" onClick={savePerms}>Salvar permissões</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
