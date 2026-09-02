import { createHmac, randomUUID } from "node:crypto";

// Avisa o Perspecta Central quando algo importante acontece aqui (login,
// cadastro de escritório...). Contrato: POST {PERSPECTA_CENTRAL_URL}/api/
// webhooks/creator, corpo assinado em HMAC-SHA256 com PERSPECTA_WEBHOOK_SECRET
// (o mesmo segredo já gerado pra "creator" em central.sistemas.webhook_secret).
//
// Nunca trava nem quebra a resposta pro usuário: dispara e esquece (o Central
// pode estar fora do ar sem afetar o login/cadastro aqui).
export function emitirEventoPerspecta(tipo, dados) {
  const url = process.env.PERSPECTA_CENTRAL_URL;
  const segredo = process.env.PERSPECTA_WEBHOOK_SECRET;
  if (!url || !segredo) return; // integração desligada até as env vars existirem

  const corpo = JSON.stringify({ tipo, empresa_ref: dados?.empresa_ref ?? null, dados });
  const assinatura = createHmac("sha256", segredo).update(corpo).digest("hex");

  fetch(`${url.replace(/\/+$/, "")}/api/webhooks/creator`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Perspecta-Signature": assinatura,
      "X-Idempotency-Key": randomUUID(),
    },
    body: corpo,
  }).catch(() => { /* Central fora do ar — não é motivo pra falhar o login/cadastro daqui */ });
}
