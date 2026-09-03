import { createContext, useContext, useState, useCallback, useRef } from "react";
import {
  Box, Card, Typography, IconButton, LinearProgress, Stack, Collapse, Tooltip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";

// ---------------------------------------------------------------------------
// Envio em SEGUNDO PLANO. Fica montado no topo do app (fora das páginas), então
// a Katelyn pode clicar em "Enviar", sair da galeria e continuar usando o
// sistema — o upload segue rodando e um painelzinho no canto mostra o progresso.
// Quando termina, o canal ao vivo (SSE) avisa as telas abertas, que recarregam
// sozinhas. (A aba do navegador precisa continuar aberta.)
// ---------------------------------------------------------------------------
const UploadContext = createContext({ enqueue: () => {}, jobs: [] });
export const useUploads = () => useContext(UploadContext);

let SEQ = 0;

// Sobe UM arquivo por XHR (pra ter barra de progresso por arquivo). Resolve com
// a resposta do servidor; rejeita com uma mensagem amigável.
function uploadOne(file, { clientId, folderId }, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("files", file);
    if (clientId) form.append("client_id", clientId);
    if (folderId) form.append("folder_id", folderId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files/upload");
    const token = localStorage.getItem("token");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    try {
      const viewing = JSON.parse(localStorage.getItem("viewing_org") || "null");
      if (viewing?.id) xhr.setRequestHeader("X-Org-Id", String(viewing.id));
    } catch { /* sem escritório selecionado */ }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* ok */ }
        resolve(data);
      } else {
        let msg = "Falha no envio.";
        try { msg = JSON.parse(xhr.responseText)?.error || msg; } catch { /* ok */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Sem conexão durante o envio."));
    xhr.send(form);
  });
}

export function UploadProvider({ children }) {
  const [jobs, setJobs] = useState([]); // { id, name, progress, status, error }
  const [open, setOpen] = useState(true);
  const timers = useRef({});

  const patch = useCallback((id, upd) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...upd } : j)));
  }, []);

  const removeLater = useCallback((id, ms) => {
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => {
      setJobs((prev) => prev.filter((j) => j.id !== id));
    }, ms);
  }, []);

  // Enfileira uma lista de arquivos. Retorna na hora — o envio roda por trás.
  const enqueue = useCallback((fileList, opts = {}) => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    setOpen(true);
    const novos = files.map((file) => ({
      id: ++SEQ, name: file.name, progress: 0, status: "enviando", error: null, _file: file,
    }));
    setJobs((prev) => [...novos, ...prev]);

    novos.forEach((job) => {
      uploadOne(job._file, opts, (p) => patch(job.id, { progress: p }))
        .then(() => {
          patch(job.id, { status: "pronto", progress: 100 });
          // Dica extra pras telas que não usam SSE (o canal ao vivo já avisa).
          window.dispatchEvent(new CustomEvent("files-uploaded", { detail: opts }));
          removeLater(job.id, 4000);
        })
        .catch((err) => {
          patch(job.id, { status: "erro", error: err.message || "Falha no envio." });
          removeLater(job.id, 12000);
        });
    });
  }, [patch, removeLater]);

  const ativos = jobs.filter((j) => j.status === "enviando").length;

  return (
    <UploadContext.Provider value={{ enqueue, jobs }}>
      {children}
      {jobs.length > 0 && (
        <Card elevation={8} sx={{
          position: "fixed", right: 16, bottom: 16, zIndex: 1400, width: 320, maxWidth: "calc(100vw - 32px)",
          borderRadius: 2, overflow: "hidden",
        }}>
          <Stack direction="row" alignItems="center" spacing={1}
            sx={{ px: 1.5, py: 1, bgcolor: "primary.main", color: "primary.contrastText", cursor: "pointer" }}
            onClick={() => setOpen((o) => !o)}>
            <CloudUploadIcon fontSize="small" />
            <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
              {ativos > 0 ? `Enviando ${ativos} arquivo(s)…` : "Envios"}
            </Typography>
            <IconButton size="small" sx={{ color: "inherit" }}>
              {open ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
            </IconButton>
          </Stack>
          <Collapse in={open}>
            <Box sx={{ maxHeight: 260, overflowY: "auto", p: 1 }}>
              {jobs.map((j) => (
                <Box key={j.id} sx={{ px: 0.5, py: 0.75 }}>
                  <Stack direction="row" alignItems="center" spacing={0.75}>
                    {j.status === "pronto" && <CheckCircleIcon color="success" sx={{ fontSize: 16 }} />}
                    {j.status === "erro" && <ErrorOutlineIcon color="error" sx={{ fontSize: 16 }} />}
                    <Typography variant="caption" noWrap title={j.name} sx={{ flex: 1, fontWeight: 600 }}>
                      {j.name}
                    </Typography>
                    <Tooltip title="Tirar da lista">
                      <IconButton size="small" onClick={() => setJobs((p) => p.filter((x) => x.id !== j.id))}>
                        <CloseIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                  {j.status === "enviando" && (
                    <LinearProgress variant="determinate" value={j.progress}
                      sx={{ mt: 0.5, borderRadius: 2, height: 6 }} />
                  )}
                  {j.status === "erro" && (
                    <Typography variant="caption" color="error">{j.error}</Typography>
                  )}
                </Box>
              ))}
            </Box>
          </Collapse>
        </Card>
      )}
    </UploadContext.Provider>
  );
}
