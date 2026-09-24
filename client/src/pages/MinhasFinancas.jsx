import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Card, CardContent, Typography, Stack, Button, IconButton, Chip, TextField,
  MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, Checkbox, Collapse, Tooltip, Alert,
  Autocomplete,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import DeleteIcon from "@mui/icons-material/Delete";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import HistoryIcon from "@mui/icons-material/History";
import RepeatIcon from "@mui/icons-material/Repeat";
import LockIcon from "@mui/icons-material/Lock";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { useTheme } from "@mui/material/styles";
import api from "../api/client.js";
import { PageHeader, StatCard } from "../components/ui.jsx";
import DebtsCard from "../components/DebtsCard.jsx";
import { currency } from "../utils.js";

// "2026-09" → "Setembro de 2026"
function nomeDoMes(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  return `${MESES[(m || 1) - 1]} de ${y}`;
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const CORES = ["#EA580C", "#2563EB", "#16A34A", "#7C3AED", "#D97706", "#DC2626", "#0891B2", "#DB2777", "#65A30D", "#9333EA", "#57534E"];
const VAZIO = { name: "", parcela: "", amount: "", method: "", category: "", paid: false, avulso: false };

// --- CSV ---
function splitLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if ((c === "," || c === ";") && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur); return out;
}
function parseValor(v) {
  if (v == null) return 0;
  let s = String(v).replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
}
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const rows = lines.map(splitLine);
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (arr) => header.findIndex((h) => arr.some((n) => h.includes(n)));
  const iNome = idx(["nome"]), iParc = idx(["parcela"]), iValor = idx(["valor"]);
  const iMet = idx(["método", "metodo", "pagamento"]), iPago = idx(["pago"]), iCat = idx(["categoria"]);
  return rows.slice(1).map((c) => ({
    name: (c[iNome] || "").trim(),
    parcela: iParc >= 0 ? (c[iParc] || "").trim() : "",
    amount: parseValor(c[iValor]),
    method: iMet >= 0 ? (c[iMet] || "").trim() : "",
    category: iCat >= 0 ? (c[iCat] || "").trim() : "",
    paid: iPago >= 0 && /true|sim|^x$|✓|pago/i.test((c[iPago] || "").trim()),
  })).filter((e) => e.name);
}

export default function MinhasFinancas() {
  const theme = useTheme();
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [draft, setDraft] = useState(null);
  const [salaryDraft, setSalaryDraft] = useState("");
  const [msg, setMsg] = useState("");
  const [imports, setImports] = useState([]);
  const [importsOpen, setImportsOpen] = useState(false);
  const csvInput = useRef(null);

  const ym = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;

  const load = () => api.get("/personal-finance", { params: { ym } }).then((r) => {
    setData(r.data); setSalaryDraft(r.data.salary || "");
  }).catch(() => setData(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [ym]);

  const grupos = useMemo(() => {
    const map = {};
    (data?.entries || []).forEach((e) => {
      const k = e.method || "Sem método";
      (map[k] ||= { method: e.method || "", items: [], total: 0, pagos: 0 });
      map[k].items.push(e); map[k].total += Number(e.amount) || 0; if (e.paid) map[k].pagos++;
      if (e.da_perspectiva) map[k].perspectiva = (map[k].perspectiva || 0) + (Number(e.amount) || 0);
    });
    return Object.entries(map).map(([nome, g]) => ({ nome, ...g, allPaid: g.items.length > 0 && g.pagos === g.items.length }))
      .sort((a, b) => b.total - a.total);
  }, [data]);

  // Listas de métodos e categorias já usados — pra sugerir no formulário e deixar
  // criar um novo só digitando.
  const metodos = useMemo(() => [...new Set((data?.entries || []).map((e) => e.method).filter(Boolean))].sort(), [data]);
  const categorias = useMemo(() => [...new Set((data?.entries || []).map((e) => e.category).filter(Boolean))].sort(), [data]);
  // Gastos da Perspectiva que ainda estão AQUI, nas finanças pessoais, e
  // deveriam estar no Financeiro. As linhas que vêm de lá (da_perspectiva) já
  // estão no lugar certo — mandar mover essas seria mandar mover o que não é
  // daqui, e contradiz o aviso logo abaixo.
  const perspectiva = useMemo(
    () => (data?.entries || []).filter((e) => !e.da_perspectiva && /perspec/i.test(e.category || "")),
    [data]);

  // `todos` = varre todos os meses; senão, só o mês aberto. Gasto da empresa não
  // é gasto pessoal: o lugar dele é no Financeiro, como despesa.
  async function moverPerspectiva(todos = false) {
    const alvo = todos
      ? "TODOS os meses (inclusive os anteriores)"
      : `o mês de ${cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`;
    if (!confirm(`Mover os gastos da categoria Perspectiva de ${alvo} pro Financeiro (despesas)?\n\nEles saem daqui e passam a aparecer lá, com opção de marcar como pago.`)) return;
    const r = await api.post("/personal-finance/move-to-financeiro", todos ? {} : { ym });
    setMsg(r.data.moved
      ? `${r.data.moved} gasto(s) da Perspectiva movidos pro Financeiro — abra a aba Financeiro → Despesas para vê-los. ✅`
      : "Nenhum gasto da Perspectiva encontrado para mover.");
    setTimeout(() => setMsg(""), 9000);
    load();
  }

  async function renomearGrupo(g) {
    const to = prompt(`Renomear o banco / meio de pagamento "${g.nome}" para:`, g.method || g.nome);
    if (to == null) return;
    const novo = to.trim();
    if (!novo || novo === (g.method || "")) return;
    await api.put("/personal-finance/rename-method", { ym, from: g.method || "", to: novo });
    load();
  }

  // O campo guarda-se como `salary` no servidor por história; na tela é o
  // lazer do mês — quanto ela vai tirar para si do que sobrou.
  async function salvarSalario() {
    await api.put("/personal-finance/config", { salary: Number(salaryDraft) || 0 });
    load();
  }
  async function salvarEntry() {
    if (!draft.name.trim()) return;
    const payload = { ...draft, ym, amount: Number(draft.amount) || 0 };
    if (draft.id) await api.put(`/personal-finance/${draft.id}`, payload);
    else await api.post("/personal-finance", payload);
    setDraft(null); load();
  }
  async function excluir(id) { if (confirm("Excluir este gasto?")) { await api.delete(`/personal-finance/${id}`); load(); } }
  // A linha da Perspectiva mora no Financeiro: o check daqui altera o
  // lançamento de lá, não uma cópia. Por isso o endereço é outro.
  const enderecoDe = (e) => e.da_perspectiva
    ? `/personal-finance/perspectiva/${e.entry_id}`
    : `/personal-finance/${e.id}`;
  async function togglePago(e) { await api.put(enderecoDe(e), { paid: !e.paid }); load(); }
  // IMPAGÁVEL: "esta eu NÃO POSSO deixar de pagar" — o aluguel, a parcela do
  // carro, o que não dá para empurrar. Um clique, na
  // própria linha — é um gesto de triagem no meio do aperto, não pode exigir
  // abrir a ficha do gasto.
  async function toggleImpagavel(e) {
    await api.put(enderecoDe(e), { impagavel: !e.impagavel });
    load();
  }
  async function pagarFatura(g, paid) {
    await api.put("/personal-finance/pay-method", { ym, method: g.method, paid });
    // As contas da Perspectiva da mesma fatura vão junto: quem paga o cartão
    // paga tudo o que está nele, não só a parte dela.
    for (const e of g.items.filter((x) => x.da_perspectiva)) {
      await api.put(`/personal-finance/perspectiva/${e.entry_id}`, { paid });
    }
    load();
  }
  async function importarCSV(file) {
    if (!file) return;
    const text = await file.text();
    const entries = parseCSV(text);
    if (!entries.length) { setMsg("Não encontrei linhas no CSV. Confira se tem cabeçalho (Nome, Valor…)."); setTimeout(() => setMsg(""), 6000); return; }
    const replace = data?.entries?.length ? confirm(`Já há ${data.entries.length} gasto(s) em ${MESES[cursor.getMonth()]}. Substituir por ${entries.length} do CSV? (Cancelar = adicionar)`) : false;
    const r = await api.post("/personal-finance/import", { ym, entries, replace, label: file.name });
    const extra = r.data.toFinanceiro ? ` ${r.data.toFinanceiro} da categoria Perspectiva foram pro Financeiro (despesas).` : "";
    setMsg(`Importados ${r.data.imported} gastos de ${MESES[cursor.getMonth()]}. Elas seguem sozinhas nos próximos meses — as parceladas avançando a parcela.${extra} ✅`);
    setTimeout(() => setMsg(""), 9000);
    load();
  }
  async function abrirImportacoes() {
    const r = await api.get("/personal-finance/imports", { params: { ym } });
    setImports(r.data); setImportsOpen(true);
  }
  async function excluirImportacao(imp) {
    if (!confirm(`Apagar a importação "${imp.label}" (${imp.count} gasto(s) de ${MESES[cursor.getMonth()]})? Isso remove só os gastos que ela trouxe.`)) return;
    await api.delete(`/personal-finance/imports/${imp.id}`);
    const r = await api.get("/personal-finance/imports", { params: { ym } });
    setImports(r.data); load();
  }

  const s = data?.summary;
  const shift = (n) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));

  return (
    <>
      <PageHeader title="Minhas Finanças"
        subtitle={<Stack direction="row" spacing={0.5} alignItems="center"><LockIcon sx={{ fontSize: 15 }} /> <span>Privado — só você vê. Cada login tem o seu.</span></Stack>}
        action={
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap", gap: 1 }}>
            <IconButton onClick={() => shift(-1)}><ChevronLeftIcon /></IconButton>
            <Typography sx={{ minWidth: 130, textAlign: "center", fontWeight: 600 }}>{MESES[cursor.getMonth()]} {cursor.getFullYear()}</Typography>
            <IconButton onClick={() => shift(1)}><ChevronRightIcon /></IconButton>
            <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => csvInput.current?.click()}>Importar CSV</Button>
            <input ref={csvInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => importarCSV(e.target.files?.[0])} />
            <Tooltip title="Ver e desfazer importações deste mês">
              <Button variant="text" startIcon={<HistoryIcon />} onClick={abrirImportacoes}>Importações</Button>
            </Tooltip>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDraft({ ...VAZIO })}>Novo gasto</Button>
          </Stack>
        } />

      {msg && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setMsg("")}>{msg}</Alert>}

      {/* Mês que se preencheu sozinho. Dizer de onde as contas vieram evita o
          susto de abrir novembro e achar que alguém lançou tudo de novo. */}
      {data?.preenchido_de && (
        <Alert severity="info" icon={false} sx={{ mb: 2 }}>
          Este mês começou com as contas de <b>{nomeDoMes(data.preenchido_de)}</b>, com as parcelas
          já avançadas e tudo em aberto. Ajuste o que mudou — e, se alguma conta foi só de uma vez,
          marque <b>"Só neste mês"</b> nela para ela não voltar.
        </Alert>
      )}

      {perspectiva.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}
          action={
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Button color="inherit" size="small" onClick={() => moverPerspectiva(false)}>Só deste mês</Button>
              <Button color="inherit" size="small" variant="outlined" onClick={() => moverPerspectiva(true)}>
                Mover de todos os meses
              </Button>
            </Stack>
          }>
          Há {perspectiva.length} gasto(s) da categoria <b>Perspectiva</b> aqui ({currency(perspectiva.reduce((a, e) => a + (Number(e.amount) || 0), 0))}). Esses são da empresa — o lugar deles é no <b>Financeiro → Despesas</b>. As próximas importações já mandam pra lá sozinhas; estes aqui vieram de antes e precisam de um clique.
        </Alert>
      )}

      {/* Salário + resumo */}
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" }, mb: 2 }}>
        <Card>
          <CardContent>
            {/* Não é salário: é quanto ela pretende TIRAR do que sobrou, para
                si — lazer. Por isso entra na conta do "falta pagar do meu":
                é dinheiro que ainda vai sair do caixa. */}
            <Typography variant="caption" color="text.secondary">Lazer deste mês</Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
              <TextField size="small" type="number" value={salaryDraft} onChange={(e) => setSalaryDraft(e.target.value)}
                onBlur={salvarSalario} InputProps={{ startAdornment: <span style={{ marginRight: 4 }}>R$</span> }} fullWidth />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              quanto você vai pegar do que sobrou
            </Typography>
          </CardContent>
        </Card>
        {/* A PERGUNTA DO MÊS: "o que falta pagar do meu?"
            Nas palavras dela: o que está em aberto MAIS o salário que ela ainda
            quer tirar por cima. O cartão é maior porque é o número que importa;
            os outros são o detalhe de como ele se forma. */}
        <Card sx={{ gridColumn: { xs: "span 2", md: "span 2" }, bgcolor: "primary.main", color: "primary.contrastText" }}>
          <CardContent>
            <Typography variant="caption" sx={{ opacity: 0.85 }}>Falta pagar do meu</Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
              {s ? currency(s.meu?.total || 0) : "—"}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.9, mt: 0.5 }}>
              {s
                ? `${currency(s.meu?.emAberto || 0)} de contas em aberto` +
                  (s.meu?.salarioAindaAPegar ? ` + ${currency(s.meu.salarioAindaAPegar)} de lazer a pegar` : "")
                : "\u00a0"}
            </Typography>
          </CardContent>
        </Card>
        {/* Quanto ela JÁ tirou — é exatamente o que aparece no Financeiro como
            um tópico só, engordando a cada check. */}
        <StatCard label={`Já peguei este mês (${s?.meu?.topico || "Salário Katy"})`} value={s ? currency(s.meu?.jaPeguei || 0) : undefined} />
        <StatCard label="Total do mês — só o meu" value={s ? currency(s.total) : undefined} />
        {/* A pergunta do mês apertado: desse tanto que falta, quanto é do que
            não pode esperar de jeito nenhum. É o que ela paga primeiro. */}
        <StatCard
          label={s?.impagavelQuantos ? `Impagáveis em aberto (${s.impagavelQuantos})` : "Impagáveis em aberto"}
          value={s ? currency(s.impagavelAPagar || 0) : undefined} />
        {/* A conta da empresa está nas mesmas faturas, mas não é gasto dela.
            Fica num cartão à parte pra não inchar o "meu" nem sumir da vista. */}
        {s?.perspectiva?.quantos > 0 && (
          <StatCard
            label={`Da Perspectiva nestas faturas (${s.perspectiva.quantos})`}
            value={currency(s.perspectiva.total)} />
        )}
      </Box>

      {/* As contas da empresa que caem nestas faturas. Dizer isso em uma linha
          evita a pergunta "por que a Adobe está nas minhas finanças?". */}
      {s?.perspectiva?.quantos > 0 && (
        <Alert severity="info" icon={false} sx={{ mb: 2 }}>
          {s.perspectiva.quantos} conta(s) da <b>Perspectiva</b> (<b>{currency(s.perspectiva.total)}</b>,
          {" "}{currency(s.perspectiva.aberto)} em aberto) saem destes mesmos cartões e por isso aparecem
          nas faturas aqui, marcadas em azul. Elas <b>não</b> entram no "falta pagar do meu" — o lançamento
          delas vive no <b>Financeiro</b>, e é lá que se edita.
        </Alert>
      )}

      {/* A ponte com o Financeiro, dita em uma linha — pra ela saber que o
          check aqui já virou lançamento lá, sem precisar conferir. */}
      {s?.meu?.jaPeguei > 0 && (
        <Alert severity="success" icon={false} sx={{ mb: 2 }}>
          O que você já pagou este mês (<b>{currency(s.meu.jaPeguei)}</b>) está no{" "}
          <b>Financeiro → Despesas</b> numa linha só, <b>{s.meu.topico || "Salário Katy"}</b>. Cada check aqui
          engorda aquela linha; tirar o check desconta.
        </Alert>
      )}

      {/* Gráficos */}
      {s && s.total > 0 && (
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, mb: 2 }}>
          <Card><CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Por categoria</Typography>
            <Box sx={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={s.porCategoria} dataKey="valor" nameKey="nome" innerRadius={45} outerRadius={85} paddingAngle={2}>
                    {s.porCategoria.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                  </Pie>
                  <RTooltip formatter={(v) => currency(v)} contentStyle={{ background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </Box>
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 1 }}>
              {s.porCategoria.map((c, i) => <Chip key={c.nome} size="small" variant="outlined" label={`${c.nome}: ${currency(c.valor)}`} sx={{ borderColor: CORES[i % CORES.length] }} />)}
            </Stack>
          </CardContent></Card>

          <Card><CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Por meio de pagamento</Typography>
            <Box sx={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.porMetodo} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={theme.palette.divider} />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="nome" width={90} tick={{ fontSize: 12, fill: theme.palette.text.secondary }} />
                  <RTooltip formatter={(v) => currency(v)} contentStyle={{ background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, borderRadius: 8 }} />
                  <Bar dataKey="valor" radius={[0, 6, 6, 0]}>
                    {s.porMetodo.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </CardContent></Card>
        </Box>
      )}

      {/* Grupos por local de pagamento (a "fatura") — abre ao clicar */}
      {grupos.length === 0 ? (
        <Card><CardContent sx={{ textAlign: "center", py: 5 }}>
          <Typography color="text.secondary">Nenhum gasto em {MESES[cursor.getMonth()]}. Importe o CSV ou clique em "Novo gasto".</Typography>
        </CardContent></Card>
      ) : (
        <Stack spacing={1}>
          {grupos.map((g) => (
            <Card key={g.nome} variant="outlined">
              <Box sx={{ display: "flex", alignItems: "center", p: 1.25, gap: 1, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
                onClick={() => setExpanded((x) => ({ ...x, [g.nome]: !x[g.nome] }))}>
                <Tooltip title={g.allPaid ? "Fatura paga — clique para desmarcar" : "Marcar fatura inteira como paga"}>
                  <Checkbox checked={g.allPaid} onClick={(e) => e.stopPropagation()} onChange={(e) => pagarFatura(g, e.target.checked)} />
                </Tooltip>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700 }}>{g.nome}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {g.items.length} item(ns) · {g.pagos}/{g.items.length} pagos
                    {g.perspectiva > 0 && ` · ${currency(g.perspectiva)} da Perspectiva`}
                  </Typography>
                </Box>
                <Tooltip title="Renomear este banco / meio de pagamento">
                  <IconButton size="small" onClick={(e) => { e.stopPropagation(); renomearGrupo(g); }}><EditIcon sx={{ fontSize: 16 }} /></IconButton>
                </Tooltip>
                <Typography sx={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", mr: 0.5 }}>{currency(g.total)}</Typography>
                {expanded[g.nome] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </Box>
              <Collapse in={!!expanded[g.nome]}>
                <Box sx={{ borderTop: 1, borderColor: "divider" }}>
                  {g.items.map((e) => (
                    <Stack key={e.id} direction="row" spacing={1} alignItems="center"
                      sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: "divider", "&:hover .acts": { opacity: 1 } }}>
                      <Checkbox size="small" checked={!!e.paid} onChange={() => togglePago(e)} sx={{ p: 0.5 }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{e.name}</Typography>
                        <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
                          {e.parcela && <Chip size="small" variant="outlined" label={e.parcela} sx={{ height: 18 }} />}
                          {/* Esta não volta no mês que vem — bom saber antes de fechar o mês. */}
                          {e.avulso && (
                            <Tooltip title="Não acompanha os próximos meses">
                              <Chip size="small" variant="outlined" color="info" label="só neste mês" sx={{ height: 18 }} />
                            </Tooltip>
                          )}
                          {/* É da empresa. Está aqui só porque sai do mesmo
                              cartão — o dado vive no Financeiro. */}
                          {e.da_perspectiva && (
                            <Tooltip title="Conta da Perspectiva. Aparece aqui porque sai deste cartão, mas o lançamento vive no Financeiro.">
                              <Chip size="small" color="primary" label="Perspectiva" sx={{ height: 18 }} />
                            </Tooltip>
                          )}
                          {e.category && !e.da_perspectiva && <Chip size="small" variant="outlined" label={e.category} sx={{ height: 18 }} />}
                          {e.impagavel && (
                            <Chip size="small" color="warning" label="impagável" sx={{ height: 18 }} />
                          )}
                          {e.recurring ? (
                            <Tooltip title={e.installment_total ? `Parcelado — segue até ${e.installment_total}/${e.installment_total}` : "Fixa — repete todo mês"}>
                              <Chip size="small" icon={<RepeatIcon sx={{ fontSize: 12 }} />} label={e.installment_total ? "parcelado" : "todo mês"} sx={{ height: 18, ".MuiChip-label": { pl: 0.5 } }} color="default" variant="outlined" />
                            </Tooltip>
                          ) : null}
                        </Stack>
                      </Box>
                      <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{currency(e.amount)}</Typography>
                      <Box className="acts" sx={{ opacity: { xs: 1, md: 0.55 }, transition: "opacity .15s" }}>
                        <Tooltip title={e.impagavel ? "Impagável: não pode deixar de pagar — clique para tirar" : "Marcar como impagável: esta eu não posso deixar de pagar"}>
                          <IconButton size="small" color={e.impagavel ? "warning" : "default"}
                            onClick={() => toggleImpagavel(e)}>
                            {e.impagavel ? <StarIcon sx={{ fontSize: 16 }} /> : <StarBorderIcon sx={{ fontSize: 16 }} />}
                          </IconButton>
                        </Tooltip>
                        {/* Editar e apagar mexem no dado: o da Perspectiva é
                            do Financeiro, e mudar por aqui esconderia de onde
                            a mudança veio. O check e a estrelinha valem, que é
                            o que ela faz fechando a fatura. */}
                        {!e.da_perspectiva && (
                          <>
                            <IconButton size="small" onClick={() => setDraft({ ...e, paid: !!e.paid })}><EditIcon sx={{ fontSize: 16 }} /></IconButton>
                            <IconButton size="small" color="error" onClick={() => excluir(e.id)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                          </>
                        )}
                      </Box>
                    </Stack>
                  ))}
                </Box>
              </Collapse>
            </Card>
          ))}
        </Stack>
      )}

      {/* Dívidas — o que eu devo e vou pagando aos poucos (separado das contas do mês) */}
      <DebtsCard />

      {/* O QUE TERMINOU. Miudinho e lá embaixo, de propósito: não é conta a
          pagar, é só o registro de que aquela parcela acabou. Sem isso, a conta
          some do mês e parece que se perdeu. */}
      {data?.terminadas?.length > 0 && <Terminadas lista={data.terminadas} />}

      {/* Novo / editar gasto */}
      <Dialog open={Boolean(draft)} onClose={() => setDraft(null)} fullWidth maxWidth="xs">
        <DialogTitle>{draft?.id ? "Editar gasto" : "Novo gasto"}</DialogTitle>
        <DialogContent>
          {draft && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField label="Nome *" value={draft.name} autoFocus fullWidth onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              <Stack direction="row" spacing={2}>
                <TextField label="Parcela" value={draft.parcela} sx={{ width: 130 }} placeholder="3/5, fixa…" onChange={(e) => setDraft((d) => ({ ...d, parcela: e.target.value }))} />
                <TextField label="Valor (R$)" type="number" value={draft.amount} fullWidth onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} />
              </Stack>
              <Alert severity="info" icon={<RepeatIcon fontSize="inherit" />} sx={{ py: 0.25 }}>
                Escreva <b>fixa</b> pra repetir todo mês, ou <b>8/10</b> pra parcelado — ele avança sozinho (9/10, 10/10) e some quando acabar. Deixe em branco pra ser só deste mês.
              </Alert>
              <Autocomplete freeSolo options={metodos} value={draft.method || ""}
                onInputChange={(_, v) => setDraft((d) => ({ ...d, method: v }))}
                renderInput={(p) => <TextField {...p} label="Meio de pagamento (banco)" placeholder="Nubank PF, Sicoob, Pix… ou digite um novo" helperText="Escolha um que já usa ou digite um novo banco" />} />
              <Autocomplete freeSolo options={categorias} value={draft.category || ""}
                onInputChange={(_, v) => setDraft((d) => ({ ...d, category: v }))}
                renderInput={(p) => <TextField {...p} label="Categoria" placeholder="Casa, Roupas… ou digite uma nova" helperText="Escolha uma que já usa ou digite uma nova" />} />
              <Stack direction="row" alignItems="center">
                <Checkbox checked={!!draft.paid} onChange={(e) => setDraft((d) => ({ ...d, paid: e.target.checked }))} />
                <Typography variant="body2">Já pago</Typography>
              </Stack>
              {/* A conta acompanha os próximos meses sozinha. Isto é a exceção:
                  a compra que foi só desta vez e não deve voltar em novembro. */}
              <Stack direction="row" alignItems="flex-start">
                <Checkbox checked={!!draft.avulso} onChange={(e) => setDraft((d) => ({ ...d, avulso: e.target.checked }))} />
                <Box sx={{ pt: 1 }}>
                  <Typography variant="body2">Só neste mês</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Por padrão a conta acompanha os próximos meses. Marque aqui se foi só desta vez.
                  </Typography>
                </Box>
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>Cancelar</Button>
          <Button variant="contained" onClick={salvarEntry} disabled={!draft?.name?.trim()}>Salvar</Button>
        </DialogActions>
      </Dialog>

      {/* Registro de importações — pra desfazer uma que entrou errada */}
      <Dialog open={importsOpen} onClose={() => setImportsOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Importações de {MESES[cursor.getMonth()]}</DialogTitle>
        <DialogContent>
          {imports.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 2 }}>Nenhuma importação neste mês. As contas que aparecem vieram de meses anteriores (repetição automática) ou foram adicionadas à mão.</Typography>
          ) : (
            <Stack spacing={1} sx={{ mt: 1 }}>
              {imports.map((imp) => (
                <Stack key={imp.id} direction="row" alignItems="center" spacing={1} sx={{ p: 1, border: 1, borderColor: "divider", borderRadius: 1 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{imp.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{imp.count} gasto(s) · {new Date(imp.created_at + "Z").toLocaleString("pt-BR")}</Typography>
                  </Box>
                  <Tooltip title="Apagar esta importação (remove só os gastos que ela trouxe)">
                    <IconButton size="small" color="error" onClick={() => excluirImportacao(imp)}><DeleteIcon sx={{ fontSize: 18 }} /></IconButton>
                  </Tooltip>
                </Stack>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportsOpen(false)}>Fechar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// Lista do que não voltou neste mês — quitou de vez ou era só daquele mês.
// Começa fechada: é informação de conferência, não coisa para fazer.
function Terminadas({ lista }) {
  const [aberto, setAberto] = useState(false);
  const soma = lista.reduce((t, x) => t + (Number(x.amount) || 0), 0);
  return (
    <Box sx={{ mt: 2, px: 0.5 }}>
      <Stack direction="row" alignItems="center" spacing={0.5}
        sx={{ cursor: "pointer", color: "text.secondary" }} onClick={() => setAberto((v) => !v)}>
        {aberto ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
        <Typography variant="caption">
          Terminou no mês passado e não volta: <b>{lista.length}</b>{" "}
          {lista.length === 1 ? "conta" : "contas"} · {currency(soma)} a menos
        </Typography>
      </Stack>
      <Collapse in={aberto}>
        <Stack spacing={0.25} sx={{ mt: 0.75, pl: 2.5 }}>
          {lista.map((x, i) => (
            <Typography key={`${x.name}-${i}`} variant="caption" color="text.secondary">
              <b>{x.name}</b>
              {x.parcela ? ` (${x.parcela})` : ""} — {currency(x.amount)} ·{" "}
              {x.motivo === "quitou" ? "última parcela paga" : "era só daquele mês"}
            </Typography>
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}
