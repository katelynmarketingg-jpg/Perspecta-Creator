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

// A miniatura é o RASCUNHO que aparece na hora, enquanto a arte de verdade
// carrega por cima (é a arte original que a grade desenha, em resolução cheia).
// Por isso ela fica pequena de propósito: uma galeria com 200 arquivos devolve
// 200 miniaturas na mesma resposta — guardar 1080x1440 em cada uma faria a
// página levar uma eternidade para abrir.
const LADO_MAX = 720;      // rascunho nítido o bastante em tela retina
const QUALIDADE = 0.8;     // JPEG: ~110 KB numa arte cheia de texto

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
