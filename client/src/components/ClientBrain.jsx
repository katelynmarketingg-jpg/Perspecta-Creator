import { useEffect, useState } from "react";
import {
  Box, Stack, TextField, Button, Typography, Alert, Chip, LinearProgress,
  Accordion, AccordionSummary, AccordionDetails, Divider,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PsychologyIcon from "@mui/icons-material/Psychology";
import api from "../api/client.js";
import { PERSONA_GRUPOS, PERSONA_CHAVES, preenchidos } from "../persona.js";

// ---------------------------------------------------------------------------
// A inteligência do cliente — o MESMO editor em todo lugar.
//
// Está na aba IA, na ficha do cliente (aba Clientes), na IA do Planejamento e
// no editor de planejamento. Salva no mesmo cadastro, então o que você escreve
// num lugar já vale nos outros: a legenda da Distribuição e o planejamento do
// mês saem com a mesma cabeça.
//
// Um dia o briefing do cliente vai preencher isto sozinho — os campos já são
// os mesmos que a IA usa, então será só gravar as respostas aqui.
// ---------------------------------------------------------------------------
export default function ClientBrain({ clientId, clientName, denso = false, aoSalvar }) {
  const [persona, setPersona] = useState({});
  const [memoria, setMemoria] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!clientId) return;
    setCarregando(true); setMsg(null);
    api.get(`/ai/persona/${clientId}`)
      .then((r) => {
        const { _memory, _fields, ...perfil } = r.data || {};
        setPersona(perfil);
        setMemoria(_memory || "");
      })
      .catch(() => { setPersona({}); setMemoria(""); })
      .finally(() => setCarregando(false));
  }, [clientId]);

  const set = (k) => (e) => setPersona((p) => ({ ...p, [k]: e.target.value }));

  async function salvar() {
    setSalvando(true); setMsg(null);
    try {
      await api.put(`/ai/persona/${clientId}`, persona);
      await api.put(`/ai/memory/${clientId}`, { memory: memoria });
      setMsg({ t: "success", m: "Inteligência salva. As próximas gerações deste cliente já usam isso." });
      aoSalvar?.(persona);
    } catch (e) {
      setMsg({ t: "error", m: e.response?.data?.error || "Não consegui salvar." });
    } finally {
      setSalvando(false);
      setTimeout(() => setMsg(null), 5000);
    }
  }

  if (!clientId) {
    return <Typography variant="body2" color="text.secondary">Escolha um cliente para editar a inteligência dele.</Typography>;
  }
  if (carregando) return <LinearProgress />;

  const n = preenchidos(persona);
  const total = PERSONA_CHAVES.length;

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
        <PsychologyIcon color="primary" fontSize="small" />
        <Typography variant="subtitle2">
          Inteligência da IA{clientName ? ` — ${clientName}` : ""}
        </Typography>
        <Chip size="small" variant="outlined" color={n >= 6 ? "success" : "default"}
          label={`${n} de ${total} campos`} />
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        É o mesmo cadastro em todo lugar: o que você escrever aqui vale nas <b>legendas</b> da
        Distribuição, nas <b>ideias</b> e no <b>planejamento</b> deste cliente. Preencher tudo
        não deixa a geração mais cara — cada tipo de geração leva só os campos que fazem
        diferença nela.
      </Typography>

      {msg && <Alert severity={msg.t} sx={{ mb: 2 }}>{msg.m}</Alert>}

      <Stack spacing={denso ? 1 : 1.5}>
        {PERSONA_GRUPOS.map((g, i) => {
          const feitos = g.campos.filter((c) => String(persona[c.key] || "").trim()).length;
          return (
            <Accordion key={g.titulo} defaultExpanded={i === 0} disableGutters
              sx={{ "&:before": { display: "none" }, border: 1, borderColor: "divider", borderRadius: 1 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{g.titulo}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {feitos}/{g.campos.length} · {g.ajuda}
                  </Typography>
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  {g.campos.map((c) => (
                    <TextField key={c.key} size="small" fullWidth label={c.label} placeholder={c.ph}
                      multiline={c.multi} minRows={c.multi ? 3 : 1}
                      value={persona[c.key] || ""} onChange={set(c.key)}
                      helperText={`usado em: ${c.usadoEm}`} />
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
          );
        })}

        <Accordion disableGutters sx={{ "&:before": { display: "none" }, border: 1, borderColor: "divider", borderRadius: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>Memória</Typography>
              <Typography variant="caption" color="text.secondary">o que já foi combinado com este cliente</Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            <TextField fullWidth size="small" multiline minRows={3} value={memoria}
              onChange={(e) => setMemoria(e.target.value)}
              placeholder="Ex.: prefere legendas curtas; poucos emojis; nada de clichê; CTA discreto."
              helperText="Anote as preferências que vão aparecendo nas conversas. Isso substitui reenviar o histórico para a IA — e entra só nas gerações de texto." />
          </AccordionDetails>
        </Accordion>
      </Stack>

      <Divider sx={{ my: 2 }} />
      <Button variant="contained" onClick={salvar} disabled={salvando}>
        {salvando ? "Salvando…" : "Salvar inteligência"}
      </Button>
    </Box>
  );
}
