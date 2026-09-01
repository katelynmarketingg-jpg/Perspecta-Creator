import { useEffect, useState } from "react";
import {
  Card, CardContent, Typography, Stack, TextField, Button, IconButton, Chip,
  List, ListItem, ListItemText, FormControlLabel, Switch, Box, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, MenuItem,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import api from "../api/client.js";
import { PageHeader } from "../components/ui.jsx";
import ReceiptSettings from "../components/ReceiptSettings.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { currency } from "../utils.js";

// Lê um arquivo de imagem como data URI (para guardar a marca no banco).
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function Settings() {
  const { user, isAdmin } = useAuth();
  const [stages, setStages] = useState([]);
  const [branding, setBranding] = useState({ logo: null, favicon: null });
  const [brandMsg, setBrandMsg] = useState(null);
  const [brandSaving, setBrandSaving] = useState(false);
  const [approvalMode, setApprovalMode] = useState("notify");
  const [approvalMsg, setApprovalMsg] = useState(null);
  // Tipos de tarefa/serviço (post, reel, planejamento…) e o responsável de cada.
  const [team, setTeam] = useState([]);
  const [types, setTypes] = useState([]);
  const [typeMsg, setTypeMsg] = useState(null);
  const [novoTipo, setNovoTipo] = useState("");
  const [name, setName] = useState("");
  const [isDone, setIsDone] = useState(false);
  const [pwd, setPwd] = useState({ atual: "", nova: "" });
  const [pwdMsg, setPwdMsg] = useState(null);
  // Central de acessos dos clientes ao portal (nome de acesso + senha).
  const [clientLogins, setClientLogins] = useState([]);
  const [loginDraft, setLoginDraft] = useState(null); // { id, name, portal_username, portal_password }
  const [loginMsg, setLoginMsg] = useState(null);

  async function trocarSenha() {
    try {
      await api.put("/auth/password", { current_password: pwd.atual, new_password: pwd.nova });
      setPwd({ atual: "", nova: "" });
      setPwdMsg({ tipo: "success", texto: "Senha trocada." });
    } catch (err) {
      setPwdMsg({ tipo: "error", texto: err.response?.data?.error || "Não foi possível trocar a senha." });
    }
    setTimeout(() => setPwdMsg(null), 5000);
  }

  const load = () => api.get("/tasks/stages").then((r) => setStages(r.data));
  const loadBranding = () => api.get("/branding").then((r) => {
    setBranding({ logo: r.data?.logo || null, favicon: r.data?.favicon || null });
    setApprovalMode(r.data?.approval_mode || "notify");
  });

  async function saveApprovalMode(mode) {
    setApprovalMode(mode);
    try {
      await api.put("/branding/approval-mode", { approval_mode: mode });
      setApprovalMsg({ tipo: "success", texto: "Preferência de aprovação salva." });
    } catch {
      setApprovalMsg({ tipo: "error", texto: "Não foi possível salvar." });
    }
    setTimeout(() => setApprovalMsg(null), 4000);
  }
  const loadTeam = () => api.get("/users/team").then((r) => setTeam(r.data)).catch(() => {});
  const loadTypes = () => api.get("/task-types").then((r) => setTypes(r.data)).catch(() => {});
  const loadClientLogins = () => api.get("/clients").then((r) => setClientLogins(r.data)).catch(() => {});
  useEffect(() => {
    load(); loadBranding(); loadTeam(); loadTypes();
    if (isAdmin) loadClientLogins();
  }, [isAdmin]);

  // Salva o acesso (nome + senha) de um cliente sem sair das Configurações.
  async function salvarAcesso() {
    if (!loginDraft) return;
    try {
      await api.put(`/clients/${loginDraft.id}`, {
        portal_username: loginDraft.portal_username || null,
        ...(loginDraft.portal_password ? { portal_password: loginDraft.portal_password } : {}),
      });
      setLoginDraft(null);
      setLoginMsg({ tipo: "success", texto: "Acesso salvo." });
      loadClientLogins();
    } catch (err) {
      setLoginMsg({ tipo: "error", texto: err.response?.data?.error || "Não foi possível salvar." });
    }
    setTimeout(() => setLoginMsg(null), 5000);
  }

  // Muda o responsável de um tipo — salva na hora (sem botão, sem dúvida).
  async function setResponsavel(tipo, userId) {
    setTypes((ts) => ts.map((t) => (t.id === tipo.id ? { ...t, responsible_user_id: userId || null } : t)));
    try {
      await api.put(`/task-types/${tipo.id}`, { responsible_user_id: userId || null });
      setTypeMsg({ tipo: "success", texto: "Responsável salvo." });
    } catch {
      setTypeMsg({ tipo: "error", texto: "Não foi possível salvar." });
      loadTypes();
    }
    setTimeout(() => setTypeMsg(null), 2500);
  }

  async function addTipo() {
    const label = novoTipo.trim();
    if (!label) return;
    await api.post("/task-types", { label });
    setNovoTipo("");
    loadTypes();
  }

  async function removeTipo(id) {
    if (!confirm("Remover este tipo? As tarefas já criadas continuam.")) return;
    await api.delete(`/task-types/${id}`);
    loadTypes();
  }

  // Escolhe um arquivo de logo/favicon e já mostra a prévia (salva só ao clicar).
  async function pickBrand(campo, file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setBrandMsg({ tipo: "error", texto: "Selecione um arquivo de imagem (PNG, JPG, SVG...)." });
      return;
    }
    if (file.size > 500 * 1024) {
      setBrandMsg({ tipo: "error", texto: "Imagem grande demais. Use uma até 500 KB." });
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    setBranding((b) => ({ ...b, [campo]: dataUrl }));
    setBrandMsg(null);
  }

  async function saveBranding() {
    setBrandSaving(true);
    try {
      await api.put("/branding", branding);
      // Atualiza o favicon da aba na hora.
      if (branding.favicon) {
        let link = document.querySelector("link[rel~='icon']");
        if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
        link.href = branding.favicon;
      }
      setBrandMsg({ tipo: "success", texto: "Marca salva! A logo aparece na barra do topo (recarregue se precisar)." });
    } catch (err) {
      setBrandMsg({ tipo: "error", texto: err.response?.data?.error || "Não foi possível salvar a marca." });
    }
    setBrandSaving(false);
    setTimeout(() => setBrandMsg(null), 6000);
  }


  async function addStage() {
    if (!name.trim()) return;
    await api.post("/tasks/stages", { name: name.trim(), is_done: isDone ? 1 : 0 });
    setName(""); setIsDone(false);
    load();
  }
  async function removeStage(id) {
    if (!confirm("Remover etapa? As tarefas nela ficarão sem etapa.")) return;
    await api.delete(`/tasks/stages/${id}`);
    load();
  }

  return (
    <>
      <PageHeader title="Configurações" subtitle="Preferências do sistema" />

      <Stack spacing={2.5} sx={{ maxWidth: 620 }}>
        {isAdmin && (
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 0.5 }}>Marca (logo e favicon)</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                A logo aparece na barra do topo. O favicon é o ícone da aba do navegador.
                Use PNG ou SVG com fundo transparente (até 500 KB).
              </Typography>
              {brandMsg && <Alert severity={brandMsg.tipo} sx={{ mb: 2 }}>{brandMsg.texto}</Alert>}

              <Stack spacing={2.5}>
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Logo da barra superior</Typography>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                    <Box sx={{
                      height: 48, minWidth: 120, px: 2, borderRadius: 2, border: "1px dashed",
                      borderColor: "divider", bgcolor: "action.hover", display: "grid", placeItems: "center",
                    }}>
                      {branding.logo
                        ? <Box component="img" src={branding.logo} alt="Logo" sx={{ height: 36, maxWidth: 200, objectFit: "contain" }} />
                        : <Typography variant="caption" color="text.secondary">sem logo</Typography>}
                    </Box>
                    <Button variant="outlined" component="label" size="small">
                      Escolher logo
                      <input hidden type="file" accept="image/*"
                        onChange={(e) => pickBrand("logo", e.target.files?.[0])} />
                    </Button>
                    {branding.logo && (
                      <Button size="small" color="error" onClick={() => setBranding((b) => ({ ...b, logo: null }))}>
                        Remover
                      </Button>
                    )}
                  </Box>
                </Box>

                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Favicon (ícone da aba)</Typography>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                    <Box sx={{
                      width: 48, height: 48, borderRadius: 2, border: "1px dashed",
                      borderColor: "divider", bgcolor: "action.hover", display: "grid", placeItems: "center",
                    }}>
                      {branding.favicon
                        ? <Box component="img" src={branding.favicon} alt="Favicon" sx={{ width: 32, height: 32, objectFit: "contain" }} />
                        : <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>vazio</Typography>}
                    </Box>
                    <Button variant="outlined" component="label" size="small">
                      Escolher favicon
                      <input hidden type="file" accept="image/*"
                        onChange={(e) => pickBrand("favicon", e.target.files?.[0])} />
                    </Button>
                    {branding.favicon && (
                      <Button size="small" color="error" onClick={() => setBranding((b) => ({ ...b, favicon: null }))}>
                        Remover
                      </Button>
                    )}
                  </Box>
                </Box>

                <Box>
                  <Button variant="contained" onClick={saveBranding} disabled={brandSaving}>
                    {brandSaving ? "Salvando..." : "Salvar marca"}
                  </Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        )}

        {isAdmin && <ReceiptSettings />}

        {isAdmin && (
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 0.5 }}>Aprovação de conteúdo</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                O que acontece quando o cliente <strong>aprova</strong> um conteúdo na Área do Cliente.
              </Typography>
              {approvalMsg && <Alert severity={approvalMsg.tipo} sx={{ mb: 2 }}>{approvalMsg.texto}</Alert>}
              <TextField select fullWidth label="Ao aprovar" value={approvalMode}
                onChange={(e) => saveApprovalMode(e.target.value)}>
                <MenuItem value="notify">Avisar a equipe (a gente clica em "Programar")</MenuItem>
                <MenuItem value="auto">Programar direto (vai para "Programados")</MenuItem>
              </TextField>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
                📡 A publicação automática no Instagram depende do app <strong>Meta developer</strong>, que
                ainda não está ligado. Enquanto isso, "Programar" organiza e marca como programado aqui —
                a postagem no Instagram continua sendo feita manualmente por vocês.
              </Typography>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 0.5 }}>Etapas do Kanban</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Personalize as colunas do quadro de tarefas. Marque a etapa de conclusão (tarefa finalizada).
            </Typography>
            <List dense>
              {stages.map((s) => (
                <ListItem key={s.id} disableGutters
                  secondaryAction={<IconButton size="small" color="error" onClick={() => removeStage(s.id)}><DeleteIcon fontSize="small" /></IconButton>}>
                  <ListItemText primary={s.name} />
                  {s.is_done ? <Chip size="small" color="success" label="Conclusão" sx={{ mr: 5 }} /> : null}
                </ListItem>
              ))}
            </List>
            <Divider sx={{ my: 1.5 }} />
            <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
              <TextField size="small" label="Nova etapa" value={name} onChange={(e) => setName(e.target.value)} />
              <FormControlLabel control={<Switch checked={isDone} onChange={(e) => setIsDone(e.target.checked)} />} label="É conclusão" />
              <Button variant="contained" startIcon={<AddIcon />} onClick={addStage}>Adicionar</Button>
            </Box>
          </CardContent>
        </Card>

        {isAdmin && (
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 0.5 }}>Acessos dos clientes (portal)</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                O mesmo acesso do cadastro do cliente, reunido aqui. Defina ou
                troque o nome de acesso e a senha com que o cliente entra em /portal.
              </Typography>
              {loginMsg && <Alert severity={loginMsg.tipo} sx={{ mb: 2 }}>{loginMsg.texto}</Alert>}
              <List dense>
                {clientLogins.map((c) => (
                  <ListItem key={c.id} disableGutters
                    secondaryAction={
                      <IconButton size="small" onClick={() =>
                        setLoginDraft({ id: c.id, name: c.name, portal_username: c.portal_username || "", portal_password: "" })}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    }>
                    <ListItemText
                      primary={c.name}
                      secondary={c.portal_username ? `Nome de acesso: ${c.portal_username}` : "Sem nome de acesso"} />
                    <Chip size="small" sx={{ mr: 6 }}
                      color={c.portal_enabled ? "success" : "default"}
                      label={c.portal_enabled ? "Acesso ativo" : "Sem acesso"} />
                  </ListItem>
                ))}
                {clientLogins.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                    Nenhum cliente cadastrado ainda.
                  </Typography>
                )}
              </List>
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 0.5 }}>Tipos de tarefa e quem faz cada um</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Cada tipo (post, reel, foto, planejamento, reunião…) tem um responsável.
                Ao "Lançar mês" de um projeto, cada peça vai automaticamente para essa pessoa.
                Salva sozinho ao escolher. Você pode <strong>criar tipos próprios</strong> abaixo.
              </Typography>
              {typeMsg && <Alert severity={typeMsg.tipo} sx={{ mb: 2 }}>{typeMsg.texto}</Alert>}

              <Stack spacing={1}>
                {types.map((t) => (
                  <Stack key={t.id} direction="row" spacing={1} alignItems="center">
                    <Typography sx={{ flex: 1, fontWeight: 600 }}>
                      {t.emoji} {t.label}
                    </Typography>
                    <TextField
                      select size="small" label="Responsável" sx={{ minWidth: 180 }}
                      value={t.responsible_user_id || ""}
                      onChange={(e) => setResponsavel(t, e.target.value)}
                    >
                      <MenuItem value="">— ninguém —</MenuItem>
                      {team.map((u) => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
                    </TextField>
                    <IconButton size="small" color="error" onClick={() => removeTipo(t.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
                {types.length === 0 && (
                  <Typography variant="body2" color="text.secondary">Carregando tipos…</Typography>
                )}
              </Stack>

              <Divider sx={{ my: 2 }} />
              <Stack direction="row" spacing={1.5} alignItems="center">
                <TextField size="small" label="Novo tipo" value={novoTipo} sx={{ flex: 1 }}
                  placeholder="Ex: Planejamento, Roteiro, Aprovação..."
                  onChange={(e) => setNovoTipo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTipo()} />
                <Button variant="contained" startIcon={<AddIcon />} onClick={addTipo} disabled={!novoTipo.trim()}>
                  Adicionar tipo
                </Button>
              </Stack>
              {team.length === 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
                  Dica: cadastre as pessoas na aba Usuários para poder escolher os responsáveis.
                </Typography>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>Conta</Typography>
            <Typography variant="body2"><strong>Nome:</strong> {user?.name}</Typography>
            <Typography variant="body2"><strong>E-mail:</strong> {user?.email}</Typography>
            <Typography variant="body2"><strong>Papel:</strong> {user?.role === "superadmin" ? "Perspecta Media" : user?.role === "admin" ? "Administrador" : "Colaborador"}</Typography>
            <Typography variant="body2"><strong>Escritório:</strong> {user?.org_name || "—"}</Typography>
            <Typography variant="body2"><strong>Entra como:</strong> {user?.username || "—"}</Typography>

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Trocar a minha senha</Typography>
            {pwdMsg && <Alert severity={pwdMsg.tipo} sx={{ mb: 1.5 }}>{pwdMsg.texto}</Alert>}
            <Stack spacing={1.5}>
              <TextField label="Senha atual" type="password" size="small" value={pwd.atual}
                onChange={(e) => setPwd((p) => ({ ...p, atual: e.target.value }))} />
              <TextField label="Nova senha" type="password" size="small" value={pwd.nova}
                onChange={(e) => setPwd((p) => ({ ...p, nova: e.target.value }))} />
              <Box>
                <Button variant="outlined" onClick={trocarSenha} disabled={!pwd.atual || !pwd.nova}>
                  Trocar senha
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      <Dialog open={Boolean(loginDraft)} onClose={() => setLoginDraft(null)} fullWidth maxWidth="xs">
        <DialogTitle>Acesso ao portal — {loginDraft?.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Nome de acesso" fullWidth value={loginDraft?.portal_username || ""}
              onChange={(e) => setLoginDraft((d) => ({ ...d, portal_username: e.target.value }))}
              helperText="Com o que o cliente entra em /portal." />
            <TextField label="Nova senha (vazio = manter)" type="password" fullWidth
              value={loginDraft?.portal_password || ""}
              onChange={(e) => setLoginDraft((d) => ({ ...d, portal_password: e.target.value }))} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLoginDraft(null)}>Cancelar</Button>
          <Button variant="contained" onClick={salvarAcesso}>Salvar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
