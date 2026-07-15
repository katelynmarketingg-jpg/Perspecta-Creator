import { Router } from "express";
import { db } from "../db.js";
import {
  hashPassword,
  verifyPassword,
  signToken,
  authRequired,
} from "../auth.js";

const router = Router();

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    permissions: JSON.parse(u.permissions || "{}"),
    active: !!u.active,
  };
}

// POST /api/auth/register — cria conta. O primeiro usuário vira admin.
router.post("/register", (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Nome, e-mail e senha são obrigatórios." });
  }
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (exists) return res.status(409).json({ error: "E-mail já cadastrado." });

  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  const role = count === 0 ? "admin" : "member";
  const info = db
    .prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)")
    .run(name, email.toLowerCase(), hashPassword(password), role);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

// POST /api/auth/login
router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get((email || "").toLowerCase());
  if (!user || !verifyPassword(password || "", user.password_hash)) {
    return res.status(401).json({ error: "E-mail ou senha inválidos." });
  }
  if (!user.active) return res.status(403).json({ error: "Usuário desativado." });
  res.json({ token: signToken(user), user: publicUser(user) });
});

// GET /api/auth/me
router.get("/me", authRequired, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
  res.json(publicUser(user));
});

export default router;
export { publicUser };
