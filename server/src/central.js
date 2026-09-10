import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { db } from "./db.js";
import "dotenv/config";

// ---------------------------------------------------------------------------
// A CENTRAL — o quadro de informações de cada cliente. Guarda anotações, links
// e CREDENCIAIS: nestas, a senha fica criptografada em repouso (AES-256-GCM).
//
// Isto vive fora da rota porque o briefing também grava aqui: quando o cliente
// responde a senha do Instagram, ela vai direto para a Central em vez de ficar
// solta, em texto puro, nas respostas do formulário.
// ---------------------------------------------------------------------------
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

/**
 * Guarda (ou atualiza) um item na Central do cliente. Repetir o mesmo título
 * atualiza em vez de duplicar — aplicar o briefing duas vezes não enche o
 * quadro de cópias.
 */
export function guardaNaCentral(orgId, clientId, { kind, title, valor }) {
  const existente = db.prepare(
    "SELECT id FROM workspace_items WHERE org_id = ? AND client_id = ? AND title = ? LIMIT 1"
  ).get(orgId, clientId, title);

  const segredo = kind === "credential" ? encrypt(valor) : null;
  const conteudo = kind === "credential" ? null : valor;

  if (existente) {
    db.prepare("UPDATE workspace_items SET kind = ?, secret = ?, content = ? WHERE id = ?")
      .run(kind, segredo, conteudo, existente.id);
    return { id: existente.id, novo: false };
  }
  const info = db.prepare(
    "INSERT INTO workspace_items (client_id, kind, title, content, secret, org_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(clientId, kind, title, conteudo, segredo, orgId);
  return { id: info.lastInsertRowid, novo: true };
}
