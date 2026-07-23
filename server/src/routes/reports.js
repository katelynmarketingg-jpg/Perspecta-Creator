import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";

const router = Router();
router.use(authRequired, moduleAllowed("relatorios"));

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

// GET /api/reports/attention — o que precisa de ação, em ordem de urgência.
// Sem isso, um post pode chegar na aprovação do cliente sem legenda nem arte.
router.get("/attention", (req, res) => {
  const org = req.orgId;
  const hoje = new Date().toISOString().slice(0, 10);

  const publicaHoje = db.prepare(`
    SELECT t.id, t.title, t.scheduled_at, c.name AS client_name
    FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
    WHERE t.org_id = ? AND date(t.scheduled_at) = ?
    ORDER BY t.scheduled_at`).all(org, hoje);

  const atrasadas = db.prepare(`
    SELECT t.id, t.title, t.due_date, c.name AS client_name, u.name AS assignee_name
    FROM tasks t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.org_id = ? AND t.completed_at IS NULL AND t.due_date IS NOT NULL AND t.due_date < ?
    ORDER BY t.due_date LIMIT 20`).all(org, hoje);

  // Parados na aprovação do cliente há mais de 3 dias.
  const esperandoCliente = db.prepare(`
    SELECT t.id, t.title, c.name AS client_name, t.updated_hint AS since
    FROM (SELECT *, created_at AS updated_hint FROM tasks) t
    LEFT JOIN clients c ON c.id = t.client_id
    JOIN kanban_stages s ON s.id = t.stage_id
    WHERE t.org_id = ? AND s.name LIKE '%Aprova%' AND t.approval_status = 'pending'
    ORDER BY t.created_at LIMIT 20`).all(org);

  const pediramAjuste = db.prepare(`
    SELECT t.id, t.title, t.client_note, c.name AS client_name
    FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
    WHERE t.org_id = ? AND t.approval_status = 'changes_requested'
    ORDER BY t.id DESC LIMIT 20`).all(org);

  // Conteúdo que vai travar mais para a frente: sem legenda, sem arte ou sem dono.
  const semLegenda = db.prepare(`
    SELECT t.id, t.title, c.name AS client_name
    FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
    WHERE t.org_id = ? AND t.content_type IS NOT NULL AND t.completed_at IS NULL
      AND (t.caption IS NULL OR t.caption = '')
    ORDER BY t.due_date LIMIT 20`).all(org);

  const semArte = db.prepare(`
    SELECT t.id, t.title, c.name AS client_name
    FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
    WHERE t.org_id = ? AND t.content_type IS NOT NULL AND t.completed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM task_attachments ta WHERE ta.task_id = t.id)
    ORDER BY t.due_date LIMIT 20`).all(org);

  const semResponsavel = db.prepare(`
    SELECT t.id, t.title, c.name AS client_name
    FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
    WHERE t.org_id = ? AND t.assignee_id IS NULL AND t.completed_at IS NULL
    ORDER BY t.due_date LIMIT 20`).all(org);

  const contasAtrasadas = db.prepare(`
    SELECT f.id, f.description, f.amount, f.due_date, c.name AS client_name
    FROM financial_entries f LEFT JOIN clients c ON c.id = f.client_id
    WHERE f.org_id = ? AND f.type = 'income' AND f.status = 'pending' AND f.due_date < ?
    ORDER BY f.due_date LIMIT 20`).all(org, hoje);

  res.json({
    publicaHoje, atrasadas, esperandoCliente, pediramAjuste,
    semLegenda, semArte, semResponsavel, contasAtrasadas,
  });
});

// GET /api/reports/planned-vs-delivered?month=YYYY-MM
// O contrato diz X posts e Y vídeos por mês. Isto mostra o que saiu de fato,
// para você saber se está entregando o combinado antes do cliente perguntar.
router.get("/planned-vs-delivered", (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const rows = db.prepare(`
    SELECT c.id, c.name AS client_name,
           COALESCE(c.posts_per_month, 0) AS posts_planejados,
           COALESCE(c.videos_per_month, 0) AS videos_planejados,
           (SELECT COUNT(*) FROM tasks t
             WHERE t.client_id = c.id AND t.org_id = c.org_id
               AND t.content_type IN ('post','foto')
               AND strftime('%Y-%m', t.scheduled_at) = @month) AS posts_entregues,
           (SELECT COUNT(*) FROM tasks t
             WHERE t.client_id = c.id AND t.org_id = c.org_id
               AND t.content_type IN ('reel','stories')
               AND strftime('%Y-%m', t.scheduled_at) = @month) AS videos_entregues,
           (SELECT COUNT(*) FROM tasks t
             WHERE t.client_id = c.id AND t.org_id = c.org_id
               AND strftime('%Y-%m', t.scheduled_at) = @month
               AND t.completed_at IS NULL) AS ainda_em_producao
    FROM clients c
    WHERE c.org_id = @org_id AND c.status = 'active'
      AND (COALESCE(c.posts_per_month,0) + COALESCE(c.videos_per_month,0)) > 0
    ORDER BY c.name
  `).all({ org_id: req.orgId, month });

  res.json(rows.map((r) => {
    const planejado = r.posts_planejados + r.videos_planejados;
    const entregue = r.posts_entregues + r.videos_entregues;
    return {
      ...r,
      planejado,
      entregue,
      falta: Math.max(planejado - entregue, 0),
      percentual: planejado ? Math.round((entregue / planejado) * 100) : 0,
    };
  }));
});

// GET /api/reports/deliveries?month=YYYY-MM — quanto falta de cada cliente.
// "Planejado" vem do plano configurável (plan_items); se não houver, dos
// campos antigos posts/vídeos do cliente.
router.get("/deliveries", (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const org = req.orgId;

  const clientes = db.prepare(`
    SELECT c.id, c.name FROM clients c WHERE c.org_id = ? AND c.status = 'active' ORDER BY c.name
  `).all(org);

  const out = clientes.map((c) => {
    // Planejado: soma das linhas do plano dos projetos do cliente.
    const planned = db.prepare(`
      SELECT COALESCE(SUM(pi.quantity), 0) AS n
      FROM plan_items pi JOIN projects p ON p.id = pi.project_id
      WHERE p.client_id = ? AND pi.org_id = ?
    `).get(c.id, org).n
      || (db.prepare("SELECT COALESCE(posts_per_month,0)+COALESCE(videos_per_month,0) AS n FROM clients WHERE id = ?").get(c.id).n);

    // Entregue: tarefas do cliente programadas para o mês.
    const total = db.prepare(`
      SELECT COUNT(*) AS n FROM tasks
      WHERE client_id = ? AND org_id = ? AND strftime('%Y-%m', scheduled_at) = ?
    `).get(c.id, org, month).n;
    const concluidas = db.prepare(`
      SELECT COUNT(*) AS n FROM tasks
      WHERE client_id = ? AND org_id = ? AND strftime('%Y-%m', scheduled_at) = ? AND completed_at IS NOT NULL
    `).get(c.id, org, month).n;
    const emProducao = db.prepare(`
      SELECT COUNT(*) AS n FROM tasks
      WHERE client_id = ? AND org_id = ? AND completed_at IS NULL
        AND (strftime('%Y-%m', scheduled_at) = ? OR strftime('%Y-%m', due_date) = ?)
    `).get(c.id, org, month, month).n;

    const base = planned || total || 0;
    return {
      id: c.id, client_name: c.name,
      planejado: planned, programadas: total, concluidas, em_producao: emProducao,
      percentual: base ? Math.min(100, Math.round((concluidas / base) * 100)) : 0,
      falta: Math.max(base - concluidas, 0),
    };
  }).filter((r) => r.planejado > 0 || r.programadas > 0);

  res.json(out);
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
