import { useEffect, useState } from "react";
import {
  Grid, Card, CardContent, Typography, List, ListItem, ListItemText, Chip, Box, Stack,
} from "@mui/material";
import PeopleIcon from "@mui/icons-material/People";
import FolderIcon from "@mui/icons-material/Folder";
import ViewKanbanIcon from "@mui/icons-material/ViewKanban";
import PaidIcon from "@mui/icons-material/Paid";
import FlagIcon from "@mui/icons-material/Flag";
import { useNavigate } from "react-router-dom";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { useTheme } from "@mui/material/styles";
import api from "../api/client.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader, StatCard } from "../components/ui.jsx";
import NeedsAttention from "../components/NeedsAttention.jsx";
import { currency, monthLabel, formatDate, PRIORITY } from "../utils.js";

export default function Dashboard() {
  const theme = useTheme();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [series, setSeries] = useState([]);
  const [prioridades, setPrioridades] = useState([]);

  // Ao vivo: o painel resume tarefas, financeiro e clientes — recarrega quando
  // qualquer um deles muda.
  const vTasks = useLiveVersion("tasks");
  const vFinancial = useLiveVersion("financial");
  const vClients = useLiveVersion("clients");
  const vPri = useLiveVersion("priorities");
  useEffect(() => {
    api.get("/reports/dashboard").then((r) => setData(r.data)).catch(() => {});
    api.get("/financial/summary").then((r) => setSeries(r.data.series || [])).catch(() => {});
  }, [vTasks, vFinancial, vClients]);
  useEffect(() => {
    api.get("/priorities").then((r) =>
      setPrioridades((r.data || []).filter((p) => p.level === "alta" && p.status !== "done"))
    ).catch(() => setPrioridades([]));
  }, [vPri]);

  const chart = series.map((s) => ({ name: monthLabel(s.month), Receita: s.income, Despesa: s.expense }));

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Visão geral da sua agência" />

      <NeedsAttention />

      {/* Prioridades ALTA em aberto — bate o olho ao entrar. */}
      {prioridades.length > 0 && (
        <Card sx={{ mb: 2.5, borderLeft: 4, borderLeftColor: "#DC2626", cursor: "pointer" }}
          onClick={() => navigate("/priorities")}>
          <CardContent sx={{ py: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <FlagIcon sx={{ color: "#DC2626" }} fontSize="small" />
              <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>Prioridades altas</Typography>
              <Chip size="small" label={prioridades.length} sx={{ bgcolor: "#DC2626", color: "#fff", fontWeight: 700 }} />
            </Stack>
            <Stack spacing={0.5}>
              {prioridades.slice(0, 4).map((p) => (
                <Stack key={p.id} direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  {p.client_name && <Chip size="small" variant="outlined" label={p.client_name} sx={{ height: 20, flexShrink: 0 }} />}
                  <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>{p.message}</Typography>
                  {p.assignee_name && <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>→ {p.assignee_name}</Typography>}
                </Stack>
              ))}
              {prioridades.length > 4 && (
                <Typography variant="caption" color="text.secondary">+{prioridades.length - 4} mais — clique para ver todas</Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

      <Grid container spacing={2.5} sx={{ mb: 1 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Clientes ativos" value={data?.clients} icon={<PeopleIcon />} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Projetos ativos" value={data?.activeProjects} icon={<FolderIcon />} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Tarefas pendentes" value={data?.pendingTasks} icon={<ViewKanbanIcon />} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Lucro líquido" value={data ? currency(data.profit) : undefined} icon={<PaidIcon />} />
        </Grid>
      </Grid>

      <Grid container spacing={2.5} sx={{ mt: 0.5 }}>
        <Grid item xs={12} md={7}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Receitas vs Despesas — Últimos 6 meses</Typography>
              <Box sx={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.palette.divider} />
                    <XAxis dataKey="name" stroke={theme.palette.text.secondary} tickLine={false} axisLine={false} />
                    <YAxis stroke={theme.palette.text.secondary} tickLine={false} axisLine={false} />
                    <Tooltip
                      formatter={(v) => currency(v)}
                      contentStyle={{
                        background: theme.palette.background.paper,
                        border: `1px solid ${theme.palette.divider}`,
                        borderRadius: 12,
                        color: theme.palette.text.primary,
                      }}
                      cursor={{ fill: theme.palette.action.hover }}
                    />
                    <Legend />
                    <Bar dataKey="Receita" fill={theme.palette.primary.main} radius={[6, 6, 0, 0]} />
                    <Bar dataKey="Despesa" fill={theme.palette.mode === "dark" ? "#57534E" : "#D6D3D1"} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={5}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="h6">Minhas tarefas pendentes</Typography>
                <Chip size="small" label={data?.myTasks?.length ?? 0} />
              </Stack>
              {(!data?.myTasks || data.myTasks.length === 0) ? (
                <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
                  Todas as tarefas concluídas!
                </Typography>
              ) : (
                <List dense>
                  {data.myTasks.map((t) => (
                    <ListItem key={t.id} disableGutters
                      secondaryAction={<Chip size="small" color={PRIORITY[t.priority]?.color} label={PRIORITY[t.priority]?.label} />}>
                      <ListItemText
                        primary={t.title}
                        secondary={`${t.client_name || "Sem cliente"} · ${
                          t.scheduled_at ? formatDate(t.scheduled_at)
                            : t.ref_month ? `ref. ${t.ref_month.split("-").reverse().join("/")}`
                            : t.due_date ? formatDate(t.due_date) : "sem data"
                        }`}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  );
}
