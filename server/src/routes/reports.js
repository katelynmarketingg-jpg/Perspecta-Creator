import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();
router.use(authRequired);

// GET /api/reports/dashboard — números do painel inicial
router.get("/dashboard", (req, res) => {
  const clients = db.prepare("SELECT COUNT(*) AS n FROM clients WHERE status='active'").get().n;
  const activeProjects = db.prepare("SELECT COUNT(*) AS n FROM projects WHERE status='active'").get().n;
  const doneProjects = db.prepare("SELECT COUNT(*) AS n FROM projects WHERE status='done'").get().n;
  const pendingTasks = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE completed_at IS NULL").get().n;
  const doneTasks = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE completed_at IS NOT NULL").get().n;
  const income = db.prepare("SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE type='income'").get().v;
  const expense = db.prepare("SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE type='expense'").get().v;

  const myTasks = db.prepare(`
    SELECT t.id, t.title, t.due_date, t.priority, c.name AS client_name
    FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
    WHERE t.assignee_id = ? AND t.completed_at IS NULL
    ORDER BY t.due_date LIMIT 10`).all(req.user.id);

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
    WHERE f.type='income'
    GROUP BY f.client_id ORDER BY total DESC`).all());
});

// GET /api/reports/billing-by-month
router.get("/billing-by-month", (req, res) => {
  res.json(db.prepare(`
    SELECT strftime('%Y-%m', COALESCE(due_date, created_at)) AS month,
           COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
           COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
    FROM financial_entries
    GROUP BY month ORDER BY month DESC LIMIT 12`).all());
});

// GET /api/reports/tasks-by-user
router.get("/tasks-by-user", (req, res) => {
  res.json(db.prepare(`
    SELECT u.name AS user_name,
           COUNT(t.id) AS total,
           SUM(CASE WHEN t.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done,
           SUM(CASE WHEN t.completed_at IS NULL THEN 1 ELSE 0 END) AS pending
    FROM users u LEFT JOIN tasks t ON t.assignee_id = u.id
    GROUP BY u.id ORDER BY total DESC`).all());
});

// GET /api/reports/tasks-by-month — criadas vs concluídas, últimos 12 meses
router.get("/tasks-by-month", (req, res) => {
  res.json(db.prepare(`
    SELECT strftime('%Y-%m', created_at) AS month,
           COUNT(*) AS created,
           SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done
    FROM tasks
    WHERE created_at >= date('now', '-12 months')
    GROUP BY month ORDER BY month`).all());
});

// GET /api/reports/tasks-by-weekday — carga por dia da semana (0=domingo)
router.get("/tasks-by-weekday", (req, res) => {
  res.json(db.prepare(`
    SELECT CAST(strftime('%w', COALESCE(scheduled_at, due_date, created_at)) AS INTEGER) AS weekday,
           COUNT(*) AS total
    FROM tasks GROUP BY weekday ORDER BY weekday`).all());
});

// GET /api/reports/tasks-by-monthday — carga por dia do mês
router.get("/tasks-by-monthday", (req, res) => {
  res.json(db.prepare(`
    SELECT CAST(strftime('%d', COALESCE(scheduled_at, due_date, created_at)) AS INTEGER) AS day,
           COUNT(*) AS total
    FROM tasks GROUP BY day ORDER BY day`).all());
});

// GET /api/reports/new-clients-by-month — clientes novos por mês
router.get("/new-clients-by-month", (req, res) => {
  res.json(db.prepare(`
    SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS total
    FROM clients
    WHERE created_at >= date('now', '-12 months')
    GROUP BY month ORDER BY month`).all());
});

// GET /api/reports/client-dashboard?client_id=
router.get("/client-dashboard", (req, res) => {
  const id = req.query.client_id;
  if (!id) return res.status(400).json({ error: "client_id é obrigatório." });
  const income = db.prepare("SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE type='income' AND client_id=?").get(id).v;
  const expense = db.prepare("SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE type='expense' AND client_id=?").get(id).v;
  const projects = db.prepare("SELECT COUNT(*) AS n FROM projects WHERE client_id=?").get(id).n;
  const tasks = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE client_id=?").get(id).n;
  const doneTasks = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE client_id=? AND completed_at IS NOT NULL").get(id).n;
  res.json({ income, expense, profit: income - expense, projects, tasks, doneTasks });
});

export default router;
