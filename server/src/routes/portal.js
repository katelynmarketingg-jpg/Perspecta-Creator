import { Router } from "express";
import jwt from "jsonwebtoken";
import { existsSync } from "node:fs";
import { db } from "../db.js";
import { verifyPassword, portalAuthRequired, JWT_SECRET } from "../auth.js";

const router = Router();

function notifyAgency(clientId, taskId, message, orgId) {
  db.prepare(
    "INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('agency', ?, ?, ?, ?)"
  ).run(clientId, taskId, message, orgId);
}

// A etapa é sempre a do escritório dono do cliente.
function findStageByName(pattern, orgId) {
  return db
    .prepare("SELECT * FROM kanban_stages WHERE name LIKE ? AND org_id = ? ORDER BY position LIMIT 1")
    .get(pattern, orgId);
}

// ---------------------------------------------------------------------------
// POST /api/portal/login — acesso do cliente
// ---------------------------------------------------------------------------
router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  const client = db
    .prepare("SELECT * FROM clients WHERE portal_email = ? AND status = 'active'")
    .get((email || "").toLowerCase());
  if (!client || !client.portal_password_hash || !verifyPassword(password || "", client.portal_password_hash)) {
    return res.status(401).json({ error: "E-mail ou senha inválidos." });
  }
  const token = jwt.sign(
    { portal: true, client_id: client.id, name: client.name, org_id: client.org_id },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
  res.json({ token, client: { id: client.id, name: client.name, company: client.company } });
});

// Daqui para baixo, tudo exige token do portal e é limitado ao próprio cliente.
router.use(portalAuthRequired);

router.get("/me", (req, res) => {
  const c = db.prepare("SELECT id, name, company, email FROM clients WHERE id = ?").get(req.client.client_id);
  res.json(c);
});

// ---- Pagamentos -------------------------------------------------------------
router.get("/payments", (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, description, amount, status, due_date, paid_at,
              payment_link, pix_code, boleto_url, invoice_url
       FROM financial_entries
       WHERE client_id = ? AND type = 'income'
       ORDER BY due_date DESC, id DESC`
    )
    .all(req.client.client_id);
  res.json(rows);
});

// ---- Contratos --------------------------------------------------------------
router.get("/contracts", (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, title, value, duration_months, start_date, first_due_date, status, notes
       FROM contracts WHERE client_id = ? ORDER BY created_at DESC`
    )
    .all(req.client.client_id);
  res.json(rows);
});

// ---- Calendário (só os posts do cliente) ------------------------------------
router.get("/calendar", (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.content_type, t.caption, t.scheduled_at, t.approval_status,
              s.name AS stage_name, s.is_done AS stage_done
       FROM tasks t LEFT JOIN kanban_stages s ON s.id = t.stage_id
       WHERE t.client_id = ? AND strftime('%Y-%m', t.scheduled_at) = ?
       ORDER BY t.scheduled_at`
    )
    .all(req.client.client_id, month);
  res.json(rows);
});

// ---- Aprovações -------------------------------------------------------------
// Posts do cliente que estão na etapa "Aprovação".
router.get("/approvals", (req, res) => {
  const stage = findStageByName("%Aprova%", req.client.org_id);
  if (!stage) return res.json([]);
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.description, t.content_type, t.caption, t.scheduled_at,
              t.approval_status, t.client_caption, t.client_note
       FROM tasks t WHERE t.client_id = ? AND t.stage_id = ?
       ORDER BY t.scheduled_at, t.id`
    )
    .all(req.client.client_id, stage.id);
  res.json(rows);
});

function getOwnTask(req, res) {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND client_id = ?").get(req.params.id, req.client.client_id);
  if (!task) res.status(404).json({ error: "Post não encontrado." });
  return task;
}

// POST /api/portal/approvals/:id/approve — aprova e avança para Programação.
router.post("/approvals/:id/approve", (req, res) => {
  const task = getOwnTask(req, res);
  if (!task) return;
  const next = findStageByName("%Programa%", task.org_id);
  db.prepare("UPDATE tasks SET approval_status = 'approved', stage_id = COALESCE(?, stage_id) WHERE id = ?")
    .run(next?.id ?? null, task.id);
  notifyAgency(task.client_id, task.id, `✅ ${req.client.name} aprovou "${task.title}".`, task.org_id);
  res.json({ ok: true });
});

// POST /api/portal/approvals/:id/request-changes — legenda editada e/ou
// observações. O post volta para "Em andamento" e a agência é notificada.
router.post("/approvals/:id/request-changes", (req, res) => {
  const task = getOwnTask(req, res);
  if (!task) return;
  const { client_caption, client_note } = req.body || {};
  if (!client_caption && !client_note) {
    return res.status(400).json({ error: "Edite a legenda ou escreva uma observação." });
  }
  const back = findStageByName("%andamento%", task.org_id);
  db.prepare(
    `UPDATE tasks SET approval_status = 'changes_requested',
     client_caption = ?, client_note = ?, stage_id = COALESCE(?, stage_id) WHERE id = ?`
  ).run(client_caption ?? null, client_note ?? null, back?.id ?? null, task.id);
  notifyAgency(task.client_id, task.id, `✏️ ${req.client.name} pediu ajustes em "${task.title}".`, task.org_id);
  res.json({ ok: true });
});

// ---- Agenda do cliente -------------------------------------------------------
// Compromissos visíveis (captação, reunião...) com o plano e link acessíveis.
router.get("/events", (req, res) => {
  const from = req.query.from || new Date().toISOString().slice(0, 10);
  const days = Math.min(Number(req.query.days) || 60, 180);
  const rows = db
    .prepare(
      `SELECT e.id, e.title, e.start_at, e.end_at, e.notes, e.doc_content, e.link_url,
              et.name AS type_name, et.color AS type_color, u.name AS owner_name
       FROM events e
       LEFT JOIN event_types et ON et.id = e.type_id
       LEFT JOIN users u ON u.id = e.owner_id
       WHERE e.client_id = ? AND e.visible_to_client = 1
         AND date(e.start_at) BETWEEN ? AND date(?, '+' || ? || ' days')
       ORDER BY e.start_at`
    )
    .all(req.client.client_id, from, from, days);
  res.json(rows);
});

// ---- Anexos (arte do post) ---------------------------------------------------
router.get("/tasks/:id/attachments", (req, res) => {
  const task = getOwnTask(req, res);
  if (!task) return;
  const rows = db
    .prepare(
      `SELECT f.id, f.original_name, f.mime, f.size
       FROM task_attachments ta JOIN files f ON f.id = ta.file_id
       WHERE ta.task_id = ?`
    )
    .all(task.id);
  res.json(rows);
});

// Download/preview limitado a arquivos do próprio cliente.
router.get("/files/:id/download", (req, res) => {
  const file = db
    .prepare("SELECT * FROM files WHERE id = ? AND client_id = ?")
    .get(req.params.id, req.client.client_id);
  if (!file || !existsSync(file.stored_path)) {
    return res.status(404).json({ error: "Arquivo não encontrado." });
  }
  res.download(file.stored_path, file.original_name);
});

export default router;
