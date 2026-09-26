import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  Box, Card, CardContent, Typography, TextField, MenuItem, Button, Stack,
  Chip, Alert, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  ToggleButtonGroup, ToggleButton, IconButton, Divider, Checkbox, Tooltip, Slider,
} from "@mui/material";
import CheckBoxIcon from "@mui/icons-material/CheckBox";
import ViewCarouselIcon from "@mui/icons-material/ViewCarousel";
import ScheduleSendIcon from "@mui/icons-material/ScheduleSend";
import SendIcon from "@mui/icons-material/Send";
import UploadIcon from "@mui/icons-material/Upload";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import ViewModuleIcon from "@mui/icons-material/ViewModule";
import ViewListIcon from "@mui/icons-material/ViewList";
import ViewComfyIcon from "@mui/icons-material/ViewComfy";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import GridOnIcon from "@mui/icons-material/GridOn";
import CalendarViewMonthIcon from "@mui/icons-material/CalendarViewMonth";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import StarIcon from "@mui/icons-material/Star";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import DescriptionIcon from "@mui/icons-material/Description";
import DownloadIcon from "@mui/icons-material/Download";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import api from "../api/client.js";
import { makeThumbnail } from "../upload/thumbnail.js";
import { ligarRolagemAoArrastar } from "../upload/rolar-arrastando.js";
import { agruparPosts } from "../upload/unir-carrossel.js";
import { medirImagem, fatiarEmSlides, sugerirSlides, LARGURA_ALVO } from "../upload/carousel.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { CONTENT_TYPES, formatDate, formatTime, whatsappLink } from "../utils.js";
import PlanningRefDialog from "../components/PlanningRefDialog.jsx";
import { thumbFromElement } from "../upload/thumbnail.js";
import { guardarPrevia } from "../upload/previa-envio.js";
import { carregarArte } from "../media.js";

// Cache de mídias por sessão: cada arquivo é baixado UMA vez e reaproveitado
// entre telas, filtros e re-renderizações. Antes cada componente rebaixava o
// blob e o revogava ao desmontar — trocar de visão/rolar recarregava tudo, o
// que deixava a Distribuição lenta. Aqui a URL do objeto vive enquanto a página
// estiver aberta (o cache é o dono; ninguém revoga).
function loadMedia(fileId) {
  if (!fileId) return Promise.resolve(null);
  // Passa pelo carregador compartilhado: é ele que converte a foto de iPhone
  // (.HEIC), que nenhum navegador desenha — era por isso que as fotos ficavam
  // em branco aqui, mesmo já aparecendo na Galeria.
  return carregarArte(
    `agencia:${fileId}`,
    () => api.get(`/files/${fileId}/download`, { responseType: "blob" }).then((r) => r.data)
  ).then((m) => ({ url: m.url, type: m.tipo }));
}

// Miniatura (leve) do arquivo: é o que desenha a grade do perfil sem baixar a
// arte inteira de cada quadrado. Vale para foto E vídeo — a miniatura do vídeo
// é um quadro dele, então a prévia aparece igual à da foto.
const _thumbCache = new Map();   // fileId -> data URI | null (null = não tem)
const _thumbInflight = new Map();
// Guarda a miniatura a partir da mídia já desenhada, para os arquivos enviados
// antes de a miniatura existir. Uma vez por arquivo por sessão.
const _thumbsEnviadas = new Set();
async function guardarMiniatura(fileId, el) {
  if (!fileId || _thumbsEnviadas.has(fileId)) return;
  _thumbsEnviadas.add(fileId);
  const thumb = thumbFromElement(el);
  if (!thumb) return;
  try { await api.put(`/files/${fileId}/thumb`, { thumb }); _thumbCache.set(fileId, thumb); }
  catch { _thumbsEnviadas.delete(fileId); }
}

function loadThumb(fileId) {
  if (!fileId) return Promise.resolve(null);
  if (_thumbCache.has(fileId)) return Promise.resolve(_thumbCache.get(fileId));
  if (_thumbInflight.has(fileId)) return _thumbInflight.get(fileId);
  const p = api.get(`/files/${fileId}/thumb`)
    .then((r) => { const t = r.data?.thumb || null; _thumbCache.set(fileId, t); return t; })
    .catch(() => { _thumbCache.set(fileId, null); return null; })   // sem miniatura: cai na arte inteira
    .finally(() => _thumbInflight.delete(fileId));
  _thumbInflight.set(fileId, p);
  return p;
}

// O ENDEREÇO DIRETO da arte de uma peça.
//
// O servidor manda dois: media_url (a arte anexada) e cover_url (a capa). A tela
// só usava o primeiro — e carrossel antigo costuma ter só a CAPA definida, sem
// anexo. Nesses, media_url vinha NULO, a tela caía no download da arte inteira
// e o quadro ficava em branco, enquanto post e reel apareciam normalmente.
// Era exatamente o que sobrava depois da correção anterior.
const enderecoDaPeca = (p) => (p?.media_url || p?.cover_url || null);

// Quantas slides um carrossel pode ter. Dois é o mínimo para ser carrossel;
// vinte é o teto do próprio Instagram.
const MIN_SLIDES = 2;
const MAX_SLIDES = 20;
/** O que foi digitado, virado num número válido. Vazio ou bobagem vira o mínimo. */
const dentroDaFaixa = (v) => {
  const n = Math.round(Number(String(v ?? "").replace(",", ".")));
  if (!Number.isFinite(n)) return MIN_SLIDES;
  return Math.max(MIN_SLIDES, Math.min(MAX_SLIDES, n));
};

// O ENDEREÇO DIRETO de UM arquivo específico da peça.
//
// O servidor manda três coisas em paralelo: media_url (a arte anexada),
// cover_url (a capa) e media_urls (uma por slide, na ordem de media_ids). A tela
// vinha escolhendo qual usar caso a caso — e cada caso esquecido virava um
// quadro em branco: carrossel sem anexo, carrossel de várias slides, carrossel
// de UMA slide. Aqui a pergunta é uma só: "qual o endereço DESTE arquivo?".
// Se não houver, devolve null e quem chamou baixa como antes.
// Endereços de arquivos que subiram AGORA, antes de a lista da tela recarregar.
const _enderecosNovos = new Map();
export function guardarEndereco(id, url) { if (id && url) _enderecosNovos.set(Number(id), url); }

/**
 * O endereço da PRÉVIA daquele arquivo dentro desta peça — mesma lógica do
 * endereço da arte, só que da versão reduzida. Devolve null quando a peça ainda
 * não tem prévia (arquivo antigo), e aí a tela usa a arte inteira, como antes.
 */
function previaDoArquivo(p, fileId) {
  if (!fileId || !p) return null;
  const id = Number(fileId);
  const ids = Array.isArray(p.media_ids) ? p.media_ids.map(Number) : [];
  const i = ids.indexOf(id);
  if (i >= 0 && p.preview_urls?.[i]) return p.preview_urls[i];
  if (Number(p.file_id) === id && p.preview_url) return p.preview_url;
  if (Number(p.cover_file_id) === id && p.cover_preview_url) return p.cover_preview_url;
  return null;
}

function enderecoDoArquivo(p, fileId) {
  if (!fileId) return null;
  const recem = _enderecosNovos.get(Number(fileId));
  if (recem) return recem;
  if (!p) return null;
  const id = Number(fileId);
  const ids = Array.isArray(p.media_ids) ? p.media_ids.map(Number) : [];
  const i = ids.indexOf(id);
  if (i >= 0 && p.media_urls?.[i]) return p.media_urls[i];
  if (Number(p.file_id) === id && p.media_url) return p.media_url;
  if (Number(p.cover_file_id) === id && p.cover_url) return p.cover_url;
  return null;
}

// Mês de referência da peça (para abrir o planejamento certo): usa a data
// programada; se não tiver, o mês atual.
const ymOf = (scheduled) => {
  const s = scheduled ? String(scheduled).slice(0, 7) : "";
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Bolinha de status: a cor conta, num relance, em que pé está cada peça.
//  🟢 verde   = já aprovado pelo cliente
//  🟡 amarelo = enviado, aguardando aprovação
//  🟠 laranja = ainda não foi enviado para aprovação
//  🔵 azul    = programado (já foi para "Programados")
const STATUS = {
  programado: { color: "#2563EB", label: "Programado" },
  aprovado:   { color: "#16A34A", label: "Aprovado" },
  aguardando: { color: "#EAB308", label: "Aguardando aprovação" },
  nao_enviado:{ color: "#EA580C", label: "Não enviado" },
};
function statusOf(p) {
  if (p.stage_done) return "programado";
  if (p.approval_status === "approved") return "aprovado";
  if (p.approval_status === "sent") return "aguardando";
  return "nao_enviado";
}
function StatusDot({ status }) {
  const s = STATUS[status] || STATUS.nao_enviado;
  return (
    <Tooltip title={s.label}>
      <Box sx={{ width: 13, height: 13, borderRadius: "50%", bgcolor: s.color, flexShrink: 0, boxShadow: "0 0 0 2px rgba(0,0,0,0.06)" }} />
    </Tooltip>
  );
}

// data do banco "YYYY-MM-DD HH:MM" <-> input "YYYY-MM-DDTHH:MM"
const toInput = (v) => (v ? v.replace(" ", "T").slice(0, 16) : "");
const fromInput = (v) => (v ? v.replace("T", " ").slice(0, 16) : "");

// Mostra a arte (foto ou vídeo), carregada em alta qualidade.
// fit="cover" (padrão) preenche o quadrado (para grades/miniaturas);
// fit="contain" mostra a IMAGEM INTEIRA na proporção real (para a prévia do
// post), sem cortar nada — sobra uma faixa neutra ao redor quando não é quadrada.
// Reel e stories são sempre vídeo; fora isso, o tipo do arquivo decide.
const pecaEhVideo = (p) => ["reel", "stories"].includes(p?.content_type) || /^video\//.test(p?.mime || "");

function Media({ fileId, capaId, height = 200, fit = "cover", streamUrl = null, previaUrl = null, ehVideoDica = false, comecoDaTira = false, natural = false, mesmaAltura = false }) {
  const [src, setSrc] = useState(null);
  const [video, setVideo] = useState(false);
  const [capa, setCapa] = useState(null);
  const [ph, setPh] = useState(null);   // miniatura leve como placeholder instantâneo
  const [erro, setErro] = useState(false);

  // POR QUE ISTO É ASSIM, medido numa tela com 12 peças de 1 a 6,5 MB:
  //
  // A tela baixava a ARTE INTEIRA de cada peça por JavaScript para mostrar um
  // quadradinho. Resultado medido: 55 MB baixados e, aos 13 segundos, 7 quadros
  // ainda rodando em branco. Era exatamente isso que fazia "sumir todas as
  // fotos" da Distribuição enquanto a Galeria mostrava tudo — a Galeria sempre
  // usou o endereço direto num <img>, que o navegador carrega sozinho, só o que
  // está à vista, e guarda no cache dele.
  //
  // A ordem agora é a mais barata primeiro:
  //   1. tem MINIATURA guardada? mostra ela e para por aí (uns 100 KB);
  //   2. não tem? usa o endereço direto, com loading="lazy" — só carrega o que
  //      está na tela — e GUARDA a miniatura a partir do que desenhou, para a
  //      próxima vez ser instantânea. Isso faltava: a miniatura nunca era
  //      guardada por esta tela, então era arte cheia toda vez, para sempre;
  //   3. só se o endereço direto falhar (.HEIC de iPhone, que navegador nenhum
  //      desenha) é que cai no download antigo, que sabe converter.
  const [semStream, setSemStream] = useState(false);
  const [buscouThumb, setBuscouThumb] = useState(false);
  const transmite = Boolean(streamUrl) && !semStream;

  useEffect(() => {
    setSrc(null); setErro(false); setCapa(null); setPh(null); setBuscouThumb(false);
    if (!fileId) return undefined;
    let alive = true;
    loadThumb(fileId)
      .then((t) => { if (alive) { if (t) setPh(t); setBuscouThumb(true); } })
      .catch(() => { if (alive) setBuscouThumb(true); });
    // O download só entra em cena quando não há endereço direto (ou ele falhou).
    if (transmite) return () => { alive = false; };
    loadMedia(fileId)
      .then((m) => { if (alive && m) { setSrc(m.url); setVideo((m.type || "").startsWith("video")); } })
      .catch(() => { if (alive) setErro(true); });
    return () => { alive = false; };  // não revoga: o cache é dono da URL
  }, [fileId, transmite]);

  // A CAPA escolhida vira o quadro parado do vídeo: o post aparece com a arte
  // certa e continua dando para dar play — antes era um ou outro.
  useEffect(() => {
    if (!capaId || capaId === fileId) return undefined;
    let alive = true;
    loadThumb(capaId)
      .then((t) => (t ? { url: t } : loadMedia(capaId)))
      .then((m) => { if (alive && m) setCapa(m.url); })
      .catch(() => {});
    return () => { alive = false; };
  }, [capaId, fileId]);

  const contain = fit === "contain";
  // Modo NATURAL: a arte aparece na proporção REAL, preenchendo a largura do
  // card, com altura automática — sem cortar e sem tarja preta em volta. É o
  // jeito certo de ver o post (retrato 4:5, reel 9:16, etc.) na Distribuição.
  // Carrossel salvo como UMA imagem larga: onde o quadro representa a CAPA, o
  // que tem de aparecer é o começo da tira — os primeiros 1080px da esquerda.
  // mesmaAltura: TODOS OS CARDS DA LISTA COM A MESMA ALTURA.
  //
  // No modo natural cada peça aparece na proporção real dela — e aí um reel
  // (9:16) fica muito mais alto que um post (4:5), deixando a grade desalinhada.
  // Nesta caixa a arte é ENCAIXADA num retrato 4:5: post e carrossel preenchem
  // exatamente (não sobra nada), e o reel entra inteiro, um pouco menor, sem
  // cortar nada do vídeo e sem esticar.
  const sx = natural
    ? (mesmaAltura
      ? {
          width: "100%", aspectRatio: "4 / 5", height: "auto", objectFit: "contain",
          display: "block", borderRadius: 2, bgcolor: "action.hover",
          objectPosition: comecoDaTira ? "left center" : "center",
        }
      : {
        width: "100%", height: "auto", display: "block", borderRadius: 2,
        objectPosition: comecoDaTira ? "left center" : "center",
      })
    : {
        width: "100%", height, objectFit: fit, borderRadius: 2,
        objectPosition: comecoDaTira && !contain ? "left center" : "center",
        bgcolor: contain ? "#000" : "action.hover", display: "block",
      };
  const pequeno = !natural && height <= 90;
  // Caixa de aviso/carregando: no modo natural usa uma proporção retrato padrão
  // só para não "colapsar" a altura enquanto nada carregou.
  const molduraVazia = natural
    ? { width: "100%", aspectRatio: "4 / 5", borderRadius: 2 }
    : { width: "100%", height, borderRadius: 2 };
  const aviso = (texto, cor, tracejado = false) => (
    <Box sx={{
      ...molduraVazia, display: "grid", placeItems: "center", textAlign: "center",
      color: cor, fontSize: pequeno ? 9 : 13, lineHeight: 1.3, p: 1,
      // Falta de arte NÃO é erro: fundo claro e borda tracejada, como um espaço
      // esperando ser preenchido. Antes era um retângulo preto com "Sem mídia",
      // que parecia exatamente uma imagem quebrada.
      bgcolor: tracejado ? "action.hover" : (contain && !natural ? "#000" : "action.hover"),
      border: tracejado ? "2px dashed" : 0, borderColor: "divider",
    }}>{texto}</Box>
  );
  if (!fileId) {
    return aviso(
      pequeno ? "sem arte" : <>Nenhuma arte ainda<br /><Box component="span" sx={{ fontSize: 12, opacity: 0.75 }}>use “Subir” ou “Da galeria”</Box></>,
      "text.secondary", true);
  }
  if (erro) return aviso(<>Arte não carregou<br />(reenvie)</>, "error.main");
  const mostraControles = natural || height > 120;
  // No modo natural o vídeo também aparece na proporção real (altura automática);
  // fora dele, mantém a caixa de altura fixa com o vídeo contido em fundo preto.
  const sxVideo = natural
    ? { ...sx, ...(mesmaAltura ? {} : { bgcolor: "#000" }) }
    : { ...sx, objectFit: "contain", bgcolor: "#000" };
  if (transmite) {
    // Se o endereço direto não desenhar (.HEIC de iPhone, arquivo estranho),
    // cai para o download antigo em vez de mostrar erro.
    const cair = () => setSemStream(true);
    if (ehVideoDica) {
      return <Box component="video" src={streamUrl} poster={capa || ph || undefined} controls={mostraControles}
        muted playsInline preload="metadata" sx={sxVideo}
        onError={cair}
        onLoadedData={(e) => guardarMiniatura(fileId, e.currentTarget)} />;
    }
    // Miniatura guardada: é ela que aparece. 100 KB no lugar de 6 MB, e a tela
    // inteira desenha de uma vez.
    //
    // MENOS NO CARD GRANDE. No modo natural a arte ocupa a largura inteira do
    // card — numa tela retina isso passa de 900 px de verdade, e a miniatura
    // tem 480. Mostrar só ela deixava o post BORRADO justamente onde ela olha
    // para decidir se a arte está boa. Aqui a miniatura entra por baixo, como
    // rascunho instantâneo, e a arte de verdade desenha por cima quando chega:
    // aparece na hora E fica nítido.
    if (ph && !natural) return <Box component="img" src={ph} alt="" sx={sx} />;
    if (ph) {
      // A PRÉVIA no lugar da arte inteira quando ela existe: mesma nitidez na
      // tela (1080 px de largura), uma fração do peso. Sem prévia, cai na arte
      // original — que é como era antes, e continua funcionando.
      const grande = previaUrl || streamUrl;
      return (
        <Box sx={{ position: "relative", width: "100%" }}>
          <Box component="img" src={ph} alt="" aria-hidden sx={sx} />
          <Box component="img" src={grande} alt="" decoding="async"
            sx={{ ...sx, position: "absolute", inset: 0, height: "100%" }}
            onError={cair}
            onLoad={(e) => { guardarMiniatura(fileId, e.currentTarget); if (!previaUrl) guardarPrevia(fileId, e.currentTarget); }} />
        </Box>
      );
    }
    // Ainda esperando a resposta da miniatura: não dispara a arte cheia agora,
    // senão baixa os dois. É rápido — a resposta é minúscula.
    if (!buscouThumb) {
      return <Box sx={{ ...molduraVazia, bgcolor: "action.hover", display: "grid", placeItems: "center" }}><CircularProgress size={22} /></Box>;
    }
    return <Box component="img" src={previaUrl || streamUrl} alt="" loading="lazy" decoding="async" sx={sx}
      onError={cair}
      onLoad={(e) => { guardarMiniatura(fileId, e.currentTarget); if (!previaUrl) guardarPrevia(fileId, e.currentTarget); }} />;
  }
  // Ainda baixando a arte cheia: mostra a miniatura (se já veio) como rascunho;
  // senão, o spinner. A qualidade final entra por cima quando o arquivo chega.
  if (!src) {
    if (ph) return <Box component="img" src={ph} alt="" sx={sx} />;
    return <Box sx={{ ...molduraVazia, bgcolor: "action.hover", display: "grid", placeItems: "center" }}><CircularProgress size={22} /></Box>;
  }
  return video
    ? <Box component="video" src={src} poster={capa || ph || undefined} controls={mostraControles} muted playsInline
        preload="metadata" sx={sxVideo}
        onError={() => setErro(true)} />
    : <Box component="img" src={src} alt="" sx={sx} onError={() => setErro(true)} />;
}

// CARROSSEL salvo como UMA arte larga (a tira inteira: várias slides de ~1080px
// lado a lado num só arquivo). Mostra na proporção de UMA slide (igual a um
// post) e desliza em JANELAS de 1080px com a setinha — a 1ª janela são os
// primeiros 1080px da esquerda (a capa). É recorte por CSS sobre o arquivo
// cheio (qualidade real), sem cortar nada em disco.
function CarrosselLargo({ fileId, streamUrl = null, mesmaAltura = false }) {
  const [full, setFull] = useState(null);
  const [dim, setDim] = useState(null);   // { w, h, n, slideW }
  const [idx, setIdx] = useState(0);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    setDim(null); setIdx(0); setErro(false);
    // Preferimos o LINK DIRETO do Cloudflare (media_url): a imagem em qualidade
    // real carrega direto do CDN, sem baixar o arquivo pelo servidor — rápido e
    // nítido. Sem ele, cai no download pelo servidor.
    if (streamUrl) { setFull(streamUrl); return undefined; }
    setFull(null);
    if (!fileId) return undefined;
    let alive = true;
    loadMedia(fileId).then((m) => { if (alive && m) setFull(m.url); }).catch(() => { if (alive) setErro(true); });
    return () => { alive = false; };
  }, [fileId, streamUrl]);

  // Se o link direto falhar, tenta baixar pelo servidor antes de desistir.
  function aoFalhar() {
    if (streamUrl && full === streamUrl && fileId) {
      loadMedia(fileId).then((m) => { if (m) setFull(m.url); else setErro(true); }).catch(() => setErro(true));
    } else { setErro(true); }
  }

  function medir(e) {
    const w = e.currentTarget.naturalWidth, h = e.currentTarget.naturalHeight;
    if (!w || !h) return;
    // Pelo FORMATO, não por 1080 fixo — mesma correção da conta do corte. Uma
    // tira exportada em alta resolução era lida como "18 slides" quando eram 5:
    // o visor dividia a largura por 1080 e ignorava a altura, que é o que diz
    // qual é a largura de UMA slide.
    const { n } = sugerirSlides(w, h);
    setDim({ w, h, n, slideW: w / n });
  }

  const n = dim?.n || 1;
  const cur = Math.min(idx, n - 1);
  // Caixa na proporção de UMA slide (≈ 4:5). Enquanto não mediu, usa 4:5 padrão.
  // mesmaAltura: a caixa é sempre um retrato 4:5, para o card ficar do mesmo
  // tamanho dos outros da lista (ver o comentário em Media).
  const box = {
    position: "relative", width: "100%", overflow: "hidden", borderRadius: 2, bgcolor: "action.hover",
    aspectRatio: mesmaAltura ? "4 / 5" : (dim ? `${dim.slideW} / ${dim.h}` : "4 / 5"),
  };
  // A arte cheia tem N slides de largura; a janela mostra uma por vez e desliza.
  //
  // Numa caixa de proporção fixa, a slide não pode ser esticada para caber:
  // `fator` é o quanto UMA slide ocupa da largura da caixa quando ela é
  // encaixada pela altura. Com a tira ancorada no meio da caixa, deslizar é
  // sempre a mesma conta — a porcentagem do translate é sobre a largura da
  // TIRA, então ela não depende do fator.
  const R_CAIXA = 4 / 5;                                  // a caixa de altura igual
  const rFatia = dim ? dim.slideW / dim.h : R_CAIXA;      // proporção de UMA slide
  // A slide tem que caber INTEIRA, nunca ser recortada: se ela é mais "larga"
  // que a caixa (um quadrado, por exemplo), encaixa pela largura e sobra espaço
  // em cima e embaixo; se é mais "alta" (uma slide de story), encaixa pela
  // altura e sobra dos lados. Sem essa distinção, uma capa 1:1 perdia 12% de
  // cada lado dentro do 4:5.
  const pelaLargura = rFatia >= R_CAIXA;
  const fator = rFatia / R_CAIXA;
  const imgSx = dim
    ? (mesmaAltura
      ? (pelaLargura
        ? { position: "absolute", top: "50%", left: 0, width: `${n * 100}%`, height: "auto", maxWidth: "none",
            transform: `translate(-${cur * (100 / n)}%, -50%)`, transition: "transform .2s ease", display: "block" }
        : { position: "absolute", top: 0, left: "50%", height: "100%", width: `${n * 100 * fator}%`,
            maxWidth: "none", transform: `translateX(-${((cur + 0.5) / n) * 100}%)`,
            transition: "transform .2s ease", display: "block" })
      : { position: "absolute", top: 0, left: 0, height: "100%", width: `${n * 100}%`, maxWidth: "none",
          transform: `translateX(-${cur * (100 / n)}%)`, transition: "transform .2s ease", display: "block" })
    : { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "left center", display: "block" };

  if (erro) return <Box sx={{ ...box, display: "grid", placeItems: "center", color: "error.main", fontSize: 13 }}>Arte não carregou</Box>;
  return (
    <Box sx={box}>
      {/* Só a arte em qualidade real; enquanto baixa, o carregando. */}
      {/* loading="lazy": a tira de um carrossel é a arte MAIS PESADA do sistema
          (várias slides num arquivo só, 8 MB não é raro). Sem isto, abrir a aba
          puxava a tira de TODOS os carrosséis de uma vez, mesmo os que estão
          lá embaixo, fora da tela — e nada terminava de carregar. E, ao
          desenhar, guarda a miniatura: da próxima vez o quadradinho é leve. */}
      {full
        ? <Box component="img" src={full} alt="" loading="lazy" decoding="async"
            onLoad={(e) => { medir(e); guardarMiniatura(fileId, e.currentTarget); }}
            onError={aoFalhar} sx={imgSx} />
        : <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}><CircularProgress size={22} /></Box>}
      {n > 1 && (
        <>
          <IconButton size="small" onClick={() => setIdx((i) => (Math.min(i, n - 1) - 1 + n) % n)}
            sx={{ position: "absolute", top: "50%", left: 6, transform: "translateY(-50%)", color: "#fff", bgcolor: "rgba(0,0,0,0.5)", "&:hover": { bgcolor: "rgba(0,0,0,0.75)" } }}>
            <ChevronLeftIcon />
          </IconButton>
          <IconButton size="small" onClick={() => setIdx((i) => (Math.min(i, n - 1) + 1) % n)}
            sx={{ position: "absolute", top: "50%", right: 6, transform: "translateY(-50%)", color: "#fff", bgcolor: "rgba(0,0,0,0.5)", "&:hover": { bgcolor: "rgba(0,0,0,0.75)" } }}>
            <ChevronRightIcon />
          </IconButton>
          <Box sx={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", px: 1, py: 0.25, borderRadius: 5, bgcolor: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 11, fontWeight: 700 }}>
            {cur + 1} / {n}
          </Box>
        </>
      )}
    </Box>
  );
}

// Escolher um arquivo navegando pelas PASTAS do cliente (mesma estrutura da
// aba Arquivos). Mostra as pastas para entrar e os arquivos para selecionar.
function GalleryPicker({ clientId, open, onClose, onPick, titulo = "Selecionar da galeria de arquivos" }) {
  const [path, setPath] = useState([]); // trilha de pastas: [{id,name}]
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const currentFolder = path[path.length - 1]?.id || null;

  useEffect(() => { if (open) setPath([]); }, [open, clientId]);

  useEffect(() => {
    if (!open || !clientId) return;
    setLoading(true);
    const params = { client_id: clientId };
    if (currentFolder) params.parent_id = currentFolder;
    const pf = api.get("/files/folders", { params }).then((r) => setFolders(r.data || [])).catch(() => setFolders([]));
    // Arquivos da pasta atual (na raiz = sem pasta).
    const fparams = { client_id: clientId };
    if (currentFolder) fparams.folder_id = currentFolder;
    const ff = api.get("/files", { params: fparams })
      .then((r) => setFiles((r.data || []).filter((f) => /^(image|video)\//.test(f.mime || ""))))
      .catch(() => setFiles([]));
    Promise.all([pf, ff]).finally(() => setLoading(false));
  }, [open, clientId, currentFolder]);

  const vazio = !loading && folders.length === 0 && files.length === 0;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{titulo}</DialogTitle>
      <DialogContent>
        {/* Trilha de navegação (breadcrumb) */}
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: "wrap", mb: 1.5 }}>
          <Button size="small" onClick={() => setPath([])} disabled={!path.length}>📁 Início</Button>
          {path.map((p, i) => (
            <Typography key={p.id} variant="body2" sx={{ cursor: "pointer" }}
              onClick={() => setPath(path.slice(0, i + 1))}>/ {p.name}</Typography>
          ))}
        </Stack>
        {loading ? (
          <Box sx={{ display: "grid", placeItems: "center", py: 4 }}><CircularProgress /></Box>
        ) : vazio ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            Nada aqui. Suba arquivos ou crie pastas na aba Arquivos.
          </Typography>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 1.5, pt: 1 }}>
            {folders.map((fd) => (
              <Box key={`d${fd.id}`} onClick={() => setPath([...path, { id: fd.id, name: fd.name }])}
                sx={{ cursor: "pointer", borderRadius: 1.5, p: 1, border: 1, borderColor: "divider", display: "grid", placeItems: "center", gap: 0.5, "&:hover": { borderColor: "primary.main" } }}>
                <Typography sx={{ fontSize: 34, lineHeight: 1 }}>📁</Typography>
                <Typography variant="caption" noWrap sx={{ maxWidth: "100%" }}>{fd.name}</Typography>
              </Box>
            ))}
            {/* O QUE FOI UNIDO NA GALERIA CHEGA AQUI UNIDO.
                Juntar as lâminas lá era justamente para poder escolher o post
                inteiro aqui, de uma vez — antes as sete lâminas de "Frases"
                apareciam como sete itens soltos e tinham de ser escolhidas uma
                a uma. Agora é um item só, e escolher já monta o carrossel na
                ordem em que foi montado lá. */}
            {agruparPosts(files).map(({ f, laminas }) => (
              <Box key={`f${f.id}`}
                onClick={() => { onPick(f.id, laminas?.map((l) => l.id) || null); onClose(); }}
                sx={{ cursor: "pointer", borderRadius: 1.5, overflow: "hidden", border: 1,
                      borderColor: laminas ? "primary.main" : "divider", "&:hover": { borderColor: "primary.main" } }}>
                {/* A CAPA É SEMPRE A PRIMEIRA LÂMINA.
                    O quadro tem a forma de um post e a arte preenche cortando,
                    como na Galeria. Numa TIRA (carrossel salvo como uma imagem
                    larga) o quadro é ancorado na ESQUERDA: antes aparecia uma
                    lâmina do meio, espremida, e não dava para saber que post
                    era. Numa arte comum a âncora não muda nada — a largura já
                    encaixa certo.
                    A prévia entra no lugar da arte original: a mesma nitidez
                    aqui, com uma fração do que a internet tem de carregar. */}
                <Box sx={{ aspectRatio: "4 / 5", bgcolor: "action.hover", position: "relative" }}>
                  <FeedThumb fileId={f.id} comecoDaTira
                    previaUrl={f.preview_url || null}
                    streamUrl={f.media_url || null}
                    ehVideo={/^video\//.test(f.mime || "")} />
                  {laminas && (
                    <Chip size="small" icon={<ViewCarouselIcon sx={{ fontSize: 13, color: "#fff !important" }} />}
                      label={`${laminas.length} lâminas`}
                      sx={{ position: "absolute", top: 4, right: 4, height: 19, fontSize: 10, fontWeight: 700,
                            bgcolor: "rgba(0,0,0,0.66)", color: "#fff", "& .MuiChip-label": { px: 0.6 } }} />
                  )}
                </Box>
                <Typography variant="caption" noWrap sx={{ display: "block", px: 0.5, py: 0.25 }}>{f.original_name}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Fechar</Button></DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ESCOLHER A CAPA DO VÍDEO, como no Instagram: uma tira de quadros embaixo do
// vídeo; toca num e a capa é aquela. A barra fica para ajustar no detalhe.
//
// O que fazia isso demorar: a tela BAIXAVA o vídeo inteiro antes de mostrar
// qualquer coisa. Agora ela transmite (o navegador pede só os pedaços de que
// precisa) e a tira é montada pulando de quadro em quadro, num vídeo escondido
// — então a janela abre na hora, mesmo num reel grande.
// ---------------------------------------------------------------------------
const QUADROS_DA_TIRA = 8;

/** Pula para `t` e espera o quadro estar desenhado. */
function vaiPara(v, t) {
  return new Promise((resolve) => {
    let feito = false;
    const acabou = () => { if (feito) return; feito = true; v.removeEventListener("seeked", acabou); resolve(); };
    v.addEventListener("seeked", acabou);
    setTimeout(acabou, 2500);        // quadro teimoso não trava a tira
    try { v.currentTime = t; } catch { acabou(); }
  });
}

function VideoCoverDialog({ fileId, streamUrl, clientId, open, onClose, onCaptured, flash }) {
  const videoRef = useRef(null);
  const tiraRef = useRef(null);       // vídeo escondido que monta a tira
  const [src, setSrc] = useState(null);
  const [isVideo, setIsVideo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);
  const [tira, setTira] = useState([]);      // [{ t, url }]
  const [montando, setMontando] = useState(false);

  useEffect(() => {
    if (!open || !fileId) { setSrc(null); setDur(0); setCur(0); setTira([]); return undefined; }
    // AQUI o endereço tem que ser do NOSSO domínio, mesmo quando o arquivo está
    // na nuvem. Esta tela não só mostra o vídeo: ela CAPTURA um quadro dele
    // desenhando num canvas — e o navegador proíbe capturar de um vídeo que
    // veio de outro domínio. Com o endereço direto da Cloudflare, a captura
    // passou a falhar com "Não foi possível capturar o quadro".
    //
    // O endereço pelo nosso servidor é um pouco mais lento para começar, mas é
    // o único que deixa capturar — e é um vídeo só, nesta tela só.
    if (streamUrl && streamUrl.startsWith("/api/")) { setSrc(streamUrl); setIsVideo(true); return undefined; }
    let alive = true;
    api.get(`/files/${fileId}/link`)
      .then((r) => { if (alive && r.data?.url) { setSrc(r.data.url); setIsVideo(true); } })
      .catch(() => {
        // Sem o endereço do nosso servidor, baixa e usa o arquivo local — que
        // também é do nosso domínio, então a captura funciona.
        if (!alive) return;
        loadMedia(fileId)
          .then((m) => { if (alive && m) { setSrc(m.url); setIsVideo((m.type || "").startsWith("video")); } })
          .catch(() => {});
      });
    return () => { alive = false; };
  }, [open, fileId, streamUrl]);

  // A tira de quadros, assim que o vídeo diz quanto dura.
  useEffect(() => {
    if (!open || !src || !dur) return undefined;
    let vivo = true;
    const urls = [];
    (async () => {
      setMontando(true);
      const v = tiraRef.current;
      if (!v) return;
      const cv = document.createElement("canvas");
      const feitos = [];
      for (let i = 0; i < QUADROS_DA_TIRA && vivo; i++) {
        // Não pega o 0 nem o fim: costumam ser preto.
        const t = dur * ((i + 0.5) / QUADROS_DA_TIRA);
        await vaiPara(v, t);
        if (!vivo || !v.videoWidth) continue;
        const esc = Math.min(1, 160 / v.videoHeight);
        cv.width = Math.max(1, Math.round(v.videoWidth * esc));
        cv.height = Math.max(1, Math.round(v.videoHeight * esc));
        cv.getContext("2d").drawImage(v, 0, 0, cv.width, cv.height);
        const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.7));
        if (!blob || !vivo) continue;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        feitos.push({ t, url });
        setTira([...feitos]);        // aparecem um a um, sem esperar a tira toda
      }
      if (vivo) setMontando(false);
    })();
    return () => { vivo = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [open, src, dur]);

  const fmt = (s) => {
    if (!Number.isFinite(s)) return "0:00";
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return `${m}:${String(ss).padStart(2, "0")}`;
  };
  // Arrasta a barra (ou toca num quadro) → o vídeo vai para aquele instante.
  const seek = (t) => {
    setCur(t);
    const v = videoRef.current;
    if (v) { try { v.pause(); v.currentTime = t; } catch { /* ignore */ } }
  };

  async function capturar() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext("2d").drawImage(v, 0, 0);
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
      const fd = new FormData();
      fd.append("files", blob, `capa-${Date.now()}.jpg`);
      if (clientId) fd.append("client_id", clientId);
      fd.append("stage", "editados");
      const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      const newId = data?.[0]?.id;
      if (newId) { onCaptured(newId); onClose(); }
    } catch { flash?.("Não foi possível capturar o quadro.", "error"); }
    setBusy(false);
  }

  // Qual quadro da tira está escolhido agora (o mais perto do instante atual).
  const escolhido = tira.reduce((melhor, q, i) =>
    (melhor === -1 || Math.abs(q.t - cur) < Math.abs(tira[melhor].t - cur) ? i : melhor), -1);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Escolher a capa do vídeo</DialogTitle>
      <DialogContent>
        {!src ? (
          <Box sx={{ display: "grid", placeItems: "center", py: 4 }}><CircularProgress /></Box>
        ) : !isVideo ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            O anexo atual é uma foto. Anexe um vídeo para escolher um quadro.
          </Typography>
        ) : (
          <Stack spacing={1.25}>
            <Box component="video" ref={videoRef} src={src} playsInline preload="metadata"
              onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => setCur(e.currentTarget.currentTime || 0)}
              sx={{ width: "100%", maxHeight: 420, bgcolor: "#000", borderRadius: 2 }} />

            {/* O vídeo que monta a tira, fora da vista. */}
            <Box component="video" ref={tiraRef} src={src} muted playsInline preload="auto"
              crossOrigin="anonymous" sx={{ display: "none" }} />

            <Typography variant="caption" color="text.secondary">
              Toque no quadro que você quer de capa. Dá para afinar na barra.
            </Typography>

            {/* A TIRA — o jeito rápido de escolher */}
            <Box sx={{ display: "flex", gap: 0.5, overflowX: "auto", pb: 0.5 }}>
              {tira.map((q, i) => (
                <Box key={q.url} onClick={() => seek(q.t)}
                  sx={{
                    flex: "0 0 auto", cursor: "pointer", borderRadius: 1, overflow: "hidden",
                    border: 2, borderColor: i === escolhido ? "primary.main" : "transparent",
                    opacity: i === escolhido ? 1 : 0.75, transition: "opacity .12s, border-color .12s",
                    "&:hover": { opacity: 1 },
                  }}>
                  <Box component="img" src={q.url} alt="" sx={{ height: 78, display: "block" }} />
                </Box>
              ))}
              {montando && Array.from({ length: Math.max(0, QUADROS_DA_TIRA - tira.length) }).map((_, i) => (
                <Box key={`v${i}`} sx={{ flex: "0 0 auto", width: 44, height: 78, borderRadius: 1, bgcolor: "action.hover" }} />
              ))}
            </Box>

            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums", minWidth: 34 }}>{fmt(cur)}</Typography>
              <Slider size="small" min={0} max={dur || 0} step={0.05} value={Math.min(cur, dur || 0)}
                onChange={(_, v) => seek(Array.isArray(v) ? v[0] : v)} sx={{ flex: 1 }} disabled={!dur} />
              <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums", minWidth: 34 }}>{fmt(dur)}</Typography>
            </Stack>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
        {isVideo && <Button variant="contained" onClick={capturar} disabled={busy}>Usar este quadro como capa</Button>}
      </DialogActions>
    </Dialog>
  );
}

// Um cartão por peça: mídia + legenda + observação + data → enviar p/ aprovação.
function PieceCard({ item, onChanged, flash }) {
  const [caption, setCaption] = useState(item.caption || "");
  const [obs, setObs] = useState(item.description || "");
  const [when, setWhen] = useState(toInput(item.scheduled_at));
  const [fileId, setFileId] = useState(item.file_id || null);
  const [coverId, setCoverId] = useState(item.cover_file_id || null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [picker, setPicker] = useState(false);
  const [coverPicker, setCoverPicker] = useState(false);
  const [videoCover, setVideoCover] = useState(false);
  const [planRef, setPlanRef] = useState(false);
  const [slides, setSlides] = useState(item.media_ids || []); // carrossel
  const [slidePicker, setSlidePicker] = useState(false);
  const [slideUploading, setSlideUploading] = useState(false);
  const [posted, setPosted] = useState(!!item.published_at);
  const [baixando, setBaixando] = useState(false);
  const [iaLegenda, setIaLegenda] = useState(false);
  // Fatiador de carrossel: quando a arte é mais larga que uma slide, pergunta
  // em quantas partes cortar. { file, largura, altura, n }.
  const [slicer, setSlicer] = useState(null);
  // Visualizador do carrossel (setinha): qual slide está na frente.
  const [viewIdx, setViewIdx] = useState(0);
  const ct = CONTENT_TYPES[item.content_type];
  const isCarousel = item.content_type === "carrossel";

  // Gera a legenda com IA OLHANDO a arte (foto ou 1º quadro do vídeo) + a persona
  // e o planejamento do cliente. O resultado entra no campo pra você ajustar.
  async function gerarLegendaIA() {
    if (!item.client_id) { flash("Escolha o cliente primeiro.", "error"); return; }
    setIaLegenda(true);
    try {
      let image = null;
      const midiaId = coverId || fileId || slides[0];
      if (midiaId) {
        try {
          const blob = (await api.get(`/files/${midiaId}/download`, { responseType: "blob" })).data;
          image = await makeThumbnail(blob); // reduz p/ ~640px antes de enviar
        } catch { /* sem imagem: gera pelo contexto/planejamento */ }
      }
      const { data } = await api.post("/ai/generate", {
        client_id: item.client_id, kind: "caption", count: 1, image,
        topic: item.title || CONTENT_TYPES[item.content_type]?.label || "",
      });
      const txt = (data.text || "").trim();
      if (txt) { setCaption(txt); flash("Legenda gerada pela IA — revise e salve. ✨", "success"); }
      else flash("A IA não retornou legenda. Tente de novo.", "error");
    } catch (err) {
      const d = err.response?.data;
      if (d?.needs_key) flash("Configure a chave de IA na aba IA (menu lateral) primeiro.", "error");
      else flash(d?.error || "Não foi possível gerar a legenda.", "error");
    }
    setIaLegenda(false);
  }

  // ---- Postar manual (Reels com música do Edits) ----
  // Baixa/compartilha o vídeo (no celular abre a folha de compartilhamento →
  // Edits), copia a legenda e marca como postado — sem passar pela API da Meta.
  async function baixarOuCompartilhar() {
    const id = fileId || coverId || slides[0];
    if (!id) { flash("Sem arquivo pra baixar. Anexe a arte primeiro.", "error"); return; }
    setBaixando(true);
    try {
      const blob = (await api.get(`/files/${id}/download`, { responseType: "blob" })).data;
      const ext = (blob.type.split("/")[1] || "mp4").split("+")[0];
      const nome = `${(item.title || "conteudo").replace(/[^\w.-]+/g, "_")}.${ext}`;
      const file = new File([blob], nome, { type: blob.type || "application/octet-stream" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], text: caption || "" }); return; }
        catch { /* usuário cancelou o compartilhamento */ }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = nome; a.click();
      URL.revokeObjectURL(url);
    } catch { flash("Não consegui baixar o arquivo.", "error"); }
    finally { setBaixando(false); }
  }
  async function copiarLegenda() {
    try { await navigator.clipboard.writeText(caption || ""); flash("Legenda copiada!", "success"); }
    catch { flash("Não consegui copiar — selecione o texto e copie manualmente.", "error"); }
  }
  async function marcarPostado(v = true) {
    try {
      await api.post(`/distribution/${item.id}/mark-posted`, { posted: v });
      setPosted(v);
      flash(v ? "Marcado como postado ✓" : "Voltou para pendente.", "success");
    } catch (err) { flash(err.response?.data?.error || "Não foi possível marcar.", "error"); }
  }

  async function saveSlides(next) {
    setSlides(next);
    if (next[0]) { setCoverId(next[0]); setFileId(next[0]); }
    try { await api.put(`/distribution/${item.id}`, { media_ids: next }); }
    catch (err) { flash(err.response?.data?.error || "Não foi possível salvar as slides.", "error"); }
  }
  // Escolher da GALERIA agora passa pela mesma medição do upload: se a arte é
  // uma tira larga, pergunta em quantas slides cortar em vez de enfiar a tira
  // inteira como uma slide só. Antes o corte só existia ao subir arquivo novo —
  // quem já tinha a arte na galeria não tinha como cortar.
  async function addSlide(id, laminas) {
    // Post unido: entram todas as lâminas, na ordem, sem passar pelo corte —
    // elas já são arquivos separados.
    if (laminas?.length > 1) {
      const novas = laminas.filter((l) => !slides.includes(l));
      if (novas.length) saveSlides([...slides, ...novas]);
      return;
    }
    if (!id || slides.includes(id)) return;
    try {
      const blob = (await api.get(`/files/${id}/download`, { responseType: "blob" })).data;
      const file = new File([blob], `slide-${id}.${(blob.type || "").includes("png") ? "png" : "jpg"}`,
        { type: blob.type || "image/jpeg" });
      const medida = await medirImagem(file);
      if (medida?.fatiavel) {
        // daGaleria: ao cortar, a tira não vira slide — só as partes entram.
        setSlicer({ file, largura: medida.largura, altura: medida.altura, formato: medida.formato,
                    confianca: medida.confianca, sugestaoFormato: medida.sugestao, alternativas: medida.alternativas,
                    texto: String(dentroDaFaixa(medida.sugestao)), daGaleria: id });
        return;
      }
    } catch { /* não deu para medir: entra como slide normal, como antes */ }
    saveSlides([...slides, id]);
  }
  const removeSlide = (id) => saveSlides(slides.filter((s) => s !== id));
  // Mover uma slide de lugar. Num carrossel a ordem É o post: a 1ª é a capa que
  // aparece no perfil, e as outras seguem na ordem em que a pessoa desliza.
  const moveSlide = (i, d) => {
    const alvo = i + d;
    if (alvo < 0 || alvo >= slides.length) return;
    const next = [...slides];
    [next[i], next[alvo]] = [next[alvo], next[i]];
    saveSlides(next);
  };
  // Sobe UM arquivo (File/Blob) e devolve o id — reaproveitado pelo fatiador.
  async function subirArquivo(file) {
    const fd = new FormData();
    fd.append("files", file);
    if (item.client_id) fd.append("client_id", item.client_id);
    fd.append("stage", "editados");
    const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
    const novo = data?.[0];
    // Guarda o endereço direto do arquivo que ACABOU de subir. A lista da tela
    // só traz esses endereços no próximo carregamento, e até lá as slides
    // recém-cortadas ficavam baixando o arquivo inteiro para desenhar um
    // quadradinho — rodando sem fim mesmo sendo pequenas.
    if (novo?.id && novo?.media_url) guardarEndereco(novo.id, novo.media_url);
    return novo?.id || null;
  }

  async function uploadSlide(e) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    // Arte larga (mais de uma slide)? Pergunta em quantas fatiar em vez de subir
    // um bloco só — a pessoa vê o carrossel montado, deslizando com a setinha.
    try {
      const medida = await medirImagem(file);
      if (medida?.fatiavel) { setSlicer({ file, largura: medida.largura, altura: medida.altura, formato: medida.formato,
                     confianca: medida.confianca, sugestaoFormato: medida.sugestao, alternativas: medida.alternativas,
                     texto: String(dentroDaFaixa(medida.sugestao)) }); return; }
    } catch { /* segue como slide única */ }
    setSlideUploading(true);
    try {
      const newId = await subirArquivo(file);
      if (newId) saveSlides([...slides, newId]);
    } catch (err) { flash(err.response?.data?.error || "Falha no upload.", "error"); }
    setSlideUploading(false);
  }

  // Corta a arte em N fatias (no navegador) e sobe cada uma como slide, na ordem.
  // Se `substituir` estiver setado (arte larga que já estava), as fatias tomam o
  // LUGAR dela na sequência — é assim que "arrumamos" um carrossel antigo.
  async function confirmarFatiar() {
    if (!slicer) return;
    setSlideUploading(true);
    try {
      const partes = await fatiarEmSlides(slicer.file, dentroDaFaixa(slicer.texto));
      // As slides sobem JUNTAS, não uma esperando a outra. Em fila, seis slides
      // eram seis idas e voltas somadas; em paralelo o tempo é o da mais lenta.
      // A ORDEM é preservada porque cada uma guarda o seu lugar no resultado.
      const ids = await Promise.all(partes.map((parte) => subirArquivo(parte).catch(() => null)));
      const novos = ids.filter(Boolean);
      if (novos.length < partes.length) {
        flash(`${partes.length - novos.length} slide(s) não subiram. Tente de novo.`, "error");
      }
      if (novos.length) {
        let next;
        const sub = slicer.substituir;
        if (sub) {
          const base = slides.length ? slides : [sub];
          const i = base.indexOf(sub);
          next = i >= 0 ? [...base.slice(0, i), ...novos, ...base.slice(i + 1)] : novos;
        } else {
          next = [...slides, ...novos];
        }
        saveSlides(next);
        setViewIdx(0);
        flash(`Carrossel montado com ${novos.length} slides. ✅`, "success");
      }
      setSlicer(null);
    } catch (err) { flash(err.response?.data?.error || "Não consegui fatiar a arte.", "error"); }
    setSlideUploading(false);
  }

  // "Arrumar" um carrossel que já existe: pega a arte larga atual (uma tira com
  // várias slides lado a lado) e abre o corte, para trocá-la pelas slides.
  async function cortarArteExistente() {
    const id = slides[0] || fileId || coverId;
    if (!id) { flash("Não há arte para cortar aqui.", "error"); return; }
    try {
      const blob = (await api.get(`/files/${id}/download`, { responseType: "blob" })).data;
      const file = new File([blob], `${(item.title || "carrossel").replace(/[^\w.-]+/g, "_")}.jpg`,
        { type: blob.type || "image/jpeg" });
      const medida = await medirImagem(file);
      if (!medida?.fatiavel) {
        flash("Essa arte não é larga o bastante para virar um carrossel de várias slides.", "error");
        return;
      }
      setSlicer({ file, largura: medida.largura, altura: medida.altura, formato: medida.formato,
                  confianca: medida.confianca, sugestaoFormato: medida.sugestao, alternativas: medida.alternativas,
                  texto: String(dentroDaFaixa(medida.sugestao)), substituir: id });
    } catch { flash("Não consegui abrir a arte para cortar.", "error"); }
  }

  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("files", file);
      if (item.client_id) fd.append("client_id", item.client_id);
      fd.append("stage", "editados");
      const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      const newId = data?.[0]?.id;
      if (newId) { setFileId(newId); await api.put(`/distribution/${item.id}`, { file_id: newId }); }
    } catch (err) { flash(err.response?.data?.error || "Falha no upload.", "error"); }
    setUploading(false);
  }

  async function pickFromGallery(id, laminas) {
    // POST UNIDO NA GALERIA: entra como carrossel pronto, na ordem em que foi
    // montado lá. Nada é cortado — cada lâmina já é um arquivo inteiro.
    if (laminas?.length > 1) {
      await saveSlides(laminas);
      flash(`Carrossel de ${laminas.length} lâminas anexado.`, "success");
      return;
    }
    setFileId(id);
    try { await api.put(`/distribution/${item.id}`, { file_id: id }); }
    catch (err) { flash(err.response?.data?.error || "Não foi possível anexar.", "error"); }
  }

  // TIRAR A ARTE da peça, para começar do zero.
  //
  // Faltava por completo: dava para trocar a arte e para tirar uma slide, mas
  // não para deixar a peça sem arte nenhuma. Quem tinha uma tira errada
  // pendurada ficava preso com ela.
  //
  // Só desamarra da peça — o arquivo continua na Galeria, é só escolher de novo.
  async function limparArte() {
    if (!confirm("Tirar a arte desta peça? O arquivo continua na Galeria.")) return;
    try {
      await api.put(`/distribution/${item.id}`, { file_id: null, media_ids: [], cover_file_id: null });
      setFileId(null); setCoverId(null); setSlides([]); setViewIdx(0);
      flash("Arte tirada. A peça está pronta para receber outra.", "success");
      onChanged();
    } catch (err) { flash(err.response?.data?.error || "Não foi possível tirar a arte.", "error"); }
  }

  async function setCover(id) {
    setCoverId(id);
    try { await api.put(`/distribution/${item.id}`, { cover_file_id: id }); flash("Capa do perfil definida.", "success"); }
    catch (err) { flash(err.response?.data?.error || "Não foi possível definir a capa.", "error"); }
  }

  async function save(silent) {
    setSaving(true);
    try {
      await api.put(`/distribution/${item.id}`, { caption, description: obs, scheduled_at: fromInput(when) });
      if (!silent) flash("Salvo.", "success");
    } catch (err) { flash(err.response?.data?.error || "Não foi possível salvar.", "error"); }
    setSaving(false);
  }

  async function send() {
    setSending(true);
    try {
      await api.put(`/distribution/${item.id}`, { caption, description: obs, scheduled_at: fromInput(when) });
      await api.post(`/distribution/${item.id}/send`);
      flash("Enviado para o cliente aprovar. ✅", "success");
      onChanged();
    } catch (err) { flash(err.response?.data?.error || "Não foi possível enviar.", "error"); }
    setSending(false);
  }

  const canSend = Boolean(fileId && when);

  return (
    <Card sx={{ height: "100%" }}>
      <CardContent>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap", gap: 0.5 }}>
            {ct && <Chip size="small" color="primary" label={`${ct.emoji} ${ct.label}`} />}
            <Typography sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{item.title}</Typography>
          </Stack>
          {item.client_name && <Typography variant="caption" color="text.secondary">{item.client_name}</Typography>}

          {item.approval_status === "changes_requested" && (
            <Alert severity="warning" sx={{ py: 0.5 }}>
              Cliente pediu ajuste{item.client_note ? `: ${item.client_note}` : "."}
            </Alert>
          )}

          {/* Arte da peça. No carrossel vira um visualizador: a 1ª slide fica na
              frente e a pessoa desliza com a setinha. Fora do carrossel, mostra
              a capa/arte escolhida. */}
          {isCarousel && slides.length > 1 ? (
            // Carrossel já em slides SEPARADAS (um arquivo por slide): desliza
            // arquivo por arquivo.
            <Box sx={{ position: "relative" }}>
              {/* O endereço direto de CADA slide vem do servidor (media_urls, na
                  mesma ordem). Sem ele, esta prévia baixava a arte inteira da
                  slide — e com arte de vários MB ficava rodando sem fim. */}
              <Media fileId={slides[Math.min(viewIdx, slides.length - 1)]} natural
                streamUrl={enderecoDoArquivo(item, slides[Math.min(viewIdx, slides.length - 1)])}
                previaUrl={previaDoArquivo(item, slides[Math.min(viewIdx, slides.length - 1)])} />
              <IconButton size="small" onClick={() => setViewIdx((i) => (i - 1 + slides.length) % slides.length)}
                sx={{ position: "absolute", top: "50%", left: 6, transform: "translateY(-50%)", color: "#fff", bgcolor: "rgba(0,0,0,0.5)", "&:hover": { bgcolor: "rgba(0,0,0,0.75)" } }}>
                <ChevronLeftIcon />
              </IconButton>
              <IconButton size="small" onClick={() => setViewIdx((i) => (i + 1) % slides.length)}
                sx={{ position: "absolute", top: "50%", right: 6, transform: "translateY(-50%)", color: "#fff", bgcolor: "rgba(0,0,0,0.5)", "&:hover": { bgcolor: "rgba(0,0,0,0.75)" } }}>
                <ChevronRightIcon />
              </IconButton>
              <Box sx={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", px: 1, py: 0.25, borderRadius: 5, bgcolor: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 11, fontWeight: 700 }}>
                {Math.min(viewIdx, slides.length - 1) + 1} / {slides.length}
              </Box>
            </Box>
          ) : isCarousel ? (
            // Carrossel salvo como UMA arte larga: mostra em janelas de 1080px na
            // proporção de um post e desliza a janela com a setinha.
            <CarrosselLargo fileId={slides[0] || fileId || coverId}
              streamUrl={enderecoDoArquivo(item, slides[0] || fileId || coverId)} />
          ) : (
            // Se a PEÇA é vídeo, a arte dela é vídeo — não importa se o id bate
            // com o anexo. A comparação antiga fazia um reel ser desenhado como
            // <img>, que não toca vídeo: falhava e caía no download, e por isso
            // vídeo "não rodava" em peça cujo anexo tinha sido trocado.
            <Media fileId={fileId || coverId || slides[0]} capaId={coverId} natural
              streamUrl={enderecoDoArquivo(item, fileId || coverId || slides[0])}
              previaUrl={previaDoArquivo(item, fileId || coverId || slides[0])}
              ehVideoDica={pecaEhVideo(item)} />
          )}

          {isCarousel ? (
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Slides do carrossel, na ordem em que o cliente vai deslizar.
                A <b>capa é sempre a 1ª</b> — é ela que aparece no perfil e na prévia do feed.
                Para trocar a capa, use as setas e ponha outra slide na frente.
              </Typography>
              <Stack direction="row" spacing={1.25} sx={{ overflowX: "auto", pb: 0.5 }}>
                {slides.map((id, i) => (
                  <Box key={id} sx={{ width: 84, flex: "0 0 auto" }}>
                    <Box sx={{ position: "relative" }}>
                      <Box sx={{ borderRadius: 1, overflow: "hidden", border: 2, borderColor: i === 0 ? "primary.main" : "divider" }}>
                        {/* Sem o endereço direto, cada quadradinho de slide
                            baixava o arquivo inteiro — seis downloads de uma vez
                            só para desenhar seis miniaturas de 84px. */}
                        <Media fileId={id} height={110} comecoDaTira={isCarousel}
                          streamUrl={enderecoDoArquivo(item, id)}
                          previaUrl={previaDoArquivo(item, id)} />
                      </Box>
                      <Chip size="small" color={i === 0 ? "primary" : "default"}
                        label={i === 0 ? "★ capa" : i + 1}
                        sx={{ position: "absolute", top: 3, left: 3, height: 18, fontSize: 10, fontWeight: 700,
                              bgcolor: i === 0 ? undefined : "rgba(0,0,0,0.6)", color: i === 0 ? undefined : "#fff",
                              "& .MuiChip-label": { px: 0.7 } }} />
                      <IconButton size="small" onClick={() => removeSlide(id)} title="Tirar esta slide"
                        sx={{ position: "absolute", top: 0, right: 0, p: 0.25, color: "#fff", bgcolor: "rgba(0,0,0,0.5)", "&:hover": { bgcolor: "error.main" } }}>
                        <Typography sx={{ fontSize: 13, lineHeight: 1, fontWeight: 700 }}>×</Typography>
                      </IconButton>
                    </Box>
                    <Stack direction="row" justifyContent="center" alignItems="center" sx={{ mt: 0.25 }}>
                      <IconButton size="small" sx={{ p: 0.25 }} disabled={i === 0}
                        onClick={() => moveSlide(i, -1)} title="Mover para trás">
                        <ChevronLeftIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                      <IconButton size="small" sx={{ p: 0.25 }} disabled={i === slides.length - 1}
                        onClick={() => moveSlide(i, 1)} title="Mover para a frente">
                        <ChevronRightIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Stack>
                  </Box>
                ))}
                {!slides.length && <Typography variant="caption" color="text.disabled" sx={{ py: 2 }}>Nenhuma slide ainda — adicione abaixo.</Typography>}
              </Stack>
              <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                <Button component="label" variant="outlined" startIcon={<UploadIcon />} disabled={slideUploading} size="small" sx={{ flex: 1 }}>
                  {slideUploading ? "Enviando..." : "+ Slide"}
                  <input type="file" hidden accept="image/*,video/*" onChange={uploadSlide} />
                </Button>
                <Button variant="outlined" startIcon={<PhotoLibraryIcon />} size="small" sx={{ flex: 1 }}
                  onClick={() => setSlidePicker(true)} disabled={!item.client_id}>
                  + Da galeria
                </Button>
              </Stack>
              {/* Carrossel antigo que veio como UMA arte larga → cortar em slides.
                  Aparece quando ainda há no máximo 1 slide (a tira inteira). */}
              {(fileId || coverId || slides.length > 0) && (
                <Button fullWidth variant="text" size="small" color="error"
                  disabled={slideUploading} onClick={limparArte} sx={{ mt: 0.5 }}>
                  Tirar a arte desta peça
                </Button>
              )}
              {slides.length <= 1 && (fileId || slides[0]) && (
                <Button fullWidth variant="text" size="small" startIcon={<GridOnIcon />}
                  disabled={slideUploading} onClick={cortarArteExistente} sx={{ mt: 0.5 }}>
                  {slideUploading ? "Cortando…" : "Cortar arte larga em slides"}
                </Button>
              )}
            </Box>
          ) : (
            <>
              <Stack direction="row" spacing={1}>
                <Button component="label" variant="outlined" startIcon={<UploadIcon />} disabled={uploading} size="small" sx={{ flex: 1 }}>
                  {uploading ? "Enviando..." : "Subir"}
                  <input type="file" hidden accept="image/*,video/*" onChange={upload} />
                </Button>
                <Button variant="outlined" startIcon={<PhotoLibraryIcon />} size="small" sx={{ flex: 1 }}
                  onClick={() => setPicker(true)} disabled={!item.client_id}>
                  Da galeria
                </Button>
              </Stack>

              <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                <Button variant="text" startIcon={<StarIcon />} size="small" onClick={() => setCoverPicker(true)}
                  disabled={!item.client_id}>
                  {coverId ? "Trocar capa" : "Definir capa (foto)"}
                </Button>
                {fileId && (
                  <Button variant="text" size="small" onClick={() => setVideoCover(true)} disabled={!item.client_id}>
                    Escolher capa do vídeo
                  </Button>
                )}
              </Stack>
            </>
          )}

          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">Legenda</Typography>
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                <Button size="small" startIcon={<AutoAwesomeIcon />} onClick={gerarLegendaIA}
                  disabled={!item.client_id || iaLegenda}>
                  {iaLegenda ? "Gerando…" : "Gerar com IA"}
                </Button>
                <Button size="small" startIcon={<DescriptionIcon />} onClick={() => setPlanRef(true)} disabled={!item.client_id}>
                  Do planejamento
                </Button>
              </Stack>
            </Stack>
            <TextField label="Legenda" multiline minRows={2} value={caption} onChange={(e) => setCaption(e.target.value)} fullWidth />
          </Box>
          <TextField label="Observação (interna)" multiline minRows={1} value={obs} onChange={(e) => setObs(e.target.value)} fullWidth />
          <TextField label="Data e hora" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
            fullWidth InputLabelProps={{ shrink: true }} />

          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => save(false)} disabled={saving}>Salvar</Button>
            <Button variant="contained" startIcon={<SendIcon />} onClick={send} disabled={sending || !canSend}>
              Enviar p/ aprovação
            </Button>
          </Stack>
          {item.client_phone && (
            <Button size="small" startIcon={<WhatsAppIcon />} sx={{ color: "#25D366", alignSelf: "flex-start" }}
              onClick={() => window.open(whatsappLink(item.client_phone,
                `Oi! Preparei um conteúdo novo pra você aprovar. É só entrar na sua área do cliente 🙂`), "_blank")}>
              Avisar no WhatsApp
            </Button>
          )}

          {/* Postar manual — aparece quando o cliente já aprovou. Ideal pros
              Reels com música do Edits, que precisam ser postados no app. */}
          {item.approval_status === "approved" && (
            <>
              <Divider sx={{ my: 0.5 }}>Publicar no Instagram</Divider>
              {posted ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip color="success" icon={<CheckCircleIcon sx={{ fontSize: 16 }} />} label="Postado ✓" />
                  <Button size="small" color="inherit" onClick={() => marcarPostado(false)}>desfazer</Button>
                </Stack>
              ) : (
                <>
                  <Typography variant="caption" color="text.secondary">
                    Reels com música do Edits: baixe/abra o vídeo, monte a música no Edits e poste. Depois marque como postado aqui.
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                    <Button size="small" variant="outlined" startIcon={<DownloadIcon />}
                      disabled={baixando} onClick={baixarOuCompartilhar}>
                      {baixando ? "Preparando…" : "Baixar / abrir vídeo"}
                    </Button>
                    <Button size="small" variant="outlined" startIcon={<ContentCopyIcon />}
                      disabled={!caption} onClick={copiarLegenda}>Copiar legenda</Button>
                    <Button size="small" variant="contained" startIcon={<CheckCircleIcon />}
                      onClick={() => marcarPostado(true)}>Marquei como postado</Button>
                  </Stack>
                </>
              )}
            </>
          )}

          <GalleryPicker clientId={item.client_id} open={picker} onClose={() => setPicker(false)} onPick={pickFromGallery} />
          <GalleryPicker clientId={item.client_id} open={coverPicker} onClose={() => setCoverPicker(false)}
            onPick={setCover} titulo="Escolher a capa do perfil (uma foto)" />
          <GalleryPicker clientId={item.client_id} open={slidePicker} onClose={() => setSlidePicker(false)}
            onPick={addSlide} titulo="Adicionar slide ao carrossel" />
          <VideoCoverDialog fileId={fileId} streamUrl={enderecoDoArquivo(item, fileId)}
            clientId={item.client_id} open={videoCover}
            onClose={() => setVideoCover(false)} onCaptured={setCover} flash={flash} />
          <PlanningRefDialog clientId={item.client_id} ym={ymOf(when || item.scheduled_at)}
            open={planRef} onClose={() => setPlanRef(false)}
            onUse={(txt) => { setCaption(txt); flash("Legenda trazida do planejamento. Ajuste e salve.", "success"); }} />

          {/* Fatiar carrossel: a arte é mais larga que uma slide → pergunta em
              quantas partes cortar (cada uma vira uma slide, na ordem). */}
          <Dialog open={Boolean(slicer)} onClose={() => !slideUploading && setSlicer(null)} fullWidth maxWidth="xs">
            <DialogTitle>Cortar em carrossel</DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Essa arte tem <b>{slicer?.largura}×{slicer?.altura}px</b>.
                {slicer?.formato
                  ? <> Pelo formato, parece uma tira de <b>{dentroDaFaixa(slicer.sugestaoFormato ?? slicer.texto)}</b> slides
                      em <b>{slicer.formato}</b>.</>
                  : <> Não deu para reconhecer o formato das slides — confira o número abaixo.</>}
                {" "}A 1ª vira a capa, e no card você desliza pelas slides com a setinha.
              </Typography>
              {/* O campo guarda o que foi DIGITADO, e só arredonda para a faixa
                  quando a pessoa sai dele.
                  Antes a conta rodava a cada tecla: quem clicava no fim do "20"
                  e digitava 6 virava "206", que era cortado de volta para 20 na
                  hora; e apagar tudo voltava para 2 sozinho. Não dava para
                  escrever o número que se queria. */}
              <TextField type="number" label="Quantas slides" fullWidth autoFocus
                value={slicer?.texto ?? ""}
                onChange={(e) => setSlicer((s) => s && ({ ...s, texto: e.target.value }))}
                onFocus={(e) => e.target.select()}
                onBlur={() => setSlicer((s) => s && ({ ...s, texto: String(dentroDaFaixa(s.texto)) }))}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                inputProps={{ min: MIN_SLIDES, max: MAX_SLIDES, inputMode: "numeric" }}
                helperText={`De ${MIN_SLIDES} a ${MAX_SLIDES} slides — é o limite do Instagram.`} />
              {/* Às vezes a mesma arte fecha redonda de DOIS jeitos: uma tira de
                  4320×1080 é "4 quadrados" e também "5 slides 4:5". Em vez de
                  escolher por ela e ficar quieto, a outra leitura aparece aqui
                  a um clique. */}
              {slicer?.alternativas?.length > 0 && (
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 1, flexWrap: "wrap" }}>
                  <Typography variant="caption" color="text.secondary">Também encaixa em:</Typography>
                  {slicer.alternativas.map((a) => (
                    <Chip key={a.n} size="small" variant="outlined" label={`${a.n} · ${a.formato}`}
                      onClick={() => setSlicer((st) => st && ({ ...st, texto: String(a.n) }))} />
                  ))}
                </Stack>
              )}
              {slicer && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                  {(() => {
                    const n = dentroDaFaixa(slicer.texto);
                    const larguraNaArte = Math.round(slicer.largura / n);
                    const proporcao = (larguraNaArte / slicer.altura).toFixed(2);
                    const sugerido = dentroDaFaixa(slicer.sugestaoFormato ?? n);
                    // O TAMANHO QUE A SLIDE VAI TER DE VERDADE.
                    //
                    // Aqui aparecia a medida na resolução do ARQUIVO — mas o
                    // corte entrega sempre 1080 de largura (é o que o Instagram
                    // usa). Numa tira exportada em dobro, a tela prometia
                    // "2160×2700px" e saía 1080×1350: a conta na tela não batia
                    // com o resultado.
                    const escala = Math.min(1, LARGURA_ALVO / larguraNaArte);
                    const larguraFinal = Math.round(larguraNaArte * escala);
                    const alturaFinal = Math.round(slicer.altura * escala);
                    return (
                      <>
                        Cada slide fica <b>{larguraFinal}×{alturaFinal}px</b> (proporção {proporcao}).
                        {escala < 1 && <> A arte é maior que isso e é reduzida no corte — 1080 é a largura que o Instagram publica.</>}
                        {slicer.formato && n !== sugerido && (
                          <> Pelo formato da arte, o corte que fecha certinho é em <b>{sugerido}</b>.</>
                        )}
                      </>
                    );
                  })()}
                </Typography>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSlicer(null)} disabled={slideUploading}>Cancelar</Button>
              {/* "Manter inteira" só faz sentido ao SUBIR uma arte nova; para
                  arte que já está na peça, manter inteira é simplesmente cancelar. */}
              {!slicer?.substituir && (
                <Button variant="outlined" disabled={slideUploading}
                  onClick={async () => {
                    const { file: f, daGaleria } = slicer;
                    setSlicer(null);
                    // Vindo da galeria o arquivo JÁ existe: manter inteira é só
                    // usá-lo, sem subir uma cópia.
                    if (daGaleria) { saveSlides([...slides, daGaleria]); return; }
                    setSlideUploading(true);
                    try { const id = await subirArquivo(f); if (id) saveSlides([...slides, id]); }
                    catch (err) { flash(err.response?.data?.error || "Falha no upload.", "error"); }
                    setSlideUploading(false);
                  }}>
                  Manter inteira
                </Button>
              )}
              <Button variant="contained" onClick={confirmarFatiar} disabled={slideUploading}>
                {slideUploading ? "Cortando…" : `Cortar em ${dentroDaFaixa(slicer?.texto)}`}
              </Button>
            </DialogActions>
          </Dialog>
        </Stack>
      </CardContent>
    </Card>
  );
}

// Legenda das bolinhas de status (aparece no topo da Lista).
function StatusLegend() {
  return (
    <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 0.5, mb: 1 }}>
      {Object.values(STATUS).map((s) => (
        <Stack key={s.label} direction="row" spacing={0.5} alignItems="center">
          <Box sx={{ width: 11, height: 11, borderRadius: "50%", bgcolor: s.color }} />
          <Typography variant="caption" color="text.secondary">{s.label}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

// Visão em lista: uma linha por peça, com bolinha de status à direita.
// clique abre o editor; no modo seleção, marca para enviar p/ aprovação.
function ListView({ items, onSelect, selectMode, checked, onToggle }) {
  return (
    <Stack spacing={1}>
      {items.map((it) => {
        const ct = CONTENT_TYPES[it.content_type];
        const st = statusOf(it);
        // Antes só a "laranja" podia ser marcada, porque marcar servia só para
        // enviar. Agora marcar também serve para APAGAR — e a duplicada que ela
        // precisa tirar pode estar em qualquer estado. Quem não pode ser
        // enviada o servidor recusa, e o envio em lote já diz qual e por quê.
        const marcavel = true;
        const marcada = checked?.has(it.id);
        return (
          <Card key={it.id} sx={selectMode && marcada ? { outline: "2px solid", outlineColor: "primary.main" } : undefined}>
            <Box sx={{ display: "flex", gap: 1.5, p: 1, alignItems: "center" }}>
              {selectMode && (
                <Checkbox size="small" checked={!!marcada} disabled={!marcavel}
                  onChange={() => onToggle(it.id)} sx={{ p: 0.5 }} />
              )}
              <Box onClick={selectMode ? (marcavel ? () => onToggle(it.id) : undefined) : () => onSelect(it)}
                sx={{ display: "flex", gap: 1.5, flex: 1, minWidth: 0, alignItems: "center", cursor: selectMode ? (marcavel ? "pointer" : "default") : "pointer", "&:hover": { bgcolor: selectMode && !marcavel ? "transparent" : "action.hover" }, borderRadius: 1 }}>
                <Box sx={{ width: 56, height: 56, flexShrink: 0 }}><Media fileId={it.cover_file_id || it.file_id} height={56}
                    comecoDaTira={it.content_type === "carrossel"} /></Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
                    {ct && <Chip size="small" color="primary" variant="outlined" label={`${ct.emoji} ${ct.label}`} />}
                    {it.client_name && <Chip size="small" variant="outlined" label={it.client_name} />}
                  </Stack>
                  <Typography sx={{ fontWeight: 600, mt: 0.3 }} noWrap>{it.title}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {it.scheduled_at ? new Date(it.scheduled_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Sem data"}
                  </Typography>
                </Box>
                <StatusDot status={st} />
              </Box>
            </Box>
          </Card>
        );
      })}
    </Stack>
  );
}

// Visão em calendário: grade do mês com miniaturas.
// ---------------------------------------------------------------------------
// Separado POR MÊS. Filtrando por empresa, a lista vira o ano inteiro de
// conteúdo dela — sem as divisórias de mês não dá para achar nada.
// ---------------------------------------------------------------------------
function agrupaPorMes(itens) {
  const grupos = new Map();
  const semData = [];
  for (const it of itens) {
    if (!it.scheduled_at) { semData.push(it); continue; }
    const d = new Date(it.scheduled_at.replace(" ", "T"));
    if (Number.isNaN(d.getTime())) { semData.push(it); continue; }
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!grupos.has(chave)) {
      grupos.set(chave, { rotulo: `${MONTHS[d.getMonth()]} de ${d.getFullYear()}`, itens: [] });
    }
    grupos.get(chave).itens.push(it);
  }
  const ordenados = [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => g);
  // Sem data fica por último: é o que ainda falta resolver, não o que vem antes.
  if (semData.length) ordenados.push({ rotulo: "Sem data marcada", itens: semData, semData: true });
  return ordenados;
}

const GRADE = { display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" }, gap: 2, alignItems: "start" };

// GRADE COM OS CARDS DA MESMA ALTURA.
//
// Com `alignItems: start`, cada card fica com a altura do que tem dentro — e aí
// basta um título que quebra em duas linhas, ou um aviso de "pediu ajuste", para
// a fileira ficar desencontrada. Encaixar a arte numa caixa fixa resolve a maior
// parte, mas não tudo. Aqui os cards da fileira esticam até a altura do mais
// alto, e a fileira fica reta sempre.
const GRADE_IGUAL = { ...GRADE, alignItems: "stretch" };

// GRADE COMPACTA: os mesmos cards, só que BEM menores e muitos por linha.
//
// Com vinte peças no mês, três por linha viram uma rolagem longa para uma
// conferida que é de olho — "o que já tem arte, o que falta".
//
// A medida é por LARGURA DA PEÇA, não por número de colunas. Com colunas fixas
// por tamanho de tela, numa janela no meio de dois tamanhos caíam cinco por
// linha e a peça ficava do mesmo tamanho da visão normal — foi o "ficou igual
// à outra". Assim cada peça tem ~110px e a linha se enche com quantas couberem:
// numa tela de trabalho dá uma dúzia.
const LARGURA_COMPACTA = 110;
const GRADE_COMPACTA = {
  display: "grid", alignItems: "stretch", gap: 0.75,
  gridTemplateColumns: {
    xs: "repeat(3, 1fr)",
    sm: `repeat(auto-fill, minmax(${LARGURA_COMPACTA}px, 1fr))`,
  },
};

// O título de uma peça é "Post 5/6 — KN Advocacia Criminal (Setembro/2026)".
// Numa peça de 110px só cabe o começo — e o resto já está na tela: o cliente
// está escolhido ali em cima e o mês é o do bloco.
function rotuloCurto(titulo = "") {
  const curto = String(titulo).split(" — ")[0].trim();
  return curto || String(titulo);
}
// Vai no <Card> dessas listas, para ele de fato ocupar a altura que a grade deu.
const CARD_IGUAL = { height: "100%", display: "flex", flexDirection: "column" };

/**
 * CARTÃO COMPACTO: a arte, o tipo e o status, num selo pequeno.
 *
 * Não é o PieceCard encolhido — é outra peça de tela, com o mínimo para a
 * conferida de olho: dá para ver o que já tem arte, o que falta e o que foi
 * aprovado sem rolar a página inteira. Clicar abre a peça como nas outras
 * visões.
 */
function CartaoCompacto({ item, onSelect }) {
  const arte = item.preview_url || item.cover_preview_url || item.cover_url || item.media_url;
  const st = statusOf(item);
  const cor = { aprovado: "success.main", aguardando: "warning.main", ajuste: "error.main" }[st] || "divider";
  return (
    <Card variant="outlined" sx={{ ...CARD_IGUAL, cursor: "pointer", borderColor: cor }}
      onClick={() => onSelect?.(item)}>
      <Box sx={{ position: "relative", width: "100%", aspectRatio: "4 / 5", bgcolor: "action.hover" }}>
        {arte ? (
          <Box component="img" src={arte} alt={item.title} loading="lazy"
            sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", p: 0.5 }}>
            <Typography color="text.secondary" align="center" sx={{ fontSize: 10, lineHeight: 1.2 }}>sem arte</Typography>
          </Box>
        )}
        {item.bonus ? (
          <Chip size="small" label="bônus" color="secondary"
            sx={{ position: "absolute", top: 2, left: 2, height: 15, fontSize: 9, fontWeight: 700,
                  "& .MuiChip-label": { px: 0.5 } }} />
        ) : null}
      </Box>
      {/* O nome inteiro não cabe num selo de 110px — e o que foi cortado já
          está na tela: o cliente ali em cima, o mês no título do bloco. O nome
          completo continua no repousar do mouse. */}
      <Tooltip title={item.title || ""} placement="top">
        <Box sx={{ px: 0.5, py: 0.4, minWidth: 0 }}>
          <Typography noWrap sx={{ display: "block", fontWeight: 700, fontSize: 11, lineHeight: 1.25 }}>
            {rotuloCurto(item.title)}
          </Typography>
          <Typography noWrap color="text.secondary" sx={{ display: "block", fontSize: 10, lineHeight: 1.25 }}>
            {item.scheduled_at ? formatDate(item.scheduled_at) : "sem data"}
          </Typography>
        </Box>
      </Tooltip>
    </Card>
  );
}

/** Desenha os itens em blocos de mês. `children` é como cada item vira cartão. */
function PorMes({ itens, children, grade = GRADE }) {
  const grupos = agrupaPorMes(itens);
  if (grupos.length <= 1) return <Box sx={grade}>{itens.map(children)}</Box>;
  return (
    <Stack spacing={3}>
      {grupos.map((g) => (
        <Box key={g.rotulo}>
          <Divider textAlign="left" sx={{ mb: 1.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: .5 }}
              color={g.semData ? "error.main" : "primary.main"}>
              {g.rotulo} · {g.itens.length}
            </Typography>
          </Divider>
          <Box sx={grade}>{g.itens.map(children)}</Box>
        </Box>
      ))}
    </Stack>
  );
}

function MonthGrid({ items, onSelect }) {
  const [cursor, setCursor] = useState(() => new Date());
  const byDay = useMemo(() => {
    const map = {};
    items.forEach((it) => {
      if (!it.scheduled_at) return;
      const d = new Date(it.scheduled_at.replace(" ", "T"));
      if (d.getFullYear() === cursor.getFullYear() && d.getMonth() === cursor.getMonth()) {
        (map[d.getDate()] ||= []).push(it);
      }
    });
    return map;
  }, [items, cursor]);

  const grid = useMemo(() => {
    const y = cursor.getFullYear(), m = cursor.getMonth();
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="center" spacing={2} sx={{ mb: 2 }}>
        <IconButton onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}><ChevronLeftIcon /></IconButton>
        <Typography variant="h6" sx={{ minWidth: 190, textAlign: "center" }}>{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</Typography>
        <IconButton onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}><ChevronRightIcon /></IconButton>
      </Stack>
      <Card>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: 1, borderColor: "divider" }}>
          {WEEKDAYS.map((w) => (
            <Typography key={w} variant="caption" sx={{ p: 1, textAlign: "center", fontWeight: 700, color: "text.secondary" }}>{w}</Typography>
          ))}
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {grid.map((day, i) => (
            <Box key={i} sx={{ minHeight: 118, p: 0.5, borderRight: (i + 1) % 7 !== 0 ? 1 : 0, borderBottom: i < grid.length - 7 ? 1 : 0, borderColor: "divider" }}>
              {day && (
                <>
                  <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>{day}</Typography>
                  <Stack spacing={0.5} sx={{ mt: 0.4 }}>
                    {(byDay[day] || []).slice(0, 2).map((it) => (
                      <Box key={it.id} onClick={() => onSelect(it)} sx={{ cursor: "pointer", borderRadius: 1, overflow: "hidden", border: 1, borderColor: "divider", "&:hover": { borderColor: "primary.main" } }}>
                        <Box sx={{ position: "relative", aspectRatio: "1" }}>
                          {/* O ENDEREÇO DIRETO TAMBÉM AQUI.
                              Esta era a única visão que chamava o <Media> sem
                              ele: caía no download pelo servidor e, quando esse
                              caminho falha, TODA peça do mês virava "Arte não
                              carregou (reenvie)" — inclusive as que estavam
                              perfeitas nas outras visões. */}
                          <Media fileId={it.cover_file_id || it.file_id} height="100%"
                            streamUrl={enderecoDoArquivo(it, it.cover_file_id || it.file_id) || enderecoDaPeca(it)}
                            previaUrl={it.cover_preview_url || it.preview_url}
                            ehVideoDica={pecaEhVideo(it)}
                            comecoDaTira={it.content_type === "carrossel"} />
                          <Box sx={{ position: "absolute", left: 3, bottom: 3, px: 0.5, borderRadius: 0.5, bgcolor: "rgba(0,0,0,0.62)", color: "#fff", fontSize: 10, fontWeight: 700 }}>
                            {formatTime(it.scheduled_at)}
                          </Box>
                        </Box>
                      </Box>
                    ))}
                    {(byDay[day] || []).length > 2 && (
                      <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5 }}>+{byDay[day].length - 2} mais</Typography>
                    )}
                  </Stack>
                </>
              )}
            </Box>
          ))}
        </Box>
      </Card>
    </>
  );
}

// Miniatura da grade do perfil. Ordem: a miniatura leve (foto ou quadro do
// vídeo); se o arquivo não tiver miniatura, cai na arte inteira — e aí VÍDEO é
// desenhado com <video> mostrando o 1º quadro, porque <img> não toca vídeo (era
// por isso que os vídeos não apareciam aqui).
function FeedThumb({ fileId, comecoDaTira = false, streamUrl = null, previaUrl = null, ehVideo = false }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const [thumb, setThumb] = useState(null);
  const [midia, setMidia] = useState(null);   // { url, type } quando não há miniatura
  const [erro, setErro] = useState(false);
  const [faltouStream, setFaltouStream] = useState(false);
  // Arquivo novo recomeça do zero (inclusive a marca de "o direto falhou").
  useEffect(() => { setFaltouStream(false); }, [fileId, streamUrl]);

  useEffect(() => {
    setThumb(null); setMidia(null); setErro(false);
    if (!fileId) return;
    let alive = true;
    // A miniatura entra como RASCUNHO instantâneo. Quando há endereço direto, a
    // arte de verdade desenha por cima — antes a grade parava na miniatura
    // (720px, comprimida) e o perfil ficava embaçado para sempre, mesmo com a
    // arte em qualidade cheia a um clique de distância.
    loadThumb(fileId).then((t) => {
      if (!alive) return;
      if (t) setThumb(t);
      // Baixa a arte quando NÃO há endereço direto, ou quando ele já falhou.
      // Sem a segunda parte, um endereço direto que não desenha (arquivo que
      // mudou de lugar, foto de iPhone) não tinha caminho de volta: o quadro
      // escrevia "sem arte" numa peça que TEM arte.
      if (!t && (!streamUrl || faltouStream)) {
        loadMedia(fileId)
          .then((m) => { if (alive && m) setMidia(m); })
          .catch(() => { if (alive) setErro(true); });
      }
    });
    return () => { alive = false; };  // não revoga: o cache é dono da URL
  }, [fileId, streamUrl, faltouStream]);

  // Carrossel salvo como UMA imagem larga: a capa é o começo da tira (os
  // primeiros 1080px da esquerda), nunca o meio. Ver FeedPreview.jsx.
  const sx = {
    width: "100%", height: "100%", objectFit: "cover", display: "block",
    objectPosition: comecoDaTira ? "left center" : "center",
  };
  const vazio = (texto, cor = "text.disabled") => (
    <Box sx={{ width: "100%", height: "100%", display: "grid", placeItems: "center", textAlign: "center",
               color: cor, fontSize: 10, lineHeight: 1.2, p: 0.5 }}>{texto}</Box>
  );

  if (erro) return vazio("arte não carregou", "error.main");

  // Arte em QUALIDADE CHEIA, direto da nuvem, com a miniatura por baixo
  // enquanto ela não chega. loading="lazy": só o que está à vista carrega.
  if (streamUrl && !faltouStream) {
    if (ehVideo) {
      return <Box component="video" src={`${streamUrl}#t=0.1`} poster={thumb || undefined}
        preload="metadata" muted playsInline sx={{ ...sx, bgcolor: "#000" }}
        onError={() => setFaltouStream(true)}
        onLoadedData={(e) => guardarMiniatura(fileId, e.currentTarget)} />;
    }
    // A PRÉVIA no lugar da arte original. O quadradinho do perfil tem uns 350
    // px de verdade; a prévia tem 1080 e pesa uns 150 KB, contra vários MB da
    // arte. A nitidez na tela é a mesma — o que muda é o que a internet dela
    // (e a do cliente) tem que carregar. Sem prévia, cai na arte, como antes.
    return (
      <Box sx={{ width: "100%", height: "100%", position: "relative",
                 backgroundImage: thumb ? `url(${thumb})` : undefined,
                 backgroundSize: "cover",
                 backgroundPosition: comecoDaTira ? "left center" : "center" }}>
        <Box component="img" src={previaUrl || streamUrl} alt="" loading="lazy" decoding="async" sx={sx}
          onError={() => setFaltouStream(true)}
          onLoad={(e) => { guardarMiniatura(fileId, e.currentTarget); if (!previaUrl) guardarPrevia(fileId, e.currentTarget); }} />
      </Box>
    );
  }

  if (thumb) return <Box component="img" src={thumb} alt="" sx={sx} onError={() => setErro(true)} />;
  if (!midia) return vazio("sem arte");
  if ((midia.type || "").startsWith("video")) {
    // preload="metadata" + #t=0.1 = mostra o 1º quadro sem baixar o vídeo todo.
    // E aproveita esse quadro para guardar a miniatura: da próxima vez esta
    // grade nem toca no vídeo.
    return <Box component="video" src={`${midia.url}#t=0.1`} preload="metadata" muted playsInline
      sx={{ ...sx, bgcolor: "#000" }} onError={() => setErro(true)}
      onLoadedData={(e) => guardarMiniatura(fileId, e.currentTarget)} />;
  }
  return <Box component="img" src={midia.url} alt="" sx={sx} onError={() => setErro(true)}
    onLoad={(e) => guardarMiniatura(fileId, e.currentTarget)} />;
}

const dtISO = (v) => (v ? new Date(v.replace(" ", "T")) : null);

// Prévia do perfil ARRASTÁVEL: organiza o feed (salva a ORDEM). As datas ficam
// paradas — cada peça mantém a sua. Sem data ou no passado aparece em vermelho
// (clique para ajustar). O 1º fica em cima à esquerda; enche → direita → baixo.
function ReorderableFeed({ posts, fetchFile, onSelect, onReorder, onVoltarPorData, titulo }) {
  // O PERFIL só tem o que já existe. Peça sem arte não é um quadrado cinza no
  // Instagram — ela simplesmente não está lá. Deixá-la na grade dava um perfil
  // falso, cheio de buracos que ninguém vai ver.
  const comArte = useMemo(() => posts.filter((p) => p.cover_file_id || p.file_id), [posts]);
  const semArte = posts.length - comArte.length;
  const [order, setOrder] = useState(comArte);
  const [dragId, setDragId] = useState(null); // qual peça está sendo arrastada
  const dragIndex = useRef(null);
  const movedRef = useRef(false);
  // Só ressincroniza com o servidor quando NÃO está arrastando (evita "pulo").
  useEffect(() => { if (dragIndex.current == null) setOrder(comArte); }, [comArte]);

  const now = Date.now();
  const errada = (p) => { const d = dtISO(p.scheduled_at); return !d || d.getTime() < now; };

  // Ao passar por cima de outro quadrado, já reencaixa ao vivo (os outros se
  // ajustam na hora). No fim (soltar) só salva a ordem — sem recarregar a tela.
  function onEnter(i) {
    const from = dragIndex.current;
    if (from == null || from === i) return;
    setOrder((arr) => {
      const next = [...arr];
      const [m] = next.splice(from, 1);
      next.splice(i, 0, m);
      return next;
    });
    dragIndex.current = i;
    movedRef.current = true;
  }
  function fim() {
    dragIndex.current = null;
    setDragId(null);
    if (movedRef.current) { movedRef.current = false; onReorder(order.map((p) => p.id)); }
  }

  if (!comArte.length) {
    return <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
      {posts.length
        ? `${posts.length} peça(s) ainda sem arte — o perfil aparece aqui assim que você anexar a primeira.`
        : "Nada por aqui ainda. As peças que estiverem na Distribuição aparecem aqui para organizar."}
    </Typography>;
  }

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ flexWrap: "wrap", gap: 1 }}>
        <Typography variant="subtitle2">{titulo}</Typography>
        {/* A saída quando a ordem arrastada e as datas já não batem: uma vez
            arrastado, o quadro fica preso na posição e mudar a data não o move
            mais. Isto devolve o mando à data, sem mexer em data nenhuma. */}
        {onVoltarPorData && order.some((p) => (p.position || 0) > 0) && (
          <Button size="small" onClick={() => onVoltarPorData(order.map((p) => p.id))}>
            Voltar à ordem por data
          </Button>
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
        O mais recente em cima à esquerda, como no perfil. Arraste para organizar (encaixa entre um e
        outro) — a ordem fica salva e as datas não mudam. Em vermelho = sem data ou no passado
        (clique para ajustar). Mudar a data de uma peça devolve ela para o lugar que a data manda.
        {semArte > 0 && ` ${semArte} peça(s) ainda sem arte ficam de fora daqui.`}
      </Typography>
      <Box sx={{ maxWidth: 380, mx: "auto", border: 1, borderColor: "divider", borderRadius: 0, overflow: "hidden" }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px", bgcolor: "divider" }}>
          {(() => {
            // Igual ao perfil real (e à Área do Cliente): a folga (quando o total
            // não fecha múltiplo de 3) sobra EM CIMA, à direita do mais recente —
            // as linhas de baixo ficam completas. O `i` do arrasto continua sendo
            // o índice na ordem salva, então as células vazias não atrapalham.
            const resto = order.length % 3;
            const folga = resto === 0 ? 0 : 3 - resto;
            const celula = (p, i) => (
              <Box key={p.id} draggable
                onDragStart={() => { dragIndex.current = i; movedRef.current = false; setDragId(p.id); }}
                onDragEnter={() => onEnter(i)}
                onDragOver={(e) => e.preventDefault()}
                onDragEnd={fim}
                onDrop={(e) => { e.preventDefault(); fim(); }}
                onClick={() => onSelect(p)}
                sx={{
                  position: "relative", aspectRatio: "1080 / 1440", cursor: "grab", bgcolor: "action.hover", overflow: "hidden",
                  opacity: dragId === p.id ? 0.35 : 1, transition: "opacity .12s ease",
                  outline: errada(p) ? "2px solid" : "none", outlineColor: "error.main", outlineOffset: "-2px",
                }}>
                <FeedThumb fileId={p.cover_file_id || p.file_id} fetchFile={fetchFile}
                  streamUrl={enderecoDoArquivo(p, p.cover_file_id || p.file_id) || enderecoDaPeca(p)}
                  previaUrl={previaDoArquivo(p, p.cover_file_id || p.file_id)}
                  ehVideo={pecaEhVideo(p)}
                  comecoDaTira={p.content_type === "carrossel"} />
                <Box sx={{
                  position: "absolute", bottom: 0, left: 0, right: 0, px: 0.5, py: 0.25,
                  bgcolor: errada(p) ? "error.main" : "rgba(0,0,0,0.6)", color: "#fff", fontSize: 10, fontWeight: 700,
                }}>
                  {p.scheduled_at ? dtISO(p.scheduled_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "sem data"}
                </Box>
              </Box>
            );
            return [
              ...order.slice(0, resto).map((p, j) => celula(p, j)),
              ...Array.from({ length: folga }, (_, k) => (
                <Box key={`gap-${k}`} sx={{ aspectRatio: "1080 / 1440", bgcolor: "background.paper" }} />
              )),
              ...order.slice(resto).map((p, j) => celula(p, resto + j)),
            ];
          })()}
        </Box>
      </Box>
    </Box>
  );
}

export default function Distribution() {
  // Arrastando uma peça perto do rodapé, a página desce sozinha — sem precisar
  // encostar na borda da tela, que no Mac é onde o Dock abre por cima.
  useEffect(() => ligarRolagemAoArrastar(), []);
  const [clients, setClients] = useState([]);
  const [clientFilter, setClientFilter] = useState("");
  const [items, setItems] = useState([]);
  const [scheduled, setScheduled] = useState([]); // panorama completo (calendário)
  const [stage, setStage] = useState(null);
  const [loading, setLoading] = useState(true);
  const loadedOnce = useRef(false);
  const [msg, setMsg] = useState(null);
  const [view, setView] = useState("post"); // post | list | feed | calendar
  const [selected, setSelected] = useState(null); // peça no editor (lista/perfil/calendário)
  const [selectMode, setSelectMode] = useState(false); // seleção múltipla na visão "Por post"
  const [checked, setChecked] = useState(() => new Set()); // ids marcados
  const [apagando, setApagando] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);
  const [bonus, setBonus] = useState({ client_id: "", content_type: "post", month: "" });
  const [sendingBulk, setSendingBulk] = useState(false);
  const [approved, setApproved] = useState([]); // aprovados aguardando programação
  const [programmed, setProgrammed] = useState([]); // já programados
  const [waiting, setWaiting] = useState([]);   // enviados, esperando o cliente aprovar
  const [postFilter, setPostFilter] = useState("para_aprovar"); // para_aprovar | aprovados | programados

  const flash = (texto, tipo = "success") => { setMsg({ texto, tipo }); setTimeout(() => setMsg(null), 4000); };
  const fetchFile = useCallback((id) => api.get(`/files/${id}/download`, { responseType: "blob" }).then((r) => r.data), []);

  useEffect(() => { api.get("/clients").then((r) => setClients(r.data)).catch(() => {}); }, []);

  const vTasks = useLiveVersion("tasks");
  const vDist = useLiveVersion("distribution");
  const load = (opts = {}) => {
    // Só mostra o spinner de tela cheia na 1ª carga. Recargas de fundo (SSE,
    // reorganizar) atualizam sem piscar — o feed fica liso.
    if (!loadedOnce.current && !opts.silent) setLoading(true);
    const params = clientFilter ? { client_id: clientFilter } : {};
    api.get("/distribution", { params })
      .then((r) => { setItems(r.data.items || []); setScheduled(r.data.scheduled || []); setApproved(r.data.approved || []); setProgrammed(r.data.programmed || []); setWaiting(r.data.waiting || []); setStage(r.data.stage); })
      .catch(() => { setItems([]); setScheduled([]); setApproved([]); setProgrammed([]); setWaiting([]); })
      .finally(() => { setLoading(false); loadedOnce.current = true; });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [clientFilter, vTasks, vDist]);

  // Volta o perfil à ordem POR DATA: apaga as posições salvas.
  async function voltarPorData(ids) {
    try {
      await api.post("/distribution/reorder-reset", { ids });
      flash("Perfil de volta à ordem por data.", "success");
      load({ silent: true });
    } catch (e) {
      flash(e.response?.data?.error || "Não foi possível reorganizar.", "error");
    }
  }

  // Organiza o feed salvando SÓ a ordem (posição) — as datas ficam paradas.
  async function reorderPosition(ids) {
    // A ordem já foi aplicada na tela (otimista). Só persiste — sem recarregar,
    // pra não piscar. A sincronização entre telas vem pelo SSE, silenciosa.
    try {
      await api.post("/distribution/reorder-position", { ids });
    } catch (e) {
      flash(e.response?.data?.error || "Não foi possível organizar.", "error");
      load({ silent: true });
    }
  }

  async function programar(it) {
    try { await api.post(`/distribution/${it.id}/schedule`); flash("Programado! ✅", "success"); load(); }
    catch (e) { flash(e.response?.data?.error || "Não foi possível programar.", "error"); }
  }

  function toggleCheck(id) {
    setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function sairDaSelecao() { setSelectMode(false); setChecked(new Set()); }

  /**
   * APAGAR AS MARCADAS. Nasceu de um lançamento duplicado: setembro veio em
   * dobro e não havia como desfazer sem ir até o quadro de Tarefas. Pergunta
   * antes e diz quantas — apagar peça é coisa que não volta.
   */
  async function apagarSelecionadas() {
    const ids = [...checked];
    if (!ids.length) return;
    if (!window.confirm(
      `Apagar ${ids.length} peça(s) da Distribuição?\n\n`
      + "As artes continuam na Galeria; o que sai é a peça da lista. Não dá para desfazer."
    )) return;
    setApagando(true);
    let erros = 0;
    for (const id of ids) {
      try { await api.delete(`/distribution/${id}`); } catch { erros++; }
    }
    setApagando(false);
    sairDaSelecao();
    flash(erros
      ? `${ids.length - erros} apagada(s); ${erros} não deu.`
      : `${ids.length} peça(s) apagada(s).`, erros ? "error" : "success");
    load();
  }

  /**
   * POST BÔNUS: uma peça a mais, além do que o contrato prevê. Ela escolhe o
   * cliente, o tipo e o mês; o relatório mostra esse extra à parte, sem inflar
   * a entrega do combinado.
   */
  async function criarBonus() {
    if (!bonus.client_id) return;
    try {
      await api.post("/distribution", {
        client_id: bonus.client_id,
        content_type: bonus.content_type,
        month: bonus.month || new Date().toISOString().slice(0, 7),
      });
      setBonusOpen(false);
      flash("Post bônus criado — já aparece na lista para receber a arte.", "success");
      load();
    } catch (e) {
      flash(e.response?.data?.error || "Não consegui criar o post bônus.", "error");
    }
  }

  /**
   * A BARRA DE SELEÇÃO, uma só para as três visões.
   *
   * Eram duas cópias quase iguais, e o botão de apagar teria virado uma
   * terceira. `todas` é o que "Marcar todas" seleciona naquela visão.
   */
  function BarraDeSelecao({ todas = null }) {
    const marcarTodas = () => setChecked(new Set((todas || items).map((i) => i.id)));
    return (
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: "wrap", gap: 1 }}>
        {!selectMode ? (
          <Button size="small" variant="outlined" startIcon={<CheckBoxIcon />} onClick={() => setSelectMode(true)}>
            Selecionar
          </Button>
        ) : (
          <>
            <Button size="small" color="inherit" onClick={sairDaSelecao}>Cancelar</Button>
            <Button size="small" onClick={marcarTodas}>Marcar todas</Button>
            <Typography variant="body2" color="text.secondary">{checked.size} marcada(s)</Typography>
            <Box sx={{ flex: 1 }} />
            {/* APAGAR: o conserto do lançamento duplicado. Fica antes do enviar
                e em vermelho, para não ser clicado por engano. */}
            <Button size="small" color="error" startIcon={<DeleteIcon />}
              disabled={apagando || checked.size === 0} onClick={apagarSelecionadas}>
              {apagando ? "Apagando..." : `Apagar ${checked.size || ""}`}
            </Button>
            <Button size="small" variant="contained" startIcon={<SendIcon />}
              disabled={sendingBulk || checked.size === 0} onClick={enviarSelecionadas}>
              {sendingBulk ? "Enviando..." : `Enviar ${checked.size || ""} para aprovação`}
            </Button>
          </>
        )}
      </Stack>
    );
  }

  // Envia todas as peças marcadas para aprovação (uma a uma). Cada peça precisa
  // ter mídia e data; as que não tiverem são reportadas.
  async function enviarSelecionadas() {
    const ids = [...checked];
    if (!ids.length) return;
    setSendingBulk(true);
    let ok = 0; const falhas = [];
    for (const id of ids) {
      try { await api.post(`/distribution/${id}/send`); ok++; }
      catch (e) {
        const it = [...items, ...scheduled].find((i) => i.id === id);
        falhas.push(`${it?.title || id}: ${e.response?.data?.error || "erro"}`);
      }
    }
    setSendingBulk(false);
    sairDaSelecao();
    load();
    if (falhas.length) flash(`${ok} enviada(s). ${falhas.length} não foram: ${falhas.join(" · ")}`, "error");
    else flash(`${ok} peça(s) enviadas para aprovação. ✅`, "success");
  }

  // Quando algo muda ao vivo, reflete na peça aberta no editor.
  const selectedFresh = selected ? items.find((i) => i.id === selected.id) || selected : null;

  // Prévia do perfil: junta tudo (com ou SEM data) — programados, aprovados e as
  // peças em preparação — para organizar o feed arrastando. Ordena pela POSIÇÃO
  // salva (o que você arrumou); sem posição, mais recente primeiro.
  const feedPosts = useMemo(() => {
    const map = new Map();
    [...scheduled, ...approved, ...items].forEach((i) => {
      if (!map.has(i.id)) map.set(i.id, { ...i, file_id: i.cover_file_id || i.file_id });
    });
    return [...map.values()].sort((a, b) => {
      // position 0 = nunca arrastada. Quem foi arrumada à mão vem na ordem que
      // ela deu; o resto segue a data, mais recente primeiro.
      const pa = a.position || 1e9, pb = b.position || 1e9;
      if (pa !== pb) return pa - pb;
      return (b.scheduled_at || "") > (a.scheduled_at || "") ? 1 : -1;
    });
  }, [scheduled, approved, items]);

  // Um perfil é de UM cliente. Sem filtro ("Todas"), agrupa por cliente para
  // mostrar um grid separado por empresa (em vez de misturar todo mundo num só).
  const feedGroups = useMemo(() => {
    const m = new Map();
    feedPosts.forEach((p) => {
      const k = p.client_id ?? "sem";
      if (!m.has(k)) m.set(k, { clientId: k, clientName: p.client_name || "Sem cliente", posts: [] });
      m.get(k).posts.push(p);
    });
    return [...m.values()].sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR"));
  }, [feedPosts]);

  return (
    <>
      <PageHeader title="Distribuição" subtitle="Prepare as peças, programe e veja o calendário do que vai ao ar"
        action={
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: "wrap", gap: 1 }}>
            <TextField select size="small" label="Empresa" value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">Todas</MenuItem>
              {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <Button size="small" variant="outlined" startIcon={<AddIcon />}
              onClick={() => { setBonus({ client_id: clientFilter || "", content_type: "post", month: new Date().toISOString().slice(0, 7) }); setBonusOpen(true); }}>
              Post bônus
            </Button>
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
              <ToggleButton value="post" aria-label="Por post"><ViewModuleIcon fontSize="small" /></ToggleButton>
              <ToggleButton value="compacto" aria-label="Compacto"><ViewComfyIcon fontSize="small" /></ToggleButton>
              <ToggleButton value="list" aria-label="Lista"><ViewListIcon fontSize="small" /></ToggleButton>
              <ToggleButton value="feed" aria-label="Perfil"><GridOnIcon fontSize="small" /></ToggleButton>
              <ToggleButton value="calendar" aria-label="Calendário"><CalendarViewMonthIcon fontSize="small" /></ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        } />

      {msg && <Alert severity={msg.tipo} sx={{ mb: 2 }}>{msg.texto}</Alert>}

      {/* POST BÔNUS: uma peça além do que o contrato do cliente prevê. */}
      <Dialog open={bonusOpen} onClose={() => setBonusOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Post bônus</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Uma peça <b>além</b> do combinado do mês. Ela entra na lista como as outras — recebe arte,
              legenda e aprovação do mesmo jeito — e no relatório aparece à parte, sem contar como
              entrega do contrato.
            </Typography>
            <TextField select size="small" fullWidth label="Cliente" value={bonus.client_id}
              onChange={(e) => setBonus((b) => ({ ...b, client_id: e.target.value }))}>
              {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <TextField select size="small" fullWidth label="Tipo" value={bonus.content_type}
              onChange={(e) => setBonus((b) => ({ ...b, content_type: e.target.value }))}>
              {/* CONTENT_TYPES é um objeto (chave -> {label, emoji}), não uma
                  lista. E só os tipos que viram post entram aqui: "reunião" ou
                  "captação" não são peça publicada. */}
              {["post", "carrossel", "reel", "stories", "foto"].map((k) => (
                <MenuItem key={k} value={k}>
                  {CONTENT_TYPES[k]?.emoji} {CONTENT_TYPES[k]?.label || k}
                </MenuItem>
              ))}
            </TextField>
            <TextField size="small" fullWidth type="month" label="Mês" value={bonus.month}
              onChange={(e) => setBonus((b) => ({ ...b, month: e.target.value }))}
              InputLabelProps={{ shrink: true }}
              helperText="Cai no dia 1; depois é só arrastar no calendário." />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBonusOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={criarBonus} disabled={!bonus.client_id}>Criar</Button>
        </DialogActions>
      </Dialog>

      {!stage && !loading ? (
        <EmptyState message="Crie uma etapa chamada 'Distribuição' no quadro de Tarefas para usar esta aba." />
      ) : loading ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 6 }}><CircularProgress /></Box>
      ) : view === "compacto" ? (
        <>
          <BarraDeSelecao />
          <PorMes itens={items} grade={GRADE_COMPACTA}>
            {(it) => (
              <Box key={it.id} sx={{ position: "relative" }}>
                {selectMode && (
                  <Checkbox size="small" checked={checked.has(it.id)} onChange={() => toggleCheck(it.id)}
                    sx={{ position: "absolute", top: 1, right: 1, zIndex: 2, p: 0.15,
                          "& .MuiSvgIcon-root": { fontSize: 16 },
                          bgcolor: "background.paper", borderRadius: 1, "&:hover": { bgcolor: "background.paper" } }} />
                )}
                <Box onClick={selectMode ? () => toggleCheck(it.id) : undefined}
                  sx={selectMode ? {
                    cursor: "pointer",
                    outline: checked.has(it.id) ? "2px solid" : "2px solid transparent",
                    outlineColor: "primary.main", borderRadius: 2,
                    "& *": { pointerEvents: "none" },
                  } : undefined}>
                  <CartaoCompacto item={it} onSelect={setSelected} />
                </Box>
              </Box>
            )}
          </PorMes>
        </>
      ) : view === "post" ? (
        <>
          {/* Filtro: para aprovar (preparar/enviar) x aprovados (programar) */}
          <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap", gap: 1 }} alignItems="center">
            <ToggleButtonGroup size="small" exclusive value={postFilter} onChange={(_, v) => v && setPostFilter(v)}
              sx={{ flexWrap: "wrap" }}>
              <ToggleButton value="para_aprovar">Preparar{items.length ? ` (${items.length})` : ""}</ToggleButton>
              <ToggleButton value="aguardando">Para aprovação{waiting.length ? ` (${waiting.length})` : ""}</ToggleButton>
              <ToggleButton value="aprovados">Aprovados{approved.length ? ` (${approved.length})` : ""}</ToggleButton>
              <ToggleButton value="programados">Programados{programmed.length ? ` (${programmed.length})` : ""}</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {postFilter === "programados" ? (
            programmed.length === 0 ? (
              <EmptyState message="Nada programado ainda. Quando você programa um conteúdo aprovado, ele aparece aqui." />
            ) : (
              <PorMes itens={programmed} grade={GRADE_IGUAL}>
                {(p) => {
                  const ct = CONTENT_TYPES[p.content_type];
                  return (
                    <Card key={p.id} sx={CARD_IGUAL}>
                      <CardContent sx={{ flexGrow: 1, display: "flex" }}>
                        <Stack spacing={1} sx={{ flex: 1, width: "100%" }}>
                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: "wrap", gap: 0.5 }}>
                            {ct && <Chip size="small" color="primary" label={`${ct.emoji} ${ct.label}`} />}
                            <Chip size="small" color="info" label="Programado 🗓️" />
                          </Stack>
                          {p.client_name && <Typography variant="caption" color="text.secondary">{p.client_name}</Typography>}
                          {p.content_type === "carrossel"
                            ? <CarrosselLargo fileId={p.cover_file_id || p.file_id} streamUrl={enderecoDaPeca(p)} mesmaAltura />
                            : <Media fileId={p.file_id || p.cover_file_id} capaId={p.cover_file_id} natural mesmaAltura
                                streamUrl={enderecoDaPeca(p)} ehVideoDica={pecaEhVideo(p)} />}
                          <Typography sx={{ fontWeight: 600 }} noWrap>{p.title}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {p.scheduled_at
                              ? new Date(p.scheduled_at.replace(" ", "T")).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
                              : "Sem data"}
                          </Typography>
                          {/* Empurra a ação para o rodapé do card: assim os botões de
                              uma fileira ficam na mesma linha, mesmo quando um dos
                              cards tem o aviso de "pediu ajuste" ocupando espaço. */}
                          <Box sx={{ flexGrow: 1 }} />
                          <Stack direction="row" spacing={1}>
                            <Button size="small" variant="outlined" onClick={() => setSelected(p)}>Abrir</Button>
                          </Stack>
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                }}
              </PorMes>
            )
          ) : postFilter === "aguardando" ? (
            waiting.length === 0 ? (
              <EmptyState message="Nada esperando aprovação. O que você enviar para o cliente aparece aqui até ele responder." />
            ) : (
              <PorMes itens={waiting} grade={GRADE_IGUAL}>
                {(w) => {
                  const ct = CONTENT_TYPES[w.content_type];
                  const pediuAjuste = w.approval_status === "changes_requested";
                  return (
                    <Card key={w.id} sx={CARD_IGUAL}>
                      <CardContent sx={{ flexGrow: 1, display: "flex" }}>
                        <Stack spacing={1} sx={{ flex: 1, width: "100%" }}>
                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: "wrap", gap: 0.5 }}>
                            {ct && <Chip size="small" color="primary" label={`${ct.emoji} ${ct.label}`} />}
                            <Chip size="small" color={pediuAjuste ? "warning" : "info"}
                              label={pediuAjuste ? "Pediu ajuste ✏️" : "Com o cliente ⏳"} />
                          </Stack>
                          {w.client_name && <Typography variant="caption" color="text.secondary">{w.client_name}</Typography>}
                          {w.content_type === "carrossel"
                            ? <CarrosselLargo fileId={w.cover_file_id || w.file_id} streamUrl={enderecoDaPeca(w)} mesmaAltura />
                            : <Media fileId={w.file_id || w.cover_file_id} capaId={w.cover_file_id} natural mesmaAltura
                                streamUrl={enderecoDaPeca(w)} ehVideoDica={pecaEhVideo(w)} />}
                          <Typography sx={{ fontWeight: 600 }} noWrap>{w.title}</Typography>
                          <Typography variant="caption" color={w.scheduled_at ? "text.secondary" : "error.main"}>
                            {w.scheduled_at
                              ? new Date(w.scheduled_at.replace(" ", "T")).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
                              : "Sem data"}
                          </Typography>
                          {pediuAjuste && w.client_note && (
                            <Alert severity="warning" sx={{ py: 0.25 }}>
                              <Typography variant="caption">{w.client_note}</Typography>
                            </Alert>
                          )}
                          {/* Empurra a ação para o rodapé do card: assim os botões de
                              uma fileira ficam na mesma linha, mesmo quando um dos
                              cards tem o aviso de "pediu ajuste" ocupando espaço. */}
                          <Box sx={{ flexGrow: 1 }} />
                          <Button size="small" variant="outlined" onClick={() => setSelected(w)}>Abrir</Button>
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                }}
              </PorMes>
            )
          ) : postFilter === "aprovados" ? (
            approved.length === 0 ? (
              <EmptyState message="Nada aprovado aguardando programação. Quando o cliente aprova, o conteúdo aparece aqui para programar." />
            ) : (
              <PorMes itens={approved} grade={GRADE_IGUAL}>
                {(a) => {
                  const ct = CONTENT_TYPES[a.content_type];
                  return (
                    <Card key={a.id} sx={CARD_IGUAL}>
                      <CardContent sx={{ flexGrow: 1, display: "flex" }}>
                        <Stack spacing={1} sx={{ flex: 1, width: "100%" }}>
                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: "wrap", gap: 0.5 }}>
                            {ct && <Chip size="small" color="primary" label={`${ct.emoji} ${ct.label}`} />}
                            <Chip size="small" color="success" label="Aprovado ✓" />
                          </Stack>
                          {a.client_name && <Typography variant="caption" color="text.secondary">{a.client_name}</Typography>}
                          {a.content_type === "carrossel"
                            ? <CarrosselLargo fileId={a.cover_file_id || a.file_id} streamUrl={enderecoDaPeca(a)} mesmaAltura />
                            : <Media fileId={a.file_id || a.cover_file_id} capaId={a.cover_file_id} natural mesmaAltura
                                streamUrl={enderecoDaPeca(a)} ehVideoDica={pecaEhVideo(a)} />}
                          <Typography sx={{ fontWeight: 600 }} noWrap>{a.title}</Typography>
                          <Typography variant="caption" color={a.scheduled_at ? "text.secondary" : "error.main"}>
                            {a.scheduled_at
                              ? new Date(a.scheduled_at.replace(" ", "T")).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
                              : "Sem data — edite antes de programar"}
                          </Typography>
                          {/* Empurra a ação para o rodapé do card: assim os botões de
                              uma fileira ficam na mesma linha, mesmo quando um dos
                              cards tem o aviso de "pediu ajuste" ocupando espaço. */}
                          <Box sx={{ flexGrow: 1 }} />
                          <Stack direction="row" spacing={1}>
                            <Button size="small" variant="outlined" onClick={() => setSelected(a)}>Editar</Button>
                            <Button size="small" variant="contained" startIcon={<ScheduleSendIcon />}
                              disabled={!a.scheduled_at} onClick={() => programar(a)}>
                              Programar
                            </Button>
                          </Stack>
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                }}
              </PorMes>
            )
          ) : items.length === 0 ? (
            <EmptyState message="Nenhuma peça para preparar. Mova as tarefas prontas para a coluna 'Distribuição' no quadro de Tarefas." />
          ) : (
          <>
            <BarraDeSelecao />
            <PorMes itens={items}>
              {(it) => (
                <Box key={it.id} sx={{ position: "relative" }}>
                  {selectMode && (
                    <Checkbox
                      checked={checked.has(it.id)}
                      onChange={() => toggleCheck(it.id)}
                      sx={{ position: "absolute", top: 4, right: 4, zIndex: 2, bgcolor: "background.paper", borderRadius: 1, "&:hover": { bgcolor: "background.paper" } }}
                    />
                  )}
                  <Box onClick={selectMode ? () => toggleCheck(it.id) : undefined}
                    sx={selectMode ? {
                      cursor: "pointer",
                      outline: checked.has(it.id) ? "2px solid" : "2px solid transparent",
                      outlineColor: "primary.main", borderRadius: 3,
                      "& *": { pointerEvents: "none" },
                    } : undefined}>
                    <PieceCard item={it} flash={flash} onChanged={load} />
                  </Box>
                </Box>
              )}
            </PorMes>
          </>
          )}
        </>
      ) : view === "list" ? (
        <>
          <StatusLegend />
          {/* Na Lista, "Marcar todas" pega as do panorama, não só as de preparar. */}
          <BarraDeSelecao todas={scheduled} />
          <ListView items={scheduled} onSelect={setSelected}
            selectMode={selectMode} checked={checked} onToggle={toggleCheck} />
        </>
      ) : view === "feed" ? (
        clientFilter ? (
          <Card><CardContent>
            <ReorderableFeed posts={feedPosts} onSelect={setSelected} onReorder={reorderPosition}
                  onVoltarPorData={voltarPorData}
              titulo="Como o perfil vai ficar" />
          </CardContent></Card>
        ) : feedGroups.length === 0 ? (
          <Card><CardContent><Typography color="text.secondary">Nenhuma peça ainda.</Typography></CardContent></Card>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Cada empresa tem o seu perfil. Escolha uma empresa acima para focar em uma só.
            </Typography>
            {feedGroups.map((g) => (
              <Card key={g.clientId}><CardContent>
                <ReorderableFeed posts={g.posts} onSelect={setSelected} onReorder={reorderPosition}
                  onVoltarPorData={voltarPorData}
                  titulo={`Perfil — ${g.clientName}`} />
              </CardContent></Card>
            ))}
          </Stack>
        )
      ) : (
        <MonthGrid items={scheduled} onSelect={setSelected} />
      )}

      {/* Editor aberto a partir da lista / perfil / calendário */}
      <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} fullWidth maxWidth="sm">
        <DialogTitle>Editar peça</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          {selectedFresh && (
            <PieceCard key={selectedFresh.id} item={selectedFresh} flash={flash}
              onChanged={() => { load(); setSelected(null); }} />
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setSelected(null)}>Fechar</Button></DialogActions>
      </Dialog>
    </>
  );
}
