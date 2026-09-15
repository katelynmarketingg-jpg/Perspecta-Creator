// ---------------------------------------------------------------------------
// O AVISO "VOCÊ TEM N CONTEÚDOS PARA APROVAR".
//
// Ele era escrito quando a agência mandava a peça e nunca mais mexido. Quando o
// cliente aprovava (ou pedia ajuste), a lista caía para 7 e o aviso continuava
// dizendo 8 — dois números diferentes na MESMA tela, e o de cima errado. Ficava
// assim até a agência mandar outra peça.
//
// Agora todo mundo que muda o que está aguardando chama esta função, e ela
// reescreve o aviso com a contagem de agora (ou apaga, quando não sobra nada).
// ---------------------------------------------------------------------------
import { db } from "./db.js";

export function avisarAprovacoesPendentes(orgId, clientId) {
  if (!clientId) return;
  const n = db.prepare(
    `SELECT COUNT(*) AS n FROM tasks t JOIN kanban_stages s ON s.id = t.stage_id
     WHERE t.org_id = ? AND t.client_id = ? AND s.name LIKE '%Aprova%' AND t.approval_status = 'sent'`
  ).get(orgId, clientId).n;
  db.prepare(
    "DELETE FROM notifications WHERE org_id = ? AND client_id = ? AND audience = 'client' AND is_read = 0 AND message LIKE '%aprovar%'"
  ).run(orgId, clientId);
  if (n > 0) {
    db.prepare("INSERT INTO notifications (audience, client_id, message, org_id) VALUES ('client', ?, ?, ?)")
      .run(clientId, `🆕 Você tem ${n} conteúdo${n > 1 ? "s" : ""} para aprovar.`, orgId);
  }
}
