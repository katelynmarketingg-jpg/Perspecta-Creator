import { Router } from "express";
import { db } from "../db.js";
import { authRequired, adminRequired } from "../auth.js";

// Documentos ligados (Google Docs/Sheets/Slides ou qualquer link) para abrir
// dentro do sistema, na aba Integrações → Documentos.
const router = Router();
router.use(authRequired);

router.get("/", (req, res) => {
  const rows = db.prepare(
    `SELECT d.id, d.client_id, d.title, d.url, d.created_at, c.name AS client_name
     FROM org_docs d LEFT JOIN clients c ON c.id = d.client_id
     WHERE d.org_id = ? ORDER BY d.created_at DESC`
  ).all(req.orgId);
  res.json(rows);
});

router.post("/", adminRequired, (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.url) return res.status(400).json({ error: "Título e link são obrigatórios." });
  const info = db.prepare(
    "INSERT INTO org_docs (org_id, client_id, title, url) VALUES (?, ?, ?, ?)"
  ).run(req.orgId, b.client_id || null, b.title, b.url);
  res.status(201).json(db.prepare("SELECT * FROM org_docs WHERE id = ?").get(info.lastInsertRowid));
});

router.delete("/:id", adminRequired, (req, res) => {
  db.prepare("DELETE FROM org_docs WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

export default router;
