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
import { useAuth } from "../auth/AuthContext.jsx";
import { currency, CONTENT_TYPES } from "../utils.js";

// Tipos que entram na matriz "quem faz cada tipo" (todos menos "outro").
const DUTY_TYPES = Object.entries(CONTENT_TYPES).filter(([k]) => k !== "outro");

const EMPTY_SERVICE = { name: "", default_price: "", contract_template: "", items_schema: [] };

const PLACEHOLDERS =
  "{{cliente}} {{empresa}} {{segmento}} {{endereco}} {{servico}} {{valor}} {{valor_total}} {{itens}} {{inicio}} {{fim}} {{duracao_meses}} {{dia_pagamento}}";

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
  // Matriz "quem faz cada tipo": time + mapa tipo -> [ids de usuários].
  const [team, setTeam] = useState([]);
  const [dutyMap, setDutyMap] = useState({});
  const [dutyMsg, setDutyMsg] = useState(null);
  const [dutySaving, setDutySaving] = useState(false);
  const [name, setName] = useState("");
  const [isDone, setIsDone] = useState(false);
  const [services, setServices] = useState([]);
  const [svc, setSvc] = useState(null); // draft do serviço em edição
  const [pwd, setPwd] = useState({ atual: "", nova: "" });
  const [pwdMsg, setPwdMsg] = useState(null);

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
  const loadServices = () => api.get("/services").then((r) => setServices(r.data));
  const loadBranding = () => api.get("/branding").then((r) => setBranding({ logo: r.data?.logo || null, favicon: r.data?.favicon || null }));
  const loadTeam = () => api.get("/users/team").then((r) => {
    setTeam(r.data);
    // Constrói o mapa tipo -> ids de quem tem aquele tipo nas suas funções.
    const map = {};
    DUTY_TYPES.forEach(([k]) => { map[k] = r.data.filter((u) => (u.duties || []).includes(k)).map((u) => u.id); });
    setDutyMap(map);
  }).catch(() => {});
  useEffect(() => { load(); loadServices(); loadBranding(); loadTeam(); }, []);

  // Salva a matriz: recalcula as funções de cada pessoa e grava só quem mudou.
  async function saveDuties() {
    setDutySaving(true);
    try {
      await Promise.all(team.map((u) => {
        const novas = DUTY_TYPES.filter(([k]) => (dutyMap[k] || []).includes(u.id)).map(([k]) => k);
        const antigas = (u.duties || []).filter((d) => DUTY_TYPES.some(([k]) => k === d));
        const mudou = novas.slice().sort().join(",") !== antigas.slice().sort().join(",");
        // Mantém funções que não estão na matriz (ex.: atendimento) intactas.
        const extras = (u.duties || []).filter((d) => !DUTY_TYPES.some(([k]) => k === d));
        return mudou ? api.put(`/users/${u.id}`, { duties: [...novas, ...extras] }) : null;
      }));
      setDutyMsg({ tipo: "success", texto: "Funções salvas. Ao 'Lançar mês', cada tipo vai para quem você marcou." });
      loadTeam();
    } catch (err) {
      setDutyMsg({ tipo: "error", texto: err.response?.data?.error || "Não foi possível salvar as funções." });
    }
    setDutySaving(false);
    setTimeout(() => setDutyMsg(null), 6000);
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

  async function saveService() {
    const payload = {
      ...svc,
      default_price: Number(svc.default_price) || 0,
      items_schema: (svc.items_schema || []).filter((i) => i.label?.trim()),
    };
    if (svc.id) await api.put(`/services/${svc.id}`, payload);
    else await api.post("/services", payload);
    setSvc(null);
    loadServices();
  }

  // Itens do serviço (posts, reels, verba...) que viram campos de quantidade.
  const setItem = (idx, campo, valor) =>
    setSvc((s) => ({
      ...s,
      items_schema: s.items_schema.map((it, i) => (i === idx ? { ...it, [campo]: valor } : it)),
    }));
  const addItem = () => setSvc((s) => ({ ...s, items_schema: [...(s.items_schema || []), { label: "", unit: "" }] }));
  const removeItem = (idx) =>
    setSvc((s) => ({ ...s, items_schema: s.items_schema.filter((_, i) => i !== idx) }));

  function editarServico(s) {
    setSvc({
      ...s,
      default_price: String(s.default_price),
      contract_template: s.contract_template || "",
      items_schema: s.items_schema ? JSON.parse(s.items_schema) : [],
    });
  }

  async function removeService(id) {
    if (!confirm("Excluir serviço? Ele some das opções de cadastro de clientes.")) return;
    await api.delete(`/services/${id}`);
    loadServices();
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

        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 0.5 }}>Serviços prestados</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Cadastre os serviços com valor padrão e o modelo de contrato de cada um.
              No cadastro do cliente é só selecionar — o valor preenche sozinho.
            </Typography>
            <List dense>
              {services.map((s) => (
                <ListItem key={s.id} disableGutters
                  secondaryAction={
                    <Box>
                      <IconButton size="small" onClick={() => editarServico(s)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" color="error" onClick={() => removeService(s.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  }>
                  <ListItemText primary={s.name} secondary={currency(s.default_price)} />
                  {s.contract_template ? <Chip size="small" variant="outlined" label="Contrato modelo" sx={{ mr: 8 }} /> : null}
                </ListItem>
              ))}
              {services.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                  Nenhum serviço cadastrado ainda.
                </Typography>
              )}
            </List>
            <Divider sx={{ my: 1.5 }} />
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setSvc({ ...EMPTY_SERVICE })}>
              Novo serviço
            </Button>
          </CardContent>
        </Card>

        {isAdmin && (
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 0.5 }}>Quem faz cada tipo de tarefa</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Escolha quem produz cada tipo. Ao "Lançar mês" de um projeto, cada peça vai
                automaticamente para o responsável do tipo dela.
              </Typography>
              {dutyMsg && <Alert severity={dutyMsg.tipo} sx={{ mb: 2 }}>{dutyMsg.texto}</Alert>}
              {team.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Cadastre pessoas na aba Usuários para distribuir as funções.
                </Typography>
              ) : (
                <>
                  <Stack spacing={1.5}>
                    {DUTY_TYPES.map(([k, v]) => (
                      <TextField
                        key={k} select size="small" fullWidth
                        label={`${v.emoji} ${v.label}`}
                        value={dutyMap[k] || []}
                        SelectProps={{
                          multiple: true,
                          renderValue: (sel) =>
                            sel.length === 0 ? "— ninguém —"
                              : team.filter((u) => sel.includes(u.id)).map((u) => u.name).join(", "),
                        }}
                        onChange={(e) => setDutyMap((m) => ({ ...m, [k]: e.target.value }))}
                      >
                        {team.map((u) => (
                          <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
                        ))}
                      </TextField>
                    ))}
                  </Stack>
                  <Box sx={{ mt: 2 }}>
                    <Button variant="contained" onClick={saveDuties} disabled={dutySaving}>
                      {dutySaving ? "Salvando..." : "Salvar funções"}
                    </Button>
                  </Box>
                </>
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

      {/* Criar / editar serviço */}
      <Dialog open={Boolean(svc)} onClose={() => setSvc(null)} fullWidth maxWidth="sm">
        <DialogTitle>{svc?.id ? "Editar serviço" : "Novo serviço"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Nome do serviço *" value={svc?.name || ""} fullWidth
                placeholder="Ex: Gestão de Redes Sociais, Tráfego Pago..."
                onChange={(e) => setSvc((s) => ({ ...s, name: e.target.value }))} />
              <TextField label="Valor padrão (R$/mês)" type="number" value={svc?.default_price || ""} sx={{ minWidth: 180 }}
                onChange={(e) => setSvc((s) => ({ ...s, default_price: e.target.value }))} />
            </Stack>
            <Divider>Itens que você configura por cliente</Divider>
            <Typography variant="body2" color="text.secondary">
              Ex.: em Gestão, "Posts no feed", "Reels", "Stories"; em Tráfego, "Verba mensal",
              "Campanhas". Na hora de fechar o contrato você só preenche a quantidade de cada um,
              e eles saem discriminados no contrato.
            </Typography>
            {(svc?.items_schema || []).map((it, idx) => (
              <Stack key={idx} direction="row" spacing={1} alignItems="center">
                <TextField size="small" label="Item" value={it.label} fullWidth
                  placeholder="Ex: Posts no feed"
                  onChange={(e) => setItem(idx, "label", e.target.value)} />
                <TextField size="small" label="Unidade" value={it.unit} sx={{ width: 160 }}
                  placeholder="por mês"
                  onChange={(e) => setItem(idx, "unit", e.target.value)} />
                <IconButton size="small" color="error" onClick={() => removeItem(idx)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
            <Box>
              <Button size="small" startIcon={<AddIcon />} onClick={addItem}>Adicionar item</Button>
            </Box>

            <TextField
              label="Modelo de contrato" multiline rows={10} fullWidth
              value={svc?.contract_template || ""}
              onChange={(e) => setSvc((s) => ({ ...s, contract_template: e.target.value }))}
              placeholder={"Deixe vazio para usar o modelo padrão.\n\nUse {{itens}} onde quiser a lista discriminada."}
              helperText={`Campos automáticos: ${PLACEHOLDERS}`}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSvc(null)}>Cancelar</Button>
          <Button variant="contained" onClick={saveService} disabled={!svc?.name}>Salvar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
