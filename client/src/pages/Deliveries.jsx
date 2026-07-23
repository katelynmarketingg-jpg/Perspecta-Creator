import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card, CardContent, Typography, Box, Stack, LinearProgress, TextField, Chip, Button,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import api from "../api/client.js";
import { PageHeader, EmptyState } from "../components/ui.jsx";

// Mês seguinte por padrão? Não — abre no mês atual, com seletor.
export default function Deliveries() {
  const navigate = useNavigate();
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [dados, setDados] = useState([]);

  useEffect(() => {
    api.get("/reports/deliveries", { params: { month: mes } })
      .then((r) => setDados(r.data)).catch(() => setDados([]));
  }, [mes]);

  const totalPlanejado = dados.reduce((s, d) => s + d.planejado, 0);
  const totalConcluido = dados.reduce((s, d) => s + d.concluidas, 0);
  const geral = totalPlanejado ? Math.round((totalConcluido / totalPlanejado) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Entregas"
        subtitle="Quanto falta de cada cliente no mês"
        action={
          <TextField type="month" size="small" value={mes}
            onChange={(e) => setMes(e.target.value)} InputLabelProps={{ shrink: true }} />
        }
      />

      {dados.length === 0 ? (
        <EmptyState message="Nenhuma entrega planejada neste mês. Configure o plano em Projetos e lance o mês." />
      ) : (
        <>
          {/* Resumo geral */}
          <Card sx={{ mb: 2.5 }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="h6">Visão geral do mês</Typography>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{geral}%</Typography>
              </Stack>
              <LinearProgress variant="determinate" value={geral}
                color={geral >= 100 ? "success" : geral >= 50 ? "primary" : "warning"}
                sx={{ height: 12, borderRadius: 6 }} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {totalConcluido} de {totalPlanejado} peças concluídas.
              </Typography>
            </CardContent>
          </Card>

          {/* Por cliente */}
          <Stack spacing={1.5}>
            {dados.map((d) => (
              <Card key={d.id}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                    <Typography sx={{ fontWeight: 700 }}>{d.client_name}</Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip size="small" variant="outlined"
                        label={`${d.concluidas}/${d.planejado || d.programadas} concluídas`} />
                      {d.falta > 0 && <Chip size="small" color="warning" label={`faltam ${d.falta}`} />}
                      <Typography sx={{ fontWeight: 700, minWidth: 44, textAlign: "right" }}>{d.percentual}%</Typography>
                    </Stack>
                  </Stack>
                  <LinearProgress variant="determinate" value={Math.min(d.percentual, 100)}
                    color={d.percentual >= 100 ? "success" : d.percentual >= 50 ? "primary" : "warning"}
                    sx={{ height: 9, borderRadius: 5 }} />
                  <Stack direction="row" spacing={1} sx={{ mt: 1.25, flexWrap: "wrap", gap: 0.5 }} alignItems="center">
                    <Chip size="small" variant="outlined" label={`${d.em_producao} em produção`} />
                    <Chip size="small" variant="outlined" label={`${d.programadas} programadas`} />
                    <Box sx={{ flex: 1 }} />
                    <Button size="small" endIcon={<OpenInNewIcon sx={{ fontSize: 15 }} />}
                      onClick={() => navigate("/tasks")}>
                      Ver no quadro
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2, textAlign: "center" }}>
            Para confirmar uma entrega, arraste o card até "Concluído" na aba Tarefas.
          </Typography>
        </>
      )}
    </>
  );
}
