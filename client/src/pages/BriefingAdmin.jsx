import { useEffect, useState } from "react";
import {
  Box, Card, CardContent, Typography, Stack, TextField, Button, Tabs, Tab, Chip,
  Alert, IconButton, Tooltip, MenuItem, Divider, Accordion, AccordionSummary,
  AccordionDetails, Switch, FormControlLabel, Table, TableHead, TableRow, TableCell,
  TableBody, Dialog, DialogTitle, DialogContent, DialogActions, LinearProgress,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import LinkRoundedIcon from "@mui/icons-material/Link";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import VisibilityIcon from "@mui/icons-material/Visibility";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import api from "../api/client.js";
import { PageHeader } from "../components/ui.jsx";
import { PERSONA_GRUPOS } from "../persona.js";

// ---------------------------------------------------------------------------
// BRIEFING — aba própria: o formulário que o cliente responde, editável.
//
//  · "Links": um por cliente — gerar, copiar, ver as respostas, aplicar.
//  · "Perguntas": o texto de boas-vindas e as perguntas, do jeito da casa.
//
// Cada pergunta pode dizer PARA ONDE vai a resposta: um campo da inteligência
// da IA (tom, público…) ou um campo do cadastro (CNPJ, razão social, dia do
// pagamento…). É o segundo que faz o contrato sair pronto.
// ---------------------------------------------------------------------------
const TIPOS = [
  { v: "texto", label: "Resposta curta" },
  { v: "longo", label: "Resposta longa" },
  { v: "escolhas", label: "Opções para escolher" },
  { v: "cnpj", label: "CNPJ (busca os dados sozinho)" },
  { v: "dia", label: "Dia do mês (1 a 31)" },
];
const CAMPOS_IA = PERSONA_GRUPOS.flatMap((g) => g.campos.map((c) => ({ key: c.key, label: c.label })));
const ESTADO = {
  aberto: { label: "Aguardando resposta", cor: "default" },
  respondido: { label: "Respondido — aplicar", cor: "warning" },
  aplicado: { label: "Aplicado", cor: "success" },
};

export default function BriefingAdmin() {
  const [tab, setTab] = useState("links");
  const [clients, setClients] = useState([]);
  const [briefings, setBriefings] = useState([]);
  const [modelo, setModelo] = useState(null);
  const [camposCliente, setCamposCliente] = useState([]);
  const [msg, setMsg] = useState(null);
  const [link, setLink] = useState(null);
  const [copiado, setCopiado] = useState(null);
  const [vendo, setVendo] = useState(null);
  const [sobrescrever, setSobrescrever] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const carregar = () => {
    api.get("/briefings").then((r) => setBriefings(r.data)).catch(() => {});
    api.get("/briefings/template").then((r) => {
      setModelo({ welcome: r.data.welcome, secoes: r.data.secoes });
      setCamposCliente(r.data.campos_cliente || []);
    }).catch(() => {});
  };

  useEffect(() => {
    api.get("/clients").then((r) => setClients(r.data.filter((c) => c.status === "active"))).catch(() => {});
    carregar();
  }, []);

  const porCliente = {};
  for (const b of briefings) if (!porCliente[b.client_id]) porCliente[b.client_id] = b;

  async function criarLink(c) {
    try {
      const { data } = await api.post("/briefings", { client_id: c.id });
      await carregar();
      setLink({ url: data.url, client_name: c.name });
    } catch (e) { setMsg({ t: "error", m: e.response?.data?.error || "Não consegui criar o link." }); }
  }

  async function copiar(url) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else throw new Error("sem clipboard");
      setCopiado(url); setTimeout(() => setCopiado(null), 2000);
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
      setVendo(null); await carregar();
      const partes = [];
      if (data.campos?.length) partes.push(`${data.campos.length} campo(s) da inteligência`);
      if (data.cadastro?.length) partes.push(`${data.cadastro.length} do cadastro (contrato e cobrança)`);
      setMsg({ t: "success", m: partes.length
        ? `Preenchido: ${partes.join(" e ")}.`
        : "Nada a preencher — já estava tudo lá (marque 'deixar o briefing mandar' para trocar)." });
    } catch (e) { setMsg({ t: "error", m: e.response?.data?.error || "Não consegui aplicar." }); }
  }

  async function salvarModelo() {
    setSalvando(true);
    try {
      const { data } = await api.put("/briefings/template", modelo);
      setModelo({ welcome: data.welcome, secoes: data.secoes });
      setMsg({ t: "success", m: "Briefing salvo. Quem abrir o link a partir de agora já vê assim." });
    } catch (e) { setMsg({ t: "error", m: e.response?.data?.error || "Não consegui salvar." }); }
    finally { setSalvando(false); setTimeout(() => setMsg(null), 6000); }
  }

  async function voltarAoPadrao() {
    if (!window.confirm("Voltar ao briefing de fábrica? Suas perguntas personalizadas serão perdidas.")) return;
    const { data } = await api.delete("/briefings/template");
    setModelo({ welcome: data.welcome, secoes: data.secoes });
    setMsg({ t: "success", m: "Voltou ao briefing de fábrica." });
  }

  // --- edição das seções/perguntas ---
  const mudaSecao = (i, campo, valor) => setModelo((m) => {
    const s = [...m.secoes]; s[i] = { ...s[i], [campo]: valor }; return { ...m, secoes: s };
  });
  const mudaPergunta = (i, j, campo, valor) => setModelo((m) => {
    const s = [...m.secoes];
    const ps = [...s[i].perguntas];
    ps[j] = { ...ps[j], [campo]: valor };
    s[i] = { ...s[i], perguntas: ps };
    return { ...m, secoes: s };
  });
  const moveSecao = (i, d) => setModelo((m) => {
    const s = [...m.secoes]; const alvo = i + d;
    if (alvo < 0 || alvo >= s.length) return m;
    [s[i], s[alvo]] = [s[alvo], s[i]];
    return { ...m, secoes: s };
  });
  const movePergunta = (i, j, d) => setModelo((m) => {
    const s = [...m.secoes]; const ps = [...s[i].perguntas]; const alvo = j + d;
    if (alvo < 0 || alvo >= ps.length) return m;
    [ps[j], ps[alvo]] = [ps[alvo], ps[j]];
    s[i] = { ...s[i], perguntas: ps };
    return { ...m, secoes: s };
  });
  const apagaPergunta = (i, j) => setModelo((m) => {
    const s = [...m.secoes];
    s[i] = { ...s[i], perguntas: s[i].perguntas.filter((_, k) => k !== j) };
    return { ...m, secoes: s };
  });
  const novaPergunta = (i) => setModelo((m) => {
    const s = [...m.secoes];
    s[i] = { ...s[i], perguntas: [...s[i].perguntas, { id: `nova_${Date.now()}`, tipo: "texto", label: "" }] };
    return { ...m, secoes: s };
  });
  const novaSecao = () => setModelo((m) => ({
    ...m,
    secoes: [...m.secoes, { id: `etapa_${Date.now()}`, titulo: "Nova etapa", intro: "",
      perguntas: [{ id: `nova_${Date.now()}`, tipo: "texto", label: "" }] }],
  }));
  const apagaSecao = (i) => setModelo((m) => ({ ...m, secoes: m.secoes.filter((_, k) => k !== i) }));

  const respondidos = briefings.filter((b) => b.status === "respondido").length;

  return (
    <>
      <PageHeader title="Briefing"
        subtitle="O formulário que o cliente responde — e que preenche a inteligência da IA, o cadastro e o contrato" />

      {msg && <Alert severity={msg.t} sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg.m}</Alert>}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2.5 }}>
        <Tab value="links" label={`Links${respondidos ? ` (${respondidos})` : ""}`} />
        <Tab value="perguntas" label="Perguntas e texto" />
      </Tabs>

      {tab === "links" ? (
        <Card><CardContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Gere um link e mande para o cliente. Ao aplicar as respostas, o sistema preenche de uma vez
            a <b>inteligência da IA</b> e os <b>dados do contrato</b> (razão social, CNPJ, endereço,
            quem assina e o dia do pagamento).
          </Typography>
          <Table size="small">
            <TableHead><TableRow>
              <TableCell>Cliente</TableCell><TableCell>Briefing</TableCell><TableCell align="right">Ações</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {clients.map((c) => {
                const b = porCliente[c.id];
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
                      ) : <Typography variant="caption" color="text.secondary">sem briefing ainda</Typography>}
                    </TableCell>
                    <TableCell align="right">
                      {b ? (
                        <>
                          <Tooltip title="Ver e copiar o link">
                            <IconButton size="small" onClick={() => setLink({ url: b.url, client_name: c.name })}>
                              <LinkRoundedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Ver as respostas">
                            <IconButton size="small" onClick={() => abrir(b)}><VisibilityIcon fontSize="small" /></IconButton>
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
        </CardContent></Card>
      ) : !modelo ? <LinearProgress /> : (
        <Stack spacing={2.5}>
          <Card><CardContent>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Texto de boas-vindas</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
              É a primeira tela, antes de qualquer pergunta. Use <code>{"{agencia}"}</code> para o nome do
              seu escritório e <code>{"{cliente}"}</code> para o nome de quem vai responder.
            </Typography>
            <Stack spacing={2}>
              <TextField label="Título" fullWidth size="small" value={modelo.welcome.titulo}
                onChange={(e) => setModelo((m) => ({ ...m, welcome: { ...m.welcome, titulo: e.target.value } }))} />
              {modelo.welcome.paragrafos.map((t, i) => (
                <TextField key={i} label={`Parágrafo ${i + 1}`} fullWidth size="small" multiline minRows={2} value={t}
                  onChange={(e) => setModelo((m) => {
                    const ps = [...m.welcome.paragrafos]; ps[i] = e.target.value;
                    return { ...m, welcome: { ...m.welcome, paragrafos: ps } };
                  })} />
              ))}
              <Stack direction="row" spacing={1}>
                <Button size="small" startIcon={<AddIcon />}
                  onClick={() => setModelo((m) => ({ ...m, welcome: { ...m.welcome, paragrafos: [...m.welcome.paragrafos, ""] } }))}>
                  Mais um parágrafo
                </Button>
                {modelo.welcome.paragrafos.length > 1 && (
                  <Button size="small" color="error"
                    onClick={() => setModelo((m) => ({ ...m, welcome: { ...m.welcome, paragrafos: m.welcome.paragrafos.slice(0, -1) } }))}>
                    Tirar o último
                  </Button>
                )}
              </Stack>
              <TextField label="Texto do botão" size="small" sx={{ maxWidth: 260 }} value={modelo.welcome.botao}
                onChange={(e) => setModelo((m) => ({ ...m, welcome: { ...m.welcome, botao: e.target.value } }))} />
            </Stack>
          </CardContent></Card>

          {modelo.secoes.map((sec, i) => (
            <Accordion key={i} disableGutters sx={{ "&:before": { display: "none" }, border: 1, borderColor: "divider", borderRadius: 1 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ width: "100%", pr: 1 }}>
                  <Typography sx={{ fontWeight: 600 }}>{sec.titulo || "(sem título)"}</Typography>
                  <Chip size="small" variant="outlined" label={`${sec.perguntas.length} perguntas`} />
                  <Box sx={{ flex: 1 }} />
                  <Typography variant="caption" color="text.secondary">etapa {i + 1}</Typography>
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField label="Título da etapa" size="small" fullWidth value={sec.titulo}
                      onChange={(e) => mudaSecao(i, "titulo", e.target.value)} />
                    <IconButton size="small" onClick={() => moveSecao(i, -1)} disabled={i === 0}><ArrowUpwardIcon fontSize="small" /></IconButton>
                    <IconButton size="small" onClick={() => moveSecao(i, 1)} disabled={i === modelo.secoes.length - 1}><ArrowDownwardIcon fontSize="small" /></IconButton>
                    <Tooltip title="Apagar a etapa inteira">
                      <IconButton size="small" color="error" onClick={() => apagaSecao(i)}><DeleteIcon fontSize="small" /></IconButton>
                    </Tooltip>
                  </Stack>
                  <TextField label="Frase de abertura da etapa" size="small" fullWidth value={sec.intro || ""}
                    onChange={(e) => mudaSecao(i, "intro", e.target.value)} />
                  <Divider />

                  {sec.perguntas.map((p, j) => (
                    <Box key={j} sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1.5 }}>
                      <Stack spacing={1.5}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <TextField label="Pergunta" size="small" fullWidth value={p.label}
                            onChange={(e) => mudaPergunta(i, j, "label", e.target.value)} />
                          <IconButton size="small" onClick={() => movePergunta(i, j, -1)} disabled={j === 0}><ArrowUpwardIcon fontSize="small" /></IconButton>
                          <IconButton size="small" onClick={() => movePergunta(i, j, 1)} disabled={j === sec.perguntas.length - 1}><ArrowDownwardIcon fontSize="small" /></IconButton>
                          <IconButton size="small" color="error" onClick={() => apagaPergunta(i, j)}><DeleteIcon fontSize="small" /></IconButton>
                        </Stack>
                        <TextField label="Explicação (opcional)" size="small" fullWidth value={p.ajuda || ""}
                          onChange={(e) => mudaPergunta(i, j, "ajuda", e.target.value)} />
                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                          <TextField select label="Tipo" size="small" sx={{ minWidth: 210 }} value={p.tipo || "texto"}
                            onChange={(e) => mudaPergunta(i, j, "tipo", e.target.value)}>
                            {TIPOS.map((t) => <MenuItem key={t.v} value={t.v}>{t.label}</MenuItem>)}
                          </TextField>
                          <TextField select label="Preenche na IA" size="small" fullWidth value={p.campo || ""}
                            onChange={(e) => mudaPergunta(i, j, "campo", e.target.value || undefined)}>
                            <MenuItem value="">— nada —</MenuItem>
                            {CAMPOS_IA.map((c) => <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>)}
                          </TextField>
                          <TextField select label="Preenche no cadastro" size="small" fullWidth value={p.campo_cliente || ""}
                            onChange={(e) => mudaPergunta(i, j, "campo_cliente", e.target.value || undefined)}>
                            <MenuItem value="">— nada —</MenuItem>
                            {camposCliente.map((c) => <MenuItem key={c.key} value={c.key}>{c.rotulo}</MenuItem>)}
                          </TextField>
                        </Stack>
                        {p.tipo === "dia" && (
                          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: "wrap", gap: 1 }}>
                            <TextField label="Do dia" type="number" size="small" sx={{ width: 110 }}
                              value={p.dia_min ?? 1} inputProps={{ min: 1, max: 31 }}
                              onChange={(e) => mudaPergunta(i, j, "dia_min", Number(e.target.value))} />
                            <TextField label="Até o dia" type="number" size="small" sx={{ width: 110 }}
                              value={p.dia_max ?? 28} inputProps={{ min: 1, max: 31 }}
                              onChange={(e) => mudaPergunta(i, j, "dia_max", Number(e.target.value))} />
                            <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 220 }}>
                              O cliente só vê esses dias. Acima do 28, cuidado: fevereiro não tem —
                              a cobrança acaba caindo no último dia do mês.
                            </Typography>
                          </Stack>
                        )}
                        {p.tipo === "escolhas" && (
                          <>
                            <TextField label="Opções (uma por linha)" size="small" fullWidth multiline minRows={2}
                              value={(p.opcoes || []).join("\n")}
                              onChange={(e) => mudaPergunta(i, j, "opcoes", e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))} />
                            <FormControlLabel control={
                              <Switch size="small" checked={Boolean(p.multipla)}
                                onChange={(e) => mudaPergunta(i, j, "multipla", e.target.checked)} />
                            } label={<Typography variant="caption">pode marcar mais de uma</Typography>} />
                          </>
                        )}
                        <FormControlLabel control={
                          <Switch size="small" checked={Boolean(p.obrigatoria)}
                            onChange={(e) => mudaPergunta(i, j, "obrigatoria", e.target.checked)} />
                        } label={<Typography variant="caption">obrigatória (sem ela o cliente não consegue enviar)</Typography>} />
                      </Stack>
                    </Box>
                  ))}

                  <Button size="small" startIcon={<AddIcon />} onClick={() => novaPergunta(i)} sx={{ alignSelf: "flex-start" }}>
                    Nova pergunta
                  </Button>
                </Stack>
              </AccordionDetails>
            </Accordion>
          ))}

          <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1 }}>
            <Button variant="contained" onClick={salvarModelo} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar briefing"}
            </Button>
            <Button startIcon={<AddIcon />} onClick={novaSecao}>Nova etapa</Button>
            <Box sx={{ flex: 1 }} />
            <Button color="error" startIcon={<RestartAltIcon />} onClick={voltarAoPadrao}>
              Voltar ao de fábrica
            </Button>
          </Stack>
        </Stack>
      )}

      {/* O link, à vista */}
      <Dialog open={Boolean(link)} onClose={() => setLink(null)} fullWidth maxWidth="sm">
        <DialogTitle>Link do briefing — {link?.client_name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Mande este endereço para o cliente. Ele abre no celular, sem senha.
          </Typography>
          <TextField value={link?.url || ""} fullWidth size="small" multiline
            InputProps={{ readOnly: true, sx: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 } }}
            onFocus={(e) => e.target.select()} />
          <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: "wrap", gap: 1 }}>
            <Button variant="contained" startIcon={<ContentCopyIcon />} onClick={() => copiar(link.url)}>
              {copiado === link?.url ? "Copiado!" : "Copiar link"}
            </Button>
            <Button variant="outlined" startIcon={<OpenInNewIcon />} component="a"
              href={link?.url || "#"} target="_blank" rel="noreferrer">Abrir para conferir</Button>
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setLink(null)}>Fechar</Button></DialogActions>
      </Dialog>

      {/* Respostas + aplicar */}
      <Dialog open={Boolean(vendo)} onClose={() => setVendo(null)} fullWidth maxWidth="md">
        <DialogTitle>Briefing — {vendo?.client_name}</DialogTitle>
        <DialogContent dividers>
          {vendo && (
            <>
              <LinearProgress variant="determinate" value={vendo.progresso} sx={{ height: 8, borderRadius: 4, mb: 2 }} />
              <Typography variant="caption" color="text.secondary">
                {vendo.respondidas} de {vendo.total} perguntas respondidas
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
            label={<Typography variant="caption">deixar o briefing substituir o que já está preenchido</Typography>} />
          <Button onClick={() => setVendo(null)}>Fechar</Button>
          <Button variant="contained" onClick={aplicar}>Aplicar (IA + cadastro)</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
