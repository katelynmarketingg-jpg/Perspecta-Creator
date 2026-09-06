import { useEffect, useMemo, useState } from "react";
import {
  Box, Card, CardContent, Typography, Stack, TextField, MenuItem, Button, Tabs, Tab,
  Chip, Alert, Table, TableHead, TableRow, TableCell, TableBody, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, LinearProgress, Divider, Switch,
  FormControlLabel,
} from "@mui/material";
import PsychologyIcon from "@mui/icons-material/Psychology";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DeleteIcon from "@mui/icons-material/Delete";
import api from "../api/client.js";
import { PageHeader } from "../components/ui.jsx";
import ClientBrain from "../components/ClientBrain.jsx";
import { preenchidos } from "../persona.js";

// ---------------------------------------------------------------------------
// INTELIGÊNCIA — a aba onde mora tudo o que a IA sabe de cada cliente.
//
//  · "Inteligência": o mesmo editor que aparece na ficha do cliente e no
//    planejamento. Aqui em tela cheia, com a lista de quem ainda está vazio.
//  · "Briefing": o link que o cliente responde sozinho. As respostas caem
//    direto nos campos da inteligência — é a forma rápida de encher tudo.
// ---------------------------------------------------------------------------
const ESTADO = {
  aberto: { label: "Aguardando resposta", cor: "default" },
  respondido: { label: "Respondido — aplicar", cor: "warning" },
  aplicado: { label: "Aplicado", cor: "success" },
};

export default function Intelligence() {
  const [tab, setTab] = useState("brain");
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [personas, setPersonas] = useState({});   // id -> quantos campos preenchidos
  const [briefings, setBriefings] = useState([]);
  const [msg, setMsg] = useState(null);
  const [vendo, setVendo] = useState(null);       // briefing aberto para leitura
  const [copiado, setCopiado] = useState(null);
  const [link, setLink] = useState(null);       // { url, client_name } — o link à vista
  const [sobrescrever, setSobrescrever] = useState(false);

  const carregarBriefings = () =>
    api.get("/briefings").then((r) => setBriefings(r.data)).catch(() => {});

  useEffect(() => {
    api.get("/clients").then((r) => {
      const ativos = r.data.filter((c) => c.status === "active");
      setClients(ativos);
      // Quanto de inteligência cada cliente já tem — para a lista de pendências.
      ativos.forEach((c) => {
        api.get(`/ai/persona/${c.id}`).then((p) => {
          const { _memory, _fields, ...perfil } = p.data || {};
          setPersonas((m) => ({ ...m, [c.id]: preenchidos(perfil) }));
        }).catch(() => {});
      });
    }).catch(() => {});
    carregarBriefings();
  }, []);

  const briefingPorCliente = useMemo(() => {
    const m = {};
    for (const b of briefings) if (!m[b.client_id]) m[b.client_id] = b;  // o mais recente
    return m;
  }, [briefings]);

  async function criarLink(c) {
    try {
      const { data } = await api.post("/briefings", { client_id: c.id });
      await carregarBriefings();
      setLink({ url: data.url, client_name: c.name });
    } catch (e) {
      setMsg({ t: "error", m: e.response?.data?.error || "Não consegui criar o link." });
    }
  }

  // Copiar de um jeito que nunca falha calado: a API moderna do navegador só
  // funciona em contexto seguro e com a aba em foco — quando ela recusa, o
  // pedido antigo (execCommand) resolve, e se nem esse funcionar a pessoa é
  // avisada em vez de sair colando o que estava na área de transferência antes.
  async function copiar(url) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else throw new Error("sem clipboard");
      setCopiado(url);
      setTimeout(() => setCopiado(null), 2000);
      return;
    } catch { /* tenta o jeito antigo abaixo */ }
    try {
      const campo = document.createElement("textarea");
      campo.value = url;
      campo.style.position = "fixed";
      campo.style.opacity = "0";
      document.body.appendChild(campo);
      campo.select();
      const deu = document.execCommand("copy");
      document.body.removeChild(campo);
      if (!deu) throw new Error("recusado");
      setCopiado(url);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      setMsg({ t: "warning", m: "Seu navegador não deixou copiar. Selecione o link na tela e copie à mão." });
    }
  }

  async function abrir(b) {
    const { data } = await api.get(`/briefings/${b.id}`);
    setVendo({ ...data, client_name: b.client_name });
  }

  async function aplicar() {
    try {
      const { data } = await api.post(`/briefings/${vendo.id}/aplicar`, { sobrescrever });
      setVendo(null);
      await carregarBriefings();
      setPersonas((m) => ({ ...m, [vendo.client_id]: preenchidos(data.persona) }));
      setMsg({ t: "success", m: data.campos.length
        ? `Inteligência preenchida com ${data.campos.length} campo(s) do briefing.`
        : "Nada a preencher — a inteligência já estava completa (marque 'deixar o briefing mandar' para trocar)." });
    } catch (e) {
      setMsg({ t: "error", m: e.response?.data?.error || "Não consegui aplicar." });
    }
  }

  async function apagar(b) {
    if (!window.confirm(`Apagar o briefing de ${b.client_name}? O link para de funcionar.`)) return;
    await api.delete(`/briefings/${b.id}`);
    carregarBriefings();
  }

  const semInteligencia = clients.filter((c) => (personas[c.id] ?? 0) < 4);

  return (
    <>
      <PageHeader
        title="Inteligência"
        subtitle="O que a IA sabe de cada cliente — e o briefing que o cliente responde sozinho"
      />

      {msg && <Alert severity={msg.t} sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg.m}</Alert>}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2.5 }}>
        <Tab value="brain" label="Inteligência" icon={<PsychologyIcon fontSize="small" />} iconPosition="start" />
        <Tab value="briefing" label={`Briefing${briefings.filter((b) => b.status === "respondido").length
          ? ` (${briefings.filter((b) => b.status === "respondido").length})` : ""}`} />
      </Tabs>

      {tab === "brain" ? (
        <Stack spacing={2.5}>
          {semInteligencia.length > 0 && (
            <Alert severity="info">
              <b>{semInteligencia.length} cliente(s)</b> ainda quase sem inteligência:{" "}
              {semInteligencia.slice(0, 6).map((c) => c.name).join(", ")}
              {semInteligencia.length > 6 ? "…" : ""}. Preencha aqui ou mande o briefing na aba ao lado.
            </Alert>
          )}

          <TextField select fullWidth label="Cliente" value={clientId}
            onChange={(e) => setClientId(e.target.value)}>
            <MenuItem value="">Escolha um cliente…</MenuItem>
            {clients.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
                {personas[c.id] != null && (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    · {personas[c.id]} de 18 campos
                  </Typography>
                )}
              </MenuItem>
            ))}
          </TextField>

          <Card>
            <CardContent>
              <ClientBrain clientId={clientId} clientName={clients.find((c) => c.id === clientId)?.name}
                aoSalvar={(p) => setPersonas((m) => ({ ...m, [clientId]: preenchidos(p) }))} />
            </CardContent>
          </Card>
        </Stack>
      ) : (
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Gere um link e mande para o cliente. Ele responde no celular, em oito etapas curtas,
              podendo parar no meio e voltar depois — e as respostas caem direto nos campos da
              inteligência, que é o que a IA usa para escrever.
            </Typography>

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Cliente</TableCell>
                  <TableCell>Briefing</TableCell>
                  <TableCell>Inteligência</TableCell>
                  <TableCell align="right">Ações</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {clients.map((c) => {
                  const b = briefingPorCliente[c.id];
                  const est = b ? ESTADO[b.status] : null;
                  return (
                    <TableRow key={c.id} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{c.name}</TableCell>
                      <TableCell>
                        {b ? (
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap", gap: 0.5 }}>
                            <Chip size="small" label={est.label} color={est.cor} />
                            <Typography variant="caption" color="text.secondary">
                              {b.respondidas}/{b.total} perguntas
                            </Typography>
                          </Stack>
                        ) : (
                          <Typography variant="caption" color="text.secondary">sem briefing ainda</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color={(personas[c.id] ?? 0) >= 6 ? "success.main" : "text.secondary"}>
                          {personas[c.id] ?? "—"} de 18 campos
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        {b ? (
                          <>
                            <Tooltip title="Ver e copiar o link do cliente">
                              <IconButton size="small" onClick={() => setLink({ url: b.url, client_name: c.name })}>
                                <LinkRoundedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Ver as respostas">
                              <IconButton size="small" onClick={() => abrir(b)}><VisibilityIcon fontSize="small" /></IconButton>
                            </Tooltip>
                            <Tooltip title="Apagar o briefing (o link para de funcionar)">
                              <IconButton size="small" color="error" onClick={() => apagar(b)}><DeleteIcon fontSize="small" /></IconButton>
                            </Tooltip>
                          </>
                        ) : (
                          <Button size="small" variant="outlined" onClick={() => criarLink(c)}>Gerar link</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* O LINK À VISTA. Mostrar em vez de só copiar: se a cópia falhar (o
          navegador recusa fora de contexto seguro, ou com a aba sem foco), a
          pessoa colava o que já estava na área de transferência e abria outra
          coisa — parecia que o briefing "não abria". */}
      <Dialog open={Boolean(link)} onClose={() => setLink(null)} fullWidth maxWidth="sm">
        <DialogTitle>Link do briefing — {link?.client_name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Mande este endereço para o cliente. Ele abre no celular, sem senha, e responde
            em oito etapas curtas — podendo parar no meio e voltar depois.
          </Typography>
          <TextField value={link?.url || ""} fullWidth size="small" multiline
            InputProps={{ readOnly: true, sx: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 } }}
            onFocus={(e) => e.target.select()} />
          <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: "wrap", gap: 1 }}>
            <Button variant="contained" startIcon={<ContentCopyIcon />} onClick={() => copiar(link.url)}>
              {copiado === link?.url ? "Copiado!" : "Copiar link"}
            </Button>
            <Button variant="outlined" startIcon={<OpenInNewIcon />}
              component="a" href={link?.url || "#"} target="_blank" rel="noreferrer">
              Abrir para conferir
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
            Abra você mesma uma vez antes de mandar — assim tem certeza de que o link está de pé.
            Se não abrir,{" "}
            <Box component="a" href={link ? link.url.replace("/briefing/", "/api/briefing/") : "#"}
              target="_blank" rel="noreferrer" sx={{ color: "primary.main" }}>
              clique aqui
            </Box>
            : se aparecer um texto começando com <code>{"{\"secoes\""}</code>, o servidor está bem e o
            problema é a página; se aparecer um erro, é o link.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLink(null)}>Fechar</Button>
        </DialogActions>
      </Dialog>

      {/* Respostas do cliente + aplicar na inteligência */}
      <Dialog open={Boolean(vendo)} onClose={() => setVendo(null)} fullWidth maxWidth="md">
        <DialogTitle>Briefing — {vendo?.client_name}</DialogTitle>
        <DialogContent dividers>
          {vendo && (
            <>
              <LinearProgress variant="determinate" value={vendo.progresso} sx={{ height: 8, borderRadius: 4, mb: 2 }} />
              <Typography variant="caption" color="text.secondary">
                {vendo.respondidas} de {vendo.total} perguntas respondidas
                {vendo.answered_at && ` · enviado em ${new Date(vendo.answered_at.replace(" ", "T") + "Z").toLocaleString("pt-BR")}`}
              </Typography>

              {vendo.secoes.map((s) => {
                const comResposta = s.perguntas.filter((p) => String(vendo.respostas[p.id] || "").trim());
                if (!comResposta.length) return null;
                return (
                  <Box key={s.id} sx={{ mt: 2.5 }}>
                    <Divider textAlign="left" sx={{ mb: 1.5 }}>
                      <Typography variant="caption" color="text.secondary">{s.titulo}</Typography>
                    </Divider>
                    <Stack spacing={1.5}>
                      {comResposta.map((p) => (
                        <Box key={p.id}>
                          <Typography variant="caption" color="text.secondary">{p.label}</Typography>
                          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{vendo.respostas[p.id]}</Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                );
              })}
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <FormControlLabel sx={{ mr: "auto", ml: 1 }}
            control={<Switch size="small" checked={sobrescrever} onChange={(e) => setSobrescrever(e.target.checked)} />}
            label={<Typography variant="caption">deixar o briefing substituir o que já está escrito</Typography>} />
          <Button onClick={() => setVendo(null)}>Fechar</Button>
          <Button variant="contained" onClick={aplicar}>Aplicar à inteligência</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
