import { useEffect, useRef, useState } from "react";
import {
  Box, Card, CardContent, Typography, Stack, Button, TextField, InputAdornment, Chip, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, Divider, IconButton,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import VisibilityIcon from "@mui/icons-material/Visibility";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import DeleteIcon from "@mui/icons-material/Delete";
import api from "../api/client.js";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { useUploads } from "../upload/UploadContext.jsx";
import { fileSize } from "../utils.js";

// Prévia da Área do Cliente: a equipe abre o portal EXATAMENTE como o cliente
// vê (aprovações, pagamentos, contrato, galeria...), para conferir se está tudo
// organizado. E daqui mesmo dá para SUBIR CONTEÚDO para aquela empresa, sem
// precisar passar pela Galeria — o material cai na etapa escolhida e aparece na
// área dela na hora.
//
// Usa um acesso temporário gerado no servidor (30 min) para a prévia.

// As etapas da galeria, do jeito que a equipe pensa nelas.
const ETAPAS = [
  { v: "editados", label: "Editados", ajuda: "Conteúdo pronto, para o cliente ver na área dele." },
  { v: "aprovacao", label: "Para aprovação", ajuda: "Vai para a fila de aprovação do cliente." },
  { v: "aprovados", label: "Aprovados", ajuda: "Já aprovado — só arquivando." },
  { v: "originais", label: "Originais", ajuda: "Material bruto: fotos e vídeos da captação." },
  { v: "programados", label: "Programados", ajuda: "Já agendado para publicar." },
];

function Enviar({ cliente, aberto, onFechar }) {
  const { enqueue } = useUploads();
  const input = useRef(null);
  const [escolhidos, setEscolhidos] = useState([]);
  const [etapa, setEtapa] = useState("editados");

  useEffect(() => { if (aberto) { setEscolhidos([]); setEtapa("editados"); } }, [aberto]);

  function escolheu(e) {
    setEscolhidos((antes) => [...antes, ...Array.from(e.target.files || [])]);
    e.target.value = "";              // deixa reescolher o mesmo arquivo
  }

  function enviar() {
    enqueue(escolhidos, { clientId: cliente.id, stage: etapa });
    onFechar(escolhidos.length);
  }

  const total = escolhidos.reduce((s, f) => s + f.size, 0);
  const ajuda = ETAPAS.find((e) => e.v === etapa)?.ajuda || "";

  return (
    <Dialog open={aberto} onClose={() => onFechar(0)} fullWidth maxWidth="sm">
      <DialogTitle>Subir conteúdo — {cliente?.name}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          As fotos e vídeos vão direto para a galeria desta empresa e aparecem na área dela.
          O envio corre por trás: você pode fechar aqui e continuar trabalhando.
        </Typography>

        <TextField select fullWidth size="small" label="Onde entra" value={etapa}
          onChange={(e) => setEtapa(e.target.value)} helperText={ajuda} sx={{ mb: 2 }}>
          {ETAPAS.map((e) => <MenuItem key={e.v} value={e.v}>{e.label}</MenuItem>)}
        </TextField>

        <Button fullWidth variant="outlined" startIcon={<CloudUploadIcon />}
          onClick={() => input.current?.click()}>
          Escolher fotos e vídeos
        </Button>
        <input ref={input} type="file" multiple hidden accept="image/*,video/*" onChange={escolheu} />

        {escolhidos.length > 0 && (
          <>
            <Divider sx={{ my: 2 }}>
              <Typography variant="caption" color="text.secondary">
                {escolhidos.length} arquivo(s) · {fileSize(total)}
              </Typography>
            </Divider>
            <Stack spacing={0.5} sx={{ maxHeight: 240, overflowY: "auto" }}>
              {escolhidos.map((f, i) => (
                <Stack key={`${f.name}-${i}`} direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body2" noWrap sx={{ flex: 1 }} title={f.name}>{f.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{fileSize(f.size)}</Typography>
                  <IconButton size="small" color="error"
                    onClick={() => setEscolhidos((a) => a.filter((_, k) => k !== i))}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onFechar(0)}>Cancelar</Button>
        <Button variant="contained" onClick={enviar} disabled={!escolhidos.length}>
          Enviar {escolhidos.length ? `(${escolhidos.length})` : ""}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ClientArea() {
  const [clients, setClients] = useState([]);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [enviando, setEnviando] = useState(null);   // a empresa para quem vou subir

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

  function fecharEnvio(quantos) {
    if (quantos) {
      setAviso(`${quantos} arquivo(s) a caminho da área de ${enviando.name}. O progresso fica no canto da tela.`);
      setTimeout(() => setAviso(""), 8000);
    }
    setEnviando(null);
  }

  const filtrados = clients.filter((c) =>
    `${c.name} ${c.company || ""}`.toLowerCase().includes(busca.toLowerCase()));

  return (
    <>
      <PageHeader title="Área do Cliente"
        subtitle="Veja como a área aparece para cada empresa — e suba conteúdo direto para ela" />

      {erro && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErro("")}>{erro}</Alert>}
      {aviso && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setAviso("")}>{aviso}</Alert>}

      <Alert severity="info" icon={<VisibilityIcon />} sx={{ mb: 2.5 }}>
        Ao abrir, você entra na área daquela empresa <strong>como o cliente</strong> (numa aba nova) —
        para conferir aprovações, pagamentos, contrato e galeria. Para mandar material, use
        <strong> Subir conteúdo</strong>: ele cai na galeria da empresa e aparece na área dela.
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
                <Stack spacing={1}>
                  <Button fullWidth variant="contained" startIcon={<CloudUploadIcon />}
                    onClick={() => setEnviando(c)}>
                    Subir conteúdo
                  </Button>
                  <Button fullWidth variant="outlined" startIcon={<OpenInNewIcon />} onClick={() => abrirPreview(c)}>
                    Abrir a área do cliente
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      <Enviar cliente={enviando} aberto={Boolean(enviando)} onFechar={fecharEnvio} />
    </>
  );
}
