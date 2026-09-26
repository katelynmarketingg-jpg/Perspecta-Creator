// ---------------------------------------------------------------------------
// Miniatura feita NO NAVEGADOR, na hora de enviar.
//
// Por quê: a grade da Galeria carregava o arquivo ORIGINAL de cada item (1,5 MB
// por post, 100 MB por vídeo) só para mostrar o quadradinho — lento, e vídeo
// grande nem desenhava. Gerar aqui evita isso sem precisar de biblioteca de
// imagem no servidor (o Render não tem ffmpeg nem sharp).
//
// A miniatura é só para a grade. Abrir, baixar e publicar continuam usando o
// arquivo original, intacto.
// ---------------------------------------------------------------------------

import { ehHeic, heicParaJpeg } from "./heic.js";
import { sugerirSlides } from "./carousel.js";

// A miniatura é o RASCUNHO que aparece na hora, enquanto a arte de verdade
// carrega por cima (é a arte original que a grade desenha, em resolução cheia).
// Por isso ela fica pequena de propósito: uma galeria com 200 arquivos devolve
// 200 miniaturas na mesma resposta — guardar 1080x1440 em cada uma faria a
// página levar uma eternidade para abrir.
// Medido no Chromium com uma arte de post de verdade (1080x1350, fundo chapado
// com texto grande): a 720/q0.8 a miniatura sai com 36 KB — 120 arquivos numa
// galeria viram 4,2 MB de resposta, tudo de uma vez. A 480/q0.78 sai com 20 KB
// e, no quadradinho da grade (uns 200 px de tela), fica indistinguível.
const LADO_MAX = 480;      // rascunho nítido o bastante em tela retina
const QUALIDADE = 0.78;    // JPEG: ~20 KB numa arte cheia de texto

// Desenha respeitando a proporção real — nada de esticar nem cortar.
export function desenhar(fonte, larguraNatural, alturaNatural) {
  if (!larguraNatural || !alturaNatural) return null;
  const escala = Math.min(1, LADO_MAX / Math.max(larguraNatural, alturaNatural));
  const cv = document.createElement("canvas");
  cv.width = Math.round(larguraNatural * escala);
  cv.height = Math.round(alturaNatural * escala);
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(fonte, 0, 0, cv.width, cv.height);
  try { return cv.toDataURL("image/jpeg", QUALIDADE); } catch { return null; }
}

/**
 * Caminho RÁPIDO: createImageBitmap decodifica FORA da linha principal e o
 * OffscreenCanvas comprime sem passar pela tela. Medido com 10 fotos de
 * celular (23 MB): a tela trava 52 ms em vez de 106 ms, e o total cai de
 * 361 ms para 281 ms — escolher várias fotos deixa de "pendurar" a página.
 * Navegador antigo sem essas peças cai no caminho de sempre, que funciona.
 */
async function porBitmap(file) {
  if (typeof createImageBitmap !== "function") return null;
  let bmp = null;
  try {
    // UMA decodificação só, e a redução acontece ao desenhar. Medir primeiro e
    // decodificar de novo com resizeWidth parece mais esperto, mas custa duas
    // decodificações — medido, sai mais lento do que o caminho antigo.
    bmp = await createImageBitmap(file);
    const { width: lw, height: lh } = bmp;
    if (!lw || !lh) return null;
    const escala = Math.min(1, LADO_MAX / Math.max(lw, lh));
    const w = Math.max(1, Math.round(lw * escala));
    const h = Math.max(1, Math.round(lh * escala));

    if (typeof OffscreenCanvas === "function") {
      const cv = new OffscreenCanvas(w, h);
      cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
      const blob = await cv.convertToBlob({ type: "image/jpeg", quality: QUALIDADE });
      return await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => resolve(null);
        fr.readAsDataURL(blob);
      });
    }
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
    return cv.toDataURL("image/jpeg", QUALIDADE);
  } catch {
    return null;
  } finally {
    bmp?.close?.();
  }
}

function porElemento(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(desenhar(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

async function daImagem(file) {
  return (await porBitmap(file)) ?? (await porElemento(file));
}

// Vídeo: pega um quadro do começo (não o 0, que costuma ser preto).
function doVideo(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    let pronto = false;
    const acabou = (r) => { if (pronto) return; pronto = true; resolve(r); URL.revokeObjectURL(url); };

    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 4); } catch { acabou(null); } };
    v.onseeked = () => acabou(desenhar(v, v.videoWidth, v.videoHeight));
    v.onerror = () => acabou(null);
    // Formato que este navegador não decodifica (alguns .mov): sai sem miniatura,
    // e a grade cai no ícone — melhor do que travar o envio.
    setTimeout(() => acabou(null), 8000);
    v.src = url;
  });
}

/**
 * Miniatura a partir de um elemento QUE JÁ ESTÁ NA TELA (<img> ou <video> da
 * grade). É assim que os arquivos antigos ganham miniatura: a mídia já foi
 * carregada para aparecer, então não custa nenhum download a mais.
 * Mesma origem do site, então o canvas não fica "contaminado".
 */
export function thumbFromElement(el) {
  try {
    if (!el) return null;
    const w = el.naturalWidth || el.videoWidth;
    const h = el.naturalHeight || el.videoHeight;
    return desenhar(el, w, h);
  } catch { return null; }
}

/** Miniatura em data URI, ou null quando não dá para gerar. Nunca lança erro. */
export async function makeThumbnail(file) {
  try {
    // Foto de iPhone: o navegador não desenha .HEIC, então converte antes.
    // Sem isso a miniatura saía nula e a grade mostrava o quadrado quebrado.
    if (ehHeic(file?.name, file?.type)) {
      const jpeg = await heicParaJpeg(file, 0.9);
      return jpeg ? await daImagem(jpeg) : null;
    }
    if (file?.type?.startsWith("image/")) return await daImagem(file);
    if (file?.type?.startsWith("video/")) return await doVideo(file);
  } catch { /* sem miniatura é aceitável */ }
  return null;
}

// ---------------------------------------------------------------------------
// A PRÉVIA: a arte no tamanho em que ela APARECE, não no tamanho em que foi
// exportada.
//
// A miniatura acima é o rascunho do quadradinho (480 px, ~20 KB). A arte
// original é o que vale para publicar (1080x1350, e pode passar de 6 MB). Faltava
// o meio do caminho: a grade do perfil e o card grande desenham a arte com uns
// 350 a 900 px na tela e estavam baixando o arquivo INTEIRO para isso — medido,
// 12,6 MB para nove peças, e 38 MB quando as artes são pesadas.
//
// A prévia tem a largura de um post do Instagram (1080 px) e sai em JPEG: a
// mesma resolução que a Meta publica, com uma fração do peso. É ela que a tela
// usa; o arquivo original continua intacto para baixar e publicar.
// ---------------------------------------------------------------------------
const PREVIA_LADO = 1080;
const PREVIA_QUALIDADE = 0.82;

// ---------------------------------------------------------------------------
// A TIRA DE CARROSSEL PRECISA DE MAIS RESOLUÇÃO QUE UM POST.
//
// 1080px no lado maior é a medida certa para UM post. Numa tira de 7 slides,
// esses mesmos 1080px são a largura da TIRA INTEIRA: cada slide fica com 154px
// e, ao ser ampliada para preencher o quadro da Galeria, sai borrada.
//
// Então o alvo passa a ser por SLIDE, não pela arte. 640px por slide cobre com
// folga o quadro da grade (190px em tela retina são 380px), e o teto impede
// que uma tira de dez slides vire um arquivo gigante para uma miniatura.
// ---------------------------------------------------------------------------
const ALVO_POR_SLIDE = 640;
const PREVIA_TETO = 4320;

/** O lado maior que a prévia desta arte deve ter. */
export function ladoDaPrevia(w, h) {
  const n = (w && h && w / h > 1.05) ? (sugerirSlides(w, h).n || 1) : 1;
  if (n <= 1) return PREVIA_LADO;
  return Math.min(n * ALVO_POR_SLIDE, PREVIA_TETO);
}

function reduzir(fonte, w, h, lado, qualidade) {
  if (!w || !h) return null;
  // Arte menor que o alvo não é ampliada — só seria peso a mais, sem ganho.
  const escala = Math.min(1, lado / Math.max(w, h));
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w * escala));
  cv.height = Math.max(1, Math.round(h * escala));
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(fonte, 0, 0, cv.width, cv.height);
  try { return cv.toDataURL("image/jpeg", qualidade); } catch { return null; }
}

/**
 * Prévia a partir de um elemento QUE JÁ ESTÁ NA TELA (<img>/<video>). É assim
 * que a arte antiga ganha prévia: ela já foi baixada para aparecer, então gerar
 * daqui não custa nenhum download a mais — e a PRÓXIMA vez já sai leve.
 *
 * Só funciona quando a mídia veio do mesmo domínio ou com CORS liberado; se o
 * canvas estiver "contaminado", toDataURL lança e devolvemos null, sem quebrar
 * nada (a tela continua usando a arte inteira, como hoje).
 */
export function previaDeElemento(el) {
  try {
    if (!el) return null;
    const w = el.naturalWidth || el.videoWidth;
    const h = el.naturalHeight || el.videoHeight;
    // Arte que já é pequena não precisa de prévia: seria um arquivo a mais para
    // guardar e servir, do mesmo tamanho.
    const lado = ladoDaPrevia(w, h);
    if (!w || !h || Math.max(w, h) <= lado * 1.1) return null;
    return reduzir(el, w, h, lado, PREVIA_QUALIDADE);
  } catch { return null; }
}

/** Prévia a partir do arquivo escolhido, na hora de enviar. */
export async function fazerPrevia(file) {
  try {
    let fonte = file;
    if (ehHeic(file?.name, file?.type)) {
      fonte = await heicParaJpeg(file, 0.9);
      if (!fonte) return null;
    } else if (!file?.type?.startsWith("image/")) {
      return null;  // vídeo não tem prévia: o player já toca por trechos
    }
    const bmp = await createImageBitmap(fonte);
    try {
      const lado = ladoDaPrevia(bmp.width, bmp.height);
      if (Math.max(bmp.width, bmp.height) <= lado * 1.1) return null;
      return reduzir(bmp, bmp.width, bmp.height, lado, PREVIA_QUALIDADE);
    } finally { bmp.close?.(); }
  } catch { return null; }
}
