import { Router } from "express";
import { db } from "../db.js";
import { authRequired, adminRequired, hashPassword } from "../auth.js";
import { publicUser } from "./auth.js";

const router = Router();
router.use(authRequired);

// GET /api/users — lista completa do escritório (admin)
router.get("/", adminRequired, (req, res) => {
  const rows = db.prepare("SELECT * FROM users WHERE org_id = ? ORDER BY name").all(req.orgId);
  res.json(rows.map((u) => publicUser(u)));
});

// GET /api/users/team — lista enxuta para atribuição de tarefas
router.get("/team", (req, res) => {
  const rows = db
    .prepare("SELECT id, name, username, email, role, job_title, duties, can_approve FROM users WHERE active = 1 AND org_id = ? ORDER BY name")
    .all(req.orgId);
  res.json(rows.map((u) => ({ ...u, duties: u.duties ? JSON.parse(u.duties) : [], can_approve: !!u.can_approve })));
});

// POST /api/users — cria usuário no escritório (admin)
router.post("/", adminRequired, (req, res) => {
  const { name, username, password, email, role = "member" } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: "Nome, usuário e senha são obrigatórios." });
  }
  const exists = db
    .prepare("SELECT id FROM users WHERE lower(username) = lower(?) AND org_id = ?")
    .get(username.trim(), req.orgId);
  if (exists) return res.status(409).json({ error: "Já existe alguém com esse nome de usuário aqui." });

  // E-mail é interno (o login é por nome); gera um único se não vier.
  const finalEmail = (email || `${username.trim().toLowerCase()}.${req.orgId}@local`).toLowerCase();
  if (db.prepare("SELECT id FROM users WHERE email = ?").get(finalEmail)) {
    return res.status(409).json({ error: "E-mail já cadastrado." });
  }
  // Ninguém cria um superadmin por aqui — só o escritório master existe.
  const safeRole = role === "admin" ? "admin" : "member";
  const b = req.body || {};
  const info = db
    .prepare(`INSERT INTO users (name, username, email, password_hash, role, job_title, duties, can_approve, org_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, username.trim(), finalEmail, hashPassword(password), safeRole,
         b.job_title ?? null, JSON.stringify(Array.isArray(b.duties) ? b.duties : []),
         b.can_approve ? 1 : 0, req.orgId);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(publicUser(user));
});

// PUT /api/users/:id — atualiza dados básicos (admin)
router.put("/:id", adminRequired, (req, res) => {
  const { name, username, email, role, active, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

  const b = req.body || {};
  const next = {
    name: name ?? user.name,
    username: username ?? user.username,
    email: (email ?? user.email).toLowerCase(),
    role: user.role === "superadmin" ? "superadmin" : role === "admin" ? "admin" : role === "member" ? "member" : user.role,
    active: active === undefined ? user.active : active ? 1 : 0,
    password_hash: password ? hashPassword(password) : user.password_hash,
    job_title: b.job_title !== undefined ? b.job_title : user.job_title,
    duties: b.duties !== undefined ? JSON.stringify(Array.isArray(b.duties) ? b.duties : []) : user.duties,
    can_approve: b.can_approve !== undefined ? (b.can_approve ? 1 : 0) : user.can_approve,
    id: req.params.id,
    org_id: req.orgId,
  };
  db.prepare(
    `UPDATE users SET name = @name, username = @username, email = @email, role = @role,
     active = @active, password_hash = @password_hash, job_title = @job_title,
     duties = @duties, can_approve = @can_approve WHERE id = @id AND org_id = @org_id`
  ).run(next);

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  res.json(publicUser(updated));
});

// DELETE /api/users/:id (admin)
router.delete("/:id", adminRequired, (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: "Você não pode remover a si mesmo." });
  }
  db.prepare("DELETE FROM users WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

// GET /api/users/:id/permissions
router.get("/:id/permissions", adminRequired, (req, res) => {
  const user = db
    .prepare("SELECT permissions FROM users WHERE id = ? AND org_id = ?")
    .get(req.params.id, req.orgId);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
  res.json(JSON.parse(user.permissions || "{}"));
});

// PUT /api/users/:id/permissions
router.put("/:id/permissions", adminRequired, (req, res) => {
  const permissions = req.body || {};
  db.prepare("UPDATE users SET permissions = ? WHERE id = ? AND org_id = ?").run(
    JSON.stringify(permissions),
    req.params.id,
    req.orgId
  );
  res.json(permissions);
});

export default router;
