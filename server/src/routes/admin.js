import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { db } from "../db.js";
import { hashPassword } from "../auth.js";
import { seedOrgDefaults } from "./organizations.js";
import { computeUsage } from "../plans-monitor.js";

// ---------------------------------------------------------------------------
// Porta de serviço (máquina-a-máquina) para um painel central externo.
//
// Autentica por um TOKEN FIXO no cabeçalho X-Service-Token, comparado com a
// variável de ambiente SERVICE_TOKEN. NÃO usa login de humano (JWT).
//
// SEGURO POR PADRÃO: se SERVICE_TOKEN não estiver definido, a porta fica
// DESLIGADA (503) — não há token adivinhável nem default.
// ---------------------------------------------------------------------------
const router = Router();

function serviceAuth(req, res, next) {
  const expected = process.env.SERVICE_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: "Porta de serviço desligada. Defina SERVICE_TOKEN." });
  }
  const got = String(req.headers["x-service-token"] || "");
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  // Comparação de tempo constante (evita adivinhação por temporização).
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Token de serviço inválido." });
  }
  next();
}
router.use(serviceAuth);

// Cria a linha de usuário com senha em hash, cuidando da unicidade.
// Retorna { user } ou { error, status }.
function createUserRow({ org_id, name, username, password, email, role }) {
  const uname = String(username || "").trim();
  if (!uname || !password) return { error: "username e password são obrigatórios.", status: 400 };
  const papel = ["superadmin", "admin", "member"].includes(role) ? role : "member";
  const mail = email ? String(email).toLowerCase() : `${uname.toLowerCase()}@org${org_id}.local`;

  const dupUser = db.prepare("SELECT id FROM users WHERE lower(username) = lower(?) AND org_id = ?").get(uname, org_id);
  if (dupUser) return { error: "Já existe usuário com esse nome de acesso nesta empresa.", status: 409 };
  const dupMail = db.prepare("SELECT id FROM users WHERE email = ?").get(mail);
  if (dupMail) return { error: "E-mail já usado por outro usuário.", status: 409 };

  const info = db.prepare(
    `INSERT INTO users (name, username, email, password_hash, role, org_id) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(name || uname, uname, mail, hashPassword(password), papel, org_id);
  return { user: db.prepare("SELECT id, name, username, email, role, org_id FROM users WHERE id = ?").get(info.lastInsertRowid) };
}

// POST /api/admin/companies — cria empresa + (opcional) o primeiro admin.
router.post("/companies", (req, res) => {
  const { name, admin_username, admin_name, admin_password, notes, whatsapp, plan_id } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "name é obrigatório." });
  const nm = String(name).trim();
  if (db.prepare("SELECT id FROM organizations WHERE lower(name) = lower(?)").get(nm)) {
    return res.status(409).json({ error: "Já existe uma empresa com esse nome." });
  }

  const info = db.prepare(
    "INSERT INTO organizations (name, notes, whatsapp, plan_id, trial_ends) VALUES (?, ?, ?, ?, datetime('now', '+30 days'))"
  ).run(nm, notes ?? null, whatsapp ?? null, plan_id || null);
  const orgId = info.lastInsertRowid;
  seedOrgDefaults(orgId); // etapas do kanban + tipos de evento

  let admin = null;
  if (admin_username && admin_password) {
    const r = createUserRow({ org_id: orgId, name: admin_name, username: admin_username, password: admin_password, role: "admin" });
    if (r.error) return res.status(r.status).json({ error: r.error, company_id: orgId });
    admin = r.user;
  }

  res.status(201).json({
    company: db.prepare("SELECT id, name, plan_id, trial_ends, active FROM organizations WHERE id = ?").get(orgId),
    admin,
  });
});

// POST /api/admin/users — cria um usuário numa empresa existente.
router.post("/users", (req, res) => {
  const { org_id, name, username, password, email, role } = req.body || {};
  if (!org_id) return res.status(400).json({ error: "org_id é obrigatório." });
  if (!db.prepare("SELECT id FROM organizations WHERE id = ?").get(org_id)) {
    return res.status(404).json({ error: "Empresa não encontrada." });
  }
  const r = createUserRow({ org_id, name, username, password, email, role });
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.status(201).json({ user: r.user });
});

// PATCH /api/admin/users/:id — ativar/desativar (revogar) um login.
// Desativar corta o acesso na hora (login e sessões passam a ser negados).
router.patch("/users/:id", (req, res) => {
  const { active } = req.body || {};
  if (active === undefined) return res.status(400).json({ error: "Informe active (true/false)." });
  const u = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!u) return res.status(404).json({ error: "Usuário não encontrado." });
  db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active ? 1 : 0, req.params.id);
  res.json({ ok: true, id: Number(req.params.id), active: Boolean(active) });
});

// POST /api/admin/users/:id/reset-password — define nova senha (por padrão,
// força a pessoa a trocar no próximo login).
router.post("/users/:id/reset-password", (req, res) => {
  const { password, force_change } = req.body || {};
  if (!password || String(password).length < 4) {
    return res.status(400).json({ error: "password (mínimo 4 caracteres) é obrigatório." });
  }
  const u = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!u) return res.status(404).json({ error: "Usuário não encontrado." });
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?")
    .run(hashPassword(password), force_change === false ? 0 : 1, req.params.id);
  res.json({ ok: true });
});

// PATCH /api/admin/companies/:id — ativar/desativar uma empresa.
router.patch("/companies/:id", (req, res) => {
  const { active } = req.body || {};
  if (active === undefined) return res.status(400).json({ error: "Informe active (true/false)." });
  const o = db.prepare("SELECT id, is_master FROM organizations WHERE id = ?").get(req.params.id);
  if (!o) return res.status(404).json({ error: "Empresa não encontrada." });
  if (o.is_master) return res.status(400).json({ error: "Não é possível desativar a empresa master." });
  db.prepare("UPDATE organizations SET active = ? WHERE id = ?").run(active ? 1 : 0, req.params.id);
  res.json({ ok: true, id: Number(req.params.id), active: Boolean(active) });
});

// GET /api/admin/usage — uso e limites por empresa (para o painel de custos).
router.get("/usage", (req, res) => {
  const orgs = db.prepare(`
    SELECT o.id, o.name, o.is_master, o.active, o.billing_active,
           p.name AS plan_name, p.price AS plan_price,
           p.max_users, p.max_clients, p.storage_gb,
           CAST(julianday(o.trial_ends) - julianday('now') AS INTEGER) AS trial_days_left
    FROM organizations o LEFT JOIN saas_plans p ON p.id = o.plan_id
    ORDER BY o.is_master DESC, o.name
  `).all();

  res.json(orgs.map((o) => {
    const u = computeUsage(o.id);
    return {
      company_id: o.id,
      company: o.name,
      is_master: Boolean(o.is_master),
      active: Boolean(o.active),
      subscription: o.is_master ? "master"
        : o.billing_active ? "pagante"
        : (o.trial_days_left != null && o.trial_days_left >= 0) ? "teste"
        : "expirado",
      plan: o.plan_name || null,
      plan_price: o.plan_price ?? null,
      usage: { users: u.users, clients: u.clients, storage_gb: u.storage_gb },
      limits: { users: o.max_users ?? null, clients: o.max_clients ?? null, storage_gb: o.storage_gb ?? null },
    };
  }));
});

export default router;
