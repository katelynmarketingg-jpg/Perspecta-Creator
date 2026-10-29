import api from "../api/client.js";

// ---------------------------------------------------------------------------
// "POR QUE O ARQUIVO GRANDE NÃO SOBE?" — a resposta em um clique.
//
// O envio tem dois caminhos: direto para a nuvem (Cloudflare R2) ou passando
// pelo nosso servidor. Quando o grande falha, quase sempre é uma destas
// coisas, e nenhuma delas aparece na tela:
//
//   · a nuvem não está ligada nesta casa → tudo vai pelo disco do servidor,
//     que é pequeno e corta vídeo grande;
//   · a nuvem está ligada mas não autoriza o navegador a entregar (CORS) →
//     o envio direto falha e o sistema tenta o caminho longo, que morre;
//   · a assinatura da entrega não sai.
//
// Este teste faz o percurso inteiro com um arquivo de mentira e conta onde
// parou, com o tempo e a velocidade. No fim, apaga o que criou: a galeria não
// pode ficar com lixo de teste.
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;

/** Um arquivo de mentira do tamanho pedido, sem travar o navegador. */
function arquivoDeTeste(mb) {
  const pedaco = new Uint8Array(MB);
  for (let i = 0; i < MB; i += 4096) pedaco[i] = i % 251;   // não é zero puro: não dá para "comprimir" no caminho
  const partes = [];
  for (let i = 0; i < mb; i++) partes.push(pedaco);
  return new File(partes, `teste-de-envio-${Date.now()}.bin`, { type: "application/octet-stream" });
}

function entregarNaNuvem(url, file, aoProgresso) {
  return new Promise((ok, falha) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && aoProgresso?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
      ? ok(true)
      : falha(new Error(`a nuvem recusou a entrega (código ${xhr.status})`)));
    // status 0 no PUT é, quase sempre, CORS: o navegador nem deixou a resposta chegar.
    xhr.onerror = () => falha(new Error(
      "o navegador não conseguiu entregar na nuvem — em geral é o CORS do bucket, "
      + "que precisa permitir PUT a partir do endereço do sistema"));
    xhr.timeout = 10 * 60 * 1000;
    xhr.ontimeout = () => falha(new Error("a entrega na nuvem demorou demais"));
    xhr.send(file);
  });
}

function mandarPeloServidor(file, aoProgresso) {
  return new Promise((ok, falha) => {
    const form = new FormData();
    form.append("files", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files/upload");
    const token = localStorage.getItem("token");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    try {
      const viewing = JSON.parse(localStorage.getItem("viewing_org") || "null");
      if (viewing?.id) xhr.setRequestHeader("X-Org-Id", String(viewing.id));
    } catch { /* sem escritório selecionado */ }
    xhr.upload.onprogress = (e) => e.lengthComputable && aoProgresso?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { ok(JSON.parse(xhr.responseText)); } catch { ok(null); }
      } else {
        let msg = "";
        try { msg = JSON.parse(xhr.responseText)?.error || ""; } catch { /* não é JSON */ }
        falha(new Error(msg || `o servidor recusou (código ${xhr.status})`));
      }
    };
    xhr.onerror = () => falha(new Error("a conexão com o servidor caiu no meio do envio"));
    xhr.timeout = 10 * 60 * 1000;
    xhr.ontimeout = () => falha(new Error("o servidor demorou demais"));
    xhr.send(form);
  });
}

/** Apaga o que o teste criou. Falhar aqui não estraga o diagnóstico. */
async function limpar(criados) {
  for (const id of criados) {
    try { await api.delete(`/files/${id}`); } catch { /* some sozinho depois */ }
  }
}

/**
 * Faz o percurso inteiro e conta onde parou.
 * Devolve { caminho, mb, segundos, mbps, erro, motivo, livre }.
 */
export async function testarEnvio(mb = 12, aoProgresso) {
  const file = arquivoDeTeste(mb);
  const comecou = Date.now();
  const criados = [];
  const fim = (extra) => {
    const segundos = (Date.now() - comecou) / 1000;
    return { mb, segundos: +segundos.toFixed(1), mbps: +(mb / Math.max(0.1, segundos)).toFixed(1), ...extra };
  };

  // 1) a nuvem autoriza?
  let autorizacao = null;
  let motivo = null;
  let livre = null;
  try {
    const { data } = await api.post("/files/upload-direto/autorizar", {
      arquivos: [{ nome: file.name, mime: file.type, tamanho: file.size }],
    });
    livre = data?.livre ?? null;
    if (data?.direto && data.autorizacoes?.[0]) autorizacao = data.autorizacoes[0];
    else motivo = data?.motivo || "a nuvem não autorizou a entrega";
  } catch (e) {
    const d = e?.response?.data;
    return fim({ caminho: "nenhum", erro: d?.error || "não consegui pedir autorização para enviar", livre: d?.livre ?? null });
  }

  // 2) pela nuvem, quando dá
  if (autorizacao) {
    try {
      await entregarNaNuvem(autorizacao.url, file, aoProgresso);
      const { data } = await api.post("/files/upload-direto/registrar", {
        arquivos: [{ key: autorizacao.key, nome: file.name, mime: file.type }],
      });
      (data?.created || data || []).forEach?.((f) => f?.id && criados.push(f.id));
      await limpar(criados);
      return fim({ caminho: "nuvem" });
    } catch (e) {
      // Não cai para o servidor: aqui o objetivo é DESCOBRIR, não enviar.
      return fim({ caminho: "nuvem", erro: e.message, motivo });
    }
  }

  // 3) sem nuvem: o caminho antigo, pelo servidor
  try {
    const data = await mandarPeloServidor(file, aoProgresso);
    (Array.isArray(data) ? data : data?.created || []).forEach((f) => f?.id && criados.push(f.id));
    await limpar(criados);
    return fim({ caminho: "servidor", motivo, livre });
  } catch (e) {
    return fim({ caminho: "servidor", erro: e.message, motivo, livre });
  }
}
