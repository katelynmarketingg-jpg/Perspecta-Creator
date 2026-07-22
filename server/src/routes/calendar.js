import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";

const router = Router();
router.use(authRequired, moduleAllowed("calendario"));

// GET /api/calendar?month=YYYY-MM&client_id=
// Posts programados (tarefas com scheduled_at) no mês, com cliente e legenda.
router.get("/", (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const where = ["t.org_id = @org_id", "strftime('%Y-%m', t.scheduled_at) = @month"];
  const params = { org_id: req.orgId, month };
  if (req.query.client_id) {
    where.push("t.client_id = @client_id");
    params.client_id = req.query.client_id;
  }
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.description, t.content_type, t.caption, t.scheduled_at,
              t.approval_status, t.client_id, c.name AS client_name,
              u.name AS assignee_name, s.name AS stage_name, s.is_done AS stage_done
       FROM tasks t
       LEFT JOIN clients c ON c.id = t.client_id
       LEFT JOIN users u ON u.id = t.assignee_id
       LEFT JOIN kanban_stages s ON s.id = t.stage_id
       WHERE ${where.join(" AND ")}
       ORDER BY t.scheduled_at`
    )
    .all(params);
  res.json(rows);
});

// GET /api/calendar/feed?client_id= — a ordem em que o perfil vai ficar.
// Mesma grade do Instagram: mais recente primeiro, 3 por linha.
router.get("/feed", (req, res) => {
  const where = ["t.org_id = @org_id", "t.scheduled_at IS NOT NULL"];
  const params = { org_id: req.orgId };
  if (req.query.client_id) { where.push("t.client_id = @client_id"); params.client_id = req.query.client_id; }

  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.caption, t.client_caption, t.content_type, t.scheduled_at,
              t.approval_status, t.client_id, c.name AS client_name, s.is_done AS stage_done,
              (SELECT ta.file_id FROM task_attachments ta WHERE ta.task_id = t.id LIMIT 1) AS file_id
       FROM tasks t
       LEFT JOIN clients c ON c.id = t.client_id
       LEFT JOIN kanban_stages s ON s.id = t.stage_id
       WHERE ${where.join(" AND ")}
       ORDER BY t.scheduled_at DESC`
    )
    .all(params);
  res.json(rows);
});

export default router;
