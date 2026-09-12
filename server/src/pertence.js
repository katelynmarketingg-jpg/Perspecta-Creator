// ---------------------------------------------------------------------------
// "ESSE ID É DESTA CASA?"
//
// O sistema confere bem o id que vai no ENDEREÇO (/api/tasks/7): toda rota
// dessas filtra por org_id, e uma varredura das 69 rotas com :id não achou um
// furo sequer. O ponto cego era o id que viaja no CORPO do pedido.
//
// Medido: uma agência conseguia criar tarefa, cobrança e projeto amarrados ao
// CLIENTE de outra agência. E isso não ficava parado num canto do banco:
//   - a cobrança aparecia na Área do Cliente da outra agência, como se fosse
//     dela — uma fatura plantada na tela do cliente de outra pessoa;
//   - o conteúdo aparecia no feed daquele cliente;
//   - e o NOME do cliente da outra agência voltava na listagem de quem plantou.
//
// A regra é uma só e vale para todo id que chega pelo corpo: ou é desta casa,
// ou o pedido é recusado.
// ---------------------------------------------------------------------------
import { db } from "./db.js";

/** O id existe e é desta agência? Vazio/nulo conta como "não informado" (ok). */
export function daCasa(tabela, id, orgId) {
  if (id === undefined || id === null || id === "") return true;
  const n = Number(id);
  if (!Number.isFinite(n)) return false;
  // A tabela vem SEMPRE de código nosso, nunca do pedido.
  return Boolean(db.prepare(`SELECT 1 FROM ${tabela} WHERE id = ? AND org_id = ?`).get(n, orgId));
}

/**
 * Confere os ids que vieram no corpo. Devolve a mensagem do problema, ou null.
 * Uso: `const erro = confere(req.orgId, { clients: b.client_id, files: b.file_id });`
 */
export function confere(orgId, mapa) {
  for (const [tabela, valor] of Object.entries(mapa)) {
    const valores = Array.isArray(valor) ? valor : [valor];
    for (const v of valores) {
      if (!daCasa(tabela, v, orgId)) return ROTULO[tabela] || "Um dos itens escolhidos não é desta agência.";
    }
  }
  return null;
}

const ROTULO = {
  clients: "Esse cliente não é desta agência.",
  files: "Essa mídia não é desta agência.",
  projects: "Esse projeto não é desta agência.",
  services: "Esse serviço não é desta agência.",
  folders: "Essa pasta não é desta agência.",
  prospects: "Esse contato não é desta agência.",
  users: "Essa pessoa não é desta equipe.",
};
