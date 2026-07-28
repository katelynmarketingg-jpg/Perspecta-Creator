import { Router } from "express";
import { db } from "../db.js";
import { authRequired, adminRequired } from "../auth.js";

const router = Router();
router.use(authRequired);

// Tipos que todo escritório já nasce podendo distribuir. "planejamento" e
// "reuniao" entram porque a Katy pediu explicitamente.
const DEFAULTS = [
  ["post", "Post", "🖼️"], ["carrossel", "Carrossel", "🎠"], ["reel", "Reel", "🎬"],
  ["foto", "Foto", "📸"], ["captacao", "Captação", "🎥"], ["stories", "Stories", "⚡"],
  ["reuniao", "Reunião", "🤝"], ["planejamento", "Planejamento", "🗺️"],
  ["arte", "Arte / Design", "🎨"], ["legenda", "Legenda", "✍️"], ["trafego", "Tráfego / Campanha", "📊"],
];

function seedIfEmpty(orgId) {
  const n = db.prepare("SELECT COUNT(*) AS n FROM task_types WHERE org_id = ?").get(orgId).n;
  if (n > 0) return;
  const ins = db.prepare("INSERT INTO task_types (org_id, key, label, emoji, position) VALUES (?, ?, ?, ?, ?)");
  DEFAULTS.forEach(([key, label, emoji], i) => ins.run(orgId, key, label, emoji, i));
}

// Transforma um texto livre num "key" estável (sem acento, minúsculo).
function toKey(label) {
  return String(label || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `tipo_${Date.now()}`;
}

// GET /api/task-types — lista os tipos do escritório (cria os padrões na 1ª vez).
router.get("/", (req, res) => {
  seedIfEmpty(req.orgId);
  const rows = db.prepare(
    `SELECT tt.*, u.name AS responsible_name
     FROM task_types tt LEFT JOIN users u ON u.id = tt.responsible_user_id
     WHERE tt.org_id = ? AND tt.active = 1 ORDER BY tt.position, tt.id`
  ).all(req.orgId);
  res.json(rows);
});

// POST /api/task-types — cria um tipo próprio.
router.post("/", adminRequired, (req, res) => {
  const b = req.body || {};
  if (!b.label) return res.status(400).json({ error: "Dê um nome ao tipo." });
  let key = b.key ? toKey(b.key) : toKey(b.label);
  // Evita colidir com um tipo já existente no escritório.
  const existe = db.prepare("SELECT 1 FROM task_types WHERE org_id = ? AND key = ?").get(req.orgId, key);
  if (existe) key = `${key}_${Date.now().toString().slice(-4)}`;
  const pos = db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS p FROM task_types WHERE org_id = ?").get(req.orgId).p;
  const info = db.prepare(
    "INSERT INTO task_types (org_id, key, label, emoji, responsible_user_id, position) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(req.orgId, key, b.label.trim(), b.emoji || "📌", b.responsible_user_id || null, pos);
  res.status(201).json(db.prepare("SELECT * FROM task_types WHERE id = ?").get(info.lastInsertRowid));
});

// PUT /api/task-types/:id — muda o nome, emoji ou o responsável.
router.put("/:id", adminRequired, (req, res) => {
  const cur = db.prepare("SELECT * FROM task_types WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: "Tipo não encontrado." });
  const b = req.body || {};
  db.prepare("UPDATE task_types SET label = ?, emoji = ?, responsible_user_id = ? WHERE id = ? AND org_id = ?").run(
    b.label !== undefined ? b.label : cur.label,
    b.emoji !== undefined ? b.emoji : cur.emoji,
    b.responsible_user_id !== undefined ? (b.responsible_user_id || null) : cur.responsible_user_id,
    req.params.id, req.orgId
  );
  res.json(db.prepare("SELECT * FROM task_types WHERE id = ?").get(req.params.id));
});

// DELETE /api/task-types/:id — some com o tipo (as tarefas já criadas ficam).
router.delete("/:id", adminRequired, (req, res) => {
  db.prepare("DELETE FROM task_types WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

// Descobre o responsável de um tipo (usado pelo "Lançar mês").
export function responsibleForType(orgId, key) {
  const t = db.prepare("SELECT responsible_user_id FROM task_types WHERE org_id = ? AND key = ?").get(orgId, key);
  return t?.responsible_user_id ?? null;
}

export default router;
