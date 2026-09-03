import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Card, CardContent, Typography, Stack, Button, IconButton, Chip, TextField,
  MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, Checkbox, Collapse, Tooltip, Alert,
  Autocomplete,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
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

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const CORES = ["#EA580C", "#2563EB", "#16A34A", "#7C3AED", "#D97706", "#DC2626", "#0891B2", "#DB2777", "#65A30D", "#9333EA", "#57534E"];
const VAZIO = { name: "", parcela: "", amount: "", method: "", category: "", paid: false };

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
    });
    return Object.entries(map).map(([nome, g]) => ({ nome, ...g, allPaid: g.items.length > 0 && g.pagos === g.items.length }))
      .sort((a, b) => b.total - a.total);
  }, [data]);

  // Listas de métodos e categorias já usados — pra sugerir no formulário e deixar
  // criar um novo só digitando.
  const metodos = useMemo(() => [...new Set((data?.entries || []).map((e) => e.method).filter(Boolean))].sort(), [data]);
  const categorias = useMemo(() => [...new Set((data?.entries || []).map((e) => e.category).filter(Boolean))].sort(), [data]);
  // Gastos da Perspectiva que ainda estão aqui (deveriam estar no Financeiro).
  const perspectiva = useMemo(() => (data?.entries || []).filter((e) => /perspec/i.test(e.category || "")), [data]);

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
  async function togglePago(e) { await api.put(`/personal-finance/${e.id}`, { paid: !e.paid }); load(); }
  async function pagarFatura(g, paid) {
    await api.put("/personal-finance/pay-method", { ym, method: g.method, paid });
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
    setMsg(`Importados ${r.data.imported} gastos de ${MESES[cursor.getMonth()]}. As contas fixas e parceladas vão seguir sozinhas nos próximos meses.${extra} ✅`);
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
            <Typography variant="caption" color="text.secondary">Salário / renda do mês</Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
              <TextField size="small" type="number" value={salaryDraft} onChange={(e) => setSalaryDraft(e.target.value)}
                onBlur={salvarSalario} InputProps={{ startAdornment: <span style={{ marginRight: 4 }}>R$</span> }} fullWidth />
            </Stack>
          </CardContent>
        </Card>
        <StatCard label="Total do mês" value={s ? currency(s.total) : undefined} />
        <StatCard label="Comprometido do salário" value={s?.comprometido != null ? `${s.comprometido}%` : "—"} />
        <StatCard label="A pagar" value={s ? currency(s.aPagar) : undefined} />
      </Box>

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
                  <Typography variant="caption" color="text.secondary">{g.items.length} item(ns) · {g.pagos}/{g.items.length} pagos</Typography>
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
                          {e.category && <Chip size="small" variant="outlined" label={e.category} sx={{ height: 18 }} />}
                          {e.recurring ? (
                            <Tooltip title={e.installment_total ? `Parcelado — segue até ${e.installment_total}/${e.installment_total}` : "Fixa — repete todo mês"}>
                              <Chip size="small" icon={<RepeatIcon sx={{ fontSize: 12 }} />} label={e.installment_total ? "parcelado" : "todo mês"} sx={{ height: 18, ".MuiChip-label": { pl: 0.5 } }} color="default" variant="outlined" />
                            </Tooltip>
                          ) : null}
                        </Stack>
                      </Box>
                      <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{currency(e.amount)}</Typography>
                      <Box className="acts" sx={{ opacity: { xs: 1, md: 0.55 }, transition: "opacity .15s" }}>
                        <IconButton size="small" onClick={() => setDraft({ ...e, paid: !!e.paid })}><EditIcon sx={{ fontSize: 16 }} /></IconButton>
                        <IconButton size="small" color="error" onClick={() => excluir(e.id)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
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
