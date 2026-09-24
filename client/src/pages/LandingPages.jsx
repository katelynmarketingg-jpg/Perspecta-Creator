import { useEffect, useState } from "react";
import {
  Box, Card, CardContent, Typography, Stack, Button, IconButton, Chip, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, MenuItem, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip,
  LinearProgress, Switch, FormControlLabel,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import DownloadIcon from "@mui/icons-material/Download";
import PaidIcon from "@mui/icons-material/Paid";
import api from "../api/client.js";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { currency } from "../utils.js";
import { pdfDeEntrega } from "../lp-entrega.js";
import Acessos from "../components/Acessos.jsx";

// ---------------------------------------------------------------------------
// LANDING PAGES — a venda única que vira obrigação anual.
//
// A tela existe por um motivo só: não deixar uma renovação passar. Por isso o
// relatório vem ANTES da lista, e a lista abre no vencimento mais próximo.
// Quem vence nos próximos 60 dias é o trabalho da semana; o resto é arquivo.
// ---------------------------------------------------------------------------
const SITUACAO = {
  em_dia: { label: "Em dia", cor: "success" },
  avisado: { label: "Aviso enviado", cor: "info" },
  pago: { label: "Pago", cor: "success" },
  atrasado: { label: "Atrasado", cor: "error" },
  tolerancia_vencida: { label: "Fora da tolerância", cor: "error" },
  cancelado: { label: "Cancelada", cor: "default" },
};
const PAGAMENTOS = [
  { v: "pendente", label: "Pendente" },
  { v: "parcial", label: "Parcial" },
  { v: "pago", label: "Pago" },
];
const VAZIA = {
  client_id: "", nicho: "", valor: 1000, forma_pagamento: "", parcelas: 1,
  status_pagamento: "pendente", contrato_assinado_em: "", publicado_em: "",
  endereco: "", contrato_url: "", entrega_url: "", valor_renovacao: 300,
  dominio_vence_em: "", vercel_projeto: "", vercel_url: "", status: "ativa", observacoes: "",
};

const dataBR = (d) => (d ? d.split("-").reverse().join("/") : "—");

/** "vence em 12 dias" / "venceu há 3 dias" — o que ela precisa ler de relance. */
function prazo(dias) {
  if (dias === null || dias === undefined) return "—";
  if (dias === 0) return "vence hoje";
  return dias > 0 ? `em ${dias} dia${dias > 1 ? "s" : ""}` : `há ${-dias} dia${dias < -1 ? "s" : ""}`;
}

export default function LandingPages() {
  const [lps, setLps] = useState(null);
  const [relatorio, setRelatorio] = useState(null);
  const [clients, setClients] = useState([]);
  const [msg, setMsg] = useState(null);
  const [draft, setDraft] = useState(null);     // cadastro/edição
  const [ficha, setFicha] = useState(null);     // a LP aberta
  const [nicho, setNicho] = useState("");
  const [agencia, setAgencia] = useState({});   // nome e contatos, para o PDF

  const carregar = () => {
    api.get("/landing").then((r) => setLps(r.data)).catch(() => setLps([]));
    api.get("/landing/relatorio", { params: { nicho: nicho || undefined } })
      .then((r) => setRelatorio(r.data)).catch(() => {});
  };
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [nicho]);
  useEffect(() => {
    api.get("/clients").then((r) => setClients(r.data)).catch(() => {});
    api.get("/branding").then((r) => setAgencia({ nome: r.data?.name })).catch(() => {});
  }, []);

  async function salvar() {
    try {
      const corpo = { ...draft };
      if (draft.id) await api.put(`/landing/${draft.id}`, corpo);
      else await api.post("/landing", corpo);
      setDraft(null); carregar();
      setMsg({ t: "success", m: "Salvo. A renovação já está agendada a partir da data de publicação." });
    } catch (e) { setMsg({ t: "error", m: e.response?.data?.error || "Não consegui salvar." }); }
  }

  async function abrir(lp) {
    try { setFicha((await api.get(`/landing/${lp.id}`)).data); }
    catch { setMsg({ t: "error", m: "Não consegui abrir essa landing page." }); }
  }

  const exportar = () => {
    const linhas = [
      ["Cliente", "Nicho", "Site", "Publicado", "Próxima renovação", "Dias", "Situação", "Valor renovação", "Valor da venda"],
      ...(lps || []).map((l) => [
        l.client_name, l.nicho || "", l.endereco || "", l.publicado_em || "",
        l.vence_em || "", l.dias_para_vencer ?? "", SITUACAO[l.situacao]?.label || l.situacao,
        l.proxima_renovacao?.valor ?? l.valor_renovacao, l.valor,
      ]),
    ];
    // Ponto e vírgula: é o que o Excel em português abre sem perguntar nada.
    const csv = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `landing-pages-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader title="Landing Pages"
        subtitle="Venda única, renovação todo ano — e o aviso antes do vencimento"
        action={<Button variant="contained" startIcon={<AddIcon />}
          onClick={() => setDraft({ ...VAZIA })}>Nova landing page</Button>} />

      {msg && <Alert severity={msg.t} sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg.m}</Alert>}

      <Relatorio dados={relatorio} nicho={nicho} onNicho={setNicho} onExportar={exportar} />

      {lps === null ? <LinearProgress /> : lps.length === 0 ? (
        <EmptyState message="Nenhuma landing page cadastrada ainda."
          action={<Button onClick={() => setDraft({ ...VAZIA })}>Cadastrar a primeira</Button>} />
      ) : (
        <Card sx={{ mt: 2.5 }}><CardContent>
          <TableContainer>
            <Table size="small">
              <TableHead><TableRow>
                <TableCell>Cliente</TableCell>
                <TableCell>Site</TableCell>
                <TableCell>Publicado</TableCell>
                <TableCell>Próxima renovação</TableCell>
                <TableCell align="right">Situação</TableCell>
              </TableRow></TableHead>
              <TableBody>
                {lps.map((l) => {
                  const s = SITUACAO[l.situacao] || SITUACAO.em_dia;
                  // Amarelo quando está dentro da janela de aviso: é o que ela
                  // precisa ver antes de virar vermelho.
                  const cor = l.situacao === "em_dia" && l.dias_para_vencer !== null
                    && l.dias_para_vencer <= (relatorio?.aviso_lembrete ?? 45) ? "warning" : s.cor;
                  return (
                    <TableRow key={l.id} hover sx={{ cursor: "pointer" }} onClick={() => abrir(l)}>
                      <TableCell>
                        <Typography sx={{ fontWeight: 600 }}>{l.client_name}</Typography>
                        {l.nicho && <Typography variant="caption" color="text.secondary">{l.nicho}</Typography>}
                      </TableCell>
                      <TableCell>
                        {l.endereco ? (
                          <Box component="a" href={`https://${l.endereco.replace(/^https?:\/\//, "")}`}
                            target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                            sx={{ color: "primary.main", textDecoration: "none" }}>
                            {l.endereco}
                          </Box>
                        ) : <Typography variant="caption" color="text.secondary">—</Typography>}
                      </TableCell>
                      <TableCell><Typography variant="body2">{dataBR(l.publicado_em)}</Typography></TableCell>
                      <TableCell>
                        <Typography variant="body2">{dataBR(l.vence_em)}</Typography>
                        <Typography variant="caption" color="text.secondary">{prazo(l.dias_para_vencer)}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Chip size="small" label={s.label} color={cor} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent></Card>
      )}

      <FormularioLP aberto={draft} clients={clients} onMuda={setDraft}
        onFechar={() => setDraft(null)} onSalvar={salvar} />

      <FichaLP lp={ficha} agencia={agencia} onFechar={() => setFicha(null)}
        onRecarregar={(nova) => { setFicha(nova); carregar(); }}
        onErro={(m) => setMsg({ t: "error", m })}
        onEditar={(l) => { setFicha(null); setDraft({ ...l }); }} />
    </>
  );
}

// ---------------------------------------------------------------------------
// O RELATÓRIO — fica no topo porque é ele que diz o que fazer hoje.
// ---------------------------------------------------------------------------
function Relatorio({ dados, nicho, onNicho, onExportar }) {
  if (!dados) return null;
  const cartao = (rotulo, valor, detalhe, cor) => (
    <Card variant="outlined" sx={{ flex: "1 1 200px", minWidth: 190 }}>
      <CardContent sx={{ py: 1.75, "&:last-child": { pb: 1.75 } }}>
        <Typography variant="caption" color="text.secondary">{rotulo}</Typography>
        <Typography sx={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2, color: cor }}>{valor}</Typography>
        {detalhe && <Typography variant="caption" color="text.secondary">{detalhe}</Typography>}
      </CardContent>
    </Card>
  );
  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1.5 }}>
        {cartao(`Renovações em ${dados.dias} dias`, dados.proximas.length,
          dados.proximas.length ? "quem você precisa chamar" : "nada vencendo por enquanto",
          dados.proximas.length ? "warning.main" : undefined)}
        {cartao("Atrasadas", dados.atrasadas.length,
          dados.atrasadas.length ? "passou do vencimento sem pagar" : "nenhuma",
          dados.atrasadas.length ? "error.main" : undefined)}
        {cartao("Vendas no mês", dados.vendas_do_mes.quantidade, currency(dados.vendas_do_mes.valor))}
        {cartao("Vendas no ano", dados.vendas_do_ano.quantidade, currency(dados.vendas_do_ano.valor))}
        {cartao("Renovações previstas", currency(dados.receita_prevista_12m), "próximos 12 meses")}
        {cartao("No ar", dados.no_ar, dados.canceladas ? `${dados.canceladas} cancelada(s)` : "todas ativas")}
      </Stack>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: "wrap", gap: 1 }}>
        <TextField select size="small" label="Nicho" value={nicho} onChange={(e) => onNicho(e.target.value)}
          sx={{ minWidth: 180 }}>
          <MenuItem value="">Todos</MenuItem>
          {dados.nichos.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
        </TextField>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<DownloadIcon />} onClick={onExportar}>Exportar planilha</Button>
      </Stack>

      {dados.atrasadas.length > 0 && (
        <Alert severity="error">
          <b>{dados.atrasadas.length} renovação(ões) atrasada(s):</b>{" "}
          {dados.atrasadas.map((l) => `${l.client_name} (venceu ${dataBR(l.vence_em)})`).join(" · ")}
        </Alert>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// O CADASTRO DA VENDA.
// ---------------------------------------------------------------------------
function FormularioLP({ aberto, clients, onMuda, onFechar, onSalvar }) {
  if (!aberto) return null;
  const set = (campo) => (e) => onMuda({ ...aberto, [campo]: e.target.value });
  const campo = (rotulo, nome, extra = {}) => (
    <TextField size="small" fullWidth label={rotulo} value={aberto[nome] ?? ""}
      onChange={set(nome)} {...extra} />
  );
  return (
    <Dialog open onClose={onFechar} fullWidth maxWidth="sm">
      <DialogTitle>{aberto.id ? "Editar landing page" : "Nova landing page"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField select size="small" fullWidth label="Cliente" value={aberto.client_id || ""}
            onChange={set("client_id")} disabled={Boolean(aberto.id)}
            helperText={aberto.id ? "O cliente não muda depois de cadastrado." : " "}>
            {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
          {campo("Nicho", "nicho", { placeholder: "Advocacia, Odontologia…" })}

          <Divider textAlign="left"><Typography variant="caption" color="text.secondary">A venda</Typography></Divider>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            {campo("Valor da venda", "valor", { type: "number" })}
            {campo("Parcelas", "parcelas", { type: "number", inputProps: { min: 1 } })}
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            {campo("Forma de pagamento", "forma_pagamento", { placeholder: "Pix, cartão…" })}
            <TextField select size="small" fullWidth label="Pagamento" value={aberto.status_pagamento}
              onChange={set("status_pagamento")}>
              {PAGAMENTOS.map((p) => <MenuItem key={p.v} value={p.v}>{p.label}</MenuItem>)}
            </TextField>
          </Stack>

          <Divider textAlign="left"><Typography variant="caption" color="text.secondary">O site</Typography></Divider>
          {campo("Endereço do site", "endereco", { placeholder: "advogadomarcelolemos.com.br" })}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            {campo("Contrato assinado em", "contrato_assinado_em", { type: "date", InputLabelProps: { shrink: true } })}
            {campo("Publicado em", "publicado_em", {
              type: "date", InputLabelProps: { shrink: true },
              helperText: "É esta data que marca o ano da renovação.",
            })}
          </Stack>

          <Divider textAlign="left"><Typography variant="caption" color="text.secondary">A renovação</Typography></Divider>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            {campo("Valor da renovação", "valor_renovacao", { type: "number" })}
            {campo("Domínio vence em (Registro.br)", "dominio_vence_em", {
              type: "date", InputLabelProps: { shrink: true },
              helperText: "Confira no painel: pode ser diferente da publicação.",
            })}
          </Stack>

          <Divider textAlign="left"><Typography variant="caption" color="text.secondary">Links</Typography></Divider>
          {campo("Link do contrato assinado", "contrato_url")}
          {campo("Link do PDF de entrega", "entrega_url")}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            {campo("Projeto na Vercel", "vercel_projeto")}
            {campo("Link na Vercel", "vercel_url")}
          </Stack>
          {campo("Observações", "observacoes", { multiline: true, minRows: 2 })}

          {aberto.id && (
            <FormControlLabel control={
              <Switch checked={aberto.status === "cancelada"}
                onChange={(e) => onMuda({ ...aberto, status: e.target.checked ? "cancelada" : "ativa" })} />
            } label={<Typography variant="body2">Site cancelado (sai da fila de renovação)</Typography>} />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onFechar}>Cancelar</Button>
        <Button variant="contained" onClick={onSalvar} disabled={!aberto.client_id}>Salvar</Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// A FICHA — tudo daquele site num lugar só.
// ---------------------------------------------------------------------------
function FichaLP({ lp, agencia, onFechar, onRecarregar, onErro, onEditar }) {
  const [copiado, setCopiado] = useState(false);
  const [novaAlteracao, setNovaAlteracao] = useState(null);
  if (!lp) return null;

  const s = SITUACAO[lp.situacao] || SITUACAO.em_dia;

  async function copiarMensagem() {
    try {
      const { data } = await api.get(`/landing/${lp.id}/mensagem`);
      await navigator.clipboard.writeText(data.mensagem);
      setCopiado(true); setTimeout(() => setCopiado(false), 2500);
      // Copiar é o momento em que ela vai mandar: marca como avisada, e a
      // renovação sai da fila de "ainda não falei com ele".
      if (lp.proxima_renovacao && lp.proxima_renovacao.status === "em_dia") {
        const { data: nova } = await api.put(
          `/landing/${lp.id}/renovacao/${lp.proxima_renovacao.id}`, { status: "avisado" });
        onRecarregar({ ...nova, alteracoes: lp.alteracoes });
      }
    } catch (e) { onErro(e.response?.data?.error || "Não consegui copiar a mensagem."); }
  }

  async function marcarPaga() {
    if (!lp.proxima_renovacao) return;
    try {
      const { data } = await api.put(`/landing/${lp.id}/renovacao/${lp.proxima_renovacao.id}`, { status: "pago" });
      onRecarregar({ ...data, alteracoes: lp.alteracoes });
    } catch (e) { onErro(e.response?.data?.error || "Não consegui marcar como paga."); }
  }

  async function salvarAlteracao() {
    try {
      await api.post(`/landing/${lp.id}/alteracoes`, novaAlteracao);
      const { data } = await api.get(`/landing/${lp.id}`);
      setNovaAlteracao(null);
      onRecarregar(data);
    } catch (e) { onErro(e.response?.data?.error || "Não consegui salvar o pedido."); }
  }

  return (
    <Dialog open onClose={onFechar} fullWidth maxWidth="md">
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: "wrap", gap: 1 }}>
          {lp.client_name}
          <Chip size="small" label={s.label} color={s.cor} />
          {lp.nicho && <Chip size="small" variant="outlined" label={lp.nicho} />}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          {/* ---- a venda ---- */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>A venda</Typography>
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 3 }}>
              <Dado rotulo="Site" valor={lp.endereco} link={lp.endereco ? `https://${lp.endereco.replace(/^https?:\/\//, "")}` : null} />
              <Dado rotulo="Valor" valor={currency(lp.valor)} />
              <Dado rotulo="Pagamento" valor={`${PAGAMENTOS.find((p) => p.v === lp.status_pagamento)?.label || lp.status_pagamento}${lp.parcelas > 1 ? ` · ${lp.parcelas}x` : ""}${lp.forma_pagamento ? ` · ${lp.forma_pagamento}` : ""}`} />
              <Dado rotulo="Contrato assinado" valor={dataBR(lp.contrato_assinado_em)} />
              <Dado rotulo="Publicado" valor={dataBR(lp.publicado_em)} />
              <Dado rotulo="Domínio vence" valor={dataBR(lp.dominio_vence_em)} />
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap", gap: 1 }}>
              {lp.contrato_url && <Button size="small" startIcon={<OpenInNewIcon />} component="a"
                href={lp.contrato_url} target="_blank" rel="noreferrer">Contrato assinado</Button>}
              {lp.vercel_url && <Button size="small" startIcon={<OpenInNewIcon />} component="a"
                href={lp.vercel_url} target="_blank" rel="noreferrer">
                {lp.vercel_projeto || "Vercel"}</Button>}
            </Stack>
          </Box>

          {/* ---- renovações ---- */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Renovações</Typography>
            {lp.vence_em && (
              <Alert severity={lp.situacao === "atrasado" || lp.situacao === "tolerancia_vencida" ? "error"
                : lp.dias_para_vencer !== null && lp.dias_para_vencer <= 45 ? "warning" : "info"} sx={{ mb: 1.5 }}>
                Próxima renovação em <b>{dataBR(lp.vence_em)}</b> ({prazo(lp.dias_para_vencer)}) —{" "}
                {currency(lp.proxima_renovacao?.valor ?? lp.valor_renovacao)}
              </Alert>
            )}
            {lp.renovacoes.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Sem renovação agendada — preencha a data de publicação.
              </Typography>
            ) : (
              <TableContainer><Table size="small">
                <TableHead><TableRow>
                  <TableCell>Ano</TableCell><TableCell>Vence</TableCell>
                  <TableCell>Valor</TableCell><TableCell>Pago em</TableCell>
                  <TableCell align="right">Situação</TableCell>
                </TableRow></TableHead>
                <TableBody>
                  {lp.renovacoes.map((r) => {
                    const rs = SITUACAO[r.situacao] || SITUACAO.em_dia;
                    return (
                      <TableRow key={r.id}>
                        <TableCell>{r.ano}º</TableCell>
                        <TableCell>{dataBR(r.vence_em)}</TableCell>
                        <TableCell>{currency(r.valor)}</TableCell>
                        <TableCell>{dataBR(r.pago_em)}</TableCell>
                        <TableCell align="right"><Chip size="small" label={rs.label} color={rs.cor} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table></TableContainer>
            )}
          </Box>

          {/* ---- acessos ---- */}
          <Acessos clientId={lp.client_id} clienteNome={lp.client_name} />

          {/* ---- alterações ---- */}
          <Box>
            <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle2" sx={{ mr: "auto" }}>Pedidos de alteração</Typography>
              <Button size="small" startIcon={<AddIcon />}
                onClick={() => setNovaAlteracao({ descricao: "", valor: "", cobrado: false })}>
                Registrar pedido
              </Button>
            </Stack>
            {(lp.alteracoes || []).length === 0 ? (
              <Typography variant="body2" color="text.secondary">Nenhum pedido registrado.</Typography>
            ) : (
              <Stack spacing={1}>
                {lp.alteracoes.map((a) => (
                  <Stack key={a.id} direction="row" spacing={1.5} alignItems="center"
                    sx={{ p: 1, borderRadius: 1, bgcolor: "action.hover", flexWrap: "wrap" }}>
                    <Typography variant="caption" color="text.secondary">{dataBR(a.data)}</Typography>
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 180 }}>{a.descricao}</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{currency(a.valor)}</Typography>
                    <Chip size="small" variant="outlined" label={a.cobrado ? "cobrado" : "a cobrar"}
                      color={a.cobrado ? "success" : "warning"} />
                  </Stack>
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: 2.5, py: 2 }}>
        <Button size="small" startIcon={<PictureAsPdfIcon />} onClick={() => pdfDeEntrega(lp, agencia)}>
          Gerar PDF de entrega
        </Button>
        <Button size="small" startIcon={<ContentCopyIcon />} onClick={copiarMensagem}>
          {copiado ? "Copiada!" : "Copiar mensagem de renovação"}
        </Button>
        {lp.proxima_renovacao && (
          <Button size="small" startIcon={<PaidIcon />} color="success" onClick={marcarPaga}>
            Marcar renovação como paga
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={() => onEditar(lp)}>Editar</Button>
        <Button onClick={onFechar}>Fechar</Button>
      </DialogActions>

      {/* pedido de alteração */}
      <Dialog open={Boolean(novaAlteracao)} onClose={() => setNovaAlteracao(null)} fullWidth maxWidth="xs">
        <DialogTitle>Registrar pedido de alteração</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField size="small" fullWidth label="O que foi pedido" multiline minRows={2}
              value={novaAlteracao?.descricao || ""}
              onChange={(e) => setNovaAlteracao((a) => ({ ...a, descricao: e.target.value }))} />
            <TextField size="small" fullWidth label="Valor cobrado" type="number"
              value={novaAlteracao?.valor ?? ""}
              onChange={(e) => setNovaAlteracao((a) => ({ ...a, valor: e.target.value }))} />
            <FormControlLabel control={
              <Switch checked={Boolean(novaAlteracao?.cobrado)}
                onChange={(e) => setNovaAlteracao((a) => ({ ...a, cobrado: e.target.checked }))} />
            } label={<Typography variant="body2">já cobrado</Typography>} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNovaAlteracao(null)}>Cancelar</Button>
          <Button variant="contained" onClick={salvarAlteracao}
            disabled={!novaAlteracao?.descricao?.trim()}>Salvar</Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}

function Dado({ rotulo, valor, link }) {
  return (
    <Box sx={{ minWidth: 140 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{rotulo}</Typography>
      {link ? (
        <Box component="a" href={link} target="_blank" rel="noreferrer"
          sx={{ color: "primary.main", textDecoration: "none", fontSize: 14 }}>{valor}</Box>
      ) : (
        <Typography variant="body2">{valor || "—"}</Typography>
      )}
    </Box>
  );
}
