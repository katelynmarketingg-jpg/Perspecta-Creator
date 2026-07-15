import { useEffect, useState } from "react";
import {
  Card, CardContent, Typography, Stack, TextField, Button, IconButton, Chip,
  List, ListItem, ListItemText, FormControlLabel, Switch, Box, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import api from "../api/client.js";
import { PageHeader } from "../components/ui.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { currency } from "../utils.js";

const EMPTY_SERVICE = { name: "", default_price: "", contract_template: "" };

const PLACEHOLDERS =
  "{{cliente}} {{empresa}} {{segmento}} {{endereco}} {{servico}} {{valor}} {{valor_total}} {{inicio}} {{fim}} {{duracao_meses}} {{dia_pagamento}}";

export default function Settings() {
  const { user } = useAuth();
  const [stages, setStages] = useState([]);
  const [name, setName] = useState("");
  const [isDone, setIsDone] = useState(false);
  const [services, setServices] = useState([]);
  const [svc, setSvc] = useState(null); // draft do serviço em edição

  const load = () => api.get("/tasks/stages").then((r) => setStages(r.data));
  const loadServices = () => api.get("/services").then((r) => setServices(r.data));
  useEffect(() => { load(); loadServices(); }, []);

  async function saveService() {
    const payload = { ...svc, default_price: Number(svc.default_price) || 0 };
    if (svc.id) await api.put(`/services/${svc.id}`, payload);
    else await api.post("/services", payload);
    setSvc(null);
    loadServices();
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
                      <IconButton size="small" onClick={() => setSvc({ ...s, default_price: String(s.default_price), contract_template: s.contract_template || "" })}>
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

        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>Conta</Typography>
            <Typography variant="body2"><strong>Nome:</strong> {user?.name}</Typography>
            <Typography variant="body2"><strong>E-mail:</strong> {user?.email}</Typography>
            <Typography variant="body2"><strong>Papel:</strong> {user?.role === "admin" ? "Administrador" : "Colaborador"}</Typography>
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
            <TextField
              label="Modelo de contrato" multiline rows={12} fullWidth
              value={svc?.contract_template || ""}
              onChange={(e) => setSvc((s) => ({ ...s, contract_template: e.target.value }))}
              placeholder={"Deixe vazio para usar o modelo padrão.\n\nEscreva o contrato e use os campos automáticos onde quiser."}
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
