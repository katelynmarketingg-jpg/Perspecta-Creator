// ONDE CADA ASSINATURA FICA NO CONTRATO.
//
// Pedido dela: "na aba de contratos quero que eu tenha como marcar onde vai
// ficar a minha assinatura e a dela."
//
// O modelo marca os dois lugares com {{assinatura_cliente}} e
// {{assinatura_perspecta}}. Eles NÃO são preenchidos quando o contrato nasce —
// ficam no texto, de propósito: a assinatura chega depois, e cada um assina na
// sua hora. Quem troca o marcador pela assinatura é a tela, na hora de mostrar
// ou de imprimir.
//
// Enquanto não há assinatura, o marcador vira a linha de sempre: um contrato
// impresso para assinar à caneta continua saindo certo.

export const MARCADOR_CLIENTE = "assinatura_cliente";
export const MARCADOR_CASA = "assinatura_perspecta";
const LINHA = "_______________________________________________";

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (ch) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

/** O bloco de uma assinatura: o desenho e quem assinou, ou a linha em branco. */
function bloco({ img, nome, documento, quando, ip }) {
  if (!img && !quando) return `<span class="linha-assinatura">${LINHA}</span>`;
  const data = quando
    ? new Date(String(quando).replace(" ", "T") + "Z").toLocaleString("pt-BR")
    : null;
  return [
    '<span class="assinatura-no-lugar">',
    img ? `<img src="${esc(img)}" alt="Assinatura" />` : `<span class="linha-assinatura">${LINHA}</span>`,
    data
      ? `<small>Assinado eletronicamente por <b>${esc(nome || "")}</b>`
        + `${documento ? ` (${esc(documento)})` : ""} em ${esc(data)}`
        + `${ip ? ` · IP ${esc(ip)}` : ""}.</small>`
      : "",
    "</span>",
  ].join("");
}

/**
 * Troca os marcadores pelo que já foi assinado. Recebe o corpo JÁ EM HTML
 * (escapado, se vier de texto puro) — os marcadores não têm &, < nem >, então
 * atravessam o escape intactos e ainda são encontráveis aqui.
 */
export function comAssinaturas(corpoHtml, c = {}) {
  const trocar = (texto, chave, dados) =>
    texto.replace(new RegExp(`\\{\\{\\s*${chave}\\s*\\}\\}`, "gi"), () => bloco(dados));

  let out = String(corpoHtml || "");
  out = trocar(out, MARCADOR_CLIENTE, {
    img: c.signature_img, nome: c.signer_name, documento: c.signer_document,
    quando: c.signed_at, ip: c.signer_ip,
  });
  out = trocar(out, MARCADOR_CASA, {
    img: c.agency_signature_img, nome: c.agency_signer_name,
    documento: c.agency_signer_document, quando: c.agency_signed_at,
  });
  return out;
}

/** O CSS dos dois blocos — o mesmo na tela e no papel. */
export const CSS_ASSINATURAS = `
.assinatura-no-lugar { display:block; }
.assinatura-no-lugar img { max-height:70px; display:block; margin:0 0 2px; }
.assinatura-no-lugar small { display:block; color:#666; font-size:11px; line-height:1.4; }
.linha-assinatura { letter-spacing:0; }
`;

/** O contrato ainda tem lugar marcado para assinar? (a aba Contratos avisa) */
export const temMarcadores = (texto) =>
  new RegExp(`\\{\\{\\s*(${MARCADOR_CLIENTE}|${MARCADOR_CASA})\\s*\\}\\}`, "i").test(String(texto || ""));
