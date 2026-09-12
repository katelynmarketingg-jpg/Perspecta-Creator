// ---------------------------------------------------------------------------
// O ENDEREÇO QUE VAI PARA O <img> / <video>.
//
// Havia um só: /api/files/shared/<bilhete>. O navegador pedia esse endereço ao
// NOSSO servidor, que conferia o bilhete, ia ao banco, assinava um endereço da
// Cloudflare e devolvia um redirecionamento — e só então o navegador buscava o
// arquivo. Numa tela com 20 fotos, são 20 idas ao nosso servidor antes de a
// primeira foto começar a chegar. Com o servidor ocupado (ou acordando), isso
// é a diferença entre "abriu" e "está carregando há minutos".
//
// Quando o arquivo está no R2, o endereço assinado da Cloudflare pode ir DIRETO
// na listagem: o navegador não toca no nosso servidor para ver mídia nenhuma.
// Arquivo em disco continua pelo bilhete, porque só nós sabemos servi-lo.
//
// A assinatura é ancorada no início da hora de propósito (ver storage.js): sem
// isso o endereço mudaria a cada pedido, e endereço novo é arquivo novo para o
// navegador — o cache dele seria jogado fora a cada abrir de tela.
// ---------------------------------------------------------------------------
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./auth.js";
import { isR2Path, r2Key, enderecoAssinado, tipoQueONavegadorToca } from "./storage.js";

const HORAS = 6;

/** O endereço pelo nosso servidor — o caminho de sempre. */
export function bilheteDeMidia(fileId, orgId) {
  if (!fileId) return null;
  const ticket = jwt.sign({ file_id: fileId, org_id: orgId, inline: true }, JWT_SECRET, { expiresIn: "12h" });
  return `/api/files/shared/${ticket}`;
}

/**
 * O melhor endereço para UM arquivo já carregado do banco: direto na Cloudflare
 * quando dá, pelo nosso servidor quando não dá.
 */
export async function enderecoDeMidia(file, orgId) {
  if (!file?.id) return null;
  if (isR2Path(file.stored_path)) {
    const direto = await enderecoAssinado(r2Key(file.stored_path), {
      segundos: HORAS * 3600,
      tipo: tipoQueONavegadorToca(file),
      estavel: true,
    });
    if (direto) return direto;
  }
  return bilheteDeMidia(file.id, orgId);
}

/**
 * O mesmo para uma lista de ids — uma consulta só ao banco, e as assinaturas
 * feitas aqui dentro (é conta local, não toca na rede).
 * Devolve um mapa id -> endereço.
 */
export async function enderecosDeMidia(db, ids, orgId) {
  const limpos = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!limpos.length) return new Map();
  const linhas = db
    .prepare(`SELECT id, mime, original_name, stored_path FROM files
               WHERE org_id = ? AND id IN (${limpos.map(() => "?").join(",")})`)
    .all(orgId, ...limpos);
  const mapa = new Map();
  await Promise.all(linhas.map(async (f) => { mapa.set(f.id, await enderecoDeMidia(f, orgId)); }));
  // Arquivo que não é desta agência (ou sumiu) simplesmente não ganha endereço.
  return mapa;
}
