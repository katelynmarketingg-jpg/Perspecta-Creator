import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";

const router = Router();
router.use(authRequired, moduleAllowed("projetos"));

const withClient = `
  SELECT p.*, c.name AS client_name
  FROM projects p LEFT JOIN clients c ON c.id = p.client_id`;

router.get("/", (req, res) => {
  res.json(db.prepare(`${withClient} WHERE p.org_id = ? ORDER BY p.created_at DESC`).all(req.orgId));
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

// POST /api/projects/:id/launch — lança o mês: cria todas as tarefas do plano
// (posts + vídeos) para o colaborador escolhido. Base reutilizável mês a mês.
router.post("/:id/launch", (req, res) => {
  const project = db.prepare(`${withClient} WHERE p.id = ? AND p.org_id = ?`).get(req.params.id, req.orgId);
  if (!project) return res.status(404).json({ error: "Projeto não encontrado." });

  const { month, assignee_id } = req.body || {}; // month: 'YYYY-MM'
  if (!month) return res.status(400).json({ error: "Informe o mês." });
  const [year, m] = month.split("-").map(Number);
  const monthLabel = `${MONTH_NAMES[m - 1]}/${year}`;

  const posts = Number(project.monthly_posts) || 0;
  const videos = Number(project.monthly_videos) || 0;
  if (!posts && !videos) {
    return res.status(400).json({ error: "Este projeto não tem plano mensal definido." });
  }

  const firstStage = db
    .prepare("SELECT id FROM kanban_stages WHERE org_id = ? ORDER BY position LIMIT 1")
    .get(req.orgId)?.id ?? null;
  const dueDate = new Date(year, m, 0).toISOString().slice(0, 10); // último dia do mês
  const ins = db.prepare(
    `INSERT INTO tasks (title, client_id, project_id, assignee_id, stage_id, priority, content_type, tags, due_date, org_id)
     VALUES (?, ?, ?, ?, ?, 'medium', ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    for (let i = 1; i <= posts; i++) {
      ins.run(`Post ${i}/${posts} — ${project.client_name || project.name} (${monthLabel})`,
        project.client_id, project.id, assignee_id ?? null, firstStage, "post",
        JSON.stringify([monthLabel]), dueDate, req.orgId);
    }
    for (let i = 1; i <= videos; i++) {
      ins.run(`Vídeo ${i}/${videos} — ${project.client_name || project.name} (${monthLabel})`,
        project.client_id, project.id, assignee_id ?? null, firstStage, "reel",
        JSON.stringify([monthLabel]), dueDate, req.orgId);
    }
    db.prepare("INSERT INTO notifications (audience, client_id, message, org_id) VALUES ('agency', ?, ?, ?)").run(
      project.client_id,
      `📦 ${posts + videos} tarefas de ${project.client_name || project.name} lançadas para ${monthLabel}.`,
      req.orgId
    );
  });
  tx();

  res.json({ created: posts + videos, month: monthLabel });
});

export default router;
