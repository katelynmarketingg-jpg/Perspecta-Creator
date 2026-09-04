// ---------------------------------------------------------------------------
// Foto de iPhone (.HEIC) — o navegador não desenha, então convertemos aqui.
//
// Nenhum navegador de computador abre .HEIC: nem Chrome, nem Edge, nem Firefox.
// Era por isso que as fotos do iPhone apareciam como quadrado quebrado na
// Galeria, mesmo com o arquivo inteiro e certo no servidor. O Render não tem
// biblioteca de imagem (sharp/ffmpeg), então a conversão é feita no navegador.
//
// Duas coisas mantêm isso leve:
//  · a biblioteca (pesada) só é baixada quando aparece um HEIC de verdade —
//    quem não usa iPhone nunca carrega esse pedaço;
//  · o resultado vira a MINIATURA guardada no servidor, então cada arquivo é
//    convertido UMA vez e nunca mais.
//
// O arquivo original continua intacto: baixar entrega o .HEIC como veio.
// ---------------------------------------------------------------------------

/** Reconhece foto de iPhone pelo tipo ou pelo nome (o tipo às vezes vem vazio). */
export function ehHeic(nome, mime) {
  const m = (mime || "").toLowerCase();
  if (m.includes("heic") || m.includes("heif")) return true;
  return /\.(heic|heif)$/i.test(nome || "");
}

let carregando = null;
function biblioteca() {
  carregando ||= import("heic-to");
  return carregando;
}

// Uma foto de 12 MP leva alguns segundos para converter. Numa pasta com muitas
// fotos do iPhone, deixar todas começarem juntas engasga o computador — então
// só duas rodam por vez e as outras esperam na fila.
const LIMITE = 2;
let rodando = 0;
const fila = [];

function proximo() {
  if (rodando >= LIMITE || !fila.length) return;
  rodando += 1;
  const { tarefa, ok } = fila.shift();
  tarefa().then(ok, ok).finally(() => { rodando -= 1; proximo(); });
}

function naFila(tarefa) {
  return new Promise((ok) => { fila.push({ tarefa, ok }); proximo(); });
}

/**
 * Converte um HEIC em JPEG. Devolve null (sem lançar erro) quando não dá —
 * arquivo corrompido, formato inesperado, navegador antigo. Quem chama cai no
 * ícone do arquivo, que é melhor do que uma tela travada.
 */
export function heicParaJpeg(blob, qualidade = 0.82) {
  return naFila(async () => {
    try {
      const { heicTo } = await biblioteca();
      return await heicTo({ blob, type: "image/jpeg", quality: qualidade });
    } catch (e) {
      console.warn("[heic] não foi possível converter:", e?.message || e);
      return null;
    }
  });
}

/** Converte e devolve uma URL pronta para <img>, ou null. Quem chama revoga. */
export async function heicParaUrl(blob) {
  const jpeg = await heicParaJpeg(blob);
  return jpeg ? URL.createObjectURL(jpeg) : null;
}
