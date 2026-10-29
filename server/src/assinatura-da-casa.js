import { db } from "./db.js";

// ---------------------------------------------------------------------------
// A ASSINATURA DA CASA, NUM LUGAR SÓ.
//
// "assino uma vez e o sistema reusa": a assinatura da agência mora em
// organizations (a mesma dos recibos) e é COPIADA para o contrato, com a data.
// Copia, não aponta: se ela trocar a assinatura daqui a um ano, o que foi
// firmado hoje continua sendo o que foi firmado hoje.
//
// Vivia dentro da rota de contratos. Saiu para cá quando o onboarding passou a
// poder já deixar o contrato assinado por ela no momento em que ele nasce —
// duas portas para o mesmo ato, uma regra só.
// ---------------------------------------------------------------------------

/** O que a casa precisa ter para assinar. `null` quando falta a assinatura. */
export function assinaturaDaCasa(orgId) {
  const org = db.prepare(
    "SELECT name, signature_img, signer_name, signer_document FROM organizations WHERE id = ?"
  ).get(orgId);
  if (!org?.signature_img) return null;
  return {
    img: org.signature_img,
    nome: org.signer_name || org.name || null,
    documento: org.signer_document || null,
  };
}

/**
 * Carimba a assinatura da casa no contrato. Devolve:
 *   "ok" | "sem-assinatura" (ela ainda não desenhou) | "ja-assinado" | "sem-contrato".
 */
export function assinaComoCasa(orgId, contratoId) {
  const c = db.prepare("SELECT id, agency_signed_at FROM contracts WHERE id = ? AND org_id = ?")
    .get(contratoId, orgId);
  if (!c) return "sem-contrato";
  if (c.agency_signed_at) return "ja-assinado";
  const a = assinaturaDaCasa(orgId);
  if (!a) return "sem-assinatura";
  db.prepare(
    `UPDATE contracts SET agency_signed_at = datetime('now'), agency_signer_name = ?,
       agency_signer_document = ?, agency_signature_img = ?
     WHERE id = ? AND org_id = ?`
  ).run(a.nome, a.documento, a.img, c.id, orgId);
  return "ok";
}
