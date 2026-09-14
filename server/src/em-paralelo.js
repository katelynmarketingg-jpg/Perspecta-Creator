// ---------------------------------------------------------------------------
// FAZER VÁRIOS AO MESMO TEMPO, mas não todos.
//
// Mandar um arquivo para a Cloudflare é esperar a rede: a máquina fica parada
// olhando. Fazendo um de cada vez, subir 10 fotos custa 10 esperas em fila —
// é o "demora demais" de sempre. Fazendo TODOS de uma vez, a memória enche e a
// rede engasga (um .zip com 200 fotos derrubaria o servidor).
//
// Aqui um punhado anda junto e, cada vez que um termina, o próximo entra. A
// ordem da lista de saída é a mesma da entrada — importa, porque num carrossel
// a ordem das slides É o post.
// ---------------------------------------------------------------------------
export async function emParalelo(itens, limite, tarefa) {
  const lista = Array.from(itens || []);
  const saida = new Array(lista.length);
  let proximo = 0;
  const quantos = Math.max(1, Math.min(limite, lista.length));
  await Promise.all(Array.from({ length: quantos }, async () => {
    while (proximo < lista.length) {
      const meu = proximo++;
      saida[meu] = await tarefa(lista[meu], meu);
    }
  }));
  return saida;
}
