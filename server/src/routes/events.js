import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();
router.use(authRequired);

const SELECT = `
  SELECT e.*, et.name AS type_name, et.color AS type_color, c.name AS client_name,
         u.name AS owner_name
  FROM events e
  LEFT JOIN event_types et ON et.id = e.type_id
  LEFT JOIN clients c ON c.id = e.client_id
  LEFT JOIN users u ON u.id = e.owner_id`;

// ---- Tipos de evento ----------------------------------------------------
router.get("/types", (req, res) => {
  res.json(db.prepare("SELECT * FROM event_types ORDER BY name").all());
});

router.post("/types", (req, res) => {
  const { name, color = "#EA580C" } = req.body || {};
  if (!name) return res.status(400).json({ error: "Nome do tipo é obrigatório." });
  const info = db.prepare("INSERT INTO event_types (name, color) VALUES (?, ?)").run(name, color);
  res.status(201).json(db.prepare("SELECT * FROM event_types WHERE id = ?").get(info.lastInsertRowid));
});

router.delete("/types/:id", (req, res) => {
  db.prepare("DELETE FROM event_types WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---- Eventos ------------------------------------------------------------
router.get("/", (req, res) => {
  res.json(db.prepare(`${SELECT} ORDER BY e.start_at`).all());
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.start_at) return res.status(400).json({ error: "Título e início são obrigatórios." });
  const info = db
    .prepare(
      `INSERT INTO events (title, type_id, client_id, start_at, end_at, notes,
                           owner_id, doc_content, link_url, visible_to_client)
       VALUES (@title, @type_id, @client_id, @start_at, @end_at, @notes,
               @owner_id, @doc_content, @link_url, @visible_to_client)`
    )
    .run({
      title: b.title,
      type_id: b.type_id ?? null,
      client_id: b.client_id ?? null,
      start_at: b.start_at,
      end_at: b.end_at ?? null,
      notes: b.notes ?? null,
      owner_id: b.owner_id ?? null,
      doc_content: b.doc_content ?? null,
      link_url: b.link_url ?? null,
      visible_to_client: b.visible_to_client === false ? 0 : 1,
    });
  res.status(201).json(db.prepare(`${SELECT} WHERE e.id = ?`).get(info.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "Evento não encontrado." });
  const merged = {
    ...cur,
    ...req.body,
    visible_to_client: req.body.visible_to_client === undefined ? cur.visible_to_client : req.body.visible_to_client ? 1 : 0,
    id: req.params.id,
  };
  db.prepare(
    `UPDATE events SET title=@title, type_id=@type_id, client_id=@client_id,
     start_at=@start_at, end_at=@end_at, notes=@notes, owner_id=@owner_id,
     doc_content=@doc_content, link_url=@link_url, visible_to_client=@visible_to_client
     WHERE id=@id`
  ).run(merged);
  res.json(db.prepare(`${SELECT} WHERE e.id = ?`).get(req.params.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM events WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
