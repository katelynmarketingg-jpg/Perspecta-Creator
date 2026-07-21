import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();
router.use(authRequired);

// GET /api/notifications — últimas 30, com nome do cliente.
router.get("/", (req, res) => {
  const rows = db
    .prepare(
      `SELECT n.*, c.name AS client_name
       FROM notifications n LEFT JOIN clients c ON c.id = n.client_id
       WHERE n.audience = 'agency' AND n.org_id = ?
       ORDER BY n.created_at DESC LIMIT 30`
    )
    .all(req.orgId);
  res.json(rows);
});

router.put("/read-all", (req, res) => {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE audience = 'agency' AND org_id = ?").run(req.orgId);
  res.json({ ok: true });
});

router.put("/:id/read", (req, res) => {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

export default router;
