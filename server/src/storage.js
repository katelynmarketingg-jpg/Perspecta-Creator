import { S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
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
export async function getR2Object(key) {
  return client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

export async function deleteR2Object(key) {
  await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}
