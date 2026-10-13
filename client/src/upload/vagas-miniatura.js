// ---------------------------------------------------------------------------
// FILA DE MINIATURAS — para a Galeria não congelar ao abrir.
//
// Arquivo sem miniatura é "desenhado" no navegador para gerar a prévia: o vídeo
// precisa ser carregado para pegar o 1º quadro. Quando a pasta tem muitos vídeos
// sem miniatura, TODOS carregavam juntos na abertura — banda saturada e a tela
// travada por minutos (a "película" que não deixava clicar).
//
// Aqui só DOIS geram por vez; os outros esperam a vez (poucos segundos) mostrando
// o ícone, e a tela nunca congela. Assim que uma miniatura fica pronta, a vaga é
// liberada e o próximo vídeo carrega.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState, useCallback } from "react";

const LIMITE = 2;        // quantas miniaturas pesadas podem ser geradas por vez
let emUso = 0;
const fila = [];         // funções que esperam uma vaga

function girar() {
  while (emUso < LIMITE && fila.length) {
    const conceder = fila.shift();
    emUso += 1;
    conceder();
  }
}

// Reserva uma vaga; chama onVaga() quando conseguir. Devolve um liberar()
// idempotente (seguro chamar mais de uma vez — ao terminar E ao desmontar).
function reservar(onVaga) {
  let concedido = false;
  let liberado = false;
  const conceder = () => { concedido = true; onVaga(); };
  if (emUso < LIMITE) { emUso += 1; conceder(); }
  else fila.push(conceder);
  return function liberar() {
    if (liberado) return;
    liberado = true;
    if (concedido) { emUso -= 1; girar(); }
    else { const i = fila.indexOf(conceder); if (i >= 0) fila.splice(i, 1); }
  };
}

// Hook: devolve [temVaga, liberar].
//  · enquanto `precisa` é true e não há vaga → temVaga=false (o card mostra ícone)
//  · ao conseguir a vaga → temVaga=true (o card carrega e gera a miniatura)
//  · ao terminar, o card chama liberar() para o próximo da fila entrar
export function useVagaMiniatura(precisa) {
  const [temVaga, setTemVaga] = useState(false);
  const liberarRef = useRef(null);
  useEffect(() => {
    if (!precisa) { setTemVaga(false); return undefined; }
    const liberar = reservar(() => setTemVaga(true));
    liberarRef.current = liberar;
    return liberar; // libera na desmontagem, se ainda não tiver liberado
  }, [precisa]);
  const liberar = useCallback(() => { liberarRef.current?.(); }, []);
  return [temVaga, liberar];
}
