import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();

// Para o cronômetro de uma tarefa e registra o tempo decorrido em time_entries.
// Usado ao clicar "Parar" e também quando a tarefa muda de etapa (auto-finaliza).
export function stopTimersForTask(taskId, orgId, userId = null) {
  const cond = userId ? "task_id = ? AND org_id = ? AND user_id = ?" : "task_id = ? AND org_id = ?";
  const args = userId ? [taskId, orgId, userId] : [taskId, orgId];
  const timers = db.prepare(`SELECT * FROM active_timers WHERE ${cond}`).all(...args);
  if (!timers.length) return [];
  const task = db.prepare("SELECT client_id FROM tasks WHERE id = ?").get(taskId);
  const ins = db.prepare(
    `INSERT INTO time_entries (org_id, task_id, client_id, user_id, minutes, note)
     VALUES (?, ?, ?, ?, ?, 'Cronômetro')`
  );
  const del = db.prepare("DELETE FROM active_timers WHERE id = ?");
  const out = [];
  timers.forEach((t) => {
    const ms = Date.now() - new Date(t.started_at.replace(" ", "T") + "Z").getTime();
    const minutes = Math.max(1, Math.round(ms / 60000));
    ins.run(t.org_id, t.task_id, task?.client_id ?? null, t.user_id, minutes);
    del.run(t.id);
    out.push({ task_id: taskId, minutes });
  });
  return out;
}

router.use(authRequired);

// POST /api/time/start { task_id } — começa a marcar o tempo da tarefa.
router.post("/start", (req, res) => {
  const taskId = req.body?.task_id;
  const task = db.prepare("SELECT id FROM tasks WHERE id = ? AND org_id = ?").get(taskId, req.orgId);
  if (!task) return res.status(404).json({ error: "Tarefa não encontrada." });
  const existe = db.prepare("SELECT * FROM active_timers WHERE task_id = ? AND user_id = ?").get(taskId, req.user.id);
  if (existe) return res.json(existe); // já rodando — idempotente
  const info = db.prepare("INSERT INTO active_timers (org_id, task_id, user_id) VALUES (?, ?, ?)")
    .run(req.orgId, taskId, req.user.id);
  res.status(201).json(db.prepare("SELECT * FROM active_timers WHERE id = ?").get(info.lastInsertRowid));
});

// POST /api/time/stop { task_id } — para e registra o tempo.
router.post("/stop", (req, res) => {
  const feito = stopTimersForTask(req.body?.task_id, req.orgId, req.user.id);
  res.json({ stopped: feito.length, entries: feito });
});

// GET /api/time/active — cronômetros em andamento do usuário (para o relógio ao vivo).
router.get("/active", (req, res) => {
  res.json(db.prepare("SELECT * FROM active_timers WHERE org_id = ? AND user_id = ?").all(req.orgId, req.user.id));
});

// ---- Sessão de trabalho POR CLIENTE ----------------------------------------

// GET /api/time/session — a sessão em andamento do usuário (ou null).
router.get("/session", (req, res) => {
  const s = db.prepare(
    `SELECT ws.*, c.name AS client_name FROM work_sessions ws
     LEFT JOIN clients c ON c.id = ws.client_id
     WHERE ws.user_id = ? AND ws.org_id = ? AND ws.ended_at IS NULL
     ORDER BY ws.id DESC LIMIT 1`
  ).get(req.user.id, req.orgId);
  res.json(s || null);
});

// POST /api/time/session/start { client_id } — começa a marcar o tempo do cliente.
router.post("/session/start", (req, res) => {
  const clientId = req.body?.client_id || null;
  if (clientId) {
    const c = db.prepare("SELECT id FROM clients WHERE id = ? AND org_id = ?").get(clientId, req.orgId);
    if (!c) return res.status(404).json({ error: "Cliente não encontrado." });
  }
  // Uma sessão por vez: se já houver uma aberta, devolve ela.
  const aberta = db.prepare("SELECT id FROM work_sessions WHERE user_id = ? AND org_id = ? AND ended_at IS NULL")
    .get(req.user.id, req.orgId);
  if (aberta) {
    return res.json(db.prepare(
      `SELECT ws.*, c.name AS client_name FROM work_sessions ws LEFT JOIN clients c ON c.id = ws.client_id WHERE ws.id = ?`
    ).get(aberta.id));
  }
  const info = db.prepare("INSERT INTO work_sessions (org_id, user_id, client_id) VALUES (?, ?, ?)")
    .run(req.orgId, req.user.id, clientId);
  res.status(201).json(db.prepare(
    `SELECT ws.*, c.name AS client_name FROM work_sessions ws LEFT JOIN clients c ON c.id = ws.client_id WHERE ws.id = ?`
  ).get(info.lastInsertRowid));
});

// POST /api/time/session/stop { task_ids? } — finaliza e registra o tempo + nº de tarefas.
router.post("/session/stop", (req, res) => {
  const s = db.prepare("SELECT * FROM work_sessions WHERE user_id = ? AND org_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1")
    .get(req.user.id, req.orgId);
  if (!s) return res.status(404).json({ error: "Nenhuma sessão em andamento." });
  const taskIds = Array.isArray(req.body?.task_ids) ? req.body.task_ids : [];
  const ms = Date.now() - new Date(s.started_at.replace(" ", "T") + "Z").getTime();
  const minutes = Math.max(1, Math.round(ms / 60000));

  db.prepare("UPDATE work_sessions SET ended_at = datetime('now'), minutes = ?, tasks_done = ? WHERE id = ?")
    .run(minutes, taskIds.length, s.id);
  // Lança o tempo no relatório, vinculado ao cliente.
  db.prepare(
    `INSERT INTO time_entries (org_id, task_id, client_id, user_id, minutes, note)
     VALUES (?, NULL, ?, ?, ?, ?)`
  ).run(req.orgId, s.client_id, req.user.id, minutes, `Sessão — ${taskIds.length} tarefa(s)`);

  res.json({ minutes, tasks_done: taskIds.length, client_id: s.client_id });
});

// POST /api/time — aponta tempo numa tarefa.
router.post("/", (req, res) => {
  const b = req.body || {};
  const minutes = Number(b.minutes) || 0;
  if (minutes <= 0) return res.status(400).json({ error: "Informe quantos minutos." });

  let clientId = b.client_id ?? null;
  if (b.task_id) {
    const task = db.prepare("SELECT client_id FROM tasks WHERE id = ? AND org_id = ?").get(b.task_id, req.orgId);
    if (!task) return res.status(404).json({ error: "Tarefa não encontrada." });
    clientId = clientId ?? task.client_id;
  }

  const info = db
    .prepare(
      `INSERT INTO time_entries (org_id, task_id, client_id, user_id, minutes, note, entry_date)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, date('now')))`
    )
    .run(req.orgId, b.task_id ?? null, clientId, req.user.id, minutes, b.note ?? null, b.entry_date ?? null);
  res.status(201).json(db.prepare("SELECT * FROM time_entries WHERE id = ?").get(info.lastInsertRowid));
});

// GET /api/time/task/:taskId — apontamentos de uma tarefa.
router.get("/task/:taskId", (req, res) => {
  res.json(
    db.prepare(
      `SELECT te.*, u.name AS user_name FROM time_entries te
       LEFT JOIN users u ON u.id = te.user_id
       WHERE te.task_id = ? AND te.org_id = ? ORDER BY te.entry_date DESC, te.id DESC`
    ).all(req.params.taskId, req.orgId)
  );
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM time_entries WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

// GET /api/time/summary?from=&to=  (ou ?month=YYYY-MM)
// Três recortes: por cliente (com o quanto ele paga), por colaborador e por
// tipo de conteúdo — é o que responde "quanto tempo leva um vídeo?".
router.get("/summary", (req, res) => {
  // Aceita período (from/to) ou um mês. Sem nada = mês atual.
  let { from, to } = req.query;
  if (!from && !to) {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    from = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    to = new Date(y, m, 0).toISOString().slice(0, 10);
  }
  const p = { org_id: req.orgId, from, to };
  const dentro = "date(te.entry_date) BETWEEN @from AND @to";

  const porCliente = db.prepare(`
    SELECT c.id, c.name AS client_name,
           COALESCE(SUM(te.minutes), 0) AS minutos,
           (SELECT COALESCE(SUM(cs.price), 0) FROM client_services cs WHERE cs.client_id = c.id) AS mensalidade
    FROM clients c
    LEFT JOIN time_entries te ON te.client_id = c.id AND te.org_id = @org_id AND ${dentro}
    WHERE c.org_id = @org_id AND c.status = 'active'
    GROUP BY c.id ORDER BY minutos DESC`).all(p);

  const porColaborador = db.prepare(`
    SELECT u.id, u.name AS user_name, COALESCE(SUM(te.minutes), 0) AS minutos
    FROM users u
    LEFT JOIN time_entries te ON te.user_id = u.id AND te.org_id = @org_id AND ${dentro}
    WHERE u.org_id = @org_id AND u.active = 1
    GROUP BY u.id ORDER BY minutos DESC`).all(p);

  const porTipo = db.prepare(`
    SELECT COALESCE(t.content_type, 'outros') AS tipo,
           SUM(te.minutes) AS minutos, COUNT(DISTINCT t.id) AS pecas
    FROM time_entries te JOIN tasks t ON t.id = te.task_id
    WHERE te.org_id = @org_id AND ${dentro}
    GROUP BY tipo ORDER BY minutos DESC`).all(p);

  res.json({
    from, to,
    porCliente: porCliente.map((r) => ({
      ...r,
      horas: +(r.minutos / 60).toFixed(1),
      // Quanto a agência recebe por hora dedicada a este cliente.
      valorHora: r.minutos > 0 ? +(r.mensalidade / (r.minutos / 60)).toFixed(2) : null,
    })),
    porColaborador: porColaborador.map((r) => ({ ...r, horas: +(r.minutos / 60).toFixed(1) })),
    porTipo: porTipo.map((r) => ({
      ...r,
      horas: +(r.minutos / 60).toFixed(1),
      // Média por peça: "um Reel leva ~2h"
      mediaMinutos: r.pecas ? Math.round(r.minutos / r.pecas) : 0,
    })),
  });
});

export default router;
