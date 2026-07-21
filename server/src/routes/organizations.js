import { Router } from "express";
import { db } from "../db.js";
import { authRequired, superadminRequired, hashPassword } from "../auth.js";

const router = Router();
router.use(authRequired, superadminRequired);

// GET /api/organizations — todos os escritórios com o tamanho de cada um.
router.get("/", (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*,
              (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS users_count,
              (SELECT COUNT(*) FROM clients c WHERE c.org_id = o.id AND c.status = 'active') AS clients_count,
              (SELECT COUNT(*) FROM tasks t WHERE t.org_id = o.id) AS tasks_count,
              (SELECT COALESCE(SUM(f.amount), 0) FROM financial_entries f
                 WHERE f.org_id = o.id AND f.type = 'income' AND f.status = 'paid') AS revenue
       FROM organizations o
       ORDER BY o.is_master DESC, o.name`
    )
    .all();
  res.json(rows);
});

// POST /api/organizations — cadastra um escritório novo com o primeiro acesso.
router.post("/", (req, res) => {
  const { name, admin_username, admin_name, admin_password, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: "Nome do escritório é obrigatório." });
  const exists = db.prepare("SELECT id FROM organizations WHERE lower(name) = lower(?)").get(name.trim());
  if (exists) return res.status(409).json({ error: "Já existe um escritório com esse nome." });

  const info = db
    .prepare("INSERT INTO organizations (name, notes) VALUES (?, ?)")
    .run(name.trim(), notes ?? null);
  const orgId = info.lastInsertRowid;

  if (admin_username && admin_password) {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    db.prepare(
      `INSERT INTO users (name, username, email, password_hash, role, org_id)
       VALUES (?, ?, ?, ?, 'admin', ?)`
    ).run(
      admin_name || admin_username,
      admin_username.trim(),
      `${admin_username.trim().toLowerCase()}@${slug}.local`,
      hashPassword(admin_password),
      orgId
    );
    // Etapas do kanban para o escritório começar a trabalhar.
    const stages = [["A fazer", 0, 0], ["Em andamento", 1, 0], ["Aprovação", 2, 0], ["Programação", 3, 0], ["Concluído", 4, 1]];
    const ins = db.prepare("INSERT INTO kanban_stages (name, position, is_done, org_id) VALUES (?, ?, ?, ?)");
    stages.forEach((s) => ins.run(...s, orgId));
  }

  res.status(201).json(db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM organizations WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "Escritório não encontrado." });
  const b = req.body || {};
  db.prepare("UPDATE organizations SET name = ?, active = ?, notes = ? WHERE id = ?").run(
    b.name ?? cur.name,
    b.active === undefined ? cur.active : b.active ? 1 : 0,
    b.notes !== undefined ? b.notes : cur.notes,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM organizations WHERE id = ?").get(req.params.id));
});

router.delete("/:id", (req, res) => {
  const org = db.prepare("SELECT * FROM organizations WHERE id = ?").get(req.params.id);
  if (org?.is_master) return res.status(400).json({ error: "O escritório master não pode ser excluído." });
  db.prepare("DELETE FROM organizations WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
