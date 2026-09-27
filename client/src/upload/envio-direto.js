// ---------------------------------------------------------------------------
// ENVIO DIRETO PARA A NUVEM.
//
// Até aqui, todo arquivo fazia a viagem DUAS vezes: celular → nosso servidor
// (que fica em Oregon, na costa oeste dos EUA) → Cloudflare. E entre as duas, o
// servidor ainda gravava o arquivo inteiro no disco dele antes de repassar. Um
// vídeo editado de 1 GB subindo pelo 4G do Brasil atravessava o continente duas
// vezes — e a barra ficava parada em 100% durante a segunda.
//
// Aqui o arquivo vai DIRETO do navegador para a Cloudflare, que tem ponto de
// entrada em São Paulo: uma viagem curta no lugar de duas longas.
//
// O arquivo não é tocado. Nada é recomprimido, nada é convertido — são os
// mesmos bytes, por um caminho mais curto.
//
// Em três tempos:
//   1. pede autorização (o servidor escolhe a pasta e assina a entrega);
//   2. entrega o arquivo direto na nuvem, com barra de progresso;
//   3. avisa o servidor, que confere na nuvem e registra.
//
// Se qualquer coisa der errado — sem nuvem configurada, CORS não liberado,
// entrega recusada — devolve `null`, e quem chamou volta pelo caminho de
// sempre, que continua inteiro. Envio é o que ela menos pode perder.
// ---------------------------------------------------------------------------
import api from "../api/client.js";

const TIPO_PADRAO = "application/octet-stream";

/** Entrega o arquivo no endereço assinado, avisando o progresso. */
function entregar(url, file, tipo, aoProgresso) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // O tipo TEM de ser o mesmo que foi assinado: a assinatura cobre esse
    // cabeçalho. Mandar outro (ou nenhum) faz a Cloudflare recusar a entrega.
    xhr.setRequestHeader("Content-Type", tipo);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && aoProgresso) aoProgresso(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
      ? resolve(true)
      : reject(new Error(`entrega recusada (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("entrega interrompida"));
    // Vídeo grande em internet ruim: 2 horas de prazo. O caminho antigo dava
    // 30 minutos porque ali o servidor também estava esperando; aqui não há
    // ninguém segurando a linha do outro lado.
    xhr.timeout = 2 * 60 * 60 * 1000;
    xhr.ontimeout = () => reject(new Error("entrega demorou demais"));
    xhr.send(file);
  });
}

/**
 * Sobe UM arquivo direto para a nuvem.
 * Devolve o que o servidor registrou, ou `null` quando este caminho não serve.
 */
export async function enviarDireto(file, { clientId, folderId, stage, thumb } = {}, aoProgresso) {
  const tipo = file?.type || TIPO_PADRAO;
  let autorizacao;
  try {
    const { data } = await api.post("/files/upload-direto/autorizar", {
      arquivos: [{ nome: file.name, mime: tipo, tamanho: file.size }],
    });
    if (!data?.direto || !data.autorizacoes?.[0]) return null;   // sem nuvem: caminho de sempre
    autorizacao = data.autorizacoes[0];
  } catch (e) {
    // 413 é recusa de verdade (arquivo grande demais) — não adianta tentar o
    // outro caminho, que tem o mesmo teto. O resto vira "tenta do jeito antigo".
    if (e?.response?.status === 413) throw new Error(e.response.data?.error || "Arquivo grande demais.");
    return null;
  }

  await entregar(autorizacao.url, file, tipo, aoProgresso);

  const { data } = await api.post("/files/upload-direto/registrar", {
    client_id: clientId || null,
    folder_id: folderId || null,
    stage: stage || undefined,
    arquivos: [{ key: autorizacao.key, nome: file.name, mime: tipo, thumb: thumb || null }],
  });
  return data;
}
