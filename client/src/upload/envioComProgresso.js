// ---------------------------------------------------------------------------
// ENVIAR UM ARQUIVO POR VEZ, COM BARRA DE PROGRESSO.
//
// A área do cliente mandava TODOS os arquivos num pedido só e mostrava apenas
// uma bolinha girando. Na prática, o Marcelo escolhia cinco vídeos do celular e
// ficava olhando para um "Enviando…" sem saber se estava andando, quanto
// faltava, ou se tinha travado — e se um arquivo desse problema, os cinco
// falhavam juntos.
//
// Um pedido por arquivo resolve as três coisas: dá para mostrar o progresso de
// cada um, o que já subiu está salvo mesmo se o próximo falhar, e o erro aponta
// QUAL arquivo deu problema.
// ---------------------------------------------------------------------------

const MB = 1048576;
const tamanho = (bytes) => (bytes > MB ? `${(bytes / MB).toFixed(0)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Por que falhou, em português, e o que fazer a respeito. */
export function explicarFalha(status, file, textoDoServidor) {
  const mb = tamanho(file?.size || 0);
  if (status === 413) {
    return `“${file?.name}” (${mb}) é grande demais. Se for vídeo, exporte numa qualidade menor (1080p costuma resolver).`;
  }
  if (status === 401) return "Sua sessão expirou. Atualize a página e entre de novo.";
  if (status === 0) return `O envio de “${file?.name}” (${mb}) foi interrompido. Em internet instável, o Wi-Fi ajuda.`;
  let msg = "";
  try { msg = JSON.parse(textoDoServidor || "")?.error || ""; } catch { /* não é JSON */ }
  return msg || `Não consegui enviar “${file?.name}” (${mb}) — erro ${status}.`;
}

/**
 * Sobe UM arquivo e devolve a resposta do servidor.
 * `aoProgresso` recebe 0–100 conforme os bytes saem daqui.
 */
export function enviarArquivo(file, { url, token, campos = {}, aoProgresso, minutos = 30 }) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("files", file);
    Object.entries(campos).forEach(([k, v]) => { if (v != null && v !== "") form.append(k, String(v)); });

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && aoProgresso) aoProgresso(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* resposta sem corpo */ }
        resolve(data);
      } else {
        reject(new Error(explicarFalha(xhr.status, file, xhr.responseText)));
      }
    };
    xhr.onerror = () => reject(new Error(explicarFalha(0, file)));
    // Sem prazo, um envio travado gira para sempre e parece que o sistema
    // "não faz nada". 30 minutos cobrem vídeo grande em internet ruim.
    xhr.timeout = minutos * 60 * 1000;
    xhr.ontimeout = () => reject(new Error(
      `“${file.name}” (${tamanho(file.size)}) demorou demais e foi interrompido. Se for vídeo longo, exporte menor.`
    ));
    xhr.send(form);
  });
}

/**
 * Sobe uma lista, alguns de cada vez, avisando a cada mudança.
 *
 * Dois ao mesmo tempo, não mais: no celular do cliente, mandar cinco juntos faz
 * todos ficarem lentos e a barra parar de andar (o navegador segura o resto
 * numa fila invisível). Em dupla, os primeiros terminam rápido e ele VÊ andar.
 */
export async function enviarLista(arquivos, { aoMudar, aoTerminarUm, ...opcoes }) {
  const estado = arquivos.map((f) => ({ nome: f.name, tamanho: f.size, progresso: 0, status: "aguardando", erro: null }));
  const avisar = () => aoMudar?.([...estado]);
  avisar();

  const AO_MESMO_TEMPO = 2;
  let proximo = 0;
  const trabalhar = async () => {
    while (proximo < arquivos.length) {
      const i = proximo++;
      estado[i].status = "enviando"; avisar();
      try {
        const data = await enviarArquivo(arquivos[i], {
          ...opcoes,
          aoProgresso: (p) => { estado[i].progresso = p; avisar(); },
        });
        estado[i].status = "pronto"; estado[i].progresso = 100; avisar();
        aoTerminarUm?.(data, arquivos[i]);
      } catch (err) {
        estado[i].status = "erro"; estado[i].erro = err.message; avisar();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AO_MESMO_TEMPO, arquivos.length) }, trabalhar));
  return estado;
}
