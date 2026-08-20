import { useEffect, useState } from "react";
import {
  Box, Card, CardContent, Typography, Stack, Button, TextField, InputAdornment, Chip, Alert,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import VisibilityIcon from "@mui/icons-material/Visibility";
import api from "../api/client.js";
import { PageHeader, EmptyState } from "../components/ui.jsx";

// Prévia da Área do Cliente: a equipe abre o portal EXATAMENTE como o cliente
// vê (aprovações, pagamentos, contrato, galeria...), para conferir se está tudo
// organizado. Usa um acesso temporário gerado no servidor (30 min).
export default function ClientArea() {
  const [clients, setClients] = useState([]);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");

  useEffect(() => {
    api.get("/clients").then((r) => setClients(r.data.filter((c) => c.status === "active"))).catch(() => {});
  }, []);

  async function abrirPreview(c) {
    setErro("");
    try {
      const { data } = await api.post(`/clients/${c.id}/preview-token`);
      localStorage.setItem("portal_token", data.token);
      localStorage.setItem("portal_client", JSON.stringify(data.client));
      window.open("/portal", "_blank", "noopener");
    } catch (e) {
      setErro(e.response?.data?.error || "Não foi possível abrir a prévia.");
    }
  }

  const filtrados = clients.filter((c) =>
    `${c.name} ${c.company || ""}`.toLowerCase().includes(busca.toLowerCase()));

  return (
    <>
      <PageHeader title="Área do Cliente"
        subtitle="Veja como a área aparece para cada empresa — abre igual o cliente vê" />

      {erro && <Alert severity="error" sx={{ mb: 2 }}>{erro}</Alert>}

      <Alert severity="info" icon={<VisibilityIcon />} sx={{ mb: 2.5 }}>
        Ao abrir, você entra na área daquela empresa <strong>como o cliente</strong> (numa aba nova) —
        para conferir aprovações, pagamentos, contrato e galeria. É só visualização; o que você edita
        continua sendo nas abas normais do sistema.
      </Alert>

      <TextField size="small" placeholder="Buscar empresa…" value={busca}
        onChange={(e) => setBusca(e.target.value)} sx={{ mb: 2.5, maxWidth: 360, width: "100%" }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />

      {filtrados.length === 0 ? (
        <EmptyState message="Nenhuma empresa ativa encontrada." />
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)" }, gap: 2 }}>
          {filtrados.map((c) => (
            <Card key={c.id} sx={{ "&:hover": { borderColor: "primary.main" }, transition: "border-color .15s" }}>
              <CardContent>
                <Typography sx={{ fontWeight: 700 }} noWrap>{c.name}</Typography>
                {c.company && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{c.company}</Typography>}
                <Stack direction="row" spacing={0.5} sx={{ mt: 1, mb: 1.5, flexWrap: "wrap", gap: 0.5 }}>
                  {c.portal_enabled
                    ? <Chip size="small" color="success" variant="outlined" label="Acesso ativo" />
                    : <Chip size="small" variant="outlined" label="Sem login do cliente" />}
                </Stack>
                <Button fullWidth variant="contained" startIcon={<OpenInNewIcon />} onClick={() => abrirPreview(c)}>
                  Abrir a área do cliente
                </Button>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}
    </>
  );
}
