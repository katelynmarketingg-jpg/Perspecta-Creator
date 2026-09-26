import { useEffect, useRef, useState } from "react";
import {
  Box, Button, Card, CardContent, Typography, IconButton, Stack, TextField,
  MenuItem, Breadcrumbs, Link, Dialog, DialogTitle, DialogContent, DialogActions,
  Grid, Tooltip, Menu, Alert, CircularProgress, Chip,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import FolderIcon from "@mui/icons-material/Folder";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import ImageIcon from "@mui/icons-material/Image";
import MovieIcon from "@mui/icons-material/Movie";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import DriveFileMoveIcon from "@mui/icons-material/DriveFileMove";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import api from "../api/client.js";
import { thumbFromElement } from "../upload/thumbnail.js";
import { guardarPrevia, reforcarPrevia } from "../upload/previa-envio.js";
import { fatiarEmSlides } from "../upload/carousel.js";
import { sugerirSlides } from "../upload/carousel.js";
import AreaDeSoltar from "../upload/AreaDeSoltar.jsx";
import { ehHeic, heicParaJpeg } from "../upload/heic.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { useUploads } from "../upload/UploadContext.jsx";
import { PageHeader } from "../components/ui.jsx";
import { fileSize } from "../utils.js";

// Ordem lógica das pastas padrão (as que nascem dentro de cada cliente).
const DEFAULT_ORDER = ["Originais", "Editados", "Para aprovação", "Aprovados", "Programados"];
function ordenarPastas(arr) {
  const pos = (nome) => { const i = DEFAULT_ORDER.indexOf(nome); return i === -1 ? 999 : i; };
  return [...arr].sort((a, b) => {
    const pa = pos(a.name), pb = pos(b.name);
    if (pa !== pb) return pa - pb;            // padrão primeiro, na ordem certa
    return a.name.localeCompare(b.name, "pt"); // o resto, alfabético
  });
}

function fileIcon(mime = "") {
  if (mime.startsWith("image/")) return <ImageIcon color="primary" />;
  if (mime.startsWith("video/")) return <MovieIcon color="primary" />;
  return <InsertDriveFileIcon color="disabled" />;
}

function authFetchBlob(id) {
  const token = localStorage.getItem("token");
  return fetch(`/api/files/${id}/download`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.blob());
}

// Cartão de um arquivo: a prévia sai NA PROPORÇÃO REAL da foto/vídeo (retrato de
// reel fica em pé, paisagem fica deitado). A grade usa a MINIATURA leve gerada
// no envio — antes cada quadradinho baixava o arquivo original inteiro, o que
// deixava a tela lenta e vídeo grande nem desenhava. Clicar abre o arquivo de
// verdade, em tamanho grande e sem baixar.
// O nome fica embaixo e é editável com UM CLIQUE (clica fora ou Enter → salva).
// Guarda quais arquivos já tiveram a miniatura enviada nesta sessão, para não
// repetir a cada rolagem da tela.
const thumbsEnviadas = new Set();

// Gera a miniatura a partir da mídia JÁ CARREGADA na grade e guarda no servidor.
// É isso que conserta os arquivos enviados antes da miniatura existir: na
// primeira vez a grade ainda usa o original (como sempre usou); da segunda em
// diante, todo mundo pega a versão leve.
async function guardarMiniatura(fileId, el) {
  if (!fileId || thumbsEnviadas.has(fileId)) return;
  thumbsEnviadas.add(fileId);
  const thumb = thumbFromElement(el);
  if (!thumb) return;
  try { await api.put(`/files/${fileId}/thumb`, { thumb }); }
  catch { thumbsEnviadas.delete(fileId); } // deixa tentar de novo depois
}

// Foto de iPhone (.HEIC) que ainda não tem miniatura: o navegador não desenha
// esse formato — era o quadrado quebrado da Galeria. Converte aqui uma vez, e a
// miniatura gerada fica guardada no servidor (o onLoad abaixo cuida disso), de
// modo que na próxima visita já vem pronta e nem baixa a biblioteca.
const heicConvertidos = new Map();  // id do arquivo -> Promise<url do JPEG>

function converterHeic(f) {
  if (!heicConvertidos.has(f.id)) {
    heicConvertidos.set(f.id, (async () => {
      const resp = await fetch(f.media_url);
      if (!resp.ok) return null;
      const jpeg = await heicParaJpeg(await resp.blob());
      return jpeg ? URL.createObjectURL(jpeg) : null;
    })().catch(() => null));
  }
  return heicConvertidos.get(f.id);
}

// ---------------------------------------------------------------------------
// A GRADE TEM A FORMA DE UM POST (4:5).
//
// Antes cada quadro se ajustava à mídia (`contain`), e isso estragava os dois
// casos mais comuns dela:
//
//  · O CARROSSEL é salvo como UMA arte larga — a tira com as slides lado a
//    lado. Ajustado pela largura, virava um filete de 2 cm de altura, sem dar
//    para ver nada. Agora a tira é recortada na primeira slide, que é a capa —
//    o mesmo que a Distribuição já fazia.
//
//  · O VÍDEO vertical ganhava tarja preta dos lados. Agora preenche o quadro,
//    com o corte mínimo para a borda sumir ("um pequeno zoom", nas palavras
//    dela).
//
// O corte é só na grade. Clicar abre a mídia inteira, sem corte nenhum.
// ---------------------------------------------------------------------------
const FORMA_DO_POST = 4 / 5;

// A setinha fica sobre a arte, dos dois lados, com fundo escuro para aparecer
// tanto numa capa clara quanto numa escura.
const setaSx = (lado) => ({
  position: "absolute", top: "50%", [lado]: 4, transform: "translateY(-50%)",
  bgcolor: "rgba(0,0,0,0.5)", color: "#fff", "&:hover": { bgcolor: "rgba(0,0,0,0.72)" },
});

/** A arte é uma tira de carrossel? Devolve quantas slides, ou 1. */
function slidesDaTira(w, h) {
  if (!w || !h) return 1;
  // Só vale a pena perguntar quando a arte é mais larga que um post; assim um
  // retrato comum nem passa pela dedução.
  if (w / h <= 1.05) return 1;
  const { n } = sugerirSlides(w, h);
  return n > 1 ? n : 1;
}

function FileCard({ f, onDownload, onDelete, onSaveName, onMoveFolder }) {
  const [moreAnchor, setMoreAnchor] = useState(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(f.original_name || "");
  const [viewing, setViewing] = useState(false);
  const ehImg = f.mime?.startsWith("image/");
  const ehVideo = f.mime?.startsWith("video/");
  const heic = ehHeic(f.original_name, f.mime);
  const [heicUrl, setHeicUrl] = useState(null);
  useEffect(() => { setName(f.original_name || ""); }, [f.original_name]);

  // Converte só quando é HEIC, ainda não tem miniatura e o arquivo é acessível.
  useEffect(() => {
    if (!heic || f.thumb || !f.media_url) return undefined;
    let vivo = true;
    converterHeic(f).then((u) => { if (vivo) setHeicUrl(u); });
    return () => { vivo = false; };   // não revoga: o cache é dono da URL
  }, [heic, f.thumb, f.media_url, f.id]);

  function salvar() {
    setEditing(false);
    const novo = name.trim();
    if (novo && novo !== f.original_name && onSaveName) onSaveName(f.id, novo);
    else setName(f.original_name || "");
  }

  const podeAbrir = (ehImg || ehVideo) && f.media_url;
  // Miniatura quando existe (arquivos enviados a partir de agora); senão, o
  // original — assim o que já está lá continua aparecendo. No HEIC o original
  // não serve: usamos a conversão feita no navegador.
  // A grade usa a miniatura; sem ela, a PRÉVIA (arte reduzida); só em último
  // caso a arte inteira. Antes um arquivo sem miniatura fazia o quadradinho
  // baixar os 6 MB do original.
  // QUAL IMAGEM A GRADE USA.
  //
  // A miniatura tem 480px no lado maior. Isso bastava quando o quadro era um
  // selo de 150px; com o quadro maior E com o corte preenchendo (`cover`), ela
  // aparece esticada — foi o "ficou com a qualidade ruim". Numa tira de
  // carrossel é pior ainda: os 480px são da TIRA INTEIRA, então cada slide fica
  // com 96px e é ampliada para o dobro.
  //
  // Então a ordem passa a ser a PRÉVIA primeiro (1080px, feita no envio), e a
  // miniatura só como reserva rápida enquanto a prévia não existe. O original
  // continua sendo o último recurso — ele tem megabytes e não é para a grade.
  const previa = heic
    ? (heicUrl || f.thumb)
    : (f.preview_url || f.thumb || f.media_url);
  const convertendo = heic && !f.thumb && !heicUrl;
  // Em tela cheia vale a mesma regra: o .HEIC precisa da versão convertida.
  const grandao = heic ? (heicUrl || f.thumb) : f.media_url;
  // Mede a arte quando ela carrega: é a medida que diz se é uma tira de
  // carrossel e, se for, de quantas slides.
  const [medida, setMedida] = useState(null);      // { w, h, n }
  function medir(el) {
    const w = el.naturalWidth || el.videoWidth, h = el.naturalHeight || el.videoHeight;
    if (!w || !h) return;
    const n = slidesDaTira(w, h);
    setMedida({ w, h, n });
    // PRÉVIA GROSSA DEMAIS PARA UMA TIRA. A prévia antiga tinha 1080px na arte
    // inteira; numa tira de 7 slides isso dá 154px por slide, e ampliar para
    // preencher o quadro sai borrado. Quando a conta não fecha, pede uma prévia
    // nova, feita a partir do original — uma vez por arquivo.
    if (n > 1 && w / n < 420) reforcarPrevia(f.id);
  }

  // BAIXAR CORTADO: a tira vira N arquivos, um por slide, prontos para publicar.
  // O corte é o mesmo da Distribuição, feito aqui no navegador — o original na
  // nuvem não é tocado.
  async function baixarCortado() {
    if (!grandao || cortando) return;
    setCortando(true);
    try {
      const resp = await fetch(grandao);
      const blob = await resp.blob();
      const arquivo = new File([blob], f.original_name || "carrossel.png", { type: blob.type });
      const fatias = await fatiarEmSlides(arquivo, slides);
      for (const fatia of fatias) {
        const url = URL.createObjectURL(fatia);
        const a = document.createElement("a");
        a.href = url; a.download = fatia.name;
        document.body.appendChild(a); a.click(); a.remove();
        // Um instante entre os downloads: disparar todos juntos faz o navegador
        // engolir os últimos sem avisar.
        await new Promise((r) => setTimeout(r, 250));
        URL.revokeObjectURL(url);
      }
    } catch { /* o botão volta ao normal; o download inteiro continua ali */ }
    setCortando(false);
  }
  const slides = medida?.n || 1;
  const ehCarrossel = slides > 1;
  const [lamina, setLamina] = useState(0);            // qual slide está à frente
  const atual = Math.min(lamina, slides - 1);
  const [cortando, setCortando] = useState(false);

  // O QUADRO: sempre a forma de um post. A mídia preenche, cortando o mínimo.
  const quadroSx = { position: "relative", width: "100%", aspectRatio: "4 / 5", overflow: "hidden",
                     bgcolor: "action.hover", cursor: podeAbrir ? "zoom-in" : "default" };

  // A TIRA DO CARROSSEL ancorada na primeira slide.
  //
  // A slide tem que preencher o quadro: se ela é mais larga que 4:5 (uma capa
  // quadrada, por exemplo), encaixa pela altura e o que sobra dos lados é
  // cortado; se é mais alta, encaixa pela largura. `fator` é o quanto UMA slide
  // ocupa da largura do quadro depois desse encaixe.
  const rSlide = medida ? (medida.w / slides) / medida.h : FORMA_DO_POST;
  const fator = rSlide / FORMA_DO_POST;
  const tiraSx = ehCarrossel
    ? (rSlide >= FORMA_DO_POST
      // Slide "larga": altura cheia, e a tira fica com n × fator da largura.
      ? { position: "absolute", top: 0, left: 0, height: "100%", width: `${slides * 100 * fator}%`,
          maxWidth: "none", display: "block",
          transform: `translateX(-${atual * (100 / slides)}%)`, transition: "transform .2s ease" }
      // Slide "alta": largura cheia, o que sobra em cima e embaixo é cortado.
      : { position: "absolute", top: "50%", left: 0, width: `${slides * 100}%`, height: "auto",
          maxWidth: "none", display: "block",
          transform: `translate(-${atual * (100 / slides)}%, -50%)`, transition: "transform .2s ease" })
    : null;

  // Imagem ou vídeo comum: preenche o quadro. É o "pequeno zoom" que tira a
  // tarja preta dos vídeos verticais.
  const midiaSx = { position: "absolute", inset: 0, width: "100%", height: "100%",
                    objectFit: "cover", display: "block", bgcolor: ehVideo ? "#000" : "action.hover" };

  return (
    <Card variant="outlined" sx={{ overflow: "hidden" }}>
      <Box sx={quadroSx} onClick={() => podeAbrir && setViewing(true)}>
        {ehImg && previa ? (
          <Box component="img" src={previa} alt={f.original_name} loading="lazy"
            sx={ehCarrossel ? tiraSx : midiaSx}
            onLoad={(e) => {
              medir(e.currentTarget);
              if (!f.thumb) guardarMiniatura(f.id, e.currentTarget);
              // CONSERTA O QUE JÁ SUBIU. A prévia (1080px) é o que a grade usa
              // agora; quem foi enviado antes dela existir só tem a miniatura
              // de 480px e aparece estourado no quadro maior. Ao desenhar a
              // arte aqui, a prévia é gerada e guardada — uma vez por arquivo,
              // e da próxima visita já vem pronta.
              if (!f.preview_url) guardarPrevia(f.id, e.currentTarget);
            }} />
        ) : convertendo ? (
          <Stack alignItems="center" spacing={1} sx={{ position: "absolute", inset: 0, justifyContent: "center", color: "text.secondary" }}>
            <CircularProgress size={20} />
            <Typography variant="caption">preparando a foto do iPhone…</Typography>
          </Stack>
        ) : ehVideo && f.thumb ? (
          <>
            <Box component="img" src={f.thumb} alt={f.original_name} loading="lazy" sx={midiaSx} />
            <PlayCircleIcon sx={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              fontSize: 44, color: "rgba(255,255,255,0.92)",
              filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.6))", pointerEvents: "none" }} />
          </>
        ) : ehVideo && f.media_url ? (
          // Vídeo antigo (sem miniatura): mostra o 1º quadro, como antes — e
          // aproveita esse quadro para guardar a miniatura.
          <>
            <Box component="video" src={`${f.media_url}#t=0.1`} preload="metadata" muted playsInline sx={midiaSx}
              onLoadedData={(e) => guardarMiniatura(f.id, e.currentTarget)} />
            <PlayCircleIcon sx={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              fontSize: 44, color: "rgba(255,255,255,0.92)",
              filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.6))", pointerEvents: "none" }} />
          </>
        ) : (
          <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>{fileIcon(f.mime)}</Box>
        )}

        {/* Que é um carrossel, e em qual lâmina estamos. O corte esconde o
            resto, então o quadro precisa dizer que tem mais atrás. */}
        {ehCarrossel && (
          <Chip size="small" label={`${atual + 1}/${slides}`}
            sx={{ position: "absolute", top: 6, right: 6, height: 20, bgcolor: "rgba(0,0,0,0.62)",
                  color: "#fff", fontWeight: 600, pointerEvents: "none" }} />
        )}

        {/* AS SETINHAS. Passar as lâminas sem sair da Galeria — o clique nelas
            não pode abrir a arte em tela cheia, por isso o stopPropagation. */}
        {ehCarrossel && (
          <>
            {atual > 0 && (
              <IconButton size="small" aria-label="lâmina anterior"
                onClick={(e) => { e.stopPropagation(); setLamina(atual - 1); }}
                sx={setaSx("left")}>
                <ChevronLeftIcon fontSize="small" />
              </IconButton>
            )}
            {atual < slides - 1 && (
              <IconButton size="small" aria-label="próxima lâmina"
                onClick={(e) => { e.stopPropagation(); setLamina(atual + 1); }}
                sx={setaSx("right")}>
                <ChevronRightIcon fontSize="small" />
              </IconButton>
            )}
          </>
        )}
      </Box>
      <Box sx={{ p: 1 }}>
        {editing ? (
          <TextField value={name} onChange={(e) => setName(e.target.value)} autoFocus fullWidth variant="standard"
            onBlur={salvar}
            onKeyDown={(e) => { if (e.key === "Enter") salvar(); if (e.key === "Escape") { setName(f.original_name || ""); setEditing(false); } }}
            inputProps={{ style: { fontSize: 12, fontWeight: 600 } }} />
        ) : (
          <Tooltip title="Clique no nome para renomear">
            <Typography noWrap variant="caption" onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              sx={{ display: "block", fontWeight: 600, cursor: "text", "&:hover": { textDecoration: "underline dotted" } }}>
              {f.original_name || "Sem nome"}
            </Typography>
          </Tooltip>
        )}
        <Typography variant="caption" color="text.secondary">{fileSize(f.size)}</Typography>
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
          <Tooltip title="Baixar original">
            <IconButton size="small" color="primary" onClick={() => onDownload(f)}><DownloadIcon sx={{ fontSize: 17 }} /></IconButton>
          </Tooltip>
          {/* O carrossel também precisa do menu, pelo "baixar cortado" — antes
              ele só existia quando dava para mover de pasta. */}
          {(onMoveFolder || ehCarrossel) && (
            <Tooltip title={ehCarrossel ? "Mais: baixar cortado, mover…" : "Mover para pasta"}>
              <IconButton size="small" onClick={(e) => setMoreAnchor(e.currentTarget)}><MoreVertIcon sx={{ fontSize: 17 }} /></IconButton>
            </Tooltip>
          )}
          <Tooltip title="Excluir">
            <IconButton size="small" color="error" onClick={() => onDelete(f.id)}><DeleteIcon sx={{ fontSize: 17 }} /></IconButton>
          </Tooltip>
        </Stack>
      </Box>
      {(onMoveFolder || ehCarrossel) && (
        <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
          {/* BAIXAR CORTADO: a tira vira N arquivos, um por lâmina, prontos
              para publicar — em vez de baixar a tira e cortar na mão. */}
          {ehCarrossel && (
            <MenuItem disabled={cortando}
              onClick={() => { setMoreAnchor(null); baixarCortado(); }}>
              <ContentCutIcon sx={{ fontSize: 17, mr: 1 }} />
              {cortando ? "Cortando…" : `Baixar cortado (${slides} lâminas)`}
            </MenuItem>
          )}
          {onMoveFolder && (
            <MenuItem onClick={() => { setMoreAnchor(null); onMoveFolder(f); }}>
              <DriveFileMoveIcon sx={{ fontSize: 17, mr: 1 }} /> Mover para pasta
            </MenuItem>
          )}
        </Menu>
      )}
      {/* Abrir em tela cheia: foto amplia, vídeo toca (na proporção real). */}
      <Dialog open={viewing} onClose={() => setViewing(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ pr: 6 }}>
          {f.original_name}
          <IconButton onClick={() => setViewing(false)} sx={{ position: "absolute", right: 8, top: 8 }}>✕</IconButton>
        </DialogTitle>
        <DialogContent sx={{ display: "grid", placeItems: "center", bgcolor: "#000", p: 1 }}>
          {ehVideo ? (
            <Box component="video" src={f.media_url} controls autoPlay playsInline
              sx={{ width: "100%", maxHeight: "72vh", objectFit: "contain" }} />
          ) : (
            <Box component="img" src={grandao} alt={f.original_name}
              sx={{ width: "100%", maxHeight: "72vh", objectFit: "contain" }} />
          )}
        </DialogContent>
        <DialogActions>
          <Button startIcon={<DownloadIcon />} onClick={() => onDownload(f)}>Baixar original</Button>
          <Button onClick={() => setViewing(false)}>Fechar</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

export default function Files() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  // Navegação por pastas: trilha [{id,name}], pastas e arquivos da pasta atual.
  const [path, setPath] = useState([]);
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [uploadingZip, setUploadingZip] = useState(false);
  const { enqueue } = useUploads();
  const docInputRef = useRef(null);
  const zipInputRef = useRef(null);
  const [zipMsg, setZipMsg] = useState("");
  const [allFolders, setAllFolders] = useState([]); // todas as pastas do cliente (p/ mover)
  const [moveTarget, setMoveTarget] = useState(null); // { id, folder_id }

  const currentFolder = path[path.length - 1]?.id || null;

  useEffect(() => { api.get("/clients").then((r) => setClients(r.data)); }, []);

  // A LISTA DE ARQUIVOS É A RESPOSTA MAIS PESADA DO SISTEMA.
  //
  // Cada arquivo leva a miniatura embutida, então um cliente com 120 arquivos
  // devolve 1,25 MB. Medido ao abrir um cliente: essa MESMA lista era pedida
  // TRÊS vezes seguidas — 3,75 MB para mostrar uma tela só. São três efeitos
  // disparando quase juntos (o que garante as pastas padrão, o que responde à
  // troca de cliente/pasta e o do canal ao vivo).
  //
  // Esta marca guarda qual lista já foi pedida. Pedido repetido da mesma coisa
  // não sai de novo; pedido de outra pasta, de outro cliente ou depois de
  // alguém mexer nos arquivos (vFiles) sai normalmente.
  const ultimaLista = useRef(null);

  const loadFolders = () => {
    if (!clientId) { setFolders([]); return; }
    const fParams = { client_id: clientId };
    if (currentFolder) fParams.parent_id = currentFolder;
    api.get("/files/folders", { params: fParams }).then((r) => setFolders(ordenarPastas(r.data))).catch(() => setFolders([]));
  };

  const loadDocs = (forcar = false) => {
    if (!clientId) { setFolders([]); setFiles([]); ultimaLista.current = null; return; }
    loadFolders();
    const marca = `${clientId}|${currentFolder || ""}|${vFilesRef.current}`;
    if (!forcar && ultimaLista.current === marca) return;
    ultimaLista.current = marca;
    // Arquivos da pasta atual (na raiz, os "soltos" sem pasta).
    const aParams = { client_id: clientId };
    if (currentFolder) aParams.folder_id = currentFolder;
    api.get("/files", { params: aParams })
      .then((r) => setFiles(r.data))
      .catch(() => { setFiles([]); ultimaLista.current = null; });
  };
  const loadAllFolders = () => {
    if (!clientId) { setAllFolders([]); return; }
    api.get("/files/folders", { params: { client_id: clientId, all: 1 } }).then((r) => setAllFolders(r.data)).catch(() => setAllFolders([]));
  };
  // Ao abrir um cliente, garante as pastas padrão (Originais, Editados…) dentro dele.
  useEffect(() => {
    if (!clientId) return;
    // Só as PASTAS aqui: a lista de arquivos é pedida pelo efeito de baixo.
    // Antes este ponto pedia a lista inteira também, e ela vinha duas vezes.
    api.post("/files/folders/ensure-defaults", { client_id: clientId }).then(loadFolders).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  // Ao vivo: 'vFiles' muda quando alguém envia/move/apaga arquivos.
  const vFiles = useLiveVersion("files");
  const vFilesRef = useRef(vFiles);
  vFilesRef.current = vFiles;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadDocs(); }, [clientId, currentFolder, vFiles]);
  useEffect(() => { loadAllFolders(); }, [clientId, vFiles]);

  // O ENVIO TERMINOU: recarrega, sem depender do canal ao vivo.
  //
  // A Galeria só sabia de arquivo novo pelo SSE. Quando esse aviso não chega —
  // e durante um envio ele é justamente o que mais corre risco, porque as
  // conexões do navegador estão ocupadas — a fila sumia do canto da tela e os
  // arquivos não apareciam: só com F5. O envio já anuncia que terminou; agora
  // a tela escuta.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const aoTerminar = () => loadDocs(true);
    window.addEventListener("files-uploaded", aoTerminar);
    return () => window.removeEventListener("files-uploaded", aoTerminar);
  }, [clientId, currentFolder]);

  // Renomear direto pelo nome embaixo da foto (inline). Atualiza na hora.
  async function salvarNome(id, nome) {
    setFiles((prev) => prev.map((x) => (x.id === id ? { ...x, original_name: nome } : x)));
    try { await api.put(`/files/${id}`, { original_name: nome }); }
    catch { loadDocs(true); }
  }
  async function moverArquivoPasta() {
    await api.put(`/files/${moveTarget.id}`, { folder_id: moveTarget.folder_id || null });
    setMoveTarget(null); loadDocs(true);
  }

  function selectClient(id) { setClientId(id); setPath([]); }

  // ---- Pastas ----
  async function createFolder() {
    if (!newFolderName.trim()) return;
    await api.post("/files/folders", { name: newFolderName.trim(), client_id: clientId || null, parent_id: currentFolder });
    setNewFolderName(""); setNewFolderOpen(false); loadDocs(true);
  }
  async function removeFolder(id, nome) {
    // Apagar pasta apaga TUDO que está dentro dela, inclusive as subpastas, e
    // não tem como desfazer. O aviso diz isso com todas as letras — e depois a
    // tela conta quantos arquivos foram embora, para não sobrar dúvida.
    if (!confirm(
      `Excluir a pasta "${nome || ""}" com TUDO que está dentro (inclusive subpastas)?\n\n`
      + "Os arquivos são apagados de vez. Não dá para desfazer."
    )) return;
    try {
      const { data } = await api.delete(`/files/folders/${id}`);
      const n = data?.arquivos || 0;
      setZipMsg(n ? `Pasta excluída — ${n} arquivo(s) removido(s).` : "Pasta excluída.");
    } catch (err) {
      setZipMsg(err.response?.data?.error || "Não consegui excluir a pasta.");
    }
    loadDocs(true);
  }
  // Envia em SEGUNDO PLANO: solta os arquivos na fila e retorna na hora. A Katelyn
  // pode sair da galeria e seguir usando o sistema; o painel no canto mostra o
  // progresso e, ao terminar, o canal ao vivo recarrega esta tela sozinho.
  function enviarDocs(fileList) {
    if (!fileList?.length) return;
    enqueue(fileList, { clientId: clientId || null, folderId: currentFolder || null });
    if (docInputRef.current) docInputRef.current.value = "";
  }

  // ---- Importar em massa por .ZIP (para a pasta atual) ----
  async function enviarZip(file) {
    if (!file) return;
    setUploadingZip(true);
    setZipMsg("Importando o .ZIP… pode continuar usando o sistema.");
    try {
      const form = new FormData();
      form.append("zip", file);
      if (clientId) form.append("client_id", clientId);
      if (currentFolder) form.append("folder_id", currentFolder);
      const { data } = await api.post("/files/upload-zip", form, { headers: { "Content-Type": "multipart/form-data" } });
      setZipMsg(`Importei ${data.count} arquivo(s) do ZIP${data.ignorados ? ` (${data.ignorados} ignorado(s) por não serem foto/vídeo)` : ""}.`);
      loadDocs(true);
    } catch (e) {
      setZipMsg(e.response?.data?.error || "Não foi possível importar o ZIP.");
    } finally {
      setUploadingZip(false);
      if (zipInputRef.current) zipInputRef.current.value = "";
      setTimeout(() => setZipMsg(""), 8000);
    }
  }

  async function removeFile(id) {
    if (!confirm("Excluir arquivo?")) return;
    await api.delete(`/files/${id}`); loadDocs(true);
  }
  function download(file) {
    authFetchBlob(file.id).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = file.original_name; a.click();
      URL.revokeObjectURL(url);
    });
  }

  const vazio = folders.length === 0 && files.length === 0;

  return (
    <>
      <PageHeader
        title="Galeria"
        subtitle="Material por cliente, em pastas que você cria — enviado e baixado na qualidade original"
      />

      <TextField select size="small" label="Cliente" value={clientId}
        onChange={(e) => selectClient(e.target.value)} sx={{ minWidth: 240, mb: 2.5 }}>
        <MenuItem value="">Selecione um cliente…</MenuItem>
        {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
      </TextField>

      {!clientId ? (
        clients.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>Nenhum cliente cadastrado ainda.</Typography>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 2 }}>
            {clients.map((c) => (
              <Card key={c.id} onClick={() => selectClient(c.id)}
                sx={{ cursor: "pointer", border: 1, borderColor: "divider", "&:hover": { borderColor: "primary.main" } }}>
                <CardContent sx={{ textAlign: "center", py: 3 }}>
                  <FolderIcon sx={{ fontSize: 44, color: "primary.main" }} />
                  <Typography sx={{ fontWeight: 600, mt: 0.5 }} noWrap>{c.name}</Typography>
                </CardContent>
              </Card>
            ))}
          </Box>
        )
      ) : (
        // ARRASTAR A PASTA DO MÊS PARA DENTRO.
        //
        // A área cobre a galeria inteira: solta em cima, os arquivos entram na
        // pasta em que ela está. Pasta arrastada é aberta e o que tem dentro
        // sobe (inclusive subpastas), sem ninguém precisar abrir uma por uma.
        <AreaDeSoltar
          aoSoltar={enviarDocs}
          aviso={currentFolder
            ? `Vai para a pasta “${path[path.length - 1]?.name || ""}”`
            : "Vai para a raiz do cliente"}
          sx={{ minHeight: 320 }}
        >
          <Button size="small" onClick={() => selectClient("")} sx={{ mb: 1 }}>← Todos os clientes</Button>

          <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: "wrap", gap: 1 }} alignItems="center">
            <Button variant="outlined" startIcon={<CreateNewFolderIcon />} onClick={() => setNewFolderOpen(true)}>Nova pasta</Button>
            <Button variant="contained" startIcon={<UploadFileIcon />} onClick={() => docInputRef.current?.click()}>
              {currentFolder ? "Enviar para a pasta" : "Enviar arquivo"}
            </Button>
            <input ref={docInputRef} type="file" multiple hidden onChange={(e) => enviarDocs(e.target.files)} />
            <Tooltip title="Envie um .ZIP com fotos/vídeos — importa tudo de uma vez para aqui">
              <Button variant="outlined" startIcon={<DriveFileMoveIcon />} disabled={uploadingZip} onClick={() => zipInputRef.current?.click()}>Importar .ZIP</Button>
            </Tooltip>
            <input ref={zipInputRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => enviarZip(e.target.files?.[0])} />
            <Breadcrumbs>
              <Link component="button" underline="hover" color={path.length ? "primary" : "text.primary"} onClick={() => setPath([])}>Início</Link>
              {path.map((p, i) => (
                <Link key={p.id} component="button" underline="hover"
                  color={i === path.length - 1 ? "text.primary" : "primary"}
                  onClick={() => setPath(path.slice(0, i + 1))}>{p.name}</Link>
              ))}
            </Breadcrumbs>
          </Stack>

          {zipMsg && <Alert severity="info" sx={{ mb: 2 }}>{zipMsg}</Alert>}

          {/* Pastas */}
          {folders.length > 0 && (
            <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
              {folders.map((f) => (
                <Grid item xs={6} sm={4} md={3} lg={2} key={f.id}>
                  <Card onClick={() => setPath([...path, { id: f.id, name: f.name }])}
                    sx={{ cursor: "pointer", "&:hover": { borderColor: "primary.main", bgcolor: (t) => alpha(t.palette.primary.main, 0.04) } }}>
                    <CardContent sx={{ display: "flex", alignItems: "center", gap: 1, p: 1.5, "&:last-child": { pb: 1.5 } }}>
                      <FolderIcon sx={{ color: "primary.main" }} />
                      <Typography noWrap sx={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{f.name}</Typography>
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); removeFolder(f.id, f.name); }}>
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}

          {/* Arquivos da pasta atual (na raiz, os soltos) */}
          {files.length > 0 && (
            <Grid container spacing={1.5}>
              {files.map((f) => (
                <Grid item xs={4} sm={3} md={2} key={f.id}>
                  <FileCard f={f} onDownload={download}
                    onDelete={removeFile}
                    onSaveName={salvarNome}
                    onMoveFolder={(file) => setMoveTarget({ id: file.id, folder_id: file.folder_id || "" })} />
                </Grid>
              ))}
            </Grid>
          )}

          {vazio && (
            <Card><CardContent sx={{ textAlign: "center", py: 5 }}>
              <Typography color="text.secondary">
                {currentFolder
                  ? 'Pasta vazia. Use "Enviar para a pasta" ou "Importar .ZIP".'
                  : 'Crie uma pasta com "Nova pasta" ou envie um arquivo direto para começar.'}
              </Typography>
            </CardContent></Card>
          )}
        </AreaDeSoltar>
      )}


      {/* Mover arquivo para outra pasta */}
      <Dialog open={Boolean(moveTarget)} onClose={() => setMoveTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>Mover para pasta</DialogTitle>
        <DialogContent>
          <TextField select label="Pasta de destino" fullWidth sx={{ mt: 1 }}
            value={moveTarget?.folder_id ?? ""}
            onChange={(e) => setMoveTarget((t) => ({ ...t, folder_id: e.target.value }))}>
            <MenuItem value="">Raiz (sem pasta)</MenuItem>
            {allFolders.map((f) => <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>)}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveTarget(null)}>Cancelar</Button>
          <Button variant="contained" onClick={moverArquivoPasta}>Mover</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={newFolderOpen} onClose={() => setNewFolderOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Nova pasta</DialogTitle>
        <DialogContent>
          <TextField label="Nome da pasta" fullWidth autoFocus sx={{ mt: 1 }}
            value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createFolder()} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewFolderOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={createFolder} disabled={!newFolderName.trim()}>Criar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
