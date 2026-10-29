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

/**
 * Como o envio está configurado — SEM a senha. É o que a tela de
 * Configurações mostra para ela conseguir achar o erro sozinha: quase todo
 * problema de envio é o remetente (MAIL_FROM) num domínio que o provedor não
 * reconhece como seu.
 */
export function configuracaoDoEmail() {
  return {
    ligado: emailConfigured(),
    host: SMTP_HOST || null,
    porta: SMTP_PORT ? Number(SMTP_PORT) : null,
    usuario: SMTP_USER ? `${String(SMTP_USER).slice(0, 3)}…` : null,
    remetente: MAIL_FROM || null,
    faltando: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"]
      .filter((k) => !process.env[k]),
  };
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

/**
 * O MOTIVO, em português, do jeito que o provedor contou.
 *
 * O erro do nodemailer vem com código e resposta do servidor SMTP. Sem isso na
 * tela, "não foi possível enviar" é tudo o que se sabe — e o problema real
 * (remetente de domínio não verificado, senha trocada) fica invisível.
 */
export function motivoDoErro(e) {
  const resposta = String(e?.response || "").trim();
  const base = resposta || e?.message || "erro desconhecido";
  if (/5\.7\.|not verified|domain/i.test(base)) {
    return `${base} — em geral é o remetente (MAIL_FROM): o provedor só envia de um domínio verificado por você.`;
  }
  if (/auth/i.test(base) || e?.code === "EAUTH") {
    return `${base} — usuário ou senha do SMTP recusados.`;
  }
  if (e?.code === "ECONNECTION" || /connect|timeout/i.test(base)) {
    return `${base} — não consegui falar com o servidor de e-mail (host/porta).`;
  }
  return base;
}

/** Mascara um e-mail para mostrar na tela: joao@dominio.com -> jo***@dominio.com */
export function mascararEmail(email) {
  const s = String(email || "");
  const [user, dom] = s.split("@");
  if (!dom) return s;
  const visivel = user.slice(0, Math.min(2, user.length));
  return `${visivel}${"*".repeat(Math.max(1, user.length - visivel.length))}@${dom}`;
}
