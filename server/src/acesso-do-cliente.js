// ---------------------------------------------------------------------------
// QUANDO O ACESSO DO CLIENTE AO PORTAL ESTÁ MESMO ENCERRADO.
//
// Encerrado = a AGÊNCIA decidiu encerrar, arquivando o cliente à mão. Só isso
// corta o login do portal.
//
// A arrumação automática (inativar-sozinho.js) move para "Inativos" o cliente
// cujo contrato venceu — mas isso é só organização de lista. Cliente mensal que
// renova tem o work_end no passado o tempo TODO; se o vencimento do contrato
// cortasse o acesso, um dia a rotina passava e TODOS os clientes perdiam o
// portal de uma vez (foi o que aconteceu). Quem a rotina moveu carrega uma
// marca no recado de arquivamento; por ela separamos "a agência encerrou" de
// "a lista se arrumou sozinha".
// ---------------------------------------------------------------------------

// Precisa bater com o recado que inativar-sozinho.js grava ao mover sozinho.
// É reexportada de lá para o código antigo continuar importando do mesmo lugar.
export const MARCA_AUTOMATICA = "Movido para Inativos sozinho:";

/**
 * true quando o acesso ao portal deve estar fechado para este cliente.
 * Fecha só quando a agência arquivou de propósito — nunca pela arrumação
 * automática de lista.
 */
export function acessoEncerrado(cliente) {
  if (!cliente) return true;                        // sem cliente, nada entra
  if (!cliente.archived_at) return false;           // ativo (ou só reativado)
  // Arquivado: foi a rotina (tem a marca) ou foi a agência (não tem)?
  return !(cliente.archive_note || "").startsWith(MARCA_AUTOMATICA);
}
