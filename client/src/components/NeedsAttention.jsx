import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card, CardContent, Typography, Box, Stack, Chip, Collapse, IconButton, Divider,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import TodayIcon from "@mui/icons-material/Today";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import EditNoteIcon from "@mui/icons-material/EditNote";
import SubjectIcon from "@mui/icons-material/Subject";
import ImageNotSupportedIcon from "@mui/icons-material/ImageNotSupported";
import PersonOffIcon from "@mui/icons-material/PersonOff";
import PaidIcon from "@mui/icons-material/Paid";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import api from "../api/client.js";
import { currency, formatDate, formatTime } from "../utils.js";

// Cada bloco explica o que é, por que importa e para onde ir.
const BLOCOS = [
  { key: "publicaHoje", label: "Publica hoje", icon: <TodayIcon />, tone: "primary",
    hint: "Confira se a arte e a legenda estão prontas.", to: "/calendar",
    linha: (i) => `${formatTime(i.scheduled_at)} · ${i.client_name || "sem cliente"} — ${i.title}` },
  { key: "pediramAjuste", label: "Cliente pediu ajuste", icon: <EditNoteIcon />, tone: "warning",
    hint: "Voltaram para produção e estão esperando você.", to: "/tasks",
    linha: (i) => `${i.client_name || "—"} — ${i.title}${i.client_note ? ` · "${i.client_note}"` : ""}` },
  { key: "atrasadas", label: "Passaram do prazo", icon: <WarningAmberIcon />, tone: "error",
    hint: "Prazo interno vencido e ainda não concluídas.", to: "/tasks",
    linha: (i) => `${formatDate(i.due_date)} · ${i.client_name || "—"} — ${i.title}` },
  { key: "esperandoCliente", label: "Aguardando o cliente", icon: <HourglassEmptyIcon />, tone: "default",
    hint: "Já foram para aprovação. Vale cobrar se demorar.", to: "/tasks",
    linha: (i) => `${i.client_name || "—"} — ${i.title}` },
  { key: "semLegenda", label: "Sem legenda", icon: <SubjectIcon />, tone: "warning",
    hint: "O cliente não consegue aprovar um post sem legenda.", to: "/tasks",
    linha: (i) => `${i.client_name || "—"} — ${i.title}` },
  { key: "semArte", label: "Sem arte anexada", icon: <ImageNotSupportedIcon />, tone: "warning",
    hint: "Anexe o arquivo na tarefa para o cliente ver o que aprova.", to: "/tasks",
    linha: (i) => `${i.client_name || "—"} — ${i.title}` },
  { key: "semResponsavel", label: "Sem responsável", icon: <PersonOffIcon />, tone: "default",
    hint: "Ninguém foi designado — tende a ficar parada.", to: "/tasks",
    linha: (i) => `${i.client_name || "—"} — ${i.title}` },
  { key: "contasAtrasadas", label: "Recebimento atrasado", icon: <PaidIcon />, tone: "error",
    hint: "Vencidas e ainda em aberto.", to: "/financial",
    linha: (i) => `${formatDate(i.due_date)} · ${i.client_name || "—"} — ${currency(i.amount)}` },
];

export default function NeedsAttention() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [aberto, setAberto] = useState(null);

  useEffect(() => {
    api.get("/reports/attention").then((r) => setData(r.data)).catch(() => {});
  }, []);

  if (!data) return null;
  const ativos = BLOCOS.filter((b) => (data[b.key] || []).length > 0);

  return (
    <Card sx={{ mb: 2.5 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: ativos.length ? 2 : 0 }}>
          <Typography variant="h6">Precisa de você</Typography>
          {ativos.length > 0 && (
            <Chip size="small" color="primary" label={ativos.reduce((s, b) => s + data[b.key].length, 0)} />
          )}
        </Stack>

        {ativos.length === 0 ? (
          <Stack direction="row" spacing={1.5} alignItems="center">
            <CheckCircleIcon color="success" />
            <Typography color="text.secondary">
              Nada pendente: sem atrasos, sem post incompleto e sem cobrança vencida.
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={1}>
            {ativos.map((b) => {
              const itens = data[b.key];
              const estaAberto = aberto === b.key;
              return (
                <Box key={b.key}>
                  <Box
                    onClick={() => setAberto(estaAberto ? null : b.key)}
                    sx={{
                      display: "flex", alignItems: "center", gap: 1.5, p: 1.25,
                      borderRadius: 2, cursor: "pointer",
                      bgcolor: (t) => alpha(
                        b.tone === "error" ? t.palette.error.main
                          : b.tone === "warning" ? t.palette.warning.main
                          : b.tone === "primary" ? t.palette.primary.main
                          : t.palette.text.secondary, 0.09),
                      "&:hover": { filter: "brightness(1.12)" },
                      transition: "filter .15s ease",
                    }}
                  >
                    <Box sx={{ display: "grid", placeItems: "center", color: `${b.tone === "default" ? "text.secondary" : b.tone}.main` }}>
                      {b.icon}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600, fontSize: 14.5 }}>
                        {itens.length} {b.label.toLowerCase()}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">{b.hint}</Typography>
                    </Box>
                    <IconButton size="small" sx={{ transform: estaAberto ? "rotate(180deg)" : "none", transition: "transform .2s ease" }}>
                      <ExpandMoreIcon fontSize="small" />
                    </IconButton>
                  </Box>
                  <Collapse in={estaAberto}>
                    <Box sx={{ pl: 5.5, pr: 1, py: 1 }}>
                      <Stack divider={<Divider />} spacing={0.75}>
                        {itens.slice(0, 8).map((i) => (
                          <Typography key={i.id} variant="body2" color="text.secondary" sx={{ pt: 0.75 }}>
                            {b.linha(i)}
                          </Typography>
                        ))}
                      </Stack>
                      {itens.length > 8 && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                          e mais {itens.length - 8}…
                        </Typography>
                      )}
                      <Typography
                        variant="body2" color="primary"
                        onClick={(e) => { e.stopPropagation(); navigate(b.to); }}
                        sx={{ mt: 1.25, cursor: "pointer", fontWeight: 600, "&:hover": { textDecoration: "underline" } }}
                      >
                        Resolver →
                      </Typography>
                    </Box>
                  </Collapse>
                </Box>
              );
            })}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
