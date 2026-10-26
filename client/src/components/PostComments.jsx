import { useEffect, useRef, useState } from "react";
import {
  Box, Typography, TextField, Button, Stack, Avatar, Divider, CircularProgress, Alert,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import SendIcon from "@mui/icons-material/Send";
import { useLiveVersion } from "../live/LiveContext.jsx";

/**
 * Conversa de um post. A legenda fica fixa no topo (é sobre ela que se fala)
 * e os comentários vêm abaixo, com a agência de um lado e o cliente do outro.
 *
 * Serve aos dois lados: quem usa passa o `api` e o `eu` correspondentes.
 */
export default function PostComments({
  taskId, caption, api, listPath, postPath, eu = "agency", compacto = false,
  titulo = "Comentários", ajuda = "",
}) {
  const [comments, setComments] = useState([]);
  const [texto, setTexto] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const fimRef = useRef(null);

  const load = () => {
    setCarregando(true);
    api.get(listPath)
      .then((r) => setComments(r.data))
      .catch(() => setComments([]))
      .finally(() => setCarregando(false));
  };
  // Ao vivo: recarrega a conversa quando chega comentário novo (do time).
  // No portal do cliente o canal não está ativo, então fica em 0 (sem efeito).
  const vComments = useLiveVersion("comments");
  useEffect(() => { if (taskId) load(); }, [taskId, vComments]);

  useEffect(() => { fimRef.current?.scrollIntoView({ block: "nearest" }); }, [comments.length]);

  async function enviar() {
    const body = texto.trim();
    if (!body) return;
    setEnviando(true); setErro("");
    try {
      const { data } = await api.post(postPath, { body });
      setComments((c) => [...c, data]);
      setTexto("");
    } catch (e) {
      // Sem isto, a mensagem simplesmente não ia e ninguém ficava sabendo.
      setErro(e?.response?.data?.error || "Não consegui enviar. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  const quando = (s) =>
    new Date(s.includes("Z") || s.includes("T") ? s : s.replace(" ", "T") + "Z")
      .toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <Box>
      {/* Legenda fixa: o assunto da conversa */}
      {caption !== undefined && (
        <Box sx={{
          p: 1.5, borderRadius: 2, mb: 2,
          bgcolor: (t) => alpha(t.palette.primary.main, 0.07),
          border: 1, borderColor: "divider",
        }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: "0.06em" }}>
            LEGENDA
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}>
            {caption || "Sem legenda cadastrada."}
          </Typography>
        </Box>
      )}

      <Typography variant="subtitle2" sx={{ mb: ajuda ? 0.25 : 1 }}>{titulo}</Typography>
      {ajuda && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          {ajuda}
        </Typography>
      )}

      <Box sx={{ maxHeight: compacto ? 220 : 300, overflowY: "auto", pr: 0.5 }}>
        {carregando ? (
          <Stack alignItems="center" sx={{ py: 2 }}><CircularProgress size={20} /></Stack>
        ) : comments.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1.5 }}>
            Nada escrito ainda. Use o campo abaixo e clique em <strong>Enviar</strong>.
          </Typography>
        ) : (
          <Stack spacing={1.25} divider={<Divider flexItem sx={{ opacity: 0.4 }} />}>
            {comments.map((c) => {
              const meu = c.author_type === eu;
              return (
                <Stack key={c.id} direction="row" spacing={1.25} alignItems="flex-start">
                  <Avatar sx={{
                    width: 28, height: 28, fontSize: 12, borderRadius: 2,
                    bgcolor: c.author_type === "client" ? "primary.main" : "text.secondary",
                  }}>
                    {(c.author_name || "?").slice(0, 1).toUpperCase()}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="baseline" sx={{ flexWrap: "wrap" }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {c.author_name}{meu ? " (você)" : ""}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">{quando(c.created_at)}</Typography>
                    </Stack>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{c.body}</Typography>
                  </Box>
                </Stack>
              );
            })}
          </Stack>
        )}
        <div ref={fimRef} />
      </Box>

      {erro && <Alert severity="warning" sx={{ mt: 1.5 }} onClose={() => setErro("")}>{erro}</Alert>}

      {/* O BOTÃO DIZ O QUE FAZ. Era um quadradinho de 44px com só a setinha,
          do lado do campo: no celular ninguém via que era ali que se mandava —
          escrevia e achava que tinha mandado. */}
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} alignItems="flex-end">
        <TextField
          size="small" fullWidth multiline maxRows={4} placeholder="Escreva aqui…"
          value={texto} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); enviar(); }
          }}
        />
        <Button variant="contained" startIcon={<SendIcon fontSize="small" />}
          onClick={enviar} disabled={!texto.trim() || enviando} sx={{ whiteSpace: "nowrap" }}>
          {enviando ? "Enviando…" : "Enviar"}
        </Button>
      </Stack>
    </Box>
  );
}
