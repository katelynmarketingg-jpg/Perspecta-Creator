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
    SELECT t.id, t.title, t.due_date, t.ref_month, t.scheduled_at, t.priority, c.name AS client_name
    FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
    WHERE t.org_id = ? AND t.assignee_id = ? AND t.completed_at IS NULL
    ORDER BY COALESCE(t.scheduled_at, t.due_date, t.ref_month || '-31') LIMIT 10`).all(org, req.user.id);

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
           -- O BÔNUS FICA DE FORA DA ENTREGA DO CONTRATO. Contado junto, ele
           -- inflaria o número e esconderia um post do combinado que faltou.
           (SELECT COUNT(*) FROM tasks t
             WHERE t.client_id = c.id AND t.org_id = c.org_id
               AND t.content_type IN ('post','foto')
               AND COALESCE(t.bonus, 0) = 0
               AND strftime('%Y-%m', t.scheduled_at) = @month) AS posts_entregues,
           (SELECT COUNT(*) FROM tasks t
             WHERE t.client_id = c.id AND t.org_id = c.org_id
               AND t.content_type IN ('reel','stories')
               AND COALESCE(t.bonus, 0) = 0
               AND strftime('%Y-%m', t.scheduled_at) = @month) AS videos_entregues,
           (SELECT COUNT(*) FROM tasks t
             WHERE t.client_id = c.id AND t.org_id = c.org_id
               AND COALESCE(t.bonus, 0) = 1
               AND strftime('%Y-%m', t.scheduled_at) = @month) AS bonus_entregues,
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

// ---------------------------------------------------------------------------
// GET /api/reports/deliveries?month=YYYY-MM — o que foi entregue no mês.
//
// Três coisas que ela pediu, e que mudam o que esta conta significa:
//
// 1. "CONFIRA SE ESTÁ REALMENTE INTERLIGADO COM A QUANTIDADE QUE TEM NO
//    PROJETO." O planejado vem de plan_items (as linhas do plano mensal do
//    projeto), agora só dos projetos VIVOS: um projeto encerrado continuava
//    somando e inflava o que faltava para sempre.
//
// 2. "SÓ VAI FICAR CONCLUÍDO O QUE JÁ ESTÁ PROGRAMADO." Antes a barra enchia
//    com qualquer peça que tivesse data no mês, mesmo parada em Criação —
//    marcar a data é intenção, não entrega. Agora só conta a peça que está na
//    etapa final (Programados), que é o que a Rafa faz quando a peça está de
//    fato pronta e marcada.
//
// 3. "UMA LINHA PARA POST, UMA PARA CARROSSEL, UMA PARA REEL." A conta passa a
//    ser POR TIPO, e o total é a soma delas. Sem isso, "faltam 6" não dizia
//    faltam 6 do quê — e é o tipo que decide quem produz.
//
// E uma correção que ninguém tinha visto: a tarefa criada pelo "Lançar mês"
// nasce AGRUPADA (quantity = 4 numa linha só) e só se abre em peças
// individuais quando chega na Distribuição. Contando linhas, quatro reels
// valiam um. Agora se soma a quantidade, não as linhas.
// ---------------------------------------------------------------------------

/** Rótulo de cada tipo — o mesmo vocabulário da tela de Tarefas. */
const ROTULO_DO_TIPO = {
  post: "Post", carrossel: "Carrossel", reel: "Reel", foto: "Foto",
  captacao: "Captação", stories: "Stories", reuniao: "Reunião",
  arte: "Arte / Design", legenda: "Legenda", trafego: "Tráfego", outro: "Outro",
};
const rotuloDoTipo = (t) => ROTULO_DO_TIPO[t] || (t ? t[0].toUpperCase() + t.slice(1) : "Sem tipo");

router.get("/deliveries", (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const org = req.orgId;

  const clientes = db.prepare(
    "SELECT c.id, c.name FROM clients c WHERE c.org_id = ? AND c.status = 'active' ORDER BY c.name"
  ).all(org);

  // O PLANO, POR TIPO. Só de projeto que está valendo: encerrado não cobra, e
  // projeto com prazo definido só conta nos meses dentro do prazo.
  const planoPorTipo = db.prepare(`
    SELECT p.client_id, pi.content_type, SUM(pi.quantity) AS n
      FROM plan_items pi
      JOIN projects p ON p.id = pi.project_id
     WHERE pi.org_id = @org
       AND p.status <> 'done'
       AND (p.start_date IS NULL OR strftime('%Y-%m', p.start_date) <= @mes)
       AND (p.end_date   IS NULL OR strftime('%Y-%m', p.end_date)   >= @mes)
     GROUP BY p.client_id, pi.content_type
  `).all({ org, mes: month });

  // ENTREGUE = na etapa final E com data no mês. As duas coisas: a data sem a
  // etapa é promessa, e a etapa sem data o quadro nem deixa acontecer.
  const entreguePorTipo = db.prepare(`
    SELECT t.client_id, t.content_type, SUM(COALESCE(t.quantity, 1)) AS n
      FROM tasks t
     WHERE t.org_id = @org
       AND t.completed_at IS NOT NULL
       AND strftime('%Y-%m', t.scheduled_at) = @mes
     GROUP BY t.client_id, t.content_type
  `).all({ org, mes: month });

  // EM PRODUÇÃO: a peça do mês que ainda não chegou lá. O mês dela é o de
  // referência (produção do mês), a data marcada ou o prazo — nessa ordem.
  const producaoPorTipo = db.prepare(`
    SELECT t.client_id, t.content_type, SUM(COALESCE(t.quantity, 1)) AS n
      FROM tasks t
     WHERE t.org_id = @org
       AND t.completed_at IS NULL
       AND (t.ref_month = @mes
            OR strftime('%Y-%m', t.scheduled_at) = @mes
            OR strftime('%Y-%m', t.due_date) = @mes)
     GROUP BY t.client_id, t.content_type
  `).all({ org, mes: month });

  const porCliente = (linhas) => {
    const m = new Map();
    for (const l of linhas) {
      if (!m.has(l.client_id)) m.set(l.client_id, new Map());
      m.get(l.client_id).set(l.content_type || "outro", Number(l.n) || 0);
    }
    return m;
  };
  const plano = porCliente(planoPorTipo);
  const entregue = porCliente(entreguePorTipo);
  const producao = porCliente(producaoPorTipo);

  const out = clientes.map((c) => {
    const pl = plano.get(c.id) || new Map();
    const en = entregue.get(c.id) || new Map();
    const pr = producao.get(c.id) || new Map();

    // Todo tipo que aparece em qualquer uma das três contas vira uma linha —
    // inclusive o que foi entregue sem estar no plano, que é informação.
    const tipos = [...new Set([...pl.keys(), ...en.keys(), ...pr.keys()])]
      .map((t) => {
        const planejado = pl.get(t) || 0;
        const feito = en.get(t) || 0;
        return {
          content_type: t,
          label: rotuloDoTipo(t),
          planejado,
          entregue: feito,
          em_producao: pr.get(t) || 0,
          falta: Math.max(planejado - feito, 0),
          fora_do_plano: planejado === 0,
          percentual: planejado ? Math.min(100, Math.round((feito / planejado) * 100)) : (feito ? 100 : 0),
        };
      })
      .sort((a, b) => (b.planejado - a.planejado) || a.label.localeCompare(b.label, "pt-BR"));

    const planejado = tipos.reduce((s, t) => s + t.planejado, 0);
    const entregues = tipos.reduce((s, t) => s + t.entregue, 0);
    const emProducao = tipos.reduce((s, t) => s + t.em_producao, 0);
    const base = planejado || entregues;

    return {
      id: c.id, client_name: c.name,
      planejado, entregues, programadas: entregues,
      em_producao: emProducao,
      // O que falta é a soma do que falta EM CADA TIPO: entregar reel a mais
      // não cobre o post que não saiu.
      falta: tipos.reduce((s, t) => s + t.falta, 0),
      percentual: base ? Math.min(100, Math.round((entregues / base) * 100)) : 0,
      tipos,
    };
  }).filter((r) => r.planejado > 0 || r.entregues > 0 || r.em_producao > 0);

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

// GET /api/reports/prospects — funil de prospecção e conversão.
router.get("/prospects", (req, res) => {
  const org = req.orgId;
  const funnel = db.prepare(
    "SELECT status, COUNT(*) AS total FROM prospects WHERE org_id = ? GROUP BY status"
  ).all(org);
  const byMonth = db.prepare(`
    SELECT strftime('%Y-%m', created_at) AS month,
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'fechado' THEN 1 ELSE 0 END) AS won
    FROM prospects WHERE org_id = ? AND created_at >= date('now','-12 months')
    GROUP BY month ORDER BY month`).all(org);
  const map = Object.fromEntries(funnel.map((f) => [f.status, f.total]));
  const fechado = map.fechado || 0, perdido = map.perdido || 0;
  res.json({
    funnel, byMonth,
    total: funnel.reduce((a, f) => a + f.total, 0),
    conversion: (fechado + perdido) ? Math.round((fechado / (fechado + perdido)) * 100) : 0,
  });
});

// GET /api/reports/approvals — status dos conteúdos na aprovação do cliente.
router.get("/approvals", (req, res) => {
  const org = req.orgId;
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN approval_status = 'sent' THEN 1 ELSE 0 END) AS aguardando,
      SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) AS aprovados,
      SUM(CASE WHEN approval_status = 'changes_requested' THEN 1 ELSE 0 END) AS ajustes
    FROM tasks WHERE org_id = ? AND content_type IS NOT NULL`).get(org);
  res.json({
    aguardando: row.aguardando || 0,
    aprovados: row.aprovados || 0,
    ajustes: row.ajustes || 0,
  });
});

// GET /api/reports/income-status — previsto × recebido por mês (12 meses).
router.get("/income-status", (req, res) => {
  res.json(db.prepare(`
    SELECT strftime('%Y-%m', COALESCE(due_date, created_at)) AS month,
           COALESCE(SUM(amount),0) AS previsto,
           COALESCE(SUM(CASE WHEN status='paid' THEN amount END),0) AS recebido
    FROM financial_entries
    WHERE org_id = ? AND type = 'income'
      AND COALESCE(due_date, created_at) >= date('now','-12 months')
    GROUP BY month ORDER BY month`).all(req.orgId));
});

// GET /api/reports/receivables — contas a receber em atraso (e o total em aberto).
router.get("/receivables", (req, res) => {
  const org = req.orgId;
  const hoje = new Date().toISOString().slice(0, 10);
  const atrasadas = db.prepare(`
    SELECT f.id, f.description, f.amount, f.due_date, c.name AS client_name
    FROM financial_entries f LEFT JOIN clients c ON c.id = f.client_id
    WHERE f.org_id = ? AND f.type = 'income' AND f.status = 'pending' AND f.due_date < ?
    ORDER BY f.due_date`).all(org, hoje);
  const aberto = db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE org_id = ? AND type='income' AND status='pending'"
  ).get(org).v;
  res.json({
    atrasadas,
    totalAtrasado: atrasadas.reduce((a, r) => a + r.amount, 0),
    totalEmAberto: aberto,
  });
});

// GET /api/reports/content-by-type — quantas peças de cada tipo de conteúdo.
router.get("/content-by-type", (req, res) => {
  res.json(db.prepare(`
    SELECT content_type, COUNT(*) AS total
    FROM tasks WHERE org_id = ? AND content_type IS NOT NULL
    GROUP BY content_type ORDER BY total DESC`).all(req.orgId));
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
