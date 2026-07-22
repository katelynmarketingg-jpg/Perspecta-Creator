import { db } from "./db.js";
import { metaConfigured } from "./meta.js";
import { publishTask } from "./routes/integrations.js";

/**
 * Publica sozinho os posts cuja hora chegou — mas só para clientes em que a
 * publicação automática foi ligada de propósito. Sem isso, nada sai no ar
 * sem alguém apertar o botão.
 */
export async function runAutoPublish() {
  if (!metaConfigured()) return { publicados: 0, motivo: "Meta não configurada" };

  const prontos = db.prepare(`
    SELECT t.*, c.name AS client_name
    FROM tasks t
    JOIN clients c ON c.id = t.client_id
    JOIN integrations i ON i.client_id = c.id AND i.provider = 'meta'
    WHERE c.auto_publish = 1
      AND t.published_at IS NULL
      AND t.scheduled_at IS NOT NULL
      AND datetime(t.scheduled_at) <= datetime('now')
      AND datetime(t.scheduled_at) > datetime('now', '-1 day')
      AND t.approval_status = 'approved'
      AND EXISTS (SELECT 1 FROM task_attachments ta WHERE ta.task_id = t.id)
  `).all();

  let publicados = 0;
  for (const task of prontos) {
    try {
      await publishTask(task, task.org_id, null, "https");
      publicados++;
    } catch (e) {
      db.prepare("UPDATE tasks SET publish_error = ? WHERE id = ?").run(e.message, task.id);
      db.prepare(
        "INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('agency', ?, ?, ?, ?)"
      ).run(task.client_id, task.id, `⚠️ Falha ao publicar "${task.title}": ${e.message}`, task.org_id);
    }
  }
  return { publicados, avaliados: prontos.length };
}

export function startPublisher() {
  const CINCO_MIN = 5 * 60 * 1000;
  setInterval(() => {
    runAutoPublish().catch((e) => console.error("auto-publicação:", e.message));
  }, CINCO_MIN).unref?.();
}
