import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import {
  Box, Card, CardContent, Typography, TextField, Button, Alert, Stack,
  Checkbox, FormControlLabel, Divider, CircularProgress,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import SignaturePad from "../components/SignaturePad.jsx";
import TextoDoContrato from "../components/TextoDoContrato.jsx";

// Página pública: o cliente abre o link do WhatsApp e assina, sem conta.
export default function SignContract() {
  const { token } = useParams();
  const [contract, setContract] = useState(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [form, setForm] = useState({ nome: "", documento: "", aceito: false });
  const [assinatura, setAssinatura] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);
  // Verificação por código (e-mail)
  const [codigo, setCodigo] = useState("");
  const [codigoEnviado, setCodigoEnviado] = useState(false);
  const [emailMascarado, setEmailMascarado] = useState("");
  const [enviandoCodigo, setEnviandoCodigo] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [verificado, setVerificado] = useState(false);

  useEffect(() => {
    axios.get(`/api/sign/${token}`)
      .then((r) => { setContract(r.data); setEmailMascarado(r.data?.email_mascarado || ""); })
      .catch((e) => setErro(e.response?.data?.error || "Link inválido."))
      .finally(() => setCarregando(false));
  }, [token]);

  async function enviarCodigo() {
    setErro(""); setEnviandoCodigo(true);
    try {
      const { data } = await axios.post(`/api/sign/${token}/send-code`);
      setCodigoEnviado(true);
      if (data?.email_mascarado) setEmailMascarado(data.email_mascarado);
    } catch (e) {
      setErro(e.response?.data?.error || "Não foi possível enviar o código.");
    } finally { setEnviandoCodigo(false); }
  }

  async function verificarCodigo() {
    setErro(""); setVerificando(true);
    try {
      await axios.post(`/api/sign/${token}/verify-code`, { code: codigo.trim() });
      setVerificado(true);
    } catch (e) {
      setErro(e.response?.data?.error || "Código incorreto.");
    } finally { setVerificando(false); }
  }

  async function assinar() {
    setErro("");
    setEnviando(true);
    try {
      await axios.post(`/api/sign/${token}`, {
        signer_name: form.nome.trim(),
        signer_document: form.documento.trim(),
        agreed: form.aceito,
        signature_img: assinatura,
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
    // minmax(0, …): sem isto a coluna do grid cresce até o tamanho do
    // cartão e o "maxWidth: 100%" dele não segura nada — a página ficava
    // 640px de largura num celular de 390 e rolava para o lado, bem na
    // tela em que a pessoa vai assinar.
    gridTemplateColumns: "minmax(0, 1fr)",
    bgcolor: "#000000",
    backgroundImage: "radial-gradient(900px 480px at 50% -10%, rgba(171,72,10,0.22), transparent 60%)",
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
      <Card sx={{ width: "100%", maxWidth: 640 }}>
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
                <TextoDoContrato texto={contract?.notes} contrato={contract} />
              </Box>

              {erro && <Alert severity="error" sx={{ mb: 2 }}>{erro}</Alert>}

              {/* Etapa 1 — Verificação de identidade por código no e-mail */}
              <Divider sx={{ mb: 2 }}>Verificação de identidade</Divider>
              {!contract?.email_ativo ? (
                <Alert severity="warning" sx={{ mb: 3 }}>
                  A assinatura por código ainda não foi liberada pela agência. Avise a sua agência.
                </Alert>
              ) : !contract?.email_no_cadastro ? (
                <Alert severity="warning" sx={{ mb: 3 }}>
                  Não há e-mail cadastrado para enviar o código de verificação. Avise a sua agência.
                </Alert>
              ) : verificado ? (
                <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 3 }}>
                  E-mail verificado{emailMascarado ? ` (${emailMascarado})` : ""}. Agora é só assinar abaixo.
                </Alert>
              ) : (
                <Stack spacing={1.5} sx={{ mb: 3 }}>
                  <Typography variant="body2" color="text.secondary">
                    Para garantir que é você, enviamos um código de 6 dígitos
                    {emailMascarado ? <> para <b>{emailMascarado}</b></> : " para o seu e-mail"}.
                  </Typography>
                  {!codigoEnviado ? (
                    <Button variant="outlined" onClick={enviarCodigo} disabled={enviandoCodigo}>
                      {enviandoCodigo ? "Enviando…" : "Enviar código por e-mail"}
                    </Button>
                  ) : (
                    <>
                      <TextField label="Código (6 dígitos)" value={codigo}
                        onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        inputProps={{ inputMode: "numeric", maxLength: 6, style: { letterSpacing: 6, fontSize: 20 } }}
                        fullWidth autoFocus />
                      <Stack direction="row" spacing={1}>
                        <Button variant="contained" onClick={verificarCodigo}
                          disabled={verificando || codigo.length !== 6}>
                          {verificando ? "Conferindo…" : "Verificar"}
                        </Button>
                        <Button size="small" onClick={enviarCodigo} disabled={enviandoCodigo}>
                          {enviandoCodigo ? "Enviando…" : "Reenviar"}
                        </Button>
                      </Stack>
                    </>
                  )}
                </Stack>
              )}

              {/* Etapa 2 — Assinatura (só depois de verificar) */}
              {verificado && (
                <>
                  <Divider sx={{ mb: 2 }}>Assinatura</Divider>
                  <Stack spacing={2}>
                    <TextField label="Nome completo *" value={form.nome}
                      onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} fullWidth />
                    <TextField label="CPF ou CNPJ *" value={form.documento}
                      onChange={(e) => setForm((f) => ({ ...f, documento: e.target.value }))} fullWidth
                      placeholder="Só números" />
                    <Box>
                      <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 600 }}>Sua assinatura *</Typography>
                      <SignaturePad onChange={setAssinatura} />
                    </Box>
                    <FormControlLabel
                      control={<Checkbox checked={form.aceito}
                        onChange={(e) => setForm((f) => ({ ...f, aceito: e.target.checked }))} />}
                      label={<Typography variant="body2">Li o contrato acima e concordo com os termos.</Typography>}
                    />
                    <Button variant="contained" size="large" onClick={assinar}
                      disabled={enviando || !form.nome.trim() || !form.documento.trim() || !form.aceito || !assinatura}>
                      {enviando ? "Assinando…" : "Assinar contrato"}
                    </Button>
                    <Typography variant="caption" color="text.secondary" align="center">
                      Ao assinar, registramos seu nome, documento, a verificação por e-mail, data,
                      hora e endereço de rede como comprovante — com validade legal (MP 2.200-2/2001).
                    </Typography>
                  </Stack>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
