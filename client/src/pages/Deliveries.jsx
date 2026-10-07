import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card, CardContent, Typography, Box, Stack, LinearProgress, TextField, Chip, Button,
  IconButton, Collapse, Tooltip,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import api from "../api/client.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader, EmptyState } from "../components/ui.jsx";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-10" → "outubro de 2026". */
const nomeDoMes = (ym) => {
  const [a, m] = String(ym).split("-").map(Number);
  return `${MESES[m - 1]} de ${a}`;
};
/** Com a primeira letra grande — e só ela: "Outubro De 2026" não é português. */
const comMaiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
/** Anda N meses, sem cair no buraco do dia 31. */
const andarMes = (ym, n) => {
  const [a, m] = String(ym).split("-").map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const corDaBarra = (p) => (p >= 100 ? "success" : p >= 50 ? "primary" : "warning");

export default function Deliveries() {
  const navigate = useNavigate();
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [dados, setDados] = useState([]);
  // Qual balão está aberto. Um de cada vez: a página é para bater o olho.
  const [aberto, setAberto] = useState(null);

  // Ao vivo: a barra acompanha o quadro — programou lá, enche aqui.
  const vTasks = useLiveVersion("tasks");
  useEffect(() => {
    api.get("/reports/deliveries", { params: { month: mes } })
      .then((r) => setDados(r.data)).catch(() => setDados([]));
  }, [mes, vTasks]);

  const geralDoMes = useMemo(() => {
    const planejado = dados.reduce((s, d) => s + d.planejado, 0);
    const entregue = dados.reduce((s, d) => s + d.entregues, 0);
    return {
      planejado, entregue,
      pct: planejado ? Math.min(100, Math.round((entregue / planejado) * 100)) : 0,
    };
  }, [dados]);

  return (
    <>
      <PageHeader
        title="Entregas"
        subtitle="O plano do projeto, mês a mês — e o que já está programado"
        action={
          /* O MÊS, COM SETAS. Pedido dela: "pode ter um filtro lá em cima para
             eu passar para o mês passado, para o próximo mês". O campo de data
             continua ali para pular para um mês distante. */
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Tooltip title="Mês anterior">
              <IconButton size="small" onClick={() => setMes((m) => andarMes(m, -1))}>
                <ChevronLeftIcon />
              </IconButton>
            </Tooltip>
            <Typography sx={{ fontWeight: 700, minWidth: 156, textAlign: "center" }}>
              {comMaiuscula(nomeDoMes(mes))}
            </Typography>
            <Tooltip title="Próximo mês">
              <IconButton size="small" onClick={() => setMes((m) => andarMes(m, 1))}>
                <ChevronRightIcon />
              </IconButton>
            </Tooltip>
            <TextField type="month" size="small" value={mes}
              onChange={(e) => setMes(e.target.value)} sx={{ width: 150, ml: 1 }}
              InputLabelProps={{ shrink: true }} />
          </Stack>
        }
      />

      {dados.length === 0 ? (
        <EmptyState message={`Nenhuma entrega planejada em ${nomeDoMes(mes)}. Configure o plano em Projetos e lance o mês.`} />
      ) : (
        <>
          <Card sx={{ mb: 2.5 }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="h6">{comMaiuscula(nomeDoMes(mes))}</Typography>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{geralDoMes.pct}%</Typography>
              </Stack>
              <LinearProgress variant="determinate" value={geralDoMes.pct}
                color={corDaBarra(geralDoMes.pct)} sx={{ height: 12, borderRadius: 6 }} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {geralDoMes.entregue} de {geralDoMes.planejado} peças programadas.
              </Typography>
            </CardContent>
          </Card>

          <Stack spacing={1.5}>
            {dados.map((d) => {
              const estaAberto = aberto === d.id;
              return (
                /* O BALÃO INTEIRO ABRE. Pedido dela: "quando eu clicar em
                   qualquer parte daquele balão daquele cliente, eu quero que
                   abra embaixo". Não é só no nome. */
                <Card
                  key={d.id}
                  onClick={() => setAberto((v) => (v === d.id ? null : d.id))}
                  sx={{
                    cursor: "pointer",
                    transition: "border-color .15s ease, background-color .15s ease",
                    ...(estaAberto && { borderColor: "primary.main" }),
                    "&:hover": { borderColor: "primary.main" },
                  }}
                >
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
                        <ExpandMoreIcon fontSize="small" color="action"
                          sx={{ transform: estaAberto ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
                        <Typography sx={{ fontWeight: 700 }} noWrap>{d.client_name}</Typography>
                      </Stack>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Chip size="small" variant="outlined"
                          label={`${d.entregues}/${d.planejado || d.entregues} programadas`} />
                        {d.falta > 0 && <Chip size="small" color="warning" label={`faltam ${d.falta}`} />}
                        <Typography sx={{ fontWeight: 700, minWidth: 44, textAlign: "right" }}>{d.percentual}%</Typography>
                      </Stack>
                    </Stack>

                    <LinearProgress variant="determinate" value={Math.min(d.percentual, 100)}
                      color={corDaBarra(d.percentual)} sx={{ height: 9, borderRadius: 5 }} />

                    <Stack direction="row" spacing={1} sx={{ mt: 1.25, flexWrap: "wrap", gap: 0.5 }} alignItems="center">
                      <Chip size="small" variant="outlined" label={`${d.em_producao} em produção`} />
                      <Box sx={{ flex: 1 }} />
                      <Button size="small" endIcon={<OpenInNewIcon sx={{ fontSize: 15 }} />}
                        onClick={(e) => { e.stopPropagation(); navigate("/tasks"); }}>
                        Ver no quadro
                      </Button>
                    </Stack>

                    {/* UMA LINHA POR TIPO. "uma correspondente para post, uma
                        para carrossel, uma para reel... para ver de forma
                        separada o que realmente está faltando." */}
                    <Collapse in={estaAberto} unmountOnExit>
                      <Box sx={{
                        mt: 1.75, pt: 1.5, borderTop: 1, borderColor: "divider",
                        display: "grid", rowGap: 1.25,
                      }}>
                        {d.tipos.length === 0 && (
                          <Typography variant="caption" color="text.secondary">
                            Este cliente não tem plano em Projetos — por isso não há linha por tipo.
                          </Typography>
                        )}
                        {d.tipos.map((t) => (
                          <Box key={t.content_type}>
                            <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.5 }}>
                              <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>
                                {t.label}
                                {t.fora_do_plano && (
                                  <Typography component="span" variant="caption" color="text.secondary"
                                    sx={{ ml: 0.75 }}>fora do plano</Typography>
                                )}
                              </Typography>
                              {t.em_producao > 0 && (
                                <Typography variant="caption" color="text.secondary">
                                  {t.em_producao} em produção
                                </Typography>
                              )}
                              <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", minWidth: 52, textAlign: "right" }}>
                                {t.entregue}/{t.planejado || t.entregue}
                              </Typography>
                              {t.falta > 0 && (
                                <Typography variant="caption" color="warning.main" sx={{ fontWeight: 700, minWidth: 58, textAlign: "right" }}>
                                  faltam {t.falta}
                                </Typography>
                              )}
                            </Stack>
                            <LinearProgress variant="determinate" value={Math.min(t.percentual, 100)}
                              color={corDaBarra(t.percentual)}
                              sx={{ height: 6, borderRadius: 3, bgcolor: (th) => alpha(th.palette.text.primary, 0.07) }} />
                          </Box>
                        ))}
                      </Box>
                    </Collapse>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2, textAlign: "center" }}>
            A peça conta como entregue quando está em <b>“Programados”</b>, com data neste mês.
            O planejado vem do plano mensal de <b>Projetos</b>.
          </Typography>
        </>
      )}
    </>
  );
}
