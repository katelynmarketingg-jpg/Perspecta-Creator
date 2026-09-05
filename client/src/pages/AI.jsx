import { useEffect, useState } from "react";
import {
  Box, Button, Card, CardContent, Typography, Stack, TextField, MenuItem,
  Alert, Divider, IconButton, Tooltip, CircularProgress, Chip, LinearProgress,
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

  // Uso e limite de gasto (R$/mês)
  const [uso, setUso] = useState(null);
  const [detalhe, setDetalhe] = useState(null);
  const [limite, setLimite] = useState({ warn1: "", warn2: "", limit: "" });
  const [salvandoLimite, setSalvandoLimite] = useState(false);

  const carregarUso = () => {
    api.get("/ai/usage").then((r) => {
      setUso(r.data);
      setLimite({ warn1: r.data.warn1, warn2: r.data.warn2, limit: r.data.limit });
    }).catch(() => {});
    api.get("/ai/usage/breakdown").then((r) => setDetalhe(r.data)).catch(() => {});
  };

  useEffect(() => {
    api.get("/ai/config").then((r) => { setConfig(r.data); setProvider(r.data.provider); }).catch(() => {});
    api.get("/clients").then((r) => setClients(r.data.filter((c) => c.status === "active"))).catch(() => {});
    carregarUso();
  }, []);

  async function salvarLimite() {
    setSalvandoLimite(true);
    try { await api.put("/ai/budget", limite); await carregarUso(); }
    finally { setSalvandoLimite(false); }
  }

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

      {/* Uso e limite de gasto no mês */}
      {uso && (() => {
        const pct = uso.limit > 0 ? Math.min(100, Math.round((uso.spent / uso.limit) * 100)) : 0;
        const cor = uso.spent >= uso.limit ? "error" : uso.spent >= uso.warn2 ? "warning" : "success";
        const [y, m] = (uso.ym || "").split("-");
        const MES = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
        return (
          <Card sx={{ mb: 2.5 }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ flexWrap: "wrap" }}>
                <Typography variant="subtitle2">Uso da IA — {MES[Number(m)] || ""} {y}</Typography>
                <Typography variant="h6" color={`${cor}.main`} sx={{ fontWeight: 700 }}>
                  R$ {uso.spent.toFixed(2)} <Typography component="span" variant="caption" color="text.secondary">/ R$ {uso.limit.toFixed(2)}</Typography>
                </Typography>
              </Stack>
              <LinearProgress variant="determinate" value={pct} color={cor} sx={{ height: 8, borderRadius: 4, my: 1 }} />
              <Typography variant="caption" color="text.secondary">
                {uso.calls} gerações este mês · valor é uma <b>estimativa</b> (o provedor cobra o real).
                {uso.spent >= uso.limit && <b style={{ color: "#DC2626" }}> Limite atingido — geração pausada até virar o mês ou aumentar o limite.</b>}
              </Typography>

              {detalhe && (
                <Stack direction="row" spacing={3} sx={{ mt: 1, flexWrap: "wrap" }}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Hoje</Typography>
                    <Typography sx={{ fontWeight: 700 }}>R$ {detalhe.hoje.toFixed(2)}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Média por geração</Typography>
                    <Typography sx={{ fontWeight: 700 }}>R$ {detalhe.media_por_geracao.toFixed(3)}</Typography>
                  </Box>
                  {detalhe.por_funcionalidade?.length > 0 && (
                    <Box sx={{ minWidth: 180 }}>
                      <Typography variant="caption" color="text.secondary">Por funcionalidade (mês)</Typography>
                      {detalhe.por_funcionalidade.slice(0, 4).map((f) => (
                        <Typography key={f.k} variant="caption" sx={{ display: "block" }}>
                          {f.k || "—"}: <b>R$ {f.brl.toFixed(2)}</b> ({f.n})
                        </Typography>
                      ))}
                    </Box>
                  )}
                </Stack>
              )}

              {isAdmin && (
                <>
                  <Divider sx={{ my: 1.5 }} />
                  <Typography variant="caption" color="text.secondary">Avisos e limite do mês (R$)</Typography>
                  <Stack direction="row" spacing={1.5} sx={{ mt: 1, flexWrap: "wrap", gap: 1 }} alignItems="center">
                    <TextField size="small" type="number" label="1º aviso" value={limite.warn1}
                      onChange={(e) => setLimite((l) => ({ ...l, warn1: e.target.value }))} sx={{ width: 110 }} />
                    <TextField size="small" type="number" label="2º aviso" value={limite.warn2}
                      onChange={(e) => setLimite((l) => ({ ...l, warn2: e.target.value }))} sx={{ width: 110 }} />
                    <TextField size="small" type="number" label="Limite (bloqueia)" value={limite.limit}
                      onChange={(e) => setLimite((l) => ({ ...l, limit: e.target.value }))} sx={{ width: 140 }} />
                    <Button variant="outlined" size="small" onClick={salvarLimite} disabled={salvandoLimite}>
                      {salvandoLimite ? "Salvando…" : "Salvar limites"}
                    </Button>
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
                    Ao passar do 1º e 2º valor você recebe um aviso; ao bater o limite, a IA pausa até o mês seguinte.
                  </Typography>
                </>
              )}
            </CardContent>
          </Card>
        );
      })()}

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
