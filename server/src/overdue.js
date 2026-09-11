import { db } from "./db.js";

// ---------------------------------------------------------------------------
// Avisos de pagamento em atraso — no máximo 1 por dia por cobrança.
//
// Como o Render é 1 instância sem agendador dedicado, a checagem roda quando
// alguém abre as notificações (equipe ou cliente). O controle diário é feito
// pelo campo last_reminder_at, então não repete no mesmo dia.
//
// O aviso do CLIENTE é um só, com a contagem — e precisa acompanhar a
// realidade: marcou a mensalidade como paga, o aviso some da área dele. Antes
// ficava lá para sempre, porque a notificação já estava gravada e ninguém
// apagava; o cliente via "mensalidade em aberto" semanas depois de ter pago.
// ---------------------------------------------------------------------------

const MARCA = "%em aberto%";

/** Quantas cobranças daquele cliente estão vencidas e ainda não quitadas. */
export function quantasEmAberto(orgId, clientId) {
  return db.prepare(
    `SELECT COUNT(*) n FROM financial_entries
      WHERE org_id = ? AND client_id = ? AND type = 'income'
        AND status IN ('pending', 'partial')
        AND due_date IS NOT NULL AND date(due_date) < date('now')`
  ).get(orgId, clientId).n;
}

/**
 * Deixa o aviso do cliente igual ao que os lançamentos dizem AGORA: some se não
 * houver mais nada vencido, e corrige a contagem se sobrou alguma.
 * Chame depois de mexer no status de uma cobrança.
 */
export function sincronizaAvisoDeAberto(orgId, clientId) {
  if (!orgId || !clientId) return 0;
  const n = quantasEmAberto(orgId, clientId);
  db.prepare(
    "DELETE FROM notifications WHERE org_id = ? AND client_id = ? AND audience = 'client' AND is_read = 0 AND message LIKE ?"
  ).run(orgId, clientId, MARCA);
  if (n > 0) {
    db.prepare("INSERT INTO notifications (audience, client_id, message, org_id) VALUES ('client', ?, ?, ?)")
      .run(clientId, `💳 Você tem ${n} pagamento${n > 1 ? "s" : ""} em aberto.`, orgId);
  }
  return n;
}

/**
 * Limpa avisos que sobraram de cobranças já quitadas. Roda sempre que alguém
 * abre as notificações, então conserta sozinho o que foi pago antes desta
 * correção existir — sem ninguém precisar mexer em nada.
 */
function limpaAvisosVencidos(orgId, clientId = null) {
  const alvos = clientId
    ? [clientId]
    : db.prepare(
        "SELECT DISTINCT client_id FROM notifications WHERE org_id = ? AND audience = 'client' AND is_read = 0 AND client_id IS NOT NULL AND message LIKE ?"
      ).all(orgId, MARCA).map((r) => r.client_id);
  for (const cid of alvos) sincronizaAvisoDeAberto(orgId, cid);
}

export function remindOverdue(orgId, clientId = null) {
  if (!orgId) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const where = [
    "org_id = ?", "type = 'income'", "status IN ('pending', 'partial')",
    "due_date IS NOT NULL", "date(due_date) < ?",
    "(last_reminder_at IS NULL OR date(last_reminder_at) < ?)",
  ];
  const params = [orgId, today, today];
  if (clientId) { where.push("client_id = ?"); params.push(clientId); }

  const overdue = db.prepare(
    `SELECT id, client_id, description, due_date FROM financial_entries WHERE ${where.join(" AND ")}`
  ).all(...params);

  // Mesmo sem cobrança nova para avisar, o que já está na tela é acertado — é
  // isto que faz o aviso sumir depois de a mensalidade ser paga.
  if (!overdue.length) { limpaAvisosVencidos(orgId, clientId); return 0; }

  const insAgency = db.prepare("INSERT INTO notifications (audience, client_id, message, org_id) VALUES ('agency', ?, ?, ?)");
  const mark = db.prepare("UPDATE financial_entries SET last_reminder_at = datetime('now') WHERE id = ?");

  // Agrupa por cliente: o cliente recebe UM aviso com a contagem; a agência
  // continua vendo cada cobrança em detalhe.
  const clientes = new Set();
  const tx = db.transaction(() => {
    for (const f of overdue) {
      const venc = f.due_date.slice(0, 10).split("-").reverse().join("/");
      if (f.client_id) clientes.add(f.client_id);
      insAgency.run(f.client_id, `⚠️ Pagamento atrasado: "${f.description}" (venceu ${venc}).`, orgId);
      mark.run(f.id);
    }
  });
  tx();
  // A contagem do cliente sai dos lançamentos, não do laço acima: assim ela
  // bate com a realidade mesmo quando parte das cobranças já foi paga hoje.
  for (const cid of clientes) sincronizaAvisoDeAberto(orgId, cid);
  limpaAvisosVencidos(orgId, clientId);
  return overdue.length;
}
