import { useEffect, useState } from "react";
import {
  Box, Button, Card, CardContent, Typography, Stack, TextField, MenuItem,
  Alert, Divider, IconButton, Tooltip, CircularProgress, Chip,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import api from "../api/client.js";
import { PageHeader } from "../components/ui.jsx";
import { useAuth } from "../auth/AuthContext.jsx";

const PERSONA_CAMPOS = [
  { key: "tone", label: "Tom de voz", ph: "Ex: próximo, bem-humorado, sem gírias" },
  { key: "audience", label: "Público", ph: "Ex: mulheres 25-45, classe B, região sul" },
  { key: "pillars", label: "Pilares de conteúdo", ph: "Ex: bastidores, dicas, prova social, promoções" },
  { key: "avoid", label: "O que evitar", ph: "Ex: falar de preço, tom formal, vermelho" },
  { key: "extra", label: "Observações", ph: "Qualquer coisa que a IA deva saber" },
];

const GERADORES = [
  { kind: "caption", label: "Legendas", desc: "Opções de legenda prontas para copiar" },
  { kind: "ideas", label: "Ideias de post", desc: "Sugestões de pauta para o mês" },
  { kind: "plan", label: "Planejamento", desc: "Rascunho do mês por semana" },
];

export default function AI() {
  const { isAdmin } = useAuth();
  const [config, setConfig] = useState(null);
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [persona, setPersona] = useState({});
  const [personaSalva, setPersonaSalva] = useState(false);
  const [kind, setKind] = useState("caption");
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(3);
  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState("");
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);

  // Config da chave (só admin edita)
  const [chave, setChave] = useState("");
  const [provider, setProvider] = useState("openai");
  const [salvandoChave, setSalvandoChave] = useState(false);

  useEffect(() => {
    api.get("/ai/config").then((r) => { setConfig(r.data); setProvider(r.data.provider); }).catch(() => {});
    api.get("/clients").then((r) => setClients(r.data.filter((c) => c.status === "active"))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!clientId) return;
    setResultado(""); setErro("");
    api.get(`/ai/persona/${clientId}`).then((r) => setPersona(r.data || {})).catch(() => setPersona({}));
  }, [clientId]);

  async function salvarChave() {
    setSalvandoChave(true);
    try {
      const { data } = await api.put("/ai/config", { provider, api_key: chave || undefined });
      setConfig(data);
      setChave("");
    } finally { setSalvandoChave(false); }
  }

  async function salvarPersona() {
    await api.put(`/ai/persona/${clientId}`, persona);
    setPersonaSalva(true);
    setTimeout(() => setPersonaSalva(false), 2500);
  }

  async function gerar() {
    setErro(""); setResultado(""); setGerando(true);
    try {
      const { data } = await api.post("/ai/generate", { client_id: clientId, kind, topic, count });
      setResultado(data.text);
    } catch (e) {
      setErro(e.response?.data?.error || "Não foi possível gerar.");
    } finally { setGerando(false); }
  }

  return (
    <>
      <PageHeader
        title="Inteligência Artificial"
        subtitle="Persona por cliente e geração de legendas, ideias e planejamento"
      />

      {/* Configuração da chave */}
      {config && !config.configured && (
        <Alert severity="info" sx={{ mb: 2.5 }}>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Falta ligar a IA</Typography>
          {isAdmin
            ? "Cole abaixo a chave de API (OpenAI ou Anthropic). Você paga por uso, direto no provedor — centavos por geração."
            : "Peça a um administrador para configurar a chave de IA."}
        </Alert>
      )}
      {isAdmin && (
        <Card sx={{ mb: 2.5 }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              Chave de IA {config?.configured && <Chip size="small" color="success" label="ligada" sx={{ ml: 1 }} />}
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
              <TextField select size="small" label="Provedor" value={provider}
                onChange={(e) => setProvider(e.target.value)} sx={{ minWidth: 150 }}>
                <MenuItem value="openai">OpenAI (ChatGPT)</MenuItem>
                <MenuItem value="anthropic">Anthropic (Claude)</MenuItem>
              </TextField>
              <TextField size="small" type="password" label={config?.configured ? "Nova chave (vazio = manter)" : "Chave de API"}
                value={chave} onChange={(e) => setChave(e.target.value)} sx={{ flex: 1 }}
                placeholder="sk-..." />
              <Button variant="contained" onClick={salvarChave} disabled={salvandoChave || (!chave && !config?.configured)}>
                Salvar
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* Escolha do cliente */}
      <TextField select fullWidth label="Cliente" value={clientId}
        onChange={(e) => setClientId(e.target.value)} sx={{ mb: 2.5 }}>
        <MenuItem value="">Escolha um cliente…</MenuItem>
        {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
      </TextField>

      {clientId && (
        <Stack spacing={2.5}>
          {/* Persona */}
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
                <Typography variant="h6">Persona do cliente</Typography>
                <Button variant="outlined" size="small" onClick={salvarPersona}>
                  {personaSalva ? "Salvo ✓" : "Salvar persona"}
                </Button>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Quanto mais completa, melhor a IA acerta o jeito do cliente.
              </Typography>
              <Stack spacing={2}>
                {PERSONA_CAMPOS.map((f) => (
                  <TextField key={f.key} label={f.label} placeholder={f.ph} fullWidth
                    multiline={f.key === "extra"} minRows={f.key === "extra" ? 2 : 1}
                    value={persona[f.key] || ""}
                    onChange={(e) => setPersona((p) => ({ ...p, [f.key]: e.target.value }))} />
                ))}
              </Stack>
            </CardContent>
          </Card>

          {/* Geração */}
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>Gerar conteúdo</Typography>
              <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap", gap: 1 }}>
                {GERADORES.map((g) => (
                  <Chip key={g.kind} label={g.label} clickable
                    color={kind === g.kind ? "primary" : "default"}
                    variant={kind === g.kind ? "filled" : "outlined"}
                    onClick={() => setKind(g.kind)} />
                ))}
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 2 }}>
                <TextField label="Tema / assunto (opcional)" value={topic}
                  onChange={(e) => setTopic(e.target.value)} fullWidth
                  placeholder="Ex: lançamento do menu de inverno" />
                {kind !== "plan" && (
                  <TextField label="Quantas" type="number" value={count}
                    onChange={(e) => setCount(e.target.value)} sx={{ width: 110 }}
                    inputProps={{ min: 1, max: 10 }} />
                )}
              </Stack>
              <Button variant="contained" startIcon={gerando ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
                onClick={gerar} disabled={gerando || !config?.configured}>
                {gerando ? "Gerando…" : "Gerar com IA"}
              </Button>
              {!config?.configured && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                  Configure a chave de IA acima para liberar a geração.
                </Typography>
              )}

              {erro && <Alert severity="error" sx={{ mt: 2 }}>{erro}</Alert>}

              {resultado && (
                <Box sx={{ mt: 2 }}>
                  <Divider sx={{ mb: 1.5 }}>
                    <Tooltip title={copiado ? "Copiado!" : "Copiar tudo"}>
                      <IconButton size="small" onClick={() => {
                        navigator.clipboard.writeText(resultado); setCopiado(true); setTimeout(() => setCopiado(false), 1500);
                      }}>
                        {copiado ? <CheckIcon fontSize="small" color="success" /> : <ContentCopyIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  </Divider>
                  <Box sx={{ p: 2, borderRadius: 2, bgcolor: "action.hover" }}>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{resultado}</Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                    Rascunho da IA — revise antes de usar.
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Stack>
      )}
    </>
  );
}
