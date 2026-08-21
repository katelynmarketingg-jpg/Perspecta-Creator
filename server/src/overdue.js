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
  const mark = db.prepare("UPDATE financial_entries SET last_reminder_at = datetime('now') WHERE id = ?");

  const tx = db.transaction(() => {
    for (const f of overdue) {
      const venc = f.due_date.slice(0, 10).split("-").reverse().join("/");
      if (f.client_id) {
        insClient.run(f.client_id, `💳 Pagamento em aberto: "${f.description}" venceu em ${venc}.`, orgId);
      }
      insAgency.run(f.client_id, `⚠️ Pagamento atrasado: "${f.description}" (venceu ${venc}).`, orgId);
      mark.run(f.id);
    }
  });
  tx();
  return overdue.length;
}
