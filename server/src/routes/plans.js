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
  const num = (v) => (v ? Number(v) : null); // vazio/0 = ilimitado
  const info = db
    .prepare("INSERT INTO saas_plans (name, max_users, max_clients, storage_gb, price, position) VALUES (?, ?, ?, ?, ?, ?)")
    .run(b.name, num(b.max_users), num(b.max_clients), num(b.storage_gb), Number(b.price) || 0, pos);
  res.status(201).json(db.prepare("SELECT * FROM saas_plans WHERE id = ?").get(info.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM saas_plans WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "Plano não encontrado." });
  const b = req.body || {};
  const keep = (v, cur) => (v !== undefined ? (v ? Number(v) : null) : cur);
  db.prepare("UPDATE saas_plans SET name=?, max_users=?, max_clients=?, storage_gb=?, price=?, active=? WHERE id=?").run(
    b.name ?? cur.name,
    keep(b.max_users, cur.max_users),
    keep(b.max_clients, cur.max_clients),
    keep(b.storage_gb, cur.storage_gb),
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
