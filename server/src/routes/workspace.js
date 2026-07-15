import { Router } from "express";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { db } from "../db.js";
import { authRequired } from "../auth.js";
import "dotenv/config";

const router = Router();
router.use(authRequired);

// Senhas de clientes são criptografadas em repouso (AES-256-GCM).
const KEY = scryptSync(process.env.JWT_SECRET || "dev-secret", "workspace-salt", 32);

function encrypt(text) {
  if (!text) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), enc.toString("hex")].join(":");
}

function decrypt(payload) {
  if (!payload) return null;
  try {
    const [iv, tag, data] = payload.split(":");
    const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(data, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function publicItem(row) {
  return { ...row, secret: decrypt(row.secret) };
}

// GET /api/workspace?client_id= — itens (com senha decifrada para a equipe)
router.get("/", (req, res) => {
  const where = req.query.client_id ? "WHERE w.client_id = ?" : "";
  const args = req.query.client_id ? [req.query.client_id] : [];
  const rows = db
    .prepare(
      `SELECT w.*, c.name AS client_name
       FROM workspace_items w JOIN clients c ON c.id = w.client_id
       ${where} ORDER BY w.position, w.id`
    )
    .all(...args);
  res.json(rows.map(publicItem));
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.client_id || !b.title) {
    return res.status(400).json({ error: "Cliente e título são obrigatórios." });
  }
  const info = db
    .prepare(
      `INSERT INTO workspace_items (client_id, kind, title, content, username, secret, url)
       VALUES (@client_id, @kind, @title, @content, @username, @secret, @url)`
    )
    .run({
      client_id: b.client_id,
      kind: b.kind || "note",
      title: b.title,
      content: b.content ?? null,
      username: b.username ?? null,
      secret: encrypt(b.secret),
      url: b.url ?? null,
    });
  const row = db.prepare("SELECT * FROM workspace_items WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(publicItem(row));
});

// PUT /api/workspace/reorder — arrastar e soltar: nova ordem (e coluna) dos itens.
router.put("/reorder", (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const upd = db.prepare("UPDATE workspace_items SET position = ?, client_id = ? WHERE id = ?");
  const tx = db.transaction(() => {
    items.forEach((i) => upd.run(i.position, i.client_id, i.id));
  });
  tx();
  res.json({ ok: true, count: items.length });
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM workspace_items WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "Item não encontrado." });
  const b = req.body || {};
  const merged = {
    ...cur,
    ...b,
    secret: b.secret !== undefined ? encrypt(b.secret) : cur.secret,
    id: req.params.id,
  };
  db.prepare(
    `UPDATE workspace_items SET client_id=@client_id, kind=@kind, title=@title,
     content=@content, username=@username, secret=@secret, url=@url, position=@position
     WHERE id=@id`
  ).run(merged);
  const row = db.prepare("SELECT * FROM workspace_items WHERE id = ?").get(req.params.id);
  res.json(publicItem(row));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM workspace_items WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
