import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";

const router = Router();
router.use(authRequired, moduleAllowed("clientes"));

function withTouches(row) {
  if (!row) return row;
  return {
    ...row,
    touches: db
      .prepare("SELECT * FROM prospect_touches WHERE prospect_id = ? ORDER BY touch_date, id")
      .all(row.id),
  };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM prospects WHERE org_id = ? ORDER BY created_at DESC").all(req.orgId);
  res.json(rows.map(withTouches));
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "Nome é obrigatório." });
  const info = db
    .prepare(
      `INSERT INTO prospects (org_id, name, company, segment, phone, email, instagram, status, notes)
       VALUES (@org_id, @name, @company, @segment, @phone, @email, @instagram, @status, @notes)`
    )
    .run({
      org_id: req.orgId,
      name: b.name,
      company: b.company ?? null,
      segment: b.segment ?? null,
      phone: b.phone ?? null,
      email: b.email ?? null,
      instagram: b.instagram ?? null,
      status: b.status ?? "novo",
      notes: b.notes ?? null,
    });
  res.status(201).json(withTouches(db.prepare("SELECT * FROM prospects WHERE id = ?").get(info.lastInsertRowid)));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM prospects WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: "Prospect não encontrado." });
  const merged = { ...cur, ...req.body, id: req.params.id, org_id: req.orgId };
  db.prepare(
    `UPDATE prospects SET name=@name, company=@company, segment=@segment, phone=@phone,
     email=@email, instagram=@instagram, status=@status, notes=@notes
     WHERE id=@id AND org_id=@org_id`
  ).run(merged);
  res.json(withTouches(db.prepare("SELECT * FROM prospects WHERE id = ?").get(req.params.id)));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM prospects WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

// POST /api/prospects/:id/touches — registra 1º contato, 2º contato...
router.post("/:id/touches", (req, res) => {
  const prospect = db.prepare("SELECT id FROM prospects WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!prospect) return res.status(404).json({ error: "Prospect não encontrado." });
  const b = req.body || {};
  if (!b.summary) return res.status(400).json({ error: "Escreva o que aconteceu no contato." });
  db.prepare(
    "INSERT INTO prospect_touches (prospect_id, touch_date, channel, summary) VALUES (?, COALESCE(?, date('now')), ?, ?)"
  ).run(prospect.id, b.touch_date ?? null, b.channel ?? null, b.summary);
  res.status(201).json(withTouches(db.prepare("SELECT * FROM prospects WHERE id = ?").get(prospect.id)));
});

router.delete("/:id/touches/:touchId", (req, res) => {
  db.prepare(
    `DELETE FROM prospect_touches WHERE id = ?
     AND prospect_id IN (SELECT id FROM prospects WHERE id = ? AND org_id = ?)`
  ).run(req.params.touchId, req.params.id, req.orgId);
  res.json({ ok: true });
});

// POST /api/prospects/:id/convert — vira cliente de verdade.
router.post("/:id/convert", (req, res) => {
  const p = db.prepare("SELECT * FROM prospects WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!p) return res.status(404).json({ error: "Prospect não encontrado." });
  const info = db
    .prepare(
      `INSERT INTO clients (name, company, segment, phone, email, notes, status, org_id)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`
    )
    .run(p.name, p.company, p.segment, p.phone, p.email, p.notes, req.orgId);
  db.prepare("UPDATE prospects SET status = 'fechado' WHERE id = ?").run(p.id);
  res.status(201).json({ ok: true, client_id: info.lastInsertRowid });
});

export default router;
