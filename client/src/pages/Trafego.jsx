// ---------------------------------------------------------------------------
// TRÁFEGO — anúncios por cliente → plataforma (Meta/Google).
//
// Esta é a ESTRUTURA. Os números (saldo, valor usado, cliques, impressões) vêm
// das APIs de anúncios (Meta Ads / Google Ads), que são uma conexão à parte.
// Enquanto a conta de anúncios do cliente não estiver conectada, cada plataforma
// aparece como "não conectado". Quando conectar, os números entram sozinhos e a
// tela passa a atualizar a cada 30 min.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Box, Card, CardContent, Typography, Stack, Chip, Alert, CircularProgress, Divider } from "@mui/material";
import InstagramIcon from "@mui/icons-material/Instagram";
import GoogleIcon from "@mui/icons-material/Google";
import api from "../api/client.js";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { currency } from "../utils.js";

function Numero({ rotulo, valor }) {
  return (
    <Box sx={{ minWidth: 92 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{rotulo}</Typography>
      <Typography sx={{ fontWeight: 700 }}>{valor}</Typography>
    </Box>
  );
}

function Plataforma({ nome, icone, m }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 260 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          {icone}
          <Typography sx={{ fontWeight: 700, flex: 1 }}>{nome}</Typography>
          {m
            ? <Chip size="small" color="success" label="Conectado" />
            : <Chip size="small" variant="outlined" label="Não conectado" />}
        </Stack>
        {m ? (
          <>
            <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 1.5 }}>
              <Numero rotulo="Saldo" valor={m.balance != null ? currency(m.balance) : "—"} />
              <Numero rotulo="Valor usado" valor={m.spent != null ? currency(m.spent) : "—"} />
              <Numero rotulo="Cliques" valor={m.clicks != null ? m.clicks.toLocaleString("pt-BR") : "—"} />
              <Numero rotulo="Impressões" valor={m.impressions != null ? m.impressions.toLocaleString("pt-BR") : "—"} />
            </Stack>
            {(m.period || m.updated_at) && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                {m.period ? `Período: ${m.period}` : ""}{m.period && m.updated_at ? " · " : ""}
                {m.updated_at ? `atualizado ${new Date(m.updated_at + "Z").toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : ""}
              </Typography>
            )}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Conta de anúncios não conectada.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export default function Trafego() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    api.get("/trafego").then((r) => setRows(r.data || [])).catch(() => setRows([]));
  }, []);

  return (
    <Box>
      <PageHeader title="Tráfego" subtitle="Anúncios por cliente — Meta e Google" />
      <Alert severity="info" sx={{ mb: 2 }}>
        Os números (saldo, valor usado, cliques, impressões) atualizam <b>a cada 30 min</b> quando a
        conta de anúncios do cliente estiver conectada. Conexão de anúncios (Meta Ads / Google Ads)
        é um passo à parte — enquanto não ligar, aparece "não conectado".
      </Alert>

      {rows === null ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 8 }}><CircularProgress /></Box>
      ) : rows.length === 0 ? (
        <EmptyState message="Nenhum cliente ativo para mostrar o tráfego." />
      ) : (
        <Stack spacing={2}>
          {rows.map((c) => (
            <Card key={c.id} sx={{ overflow: "visible" }}>
              <CardContent>
                <Typography sx={{ fontWeight: 800, mb: 0.5 }}>{c.name}</Typography>
                {c.company && <Typography variant="caption" color="text.secondary">{c.company}</Typography>}
                <Divider sx={{ my: 1.5 }} />
                <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                  <Plataforma nome="Meta (Facebook/Instagram)" icone={<InstagramIcon fontSize="small" />} m={c.meta} />
                  <Plataforma nome="Google Ads" icone={<GoogleIcon fontSize="small" />} m={c.google} />
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Box>
  );
}
