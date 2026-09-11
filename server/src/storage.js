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
export async function enderecoAssinado(key, { segundos = 3600, tipo, baixarComoNome } = {}) {
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
    return await getSignedUrl(client, comando, { expiresIn: segundos });
  } catch {
    return null;   // não deu para assinar: quem chamou serve pelo caminho antigo
  }
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
