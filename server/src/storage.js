import { S3Client, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream } from "node:fs";

// ---------------------------------------------------------------------------
// Armazenamento dos arquivos. Usa Cloudflare R2 (S3-compatível) SE as variáveis
// estiverem configuradas; senão, mantém tudo no disco (comportamento atual).
// Assim dá para ligar o R2 só definindo as variáveis no Render, sem quebrar nada.
//
// Variáveis: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
// No banco, files.stored_path guarda "r2:<key>" quando está no R2.
// ---------------------------------------------------------------------------
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;

const configured = Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
const PREFIX = "r2:";

const client = configured
  ? new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    })
  : null;

export function storageConfigured() { return configured; }
export function isR2Path(p) { return typeof p === "string" && p.startsWith(PREFIX); }
export function r2Key(p) { return isR2Path(p) ? p.slice(PREFIX.length) : p; }

// Sobe um arquivo do disco local para o R2. Retorna o stored_path ("r2:<key>").
export async function uploadFileToR2(localPath, key, contentType) {
  const up = new Upload({
    client,
    params: {
      Bucket: R2_BUCKET, Key: key,
      Body: createReadStream(localPath),
      ContentType: contentType || "application/octet-stream",
    },
  });
  await up.done();
  return PREFIX + key;
}

// Retorna o objeto do R2 (Body é um stream; tem ContentType e ContentLength).
// Passe `range` (ex.: "bytes=0-") para pedir só um trecho — usado no streaming
// de vídeo, que deixa o player mostrar o primeiro quadro e "arrastar" a barra
// sem baixar o arquivo inteiro.
export async function getR2Object(key, range) {
  return client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key, ...(range ? { Range: range } : {}) }));
}

// ---------------------------------------------------------------------------
// ENDEREÇO DIRETO NO R2, assinado e temporário.
//
// Até aqui cada byte fazia o caminho R2 -> servidor -> navegador: o vídeo saía
// da Cloudflare, atravessava a máquina do Render (que é pequena e fica num
// lugar só) e só então chegava na pessoa. Pagar pelo R2 e continuar servindo
// pelo servidor é o pior dos dois mundos.
//
// Com o endereço assinado, o navegador busca DIRETO na Cloudflare, que tem
// servidor perto de quem assiste e entende Range nativamente — o vídeo começa
// a tocar quase na hora, e o servidor para de carregar arquivo no lombo.
//
// O endereço expira (1 hora por padrão) e ninguém consegue adivinhar: quem não
// passou pela checagem de permissão do sistema não chega nele.
// ---------------------------------------------------------------------------
/**
 * A MESMA assinatura durante uma janela de tempo.
 *
 * Assinar com a hora exata gera um endereço diferente a cada pedido — e
 * endereço diferente é arquivo diferente para o navegador, que joga o cache
 * fora e baixa tudo de novo a cada abrir de tela. Ancorando a assinatura no
 * início da hora, todo mundo recebe o MESMO endereço durante aquela hora e o
 * cache do navegador funciona como deveria.
 */
function horaAncorada() {
  const agora = Date.now();
  return new Date(agora - (agora % 3_600_000));
}

export async function enderecoAssinado(key, { segundos = 3600, tipo, baixarComoNome, estavel = false } = {}) {
  if (!configured) return null;
  const comando = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    // O .mov de iPhone é H.264 por dentro, mas o Chrome se recusa a tocar
    // "video/quicktime". Aqui o rótulo é trocado na resposta do próprio R2 —
    // o arquivo continua intacto.
    ...(tipo ? { ResponseContentType: tipo } : {}),
    ...(baixarComoNome
      ? { ResponseContentDisposition: `attachment; filename="${encodeURIComponent(baixarComoNome)}"` }
      : {}),
  });
  try {
    return await getSignedUrl(client, comando, {
      expiresIn: segundos,
      ...(estavel ? { signingDate: horaAncorada() } : {}),
    });
  } catch {
    return null;   // não deu para assinar: quem chamou serve pelo caminho antigo
  }
}

/**
 * O R2 está mesmo RESPONDENDO? Não basta "as variáveis existem".
 *
 * Assinar um endereço é conta matemática feita aqui dentro, sem tocar na rede:
 * com a chave errada, expirada ou apagada, a assinatura sai perfeita e o
 * navegador é mandado para um endereço que a Cloudflare recusa. O sistema
 * acha que serviu; a pessoa vê a tela vazia. É assim que TODAS as fotos somem
 * de uma vez, sem nenhum erro aparecer em lugar nenhum.
 *
 * Por isso este teste vai até o fim: pede 1 byte de um arquivo de verdade.
 */
export async function testarR2(key) {
  if (!configured) {
    const faltando = Object.entries({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET })
      .filter(([, v]) => !v).map(([k]) => k);
    return { ok: false, etapa: "configuracao", faltando,
      mensagem: `O R2 está DESLIGADO neste servidor: faltam ${faltando.join(", ")}. `
        + "Todo arquivo guardado no R2 fica invisível enquanto isso — os arquivos não foram perdidos." };
  }
  if (!key) return { ok: true, etapa: "sem_arquivo", mensagem: "R2 ligado. Nenhum arquivo no R2 para testar." };

  try {
    await client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key, Range: "bytes=0-0" }));
  } catch (e) {
    const nome = e?.name || e?.Code || "erro";
    const dicas = {
      NoSuchBucket: `O balde "${R2_BUCKET}" não existe nesta conta. Confira R2_BUCKET.`,
      NoSuchKey: "O R2 respondeu, mas este arquivo não está lá dentro.",
      AccessDenied: "A chave do R2 não tem permissão de leitura neste balde. Gere uma chave nova com acesso de leitura.",
      InvalidAccessKeyId: "A chave do R2 não vale mais (apagada ou trocada). Gere outra e atualize R2_ACCESS_KEY_ID.",
      SignatureDoesNotMatch: "O segredo do R2 está errado. Confira R2_SECRET_ACCESS_KEY.",
    };
    return { ok: false, etapa: "leitura", erro: nome,
      mensagem: dicas[nome] || `O R2 recusou a leitura (${nome}). Os arquivos continuam lá; é o acesso que está quebrado.` };
  }

  // Ler daqui funciona. Falta o que o NAVEGADOR faz: seguir o endereço assinado.
  const url = await enderecoAssinado(key, { segundos: 120 });
  if (!url) return { ok: false, etapa: "assinatura", mensagem: "Não foi possível assinar o endereço do arquivo." };
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-0" } });
    if (!r.ok && r.status !== 206) {
      return { ok: false, etapa: "endereco_assinado", status: r.status,
        mensagem: `O servidor lê o arquivo, mas o endereço que vai para o navegador é recusado pela Cloudflare (${r.status}). `
          + "É por isso que as fotos aparecem vazias mesmo com tudo 'ligado'." };
    }
  } catch (e) {
    return { ok: false, etapa: "endereco_assinado",
      mensagem: `Não deu para alcançar a Cloudflare a partir daqui: ${e?.message || e}.` };
  }
  return { ok: true, etapa: "completo", mensagem: "R2 respondendo: leitura e endereço assinado funcionando." };
}

export async function deleteR2Object(key) {
  await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

// Lista objetos sob um prefixo: [{ key, lastModified, size }] (mais recente 1º).
export async function listR2Objects(prefix) {
  const out = await client.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix }));
  return (out.Contents || [])
    .map((o) => ({ key: o.Key, lastModified: o.LastModified, size: o.Size }))
    .sort((a, b) => (b.lastModified?.getTime() || 0) - (a.lastModified?.getTime() || 0));
}

// ---------------------------------------------------------------------------
// O tipo que o navegador realmente TOCA. Os arquivos são gravados sem extensão,
// então quem serve precisa dizer o tipo — senão sai "application/octet-stream"
// e o navegador se recusa a desenhar a imagem (ou tocar o vídeo). O .mov é
// remarcado como mp4: o conteúdo costuma ser H.264, que o navegador toca.
// ---------------------------------------------------------------------------
export function tipoQueONavegadorToca(file) {
  const mime = (file.mime || "").toLowerCase();
  const nome = file.original_name || "";
  const ehMov = /quicktime/i.test(mime) || /\.mov$/i.test(nome);
  if (ehMov) return "video/mp4";
  // Mime confiável? usa ele. Senão (vazio ou octet-stream), deduz pela extensão
  // — sem isso, vídeo/foto que subiu sem mime é servido como octet-stream e o
  // navegador se recusa a tocar/desenhar (o vídeo "não aparece" na aprovação).
  const indef = !mime || mime.includes("octet-stream");
  if (!indef) return mime;
  const ext = (nome.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
  const POREXT = {
    mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mkv: "video/x-matroska",
    avi: "video/x-msvideo", "3gp": "video/3gpp", mpg: "video/mpeg", mpeg: "video/mpeg", ogv: "video/ogg",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
    bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", avif: "image/avif", heic: "image/heic", heif: "image/heif",
  };
  return POREXT[ext] || mime || "application/octet-stream";
}
