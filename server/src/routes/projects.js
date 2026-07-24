import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";

const router = Router();
router.use(authRequired, moduleAllowed("projetos"));

const withClient = `
  SELECT p.*, c.name AS client_name
  FROM projects p LEFT JOIN clients c ON c.id = p.client_id`;

router.get("/", (req, res) => {
  const projetos = db.prepare(`${withClient} WHERE p.org_id = ? ORDER BY p.created_at DESC`).all(req.orgId);
  // Junta o plano mensal (tipo + quantidade) de cada projeto, para os cards
  // mostrarem as quantidades já discriminadas.
  const itens = db.prepare(
    "SELECT project_id, content_type, quantity FROM plan_items WHERE org_id = ? ORDER BY position, id"
  ).all(req.orgId);
  const porProjeto = {};
  itens.forEach((it) => {
    (porProjeto[it.project_id] ||= []).push({ content_type: it.content_type, quantity: it.quantity });
  });
  res.json(projetos.map((p) => ({ ...p, plan: porProjeto[p.id] || [] })));
});

router.get("/:id", (req, res) => {
  const row = db.prepare(`${withClient} WHERE p.id = ? AND p.org_id = ?`).get(req.params.id, req.orgId);
  if (!row) return res.status(404).json({ error: "Projeto não encontrado." });
  res.json(row);
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "Nome é obrigatório." });
  const info = db
    .prepare(
      `INSERT INTO projects (name, client_id, description, status, start_date, end_date, org_id)
       VALUES (@name, @client_id, @description, @status, @start_date, @end_date, @org_id)`
    )
    .run({
      name: b.name,
      client_id: b.client_id ?? null,
      description: b.description ?? null,
      status: b.status ?? "active",
      start_date: b.start_date ?? null,
      end_date: b.end_date ?? null,
      org_id: req.orgId,
    });
  res.status(201).json(db.prepare(`${withClient} WHERE p.id = ?`).get(info.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM projects WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: "Projeto não encontrado." });
  const merged = { ...cur, ...req.body, id: req.params.id, org_id: req.orgId };
  db.prepare(
    `UPDATE projects SET name=@name, client_id=@client_id, description=@description,
     status=@status, start_date=@start_date, end_date=@end_date WHERE id=@id AND org_id=@org_id`
  ).run(merged);
  res.json(db.prepare(`${withClient} WHERE p.id = ?`).get(req.params.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM projects WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// ---- Plano mensal configurável (linhas: tipo, quantidade, responsável) ----
router.get("/:id/plan", (req, res) => {
  const project = db.prepare("SELECT id FROM projects WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!project) return res.status(404).json({ error: "Projeto não encontrado." });
  const linhas = db.prepare(
    `SELECT pi.*, u.name AS assignee_name
     FROM plan_items pi LEFT JOIN users u ON u.id = pi.assignee_id
     WHERE pi.project_id = ? ORDER BY pi.position, pi.id`
  ).all(req.params.id);
  res.json(linhas.map((l) => ({ ...l, days: l.days ? JSON.parse(l.days) : [] })));
});

router.put("/:id/plan", (req, res) => {
  const project = db.prepare("SELECT id FROM projects WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!project) return res.status(404).json({ error: "Projeto não encontrado." });
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const ins = db.prepare(
    `INSERT INTO plan_items (org_id, project_id, content_type, label, quantity, assignee_id, position, days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM plan_items WHERE project_id = ?").run(req.params.id);
    items.forEach((it, i) => {
      // Dias do mês (1–31), únicos e ordenados. Vazio = sem data fixa.
      const dias = Array.isArray(it.days)
        ? [...new Set(it.days.map((d) => Number(d)).filter((d) => d >= 1 && d <= 31))].sort((a, b) => a - b)
        : [];
      ins.run(req.orgId, req.params.id, it.content_type || "post", it.label ?? null,
        Math.max(Number(it.quantity) || 1, 1), it.assignee_id || null, i,
        dias.length ? JSON.stringify(dias) : null);
    });
  });
  tx();
  res.json({ ok: true, count: items.length });
});

// Descobre quem produz um tipo de conteúdo (função) quando a linha não fixa alguém.
function assigneeByDuty(orgId, contentType) {
  const u = db.prepare(
    `SELECT id FROM users WHERE org_id = ? AND active = 1
     AND duties LIKE ? ORDER BY id LIMIT 1`
  ).get(orgId, `%"${contentType}"%`);
  return u?.id ?? null;
}

// POST /api/projects/:id/launch — lança o mês: cria todas as tarefas do plano
// (posts + vídeos) para o colaborador escolhido. Base reutilizável mês a mês.
router.post("/:id/launch", (req, res) => {
  const project = db.prepare(`${withClient} WHERE p.id = ? AND p.org_id = ?`).get(req.params.id, req.orgId);
  if (!project) return res.status(404).json({ error: "Projeto não encontrado." });

  const { month, assignee_id } = req.body || {}; // month: 'YYYY-MM'
  if (!month) return res.status(400).json({ error: "Informe o mês." });
  const [year, m] = month.split("-").map(Number);
  const monthLabel = `${MONTH_NAMES[m - 1]}/${year}`;

  // Prioriza o plano configurável; se não houver, cai no antigo posts/vídeos.
  const planItems = db.prepare("SELECT * FROM plan_items WHERE project_id = ? ORDER BY position, id").all(project.id);
  const CONTENT_LABEL = { post: "Post", reel: "Reel", foto: "Foto", stories: "Stories", outro: "Conteúdo" };

  let linhas = planItems.map((it) => ({
    content_type: it.content_type,
    label: it.label || CONTENT_LABEL[it.content_type] || "Conteúdo",
    quantity: it.quantity,
    assignee_id: it.assignee_id,
    days: it.days ? JSON.parse(it.days) : [],
  }));

  if (!linhas.length) {
    const posts = Number(project.monthly_posts) || 0;
    const videos = Number(project.monthly_videos) || 0;
    if (posts) linhas.push({ content_type: "post", label: "Post", quantity: posts, assignee_id: null });
    if (videos) linhas.push({ content_type: "reel", label: "Vídeo", quantity: videos, assignee_id: null });
  }
  if (!linhas.length) {
    return res.status(400).json({ error: "Este projeto não tem plano mensal definido." });
  }

  const firstStage = db
    .prepare("SELECT id FROM kanban_stages WHERE org_id = ? ORDER BY position LIMIT 1")
    .get(req.orgId)?.id ?? null;
  const lastDay = new Date(year, m, 0).getDate();
  const dueDate = new Date(year, m, 0).toISOString().slice(0, 10); // último dia do mês
  const pad = (n) => String(n).padStart(2, "0");
  const ins = db.prepare(
    `INSERT INTO tasks (title, client_id, project_id, assignee_id, stage_id, priority, content_type, tags, due_date, scheduled_at, org_id)
     VALUES (?, ?, ?, ?, ?, 'medium', ?, ?, ?, ?, ?)`
  );

  // Notifica cada colaborador quantas tarefas caíram para ele.
  const porPessoa = {};
  let total = 0;

  const tx = db.transaction(() => {
    linhas.forEach((linha) => {
      // Quem faz: a pessoa fixada na linha, ou o override do diálogo, ou por função.
      const quem = linha.assignee_id || assignee_id || assigneeByDuty(req.orgId, linha.content_type);
      const dias = Array.isArray(linha.days) ? linha.days : [];
      for (let i = 1; i <= linha.quantity; i++) {
        // Se há datas fixas, a peça i cai no i-ésimo dia (cicla se faltar dia).
        let scheduledAt = null;
        let due = dueDate;
        if (dias.length) {
          const dia = Math.min(dias[(i - 1) % dias.length], lastDay);
          scheduledAt = `${year}-${pad(m)}-${pad(dia)} 09:00`;
          due = `${year}-${pad(m)}-${pad(dia)}`;
        }
        ins.run(
          `${linha.label} ${i}/${linha.quantity} — ${project.client_name || project.name} (${monthLabel})`,
          project.client_id, project.id, quem ?? null, firstStage, linha.content_type,
          JSON.stringify([monthLabel]), due, scheduledAt, req.orgId
        );
        total++;
        if (quem) porPessoa[quem] = (porPessoa[quem] || 0) + 1;
      }
    });
    // Aviso geral para a agência.
    db.prepare("INSERT INTO notifications (audience, client_id, message, org_id) VALUES ('agency', ?, ?, ?)").run(
      project.client_id,
      `📦 ${total} tarefas de ${project.client_name || project.name} lançadas para ${monthLabel}.`,
      req.orgId
    );
    // Aviso individual para cada responsável.
    Object.entries(porPessoa).forEach(([uid, qtd]) => {
      db.prepare("INSERT INTO notifications (audience, client_id, message, org_id) VALUES ('agency', ?, ?, ?)").run(
        project.client_id,
        `👤 ${qtd} tarefa(s) de ${project.client_name || project.name} atribuídas a você (${monthLabel}).`,
        req.orgId
      );
    });
  });
  tx();

  res.json({ created: total, month: monthLabel });
});

export default router;
