import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";
import { remindOverdue } from "../overdue.js";
import { lembrarRetornos } from "../retorno-prospect.js";

const router = Router();
router.use(authRequired);

// GET /api/notifications — últimas 30, com nome do cliente.
router.get("/", (req, res) => {
  try { remindOverdue(req.orgId); } catch { /* não bloqueia a lista */ }
  // Retornos da Prospecção que chegaram a hora — um por prospect por dia.
  try { lembrarRetornos(req.orgId); } catch { /* não bloqueia a lista */ }
  // Mostra as da equipe (user_id NULL) + as miradas neste usuário.
  const rows = db
    .prepare(
      `SELECT n.*, c.name AS client_name
       FROM notifications n LEFT JOIN clients c ON c.id = n.client_id
       WHERE n.audience = 'agency' AND n.org_id = ?
         AND (n.user_id IS NULL OR n.user_id = ?)
       ORDER BY n.created_at DESC LIMIT 30`
    )
    .all(req.orgId, req.user?.id ?? null);
  res.json(rows);
});

router.put("/read-all", (req, res) => {
  db.prepare(
    `UPDATE notifications SET is_read = 1
     WHERE audience = 'agency' AND org_id = ? AND (user_id IS NULL OR user_id = ?)`
  ).run(req.orgId, req.user?.id ?? null);
  res.json({ ok: true });
});

router.put("/:id/read", (req, res) => {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

// DELETE /api/notifications — LIMPA a caixa.
//
// "Marcar como lida" tira o número da sineta, mas os avisos continuam todos
// ali; quem abre a caixa vê a mesma parede de avisos do dia anterior. Faltava o
// limpar de verdade.
//
// Isto apaga só os AVISOS — nada do que eles avisam. A cobrança atrasada
// continua atrasada e volta a avisar amanhã, porque o lembrete é diário (um por
// cobrança por dia). Some o recado, não o fato.
router.delete("/", (req, res) => {
  const info = db.prepare(
    `DELETE FROM notifications
      WHERE audience = 'agency' AND org_id = ? AND (user_id IS NULL OR user_id = ?)`
  ).run(req.orgId, req.user?.id ?? null);
  res.json({ ok: true, apagadas: info.changes });
});

export default router;
