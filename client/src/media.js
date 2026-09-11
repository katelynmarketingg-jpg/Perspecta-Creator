// ---------------------------------------------------------------------------
// Carregar a arte de um arquivo — um lugar só.
//
// Cada tela tinha o seu jeito de baixar e desenhar a mídia, e por isso a
// correção do .HEIC (foto de iPhone, que nenhum navegador desenha) chegou na
// Galeria e não chegou na Distribuição nem na área do cliente. Aqui o caminho
// é o mesmo para todo mundo:
//
//   1. baixa o arquivo (quem chama diz COMO, porque a equipe e o cliente têm
//      tokens diferentes);
//   2. se for HEIC, converte para JPEG no navegador;
//   3. devolve { url, tipo } pronto para <img> ou <video>.
//
// A URL vive enquanto a página estiver aberta: o cache é o dono e ninguém
// revoga — assim rolar a tela para cima e para baixo não baixa nada de novo.
// ---------------------------------------------------------------------------
import { ehHeic, heicParaJpeg } from "./upload/heic.js";

const cache = new Map();    // chave -> { url, tipo }
const emVoo = new Map();    // chave -> Promise

/**
 * @param {string} chave   identifica o arquivo E de onde ele veio (equipe x
 *                         cliente têm permissões diferentes; não podem
 *                         compartilhar cache).
 * @param {() => Promise<Blob>} buscarBlob  como baixar.
 * @param {{ nome?: string, mime?: string }} dica  ajuda a reconhecer o HEIC
 *                         quando o tipo vem vazio.
 */
export function carregarArte(chave, buscarBlob, dica = {}) {
  if (cache.has(chave)) return Promise.resolve(cache.get(chave));
  if (emVoo.has(chave)) return emVoo.get(chave);

  const p = (async () => {
    const blob = await buscarBlob();
    let pronto = blob;
    if (ehHeic(dica.nome, blob.type || dica.mime)) {
      const jpeg = await heicParaJpeg(blob);
      if (jpeg) pronto = jpeg;      // não deu: segue com o original e o <img> avisa
    }
    const v = { url: URL.createObjectURL(pronto), tipo: pronto.type || dica.mime || "" };
    cache.set(chave, v);
    return v;
  })();

  emVoo.set(chave, p);
  p.catch(() => {}).finally(() => emVoo.delete(chave));
  return p;
}

/** É vídeo? Aceita tanto o tipo do arquivo quanto o nome. */
export function ehVideo(tipo, nome = "") {
  return /^video\//.test(tipo || "") || /\.(mp4|mov|m4v|webm|avi)$/i.test(nome || "");
}
