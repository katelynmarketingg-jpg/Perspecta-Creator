import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import {
  Box, Card, CardContent, Typography, TextField, Button, Alert, Stack,
  Checkbox, FormControlLabel, Divider, CircularProgress,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

// Página pública: o cliente abre o link do WhatsApp e assina, sem conta.
export default function SignContract() {
  const { token } = useParams();
  const [contract, setContract] = useState(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [form, setForm] = useState({ nome: "", documento: "", aceito: false });
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    axios.get(`/api/sign/${token}`)
      .then((r) => setContract(r.data))
      .catch((e) => setErro(e.response?.data?.error || "Link inválido."))
      .finally(() => setCarregando(false));
  }, [token]);

  async function assinar() {
    setErro("");
    setEnviando(true);
    try {
      await axios.post(`/api/sign/${token}`, {
        signer_name: form.nome.trim(),
        signer_document: form.documento.trim(),
        agreed: form.aceito,
      });
      setPronto(true);
    } catch (e) {
      setErro(e.response?.data?.error || "Não foi possível assinar.");
    } finally {
      setEnviando(false);
    }
  }

  const fundo = {
    minHeight: "100dvh", display: "grid", placeItems: "center", p: 2,
    bgcolor: "#0C0A09",
    backgroundImage: "radial-gradient(900px 480px at 50% -10%, rgba(234,88,12,0.22), transparent 60%)",
  };

  if (carregando) {
    return <Box sx={fundo}><CircularProgress /></Box>;
  }

  if (erro && !contract) {
    return (
      <Box sx={fundo}>
        <Card sx={{ maxWidth: 420 }}><CardContent sx={{ p: 4, textAlign: "center" }}>
          <Alert severity="error">{erro}</Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Peça um novo link para a sua agência.
          </Typography>
        </CardContent></Card>
      </Box>
    );
  }

  const jaAssinado = pronto || contract?.signed_at;

  return (
    <Box sx={{ ...fundo, alignItems: "start", py: 5 }}>
      <Card sx={{ width: 640, maxWidth: "100%" }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack alignItems="center" spacing={0.5} sx={{ mb: 3 }}>
            <Box sx={{ width: 46, height: 46, borderRadius: 2.5, bgcolor: "primary.main", color: "#fff",
              display: "grid", placeItems: "center", fontWeight: 800, fontFamily: '"Outfit", sans-serif' }}>
              {(contract?.agency_name || "PM").slice(0, 2).toUpperCase()}
            </Box>
            <Typography variant="h6" align="center">{contract?.title}</Typography>
            {contract?.agency_name && (
              <Typography variant="body2" color="text.secondary">{contract.agency_name}</Typography>
            )}
          </Stack>

          {jaAssinado ? (
            <Alert severity="success" icon={<CheckCircleIcon />}>
              Contrato assinado{pronto ? "" : ` por ${contract.signer_name}`}. Obrigado!
              Você pode fechar esta página.
            </Alert>
          ) : (
            <>
              <Box sx={{ p: 2, borderRadius: 2, bgcolor: "action.hover", maxHeight: 340, overflowY: "auto", mb: 3 }}>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", fontFamily: "Georgia, serif", lineHeight: 1.7 }}>
                  {contract?.notes || "—"}
                </Typography>
              </Box>

              <Divider sx={{ mb: 2 }}>Assinatura</Divider>
              {erro && <Alert severity="error" sx={{ mb: 2 }}>{erro}</Alert>}

              <Stack spacing={2}>
                <TextField label="Nome completo *" value={form.nome}
                  onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} fullWidth />
                <TextField label="CPF ou CNPJ *" value={form.documento}
                  onChange={(e) => setForm((f) => ({ ...f, documento: e.target.value }))} fullWidth
                  placeholder="Só números" />
                <FormControlLabel
                  control={<Checkbox checked={form.aceito}
                    onChange={(e) => setForm((f) => ({ ...f, aceito: e.target.checked }))} />}
                  label={<Typography variant="body2">Li o contrato acima e concordo com os termos.</Typography>}
                />
                <Button variant="contained" size="large" onClick={assinar}
                  disabled={enviando || !form.nome.trim() || !form.documento.trim() || !form.aceito}>
                  {enviando ? "Assinando…" : "Assinar contrato"}
                </Button>
                <Typography variant="caption" color="text.secondary" align="center">
                  Ao assinar, registramos seu nome, documento, data, hora e endereço de rede
                  como comprovante — com validade legal (MP 2.200-2/2001).
                </Typography>
              </Stack>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
