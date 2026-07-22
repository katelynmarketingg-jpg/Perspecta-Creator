import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";

const router = Router();
router.use(authRequired, moduleAllowed("metas"));

const SELECT = `
  SELECT g.*, u.name AS owner_name, p.name AS project_name, p.status AS project_status
  FROM goals g
  LEFT JOIN users u ON u.id = g.owner_id
  LEFT JOIN projects p ON p.id = g.project_id`;

router.get("/", (req, res) => {
  res.json(db.prepare(`${SELECT} WHERE g.org_id = ? ORDER BY g.due_date`).all(req.orgId));
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: "Título é obrigatório." });
  const info = db
    .prepare(
      `INSERT INTO goals (title, description, target, current, due_date, owner_id, goal_type, project_id, org_id)
       VALUES (@title, @description, @target, @current, @due_date, @owner_id, @goal_type, @project_id, @org_id)`
    )
    .run({
      title: b.title,
      description: b.description ?? null,
      target: Number(b.target) || 0,
      current: Number(b.current) || 0,
      due_date: b.due_date ?? null,
      owner_id: b.owner_id ?? null,
      goal_type: b.goal_type ?? "quantity",
      project_id: b.project_id ?? null,
      org_id: req.orgId,
    });
  res.status(201).json(db.prepare(`${SELECT} WHERE g.id = ?`).get(info.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM goals WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: "Meta não encontrada." });
  const merged = { ...cur, ...req.body, id: req.params.id, org_id: req.orgId };
  db.prepare(
    `UPDATE goals SET title=@title, description=@description, target=@target,
     current=@current, due_date=@due_date, owner_id=@owner_id,
     goal_type=@goal_type, project_id=@project_id WHERE id=@id AND org_id=@org_id`
  ).run(merged);
  res.json(db.prepare(`${SELECT} WHERE g.id = ?`).get(req.params.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM goals WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

export default router;
