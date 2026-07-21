import { Router } from "express";
import { db } from "../db.js";
import { verifyPassword, signToken, authRequired } from "../auth.js";

const router = Router();

function publicUser(u, org) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email,
    role: u.role,
    permissions: JSON.parse(u.permissions || "{}"),
    active: !!u.active,
    org_id: u.org_id,
    org_name: org?.name || null,
    is_master: !!org?.is_master,
  };
}

// POST /api/auth/login — entra com escritório + nome + senha.
router.post("/login", (req, res) => {
  const { organization, username, password } = req.body || {};
  if (!organization || !username) {
    return res.status(400).json({ error: "Informe o escritório e o seu nome." });
  }

  const org = db
    .prepare("SELECT * FROM organizations WHERE lower(name) = lower(?)")
    .get(organization.trim());
  if (!org) return res.status(401).json({ error: "Escritório, nome ou senha inválidos." });
  if (!org.active) return res.status(403).json({ error: "Escritório desativado." });

  const user = db
    .prepare("SELECT * FROM users WHERE lower(username) = lower(?) AND org_id = ?")
    .get(username.trim(), org.id);
  if (!user || !verifyPassword(password || "", user.password_hash)) {
    return res.status(401).json({ error: "Escritório, nome ou senha inválidos." });
  }
  if (!user.active) return res.status(403).json({ error: "Usuário desativado." });

  res.json({ token: signToken(user), user: publicUser(user, org) });
});

// GET /api/auth/me
router.get("/me", authRequired, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
  const org = db.prepare("SELECT * FROM organizations WHERE id = ?").get(user.org_id);
  res.json(publicUser(user, org));
});

export default router;
export { publicUser };
