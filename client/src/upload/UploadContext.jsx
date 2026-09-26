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
import { makeThumbnail, fazerPrevia } from "./thumbnail.js";

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

/**
 * A PRÉVIA depois de subir — a arte no tamanho em que ela aparece na tela.
 *
 * Vai depois, e não junto, por dois motivos: reduzir uma arte de 6 MB leva o
 * seu tempo, e o envio não pode ficar esperando por isso; e se der errado, o
 * arquivo já está salvo do mesmo jeito. Sem prévia a tela usa a arte inteira,
 * como sempre fez.
 */
async function mandaPreviaDepois(fileId, file) {
  if (!fileId) return;
  try {
    const previa = await fazerPrevia(file);
    if (!previa) return;
    const token = localStorage.getItem("token");
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const viewing = JSON.parse(localStorage.getItem("viewing_org") || "null");
      if (viewing?.id) headers["X-Org-Id"] = String(viewing.id);
    } catch { /* sem escritório selecionado */ }
    await fetch(`/api/files/${fileId}/previa`, { method: "PUT", headers, body: JSON.stringify({ previa }) });
  } catch { /* sem prévia a tela ainda funciona, só mais pesada */ }
}

// Acima disto o arquivo é "pesado": a miniatura demora a ser feita e o envio
// ocupa a internet por bastante tempo. Os dois casos pedem tratamento diferente.
const PESADO = 5 * 1024 * 1024;   // 5 MB
export const ehPesado = (file) => ehVideo(file) || (file?.size || 0) > PESADO;

async function uploadOne(file, { clientId, folderId, stage }, onProgress) {
  // A MINIATURA SÓ VAI JUNTO QUANDO É BARATA.
  //
  // Ela era feita ANTES de abrir a conexão, sempre. Numa arte de 12 MB isso é
  // decodificar, desenhar no canvas e recomprimir — segundos em que a vaga de
  // envio fica ocupada e a internet, parada. Com três vagas, três arquivos
  // pesados paravam a fila inteira para fazer contas.
  //
  // Agora o arquivo pesado sobe primeiro e manda a miniatura depois, do mesmo
  // jeito que o vídeo já fazia. A grade fica um instante sem miniatura e nada
  // mais — a prévia e a miniatura chegam logo atrás.
  const thumb = ehPesado(file) ? null : await makeThumbnail(file);
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
  // DUAS FILAS, não uma. Antes eram três vagas para todo mundo, e um vídeo de
  // 200 MB segurava uma delas por minutos: catorze artes de 900 KB ficavam
  // esperando atrás de coisa que não tem nada a ver com elas.
  //
  // Agora o leve e o pesado correm em raias separadas — e é a SEPARAÇÃO que
  // resolve: as artes deixam de esperar atrás de coisa que não tem nada a ver
  // com elas.
  //
  // O total tem teto de propósito. O navegador abre no máximo SEIS conexões
  // por site, e uma delas é o canal ao vivo (SSE) que avisa as telas de que
  // chegou arquivo novo. Ocupando as seis com envio, o canal fica sem vaga e a
  // Galeria para de saber que algo mudou — era preciso apertar F5. Então:
  // quatro vagas para o leve, uma para o pesado, e uma sobra para o canal e
  // para a própria tela.
  //
  // Um só para o pesado não custa nada: dois vídeos grandes ao mesmo tempo
  // dividem a mesma banda e terminam no mesmo tempo que em fila.
  const enqueue = useCallback((fileList, opts = {}) => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    setOpen(true);
    const novos = files.map((file) => ({
      id: ++SEQ, name: file.name, progress: 0, status: "aguardando", error: null, aviso: null, _file: file,
    }));
    setJobs((prev) => [...novos, ...prev]);

    const leves = novos.filter((j) => !ehPesado(j._file));
    const pesados = novos.filter((j) => ehPesado(j._file));

    const rodaFila = (fila, vagas) => {
      let proximo = 0;
      const roda = async () => {
        while (proximo < fila.length) {
          const job = fila[proximo++];
          await enviaUm(job);
        }
      };
      for (let i = 0; i < Math.min(vagas, fila.length); i++) roda();
    };

    const enviaUm = async (job) => {
      patch(job.id, { status: "enviando" });
        try {
          const criados = await uploadOne(job._file, opts, (p) => patch(job.id, { progress: p }));
          // O servidor avisa quando já havia um arquivo igual (mesmo nome e
          // mesmo tamanho) naquela pasta. O envio não é bloqueado — às vezes é
          // de propósito — mas o aviso evita a galeria encher de repetidos sem
          // ninguém perceber.
          patch(job.id, {
            status: "pronto", progress: 100,
            aviso: criados?.[0]?.repetida ? "já havia uma igual nesta pasta" : null,
          });
          // O pesado subiu sem miniatura (ela não cabia no caminho crítico):
          // ela vai agora, com o arquivo já guardado. O leve já mandou a dele
          // junto e só precisa da prévia.
          const id = criados?.[0]?.id;
          if (ehPesado(job._file)) mandaMiniaturaDepois(id, job._file);
          if (!ehVideo(job._file)) mandaPreviaDepois(id, job._file);
          // Dica extra pras telas que não usam SSE (o canal ao vivo já avisa).
          window.dispatchEvent(new CustomEvent("files-uploaded", { detail: opts }));
          removeLater(job.id, criados?.[0]?.repetida ? 10000 : 4000);
      } catch (err) {
        patch(job.id, { status: "erro", error: err.message || "Falha no envio." });
        removeLater(job.id, 12000);
      }
    };

    rodaFila(leves, 4);
    rodaFila(pesados, 1);
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
                  {j.status === "pronto" && j.aviso && (
                    <Typography variant="caption" color="warning.main">{j.aviso}</Typography>
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
