import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";

const router = Router();
router.use(authRequired, moduleAllowed("tarefas"));

// GET /api/comments/:taskId — conversa daquele post, mais antiga primeiro.
router.get("/:taskId", (req, res) => {
  const task = db.prepare("SELECT id FROM tasks WHERE id = ? AND org_id = ?").get(req.params.taskId, req.orgId);
  if (!task) return res.status(404).json({ error: "Tarefa não encontrada." });
  res.json(
    db.prepare("SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at, id").all(req.params.taskId)
  );
});

// POST /api/comments/:taskId — a agência responde o cliente.
router.post("/:taskId", (req, res) => {
  const task = db
    .prepare("SELECT id, title, client_id FROM tasks WHERE id = ? AND org_id = ?")
    .get(req.params.taskId, req.orgId);
  if (!task) return res.status(404).json({ error: "Tarefa não encontrada." });
  const body = (req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "Escreva alguma coisa." });

  const user = db.prepare("SELECT name FROM users WHERE id = ?").get(req.user.id);
  const info = db
    .prepare(
      `INSERT INTO task_comments (org_id, task_id, author_type, author_id, author_name, body)
       VALUES (?, ?, 'agency', ?, ?, ?)`
    )
    .run(req.orgId, task.id, req.user.id, user?.name || "Equipe", body);

  // O cliente é avisado no portal de que respondemos.
  if (task.client_id) {
    db.prepare(
      "INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('client', ?, ?, ?, ?)"
    ).run(task.client_id, task.id, `💬 Respondemos em "${task.title}".`, req.orgId);
  }
  res.status(201).json(db.prepare("SELECT * FROM task_comments WHERE id = ?").get(info.lastInsertRowid));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM task_comments WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

export default router;
