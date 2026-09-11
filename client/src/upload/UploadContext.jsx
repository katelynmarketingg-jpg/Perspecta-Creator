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
import { makeThumbnail } from "./thumbnail.js";

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
const ehVideo = (file) => /^video\//.test(file?.type || "");

const tamanho = (bytes) => (bytes > 1048576
  ? `${(bytes / 1048576).toFixed(0)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * Por que o envio falhou, em português e com o que fazer. O 413 tem tratamento
 * próprio: quando o site está atrás de um intermediário (Cloudflare, por
 * exemplo), o arquivo pode ser barrado ANTES de chegar no sistema, e a mensagem
 * crua não diz nada para quem está do outro lado.
 */
function explicaFalha(xhr, file) {
  const mb = tamanho(file.size);
  if (xhr.status === 413) {
    return `"${file.name}" (${mb}) foi recusado por ser grande demais. `
      + "Se for vídeo, exporte numa qualidade menor (1080p costuma resolver) e tente de novo.";
  }
  if (xhr.status === 401) return "Sua sessão expirou. Atualize a página e entre de novo.";
  if (xhr.status === 0) return `O envio de "${file.name}" (${mb}) foi interrompido antes de terminar.`;
  let msg = "";
  try { msg = JSON.parse(xhr.responseText)?.error || ""; } catch { /* resposta não é JSON */ }
  return msg || `Não consegui enviar "${file.name}" (${mb}) — erro ${xhr.status}.`;
}

/**
 * A miniatura DEPOIS de subir, para o vídeo não ficar esperando.
 *
 * Tirar um quadro de um vídeo custa caro: o navegador precisa abrir o arquivo,
 * procurar o momento e desenhar — e em alguns .mov ele nem consegue, e só
 * desiste depois de 8 segundos. Fazer isso ANTES de enviar significava o vídeo
 * ficar parado esse tempo todo sem nada acontecer na tela. Agora o arquivo
 * sobe na hora e a miniatura chega em seguida, sem ninguém esperando por ela.
 */
async function mandaMiniaturaDepois(fileId, file) {
  if (!fileId) return;
  try {
    const thumb = await makeThumbnail(file);
    if (!thumb) return;
    const token = localStorage.getItem("token");
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const viewing = JSON.parse(localStorage.getItem("viewing_org") || "null");
      if (viewing?.id) headers["X-Org-Id"] = String(viewing.id);
    } catch { /* sem escritório selecionado */ }
    await fetch(`/api/files/${fileId}/thumb`, { method: "PUT", headers, body: JSON.stringify({ thumb }) });
  } catch { /* sem miniatura a grade ainda funciona, só mais pesada */ }
}

async function uploadOne(file, { clientId, folderId, stage }, onProgress) {
  // Foto: a miniatura sai em milissegundos, então vai junto no mesmo envio e a
  // grade já nasce leve. Vídeo: vai depois (veja acima).
  const thumb = ehVideo(file) ? null : await makeThumbnail(file);
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("files", file);
    if (thumb) form.append("thumbs", JSON.stringify([thumb]));
    if (clientId) form.append("client_id", clientId);
    if (folderId) form.append("folder_id", folderId);
    // A etapa em que o material entra (originais, editados, aprovação…). Sem
    // ela o servidor usa "originais", que é o certo para quem está subindo
    // material bruto — mas não para quem está mandando conteúdo pronto.
    if (stage) form.append("stage", stage);

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
        reject(new Error(explicaFalha(xhr, file)));
      }
    };
    xhr.onerror = () => reject(new Error(
      `A conexão caiu no meio do envio de "${file.name}" (${tamanho(file.size)}). `
      + "Arquivo grande em internet instável costuma ser isso — tente de novo, de preferência no Wi-Fi."
    ));
    // Sem isto, um envio travado fica girando para sempre e parece que o
    // sistema "não faz nada". 30 minutos cobre vídeo grande em internet ruim.
    xhr.timeout = 30 * 60 * 1000;
    xhr.ontimeout = () => reject(new Error(
      `"${file.name}" (${tamanho(file.size)}) demorou demais e foi interrompido. `
      + "Se for um vídeo longo, tente exportar numa qualidade menor."
    ));
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
  //
  // De três em três, não todos de uma vez: mandar 20 arquivos juntos faz eles
  // disputarem a mesma internet e TODOS ficarem lentos (e o navegador ainda
  // segura as conexões extras numa fila invisível, sem mostrar progresso).
  // Em blocos, os primeiros terminam rápido e a barra anda de verdade.
  const enqueue = useCallback((fileList, opts = {}) => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    setOpen(true);
    const novos = files.map((file) => ({
      id: ++SEQ, name: file.name, progress: 0, status: "aguardando", error: null, _file: file,
    }));
    setJobs((prev) => [...novos, ...prev]);

    const AO_MESMO_TEMPO = 3;
    let proximo = 0;
    const roda = async () => {
      while (proximo < novos.length) {
        const job = novos[proximo++];
        patch(job.id, { status: "enviando" });
        try {
          const criados = await uploadOne(job._file, opts, (p) => patch(job.id, { progress: p }));
          patch(job.id, { status: "pronto", progress: 100 });
          // Vídeo: agora que ele já está guardado, a miniatura pode demorar o
          // quanto precisar — não segura mais ninguém na fila.
          if (ehVideo(job._file)) mandaMiniaturaDepois(criados?.[0]?.id, job._file);
          // Dica extra pras telas que não usam SSE (o canal ao vivo já avisa).
          window.dispatchEvent(new CustomEvent("files-uploaded", { detail: opts }));
          removeLater(job.id, 4000);
        } catch (err) {
          patch(job.id, { status: "erro", error: err.message || "Falha no envio." });
          removeLater(job.id, 12000);
        }
      }
    };
    for (let i = 0; i < Math.min(AO_MESMO_TEMPO, novos.length); i++) roda();
  }, [patch, removeLater]);

  const ativos = jobs.filter((j) => j.status === "enviando" || j.status === "aguardando").length;

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
                  {j.status === "aguardando" && (
                    <Typography variant="caption" color="text.secondary">na fila…</Typography>
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
