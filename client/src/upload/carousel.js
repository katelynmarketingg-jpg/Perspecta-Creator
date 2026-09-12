// Fatiar uma arte larga em várias slides de carrossel — tudo no navegador
// (canvas), sem processar imagem no servidor. A dona sobe UMA arte comprida
// (ex.: 3240px) e o sistema corta em N pedaços iguais, cada um vira uma slide
// na ordem (a 1ª é a capa que aparece no perfil).

// Largura de referência de uma slide do Instagram. Acima disso, vale fatiar.
export const LARGURA_SLIDE = 1080;

// Carrega o arquivo num <img> para medir/desenhar. Resolve com o elemento já
// pronto (e a URL do objeto, para revogar depois).
function carregarImagem(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("imagem inválida")); };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// EM QUANTAS SLIDES ESTA ARTE FOI FEITA?
//
// A conta antiga era largura ÷ 1080, e só acertava quando a arte tinha sido
// exportada com exatamente 1080px por slide. Uma tira de 6 slides exportada em
// alta resolução (17820px de largura, 2970 por slide) virava "17 slides" — e
// cortar em 17 partiria as slides ao meio. Quem exporta do Canva em 2x ou 3x
// caía nisso sempre.
//
// O jeito certo não olha a resolução, olha o FORMATO: uma slide é um post, e
// post tem proporção conhecida. Sabendo a altura da tira, dá para saber a
// largura de UMA slide sem depender de quantos pixels a exportação usou.
const FORMATOS = [
  { nome: "4:5 (retrato)", r: 4 / 5 },
  { nome: "1:1 (quadrado)", r: 1 },
  { nome: "3:4", r: 3 / 4 },
  { nome: "9:16 (story)", r: 9 / 16 },
  { nome: "2:3", r: 2 / 3 },
];

/**
 * Quantas slides a tira tem, deduzido do formato. Devolve também o quanto a
 * conta "fechou" — perto de 1 é encaixe redondo; longe disso a arte não é uma
 * tira de slides iguais e é melhor não fingir que sabemos.
 */
export function sugerirSlides(largura, altura) {
  if (!largura || !altura) return { n: 2, confianca: 0, formato: null };
  let melhor = { n: 2, confianca: 0, formato: null };
  for (const f of FORMATOS) {
    const larguraSlide = altura * f.r;
    const exato = largura / larguraSlide;
    const n = Math.round(exato);
    if (n < 2 || n > 20) continue;
    // 1 quando o encaixe é perfeito; cai conforme sobra ou falta pedaço.
    const confianca = 1 - Math.abs(exato - n) / n;
    if (confianca > melhor.confianca) melhor = { n, confianca, formato: f.nome };
  }
  // Nenhum formato conhecido encaixou: cai no palpite antigo, sem prometer nada.
  if (!melhor.formato) {
    return { n: Math.max(2, Math.min(20, Math.round(largura / LARGURA_SLIDE))), confianca: 0, formato: null };
  }
  return melhor;
}

// Mede a arte: { largura, altura, fatiavel, sugestao, formato, confianca }.
export async function medirImagem(file) {
  if (!file || !(file.type || "").startsWith("image/")) return null;
  const { img, url } = await carregarImagem(file);
  const largura = img.naturalWidth || img.width;
  const altura = img.naturalHeight || img.height;
  URL.revokeObjectURL(url);
  // Só vale fatiar se a arte é bem mais larga que alta — uma tira, não um post.
  const fatiavel = largura > altura * 1.2;
  const { n, confianca, formato } = sugerirSlides(largura, altura);
  return { largura, altura, fatiavel, sugestao: n, confianca, formato };
}

// Corta a arte em `n` slides de largura igual, na ordem (esquerda → direita).
//
// CADA SLIDE SAI EM 1080px DE LARGURA — o tamanho que o Instagram usa.
//
// Antes cortava na resolução do arquivo. Uma tira exportada em alta resolução
// (17820px, 2970 por slide) virava 6 imagens de 2970x3713 — quase 200 MB para
// subir, e o corte levava MINUTOS. E não adiantava nada: o Instagram mostra a
// 1080 de qualquer jeito, então esses pixels a mais só pesavam no envio, no
// armazenamento e depois no carregamento de toda tela que mostra a peça.
//
// A altura acompanha a proporção, então 4:5 vira 1080x1350, quadrado vira
// 1080x1080. Arte que já é menor que 1080 não é esticada.
export const LARGURA_ALVO = 1080;

export async function fatiarEmSlides(file, n, { larguraAlvo = LARGURA_ALVO } = {}) {
  const total = Math.max(2, Math.min(20, Math.floor(n) || 2));
  const { img, url } = await carregarImagem(file);
  const largura = img.naturalWidth || img.width;
  const altura = img.naturalHeight || img.height;
  const larguraFatia = Math.floor(largura / total);

  // Reduzir só quando há o que reduzir.
  const escala = Math.min(1, larguraAlvo / larguraFatia);
  const destAltura = Math.round(altura * escala);

  // Arte chapada com texto fica melhor em PNG; foto fica igual em JPEG e pesa
  // uma fração. Carrossel de agência é quase sempre foto com texto por cima —
  // JPEG em qualidade alta é o que o próprio Instagram faria.
  const ehPng = (file.type || "").includes("png");
  const mime = ehPng && larguraFatia <= larguraAlvo ? "image/png" : "image/jpeg";
  const ext = mime === "image/png" ? "png" : "jpg";
  const baseNome = (file.name || "carrossel").replace(/\.[^.]+$/, "");

  const slides = [];
  try {
    for (let i = 0; i < total; i++) {
      const x = i * larguraFatia;
      // A última fatia leva o resto dos pixels (evita perder uma coluna por
      // arredondamento).
      const w = i === total - 1 ? largura - x : larguraFatia;
      const destLargura = Math.round(w * escala);
      const canvas = document.createElement("canvas");
      canvas.width = destLargura;
      canvas.height = destAltura;
      const ctx = canvas.getContext("2d");
      // Redução suave: sem isto, texto fino do Canva sai serrilhado.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, x, 0, w, altura, 0, 0, destLargura, destAltura);
      // eslint-disable-next-line no-await-in-loop
      const blob = await new Promise((res) => canvas.toBlob(res, mime, 0.92));
      if (blob) slides.push(new File([blob], `${baseNome}-${i + 1}.${ext}`, { type: mime }));
    }
  } finally {
    URL.revokeObjectURL(url);
  }
  return slides;
}
