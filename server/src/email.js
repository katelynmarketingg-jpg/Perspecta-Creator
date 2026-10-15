// ---------------------------------------------------------------------------
// Envio de e-mail (transacional) — usado hoje pelo código de verificação da
// assinatura do contrato. Configura-se por variáveis de ambiente no Render,
// servindo qualquer provedor SMTP (Resend, SendGrid, Gmail, etc.):
//
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS  — conexão
//   MAIL_FROM                                   — remetente (ex.: "Perspecta <no-reply@seu-dominio>")
//
// Sem essas variáveis, o envio fica desligado e quem chama recebe um erro
// claro (não quebra o resto do sistema).
// ---------------------------------------------------------------------------
import nodemailer from "nodemailer";

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;

export function emailConfigured() {
  return Boolean(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && MAIL_FROM);
}

let _transport = null;
function transport() {
  if (_transport) return _transport;
  const porta = Number(SMTP_PORT) || 587;
  _transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: porta,
    secure: porta === 465,   // 465 = TLS direto; 587 = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return _transport;
}

/** Envia um e-mail. Lança erro (code EMAIL_OFF) se não estiver configurado. */
export async function enviarEmail({ to, subject, text, html }) {
  if (!emailConfigured()) {
    const e = new Error("Envio de e-mail não configurado no servidor.");
    e.code = "EMAIL_OFF";
    throw e;
  }
  await transport().sendMail({ from: MAIL_FROM, to, subject, text, html });
}

/** Mascara um e-mail para mostrar na tela: joao@dominio.com -> jo***@dominio.com */
export function mascararEmail(email) {
  const s = String(email || "");
  const [user, dom] = s.split("@");
  if (!dom) return s;
  const visivel = user.slice(0, Math.min(2, user.length));
  return `${visivel}${"*".repeat(Math.max(1, user.length - visivel.length))}@${dom}`;
}
