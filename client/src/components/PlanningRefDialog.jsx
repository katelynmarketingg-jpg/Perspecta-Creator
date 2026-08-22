import { useEffect, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, CircularProgress, Stack,
} from "@mui/material";
import api from "../api/client.js";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// Extrai o HTML salvo (o conteúdo é JSON { html, style, showLogo } ou HTML puro).
function htmlFrom(raw) {
  if (!raw) return "";
  try { const j = JSON.parse(raw); return j.html || ""; } catch { return raw; }
}
// Texto puro do HTML (para jogar na legenda).
function textFrom(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

// Abre o documento de planejamento do cliente/mês e permite usar como legenda.
export default function PlanningRefDialog({ clientId, ym, open, onClose, onUse }) {
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState("");

  useEffect(() => {
    if (!open || !clientId || !ym) return;
    setLoading(true); setHtml("");
    api.get("/planning/doc", { params: { client_id: clientId, ym } })
      .then((r) => setHtml(htmlFrom(r.data?.content)))
      .catch(() => setHtml(""))
      .finally(() => setLoading(false));
  }, [open, clientId, ym]);

  const [y, m] = (ym || "").split("-").map(Number);
  const label = y ? `${MESES[m - 1]} ${y}` : "";
  const vazio = !loading && !html;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Planejamento — {label}</DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Box sx={{ display: "grid", placeItems: "center", py: 4 }}><CircularProgress /></Box>
        ) : vazio ? (
          <Stack spacing={1} sx={{ py: 2 }}>
            <Typography color="text.secondary">
              Ainda não há planejamento escrito para este cliente neste mês.
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Escreva em Planejamento → escolha a empresa → visão "Documento".
            </Typography>
          </Stack>
        ) : (
          <Box sx={{ "& ul, & ol": { pl: 3 }, "& img": { maxWidth: "100%" } }}
            dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
        {onUse && !vazio && (
          <Button variant="contained" onClick={() => { onUse(textFrom(html)); onClose(); }}>
            Usar como legenda
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
