// ---------------------------------------------------------------------------
// ENVIO EM PEDAÇOS (MULTIPART) — vídeo grande, principalmente no celular.
//
// "no iPhone nem começa o carregamento." O celular não aguenta mandar um vídeo
// de 500 MB de uma vez: teria de segurar o arquivo inteiro na memória e o
// navegador morre sem avisar (nem barra aparecia). Aqui o arquivo é cortado em
// fatias de ~10 MB (file.slice, que NÃO copia o arquivo todo para a memória) e
// cada fatia vai DIRETO para a nuvem. A memória nunca enche — sobe de qualquer
// tamanho, até pelo ícone na tela inicial do iPhone.
//
//   1. INICIAR: o servidor abre o envio e devolve um endereço assinado por parte.
//   2. CADA PARTE: entrega a fatia e guarda o ETag (a prova de que ela chegou).
//   3. COMPLETAR: com a lista de (parte + ETag), a nuvem junta tudo num arquivo.
//
// Devolve `null` quando este caminho não serve (sem nuvem) — e quem chamou
// volta pelo caminho de sempre, que continua inteiro.
// ---------------------------------------------------------------------------
import api from "../api/client.js";

const TIPO_PADRAO = "application/octet-stream";

/** Entrega UMA fatia e devolve o ETag que a nuvem confirma. */
function entregarParte(url, blob, aoBytes) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // Sem Content-Type de propósito: a parte foi assinada sem ele, e mandar um
    // cabeçalho a mais faria a nuvem recusar por assinatura divergente.
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && aoBytes) aoBytes(e.loaded); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // O ETag precisa do ExposeHeaders no CORS do balde (já configurado).
        const etag = xhr.getResponseHeader("ETag") || xhr.getResponseHeader("etag");
        if (!etag) return reject(new Error("a nuvem não devolveu o ETag da parte"));
        resolve(etag);
      } else reject(new Error(`parte recusada (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("parte interrompida"));
    xhr.timeout = 60 * 60 * 1000;   // 1h por fatia — folga de sobra
    xhr.ontimeout = () => reject(new Error("parte demorou demais"));
    xhr.send(blob);
  });
}

/**
 * Sobe UM arquivo em pedaços. Devolve o que o servidor registrou (igual ao
 * envio direto), ou `null` quando este caminho não serve.
 */
export async function enviarMultipart(file, { clientId, folderId, stage, thumb } = {}, aoProgresso) {
  const tipo = file?.type || TIPO_PADRAO;
  let inicio;
  try {
    const { data } = await api.post("/files/upload-direto/multipart/iniciar", {
      nome: file.name, mime: tipo, tamanho: file.size,
    });
    if (!data?.direto || !data.uploadId || !Array.isArray(data.urls) || !data.urls.length) return null;
    inicio = data;
  } catch (e) {
    if (e?.response?.status === 413) throw new Error(e.response.data?.error || "Arquivo grande demais.");
    return null;   // sem nuvem / não deu: volta pelo caminho de sempre
  }

  const { key, uploadId, parteTamanho, urls } = inicio;
  const total = file.size || 1;
  const enviadoPorParte = new Array(urls.length).fill(0);
  const partes = new Array(urls.length);   // por índice: o paralelo não chega em ordem

  // MANDA ATÉ 3 FATIAS AO MESMO TEMPO. Uma de cada vez deixava a internet
  // ociosa entre as partes (cada requisição tem seu "esquenta"); com 3 em
  // paralelo o envio de vídeo grande fica bem mais rápido. 3 × 10 MB = 30 MB de
  // memória no pico — tranquilo até no celular.
  const CONCORRENCIA = 3;
  let proxima = 0;
  const trabalhador = async () => {
    for (let i = proxima++; i < urls.length; i = proxima++) {
      const comeco = i * parteTamanho;
      const fim = Math.min(file.size, comeco + parteTamanho);
      const fatia = file.slice(comeco, fim);   // não copia o arquivo todo
      // eslint-disable-next-line no-await-in-loop
      const etag = await entregarParte(urls[i].url, fatia, (bytes) => {
        enviadoPorParte[i] = bytes;
        const somado = enviadoPorParte.reduce((a, b) => a + b, 0);
        aoProgresso?.(Math.min(99, Math.round((somado / total) * 100)));
      });
      enviadoPorParte[i] = fim - comeco;
      partes[i] = { PartNumber: urls[i].partNumber, ETag: etag };
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(CONCORRENCIA, urls.length) }, trabalhador),
    );
  } catch (e) {
    // Limpa as fatias soltas na nuvem; não trava quem chamou se a limpeza falhar.
    api.post("/files/upload-direto/multipart/abortar", { key, uploadId }).catch(() => {});
    throw e;
  }

  const { data } = await api.post("/files/upload-direto/multipart/completar", {
    key, uploadId, partes,
    nome: file.name, mime: tipo, thumb: thumb || null,
    client_id: clientId || null, folder_id: folderId || null, stage: stage || undefined,
  });
  aoProgresso?.(100);
  return data;
}
