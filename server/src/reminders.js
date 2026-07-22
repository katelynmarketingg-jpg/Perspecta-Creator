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

/** Liga o verificador de hora em hora. */
export function startReminders() {
  const UMA_HORA = 60 * 60 * 1000;
  setTimeout(() => {
    try { runApprovalReminders(); } catch (e) { console.error("lembretes:", e.message); }
  }, 30 * 1000); // primeira passada 30s depois de subir
  setInterval(() => {
    try { runApprovalReminders(); } catch (e) { console.error("lembretes:", e.message); }
  }, UMA_HORA).unref?.();
}
