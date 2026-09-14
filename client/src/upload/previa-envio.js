// ---------------------------------------------------------------------------
// Guardar a PRÉVIA de um arquivo, uma vez só, sem atrapalhar a tela.
//
// A prévia é gerada a partir do que JÁ está desenhado (ver previaDeElemento):
// é de graça em download. Mandar cada uma uma única vez por sessão evita que
// uma grade com 20 quadros dispare 20 envios iguais ao rolar a tela.
// ---------------------------------------------------------------------------
import api from "../api/client.js";
import { previaDeElemento } from "./thumbnail.js";

const enviadas = new Set();

/** Gera a prévia a partir do elemento na tela e manda para o servidor. */
export function guardarPrevia(fileId, elemento) {
  if (!fileId || enviadas.has(fileId)) return;
  enviadas.add(fileId);
  let previa = null;
  try { previa = previaDeElemento(elemento); } catch { previa = null; }
  // Arte que já é pequena (ou canvas bloqueado por outro domínio): não há
  // prévia a guardar, e está tudo bem — a tela usa a arte, como antes.
  if (!previa) return;
  api.put(`/files/${fileId}/previa`, { previa })
    .catch(() => { enviadas.delete(fileId); });   // deixa tentar de novo depois
}
