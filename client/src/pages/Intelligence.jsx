import { useEffect, useState } from "react";
import {
  Card, CardContent, Typography, Stack, TextField, MenuItem, Alert,
} from "@mui/material";
import api from "../api/client.js";
import { PageHeader } from "../components/ui.jsx";
import ClientBrain from "../components/ClientBrain.jsx";
import { preenchidos } from "../persona.js";

// ---------------------------------------------------------------------------
// INTELIGÊNCIA — tudo o que a IA sabe de cada cliente, em tela cheia.
//
// É o mesmo editor que aparece na ficha do cliente e no planejamento: um
// cadastro só. O briefing (o formulário que o cliente responde) tem aba
// própria; aqui só avisamos quando há resposta esperando para ser aplicada.
// ---------------------------------------------------------------------------
export default function Intelligence() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [personas, setPersonas] = useState({});   // id -> quantos campos preenchidos
  const [aguardando, setAguardando] = useState(0);

  useEffect(() => {
    api.get("/clients").then((r) => {
      const ativos = r.data.filter((c) => c.status === "active");
      setClients(ativos);
      // Quanto de inteligência cada cliente já tem — para a lista de pendências.
      ativos.forEach((c) => {
        api.get(`/ai/persona/${c.id}`).then((p) => {
          const { _memory, _fields, ...perfil } = p.data || {};
          setPersonas((m) => ({ ...m, [c.id]: preenchidos(perfil) }));
        }).catch(() => {});
      });
    }).catch(() => {});
    api.get("/briefings")
      .then((r) => setAguardando(r.data.filter((b) => b.status === "respondido").length))
      .catch(() => {});
  }, []);

  const semInteligencia = clients.filter((c) => (personas[c.id] ?? 0) < 4);

  return (
    <>
      <PageHeader title="Inteligência"
        subtitle="O que a IA sabe de cada cliente — usado nas legendas, nas ideias e no planejamento" />

      {aguardando > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <b>{aguardando} briefing(s)</b> respondido(s) esperando. Aplique na aba <b>Briefing</b> para
          preencher a inteligência e os dados do contrato de uma vez.
        </Alert>
      )}

      <Stack spacing={2.5}>
        {semInteligencia.length > 0 && (
          <Alert severity="warning">
            <b>{semInteligencia.length} cliente(s)</b> ainda quase sem inteligência:{" "}
            {semInteligencia.slice(0, 6).map((c) => c.name).join(", ")}
            {semInteligencia.length > 6 ? "…" : ""}. Preencha aqui ou mande o briefing.
          </Alert>
        )}

        <TextField select fullWidth label="Cliente" value={clientId}
          onChange={(e) => setClientId(e.target.value)}>
          <MenuItem value="">Escolha um cliente…</MenuItem>
          {clients.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}
              {personas[c.id] != null && (
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  · {personas[c.id]} de 18 campos
                </Typography>
              )}
            </MenuItem>
          ))}
        </TextField>

        <Card>
          <CardContent>
            <ClientBrain clientId={clientId} clientName={clients.find((c) => c.id === clientId)?.name}
              aoSalvar={(p) => setPersonas((m) => ({ ...m, [clientId]: preenchidos(p) }))} />
          </CardContent>
        </Card>
      </Stack>
    </>
  );
}
