import { useEffect, useRef, useState } from "react";
import {
  Box, Typography, TextField, Button, Stack, Avatar, Divider, CircularProgress,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import SendIcon from "@mui/icons-material/Send";

/**
 * Conversa de um post. A legenda fica fixa no topo (é sobre ela que se fala)
 * e os comentários vêm abaixo, com a agência de um lado e o cliente do outro.
 *
 * Serve aos dois lados: quem usa passa o `api` e o `eu` correspondentes.
 */
export default function PostComments({ taskId, caption, api, listPath, postPath, eu = "agency", compacto = false }) {
  const [comments, setComments] = useState([]);
  const [texto, setTexto] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const fimRef = useRef(null);

  const load = () => {
    setCarregando(true);
    api.get(listPath)
      .then((r) => setComments(r.data))
      .catch(() => setComments([]))
      .finally(() => setCarregando(false));
  };
  useEffect(() => { if (taskId) load(); }, [taskId]);

  useEffect(() => { fimRef.current?.scrollIntoView({ block: "nearest" }); }, [comments.length]);

  async function enviar() {
    const body = texto.trim();
    if (!body) return;
    setEnviando(true);
    try {
      const { data } = await api.post(postPath, { body });
      setComments((c) => [...c, data]);
      setTexto("");
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

      <Typography variant="subtitle2" sx={{ mb: 1 }}>Comentários</Typography>

      <Box sx={{ maxHeight: compacto ? 220 : 300, overflowY: "auto", pr: 0.5 }}>
        {carregando ? (
          <Stack alignItems="center" sx={{ py: 2 }}><CircularProgress size={20} /></Stack>
        ) : comments.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1.5 }}>
            Nenhum comentário ainda. Escreva abaixo o que precisa ser ajustado.
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

      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} alignItems="flex-end">
        <TextField
          size="small" fullWidth multiline maxRows={4} placeholder="Escreva um comentário…"
          value={texto} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); enviar(); }
          }}
        />
        <Button variant="contained" onClick={enviar} disabled={!texto.trim() || enviando}
          sx={{ minWidth: 44, px: 1.5 }}>
          <SendIcon fontSize="small" />
        </Button>
      </Stack>
    </Box>
  );
}
