import { useEffect, useState } from "react";
import {
  Box, Card, CardContent, Typography, Stack, TextField, Button, Tabs, Tab, Chip,
  Alert, IconButton, Tooltip, MenuItem, Divider, Accordion, AccordionSummary,
  AccordionDetails, Switch, FormControlLabel, Table, TableContainer, TableHead, TableRow, TableCell,
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
import EditIcon from "@mui/icons-material/Edit";
import DescriptionIcon from "@mui/icons-material/Description";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import api from "../api/client.js";
import { PageHeader } from "../components/ui.jsx";
import { PERSONA_GRUPOS } from "../persona.js";
import { currency } from "../utils.js";

// ---------------------------------------------------------------------------
// ONBOARDING — a entrada do cliente na casa, do convite ao contrato assinado.
//
// A aba é dividida no caminho que o cliente percorre, e cada parte é editável:
//
//  · "Clientes"     — abrir o onboarding de alguém e acompanhar de longe.
//  · "1 · Boas-vindas" — a mensagem que ele lê antes de responder.
//  · "2 · Perguntas"   — o briefing, incluindo a etapa em que ele manda material.
//  · "3 · Contrato"    — o modelo e o que a agência preenche por cliente.
//
// Ao abrir o onboarding, a agência preenche o que SÓ ELA sabe: serviço,
// quantidades, valor, vigência e a data do contrato. Quando o cliente termina
// de responder, o cadastro dele e o contrato saem prontos sozinhos — ela só
// acompanha e assina embaixo.
//
// Cada pergunta pode dizer PARA ONDE vai a resposta: um campo da inteligência
// da IA (tom, público…) ou um campo do cadastro (CNPJ, razão social, dia do
// pagamento…). É o segundo que faz o contrato sair pronto.
// ---------------------------------------------------------------------------
const TIPOS = [
  { v: "texto", label: "Resposta curta" },
  { v: "longo", label: "Resposta longa" },
  { v: "escolhas", label: "Opções para escolher" },
  { v: "cnpj", label: "CNPJ (com formatação)" },
  { v: "dia", label: "Dia do mês (1 a 31)" },
  { v: "arquivos", label: "Envio de arquivos (fotos, vídeos, referências)" },
];
const CAMPOS_IA = PERSONA_GRUPOS.flatMap((g) => g.campos.map((c) => ({ key: c.key, label: c.label })));
const ESTADO = {
  aberto: { label: "Aguardando resposta", cor: "default" },
  respondido: { label: "Respondido — aplicar", cor: "warning" },
  aplicado: { label: "Aplicado", cor: "success" },
};

export default function Onboarding() {
  const [tab, setTab] = useState("clientes");
  const [clients, setClients] = useState([]);
  const [briefings, setBriefings] = useState([]);
  const [modelo, setModelo] = useState(null);
  const [camposCliente, setCamposCliente] = useState([]);
  const [destinosCentral, setDestinosCentral] = useState([]);
  const [msg, setMsg] = useState(null);
  const [link, setLink] = useState(null);
  const [copiado, setCopiado] = useState(null);
  const [vendo, setVendo] = useState(null);
  const [sobrescrever, setSobrescrever] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [modelos, setModelos] = useState([]);   // contratos disponíveis
  const [abrindo, setAbrindo] = useState(null); // o cliente para quem vou abrir o onboarding

  const carregar = () => {
    api.get("/briefings").then((r) => setBriefings(r.data)).catch(() => {});
    api.get("/briefings/template").then((r) => {
      setModelo({ welcome: r.data.welcome, secoes: r.data.secoes });
      setCamposCliente(r.data.campos_cliente || []);
      setDestinosCentral(r.data.destinos_central || []);
    }).catch(() => {});
  };

  useEffect(() => {
    api.get("/clients").then((r) => setClients(r.data.filter((c) => c.status === "active"))).catch(() => {});
    api.get("/briefings/modelos").then((r) => setModelos(r.data)).catch(() => {});
    carregar();
  }, []);

  const porCliente = {};
  for (const b of briefings) if (!porCliente[b.client_id]) porCliente[b.client_id] = b;

  async function criarLink(clienteId, termos) {
    const c = clients.find((x) => x.id === clienteId);
    try {
      const { data } = await api.post("/briefings", { client_id: clienteId, termos });
      await carregar();
      setAbrindo(null);
      setLink({ url: data.url, client_name: c?.name || "" });
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
      if (data.central?.length) partes.push(`${data.central.length} guardado(s) na Central`);
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
      setMsg({ t: "success", m: "Salvo. Quem abrir o link a partir de agora já vê assim." });
    } catch (e) { setMsg({ t: "error", m: e.response?.data?.error || "Não consegui salvar." }); }
    finally { setSalvando(false); setTimeout(() => setMsg(null), 6000); }
  }

  async function voltarAoPadrao() {
    if (!window.confirm("Voltar ao onboarding de fábrica? Suas perguntas personalizadas serão perdidas.")) return;
    const { data } = await api.delete("/briefings/template");
    setModelo({ welcome: data.welcome, secoes: data.secoes });
    setMsg({ t: "success", m: "Voltou ao onboarding de fábrica." });
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
      <PageHeader title="Onboarding"
        subtitle="Do convite ao contrato assinado — você preenche o que só você sabe, o cliente responde o resto" />

      {msg && <Alert severity={msg.t} sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg.m}</Alert>}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2.5 }}>
        <Tab value="clientes" label={`Clientes${respondidos ? ` (${respondidos})` : ""}`} />
        <Tab value="boasvindas" label="1 · Boas-vindas" />
        <Tab value="perguntas" label="2 · Perguntas" />
        <Tab value="contrato" label="3 · Contrato" />
      </Tabs>

      {tab === "clientes" ? (
        <Card><CardContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Abra o onboarding de um cliente: você preenche o serviço, as quantidades, o valor e a
            vigência — o que só você sabe — e o sistema devolve o link para mandar a ele. Quando ele
            terminar de responder, o <b>cadastro</b> e o <b>contrato</b> já saem prontos, e as
            respostas ficam aqui esperando você levar para a <b>inteligência da IA</b>.
          </Typography>
          <TableContainer>
            {/* No celular a tabela é mais larga que a tela: ela rola sozinha
                aqui dentro, em vez de arrastar a página inteira para o lado. */}
            <Table size="small">
              <TableHead><TableRow>
                <TableCell>Cliente</TableCell><TableCell>Onboarding</TableCell>
                <TableCell>O que foi combinado</TableCell><TableCell align="right">Ações</TableCell>
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
                        ) : <Typography variant="caption" color="text.secondary">não começou</Typography>}
                      </TableCell>
                      <TableCell>
                        {b?.termos ? (
                          <Typography variant="caption" color="text.secondary">
                            {[b.termos.servico, b.termos.value ? currency(b.termos.value) + "/mês" : null,
                              b.termos.duration_months ? `${b.termos.duration_months} meses` : null]
                              .filter(Boolean).join(" · ") || "—"}
                          </Typography>
                        ) : b ? (
                          <Tooltip title="Sem isto o contrato não tem como sair sozinho">
                            <Chip size="small" variant="outlined" color="warning" label="faltam os termos" />
                          </Tooltip>
                        ) : <Typography variant="caption" color="text.secondary">—</Typography>}
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
                            <Tooltip title="Corrigir o que foi combinado">
                              <IconButton size="small" onClick={() => setAbrindo({ cliente: c, briefing: b })}>
                                <EditIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </>
                        ) : (
                          <Button size="small" variant="outlined" onClick={() => setAbrindo({ cliente: c })}>
                            Abrir onboarding
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent></Card>
      ) : tab === "contrato" ? (
        <AbaContrato modelos={modelos} />
      ) : !modelo ? <LinearProgress /> : (
        <Stack spacing={2.5}>
          {tab === "boasvindas" && (
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
          )}

          {tab === "perguntas" && modelo.secoes.map((sec, i) => (
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
                          <TextField select label="Vai para a Central" size="small" fullWidth value={p.destino_central || ""}
                            onChange={(e) => mudaPergunta(i, j, "destino_central", e.target.value || undefined)}
                            helperText={p.destino_central === "credential"
                              ? "A resposta sai do briefing e fica criptografada na Central"
                              : " "}>
                            <MenuItem value="">— nada —</MenuItem>
                            {destinosCentral.map((c) => <MenuItem key={c.key} value={c.key}>{c.rotulo}</MenuItem>)}
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
              {salvando ? "Salvando…" : "Salvar"}
            </Button>
            {tab === "perguntas" && <Button startIcon={<AddIcon />} onClick={novaSecao}>Nova etapa</Button>}
            <Box sx={{ flex: 1 }} />
            <Button color="error" startIcon={<RestartAltIcon />} onClick={voltarAoPadrao}>
              Voltar ao de fábrica
            </Button>
          </Stack>
        </Stack>
      )}

      {/* O que a agência preenche antes de mandar o link */}
      <FormularioOnboarding aberto={abrindo} modelos={modelos} onFechar={() => setAbrindo(null)}
        onSalvar={criarLink} />

      {/* O link, à vista */}
      <Dialog open={Boolean(link)} onClose={() => setLink(null)} fullWidth maxWidth="sm">
        <DialogTitle>Link do onboarding — {link?.client_name}</DialogTitle>
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
        <DialogTitle>Respostas — {vendo?.client_name}</DialogTitle>
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

// ---------------------------------------------------------------------------
// O QUE A AGÊNCIA PREENCHE — antes de o link existir.
//
// São os dados que o cliente não tem como responder: qual serviço ele contratou,
// quanto de cada coisa vai receber por mês, quanto paga, de quando até quando e
// que data deve constar no contrato. O resto (razão social, CNPJ, quem assina,
// dia do pagamento) vem do próprio cliente, respondendo o briefing.
// ---------------------------------------------------------------------------
const VAZIO = {
  modelo: "", servico: "", value: "", itens: [],
  start_date: "", end_date: "", contract_date: "", observacoes: "",
};

/** "servico:3" / "modelo:7" — o select precisa de um valor só. */
const chaveDoModelo = (m) => `${m.origem}:${m.id}`;

function FormularioOnboarding({ aberto, modelos, onFechar, onSalvar }) {
  const [f, setF] = useState(VAZIO);
  const cliente = aberto?.cliente;
  const jaExiste = aberto?.briefing;

  useEffect(() => {
    if (!aberto) return;
    const t = jaExiste?.termos;
    if (t) {
      setF({
        modelo: t.service_id ? `servico:${t.service_id}` : (t.template_id ? `modelo:${t.template_id}` : ""),
        servico: t.servico || "", value: t.value ?? "", itens: t.itens || [],
        start_date: t.start_date || "", end_date: t.end_date || "",
        contract_date: t.contract_date || "", observacoes: t.observacoes || "",
      });
    } else {
      setF({ ...VAZIO, contract_date: new Date().toISOString().slice(0, 10) });
    }
  }, [aberto, jaExiste]);

  // Escolher o serviço já traz o nome, o valor de tabela e as entregas dele —
  // é para ela só conferir os números, não redigitar tudo.
  function escolheModelo(chave) {
    const m = modelos.find((x) => chaveDoModelo(x) === chave);
    setF((a) => ({
      ...a,
      modelo: chave,
      servico: a.servico || m?.name || "",
      value: a.value === "" && m?.valor_padrao ? m.valor_padrao : a.value,
      itens: a.itens.length ? a.itens : (m?.itens || []).map((i) => ({ ...i, quantidade: "" })),
    }));
  }

  const meses = mesesEntre(f.start_date, f.end_date);
  const escolhido = modelos.find((x) => chaveDoModelo(x) === f.modelo);
  const semContrato = escolhido && !escolhido.tem_contrato;

  function salvar() {
    const [origem, id] = (f.modelo || ":").split(":");
    onSalvar(cliente.id, {
      service_id: origem === "servico" ? Number(id) : null,
      template_id: origem === "modelo" ? Number(id) : null,
      servico: f.servico, value: f.value,
      itens: f.itens.filter((i) => i.label),
      start_date: f.start_date || null, end_date: f.end_date || null,
      contract_date: f.contract_date || null, observacoes: f.observacoes,
    });
  }

  return (
    <Dialog open={Boolean(aberto)} onClose={onFechar} fullWidth maxWidth="sm">
      <DialogTitle>
        {jaExiste ? "O que foi combinado" : "Abrir onboarding"} — {cliente?.name}
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
          Preencha o que só você sabe. O resto — razão social, CNPJ, endereço, quem assina e o dia do
          pagamento — vem do próprio cliente ao responder, e o contrato se monta com as duas metades.
        </Typography>
        <Stack spacing={2}>
          <TextField select label="Contrato deste cliente" size="small" fullWidth value={f.modelo}
            onChange={(e) => escolheModelo(e.target.value)}
            helperText={semContrato
              ? "Este serviço ainda não tem o texto do contrato escrito — abra Serviços e escreva."
              : "De onde sai o texto do contrato. Sem isto, o contrato não sai sozinho."}
            error={Boolean(semContrato)}>
            <MenuItem value="">— decidir depois —</MenuItem>
            {modelos.map((m) => (
              <MenuItem key={chaveDoModelo(m)} value={chaveDoModelo(m)}>
                {m.name}
                <Typography variant="caption" color={m.tem_contrato ? "success.main" : "text.disabled"} sx={{ ml: 1 }}>
                  {m.origem === "servico" ? "serviço" : "modelo"}{m.tem_contrato ? " ✓" : " — sem texto"}
                </Typography>
              </MenuItem>
            ))}
          </TextField>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Serviço (como aparece no contrato)" size="small" fullWidth value={f.servico}
              onChange={(e) => setF((a) => ({ ...a, servico: e.target.value }))} />
            <TextField label="Valor por mês (R$)" size="small" type="number" sx={{ minWidth: 170 }}
              value={f.value} onChange={(e) => setF((a) => ({ ...a, value: e.target.value }))}
              inputProps={{ inputMode: "decimal", min: 0 }} />
          </Stack>

          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">Quanto ele recebe por mês</Typography>
          </Divider>
          {f.itens.map((it, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="center">
              <TextField size="small" label="Entrega" value={it.label} sx={{ flex: 1 }}
                placeholder="Ex.: Posts"
                onChange={(e) => setF((a) => {
                  const itens = [...a.itens]; itens[i] = { ...itens[i], label: e.target.value }; return { ...a, itens };
                })} />
              <TextField size="small" label="Quantidade" type="number" sx={{ width: 130 }} value={it.quantidade ?? ""}
                inputProps={{ inputMode: "numeric", min: 0 }}
                onChange={(e) => setF((a) => {
                  const itens = [...a.itens]; itens[i] = { ...itens[i], quantidade: e.target.value }; return { ...a, itens };
                })} />
              <IconButton size="small" color="error"
                onClick={() => setF((a) => ({ ...a, itens: a.itens.filter((_, k) => k !== i) }))}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Button size="small" startIcon={<AddIcon />} sx={{ alignSelf: "flex-start" }}
            onClick={() => setF((a) => ({ ...a, itens: [...a.itens, { label: "", unit: "", quantidade: "" }] }))}>
            Mais uma entrega
          </Button>

          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">Vigência e data</Typography>
          </Divider>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Começa em" type="date" size="small" fullWidth InputLabelProps={{ shrink: true }}
              value={f.start_date} onChange={(e) => setF((a) => ({ ...a, start_date: e.target.value }))} />
            <TextField label="Termina em" type="date" size="small" fullWidth InputLabelProps={{ shrink: true }}
              value={f.end_date} onChange={(e) => setF((a) => ({ ...a, end_date: e.target.value }))}
              error={Boolean(f.start_date && f.end_date && !meses)}
              helperText={f.start_date && f.end_date && !meses ? "O fim tem que vir depois do começo." : " "} />
          </Stack>
          {meses > 0 && (
            <Alert severity="info" icon={false} sx={{ py: 0.5 }}>
              No contrato: <b>vigência de {String(meses).padStart(2, "0")} meses</b> — contando o mês de
              início e o de término.
            </Alert>
          )}
          <TextField label="Data que deve constar no contrato" type="date" size="small" sx={{ maxWidth: 280 }}
            InputLabelProps={{ shrink: true }} value={f.contract_date}
            onChange={(e) => setF((a) => ({ ...a, contract_date: e.target.value }))} />
          <TextField label="Observações (só para você)" size="small" fullWidth multiline minRows={2}
            value={f.observacoes} onChange={(e) => setF((a) => ({ ...a, observacoes: e.target.value }))} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onFechar}>Cancelar</Button>
        <Button variant="contained" onClick={salvar}>
          {jaExiste ? "Salvar" : "Gerar link"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Meses de vigência contando os dois extremos — igual ao servidor. */
function mesesEntre(inicio, fim) {
  if (!inicio || !fim) return 0;
  const a = new Date(`${inicio}T12:00:00`);
  const b = new Date(`${fim}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
}

// ---------------------------------------------------------------------------
// A aba do CONTRATO: de onde sai o texto e o que o sistema troca nele.
// ---------------------------------------------------------------------------
const MARCADORES = [
  ["Quem contrata", ["razao_social", "cnpj", "cnpj_formatado", "endereco", "cliente", "empresa", "email", "telefone", "segmento"]],
  ["Quem assina pela empresa", ["representante", "documento_representante", "tipo_documento_representante"]],
  ["Dinheiro", ["valor", "valor_extenso", "dia_pagamento", "vencimento"]],
  ["Prazos e datas", ["inicio", "fim", "prazo", "duracao", "data", "inicio_curto"]],
  ["O que foi contratado", ["servico", "posts_mes", "videos_mes", "captacoes_mes"]],
  ["A agência", ["agencia", "cnpj_agencia", "endereco_agencia", "representante_agencia", "documento_representante_agencia", "cidade", "foro"]],
];

function AbaContrato({ modelos }) {
  const comTexto = modelos.filter((m) => m.tem_contrato);
  return (
    <Stack spacing={2.5}>
      <Card><CardContent>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>De onde sai o texto do contrato</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          O contrato de cada serviço é escrito na aba <b>Serviços</b>. Aqui você vê quais já têm texto
          pronto — só esses conseguem gerar contrato sozinhos ao fim do onboarding.
        </Typography>
        {modelos.length === 0 ? (
          <Alert severity="info">Nenhum serviço cadastrado ainda. Comece pela aba Serviços.</Alert>
        ) : (
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            {modelos.map((m) => (
              <Chip key={chaveDoModelo(m)} label={m.name} variant="outlined"
                color={m.tem_contrato ? "success" : "default"}
                icon={m.tem_contrato ? undefined : <DescriptionIcon />} />
            ))}
          </Stack>
        )}
        {comTexto.length === 0 && modelos.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Nenhum tem o texto escrito ainda. Abra <b>Serviços</b>, escolha o serviço e escreva o
            contrato dele — depois disso o onboarding passa a gerar o contrato sozinho.
          </Alert>
        )}
      </CardContent></Card>

      <Card><CardContent>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>O que o sistema preenche sozinho</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Escreva estes marcadores dentro do contrato e eles viram os dados de verdade na hora de
          gerar. Metade vem do que <b>você</b> preenche ao abrir o onboarding; a outra metade, do que o
          <b> cliente</b> responde.
        </Typography>
        <Stack spacing={2}>
          {MARCADORES.map(([grupo, chaves]) => (
            <Box key={grupo}>
              <Typography variant="caption" color="text.secondary">{grupo}</Typography>
              <Box sx={{ mt: 0.5, display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                {chaves.map((k) => (
                  <Chip key={k} size="small" variant="outlined" label={`{{${k}}}`}
                    sx={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }} />
                ))}
              </Box>
            </Box>
          ))}
          <Alert severity="info" icon={false}>
            As entregas que você cadastra no serviço também viram marcador pelo próprio nome:
            uma entrega chamada <b>Stories</b> pode ser escrita no contrato como{" "}
            <code>{"{{qtd_stories}}"}</code> — e sai <b>12 (doze)</b>, por extenso.
          </Alert>
        </Stack>
      </CardContent></Card>
    </Stack>
  );
}
