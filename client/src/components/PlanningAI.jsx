import { useEffect, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Tabs, Tab, Stack,
  TextField, Typography, Box, Alert, CircularProgress, IconButton, Tooltip,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ClientBrain from "./ClientBrain.jsx";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import api from "../api/client.js";


// IA do Planejamento: por cliente. Configura a "inteligência" (persona/prompt) e
// pede à IA um rascunho de planejamento do mês — usando essa mesma inteligência.
export default function PlanningAI({ clientId, clientName, monthLabel, open, onClose }) {
  const [tab, setTab] = useState("brief");
  const [foco, setFoco] = useState("");
  const [tipo, setTipo] = useState("plan"); // plan | ideas
  const [gerando, setGerando] = useState(false);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!open || !clientId) return;
    setErro(""); setTexto("");
  }, [open, clientId]);

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
          // O MESMO editor da aba IA e da ficha do cliente — um cadastro só.
          <ClientBrain clientId={clientId} clientName={clientName} />
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
