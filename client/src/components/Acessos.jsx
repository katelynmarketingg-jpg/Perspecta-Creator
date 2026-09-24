import { useEffect, useState } from "react";
import {
  Box, Typography, Stack, Button, IconButton, TextField, Chip, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, Alert,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import AddIcon from "@mui/icons-material/Add";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import HistoryIcon from "@mui/icons-material/History";
import LockIcon from "@mui/icons-material/Lock";
import api from "../api/client.js";

// ---------------------------------------------------------------------------
// OS ACESSOS DO CLIENTE.
//
// A coisa mais perigosa que este sistema guarda. As regras, e por quê:
//
//  · a senha NUNCA vem na listagem — só quando alguém clica naquela senha;
//  · no banco ela está criptografada (AES-256-GCM), não em texto puro;
//  · toda abertura fica registrada: quem viu e quando. Sem testemunha, um
//    vazamento não tem como ser investigado.
//
// Quem prefere não guardar senha nenhuma aqui tem o campo de LINK: basta
// apontar para o item no Bitwarden ou 1Password e deixar a senha lá.
// ---------------------------------------------------------------------------
const MODELOS = [
  { titulo: "E-mail do cliente", dica: "contato@site.com.br" },
  { titulo: "Registro.br", dica: "CPF ou CNPJ do cliente" },
  { titulo: "Vercel (projeto)", dica: "o site fica na sua conta — aqui só o nome do projeto" },
  { titulo: "Outro acesso", dica: "" },
];

export default function Acessos({ clientId, clienteNome }) {
  const [itens, setItens] = useState(null);
  const [aberta, setAberta] = useState({});     // id -> senha revelada
  const [novo, setNovo] = useState(null);
  const [historico, setHistorico] = useState(null);
  const [erro, setErro] = useState("");

  const carregar = () => api.get("/workspace", { params: { client_id: clientId } })
    .then((r) => setItens(r.data.filter((i) => i.kind === "credential" || i.kind === "note")))
    .catch(() => setItens([]));
  useEffect(() => { if (clientId) carregar(); /* eslint-disable-next-line */ }, [clientId]);

  async function mostrar(item) {
    try {
      const { data } = await api.get(`/workspace/${item.id}/secret`);
      setAberta((a) => ({ ...a, [item.id]: data.secret }));
      // Some sozinha: senha aberta na tela é senha que alguém vê por cima do
      // ombro, ou que fica no print de uma reunião.
      setTimeout(() => setAberta((a) => { const { [item.id]: _, ...resto } = a; return resto; }), 30000);
    } catch (e) { setErro(e.response?.data?.error || "Não consegui abrir essa senha."); }
  }

  async function copiar(item) {
    try {
      const { data } = await api.get(`/workspace/${item.id}/secret`);
      await navigator.clipboard.writeText(data.secret || "");
    } catch (e) { setErro(e.response?.data?.error || "Não consegui copiar."); }
  }

  async function verHistorico(item) {
    try {
      const { data } = await api.get(`/workspace/${item.id}/aberturas`);
      setHistorico({ item, lista: data });
    } catch { setErro("Não consegui ver o histórico."); }
  }

  async function salvarNovo() {
    try {
      await api.post("/workspace", { ...novo, client_id: clientId, kind: novo.secret ? "credential" : "note" });
      setNovo(null); carregar();
    } catch (e) { setErro(e.response?.data?.error || "Não consegui salvar."); }
  }

  return (
    <Box>
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <LockIcon fontSize="small" sx={{ mr: 0.75, color: "text.secondary" }} />
        <Typography variant="subtitle2" sx={{ mr: "auto" }}>Acessos de {clienteNome}</Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={() => setNovo({ title: "", username: "", secret: "", url: "", content: "" })}>
          Novo acesso
        </Button>
      </Stack>

      {erro && <Alert severity="warning" sx={{ mb: 1.5 }} onClose={() => setErro("")}>{erro}</Alert>}

      {itens === null ? null : itens.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Nenhum acesso guardado. As senhas ficam criptografadas e só aparecem quando você clica.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {itens.map((i) => (
            <Stack key={i.id} direction="row" spacing={1.5} alignItems="center"
              sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "action.hover", flexWrap: "wrap", gap: 1 }}>
              <Box sx={{ minWidth: 150 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{i.title}</Typography>
                {i.username && (
                  <Typography variant="caption" color="text.secondary">{i.username}</Typography>
                )}
              </Box>

              {i.content && (
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 140 }}>
                  {i.content}
                </Typography>
              )}

              {i.tem_senha && (
                <Box sx={{ flex: 1, minWidth: 170 }}>
                  {aberta[i.id] ? (
                    <Typography sx={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13.5 }}>
                      {aberta[i.id]}
                    </Typography>
                  ) : (
                    <Typography variant="caption" color="text.secondary">••••••••</Typography>
                  )}
                </Box>
              )}

              <Box sx={{ flex: 1 }} />
              {i.url && (
                <Tooltip title="Abrir o link">
                  <IconButton size="small" component="a" href={i.url} target="_blank" rel="noreferrer">
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {i.tem_senha && (
                <>
                  <Tooltip title="Mostrar por 30 segundos — fica registrado que você viu">
                    <IconButton size="small" onClick={() => mostrar(i)}><VisibilityIcon fontSize="small" /></IconButton>
                  </Tooltip>
                  <Tooltip title="Copiar a senha">
                    <IconButton size="small" onClick={() => copiar(i)}><ContentCopyIcon fontSize="small" /></IconButton>
                  </Tooltip>
                  <Tooltip title="Quem já viu esta senha">
                    <IconButton size="small" onClick={() => verHistorico(i)}><HistoryIcon fontSize="small" /></IconButton>
                  </Tooltip>
                </>
              )}
            </Stack>
          ))}
        </Stack>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.25 }}>
        As senhas ficam criptografadas e nunca entram no PDF de entrega. Para mandar ao cliente, use um
        link que expira (o Bitwarden Send faz isso de graça) e peça para ele trocar no primeiro acesso.
      </Typography>

      {/* novo acesso */}
      <Dialog open={Boolean(novo)} onClose={() => setNovo(null)} fullWidth maxWidth="xs">
        <DialogTitle>Novo acesso</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField select size="small" fullWidth label="O que é" value={novo?.title || ""}
              onChange={(e) => setNovo((n) => ({ ...n, title: e.target.value }))}>
              {MODELOS.map((m) => (
                <MenuItem key={m.titulo} value={m.titulo}>{m.titulo}</MenuItem>
              ))}
            </TextField>
            <TextField size="small" fullWidth label="Login" value={novo?.username || ""}
              onChange={(e) => setNovo((n) => ({ ...n, username: e.target.value }))}
              helperText={MODELOS.find((m) => m.titulo === novo?.title)?.dica || " "} />
            <TextField size="small" fullWidth label="Senha" type="password" value={novo?.secret || ""}
              onChange={(e) => setNovo((n) => ({ ...n, secret: e.target.value }))}
              helperText="Fica criptografada. Deixe vazio se a senha mora no seu gerenciador." />
            <TextField size="small" fullWidth label="Link" value={novo?.url || ""}
              onChange={(e) => setNovo((n) => ({ ...n, url: e.target.value }))}
              helperText="O painel, ou o item no Bitwarden/1Password." />
            <TextField size="small" fullWidth label="Observações" multiline minRows={2}
              value={novo?.content || ""}
              onChange={(e) => setNovo((n) => ({ ...n, content: e.target.value }))} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNovo(null)}>Cancelar</Button>
          <Button variant="contained" onClick={salvarNovo} disabled={!novo?.title}>Salvar</Button>
        </DialogActions>
      </Dialog>

      {/* quem viu */}
      <Dialog open={Boolean(historico)} onClose={() => setHistorico(null)} fullWidth maxWidth="xs">
        <DialogTitle>Quem viu — {historico?.item?.title}</DialogTitle>
        <DialogContent>
          {historico?.lista?.length ? (
            <Stack spacing={0.75}>
              {historico.lista.map((h, i) => (
                <Stack key={i} direction="row" spacing={1.5} justifyContent="space-between">
                  <Typography variant="body2">{h.quem || "—"}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {h.quando?.replace(" ", " às ")}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">Ninguém abriu esta senha ainda.</Typography>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setHistorico(null)}>Fechar</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
