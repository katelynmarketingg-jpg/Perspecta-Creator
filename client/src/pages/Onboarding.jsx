import { useEffect, useState } from "react";
import {
  Box, Card, CardContent, Typography, Stack, TextField, Button, Tabs, Tab, Chip,
  Alert, IconButton, Tooltip, MenuItem, Divider,
  Switch, FormControlLabel, Table, TableContainer, TableHead, TableRow, TableCell,
  TableBody, Dialog, DialogTitle, DialogContent, DialogActions, LinearProgress, Collapse,
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
import QuizIcon from "@mui/icons-material/Quiz";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import LockOpenIcon from "@mui/icons-material/LockOpen";
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
  { v: "arquivos", label: "Galeria (ele sobe fotos)" },
  { v: "visual", label: "Opções em imagem" },
];
const CAMPOS_IA = PERSONA_GRUPOS.flatMap((g) => g.campos.map((c) => ({ key: c.key, label: c.label })));
const ESTADO = {
  aberto: { label: "Aguardando resposta", cor: "default" },
  respondido: { label: "Respondido — aplicar", cor: "warning" },
  aplicado: { label: "Aplicado", cor: "success" },
  encerrado: { label: "Encerrado", cor: "default" },
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
  const [perguntasDe, setPerguntasDe] = useState(null); // questionário só de um cliente
  // A estante de formulários com nome, e qual deles a aba "Perguntas" edita.
  // `null` é o padrão da casa — que também é uma opção de verdade, não a
  // ausência de uma.
  const [formularios, setFormularios] = useState([]);
  const [editando, setEditando] = useState(null);   // null = padrão da casa
  const [form, setForm] = useState(null);           // o formulário aberto, se houver
  const [batizando, setBatizando] = useState(null); // { nome, copiar_de, renomeia }
  // Um formulário é a jornada inteira: onde começa, o que pergunta e como
  // termina. Estas são as três partes que ela edita.
  const [parte, setParte] = useState("perguntas");

  const carregarFormularios = () =>
    api.get("/briefings/formularios").then((r) => setFormularios(r.data.formularios || []))
      .catch(() => {});

  const carregar = () => {
    api.get("/briefings").then((r) => setBriefings(r.data)).catch(() => {});
    carregarFormularios();
    api.get("/briefings/template").then((r) => {
      setModelo({
        welcome: r.data.welcome, secoes: r.data.secoes,
        gera_contrato: r.data.gera_contrato !== false,
        cria_acesso: r.data.cria_acesso !== false,
      });
      setCamposCliente(r.data.campos_cliente || []);
      setDestinosCentral(r.data.destinos_central || []);
    }).catch(() => {});
  };

  // Trocar de formulário na aba "Perguntas" busca as perguntas daquele.
  useEffect(() => {
    if (!editando) { setForm(null); return; }
    api.get(`/briefings/formularios/${editando}`)
      .then((r) => setForm({
        id: r.data.id, name: r.data.name, secoes: r.data.secoes,
        welcome: r.data.welcome, welcome_da_casa: r.data.welcome_da_casa,
        gera_contrato: r.data.gera_contrato, cria_acesso: r.data.cria_acesso,
      }))
      .catch(() => { setForm(null); setEditando(null); });
  }, [editando]);

  // O que a aba "Perguntas" está editando agora: o padrão ou um formulário.
  const secoesEmEdicao = editando ? (form?.secoes || []) : (modelo?.secoes || []);
  const mudaSecoesEmEdicao = (secoes) => {
    if (editando) setForm((f) => f && ({ ...f, secoes }));
    else setModelo((m) => ({ ...m, secoes }));
  };

  async function salvarFormulario() {
    setSalvando(true);
    try {
      await api.put(`/briefings/formularios/${editando}`, {
        secoes: form.secoes,
        // `null` é "volte a usar o texto da casa" — por isso vai explícito.
        welcome: form.welcome ?? null,
        gera_contrato: form.gera_contrato,
        cria_acesso: form.cria_acesso,
      });
      await carregarFormularios();
      setMsg({ t: "success", m: `"${form.name}" salvo. Quem receber este formulário a partir de agora já vê assim.` });
    } catch (e) { setMsg({ t: "error", m: e.response?.data?.error || "Não consegui salvar." }); }
    finally { setSalvando(false); setTimeout(() => setMsg(null), 6000); }
  }

  async function criarFormulario({ nome, copiar_de }) {
    try {
      const { data } = await api.post("/briefings/formularios", { nome, copiar_de: copiar_de || undefined });
      await carregarFormularios();
      setEditando(data.id);
      setParte("inicio");   // a jornada começa no começo
      setBatizando(null);
      setMsg({ t: "success", m: `Formulário "${data.name}" criado. Percorra Início, Perguntas e Fim, e salve.` });
    } catch (e) { setMsg({ t: "error", m: e.response?.data?.error || "Não consegui criar." }); }
  }

  async function renomearFormulario(nome) {
    try {
      const { data } = await api.put(`/briefings/formularios/${editando}`, { nome });
      setForm((f) => f && ({ ...f, name: data.name }));
      await carregarFormularios();
      setBatizando(null);
    } catch (e) { setMsg({ t: "error", m: e.response?.data?.error || "Não consegui renomear." }); }
  }

  async function apagarFormulario() {
    if (!window.confirm(`Apagar o formulário "${form.name}"? `
      + "Quem estava recebendo ele volta para o padrão da casa. "
      + "As respostas que os clientes já deram não se perdem.")) return;
    try {
      const { data } = await api.delete(`/briefings/formularios/${editando}`);
      setEditando(null);
      await carregar();
      setMsg({ t: "success", m: data.clientes
        ? `Formulário apagado. ${data.clientes} cliente(s) voltaram para o padrão da casa.`
        : "Formulário apagado." });
    } catch (e) { setMsg({ t: "error", m: e.response?.data?.error || "Não consegui apagar." }); }
  }

  useEffect(() => {
    api.get("/clients").then((r) => setClients(r.data.filter((c) => c.status === "active"))).catch(() => {});
    api.get("/briefings/modelos").then((r) => setModelos(r.data)).catch(() => {});
    carregar();
  }, []);

  const porCliente = {};
  for (const b of briefings) if (!porCliente[b.client_id]) porCliente[b.client_id] = b;

  async function criarLink(clienteId, termos, formId) {
    const c = clients.find((x) => x.id === clienteId);
    try {
      const { data } = await api.post("/briefings", { client_id: clienteId, termos, form_id: formId });
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

  // FECHAR O ONBOARDING: aquele cliente já entrou, não tem mais o que preencher.
  // Nada é apagado — as respostas ficam, o link é que para de aceitar coisa nova.
  async function encerrar(b, nome) {
    if (!window.confirm(`Fechar o onboarding de ${nome}? O link para de aceitar resposta. `
      + "Nada do que ele já respondeu se perde, e dá para reabrir depois.")) return;
    try {
      await api.post(`/briefings/${b.id}/encerrar`);
      await carregar();
      setMsg({ t: "success", m: `Onboarding de ${nome} fechado.` });
    } catch (e) { setMsg({ t: "error", m: e.response?.data?.error || "Não consegui fechar." }); }
  }

  async function reabrir(b) {
    try { await api.post(`/briefings/${b.id}/reabrir`); await carregar(); }
    catch (e) { setMsg({ t: "error", m: e.response?.data?.error || "Não consegui reabrir." }); }
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
      setModelo({
        welcome: data.welcome, secoes: data.secoes,
        gera_contrato: data.gera_contrato !== false,
        cria_acesso: data.cria_acesso !== false,
      });
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
                            {/* Qual formulário ele está respondendo. Com vários
                                formulários na casa, sem isto ninguém sabe quem
                                recebeu o quê. */}
                            <Chip size="small" variant="outlined" label={b.origem?.nome || "Padrão da casa"}
                              color={b.origem?.tipo === "padrao" ? "default" : "primary"}
                              sx={{ height: 20, fontSize: 11 }} />
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
                            <Tooltip title={b.perguntas_proprias
                              ? "Este cliente tem perguntas próprias — editar"
                              : "Fazer um questionário só deste cliente"}>
                              <IconButton size="small" color={b.perguntas_proprias ? "primary" : "default"}
                                onClick={() => setPerguntasDe({ briefing: b, client_name: c.name })}>
                                <QuizIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            {b.status === "encerrado" ? (
                              <Tooltip title="Reabrir — o link volta a aceitar resposta">
                                <IconButton size="small" onClick={() => reabrir(b)}>
                                  <LockOpenIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            ) : (
                              <Tooltip title="Fechar onboarding — sai da fila e o link para de aceitar resposta">
                                <IconButton size="small" onClick={() => encerrar(b, c.name)}>
                                  <DoneAllIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
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
              <EditorDeBoasVindas welcome={modelo.welcome}
                onChange={(welcome) => setModelo((m) => ({ ...m, welcome }))} />
            </CardContent></Card>
          )}

          {tab === "perguntas" && (
            <>
              {/* A ESTANTE. O padrão da casa é a primeira opção porque é ele
                  que vale quando ela não escolhe nada — e é dele que quase todo
                  formulário novo nasce. */}
              <Card variant="outlined"><CardContent sx={{ pb: "16px !important" }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Qual formulário você está editando</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.75 }}>
                  Você pode ter um formulário por ramo — "Advocacia", "Alimentação" — e mandar o
                  certo para cada cliente. O padrão é o que vale quando você não escolhe nenhum.
                </Typography>
                <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
                  <Chip label="Padrão da casa" clickable onClick={() => setEditando(null)}
                    color={editando ? "default" : "primary"} variant={editando ? "outlined" : "filled"}
                    sx={{ height: 34, borderRadius: 2 }} />
                  {formularios.map((f) => (
                    <Tooltip key={f.id} title={resumoDaJornada(f)}>
                      <Chip clickable onClick={() => setEditando(f.id)}
                        label={`${f.name} · ${f.perguntas}`}
                        color={editando === f.id ? "primary" : "default"}
                        variant={editando === f.id ? "filled" : "outlined"}
                        sx={{ height: 34, borderRadius: 2 }} />
                    </Tooltip>
                  ))}
                  <Button size="small" startIcon={<AddIcon />}
                    onClick={() => setBatizando({ nome: "", copiar_de: editando || "" })}>
                    Novo formulário
                  </Button>
                </Stack>
                {editando && form && (
                  <Stack direction="row" spacing={1} sx={{ mt: 1.75, flexWrap: "wrap", gap: 1 }}>
                    <Button size="small" startIcon={<EditIcon />}
                      onClick={() => setBatizando({ nome: form.name, renomeia: true })}>
                      Renomear
                    </Button>
                    <Button size="small" startIcon={<ContentCopyIcon />}
                      onClick={() => setBatizando({ nome: `${form.name} (cópia)`, copiar_de: form.id })}>
                      Duplicar
                    </Button>
                    <Box sx={{ flex: 1 }} />
                    <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={apagarFormulario}>
                      Apagar formulário
                    </Button>
                  </Stack>
                )}
              </CardContent></Card>

              {/* AS TRÊS PARTES DA JORNADA. Onde começa, o que pergunta e como
                  termina — porque um orçamento e um onboarding mensal não
                  abrem com o mesmo texto nem terminam do mesmo jeito. */}
              <Tabs value={parte} onChange={(_, v) => setParte(v)} sx={{ minHeight: 40 }}>
                <Tab value="inicio" label="Início" sx={{ minHeight: 40 }} />
                <Tab value="perguntas" label="Perguntas" sx={{ minHeight: 40 }} />
                <Tab value="fim" label="Fim" sx={{ minHeight: 40 }} />
              </Tabs>

              {editando && !form ? <LinearProgress /> : parte === "perguntas" ? (
                <EditorDePerguntas secoes={secoesEmEdicao} onChange={mudaSecoesEmEdicao}
                  camposCliente={camposCliente} destinosCentral={destinosCentral} />
              ) : parte === "inicio" ? (
                <Card><CardContent>
                  {editando ? (
                    <>
                      <FormControlLabel sx={{ mb: 1 }} control={
                        <Switch size="small" checked={Boolean(form.welcome)}
                          onChange={(e) => setForm((f) => ({
                            ...f,
                            // Ligar parte do texto da casa: é o rascunho mais
                            // provável, e ela ajusta o que for diferente.
                            welcome: e.target.checked ? { ...f.welcome_da_casa } : null,
                          }))} />
                      } label={
                        <Typography variant="caption">
                          escrever um texto de boas-vindas só para este formulário
                        </Typography>
                      } />
                      {form.welcome ? (
                        <EditorDeBoasVindas welcome={form.welcome}
                          onChange={(welcome) => setForm((f) => ({ ...f, welcome }))} />
                      ) : (
                        <Alert severity="info">
                          Quem receber este formulário vê o texto de boas-vindas da casa — o mesmo
                          da aba "1 · Boas-vindas".
                        </Alert>
                      )}
                    </>
                  ) : (
                    <EditorDeBoasVindas welcome={modelo.welcome}
                      onChange={(welcome) => setModelo((m) => ({ ...m, welcome }))} />
                  )}
                </CardContent></Card>
              ) : (
                <FimDoFormulario
                  gera={editando ? form.gera_contrato : modelo.gera_contrato}
                  acesso={editando ? form.cria_acesso : modelo.cria_acesso}
                  onMuda={(campo, valor) => (editando
                    ? setForm((f) => ({ ...f, [campo]: valor }))
                    : setModelo((m) => ({ ...m, [campo]: valor })))} />
              )}
            </>
          )}

          <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1 }}>
            <Button variant="contained" disabled={salvando}
              onClick={tab === "perguntas" && editando ? salvarFormulario : salvarModelo}>
              {salvando ? "Salvando…"
                : tab === "perguntas" && editando ? `Salvar "${form?.name || ""}"` : "Salvar"}
            </Button>
            <Box sx={{ flex: 1 }} />
            {!(tab === "perguntas" && editando) && (
              <Button color="error" startIcon={<RestartAltIcon />} onClick={voltarAoPadrao}>
                Voltar ao de fábrica
              </Button>
            )}
          </Stack>
        </Stack>
      )}

      {/* Dar nome a um formulário — criar, duplicar ou renomear */}
      <NomeDoFormulario alvo={batizando} onFechar={() => setBatizando(null)}
        onConfirmar={(nome) => (batizando?.renomeia
          ? renomearFormulario(nome)
          : criarFormulario({ nome, copiar_de: batizando?.copiar_de }))} />

      {/* O questionário só deste cliente */}
      <PerguntasDoCliente alvo={perguntasDe} onFechar={() => setPerguntasDe(null)}
        onSalvo={(texto) => { setPerguntasDe(null); carregar(); setMsg({ t: "success", m: texto }); }} />

      {/* O que a agência preenche antes de mandar o link */}
      <FormularioOnboarding aberto={abrindo} modelos={modelos} formularios={formularios}
        onFechar={() => setAbrindo(null)} onSalvar={criarLink} />

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
                // Uma pergunta visual pode ter só o "por quê" escrito — e é
                // justamente ele o que vale a leitura. Sem isto, sumia da tela.
                const temAlgo = (p) => String(vendo.respostas[p.id] || "").trim()
                  || String(vendo.respostas[`${p.id}__porque`] || "").trim();
                const comResposta = s.perguntas.filter(temAlgo);
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
                          {p.tipo === "visual" && <EscolhaVisual p={p} respostas={vendo.respostas} />}
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
  form_id: "",   // qual formulário ele vai responder ("" = padrão da casa)
};

/** "servico:3" / "modelo:7" — o select precisa de um valor só. */
const chaveDoModelo = (m) => `${m.origem}:${m.id}`;

function FormularioOnboarding({ aberto, modelos, formularios, onFechar, onSalvar }) {
  const [f, setF] = useState(VAZIO);
  const cliente = aberto?.cliente;
  const jaExiste = aberto?.briefing;

  useEffect(() => {
    if (!aberto) return;
    const t = jaExiste?.termos;
    const formAtual = jaExiste?.form_id || "";
    if (t) {
      setF({
        modelo: t.service_id ? `servico:${t.service_id}` : (t.template_id ? `modelo:${t.template_id}` : ""),
        servico: t.servico || "", value: t.value ?? "", itens: t.itens || [],
        start_date: t.start_date || "", end_date: t.end_date || "",
        contract_date: t.contract_date || "", observacoes: t.observacoes || "",
        form_id: formAtual,
      });
    } else {
      setF({ ...VAZIO, form_id: formAtual, contract_date: new Date().toISOString().slice(0, 10) });
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
    }, f.form_id || null);
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
          {/* QUAL FORMULÁRIO ELE VAI RESPONDER. Fica no topo porque é a primeira
              decisão: as perguntas que ele vê saem daqui. */}
          <TextField select label="Formulário que ele vai responder" size="small" fullWidth
            value={f.form_id} onChange={(e) => setF((a) => ({ ...a, form_id: e.target.value }))}
            helperText={jaExiste?.origem?.tipo === "proprio"
              ? "Atenção: hoje ele tem perguntas escritas só para ele. Escolher um formulário aqui substitui essas perguntas."
              : "O padrão da casa vale quando você não escolhe nenhum."}>
            <MenuItem value="">Padrão da casa</MenuItem>
            {(formularios || []).map((x) => (
              <MenuItem key={x.id} value={x.id}>
                {x.name}
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  {x.perguntas} perguntas
                </Typography>
              </MenuItem>
            ))}
          </TextField>

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

// ---------------------------------------------------------------------------
// O EDITOR DE PERGUNTAS.
//
// O mesmo editor serve para duas coisas, e é de propósito: o questionário da
// casa (o padrão, que vale para todo mundo) e o questionário de UM cliente.
// Ela aprende a mexer uma vez só.
// ---------------------------------------------------------------------------
function EditorDePerguntas({ secoes, onChange, camposCliente, destinosCentral }) {
  const mudaSecao = (i, campo, valor) => {
    const s = [...secoes]; s[i] = { ...s[i], [campo]: valor }; onChange(s);
  };
  const mudaPergunta = (i, j, campo, valor) => {
    const s = [...secoes];
    const ps = [...s[i].perguntas];
    ps[j] = { ...ps[j], [campo]: valor };
    s[i] = { ...s[i], perguntas: ps };
    onChange(s);
  };
  const moveSecao = (i, d) => {
    const s = [...secoes]; const alvo = i + d;
    if (alvo < 0 || alvo >= s.length) return;
    [s[i], s[alvo]] = [s[alvo], s[i]];
    onChange(s);
  };
  const movePergunta = (i, j, d) => {
    const s = [...secoes]; const ps = [...s[i].perguntas]; const alvo = j + d;
    if (alvo < 0 || alvo >= ps.length) return;
    [ps[j], ps[alvo]] = [ps[alvo], ps[j]];
    s[i] = { ...s[i], perguntas: ps };
    onChange(s);
  };
  const apagaPergunta = (i, j) => {
    const s = [...secoes];
    s[i] = { ...s[i], perguntas: s[i].perguntas.filter((_, k) => k !== j) };
    onChange(s);
  };
  const novaPergunta = (i) => {
    const s = [...secoes];
    s[i] = { ...s[i], perguntas: [...s[i].perguntas, { id: `nova_${Date.now()}`, tipo: "texto", label: "" }] };
    onChange(s);
  };
  const novaSecao = () => onChange([...secoes, {
    id: `etapa_${Date.now()}`, titulo: "Nova etapa", intro: "",
    perguntas: [{ id: `nova_${Date.now()}`, tipo: "texto", label: "" }],
  }]);
  // APAGAR UMA ETAPA leva as perguntas dela junto — e é exatamente por isso que
  // pergunta antes, dizendo quantas são. Sem esse número, é fácil apagar nove
  // perguntas achando que era uma etapa vazia.
  // Qual etapa está aberta. É controlado aqui (e não pelo Accordion do MUI)
  // porque o cabeçalho da etapa tem botões — subir, descer, apagar — e o
  // Accordion desenha o cabeçalho inteiro como um <button>. Botão dentro de
  // botão é HTML inválido: o navegador desmonta a marcação por conta própria e
  // o teclado passa a se perder no meio dos controles.
  const [aberta, setAberta] = useState(null);
  const alterna = (i) => setAberta((a) => (a === i ? null : i));

  const apagaSecao = (i) => {
    const sec = secoes[i];
    if (secoes.length === 1) {
      window.alert("Esta é a única etapa. Um formulário precisa de pelo menos uma — "
        + "crie outra antes de apagar esta.");
      return;
    }
    const quantas = sec.perguntas?.length || 0;
    const aviso = quantas
      ? `Apagar a etapa "${sec.titulo || "(sem título)"}" e as ${quantas} perguntas dela?`
      : `Apagar a etapa "${sec.titulo || "(sem título)"}"?`;
    if (!window.confirm(aviso)) return;
    onChange(secoes.filter((_, k) => k !== i));
  };

  return (
    <Stack spacing={2.5}>
      {secoes.map((sec, i) => (
        <Box key={i} sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
          {/* O CABEÇALHO DA ETAPA. Subir, descer e apagar ficam aqui, com a
              etapa fechada: reordenar ou apagar não deveria obrigar ninguém a
              abrir a etapa e ler o que tem dentro primeiro. */}
          <Stack direction="row" spacing={1} alignItems="center" data-etapa={i + 1}
            data-aberta={aberta === i ? "sim" : "nao"}
            sx={{ px: 2, py: 1.5, bgcolor: aberta === i ? "action.hover" : "transparent" }}>
            <Stack direction="row" spacing={1} alignItems="center"
              onClick={() => alterna(i)}
              sx={{ flex: 1, minWidth: 0, cursor: "pointer", flexWrap: "wrap", gap: 0.5 }}>
              <Typography sx={{ fontWeight: 600 }}>{sec.titulo || "(sem título)"}</Typography>
              <Chip size="small" variant="outlined" label={`${sec.perguntas.length} perguntas`} />
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
              etapa {i + 1}
            </Typography>
            <Tooltip title="Subir a etapa">
              <span>
                <IconButton size="small" disabled={i === 0} onClick={() => moveSecao(i, -1)}>
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Descer a etapa">
              <span>
                <IconButton size="small" disabled={i === secoes.length - 1} onClick={() => moveSecao(i, 1)}>
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Apagar a etapa inteira">
              <IconButton size="small" color="error" onClick={() => apagaSecao(i)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={aberta === i ? "Fechar a etapa" : "Abrir e editar as perguntas"}>
              <IconButton size="small" onClick={() => alterna(i)}>
                <ExpandMoreIcon fontSize="small"
                  sx={{ transition: "transform .2s", transform: aberta === i ? "rotate(180deg)" : "none" }} />
              </IconButton>
            </Tooltip>
          </Stack>

          <Collapse in={aberta === i} unmountOnExit>
            <Box sx={{ px: 2, pb: 2, pt: 1 }}>
            <Stack spacing={2}>
              <TextField label="Título da etapa" size="small" fullWidth value={sec.titulo}
                onChange={(e) => mudaSecao(i, "titulo", e.target.value)} />
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
                    {p.tipo === "arquivos" && (
                      <TextField label="Pasta na galeria (opcional)" size="small" fullWidth value={p.pasta || ""}
                        onChange={(e) => mudaPergunta(i, j, "pasta", e.target.value)}
                        placeholder="Ex.: Fotos do espaço"
                        helperText="Cria uma subpasta dentro de 'Enviado pelo cliente'. Deixe em branco e cai tudo junto — com pastas diferentes, duas perguntas de envio não se misturam." />
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
                    {p.tipo === "visual" && (
                      <OpcoesVisuais p={p} onMuda={(campo, valor) => mudaPergunta(i, j, campo, valor)} />
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
            </Box>
          </Collapse>
        </Box>
      ))}
      <Button startIcon={<AddIcon />} onClick={novaSecao} sx={{ alignSelf: "flex-start" }}>Nova etapa</Button>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// OPÇÕES EM IMAGEM.
//
// Descrever estilo por escrito quase nunca funciona: "moderno" quer dizer uma
// coisa para ela e outra para o cliente. Mostrar três imagens e perguntar qual
// combina — e POR QUÊ — resolve em trinta segundos o que uma reunião inteira
// não resolve. O "por quê" é a parte que vira direção de arte.
// ---------------------------------------------------------------------------
function OpcoesVisuais({ p, onMuda }) {
  const opcoes = p.opcoes_visuais || [];
  const [subindo, setSubindo] = useState(false);
  const [erro, setErro] = useState("");

  async function subir(lista) {
    const arquivos = Array.from(lista || []).filter((f) => f.type.startsWith("image/"));
    if (!arquivos.length) return;
    setSubindo(true); setErro("");
    const novas = [...opcoes];
    try {
      for (const f of arquivos.slice(0, 12 - opcoes.length)) {
        const fd = new FormData();
        fd.append("file", f);
        // multipart precisa ser dito na mão: o cliente HTTP manda JSON por padrão,
        // e sem isto o servidor recebe o pedido sem arquivo nenhum.
        const { data } = await api.post("/briefing-midia", fd,
          { headers: { "Content-Type": "multipart/form-data" } });
        // A legenda nasce do nome do arquivo: "paleta-terrosa.jpg" vira
        // "paleta terrosa". Ela ajusta se quiser, mas quase nunca precisa.
        const legenda = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 80);
        novas.push({ token: data.token, legenda });
      }
      onMuda("opcoes_visuais", novas);
    } catch (e) {
      setErro(e.response?.data?.error || "Não consegui subir a imagem.");
    } finally { setSubindo(false); }
  }

  async function tirar(k) {
    const alvo = opcoes[k];
    onMuda("opcoes_visuais", opcoes.filter((_, x) => x !== k));
    // A imagem some do servidor junto: opção tirada não deixa lixo pago atrás.
    try { await api.delete(`/briefing-midia/${alvo.token}`); } catch { /* o registro já saiu da pergunta */ }
  }

  return (
    <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "action.hover" }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
        Suba as imagens que o cliente vai ver. Ele escolhe e escreve por que escolheu — é essa
        frase que vira direção de arte. Até 12 imagens.
      </Typography>

      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1.5, mb: 1.5 }}>
        {opcoes.map((o, k) => (
          <Box key={o.token} sx={{ width: 132 }}>
            <Box sx={{ position: "relative" }}>
              <Box component="img" src={`/api/briefing-midia/${o.token}`} alt={o.legenda || "opção"}
                sx={{ width: 132, height: 132, objectFit: "cover", borderRadius: 1.5, display: "block",
                      border: 1, borderColor: "divider" }} />
              <IconButton size="small" onClick={() => tirar(k)}
                sx={{ position: "absolute", top: 4, right: 4, bgcolor: "background.paper",
                      "&:hover": { bgcolor: "background.paper" } }}>
                <DeleteIcon fontSize="small" color="error" />
              </IconButton>
            </Box>
            <TextField size="small" fullWidth variant="standard" placeholder="Legenda" value={o.legenda || ""}
              onChange={(e) => onMuda("opcoes_visuais",
                opcoes.map((x, y) => (y === k ? { ...x, legenda: e.target.value } : x)))}
              sx={{ mt: 0.5, "& input": { fontSize: 13 } }} />
          </Box>
        ))}
        {opcoes.length < 12 && (
          <Button component="label" disabled={subindo}
            sx={{ width: 132, height: 132, borderRadius: 1.5, border: "2px dashed",
                  borderColor: "divider", flexDirection: "column", color: "text.secondary" }}>
            <AddIcon />
            <Typography variant="caption">{subindo ? "Subindo…" : "Imagem"}</Typography>
            <input hidden type="file" accept="image/*" multiple
              onChange={(e) => { subir(e.target.files); e.target.value = ""; }} />
          </Button>
        )}
      </Stack>

      {erro && <Alert severity="warning" sx={{ mb: 1.5 }}>{erro}</Alert>}

      <Stack spacing={1}>
        <FormControlLabel control={
          <Switch size="small" checked={Boolean(p.multipla)}
            onChange={(e) => onMuda("multipla", e.target.checked)} />
        } label={<Typography variant="caption">pode escolher mais de uma</Typography>} />
        <FormControlLabel control={
          <Switch size="small" checked={p.pede_porque !== false}
            onChange={(e) => onMuda("pede_porque", e.target.checked)} />
        } label={<Typography variant="caption">pedir que ele escreva por quê</Typography>} />
        {p.pede_porque !== false && (
          <TextField size="small" fullWidth label="Como perguntar o porquê"
            value={p.porque_label || ""} placeholder="Por que você escolheu?"
            onChange={(e) => onMuda("porque_label", e.target.value)} />
        )}
      </Stack>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// O QUESTIONÁRIO SÓ DESTE CLIENTE.
//
// O modelo da casa serve para a maioria — mas um escritório de advocacia e uma
// pastelaria não respondem às mesmas coisas. Aqui ela monta as perguntas de UM
// cliente, que ficam guardadas com ele. O padrão continua intacto: voltar para
// ele é um clique, e é o que vale enquanto ela não mexer em nada.
// ---------------------------------------------------------------------------
function PerguntasDoCliente({ alvo, onFechar, onSalvo }) {
  const [secoes, setSecoes] = useState(null);
  const [proprias, setProprias] = useState(false);
  const [origem, setOrigem] = useState(null);
  const [formId, setFormId] = useState("");
  const [formularios, setFormularios] = useState([]);
  const [camposCliente, setCamposCliente] = useState([]);
  const [destinosCentral, setDestinosCentral] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const carregar = () => api.get(`/briefings/${alvo.briefing.id}/perguntas`).then(({ data }) => {
    setSecoes(data.secoes);
    setProprias(data.proprias);
    setOrigem(data.origem || null);
    setFormId(data.form_id || "");
    setFormularios(data.formularios || []);
    setCamposCliente(data.campos_cliente || []);
    setDestinosCentral(data.destinos_central || []);
  });

  useEffect(() => {
    if (!alvo) { setSecoes(null); return; }
    setErro("");
    carregar().catch((e) => setErro(e.response?.data?.error || "Não consegui abrir as perguntas."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo]);

  // TROCAR DE FORMULÁRIO. É o caminho curto: em vez de reescrever as perguntas
  // deste cliente, ela manda o formulário do ramo dele.
  async function trocarFormulario(novo) {
    try {
      await api.put(`/briefings/${alvo.briefing.id}/formulario`, { form_id: novo || null });
      await carregar();
    } catch (e) { setErro(e.response?.data?.error || "Não consegui trocar o formulário."); }
  }

  async function salvar() {
    setSalvando(true); setErro("");
    try {
      await api.put(`/briefings/${alvo.briefing.id}/perguntas`, { secoes });
      onSalvo(`${alvo.client_name} agora tem um questionário próprio.`);
    } catch (e) { setErro(e.response?.data?.error || "Não consegui salvar."); }
    finally { setSalvando(false); }
  }

  async function voltarAoPadrao() {
    if (!window.confirm(`Descartar as perguntas escritas só para ${alvo.client_name}? `
      + "Ele volta a responder o formulário escolhido acima — ou o padrão da casa.")) return;
    try {
      await api.delete(`/briefings/${alvo.briefing.id}/perguntas`);
      onSalvo(`${alvo.client_name} voltou ao questionário padrão.`);
    } catch (e) { setErro(e.response?.data?.error || "Não consegui voltar ao padrão."); }
  }

  return (
    <Dialog open={Boolean(alvo)} onClose={onFechar} fullWidth maxWidth="md">
      <DialogTitle>Perguntas de {alvo?.client_name}</DialogTitle>
      <DialogContent dividers>
        <TextField select size="small" fullWidth label="Formulário deste cliente" sx={{ mb: 2 }}
          value={proprias ? "__proprio" : formId}
          onChange={(e) => trocarFormulario(e.target.value === "__proprio" ? formId : e.target.value)}
          helperText="Trocar aqui é o caminho curto: manda o formulário do ramo dele, sem reescrever pergunta nenhuma.">
          <MenuItem value="">Padrão da casa</MenuItem>
          {formularios.map((x) => (
            <MenuItem key={x.id} value={x.id}>{x.name} · {x.perguntas} perguntas</MenuItem>
          ))}
          {proprias && <MenuItem value="__proprio">Perguntas escritas só para ele</MenuItem>}
        </TextField>

        <Alert severity={proprias ? "info" : "warning"} sx={{ mb: 2 }}>
          {proprias
            ? "Este cliente tem perguntas escritas só para ele. Mudar um formulário ou o padrão da casa não mexe mais nele."
            : `Hoje ele responde ${origem?.tipo === "formulario" ? `o formulário "${origem.nome}"` : "o padrão da casa"}. `
              + "Salvar aqui cria uma cópia só dele — a partir daí, mexer naquele formulário não altera mais este cliente."}
        </Alert>
        {erro && <Alert severity="error" sx={{ mb: 2 }}>{erro}</Alert>}
        {!secoes ? <LinearProgress /> : (
          <EditorDePerguntas secoes={secoes} onChange={setSecoes}
            camposCliente={camposCliente} destinosCentral={destinosCentral} />
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        {proprias ? (
          <Button color="error" startIcon={<RestartAltIcon />} onClick={voltarAoPadrao} sx={{ mr: "auto" }}>
            Descartar e usar um formulário
          </Button>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ mr: "auto", ml: 1 }}>
            Você está partindo {origem?.tipo === "formulario" ? `do formulário "${origem.nome}"` : "do padrão da casa"} — é só editar o que for diferente.
          </Typography>
        )}
        <Button onClick={onFechar}>Cancelar</Button>
        <Button variant="contained" onClick={salvar} disabled={salvando || !secoes}>
          {salvando ? "Salvando…" : "Salvar para este cliente"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** O que o cliente escolheu numa pergunta em imagem — e por quê. */
function EscolhaVisual({ p, respostas }) {
  const marcadas = String(respostas[p.id] || "").split(",").map((x) => x.trim()).filter(Boolean);
  const escolhidas = (p.opcoes_visuais || []).filter((o, i) => marcadas.includes(o.legenda || `Opção ${i + 1}`));
  const porque = String(respostas[`${p.id}__porque`] || "").trim();
  return (
    <>
      {escolhidas.length > 0 && (
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, mt: 0.75 }}>
          {escolhidas.map((o) => (
            <Box key={o.token} component="img" src={`/api/briefing-midia/${o.token}`} alt={o.legenda || ""}
              sx={{ width: 84, height: 84, objectFit: "cover", borderRadius: 1.5, border: 1, borderColor: "divider" }} />
          ))}
        </Stack>
      )}
      {porque && (
        <Box sx={{ mt: 1, pl: 1.5, borderLeft: 3, borderColor: "primary.main" }}>
          <Typography variant="caption" color="text.secondary">
            {p.porque_label || "Por que escolheu"}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{porque}</Typography>
        </Box>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// O NOME DO FORMULÁRIO.
//
// Serve para as três portas: criar do zero, duplicar um que já existe e
// renomear. É o nome que ela vai procurar depois, na hora de mandar para um
// cliente — então ele é obrigatório e vem antes de qualquer pergunta.
// ---------------------------------------------------------------------------
function NomeDoFormulario({ alvo, onFechar, onConfirmar }) {
  const [nome, setNome] = useState("");
  useEffect(() => { if (alvo) setNome(alvo.nome || ""); }, [alvo]);

  const renomeia = Boolean(alvo?.renomeia);
  const copia = Boolean(alvo?.copiar_de) && !renomeia;

  return (
    <Dialog open={Boolean(alvo)} onClose={onFechar} fullWidth maxWidth="xs">
      <DialogTitle>
        {renomeia ? "Renomear formulário" : copia ? "Duplicar formulário" : "Novo formulário"}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {renomeia
            ? "O nome é como você acha este formulário na hora de mandar para um cliente."
            : copia
              ? "O novo nasce com as mesmas perguntas do que você está editando. A partir daí, são dois formulários separados."
              : "Ele nasce com as perguntas do padrão da casa — é só tirar e acrescentar o que for diferente."}
        </Typography>
        <TextField autoFocus fullWidth size="small" label="Nome do formulário"
          placeholder="Ex.: Advocacia, Alimentação, Clínica"
          value={nome} onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && nome.trim()) onConfirmar(nome.trim()); }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onFechar}>Cancelar</Button>
        <Button variant="contained" disabled={!nome.trim()} onClick={() => onConfirmar(nome.trim())}>
          {renomeia ? "Renomear" : "Criar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// O TEXTO DE BOAS-VINDAS.
//
// A primeira tela que o cliente vê, antes de qualquer pergunta. Serve tanto
// para o padrão da casa quanto para um formulário com nome — um convite de
// rebranding não abre com as mesmas palavras de um onboarding mensal.
// ---------------------------------------------------------------------------
function EditorDeBoasVindas({ welcome, onChange }) {
  const muda = (campo, valor) => onChange({ ...welcome, [campo]: valor });
  return (
    <>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Texto de boas-vindas</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
        É a primeira tela, antes de qualquer pergunta. Use <code>{"{agencia}"}</code> para o nome do
        seu escritório e <code>{"{cliente}"}</code> para o nome de quem vai responder.
      </Typography>
      <Stack spacing={2}>
        <TextField label="Título" fullWidth size="small" value={welcome.titulo}
          onChange={(e) => muda("titulo", e.target.value)} />
        {welcome.paragrafos.map((t, i) => (
          <TextField key={i} label={`Parágrafo ${i + 1}`} fullWidth size="small" multiline minRows={2} value={t}
            onChange={(e) => {
              const ps = [...welcome.paragrafos]; ps[i] = e.target.value;
              muda("paragrafos", ps);
            }} />
        ))}
        <Stack direction="row" spacing={1}>
          <Button size="small" startIcon={<AddIcon />}
            onClick={() => muda("paragrafos", [...welcome.paragrafos, ""])}>
            Mais um parágrafo
          </Button>
          {welcome.paragrafos.length > 1 && (
            <Button size="small" color="error"
              onClick={() => muda("paragrafos", welcome.paragrafos.slice(0, -1))}>
              Tirar o último
            </Button>
          )}
        </Stack>
        <TextField label="Texto do botão" size="small" sx={{ maxWidth: 260 }} value={welcome.botao}
          onChange={(e) => muda("botao", e.target.value)} />
      </Stack>
    </>
  );
}

// ---------------------------------------------------------------------------
// O FIM DO FORMULÁRIO.
//
// Depois de responder, o cliente via sempre os mesmos dois passos: assinar o
// contrato e criar o acesso à Área do Cliente. Mas nem todo onboarding termina
// assim — um orçamento não vira contrato, e um trabalho pontual não precisa de
// área nenhuma. Quando um passo está desligado, ele não aparece para o cliente
// e a porta fica fechada no servidor também.
// ---------------------------------------------------------------------------
function FimDoFormulario({ gera, acesso, onMuda }) {
  const nenhum = !gera && !acesso;
  return (
    <Card><CardContent>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>O que acontece depois que ele responde</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
        São os passos que aparecem na última tela do cliente. Desligue o que não fizer sentido
        para este formulário.
      </Typography>

      <Stack spacing={2.5}>
        <Box>
          <FormControlLabel control={
            <Switch checked={Boolean(gera)} onChange={(e) => onMuda("gera_contrato", e.target.checked)} />
          } label="Gerar o contrato e mandar para assinatura" />
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", pl: 6 }}>
            {gera
              ? "Assim que ele terminar, o contrato nasce pronto com os dados que ele acabou de dar, e ele assina ali mesmo."
              : "Nenhum contrato é gerado por este formulário. Serve para orçamento, sondagem ou quando o contrato já foi assinado antes."}
          </Typography>
        </Box>

        <Box>
          <FormControlLabel control={
            <Switch checked={Boolean(acesso)} onChange={(e) => onMuda("cria_acesso", e.target.checked)} />
          } label="Oferecer o acesso à Área do Cliente" />
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", pl: 6 }}>
            {acesso
              ? "Ele escolhe o nome de acesso e a senha na hora, e já entra para aprovar conteúdo e mandar material."
              : "Este formulário não abre Área do Cliente. Você ainda pode criar o acesso à mão depois, no cadastro dele."}
          </Typography>
        </Box>

        {nenhum && (
          <Alert severity="info">
            Sem nenhum dos dois, a última tela é só o agradecimento — o que faz sentido quando o
            formulário existe só para você colher as respostas.
          </Alert>
        )}
      </Stack>
    </CardContent></Card>
  );
}

/** O que este formulário faz, em uma frase — para a dica da estante. */
function resumoDaJornada(f) {
  const partes = [`${f.perguntas} perguntas`];
  if (f.boas_vindas_proprias) partes.push("boas-vindas próprias");
  partes.push(f.gera_contrato ? "vai para assinatura" : "sem contrato");
  partes.push(f.cria_acesso ? "abre a Área do Cliente" : "sem Área do Cliente");
  return partes.join(" · ");
}
