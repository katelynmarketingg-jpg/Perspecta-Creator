// ---------------------------------------------------------------------------
// Guardar a PRÉVIA de um arquivo, uma vez só, sem atrapalhar a tela.
//
// Arte nova ganha prévia no envio, a partir do arquivo que está no computador.
// Arte ANTIGA (as que já estão na nuvem) é o caso difícil: o navegador desenha
// essas imagens vindas direto da Cloudflare, e ler de volta o que foi desenhado
// é PROIBIDO quando o arquivo veio de outro domínio — o canvas fica "sujo".
// Medido no Chromium: nem começar o endereço no nosso domínio resolve, porque
// ele termina num redirecionamento para a Cloudflare, e é o destino que conta.
//
// Então o caminho é: tentar pelo que já está na tela (funciona para arte nova e
// para quem não usa nuvem) e, quando o canvas estiver sujo, buscar o arquivo
// por um endereço que passa por DENTRO do nosso servidor (/files/:id/link) e
// desenhar a partir dele. Custa um download — uma vez por arquivo, para sempre.
//
// Uma de cada vez, e só para o que está aparecendo: é conserto de fundo, não
// pode competir com a tela que a pessoa está usando.
// ---------------------------------------------------------------------------
import api from "../api/client.js";
import { previaDeElemento } from "./thumbnail.js";

const enviadas = new Set();   // já resolvido nesta sessão (deu certo ou não dá)
const fila = [];
let rodando = false;

async function manda(fileId, previa) {
  await api.put(`/files/${fileId}/previa`, { previa });
}

/** Busca o arquivo pelo NOSSO servidor e desenha — é o caminho sem canvas sujo. */
function pelaNossaCasa(fileId) {
  return api.get(`/files/${fileId}/link`).then(({ data }) => new Promise((resolve) => {
    if (!data?.url) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(previaDeElemento(img));
    img.onerror = () => resolve(null);
    img.src = data.url;
  }));
}

async function trabalhar() {
  if (rodando) return;
  rodando = true;
  try {
    while (fila.length) {
      const fileId = fila.shift();
      try {
        const previa = await pelaNossaCasa(fileId);
        if (previa) await manda(fileId, previa);
      } catch { /* na próxima sessão tenta de novo */ }
      // Respira entre um e outro: a tela da pessoa vem primeiro.
      await new Promise((r) => setTimeout(r, 400));
    }
  } finally { rodando = false; }
}

/**
 * Gera a prévia a partir do elemento na tela e manda para o servidor. Se o
 * canvas estiver sujo (arte vinda da nuvem), entra na fila de conserto.
 */
export function guardarPrevia(fileId, elemento) {
  if (!fileId || enviadas.has(fileId)) return;
  enviadas.add(fileId);
  let previa = null;
  try { previa = previaDeElemento(elemento); } catch { previa = null; }
  if (previa) {
    manda(fileId, previa).catch(() => enviadas.delete(fileId));
    return;
  }
  // Sem prévia daqui: ou a arte já é pequena (e aí não há o que fazer, e está
  // tudo bem), ou o canvas está sujo. A fila resolve o segundo caso; para o
  // primeiro, o servidor simplesmente não recebe nada.
  const w = elemento?.naturalWidth || elemento?.videoWidth || 0;
  const h = elemento?.naturalHeight || elemento?.videoHeight || 0;
  const valeAPena = Math.max(w, h) > 1200 || (!w && !h);
  if (!valeAPena) return;
  if (fila.length < 40 && !fila.includes(fileId)) {
    fila.push(fileId);
    trabalhar();
  }
}
