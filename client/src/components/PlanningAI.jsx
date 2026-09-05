import { useEffect, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Tabs, Tab, Stack,
  TextField, Typography, Box, Alert, CircularProgress, IconButton, Tooltip,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import api from "../api/client.js";

// Campos da "inteligência" do cliente — a mesma persona usada nas legendas.
const CAMPOS = [
  { key: "tone", label: "Tom de voz", ph: "próximo, bem-humorado, sem gírias" },
  { key: "audience", label: "Público", ph: "mulheres 25-45, classe B, sul do país" },
  { key: "pillars", label: "Pilares de conteúdo", ph: "bastidores, dicas, prova social, promoções" },
  { key: "avoid", label: "O que evitar", ph: "falar de preço, tom formal" },
  { key: "extra", label: "Observações (prompt livre)", ph: "tudo que a IA deve saber sobre este cliente" },
];

// IA do Planejamento: por cliente. Configura a "inteligência" (persona/prompt) e
// pede à IA um rascunho de planejamento do mês — usando essa mesma inteligência.
export default function PlanningAI({ clientId, clientName, monthLabel, open, onClose }) {
  const [tab, setTab] = useState("brief");
  const [persona, setPersona] = useState({});
  const [salvando, setSalvando] = useState(false);
  const [salvou, setSalvou] = useState(false);
  const [foco, setFoco] = useState("");
  const [tipo, setTipo] = useState("plan"); // plan | ideas
  const [gerando, setGerando] = useState(false);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!open || !clientId) return;
    setErro(""); setTexto("");
    api.get(`/ai/persona/${clientId}`).then((r) => setPersona(r.data || {})).catch(() => setPersona({}));
  }, [open, clientId]);

  async function salvarBrief() {
    setSalvando(true);
    try { await api.put(`/ai/persona/${clientId}`, persona); setSalvou(true); setTimeout(() => setSalvou(false), 2500); }
    finally { setSalvando(false); }
  }

  async function gerar() {
    setErro(""); setTexto(""); setGerando(true);
    try {
      const { data } = await api.post("/ai/generate", { client_id: clientId, kind: tipo, topic: foco, count: 6 });
      setTexto(data.text || "");
    } catch (e) {
      const d = e.response?.data;
      setErro(d?.needs_key ? "Falta ligar a IA — cole a chave de API na aba IA."
        : d?.budget_blocked ? d.error
        : d?.error || "Não foi possível gerar agora.");
    } finally { setGerando(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 0 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <AutoAwesomeIcon color="primary" />
          <span>IA do planejamento — {clientName || "cliente"}</span>
        </Stack>
      </DialogTitle>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 3 }}>
        <Tab value="brief" label="Inteligência do cliente" />
        <Tab value="plan" label="Gerar planejamento" />
      </Tabs>
      <DialogContent dividers>
        {tab === "brief" ? (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              O que a IA deve saber sobre <b>{clientName}</b>. Vale para as legendas e para o planejamento deste cliente.
            </Typography>
            {salvou && <Alert severity="success">Salvo! A IA já usa isso.</Alert>}
            {CAMPOS.map((c) => (
              <TextField key={c.key} label={c.label} placeholder={c.ph} value={persona[c.key] || ""}
                onChange={(e) => setPersona((p) => ({ ...p, [c.key]: e.target.value }))}
                fullWidth multiline={c.key === "extra"} minRows={c.key === "extra" ? 3 : 1} size="small" />
            ))}
            <Button variant="contained" onClick={salvarBrief} disabled={salvando} sx={{ alignSelf: "flex-start" }}>
              {salvando ? "Salvando…" : "Salvar inteligência"}
            </Button>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              A IA monta um rascunho de {tipo === "plan" ? "planejamento" : "ideias"} para <b>{monthLabel}</b>, usando a inteligência do cliente.
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" variant={tipo === "plan" ? "contained" : "outlined"} onClick={() => setTipo("plan")}>Planejamento do mês</Button>
              <Button size="small" variant={tipo === "ideas" ? "contained" : "outlined"} onClick={() => setTipo("ideas")}>Ideias de post</Button>
            </Stack>
            <TextField label="Foco (opcional)" placeholder="Ex: lançamento, data comemorativa, promoção…"
              value={foco} onChange={(e) => setFoco(e.target.value)} fullWidth size="small" />
            <Button variant="contained" startIcon={<AutoAwesomeIcon />} onClick={gerar} disabled={gerando} sx={{ alignSelf: "flex-start" }}>
              {gerando ? "Gerando…" : "Gerar com IA"}
            </Button>
            {gerando && <Box sx={{ display: "grid", placeItems: "center", py: 2 }}><CircularProgress size={26} /></Box>}
            {erro && <Alert severity="warning">{erro}</Alert>}
            {texto && (
              <Box sx={{ position: "relative", p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}>
                <Tooltip title={copiado ? "Copiado!" : "Copiar"}>
                  <IconButton size="small" sx={{ position: "absolute", top: 4, right: 4 }}
                    onClick={() => { navigator.clipboard.writeText(texto).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500); }); }}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", pr: 4 }}>{texto}</Typography>
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}
