import { Router } from "express";
import { db } from "../db.js";
import { authRequired, superadminRequired } from "../auth.js";

const router = Router();
router.use(authRequired, superadminRequired);

// ---- Planos (o Perspecta Media define; cobra por nº de pessoas) ----
router.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM saas_plans ORDER BY position, price").all());
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "Nome do plano é obrigatório." });
  const pos = db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS p FROM saas_plans").get().p;
  const info = db
    .prepare("INSERT INTO saas_plans (name, max_users, price, position) VALUES (?, ?, ?, ?)")
    .run(b.name, b.max_users ? Number(b.max_users) : null, Number(b.price) || 0, pos);
  res.status(201).json(db.prepare("SELECT * FROM saas_plans WHERE id = ?").get(info.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM saas_plans WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "Plano não encontrado." });
  const b = req.body || {};
  db.prepare("UPDATE saas_plans SET name=?, max_users=?, price=?, active=? WHERE id=?").run(
    b.name ?? cur.name,
    b.max_users !== undefined ? (b.max_users ? Number(b.max_users) : null) : cur.max_users,
    b.price !== undefined ? Number(b.price) || 0 : cur.price,
    b.active !== undefined ? (b.active ? 1 : 0) : cur.active,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM saas_plans WHERE id = ?").get(req.params.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM saas_plans WHERE id = ?").run(req.params.id);
  db.prepare("UPDATE organizations SET plan_id = NULL WHERE plan_id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
