// ---------------------------------------------------------------------------
// O desenho do recibo — um só lugar.
//
// A mesma função monta o documento na tela da equipe, na prévia do modelo e na
// área do cliente: as duas partes veem exatamente o mesmo papel. Para "baixar",
// abrimos numa janela limpa e chamamos a impressão do navegador (Salvar como
// PDF) — igual já fazemos nos contratos, sem biblioteca nenhuma.
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ALINHA = { left: "flex-start", center: "center", right: "flex-end" };

/** HTML completo do recibo (A4, pronto para imprimir). */
export function receiptHtml(r) {
  if (!r) return "";
  const st = r.style || {};
  const accent = st.accent || "#EA580C";
  const alturaLogo = Number(st.logo_height) || 56;

  const logo = r.logo
    ? `<img class="logo" src="${esc(r.logo)}" alt="" style="max-height:${alturaLogo}px" />`
    : "";

  const linha = (rotulo, valor) =>
    valor ? `<div class="linha"><span>${esc(rotulo)}</span><b>${esc(valor)}</b></div>` : "";

  const assinatura = st.show_signature === false ? "" : `
    <div class="assinatura">
      ${r.signature_img ? `<img src="${esc(r.signature_img)}" alt="Assinatura" />` : ""}
      <div class="risco"></div>
      <div class="quem">${esc(r.signer_name || r.emitter_name || "")}</div>
      ${r.signer_document_fmt ? `<div class="mini">${esc(r.signer_document_fmt)}</div>` : ""}
      ${r.signer_role ? `<div class="mini">${esc(r.signer_role)}</div>` : ""}
    </div>`;

  const cancelado = r.status === "canceled"
    ? `<div class="tarja">RECIBO CANCELADO${r.cancel_reason ? " — " + esc(r.cancel_reason) : ""}</div>`
    : "";

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />
<title>Recibo ${esc(r.number || "")}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; margin: 0;
         background: #fff; line-height: 1.6; }
  .folha { max-width: 176mm; margin: 0 auto; padding: 8mm 0; }
  .topo { display: flex; flex-direction: column; align-items: ${ALINHA[st.logo_align] || "flex-start"};
          gap: 10px; }
  .logo { max-width: 260px; object-fit: contain; }
  .titulo { width: 100%; display: flex; justify-content: space-between; align-items: flex-end;
            gap: 16px; flex-wrap: wrap; border-bottom: 3px solid ${accent}; padding-bottom: 10px; }
  .titulo h1 { font-size: 19px; letter-spacing: .14em; text-transform: uppercase; margin: 0;
               color: ${accent}; }
  .numero { font-size: 12px; color: #555; text-align: right; }
  .numero b { display: block; font-size: 15px; color: #1a1a1a; letter-spacing: .04em; }
  .valor { margin: 22px 0; padding: 14px 18px; border-left: 5px solid ${accent};
           background: #faf7f4; display: flex; justify-content: space-between;
           align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .valor .n { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .valor .e { font-size: 12.5px; color: #555; font-style: italic; text-transform: lowercase; }
  .corpo { font-size: 14.5px; white-space: pre-wrap; text-align: justify; margin: 18px 0 22px; }
  .partes { display: flex; gap: 26px; flex-wrap: wrap; font-size: 12.5px; color: #333;
            border-top: 1px solid #e6e6e6; padding-top: 14px; }
  .parte { flex: 1 1 220px; }
  .parte h2 { font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase;
              color: #888; margin: 0 0 6px; font-weight: 700; }
  .linha { display: flex; justify-content: space-between; gap: 10px; padding: 1px 0; }
  .linha span { color: #777; }
  .obs { font-size: 12.5px; color: #444; margin-top: 14px; white-space: pre-wrap; }
  .local { margin-top: 30px; font-size: 13.5px; }
  .assinatura { margin-top: 26px; text-align: center; }
  .assinatura img { max-height: 84px; max-width: 260px; object-fit: contain; display: block;
                    margin: 0 auto 2px; }
  .risco { width: 280px; margin: 0 auto 6px; border-top: 1px solid #333; }
  .quem { font-weight: 700; font-size: 13.5px; }
  .mini { font-size: 11.5px; color: #666; }
  .rodape { margin-top: 34px; border-top: 1px solid #e6e6e6; padding-top: 10px;
            font-size: 10.5px; color: #777; line-height: 1.5; }
  .rodape .hash { word-break: break-all; font-family: ui-monospace, Menlo, Consolas, monospace;
                  font-size: 9.5px; }
  .tarja { border: 2px solid #c62828; color: #c62828; font-weight: 700; text-align: center;
           padding: 8px; margin-bottom: 16px; letter-spacing: .1em; font-size: 12px; }
  @media print { .folha { padding: 0; } }
</style></head>
<body><div class="folha">
  ${cancelado}
  <div class="topo">
    ${logo}
    <div class="titulo">
      <h1>${esc(st.header || "Recibo de pagamento")}</h1>
      <div class="numero">Recibo nº <b>${esc(r.number || "—")}</b>${r.receipt_date_fmt ? "Data: " + esc(r.receipt_date_fmt) : ""}</div>
    </div>
  </div>

  <div class="valor">
    <span class="n">${esc(r.amount_fmt || "")}</span>
    <span class="e">(${esc(r.amount_words || "")})</span>
  </div>

  <div class="corpo">${esc(r.body_rendered || "")}</div>

  <div class="partes">
    <div class="parte">
      <h2>Recebemos de (pagador)</h2>
      ${linha("Nome", r.payer_name)}
      ${linha("CPF/CNPJ", r.payer_document_fmt)}
      ${linha("Endereço", r.payer_address)}
    </div>
    <div class="parte">
      <h2>Emitente</h2>
      ${linha("Nome", r.emitter_name)}
      ${linha("CPF/CNPJ", r.emitter_document_fmt)}
      ${linha("Endereço", r.emitter_address)}
      ${linha("Forma de pagamento", r.payment_method)}
      ${linha("Referência", r.reference)}
    </div>
  </div>

  ${r.notes ? `<div class="obs">${esc(r.notes)}</div>` : ""}

  <div class="local">${esc([r.place, r.receipt_date_long].filter(Boolean).join(", "))}</div>
  ${assinatura}

  <div class="rodape">
    Este documento é um recibo de pagamento e não substitui nota fiscal.<br />
    Emitido eletronicamente${r.issued_at ? " em " + esc(new Date(r.issued_at).toLocaleString("pt-BR")) : ""}
    ${r.version > 1 ? ` · versão ${esc(r.version)}` : ""} · verificação:
    <span class="hash">${esc(r.content_hash || "")}</span>
    ${st.footer ? `<br />${esc(st.footer)}` : ""}
  </div>
</div></body></html>`;
}

/** Abre o recibo numa janela limpa e chama a impressão (Salvar como PDF). */
export function printReceipt(r) {
  const w = window.open("", "_blank", "width=860,height=1000");
  if (!w) {
    alert("O navegador bloqueou a janela do recibo. Libere os pop-ups deste site e tente de novo.");
    return;
  }
  w.document.write(receiptHtml(r).replace(
    "</body>", '<script>window.onload=()=>window.print()<\/script></body>'
  ));
  w.document.close();
}
