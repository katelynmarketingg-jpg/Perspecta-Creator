import { db } from "./db.js";

// Quantos dias parados na aprovação até cobrar, e o intervalo entre cobranças.
const DIAS_PARA_COBRAR = 3;
const DIAS_ENTRE_COBRANCAS = 3;

/**
 * Procura posts parados na aprovação do cliente e cria dois avisos: um para
 * o cliente (aparece no portal dele) e um para a agência.
 * Roda sozinho de hora em hora e é seguro chamar quantas vezes quiser —
 * `last_reminder_at` evita cobrar a mesma coisa todo dia.
 */
export function runApprovalReminders() {
  const paradas = db.prepare(`
    SELECT t.id, t.title, t.client_id, t.org_id, t.approval_sent_at, t.last_reminder_at,
           c.name AS client_name
    FROM tasks t
    JOIN kanban_stages s ON s.id = t.stage_id
    LEFT JOIN clients c ON c.id = t.client_id
    WHERE s.name LIKE '%Aprova%'
      AND t.approval_status = 'pending'
      AND t.client_id IS NOT NULL
      AND t.approval_sent_at IS NOT NULL
      AND julianday('now') - julianday(t.approval_sent_at) >= ?
      AND (t.last_reminder_at IS NULL
           OR julianday('now') - julianday(t.last_reminder_at) >= ?)
  `).all(DIAS_PARA_COBRAR, DIAS_ENTRE_COBRANCAS);

  if (!paradas.length) return { enviados: 0 };

  const insNotif = db.prepare(
    `INSERT INTO notifications (audience, client_id, task_id, message, org_id)
     VALUES (?, ?, ?, ?, ?)`
  );
  const marca = db.prepare("UPDATE tasks SET last_reminder_at = datetime('now') WHERE id = ?");

  const tx = db.transaction(() => {
    paradas.forEach((t) => {
      const dias = Math.floor(
        (Date.now() - new Date(t.approval_sent_at + "Z").getTime()) / 86400000
      );
      insNotif.run("client", t.client_id, t.id,
        `⏰ "${t.title}" está esperando a sua aprovação há ${dias} dias.`, t.org_id);
      insNotif.run("agency", t.client_id, t.id,
        `⏰ ${t.client_name} ainda não aprovou "${t.title}" (${dias} dias parado).`, t.org_id);
      marca.run(t.id);
    });
  });
  tx();

  return { enviados: paradas.length };
}

/**
 * Avisa a agência sobre contratos que encerram no próximo mês, para dar tempo
 * de conversar e renovar. Manda um aviso por cliente, uma vez por mês.
 */
export function runRenewalAlerts() {
  const vencendo = db.prepare(`
    SELECT id, name, org_id, work_end FROM clients
    WHERE status = 'active' AND work_end IS NOT NULL
      AND strftime('%Y-%m', work_end) = strftime('%Y-%m', date('now', '+1 month'))
  `).all();
  if (!vencendo.length) return { avisados: 0 };

  const insNotif = db.prepare(
    "INSERT INTO notifications (audience, client_id, message, org_id) VALUES ('agency', ?, ?, ?)"
  );
  // Evita repetir no mesmo mês: usa uma marca simples por cliente/mês.
  const jaAvisou = db.prepare(`
    SELECT 1 FROM notifications
    WHERE org_id = ? AND client_id = ? AND message LIKE '%renovar%'
      AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') LIMIT 1
  `);

  let n = 0;
  vencendo.forEach((c) => {
    if (jaAvisou.get(c.org_id, c.id)) return;
    const fim = new Date(c.work_end + "T00:00:00").toLocaleDateString("pt-BR");
    insNotif.run(c.id, `🔔 Contrato de ${c.name} encerra em ${fim} — hora de conversar e renovar.`, c.org_id);
    n++;
  });
  return { avisados: n };
}

/** Liga o verificador de hora em hora. */
export function startReminders() {
  const UMA_HORA = 60 * 60 * 1000;
  const passada = () => {
    try { runApprovalReminders(); } catch (e) { console.error("lembretes:", e.message); }
    try { runRenewalAlerts(); } catch (e) { console.error("renovações:", e.message); }
  };
  setTimeout(passada, 30 * 1000); // primeira passada 30s depois de subir
  setInterval(passada, UMA_HORA).unref?.();
}
