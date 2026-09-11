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

// Mede a arte: { largura, altura, fatiavel, sugestao } — sugestao é quantas
// slides de ~1080 cabem na largura (mínimo 2 quando dá para fatiar).
export async function medirImagem(file) {
  if (!file || !(file.type || "").startsWith("image/")) return null;
  const { img, url } = await carregarImagem(file);
  const largura = img.naturalWidth || img.width;
  const altura = img.naturalHeight || img.height;
  URL.revokeObjectURL(url);
  const fatiavel = largura > LARGURA_SLIDE * 1.5; // só sugere se dá pelo menos ~2 slides
  const sugestao = Math.max(2, Math.round(largura / LARGURA_SLIDE));
  return { largura, altura, fatiavel, sugestao };
}

// Corta a arte em `n` slides de largura igual, na ordem (esquerda → direita).
// Devolve uma lista de File prontos para subir. Mantém PNG quando a origem é
// PNG (texto/arte chapada), senão exporta JPEG de alta qualidade (foto).
export async function fatiarEmSlides(file, n) {
  const total = Math.max(2, Math.min(20, Math.floor(n) || 2));
  const { img, url } = await carregarImagem(file);
  const largura = img.naturalWidth || img.width;
  const altura = img.naturalHeight || img.height;
  const larguraFatia = Math.floor(largura / total);
  const ehPng = (file.type || "").includes("png");
  const mime = ehPng ? "image/png" : "image/jpeg";
  const ext = ehPng ? "png" : "jpg";
  const baseNome = (file.name || "carrossel").replace(/\.[^.]+$/, "");

  const slides = [];
  try {
    for (let i = 0; i < total; i++) {
      const x = i * larguraFatia;
      // A última fatia leva o resto dos pixels (evita perder uma coluna por
      // arredondamento).
      const w = i === total - 1 ? largura - x : larguraFatia;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = altura;
      canvas.getContext("2d").drawImage(img, x, 0, w, altura, 0, 0, w, altura);
      // eslint-disable-next-line no-await-in-loop
      const blob = await new Promise((res) => canvas.toBlob(res, mime, 0.95));
      if (blob) slides.push(new File([blob], `${baseNome}-${i + 1}.${ext}`, { type: mime }));
    }
  } finally {
    URL.revokeObjectURL(url);
  }
  return slides;
}
