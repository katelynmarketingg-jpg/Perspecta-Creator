import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import "dotenv/config";

// Segredos guardados no banco (senhas de clientes, tokens da Meta) ficam
// cifrados em repouso com a mesma chave derivada do JWT_SECRET.
const KEY = scryptSync(process.env.JWT_SECRET || "dev-secret", "workspace-salt", 32);

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
