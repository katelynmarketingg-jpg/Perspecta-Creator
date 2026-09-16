// ---------------------------------------------------------------------------
// ARRASTAR E SOLTAR ARQUIVOS.
//
// Até aqui a única forma de enviar era clicar em "Enviar arquivo" e caçar as
// fotos no seletor do sistema. Pior: como nenhuma tela tratava o arrastar, quem
// soltasse um arquivo em cima da página caía no comportamento padrão do
// navegador — ele ABRE o arquivo e o sistema some da tela. Ou seja, o gesto mais
// natural do mundo era, além de inútil, destrutivo.
//
// Aqui ficam as duas peças: ler o que foi solto (inclusive PASTAS inteiras, que
// é como o material de um mês chega) e a área que acende quando algo é
// arrastado por cima.
// ---------------------------------------------------------------------------

/** Quantos arquivos no máximo aceitamos de uma vez (uma pasta de mês cabe). */
export const MAX_DE_UMA_VEZ = 200;

/**
 * Lê UMA entrada do sistema de arquivos (arquivo ou pasta), recursivamente.
 *
 * `readEntries` devolve no máximo 100 itens por chamada — por isso o laço: sem
 * ele, uma pasta com 150 fotos entregaria só as 100 primeiras, em silêncio.
 */
async function lerEntrada(entrada, saida, limite) {
  if (!entrada || saida.length >= limite) return;
  if (entrada.isFile) {
    try {
      const arquivo = await new Promise((ok, falhou) => entrada.file(ok, falhou));
      // Arquivos ocultos do sistema (.DS_Store do Mac, Thumbs.db do Windows)
      // vêm junto quando se arrasta uma pasta e não interessam a ninguém.
      if (!arquivo.name.startsWith(".") && arquivo.name !== "Thumbs.db") saida.push(arquivo);
    } catch { /* arquivo ilegível: segue com os outros */ }
    return;
  }
  if (!entrada.isDirectory) return;
  const leitor = entrada.createReader();
  let lote;
  do {
    // eslint-disable-next-line no-await-in-loop
    lote = await new Promise((ok) => leitor.readEntries(ok, () => ok([])));
    // eslint-disable-next-line no-await-in-loop
    for (const e of lote) await lerEntrada(e, saida, limite);
  } while (lote.length && saida.length < limite);
}

/**
 * Os arquivos de um evento de soltar — abrindo as pastas que vierem junto.
 *
 * As entradas do DataTransfer só valem DURANTE o evento, então elas são
 * recolhidas de uma vez (síncrono) e só depois lidas com calma.
 */
export async function arquivosSoltos(dataTransfer, limite = MAX_DE_UMA_VEZ) {
  if (!dataTransfer) return [];
  const itens = Array.from(dataTransfer.items || []);
  const entradas = itens
    .filter((i) => i.kind === "file")
    .map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (!entradas.length) {
    // Navegador sem a API de entradas: pelo menos os arquivos soltos vêm.
    return Array.from(dataTransfer.files || []).slice(0, limite);
  }
  const saida = [];
  for (const e of entradas) {
    // eslint-disable-next-line no-await-in-loop
    await lerEntrada(e, saida, limite);
  }
  return saida.slice(0, limite);
}

/**
 * O arrastar SEMPRE precisa ser cancelado na janela inteira, mesmo fora da área
 * de soltar: é isso que impede o navegador de abrir o arquivo e derrubar o
 * sistema quando a pessoa erra a mira.
 */
export function impedirAberturaPeloNavegador() {
  const parar = (e) => {
    // Só quando o que vem arrastado é ARQUIVO — arrastar texto, ou uma peça
    // dentro da prévia do feed, tem que continuar funcionando.
    const tipos = Array.from(e.dataTransfer?.types || []);
    if (!tipos.includes("Files")) return;
    e.preventDefault();
  };
  window.addEventListener("dragover", parar);
  window.addEventListener("drop", parar);
  return () => {
    window.removeEventListener("dragover", parar);
    window.removeEventListener("drop", parar);
  };
}
