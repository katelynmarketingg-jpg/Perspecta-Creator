import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();
router.use(authRequired);

// GET /api/reports/dashboard — números do painel inicial
router.get("/dashboard", (req, res) => {
  const org = req.orgId;
  const count = (sql) => db.prepare(sql).get(org).n;
  const sum = (sql) => db.prepare(sql).get(org).v;

  const clients = count("SELECT COUNT(*) AS n FROM clients WHERE org_id=? AND status='active'");
  const activeProjects = count("SELECT COUNT(*) AS n FROM projects WHERE org_id=? AND status='active'");
  const doneProjects = count("SELECT COUNT(*) AS n FROM projects WHERE org_id=? AND status='done'");
  const pendingTasks = count("SELECT COUNT(*) AS n FROM tasks WHERE org_id=? AND completed_at IS NULL");
  const doneTasks = count("SELECT COUNT(*) AS n FROM tasks WHERE org_id=? AND completed_at IS NOT NULL");
  const income = sum("SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE org_id=? AND type='income'");
  const expense = sum("SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE org_id=? AND type='expense'");

  const myTasks = db.prepare(`
    SELECT t.id, t.title, t.due_date, t.priority, c.name AS client_name
    FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
    WHERE t.org_id = ? AND t.assignee_id = ? AND t.completed_at IS NULL
    ORDER BY t.due_date LIMIT 10`).all(org, req.user.id);

  res.json({
    clients, activeProjects, doneProjects, pendingTasks, doneTasks,
    income, expense, profit: income - expense, myTasks,
  });
});

// GET /api/reports/billing-by-client
router.get("/billing-by-client", (req, res) => {
  res.json(db.prepare(`
    SELECT COALESCE(c.name, 'Sem cliente') AS client_name,
           COALESCE(SUM(f.amount),0) AS total
    FROM financial_entries f LEFT JOIN clients c ON c.id = f.client_id
    WHERE f.org_id = ? AND f.type='income'
    GROUP BY f.client_id ORDER BY total DESC`).all(req.orgId));
});

// GET /api/reports/billing-by-month
router.get("/billing-by-month", (req, res) => {
  res.json(db.prepare(`
    SELECT strftime('%Y-%m', COALESCE(due_date, created_at)) AS month,
           COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
           COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
    FROM financial_entries
    WHERE org_id = ?
    GROUP BY month ORDER BY month DESC LIMIT 12`).all(req.orgId));
});

// GET /api/reports/tasks-by-user
router.get("/tasks-by-user", (req, res) => {
  res.json(db.prepare(`
    SELECT u.name AS user_name,
           COUNT(t.id) AS total,
           SUM(CASE WHEN t.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done,
           SUM(CASE WHEN t.completed_at IS NULL THEN 1 ELSE 0 END) AS pending
    FROM users u LEFT JOIN tasks t ON t.assignee_id = u.id AND t.org_id = @org_id
    WHERE u.org_id = @org_id
    GROUP BY u.id ORDER BY total DESC`).all({ org_id: req.orgId }));
});

// GET /api/reports/tasks-by-month — criadas vs concluídas, últimos 12 meses
router.get("/tasks-by-month", (req, res) => {
  res.json(db.prepare(`
    SELECT strftime('%Y-%m', created_at) AS month,
           COUNT(*) AS created,
           SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done
    FROM tasks
    WHERE org_id = ? AND created_at >= date('now', '-12 months')
    GROUP BY month ORDER BY month`).all(req.orgId));
});

// GET /api/reports/tasks-by-weekday — carga por dia da semana (0=domingo)
router.get("/tasks-by-weekday", (req, res) => {
  res.json(db.prepare(`
    SELECT CAST(strftime('%w', COALESCE(scheduled_at, due_date, created_at)) AS INTEGER) AS weekday,
           COUNT(*) AS total
    FROM tasks WHERE org_id = ? GROUP BY weekday ORDER BY weekday`).all(req.orgId));
});

// GET /api/reports/tasks-by-monthday — carga por dia do mês
router.get("/tasks-by-monthday", (req, res) => {
  res.json(db.prepare(`
    SELECT CAST(strftime('%d', COALESCE(scheduled_at, due_date, created_at)) AS INTEGER) AS day,
           COUNT(*) AS total
    FROM tasks WHERE org_id = ? GROUP BY day ORDER BY day`).all(req.orgId));
});

// GET /api/reports/new-clients-by-month — clientes novos por mês
router.get("/new-clients-by-month", (req, res) => {
  res.json(db.prepare(`
    SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS total
    FROM clients
    WHERE org_id = ? AND created_at >= date('now', '-12 months')
    GROUP BY month ORDER BY month`).all(req.orgId));
});

// GET /api/reports/client-dashboard?client_id=
router.get("/client-dashboard", (req, res) => {
  const id = req.query.client_id;
  if (!id) return res.status(400).json({ error: "client_id é obrigatório." });
  const org = req.orgId;
  const one = (sql, key) => db.prepare(sql).get(id, org)[key];

  const income = one("SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE client_id=? AND org_id=? AND type='income'", "v");
  const expense = one("SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE client_id=? AND org_id=? AND type='expense'", "v");
  const projects = one("SELECT COUNT(*) AS n FROM projects WHERE client_id=? AND org_id=?", "n");
  const tasks = one("SELECT COUNT(*) AS n FROM tasks WHERE client_id=? AND org_id=?", "n");
  const doneTasks = one("SELECT COUNT(*) AS n FROM tasks WHERE client_id=? AND org_id=? AND completed_at IS NOT NULL", "n");
  res.json({ income, expense, profit: income - expense, projects, tasks, doneTasks });
});

export default router;
