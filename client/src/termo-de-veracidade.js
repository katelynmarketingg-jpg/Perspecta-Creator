// ---------------------------------------------------------------------------
// TERMO DE VERACIDADE / RELATÓRIO DE ASSINATURAS
//
// A página que vai ANEXADA ao fim do contrato assinado, como a ZapSign faz: é o
// "comprovante" que dá fé à assinatura eletrônica. Reúne, num lugar só, tudo o
// que prova quem assinou e que o documento não mudou depois:
//
//   · o HASH (SHA-256) do documento — a impressão digital do que foi assinado;
//   · um cartão por signatário com nome, documento, e-mail verificado, data e
//     hora com fuso, IP, dispositivo (navegador) e o método de verificação;
//   · a base legal (MP 2.200-2/2001 e Lei 14.063/2020).
//
// Só aparece quando há ao menos uma assinatura — um contrato em branco para
// assinar à caneta não leva termo nenhum.
// ---------------------------------------------------------------------------

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (ch) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

/** Data/hora no horário de Brasília, com o fuso à vista. */
function dataBrasilia(quando) {
  if (!quando) return "—";
  try {
    const d = new Date(String(quando).replace(" ", "T") + "Z");
    const txt = d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" });
    return `${txt} (horário de Brasília, UTC−03:00)`;
  } catch { return esc(quando); }
}

/** Lê o navegador e o sistema de um user-agent, em linguagem de gente. */
export function dispositivoLegivel(ua) {
  const s = String(ua || "");
  if (!s) return "—";
  const nav = /Edg\//.test(s) ? "Edge"
    : /OPR\/|Opera/.test(s) ? "Opera"
    : /Chrome\//.test(s) ? "Chrome"
    : /Firefox\//.test(s) ? "Firefox"
    : /Safari\//.test(s) ? "Safari" : "navegador";
  const so = /Windows/.test(s) ? "Windows"
    : /iPhone|iPad|iOS/.test(s) ? "iPhone/iPad"
    : /Android/.test(s) ? "Android"
    : /Mac OS X|Macintosh/.test(s) ? "Mac"
    : /Linux/.test(s) ? "Linux" : "";
  return so ? `${nav} em ${so}` : nav;
}

/** Um item "rótulo: valor" da trilha. */
const linha = (rotulo, valor) => valor
  ? `<div class="tv-linha"><span class="tv-rot">${esc(rotulo)}</span><span class="tv-val">${valor}</span></div>`
  : "";

/** O cartão de um signatário. `tipo` muda só o selo e o que a trilha mostra. */
function cartao({ titulo, nome, documento, img, quando, email, ip, ua, metodo, selfie, docFoto }) {
  const miniatura = img
    ? `<img class="tv-assinatura" src="${esc(img)}" alt="assinatura" />`
    : "";
  // Selfie e foto do documento, quando foram pedidas e coletadas.
  const provas = [
    selfie ? `<figure class="tv-prova"><img src="${esc(selfie)}" alt="selfie" /><figcaption>Selfie</figcaption></figure>` : "",
    docFoto ? `<figure class="tv-prova"><img src="${esc(docFoto)}" alt="documento" /><figcaption>Documento</figcaption></figure>` : "",
  ].join("");
  return `<div class="tv-card">
    <div class="tv-card-top">
      <span class="tv-papel">${esc(titulo)}</span>
      <span class="tv-selo">✓ Assinado</span>
    </div>
    <div class="tv-nome">${esc(nome || "—")}</div>
    ${documento ? `<div class="tv-doc">${esc(documento)}</div>` : ""}
    ${miniatura}
    ${linha("Data e hora", dataBrasilia(quando))}
    ${linha("E-mail verificado", email ? esc(email) : "")}
    ${linha("IP", ip ? esc(ip) : "")}
    ${linha("Dispositivo", ua ? esc(dispositivoLegivel(ua)) : "")}
    ${linha("Nível de segurança", metodo ? esc(metodo) : "")}
    ${provas ? `<div class="tv-provas">${provas}</div>` : ""}
  </div>`;
}

/** O termo inteiro, pronto para ir ao fim do contrato. "" se nada foi assinado. */
export function termoDeVeracidade(c = {}) {
  const temCliente = Boolean(c.signed_at);
  const temCasa = Boolean(c.agency_signed_at);
  if (!temCliente && !temCasa) return "";

  const quantos = (temCliente ? 1 : 0) + (temCasa ? 1 : 0);
  const cards = [
    temCliente && cartao({
      titulo: "CONTRATANTE (cliente)",
      nome: c.signer_name, documento: c.signer_document, img: c.signature_img,
      quando: c.signed_at,
      email: c.sign_verify_dest,
      ip: c.signer_ip, ua: c.signer_user_agent,
      metodo: c.sign_verify_method === "email"
        ? "Validado por código único enviado por e-mail" : "",
      selfie: c.signer_selfie, docFoto: c.signer_doc_photo,
    }),
    temCasa && cartao({
      titulo: "CONTRATADA (agência)",
      nome: c.agency_signer_name, documento: c.agency_signer_document,
      img: c.agency_signature_img, quando: c.agency_signed_at,
      metodo: "Assinatura da agência",
    }),
  ].filter(Boolean).join("");

  const alterado = c.integridade === "alterado";

  return `<section class="termo">
    <h2 class="tv-titulo">Termo de Veracidade — Relatório de Assinaturas</h2>
    <div class="tv-doc-bloco">
      ${linha("Documento", esc(c.title))}
      ${linha("Número", `#${esc(c.id)}`)}
      ${linha("Status", alterado
        ? '<span class="tv-alerta">Texto alterado após a assinatura</span>'
        : "Assinado eletronicamente")}
      ${linha("Assinaturas", `${quantos} de ${quantos}`)}
      ${linha("Hash do documento (SHA-256)", c.signed_hash ? `<span class="tv-hash">${esc(c.signed_hash)}</span>` : "—")}
    </div>
    <div class="tv-cards">${cards}</div>
    <p class="tv-legal">
      As assinaturas eletrônicas deste documento têm validade jurídica entre as partes, nos termos do
      art. 10, §2º, da MP 2.200-2/2001 e da Lei 14.063/2020. A identidade de cada signatário foi
      confirmada por código enviado ao seu contato, e a integridade do documento pode ser conferida
      pelo hash (SHA-256) acima: qualquer alteração no texto muda o hash.
    </p>
  </section>`;
}

/** O CSS do termo — o mesmo na tela e no papel. */
export const CSS_TERMO = `
.termo { page-break-before: always; break-before: page; font-size: 10pt; }
.tv-titulo { font-size: 13pt; text-align: center; margin: 0 0 12px; }
.tv-doc-bloco { border: 1px solid #ccc; border-radius: 6px; padding: 10px 12px; margin: 0 0 14px; }
.tv-linha { display: flex; gap: 8px; margin: 2px 0; align-items: baseline; }
.tv-rot { color: #666; min-width: 170px; flex: 0 0 170px; font-size: 9pt; text-transform: uppercase; letter-spacing: .03em; }
.tv-val { flex: 1; }
.tv-hash, .tv-doc { font-family: "Courier New", monospace; word-break: break-all; font-size: 9pt; }
.tv-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media print { .tv-cards { grid-template-columns: 1fr 1fr; } }
.tv-card { border: 1px solid #ccc; border-radius: 6px; padding: 10px 12px; break-inside: avoid; page-break-inside: avoid; }
.tv-card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.tv-papel { font-size: 8.5pt; color: #666; text-transform: uppercase; letter-spacing: .04em; }
.tv-selo { font-size: 8.5pt; color: #1b7a3d; border: 1px solid #1b7a3d; border-radius: 10px; padding: 1px 8px; }
.tv-nome { font-weight: 700; font-size: 11pt; }
.tv-assinatura { max-height: 54px; display: block; margin: 6px 0; }
.tv-provas { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
.tv-prova { margin: 0; text-align: center; }
.tv-prova img { height: 68px; width: auto; border: 1px solid #ccc; border-radius: 4px; display: block; }
.tv-prova figcaption { font-size: 8pt; color: #666; margin-top: 2px; }
.tv-alerta { color: #b3261e; font-weight: 700; }
.tv-legal { margin-top: 14px; font-size: 8.5pt; color: #444; text-align: justify; line-height: 1.5; }
`;
