// ---------------------------------------------------------------------------
// O QR DO TERMO DE VERACIDADE.
//
// Fica num arquivo só dele, e não dentro do termo, de propósito: o termo é
// testado pelo servidor (server/test/termo-de-veracidade.test.mjs), que roda
// ANTES de o client instalar as dependências. Uma biblioteca importada lá
// derrubaria a suíte inteira por um motivo que nada tem a ver com o termo.
//
// Sai como imagem embutida (data URI): o papel impresso não depende de rede.
// ---------------------------------------------------------------------------
import qrcode from "qrcode-generator";

export function qrDataUrl(texto) {
  if (!texto) return "";
  try {
    const q = qrcode(0, "M");   // 0 = o menor tamanho que couber; M = correção média
    q.addData(String(texto));
    q.make();
    return q.createDataURL(4, 0);
  } catch {
    // Sem o QR o termo ainda traz o endereço e o código escritos — que é o
    // que vale; o QR é o atalho.
    return "";
  }
}
