import { useEffect, useState } from "react";
import { Grid, Card, CardContent, Typography, Box, Table, TableHead, TableRow, TableCell, TableBody, LinearProgress } from "@mui/material";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { useTheme } from "@mui/material/styles";
import api from "../api/client.js";
import { PageHeader } from "../components/ui.jsx";
import { currency, monthLabel } from "../utils.js";

// Tons de laranja + cinzas quentes — nada fora da paleta da marca.
const COLORS = ["#EA580C", "#FB923C", "#FDBA74", "#78716C", "#44403C", "#A8A29E"];

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default function Reports() {
  const theme = useTheme();
  const [byClient, setByClient] = useState([]);
  const [byMonth, setByMonth] = useState([]);
  const [byUser, setByUser] = useState([]);
  const [tasksMonth, setTasksMonth] = useState([]);
  const [tasksWeekday, setTasksWeekday] = useState([]);
  const [tasksMonthday, setTasksMonthday] = useState([]);
  const [newClients, setNewClients] = useState([]);
  const [goals, setGoals] = useState([]);

  useEffect(() => {
    api.get("/reports/billing-by-client").then((r) => setByClient(r.data)).catch(() => {});
    api.get("/reports/billing-by-month").then((r) => setByMonth(r.data)).catch(() => {});
    api.get("/reports/tasks-by-user").then((r) => setByUser(r.data)).catch(() => {});
    api.get("/reports/tasks-by-month").then((r) => setTasksMonth(r.data)).catch(() => {});
    api.get("/reports/tasks-by-weekday").then((r) => setTasksWeekday(r.data)).catch(() => {});
    api.get("/reports/tasks-by-monthday").then((r) => setTasksMonthday(r.data)).catch(() => {});
    api.get("/reports/new-clients-by-month").then((r) => setNewClients(r.data)).catch(() => {});
    api.get("/goals").then((r) => setGoals(r.data)).catch(() => {});
  }, []);

  const monthChart = [...byMonth].reverse().map((m) => ({ name: monthLabel(m.month), Receita: m.income, Despesa: m.expense }));
  const clientPie = byClient.map((c) => ({ name: c.client_name, value: c.total }));
  const tasksMonthChart = tasksMonth.map((m) => ({ name: monthLabel(m.month), Criadas: m.created, Concluídas: m.done }));
  const weekdayChart = WEEKDAYS.map((w, i) => ({ name: w, Tarefas: tasksWeekday.find((t) => t.weekday === i)?.total || 0 }));
  const monthdayChart = Array.from({ length: 31 }, (_, i) => ({ name: String(i + 1), Tarefas: tasksMonthday.find((t) => t.day === i + 1)?.total || 0 }));
  const newClientsChart = newClients.map((m) => ({ name: monthLabel(m.month), Clientes: m.total }));
  const grayBar = theme.palette.mode === "dark" ? "#57534E" : "#D6D3D1";
  const tooltipStyle = { background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, borderRadius: 12, color: theme.palette.text.primary };

  return (
    <>
      <PageHeader title="Relatórios" subtitle="Faturamento e produtividade" />

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={7}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Faturamento por mês</Typography>
              <Box sx={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthChart}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.palette.divider} />
                    <XAxis dataKey="name" stroke={theme.palette.text.secondary} tickLine={false} axisLine={false} />
                    <YAxis stroke={theme.palette.text.secondary} tickLine={false} axisLine={false} />
                    <Tooltip
                      formatter={(v) => currency(v)}
                      contentStyle={{ background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, borderRadius: 12, color: theme.palette.text.primary }}
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
              <Typography variant="h6" sx={{ mb: 2 }}>Faturamento por cliente</Typography>
              <Box sx={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={clientPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                      {clientPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip
                      formatter={(v) => currency(v)}
                      contentStyle={{ background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, borderRadius: 12, color: theme.palette.text.primary }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Tarefas por mês — criadas vs concluídas</Typography>
              <Box sx={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tasksMonthChart}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.palette.divider} />
                    <XAxis dataKey="name" stroke={theme.palette.text.secondary} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} stroke={theme.palette.text.secondary} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: theme.palette.action.hover }} />
                    <Legend />
                    <Bar dataKey="Criadas" fill={grayBar} radius={[6, 6, 0, 0]} />
                    <Bar dataKey="Concluídas" fill={theme.palette.primary.main} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Clientes novos por mês</Typography>
              <Box sx={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={newClientsChart}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.palette.divider} />
                    <XAxis dataKey="name" stroke={theme.palette.text.secondary} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} stroke={theme.palette.text.secondary} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: theme.palette.action.hover }} />
                    <Bar dataKey="Clientes" fill={theme.palette.primary.main} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Tarefas por dia da semana</Typography>
              <Box sx={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekdayChart}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.palette.divider} />
                    <XAxis dataKey="name" stroke={theme.palette.text.secondary} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} stroke={theme.palette.text.secondary} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: theme.palette.action.hover }} />
                    <Bar dataKey="Tarefas" fill={theme.palette.primary.main} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Tarefas por dia do mês</Typography>
              <Box sx={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthdayChart}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.palette.divider} />
                    <XAxis dataKey="name" interval={2} stroke={theme.palette.text.secondary} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} stroke={theme.palette.text.secondary} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: theme.palette.action.hover }} />
                    <Bar dataKey="Tarefas" fill={theme.palette.primary.main} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={5}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>Metas</Typography>
              {goals.length === 0 && <Typography color="text.secondary" variant="body2">Nenhuma meta criada.</Typography>}
              <Box>
                {goals.map((g) => {
                  const pct = g.goal_type === "project"
                    ? (g.project_status === "done" ? 100 : 0)
                    : g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
                  return (
                    <Box key={g.id} sx={{ mb: 1.75 }}>
                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.4 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{g.title}</Typography>
                        <Typography variant="body2" color="text.secondary">{pct}%</Typography>
                      </Box>
                      <LinearProgress variant="determinate" value={pct}
                        color={pct >= 100 ? "success" : "primary"} sx={{ height: 8, borderRadius: 4 }} />
                    </Box>
                  );
                })}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>Tarefas por usuário</Typography>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Usuário</TableCell>
                    <TableCell align="center">Total</TableCell>
                    <TableCell align="center">Concluídas</TableCell>
                    <TableCell align="center">Pendentes</TableCell>
                    <TableCell width="30%">Progresso</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {byUser.map((u) => {
                    const pct = u.total > 0 ? Math.round((u.done / u.total) * 100) : 0;
                    return (
                      <TableRow key={u.user_name}>
                        <TableCell>{u.user_name}</TableCell>
                        <TableCell align="center">{u.total}</TableCell>
                        <TableCell align="center">{u.done}</TableCell>
                        <TableCell align="center">{u.pending}</TableCell>
                        <TableCell>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <LinearProgress variant="determinate" value={pct} sx={{ flex: 1, height: 8, borderRadius: 4 }} />
                            <Typography variant="caption">{pct}%</Typography>
                          </Box>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {byUser.length === 0 && <TableRow><TableCell colSpan={5} align="center" style={{ color: "#888", padding: 24 }}>Sem dados.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  );
}
