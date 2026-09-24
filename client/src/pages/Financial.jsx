import { Fragment, useEffect, useState } from "react";
import {
  Button, Card, Grid, Table, TableContainer, TableBody, TableCell, TableHead, TableRow, IconButton,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, MenuItem, Tabs, Tab, Divider,
  FormControlLabel, Switch, Typography, Box, CardContent,
} from "@mui/material";
import RepeatIcon from "@mui/icons-material/Repeat";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import DeleteIcon from "@mui/icons-material/Delete";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import PrintIcon from "@mui/icons-material/Print";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import Tooltip from "@mui/material/Tooltip";
import { Alert } from "@mui/material";
import api from "../api/client.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader, StatCard } from "../components/ui.jsx";
import { currency, formatDate } from "../utils.js";
import { receiptHtml, printReceipt } from "../receipt.js";
import { agrupaEmTopicos, valeAPenaAgrupar } from "../topicos.js";

const EMPTY = {
  type: "income", description: "", amount: "", client_id: "", category: "", status: "pending",
  due_date: "", recurring: false, recurring_day: "", months: 12, fixed: false, card: "",
};

// Intervalos de período. Abre no mês atual; dá para ampliar.
function periodoRange(chave) {
  const hoje = new Date();
  const ym = (d) => d.toISOString().slice(0, 10);
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  if (chave === "mes") return { from: ym(inicioMes), to: ym(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)) };
  if (chave === "proximo") return { from: ym(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1)), to: ym(new Date(hoje.getFullYear(), hoje.getMonth() + 2, 0)) };
  if (chave === "3m") return { from: ym(inicioMes), to: ym(new Date(hoje.getFullYear(), hoje.getMonth() + 3, 0)) };
  if (chave === "6m") return { from: ym(inicioMes), to: ym(new Date(hoje.getFullYear(), hoje.getMonth() + 6, 0)) };
  return {}; // tudo
}

const PERIODOS = [
  ["mes", "Este mês"], ["proximo", "Próximo mês"], ["3m", "Próximos 3 meses"],
  ["6m", "Próximos 6 meses"], ["all", "Tudo"],
];

export default function Financial() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [clients, setClients] = useState([]);
  const [renewals, setRenewals] = useState([]);
  const [tab, setTab] = useState("all");
  const [periodo, setPeriodo] = useState("mes"); // abre no mês atual
  const [mesCursor, setMesCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [flash, setFlash] = useState("");
  const [foraDaGeracao, setForaDaGeracao] = useState([]);  // quem não entrou na geração, e por quê
  // A PROJEÇÃO: o que entra menos o que sai, para ela saber se vai faltar.
  const [projecao, setProjecao] = useState(null);
  const [aReceber, setAReceber] = useState([]);   // o que me devem, sem data
  const [novaCobranca, setNovaCobranca] = useState(null);
  const [baixando, setBaixando] = useState(null);
  const [historico, setHistorico] = useState([]);  // o que já foi recebido da dívida em edição
  // 'todos' | 'impagaveis' | 'resto' — quando o dinheiro está curto ela quer ver
  // primeiro o que NÃO pode deixar de pagar, e só depois o que pode esperar.
  const [balao, setBalao] = useState("todos");
  // Juntar as despesas em tópicos ("Perspectiva", "Salário Katy") em vez de
  // vinte linhas soltas. Guarda a escolha — ela não precisa clicar todo dia.
  const [porTopico, setPorTopico] = useState(() => localStorage.getItem("fin:porTopico") !== "0");
  const [topicoAberto, setTopicoAberto] = useState({});
  const [gerarOpen, setGerarOpen] = useState(false);
  const [gerarMeses, setGerarMeses] = useState(12);
  const [parcial, setParcial] = useState(""); // valor do pagamento parcial
  // Recibo aberto para conferir/editar/baixar.
  const [recibo, setRecibo] = useState(null);
  const [reciboErro, setReciboErro] = useState("");
  const [reciboSalvando, setReciboSalvando] = useState(false);

  // Abre o recibo do lançamento: se ainda não existe (e está pago), gera na hora.
  async function abrirRecibo(row) {
    setReciboErro("");
    try {
      const existente = await api.get(`/receipts/entry/${row.id}`);
      if (existente.data) { setRecibo(existente.data); return; }
      const novo = await api.post(`/receipts/entry/${row.id}`);
      setRecibo(novo.data);
      load();
    } catch (e) {
      setReciboErro(e.response?.data?.error || "Não foi possível abrir o recibo.");
      setTimeout(() => setReciboErro(""), 6000);
    }
  }

  // Só a data é editável no dia a dia — o resto vem pronto do modelo.
  async function trocarData(data) {
    setRecibo((r) => ({ ...r, receipt_date: data }));
    if (!recibo?.id || !data) return;
    try {
      const { data: atualizado } = await api.put(`/receipts/${recibo.id}`, { receipt_date: data });
      setRecibo(atualizado);
    } catch (e) {
      setReciboErro(e.response?.data?.error || "Não foi possível salvar a data.");
    }
  }

  // Refaz o documento com o modelo de Serviços e os dados de hoje do cadastro,
  // mantendo o mesmo número. Serve para os recibos criados antes de mexer no modelo.
  async function refazerRecibo() {
    if (!recibo?.id) return;
    setReciboSalvando(true);
    try {
      const { data } = await api.post(`/receipts/${recibo.id}/refresh`);
      setRecibo(data);
    } catch (e) {
      setReciboErro(e.response?.data?.error || "Não foi possível refazer o recibo.");
    }
    setReciboSalvando(false);
  }

  async function lancarParcial() {
    const v = Number(parcial);
    if (!v || v <= 0 || !draft.id) return;
    const r = await api.put(`/financial/${draft.id}`, { pay: v });
    setDraft((d) => ({ ...d, ...r.data }));
    setParcial("");
    load();
  }

  // No modo "Este mês", o mês é o do cursor (dá para andar ◀ ▶). Nos demais, o range fixo.
  const ymd = (d) => d.toISOString().slice(0, 10);
  const rangeAtual = () => periodo === "mes"
    ? {
        from: ymd(new Date(mesCursor.getFullYear(), mesCursor.getMonth(), 1)),
        to: ymd(new Date(mesCursor.getFullYear(), mesCursor.getMonth() + 1, 0)),
      }
    : periodoRange(periodo);

  const load = () => {
    const params = rangeAtual();
    api.get("/financial", { params }).then((r) => setRows(r.data));
    api.get("/financial/summary", { params }).then((r) => setSummary(r.data));
    // A projeção é sempre de um MÊS: "vai sobrar" só faz sentido num mês.
    const mes = periodo === "mes"
      ? `${mesCursor.getFullYear()}-${String(mesCursor.getMonth() + 1).padStart(2, "0")}`
      : new Date().toISOString().slice(0, 7);
    api.get("/financial/projecao", { params: { month: mes } })
      .then((r) => setProjecao(r.data)).catch(() => setProjecao(null));
    api.get("/financial/a-receber").then((r) => setAReceber(r.data)).catch(() => {});
  };

  // O mesmo formulário cria e conserta: com id, edita; sem id, registra.
  async function salvarCobranca() {
    try {
      if (novaCobranca.id) {
        const r = await api.put(`/financial/a-receber/${novaCobranca.id}`, novaCobranca);
        if (r.data?.quitado) {
          setFlash("Como o total ficou menor do que você já recebeu, dei a dívida por quitada.");
          setTimeout(() => setFlash(""), 7000);
        }
      } else {
        await api.post("/financial/a-receber", novaCobranca);
      }
      setNovaCobranca(null); setHistorico([]); load();
    } catch (e) { setFlash(e.response?.data?.error || "Não consegui salvar."); }
  }

  // Abre a dívida para conserto, já com o histórico do que entrou. O valor volta
  // escrito do jeito daqui (1.800,00), não como o banco guarda (1800) — senão
  // ela reescreve o número toda vez que abre.
  async function editarCobranca(c) {
    const total = Number(c.total || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    setNovaCobranca({ id: c.id, quem: c.quem, total, nota: c.nota || "", client_id: c.client_id || "" });
    try {
      const r = await api.get(`/financial/a-receber/${c.id}/baixas`);
      setHistorico(r.data || []);
    } catch { setHistorico([]); }
  }

  // Lançou errado: some o valor daqui E a entrada que ele criou no Financeiro.
  async function desfazerBaixa(b) {
    if (!window.confirm(`Desfazer o recebimento de ${currency(b.valor)}?\n\nO valor volta a faltar na dívida e a entrada sai do Financeiro.`)) return;
    try {
      await api.delete(`/financial/a-receber/${novaCobranca.id}/baixa/${b.id}`);
      const r = await api.get(`/financial/a-receber/${novaCobranca.id}/baixas`);
      setHistorico(r.data || []);
      load();
    } catch (e) { setFlash(e.response?.data?.error || "Não consegui desfazer."); }
  }

  async function darBaixa() {
    try {
      await api.post(`/financial/a-receber/${baixando.cobranca.id}/baixa`,
        { valor: baixando.valor, recebido_em: baixando.recebido_em });
      setBaixando(null); load();
      setFlash("Recebimento lançado no Financeiro e abatido do que ele devia.");
      setTimeout(() => setFlash(""), 5000);
    } catch (e) { setFlash(e.response?.data?.error || "Não consegui lançar."); }
  }

  async function apagarCobranca(c) {
    if (!window.confirm(`Tirar "${c.quem}" da lista de quem te deve?`)) return;
    await api.delete(`/financial/a-receber/${c.id}`);
    load();
  }
  // Ao vivo: 'vFinancial' muda quando alguém lança/edita no financeiro.
  const vFinancial = useLiveVersion("financial");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [periodo, mesCursor, vFinancial]);
  useEffect(() => {
    // escopo "financeiro": traz os clientes atuais E os arquivados que ainda
    // têm parcela combinada para cair — até o fim do mês da data que ela
    // marcou ao encerrar. Depois disso eles somem daqui também.
    api.get("/clients", { params: { escopo: "financeiro" } }).then((r) => setClients(r.data));
    api.get("/financial/renewals").then((r) => setRenewals(r.data)).catch(() => {});
  }, []);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  // IMPAGÁVEIS: o que ela marcou como "não posso deixar de pagar". Os dois
  // balões somam o total — nada some, só muda de lado.
  const filtered = rows
    .filter((r) => tab === "all" || r.type === tab)
    .filter((r) => balao === "todos"
      || (balao === "impagaveis" ? !!r.impagavel : !r.impagavel));
  const quantosImpagaveis = rows.filter((r) => r.impagavel).length;
  // Quem vira tópico é DESPESA. Receita fica linha a linha — cada uma é de um
  // cliente, e é isso que ela quer ver. Vale na aba Todos também: foi lá que ela
  // reclamou do rolo de assinaturas.
  const despesas = filtered.filter((r) => r.type === "expense");
  const receitas = filtered.filter((r) => r.type !== "expense");
  const podeAgrupar = tab !== "income" && valeAPenaAgrupar(despesas);
  const agrupado = porTopico && podeAgrupar;
  const topicos = agrupado ? agrupaEmTopicos(despesas) : [];
  const alternaTopico = (nome) => setTopicoAberto((t) => ({ ...t, [nome]: !t[nome] }));
  function alternaAgrupar(v) {
    setPorTopico(v);
    localStorage.setItem("fin:porTopico", v ? "1" : "0");
  }

  // UMA LINHA DE LANÇAMENTO. Mora numa função porque agora ela aparece em dois
  // lugares: solta na lista e por dentro de um tópico (aí entra recuada).
  function linhaDeLancamento(f, dentroDeTopico = false) {
    return (
      <TableRow key={f.id} hover>
      <TableCell sx={dentroDeTopico ? { pl: 6 } : undefined}>
        {f.description}
        {f.recurring ? (
          <Chip size="small" variant="outlined" icon={<RepeatIcon sx={{ fontSize: 14 }} />}
            label="Mensal" sx={{ ml: 1, height: 20 }} />
        ) : null}
        {f.card ? (
          <Chip size="small" variant="outlined" label={`💳 ${f.card}`} sx={{ ml: 1, height: 20 }} />
        ) : null}
        {/* Essa linha não é digitada: ela é a soma do que foi marcado como pago
            nas Minhas Finanças. Mexer no valor aqui não adianta — o próximo
            check reescreve. Melhor dizer isso do que deixar ela descobrir. */}
        {/^Salário /.test(f.description || "") && f.category === f.description ? (
          <Tooltip title="Soma do que você marcou como pago em Minhas Finanças. Cada check de lá atualiza este valor.">
            <Chip size="small" color="info" variant="outlined" label="automático" sx={{ ml: 1, height: 20 }} />
          </Tooltip>
        ) : null}
      </TableCell>
      <TableCell>{f.client_name || "—"}</TableCell>
      <TableCell>{formatDate(f.due_date)}</TableCell>
      <TableCell>
        {f.status === "paid"
          ? <Chip size="small" label="Pago" color="success" />
          : f.status === "partial"
            ? <Chip size="small" color="info" label={`Parcial · ${currency(f.paid_amount || 0)}/${currency(f.amount)}`} />
            : <Chip size="small" label="Pendente" color="warning" />}
      </TableCell>
      <TableCell align="right" sx={{ color: f.type === "income" ? "primary.main" : "text.secondary", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {f.type === "income" ? "+" : "−"} {currency(f.amount)}
      </TableCell>
      <TableCell align="right">
        {f.status !== "paid" && (
          <Tooltip title={f.type === "income" ? "Marcar como recebido" : "Marcar como pago"}>
            <IconButton size="small" color="success" onClick={() => markPaid(f)}>
              <CheckCircleIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {/* Recibo — só de receita, e só depois de marcada como paga. */}
        {f.type === "income" && (
          <Tooltip title={
            f.status !== "paid"
              ? "Disponível depois de marcar como pago"
              : f.receipt_id ? `Ver / baixar recibo ${f.receipt_number || ""}` : "Gerar recibo"
          }>
            <span>
              <IconButton size="small" color={f.receipt_id ? "primary" : "default"}
                disabled={f.status !== "paid"} onClick={() => abrirRecibo(f)}>
                <ReceiptLongIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
        <Tooltip title={f.impagavel ? "Impagável: não pode deixar de pagar — clique para tirar" : "Marcar como impagável: esta eu não posso deixar de pagar"}>
          <IconButton size="small" color={f.impagavel ? "warning" : "default"}
            onClick={() => toggleImpagavel(f)}>
            {f.impagavel ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <IconButton size="small" onClick={() => { setDraft({ ...f, client_id: f.client_id || "" }); setOpen(true); }}><EditIcon fontSize="small" /></IconButton>
        <IconButton size="small" color="error" onClick={() => remove(f.id)}><DeleteIcon fontSize="small" /></IconButton>
      </TableCell>
    </TableRow>
    );
  }


  async function toggleImpagavel(row) {
    await api.put(`/financial/${row.id}/impagavel`, { impagavel: !row.impagavel });
    load();
  }

  async function save() {
    const payload = { ...draft, amount: Number(draft.amount) || 0, client_id: draft.client_id || null };
    if (draft.id) {
      await api.put(`/financial/${draft.id}`, payload);
    } else if (draft.recurring) {
      // Recorrente: o backend cria uma parcela por mês. "Fixa" = sem fim (36 meses).
      const r = await api.post("/financial", {
        ...payload, recurring: true, fixed: !!draft.fixed,
        recurring_day: Number(draft.recurring_day) || undefined,
        months: Number(draft.months) || 12,
      });
      const n = r.data?.count || 0;
      setFlash(draft.fixed
        ? `Despesa fixa criada — ${n} parcelas mensais no dia ${draft.recurring_day || "escolhido"} (renova sozinha).`
        : `Criei ${n} parcela(s) mensais no dia ${draft.recurring_day || "escolhido"}.`);
      setTimeout(() => setFlash(""), 6000);
    } else {
      await api.post("/financial", payload);
    }
    setOpen(false);
    load();
  }
  async function remove(id) {
    if (!confirm("Excluir lançamento?")) return;
    await api.delete(`/financial/${id}`);
    load();
  }

  // Um clique para marcar como pago.
  async function markPaid(row) {
    await api.put(`/financial/${row.id}`, { status: "paid" });
    load();
  }

  // O mês que o botão vai usar — o mesmo para a prévia e para a geração.
  const mesEmFoco = () => (periodo === "mes"
    ? `${mesCursor.getFullYear()}-${String(mesCursor.getMonth() + 1).padStart(2, "0")}`
    : new Date().toISOString().slice(0, 7));

  // Ao abrir o diálogo (e ao trocar de mês), mostra o que vai acontecer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!gerarOpen) { setPrevia(null); return; }
    api.get("/financial/generate-monthly/previa", { params: { month: mesEmFoco() } })
      .then((r) => setPrevia(r.data)).catch(() => setPrevia(null));
  }, [gerarOpen, periodo, mesCursor]);

  // Gera as mensalidades (receita recorrente) a partir do que está cadastrado
  // nos clientes: valor dos serviços + dia de pagamento. `meses` = quantos meses
  // à frente (a partir do mês em foco). Idempotente por cliente/mês.
  async function gerarMensalidades(meses) {
    const month = mesEmFoco();
    setGerarOpen(false);
    try {
      const r = await api.post("/financial/generate-monthly", { month, months: meses });
      const escopo = meses > 1 ? `${meses} meses a partir de ${month}` : month;
      setFlash(`Mensalidades (${escopo}): ${r.data.created} criada(s), ${r.data.skipped} não entraram.`);
      // QUEM ficou de fora e POR QUÊ. Antes a tela dizia só "N já existiam ou
      // sem valor definido", juntando num número só razões diferentes — não
      // dava para descobrir qual cliente faltou nem o que fazer a respeito.
      setForaDaGeracao(Array.isArray(r.data.fora) ? r.data.fora : []);
    } catch (e) {
      setFlash(e.response?.data?.error || "Não foi possível gerar as mensalidades.");
      setForaDaGeracao([]);
    }
    setTimeout(() => setFlash(""), 7000);
    load();
  }

  return (
    <>
      <PageHeader
        title="Financeiro"
        subtitle="Entradas e despesas do período"
        action={
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: "wrap", gap: 1 }}>
            {periodo === "mes" && (
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <IconButton size="small" onClick={() => setMesCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}>
                  <ChevronLeftIcon />
                </IconButton>
                <Typography variant="body2" sx={{ minWidth: 118, textAlign: "center", fontWeight: 600, textTransform: "capitalize" }}>
                  {mesCursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
                </Typography>
                <IconButton size="small" onClick={() => setMesCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}>
                  <ChevronRightIcon />
                </IconButton>
              </Stack>
            )}
            <TextField select size="small" value={periodo} onChange={(e) => setPeriodo(e.target.value)} sx={{ minWidth: 160 }}>
              {PERIODOS.map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}
            </TextField>
            <Tooltip title="Puxa a mensalidade de cada cliente (valor + dia de pagamento cadastrados) como receita recorrente">
              <Button variant="outlined" startIcon={<RepeatIcon />} onClick={() => setGerarOpen(true)}>Gerar mensalidades</Button>
            </Tooltip>
            {/* O caminho mais curto para o lançamento que ela mais faz: já
                abre como despesa da Perspectiva, sem escolher nada. */}
            <Button variant="outlined" startIcon={<AddIcon />}
              onClick={() => { setDraft({ ...EMPTY, type: "expense", category: "Perspectiva" }); setOpen(true); }}>
              Despesa Perspectiva
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setDraft(EMPTY); setOpen(true); }}>Lançar</Button>
          </Stack>
        }
      />

      {flash && <Alert severity="success" sx={{ mb: 2.5 }}>{flash}</Alert>}

      {/* QUEM NÃO ENTROU NA GERAÇÃO, E POR QUÊ.
          Sem esta lista, "N não entraram" é um número sem saída: não dá para
          saber qual cliente faltou nem o que arrumar no cadastro dele. */}
      {foraDaGeracao.length > 0 && (
        <Alert severity="info" sx={{ mb: 2.5 }} onClose={() => setForaDaGeracao([])}>
          <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
            Não entraram na geração:
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {foraDaGeracao.map((f) => (
              <li key={`${f.cliente}-${f.motivo}`}>
                <Typography variant="body2" component="span">
                  <b>{f.cliente}</b> — {f.motivo}
                  {f.meses > 1 ? ` (${f.meses} meses)` : ""}
                </Typography>
              </li>
            ))}
          </Box>
        </Alert>
      )}
      {reciboErro && <Alert severity="error" sx={{ mb: 2.5 }}>{reciboErro}</Alert>}

      {/* Contratos encerrando no próximo mês */}
      {renewals.length > 0 && (
        <Alert severity="warning" icon={<EventBusyIcon />} sx={{ mb: 2.5 }}>
          <strong>{renewals.length === 1 ? "1 contrato encerra" : `${renewals.length} contratos encerram`} no próximo mês</strong> —
          hora de conversar e renovar:{" "}
          {renewals.map((r) => `${r.name} (${formatDate(r.work_end)})`).join(", ")}.
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={4} md={2}>
          <StatCard label="Previsão de entrada" value={summary ? currency(summary.income) : undefined} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <StatCard label="A receber" value={summary ? currency(Math.max(0, (summary.income || 0) - (summary.paidIncome || 0))) : undefined} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <StatCard label="Já entrou" value={summary ? currency(summary.paidIncome) : undefined} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <StatCard label="Despesas previstas" value={summary ? currency(summary.expense) : undefined} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <StatCard label="A pagar" value={summary ? currency(Math.max(0, (summary.expense || 0) - (summary.paidExpense || 0))) : undefined} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <StatCard label="Lucro realizado" value={summary ? currency(summary.lucroRealizado) : undefined} />
        </Grid>
      </Grid>

      {/* VAI SOBRAR OU VAI FALTAR. Os cartões de cima dizem o que já aconteceu;
          este responde a pergunta que ela faz no fim do mês: com o que tenho
          para receber, dá para pagar tudo? */}
      {projecao && <Projecao dados={projecao} />}

      {/* O QUE ME DEVEM — sem data. O espelho de "o que eu devo". */}
      <QuemMeDeve lista={aReceber} onNova={() => setNovaCobranca({ quem: "", total: "", nota: "", client_id: "" })}
        onBaixa={(c) => setBaixando({ cobranca: c, valor: "", recebido_em: new Date().toISOString().slice(0, 10) })}
        onApagar={apagarCobranca} onEditar={editarCobranca} />

      <Card>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2, borderBottom: 1, borderColor: "divider" }}>
          <Tab value="all" label="Todos" />
          <Tab value="income" label="Receitas" />
          <Tab value="expense" label="Despesas" />
        </Tabs>

        {/* OS DOIS BALÕES. Quando o mês aperta, a pergunta não é "quanto devo",
            é "quanto disso eu consigo pagar agora". Aqui ela olha um lado de
            cada vez — e o outro não some, só fica no outro balão. */}
        <Stack direction="row" spacing={1} sx={{ px: 2, py: 1.25, flexWrap: "wrap", gap: 1 }} alignItems="center">
          <Chip label={`Todos (${rows.filter((r) => tab === "all" || r.type === tab).length})`}
            size="small" color={balao === "todos" ? "primary" : "default"}
            variant={balao === "todos" ? "filled" : "outlined"} onClick={() => setBalao("todos")} />
          <Chip label={`Só impagáveis${quantosImpagaveis ? ` (${quantosImpagaveis})` : ""}`}
            size="small" color={balao === "impagaveis" ? "warning" : "default"}
            variant={balao === "impagaveis" ? "filled" : "outlined"} onClick={() => setBalao("impagaveis")} />
          <Chip label="O que pode esperar" size="small"
            color={balao === "resto" ? "primary" : "default"}
            variant={balao === "resto" ? "filled" : "outlined"} onClick={() => setBalao("resto")} />
          {summary?.impagavelAberto > 0 && (
            <Typography variant="caption" color="warning.main" sx={{ fontWeight: 700, ml: 0.5 }}>
              {currency(summary.impagavelAberto)} que não pode deixar de pagar, ainda em aberto
            </Typography>
          )}
          {/* JUNTAR EM TÓPICOS. Em vez de vinte linhas soltas (MacBook, monitor,
              Adobe, celular...), duas: "Perspectiva" e "Salário Katy". Quem quiser
              o detalhe clica no tópico e ele abre. */}
          {podeAgrupar && (
            <FormControlLabel sx={{ ml: "auto", mr: 0 }}
              control={<Switch size="small" checked={porTopico} onChange={(e) => alternaAgrupar(e.target.checked)} />}
              label={<Typography variant="caption">Juntar em tópicos</Typography>} />
          )}
        </Stack>

        <TableContainer>
          {/* No celular a tabela é mais larga que a tela: ela rola sozinha
              aqui dentro, em vez de arrastar a página inteira para o lado. */}
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Descrição</TableCell>
                <TableCell>Cliente</TableCell>
                <TableCell>Vencimento</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Valor</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {/* Lista solta (do jeito de sempre) ou juntada em tópicos. */}
              {!agrupado && filtered.map((f) => linhaDeLancamento(f))}
              {/* Agrupado: as receitas continuam soltas, e as despesas viram tópico. */}
              {agrupado && receitas.map((f) => linhaDeLancamento(f))}
              {agrupado && topicos.map((g) => (
                <Fragment key={g.topico}>
                  {/* Tópico de um item só com o mesmo nome (é o caso do Salário
                      Katy) já É a linha — abrir mostraria a mesma coisa. */}
                  {g.itens.length === 1 && g.itens[0].description === g.topico
                    ? linhaDeLancamento(g.itens[0])
                    : (<>
                  {/* A LINHA DO TÓPICO. É o que ela pediu ver: "Perspectiva" e
                      "Salário Katy" numa linha só, com o total do mês. Clicou,
                      abre os itens por dentro. */}
                  <TableRow hover sx={{ cursor: "pointer", bgcolor: "action.hover" }} onClick={() => alternaTopico(g.topico)}>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        {topicoAberto[g.topico] ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 700 }}>{g.topico}</Typography>
                          {/* O que tem dentro, dito no próprio título: "Salários"
                              sozinho não informa nada. */}
                          {g.nomes && (
                            <Typography variant="caption" color="text.secondary">{g.nomes}</Typography>
                          )}
                        </Box>
                        <Chip size="small" variant="outlined" label={`${g.itens.length} ${g.itens.length === 1 ? "item" : "itens"}`} sx={{ height: 20 }} />
                        {g.impagaveis > 0 && (
                          <Chip size="small" color="warning" variant="outlined" icon={<StarIcon sx={{ fontSize: 13 }} />}
                            label={g.impagaveis} sx={{ height: 20 }} />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>
                      {g.aberto <= 0
                        ? <Chip size="small" label="Tudo pago" color="success" />
                        : <Chip size="small" color="warning" label={`Falta ${currency(g.aberto)}`} />}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                      − {currency(g.total)}
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={(e) => { e.stopPropagation(); alternaTopico(g.topico); }}>
                        {topicoAberto[g.topico] ? "Fechar" : "Ver itens"}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {topicoAberto[g.topico] && g.itens.map((f) => linhaDeLancamento(f, true))}
                    </>)}
                </Fragment>
              ))}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={6} align="center" style={{ padding: 32, color: "#888" }}>Nenhum lançamento.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Gerar mensalidades recorrentes a partir dos clientes cadastrados */}
      <Dialog open={gerarOpen} onClose={() => setGerarOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Gerar mensalidades</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Vou puxar cada cliente ativo com valor cadastrado e lançar a mensalidade como
              receita prevista, no dia de pagamento de cada um. Já existentes não são duplicadas.
            </Typography>
            <TextField select label="Por quantos meses" value={gerarMeses}
              onChange={(e) => setGerarMeses(Number(e.target.value))} fullWidth
              helperText="A partir do mês em foco. Mais de 1 mês fica marcado como 'Mensal'.">
              <MenuItem value={1}>Somente este mês</MenuItem>
              <MenuItem value={3}>Próximos 3 meses</MenuItem>
              <MenuItem value={6}>Próximos 6 meses</MenuItem>
              <MenuItem value={12}>Próximos 12 meses</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGerarOpen(false)}>Cancelar</Button>
          <Button variant="contained" startIcon={<RepeatIcon />} onClick={() => gerarMensalidades(gerarMeses)}>
            Gerar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Recibo: já vem pronto do modelo. Só a data fica à mão — o resto vem do
          cadastro do cliente, do escritório e do mês do lançamento. */}
      <Dialog open={!!recibo} onClose={() => setRecibo(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ pb: 1 }}>
          Recibo {recibo?.number}
          {recibo?.status === "canceled" && (
            <Chip size="small" color="error" label="Cancelado" sx={{ ml: 1 }} />
          )}
          {recibo?.version > 1 && (
            <Chip size="small" variant="outlined" label={`versão ${recibo.version}`} sx={{ ml: 1 }} />
          )}
        </DialogTitle>
        <DialogContent dividers>
          {recibo && (
            <Stack spacing={2}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
                <TextField label="Dia do recibo" type="date" size="small"
                  InputLabelProps={{ shrink: true }} sx={{ maxWidth: 200 }}
                  value={(recibo.receipt_date || "").slice(0, 10)}
                  onChange={(e) => trocarData(e.target.value)} />
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                  O resto vem pronto: empresa e CNPJ do cadastro, valor e mês do lançamento,
                  logo e assinatura salvas.
                </Typography>
                <Button size="small" onClick={refazerRecibo} disabled={reciboSalvando}>
                  Refazer com o modelo atual
                </Button>
              </Stack>

              {!recibo.payer_document && (
                <Alert severity="warning">
                  Esta empresa está sem <b>CNPJ</b> no cadastro — o recibo sai com o campo vazio.
                  Preencha em <b>Clientes</b> e clique em "Refazer com o modelo atual".
                </Alert>
              )}

              <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden", bgcolor: "#fff" }}>
                <iframe title="Recibo" srcDoc={receiptHtml(recibo)}
                  style={{ width: "100%", height: 620, border: 0 }} />
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRecibo(null)}>Fechar</Button>
          <Button variant="contained" startIcon={<PrintIcon />} onClick={() => printReceipt(recibo)}>
            Baixar / imprimir
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{draft.id ? "Editar lançamento" : "Novo lançamento"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField select label="Tipo" value={draft.type} onChange={set("type")} fullWidth>
              <MenuItem value="income">Receita</MenuItem>
              <MenuItem value="expense">Despesa</MenuItem>
            </TextField>
            <TextField label="Descrição *" value={draft.description} onChange={set("description")} fullWidth />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Valor *" type="number" value={draft.amount} onChange={set("amount")} fullWidth />
              <TextField label="Categoria" value={draft.category || ""} onChange={set("category")} fullWidth />
            </Stack>
            <TextField select label="Cliente" value={draft.client_id} onChange={set("client_id")} fullWidth>
              <MenuItem value="">Sem cliente</MenuItem>
              {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <TextField label="Cartão / conta vinculada" value={draft.card || ""} onChange={set("card")} fullWidth
              placeholder="Ex.: Nubank PJ, Cartão Inter, conta corrente…" />

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Vencimento" type="date" InputLabelProps={{ shrink: true }} value={draft.due_date || ""} onChange={set("due_date")} fullWidth />
              <TextField select label="Status" value={draft.status} onChange={set("status")} fullWidth>
                <MenuItem value="pending">Pendente</MenuItem>
                <MenuItem value="partial">Parcial</MenuItem>
                <MenuItem value="paid">Pago</MenuItem>
              </TextField>
            </Stack>

            {/* Pagamento parcial — só em lançamento já existente. */}
            {draft.id && (
              <Card variant="outlined" sx={{ p: 1.5, bgcolor: "action.hover" }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Pagamento parcial</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                  Já {draft.type === "income" ? "recebido" : "pago"}: <b>{currency(draft.paid_amount || 0)}</b> de {currency(Number(draft.amount) || 0)}
                  {" — falta "}<b>{currency(Math.max(0, (Number(draft.amount) || 0) - (Number(draft.paid_amount) || 0)))}</b>
                </Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <TextField size="small" type="number" label="Lançar valor recebido agora (R$)"
                    value={parcial} onChange={(e) => setParcial(e.target.value)} sx={{ flex: 1 }} />
                  <Button variant="outlined" onClick={lancarParcial} disabled={!Number(parcial)}>Lançar</Button>
                </Stack>
              </Card>
            )}

            {/* Recorrência mensal — só ao criar um lançamento novo. */}
            {!draft.id && (
              <>
                <FormControlLabel
                  control={
                    <Switch checked={!!draft.recurring}
                      onChange={(e) => setDraft((d) => ({ ...d, recurring: e.target.checked }))} />
                  }
                  label="Repetir todo mês"
                />
                {draft.recurring && (
                  <Stack spacing={1}>
                    <FormControlLabel
                      control={
                        <Switch checked={!!draft.fixed}
                          onChange={(e) => setDraft((d) => ({ ...d, fixed: e.target.checked }))} />
                      }
                      label="Fixa (todo mês, sem fim)"
                    />
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <TextField label="Dia do mês" type="number" inputProps={{ min: 1, max: 31 }}
                        value={draft.recurring_day}
                        onChange={(e) => setDraft((d) => ({ ...d, recurring_day: e.target.value }))}
                        fullWidth helperText="Ex.: 10 = todo dia 10" />
                      {!draft.fixed && (
                        <TextField label="Quantas vezes (meses)" type="number" inputProps={{ min: 1, max: 36 }}
                          value={draft.months}
                          onChange={(e) => setDraft((d) => ({ ...d, months: e.target.value }))}
                          fullWidth helperText="Cria uma parcela por mês" />
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {draft.fixed
                        ? `Fixa: renova todo mês (crio 36 parcelas à frente) no dia ${draft.recurring_day || "informado"}.`
                        : `Vou criar ${Number(draft.months) || 12} lançamento(s), um por mês, no dia ${draft.recurring_day || "informado"}.`}
                      {" "}Cada um pode ser editado ou excluído depois.
                    </Typography>
                  </Stack>
                )}
              </>
            )}

            <Divider>Pagamento pelo portal do cliente (opcional)</Divider>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Link de pagamento" value={draft.payment_link || ""} onChange={set("payment_link")} fullWidth placeholder="https://..." />
              <TextField label="URL do boleto (2ª via)" value={draft.boleto_url || ""} onChange={set("boleto_url")} fullWidth placeholder="https://..." />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Código PIX (copia e cola)" value={draft.pix_code || ""} onChange={set("pix_code")} fullWidth />
              <TextField label="URL da nota fiscal" value={draft.invoice_url || ""} onChange={set("invoice_url")} fullWidth placeholder="https://..." />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={save} disabled={!draft.description || !draft.amount}>Salvar</Button>
        </DialogActions>
      </Dialog>

      {/* Quem me deve — o mesmo formulário registra e conserta. */}
      <Dialog open={Boolean(novaCobranca)} onClose={() => { setNovaCobranca(null); setHistorico([]); }} fullWidth maxWidth="xs">
        <DialogTitle>{novaCobranca?.id ? "Editar a dívida" : "Quem está me devendo"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField size="small" fullWidth label="Quem" autoFocus value={novaCobranca?.quem || ""}
              onChange={(e) => setNovaCobranca((c) => ({ ...c, quem: e.target.value }))} />
            <TextField size="small" fullWidth label="Quanto ficou de pagar" value={novaCobranca?.total || ""}
              onChange={(e) => setNovaCobranca((c) => ({ ...c, total: e.target.value }))}
              helperText="Pode escrever do jeito daqui: 1.200,00" />
            <TextField select size="small" fullWidth label="Cliente (opcional)" value={novaCobranca?.client_id || ""}
              onChange={(e) => setNovaCobranca((c) => ({ ...c, client_id: e.target.value }))}>
              <MenuItem value="">— nenhum —</MenuItem>
              {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <TextField size="small" fullWidth label="Do que se trata" value={novaCobranca?.nota || ""}
              onChange={(e) => setNovaCobranca((c) => ({ ...c, nota: e.target.value }))} />

            {/* O QUE JÁ ENTROU. Aparece só na edição, porque é aqui que ela vem
                quando lançou um valor errado — e sem poder desfazer, mexer no
                total não conserta: a entrada errada continuaria no Financeiro. */}
            {novaCobranca?.id && historico.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary">Já recebido</Typography>
                <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                  {historico.map((b) => (
                    <Stack key={b.id} direction="row" alignItems="center" spacing={1}
                      sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: "action.hover" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{currency(b.valor)}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                        {formatDate(b.recebido_em)}
                      </Typography>
                      <Tooltip title="Desfazer — tira daqui e do Financeiro">
                        <IconButton size="small" color="error" onClick={() => desfazerBaixa(b)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setNovaCobranca(null); setHistorico([]); }}>Cancelar</Button>
          <Button variant="contained" onClick={salvarCobranca}
            disabled={!novaCobranca?.quem?.trim()}>{novaCobranca?.id ? "Salvar" : "Registrar"}</Button>
        </DialogActions>
      </Dialog>

      {/* Recebi um pedaço: abate do saldo e lança no Financeiro. */}
      <Dialog open={Boolean(baixando)} onClose={() => setBaixando(null)} fullWidth maxWidth="xs">
        <DialogTitle>Recebi de {baixando?.cobranca?.quem}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Falta {baixando ? currency(baixando.cobranca.falta) : ""}. O valor que você lançar aqui
              entra no Financeiro como recebido e é abatido do que ele devia.
            </Typography>
            <TextField size="small" fullWidth label="Valor recebido" autoFocus value={baixando?.valor || ""}
              onChange={(e) => setBaixando((b) => ({ ...b, valor: e.target.value }))} />
            <TextField size="small" fullWidth type="date" label="Quando" InputLabelProps={{ shrink: true }}
              value={baixando?.recebido_em || ""}
              onChange={(e) => setBaixando((b) => ({ ...b, recebido_em: e.target.value }))} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBaixando(null)}>Cancelar</Button>
          <Button variant="contained" onClick={darBaixa} disabled={!baixando?.valor}>Lançar</Button>
        </DialogActions>
      </Dialog>

    </>
  );
}

// ---------------------------------------------------------------------------
// VAI SOBRAR OU VAI FALTAR.
//
// Os cartões de cima contam o que já aconteceu. Este responde a pergunta que
// ela faz de verdade no fim do mês: com o que tenho para receber, eu consigo
// pagar tudo? E, se ela quiser, somando os gastos dela que estão em Minhas
// Finanças — porque o bolso é o mesmo, mesmo que a conta da empresa não os veja.
// ---------------------------------------------------------------------------
/**
 * VAI SOBRAR OU VAI FALTAR — a conta inteira, sem chavinha.
 *
 * Antes os gastos dela ficavam atrás de um interruptor ("somar Valores
 * Katelyn"): o número grande mudava conforme o estado do botão, e para saber
 * se dava para pagar tudo era preciso lembrar de ligá-lo. Agora tudo que sai
 * do caixa está na conta, linha a linha, como as outras saídas. O total é um
 * só e não depende de ninguém lembrar de nada.
 */
function Projecao({ dados }) {
  const sobra = dados.sobra_com_katelyn;
  const falta = sobra < 0;
  const linhas = [
    { rotulo: "entrando", valor: dados.entra, sinal: "+" },
    { rotulo: "saindo, da Perspectiva", valor: dados.sai, sinal: "−" },
    { rotulo: "saindo, das suas contas", valor: dados.katelyn, sinal: "−", ajuda: "o que está em aberto nas Minhas Finanças e não é da Perspectiva" },
  ].filter((l) => l.valor > 0);

  return (
    <Card variant="outlined" sx={{ mb: 3, borderColor: falta ? "error.main" : "divider" }}>
      <CardContent sx={{ py: 2, "&:last-child": { pb: 2 } }}>
        <Stack direction="row" spacing={3} alignItems="center" sx={{ flexWrap: "wrap", gap: 2 }}>
          <Box sx={{ minWidth: 150 }}>
            <Typography variant="caption" color="text.secondary">
              {falta ? "Vai faltar este mês" : "Vai sobrar este mês"}
            </Typography>
            <Typography sx={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2,
                              color: falta ? "error.main" : "success.main" }}>
              {currency(Math.abs(sobra))}
            </Typography>
          </Box>

          {/* A conta aberta: cada parcela numa linha, com o sinal na frente. */}
          <Stack spacing={0.25}>
            {linhas.map((l) => (
              <Stack key={l.rotulo} direction="row" spacing={1} alignItems="baseline">
                <Typography variant="body2" sx={{ width: 14, color: l.sinal === "+" ? "success.main" : "text.secondary" }}>
                  {l.sinal}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 96, fontVariantNumeric: "tabular-nums" }}>
                  {currency(l.valor)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {l.rotulo}
                  {l.ajuda && (
                    <Tooltip title={l.ajuda}>
                      <Box component="span" sx={{ ml: 0.5, cursor: "help", textDecoration: "underline dotted" }}>?</Box>
                    </Tooltip>
                  )}
                </Typography>
              </Stack>
            ))}
          </Stack>

          {/* O QUE AINDA ESTÁ EM ABERTO, dos dois lados. A conta acima já conta
              com eles; estas linhas dizem quanto ainda depende de alguém pagar
              — de fora para dentro e de dentro para fora. */}
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320 }}>
            {dados.a_receber > 0 && (
              <>Ainda tenho <b>{currency(dados.a_receber)}</b> a receber</>
            )}
            {dados.a_receber > 0 && dados.a_pagar > 0 && " · "}
            {dados.a_pagar > 0 && (
              <>falta pagar <b>{currency(dados.a_pagar)}</b></>
            )}
            {dados.me_devem > 0 && (
              <>{(dados.a_receber > 0 || dados.a_pagar > 0) && <br />}
                Fora isso, me devem {currency(dados.me_devem)} sem data marcada.</>
            )}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// O QUE ME DEVEM — sem data.
//
// O espelho de "o que eu devo", que já existe em Minhas Finanças. Alguém ficou
// de pagar e não há vencimento combinado. Fica fora dos lançamentos com data de
// propósito: isso não tem mês, e misturar faria a previsão mentir. Quando o
// dinheiro entra de verdade, aí sim vira lançamento.
// ---------------------------------------------------------------------------
function QuemMeDeve({ lista, onNova, onBaixa, onApagar, onEditar }) {
  const total = lista.reduce((t, c) => t + (c.falta || 0), 0);
  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent sx={{ py: 1.75, "&:last-child": { pb: 1.75 } }}>
        <Stack direction="row" alignItems="center" sx={{ mb: lista.length ? 1.5 : 0, flexWrap: "wrap", gap: 1 }}>
          <Typography variant="subtitle2">O que me devem</Typography>
          {total > 0 && (
            <Chip size="small" color="warning" variant="outlined" label={currency(total)} />
          )}
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            sem data — não entra na previsão do mês
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button size="small" startIcon={<AddIcon />} onClick={onNova}>Nova cobrança</Button>
        </Stack>

        {lista.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            Ninguém por aqui. Registre quanto estão te devendo e vá lançando conforme receber.
          </Typography>
        ) : (
          <Stack spacing={0.75}>
            {lista.map((c) => (
              <Stack key={c.id} direction="row" spacing={1.5} alignItems="center"
                sx={{ p: 1, borderRadius: 1, bgcolor: "action.hover", flexWrap: "wrap", gap: 1 }}>
                <Box sx={{ minWidth: 150 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{c.quem}</Typography>
                  {c.nota && <Typography variant="caption" color="text.secondary">{c.nota}</Typography>}
                </Box>
                <Typography variant="body2" sx={{ flex: 1, minWidth: 120 }}>
                  falta <b>{currency(c.falta)}</b>
                  {c.recebido > 0 && (
                    <Typography component="span" variant="caption" color="text.secondary">
                      {" "}· já recebi {currency(c.recebido)} de {currency(c.total)}
                    </Typography>
                  )}
                </Typography>
                <Button size="small" onClick={() => onBaixa(c)}>Lançar um valor</Button>
                <Tooltip title="Editar — nome, valor, do que se trata">
                  <IconButton size="small" onClick={() => onEditar(c)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Tirar da lista">
                  <IconButton size="small" onClick={() => onApagar(c)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
