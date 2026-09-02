import { db } from "./db.js";

// Gera avisos de pagamento em atraso — no máximo 1 por dia por cobrança.
// Como o Render é 1 instância sem agendador dedicado, a checagem roda quando
// alguém abre as notificações (equipe ou cliente). O controle diário é feito
// pelo campo last_reminder_at, então não repete no mesmo dia.
export function remindOverdue(orgId, clientId = null) {
  if (!orgId) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const where = [
    "org_id = ?", "type = 'income'", "status = 'pending'",
    "due_date IS NOT NULL", "date(due_date) < ?",
    "(last_reminder_at IS NULL OR date(last_reminder_at) < ?)",
  ];
  const params = [orgId, today, today];
  if (clientId) { where.push("client_id = ?"); params.push(clientId); }

  const overdue = db.prepare(
    `SELECT id, client_id, description, due_date FROM financial_entries WHERE ${where.join(" AND ")}`
  ).all(...params);
  if (!overdue.length) return 0;

  const insClient = db.prepare("INSERT INTO notifications (audience, client_id, message, org_id) VALUES ('client', ?, ?, ?)");
  const insAgency = db.prepare("INSERT INTO notifications (audience, client_id, message, org_id) VALUES ('agency', ?, ?, ?)");
  const delClient = db.prepare("DELETE FROM notifications WHERE org_id = ? AND client_id = ? AND audience = 'client' AND is_read = 0 AND message LIKE '%em aberto%'");
  const mark = db.prepare("UPDATE financial_entries SET last_reminder_at = datetime('now') WHERE id = ?");

  // Agrupa por cliente: o cliente recebe UM aviso com a contagem; a agência
  // continua vendo cada cobrança em detalhe.
  const porCliente = {};
  const tx = db.transaction(() => {
    for (const f of overdue) {
      const venc = f.due_date.slice(0, 10).split("-").reverse().join("/");
      if (f.client_id) (porCliente[f.client_id] = (porCliente[f.client_id] || 0) + 1);
      insAgency.run(f.client_id, `⚠️ Pagamento atrasado: "${f.description}" (venceu ${venc}).`, orgId);
      mark.run(f.id);
    }
    for (const [cid, n] of Object.entries(porCliente)) {
      delClient.run(orgId, cid);
      insClient.run(cid, `💳 Você tem ${n} pagamento${n > 1 ? "s" : ""} em aberto.`, orgId);
    }
  });
  tx();
  return overdue.length;
}
