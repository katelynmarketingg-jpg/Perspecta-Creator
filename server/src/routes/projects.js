import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();
router.use(authRequired);

const withClient = `
  SELECT p.*, c.name AS client_name
  FROM projects p LEFT JOIN clients c ON c.id = p.client_id`;

router.get("/", (req, res) => {
  res.json(db.prepare(`${withClient} ORDER BY p.created_at DESC`).all());
});

router.get("/:id", (req, res) => {
  const row = db.prepare(`${withClient} WHERE p.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "Projeto não encontrado." });
  res.json(row);
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "Nome é obrigatório." });
  const info = db
    .prepare(
      `INSERT INTO projects (name, client_id, description, status, start_date, end_date)
       VALUES (@name, @client_id, @description, @status, @start_date, @end_date)`
    )
    .run({
      name: b.name,
      client_id: b.client_id ?? null,
      description: b.description ?? null,
      status: b.status ?? "active",
      start_date: b.start_date ?? null,
      end_date: b.end_date ?? null,
    });
  res.status(201).json(db.prepare(`${withClient} WHERE p.id = ?`).get(info.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "Projeto não encontrado." });
  const merged = { ...cur, ...req.body, id: req.params.id };
  db.prepare(
    `UPDATE projects SET name=@name, client_id=@client_id, description=@description,
     status=@status, start_date=@start_date, end_date=@end_date WHERE id=@id`
  ).run(merged);
  res.json(db.prepare(`${withClient} WHERE p.id = ?`).get(req.params.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// POST /api/projects/:id/launch — lança o mês: cria todas as tarefas do plano
// (posts + vídeos) para o colaborador escolhido. Base reutilizável mês a mês.
router.post("/:id/launch", (req, res) => {
  const project = db.prepare(`${withClient} WHERE p.id = ?`).get(req.params.id);
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

  const firstStage = db.prepare("SELECT id FROM kanban_stages ORDER BY position LIMIT 1").get()?.id ?? null;
  const dueDate = new Date(year, m, 0).toISOString().slice(0, 10); // último dia do mês
  const ins = db.prepare(
    `INSERT INTO tasks (title, client_id, project_id, assignee_id, stage_id, priority, content_type, tags, due_date)
     VALUES (?, ?, ?, ?, ?, 'medium', ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    for (let i = 1; i <= posts; i++) {
      ins.run(`Post ${i}/${posts} — ${project.client_name || project.name} (${monthLabel})`,
        project.client_id, project.id, assignee_id ?? null, firstStage, "post",
        JSON.stringify([monthLabel]), dueDate);
    }
    for (let i = 1; i <= videos; i++) {
      ins.run(`Vídeo ${i}/${videos} — ${project.client_name || project.name} (${monthLabel})`,
        project.client_id, project.id, assignee_id ?? null, firstStage, "reel",
        JSON.stringify([monthLabel]), dueDate);
    }
    db.prepare("INSERT INTO notifications (audience, client_id, message) VALUES ('agency', ?, ?)").run(
      project.client_id,
      `📦 ${posts + videos} tarefas de ${project.client_name || project.name} lançadas para ${monthLabel}.`
    );
  });
  tx();

  res.json({ created: posts + videos, month: monthLabel });
});

export default router;
