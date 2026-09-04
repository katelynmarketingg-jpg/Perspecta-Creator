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

const LADO_MAX = 640;      // suficiente para a grade em telas retina
const QUALIDADE = 0.72;    // JPEG: bom o bastante, ~40 KB

// Desenha respeitando a proporção real — nada de esticar nem cortar.
function desenhar(fonte, larguraNatural, alturaNatural) {
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

function daImagem(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(desenhar(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
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

/** Miniatura em data URI, ou null quando não dá para gerar. Nunca lança erro. */
export async function makeThumbnail(file) {
  try {
    if (file?.type?.startsWith("image/")) return await daImagem(file);
    if (file?.type?.startsWith("video/")) return await doVideo(file);
  } catch { /* sem miniatura é aceitável */ }
  return null;
}
