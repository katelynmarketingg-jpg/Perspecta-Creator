import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import {
  Box, Card, CardContent, Typography, TextField, Button, Alert, Stack, Divider, Chip, CircularProgress,
} from "@mui/material";
import VerifiedIcon from "@mui/icons-material/Verified";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import SearchIcon from "@mui/icons-material/Search";

// ---------------------------------------------------------------------------
// CONFERIR UM DOCUMENTO ASSINADO — página pública, sem login.
//
// O Termo de Veracidade anexado ao contrato diz "o hash deste documento é X".
// Sozinho, isso é uma AFIRMAÇÃO. Esta página é onde ela se confirma: quem
// recebeu o PDF — o cliente, um advogado, um juiz — digita o código impresso
// (ou aponta a câmera para o QR) e vê quem assinou, quando, e se o texto foi
// alterado depois.
//
// Não mostra o contrato. Conferir é confirmar que o documento é autêntico,
// não ler o contrato dos outros.
// ---------------------------------------------------------------------------

const fundo = {
  minHeight: "100dvh", display: "grid", placeItems: "center", p: 2,
  gridTemplateColumns: "minmax(0, 1fr)",
  bgcolor: "#000000",
  backgroundImage: "radial-gradient(900px 480px at 50% -10%, rgba(171,72,10,0.22), transparent 60%)",
};

const soCodigo = (v) => String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6);
const comTraco = (v) => (v.length > 3 ? `${v.slice(0, 3)}-${v.slice(3)}` : v);

function quando(valor) {
  if (!valor) return "—";
  try {
    const d = new Date(String(valor).replace(" ", "T") + "Z");
    return `${d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })} (horário de Brasília)`;
  } catch { return String(valor); }
}

export default function Verificar() {
  const { codigo: codigoDaUrl } = useParams();
  const navegar = useNavigate();
  const [codigo, setCodigo] = useState(soCodigo(codigoDaUrl));
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState("");
  const [buscando, setBuscando] = useState(false);

  const conferir = useCallback(async (valor) => {
    const limpo = soCodigo(valor);
    if (limpo.length !== 6) {
      setErro("O código tem 6 letras e números — ele está no termo, no fim do contrato.");
      setResultado(null);
      return;
    }
    setBuscando(true); setErro(""); setResultado(null);
    try {
      const { data } = await axios.get(`/api/verificar/${limpo}`);
      setResultado(data);
    } catch (e) {
      setErro(e.response?.data?.error || "Não consegui conferir agora. Tente de novo em instantes.");
    } finally { setBuscando(false); }
  }, []);

  // Veio pelo QR (/verificar/ABC123): confere sozinho, sem pedir nada.
  useEffect(() => {
    if (codigoDaUrl) conferir(codigoDaUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigoDaUrl]);

  const alterado = resultado?.status === "alterado";

  return (
    <Box sx={{ ...fundo, alignItems: "start", py: 5 }}>
      <Card sx={{ width: "100%", maxWidth: 620 }}>
        <CardContent sx={{ p: { xs: 2.5, sm: 4 } }}>
          <Stack alignItems="center" spacing={0.5} sx={{ mb: 3 }}>
            <VerifiedIcon color="primary" sx={{ fontSize: 40 }} />
            <Typography variant="h6" align="center">Conferir um documento assinado</Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Digite o código que está no fim do documento, no Termo de Veracidade.
            </Typography>
          </Stack>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems="flex-start">
            <TextField
              fullWidth label="Código do documento" placeholder="ABC-123"
              value={comTraco(codigo)}
              onChange={(e) => setCodigo(soCodigo(e.target.value))}
              onKeyDown={(e) => { if (e.key === "Enter") conferir(codigo); }}
              inputProps={{ style: { letterSpacing: 4, fontFamily: "ui-monospace, Menlo, monospace", textTransform: "uppercase" } }}
            />
            <Button variant="contained" size="large" startIcon={<SearchIcon />}
              disabled={buscando} onClick={() => { navegar(`/verificar/${codigo}`); conferir(codigo); }}
              sx={{ minWidth: 140, py: 1.6 }}>
              {buscando ? "Conferindo…" : "Conferir"}
            </Button>
          </Stack>

          {buscando && <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={26} /></Stack>}
          {erro && <Alert severity="warning" sx={{ mt: 2 }}>{erro}</Alert>}

          {resultado?.encontrado && (
            <Box sx={{ mt: 3 }}>
              <Alert severity={alterado ? "error" : "success"}
                icon={alterado ? <ReportProblemIcon /> : <VerifiedIcon />}>
                <Typography sx={{ fontWeight: 700 }}>
                  {alterado
                    ? "Atenção: o texto deste documento foi alterado depois de assinado."
                    : "Documento autêntico e assinado eletronicamente."}
                </Typography>
                {alterado && (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    A impressão digital (hash) do documento não bate mais com a que foi assinada.
                    Peça à agência a via correta.
                  </Typography>
                )}
              </Alert>

              <Stack spacing={0.75} sx={{ mt: 2.5 }}>
                <Linha rotulo="Documento" valor={`${resultado.documento.titulo} · ${resultado.documento.numero}`} />
                <Linha rotulo="Emitido por" valor={resultado.documento.emitido_por} />
                <Linha rotulo="Código" valor={resultado.codigo} mono />
                {resultado.hash_final && (
                  <Linha rotulo="Fim do hash (SHA-256)" valor={`…${resultado.hash_final}`} mono />
                )}
              </Stack>

              <Divider sx={{ my: 2.5 }}>
                {resultado.assinaturas.length === 1 ? "1 assinatura" : `${resultado.assinaturas.length} assinaturas`}
              </Divider>

              <Stack spacing={1.5}>
                {resultado.assinaturas.map((a, i) => (
                  <Card key={i} variant="outlined">
                    <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, flexWrap: "wrap", gap: 0.5 }}>
                        <Chip size="small" label={a.papel} />
                        <Typography sx={{ fontWeight: 700 }}>{a.nome}</Typography>
                      </Stack>
                      {a.documento && (
                        <Typography variant="body2" color="text.secondary">{a.documento}</Typography>
                      )}
                      <Typography variant="body2" color="text.secondary">{quando(a.quando)}</Typography>
                      {a.verificacao && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                          {a.verificacao}
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </Stack>

              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2.5 }}>
                Assinaturas eletrônicas têm validade jurídica entre as partes, nos termos do art. 10, §2º,
                da MP 2.200-2/2001 e da Lei 14.063/2020. Esta página confirma a autenticidade e a
                integridade do documento; o conteúdo dele não é exibido aqui.
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

function Linha({ rotulo, valor, mono = false }) {
  if (!valor) return null;
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 0, sm: 1.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 170 }}>{rotulo}</Typography>
      <Typography variant="body2" sx={{ fontFamily: mono ? "ui-monospace, Menlo, monospace" : undefined, wordBreak: "break-word" }}>
        {valor}
      </Typography>
    </Stack>
  );
}
