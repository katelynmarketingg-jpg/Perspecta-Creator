import { Router } from "express";
import multer from "multer";
import { mkdirSync, existsSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";

const router = Router();
router.use(authRequired, moduleAllowed("arquivos"));

// Os arquivos são gravados em disco exatamente como chegaram (byte a byte).
// Nenhuma compressão ou conversão — a qualidade original é preservada.
const UPLOADS_DIR = resolve(process.env.UPLOADS_DIR || "./data/uploads");
mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // até 2 GB por arquivo
});

// ---- Pastas ---------------------------------------------------------------
// GET /api/files/folders?client_id=&parent_id=
router.get("/folders", (req, res) => {
  const { client_id, parent_id } = req.query;
  const where = ["org_id = @org_id"];
  const params = { org_id: req.orgId };
  if (client_id) { where.push("client_id = @client_id"); params.client_id = client_id; }
  where.push(parent_id ? "parent_id = @parent_id" : "parent_id IS NULL");
  if (parent_id) params.parent_id = parent_id;
  res.json(
    db.prepare(`SELECT * FROM folders WHERE ${where.join(" AND ")} ORDER BY name`).all(params)
  );
});

router.post("/folders", (req, res) => {
  const { name, client_id, parent_id } = req.body || {};
  if (!name) return res.status(400).json({ error: "Nome da pasta é obrigatório." });
  const info = db
    .prepare("INSERT INTO folders (name, client_id, parent_id, org_id) VALUES (?, ?, ?, ?)")
    .run(name, client_id ?? null, parent_id ?? null, req.orgId);
  res.status(201).json(db.prepare("SELECT * FROM folders WHERE id = ?").get(info.lastInsertRowid));
});

router.delete("/folders/:id", (req, res) => {
  const folder = db.prepare("SELECT id FROM folders WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!folder) return res.status(404).json({ error: "Pasta não encontrada." });
  // Remove arquivos físicos da pasta (e subpastas ficam por conta do CASCADE).
  const files = db.prepare("SELECT stored_path FROM files WHERE folder_id = ?").all(req.params.id);
  files.forEach((f) => { try { unlinkSync(f.stored_path); } catch {} });
  db.prepare("DELETE FROM folders WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

// ---- Arquivos ---------------------------------------------------------------
// GET /api/files?client_id=&folder_id=&all=1  (all=1 ignora pastas)
router.get("/", (req, res) => {
  const { client_id, folder_id, all } = req.query;
  const where = ["f.org_id = @org_id"];
  const params = { org_id: req.orgId };
  if (client_id) { where.push("f.client_id = @client_id"); params.client_id = client_id; }
  if (!all) {
    where.push(folder_id ? "f.folder_id = @folder_id" : "f.folder_id IS NULL");
    if (folder_id) params.folder_id = folder_id;
  }
  res.json(
    db.prepare(
      `SELECT f.id, f.original_name, f.mime, f.size, f.created_at, f.folder_id, f.client_id,
              c.name AS client_name
       FROM files f LEFT JOIN clients c ON c.id = f.client_id
       WHERE ${where.join(" AND ")} ORDER BY f.original_name`
    ).all(params)
  );
});

// POST /api/files/upload — multipart; aceita vários arquivos de uma vez.
router.post("/upload", upload.array("files", 20), (req, res) => {
  const { client_id, folder_id } = req.body || {};
  const stmt = db.prepare(
    `INSERT INTO files (folder_id, client_id, original_name, mime, size, stored_path, org_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const created = (req.files || []).map((f) => {
    // originalname chega em latin1 no multer — normaliza para UTF-8.
    const name = Buffer.from(f.originalname, "latin1").toString("utf8");
    const info = stmt.run(folder_id || null, client_id || null, name, f.mimetype, f.size, f.path, req.orgId);
    return db.prepare("SELECT id, original_name, mime, size, created_at FROM files WHERE id = ?").get(info.lastInsertRowid);
  });
  res.status(201).json(created);
});

// GET /api/files/:id/download — devolve o arquivo original, intacto.
router.get("/:id/download", (req, res) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!file || !existsSync(file.stored_path)) {
    return res.status(404).json({ error: "Arquivo não encontrado." });
  }
  res.download(file.stored_path, file.original_name);
});

router.delete("/:id", (req, res) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (file) {
    try { unlinkSync(file.stored_path); } catch {}
    db.prepare("DELETE FROM files WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  }
  res.json({ ok: true });
});

export default router;
