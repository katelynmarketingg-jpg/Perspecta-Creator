import { Router } from "express";
import { db } from "../db.js";
import { authRequired, adminRequired, hashPassword } from "../auth.js";
import { publicUser } from "./auth.js";

const router = Router();
router.use(authRequired);

// GET /api/users — lista completa (admin)
router.get("/", adminRequired, (req, res) => {
  const rows = db.prepare("SELECT * FROM users ORDER BY name").all();
  res.json(rows.map(publicUser));
});

// GET /api/users/team — lista enxuta para atribuição de tarefas
router.get("/team", (req, res) => {
  const rows = db.prepare("SELECT id, name, email, role FROM users WHERE active = 1 ORDER BY name").all();
  res.json(rows);
});

// POST /api/users — cria usuário (admin)
router.post("/", adminRequired, (req, res) => {
  const { name, email, password, role = "member" } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Nome, e-mail e senha são obrigatórios." });
  }
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (exists) return res.status(409).json({ error: "E-mail já cadastrado." });
  const info = db
    .prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)")
    .run(name, email.toLowerCase(), hashPassword(password), role);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(publicUser(user));
});

// PUT /api/users/:id — atualiza dados básicos (admin)
router.put("/:id", adminRequired, (req, res) => {
  const { name, email, role, active, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

  const next = {
    name: name ?? user.name,
    email: (email ?? user.email).toLowerCase(),
    role: role ?? user.role,
    active: active === undefined ? user.active : active ? 1 : 0,
    password_hash: password ? hashPassword(password) : user.password_hash,
    id: req.params.id,
  };
  db.prepare(
    `UPDATE users SET name = @name, email = @email, role = @role,
     active = @active, password_hash = @password_hash WHERE id = @id`
  ).run(next);

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  res.json(publicUser(updated));
});

// DELETE /api/users/:id (admin)
router.delete("/:id", adminRequired, (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: "Você não pode remover a si mesmo." });
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// GET /api/users/:id/permissions
router.get("/:id/permissions", adminRequired, (req, res) => {
  const user = db.prepare("SELECT permissions FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
  res.json(JSON.parse(user.permissions || "{}"));
});

// PUT /api/users/:id/permissions
router.put("/:id/permissions", adminRequired, (req, res) => {
  const permissions = req.body || {};
  db.prepare("UPDATE users SET permissions = ? WHERE id = ?").run(
    JSON.stringify(permissions),
    req.params.id
  );
  res.json(permissions);
});

export default router;
