import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import "dotenv/config";

// Segredos guardados no banco (senhas de clientes, tokens da Meta/Asaas, chaves
// de IA) ficam cifrados em repouso. A chave vem de ENCRYPTION_KEY; se não houver,
// cai no JWT_SECRET (compatível com o que já foi cifrado). Defina ENCRYPTION_KEY
// = valor atual do JWT_SECRET ANTES de um dia rotacionar o JWT_SECRET, senão os
// dados cifrados existentes deixam de ser lidos.
function deriveKey(source) {
  return scryptSync(source || "dev-secret", "workspace-salt", 32);
}

const KEY = deriveKey(process.env.ENCRYPTION_KEY || process.env.JWT_SECRET);

// Cifra/decifra com uma CHAVE ESPECÍFICA (usado pelo script de rotação).
export function encryptWith(keySource, text) {
  if (!text) return null;
  const key = deriveKey(keySource);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), enc.toString("hex")].join(":");
}

export function decryptWith(keySource, payload) {
  if (!payload) return null;
  try {
    const key = deriveKey(keySource);
    const [iv, tag, data] = payload.split(":");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(data, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// Versões padrão (usam a chave atual do ambiente), usadas pelo app.
export function encrypt(text) {
  if (!text) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), enc.toString("hex")].join(":");
}

export function decrypt(payload) {
  if (!payload) return null;
  try {
    const [iv, tag, data] = payload.split(":");
    const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(data, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
