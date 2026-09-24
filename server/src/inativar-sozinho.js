import { db } from "./db.js";
import { situacaoDaRenovacao } from "./landing.js";

// ---------------------------------------------------------------------------
// QUANDO UM CLIENTE VAI SOZINHO PARA A ABA "INATIVOS".
//
// A regra é conservadora de propósito: sumir com um cliente da lista principal
// sem ela mandar é o tipo de automatismo que destrói confiança. Então só move
// quem JÁ TEVE alguma coisa e não tem mais nada de pé:
//
//  · o contrato mensal terminou (work_end no passado), E
//  · nenhuma landing page ativa dentro do prazo.
//
// Cliente recém-cadastrado, sem serviço nenhum e sem data de fim, NÃO é tocado:
// ele não "terminou", ele ainda nem começou. Era o jeito mais fácil de este
// código apagar o trabalho de alguém.
//
// E nada é silencioso: cada movimentação vira um aviso na sineta, dizendo por
// quê e lembrando que "Reativar" existe.
// ---------------------------------------------------------------------------

const hojeISO = () => new Date().toISOString().slice(0, 10);

/**
 * Diz se este cliente já pode ir para Inativos, e por quê.
 * Devolve null quando ele deve ficar onde está.
 */
export function motivoParaInativar(cliente, { lps = [], hoje = new Date() } = {}) {
  if (!cliente) return null;
  if (cliente.archived_at) return null;                 // já está lá
  if (cliente.status !== "active") return null;         // já não está na lista de ativos

  const dia = hoje.toISOString().slice(0, 10);
  const contratoTerminou = Boolean(cliente.work_end) && cliente.work_end < dia;

  const lpsVivas = lps.filter((lp) => {
    if (lp.status === "cancelada") return false;
    if (!lp.proxima) return true;   // publicada e sem renovação vencida
    const s = situacaoDaRenovacao(lp.proxima, hoje);
    // Fora da tolerância é o fim da linha; atrasada ainda é conversa.
    return s !== "tolerancia_vencida";
  });

  // Ele precisa ter tido ALGUMA coisa. Sem contrato e sem LP, é cliente novo
  // ou cadastro solto — não há o que encerrar.
  const jaTeveAlgo = Boolean(cliente.work_end) || lps.length > 0;
  if (!jaTeveAlgo) return null;

  if (lpsVivas.length > 0) return null;
  if (cliente.work_end && !contratoTerminou) return null;

  if (lps.length && !cliente.work_end) return "todas as landing pages dele foram encerradas";
  if (contratoTerminou && !lps.length) return `o contrato terminou em ${cliente.work_end}`;
  return `o contrato terminou em ${cliente.work_end} e as landing pages foram encerradas`;
}

/** A passada: move quem já pode ir, e avisa. */
export function inativaQuemAcabou(hoje = new Date()) {
  const clientes = db.prepare(
    "SELECT id, org_id, name, status, work_end, archived_at FROM clients WHERE archived_at IS NULL AND status = 'active'"
  ).all();
  if (!clientes.length) return { movidos: 0 };

  const lpsDe = db.prepare("SELECT * FROM landing_pages WHERE client_id = ?");
  const proximaDe = db.prepare(
    "SELECT * FROM lp_renovacoes WHERE lp_id = ? AND status NOT IN ('pago','cancelado') ORDER BY ano LIMIT 1"
  );
  const arquiva = db.prepare(
    "UPDATE clients SET archived_at = ?, status = 'inactive', archive_note = ? WHERE id = ?"
  );
  const avisa = db.prepare(
    "INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('agency', ?, NULL, ?, ?)"
  );

  let movidos = 0;
  const tx = db.transaction(() => {
    for (const c of clientes) {
      const lps = lpsDe.all(c.id).map((lp) => ({ ...lp, proxima: proximaDe.get(lp.id) }));
      const motivo = motivoParaInativar(c, { lps, hoje });
      if (!motivo) continue;
      arquiva.run(new Date().toISOString(), `Movido para Inativos sozinho: ${motivo}.`, c.id);
      avisa.run(c.id,
        `📁 ${c.name} foi para a aba Inativos: ${motivo}. Nada foi apagado — o botão "Reativar" traz de volta.`,
        c.org_id);
      movidos += 1;
    }
  });
  tx();
  return { movidos };
}
