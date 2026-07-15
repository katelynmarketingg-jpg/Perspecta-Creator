import { useEffect, useState } from "react";
import {
  Button, Card, Table, TableBody, TableCell, TableHead, TableRow, IconButton, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, MenuItem,
  FormControlLabel, Switch, Typography, Divider, Alert,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import SecurityIcon from "@mui/icons-material/Security";
import api from "../api/client.js";
import { PageHeader } from "../components/ui.jsx";
import { useAuth } from "../auth/AuthContext.jsx";

const MODULES = [
  ["clients", "Clientes"], ["projects", "Projetos"], ["tasks", "Tarefas"],
  ["financial", "Financeiro"], ["contracts", "Contratos"], ["goals", "Metas"],
  ["agenda", "Agenda"], ["events", "Eventos"], ["reports", "Relatórios"],
];
const EMPTY = { name: "", email: "", password: "", role: "member", active: true };

export default function Users() {
  const { isAdmin } = useAuth();
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
              <TableCell>Nome</TableCell><TableCell>E-mail</TableCell>
              <TableCell>Papel</TableCell><TableCell>Status</TableCell>
              <TableCell align="right">Ações</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((u) => (
              <TableRow key={u.id} hover>
                <TableCell>{u.name}</TableCell>
                <TableCell>{u.email}</TableCell>
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
            <TextField label="Nome *" value={draft.name} onChange={set("name")} fullWidth />
            <TextField label="E-mail *" value={draft.email} onChange={set("email")} fullWidth />
            <TextField label={draft.id ? "Nova senha (deixe vazio p/ manter)" : "Senha *"} type="password" value={draft.password} onChange={set("password")} fullWidth />
            <TextField select label="Papel" value={draft.role} onChange={set("role")} fullWidth>
              <MenuItem value="member">Colaborador</MenuItem>
              <MenuItem value="admin">Administrador</MenuItem>
            </TextField>
            <FormControlLabel control={<Switch checked={!!draft.active} onChange={set("active")} />} label="Ativo" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={save} disabled={!draft.name || !draft.email || (!draft.id && !draft.password)}>Salvar</Button>
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
