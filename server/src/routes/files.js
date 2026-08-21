import { Router } from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import { mkdirSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, join, basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { db } from "../db.js";
import { authRequired, moduleAllowed, JWT_SECRET } from "../auth.js";
import { storageConfigured, isR2Path, r2Key, uploadFileToR2, getR2Object, deleteR2Object } from "../storage.js";

// Rotas abertas (link assinado) precisam ficar antes do authRequired.
export const sharedRouter = Router();

const router = Router();

// Serve um arquivo para o cliente HTTP, esteja ele no R2 ou no disco.
async function serveFile(res, file, asAttachment) {
  if (isR2Path(file.stored_path)) {
    try {
      const obj = await getR2Object(r2Key(file.stored_path));
      if (obj.ContentType) res.setHeader("Content-Type", obj.ContentType);
      if (obj.ContentLength != null) res.setHeader("Content-Length", obj.ContentLength);
      if (asAttachment) res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.original_name)}"`);
      obj.Body.pipe(res);
    } catch {
      res.status(404).json({ error: "Arquivo não encontrado." });
    }
    return;
  }
  if (!existsSync(file.stored_path)) return res.status(404).json({ error: "Arquivo não encontrado." });
  if (asAttachment) return res.download(file.stored_path, file.original_name);
  res.sendFile(file.stored_path);
}

// Remove o arquivo físico (R2 ou disco).
async function removeStored(stored_path) {
  if (isR2Path(stored_path)) { try { await deleteR2Object(r2Key(stored_path)); } catch {} }
  else { try { unlinkSync(stored_path); } catch {} }
}

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

// GET /api/files/shared/:ticket — link assinado e temporário, usado só para a
// Meta buscar a arte na hora de publicar. Fica antes do authRequired.
sharedRouter.get("/shared/:ticket", async (req, res) => {
  let payload;
  try {
    payload = jwt.verify(req.params.ticket, JWT_SECRET);
  } catch {
    return res.status(403).json({ error: "Link expirado ou inválido." });
  }
  const file = db
    .prepare("SELECT * FROM files WHERE id = ? AND org_id = ?")
    .get(payload.file_id, payload.org_id);
  if (!file) return res.status(404).json({ error: "Arquivo não encontrado." });
  await serveFile(res, file, false);
});

router.use(authRequired, moduleAllowed("arquivos"));

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
  files.forEach((f) => { removeStored(f.stored_path); });
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
              f.expires_at, f.keep_forever, f.stage, c.name AS client_name
       FROM files f LEFT JOIN clients c ON c.id = f.client_id
       WHERE ${where.join(" AND ")} ORDER BY f.original_name`
    ).all(params)
  );
});

// POST /api/files/upload — multipart; aceita vários arquivos de uma vez.
const STAGES = ["originais", "editados", "aprovacao", "aprovados", "programados"];

router.post("/upload", upload.array("files", 20), async (req, res) => {
  const { client_id, folder_id } = req.body || {};
  const stage = STAGES.includes(req.body?.stage) ? req.body.stage : "originais";
  const stmt = db.prepare(
    `INSERT INTO files (folder_id, client_id, original_name, mime, size, stored_path, stage, org_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const created = [];
  for (const f of (req.files || [])) {
    // originalname chega em latin1 no multer — normaliza para UTF-8.
    const name = Buffer.from(f.originalname, "latin1").toString("utf8");
    let storedPath = f.path; // por padrão fica no disco
    if (storageConfigured()) {
      try {
        const key = `uploads/${req.orgId}/${f.filename}`;
        storedPath = await uploadFileToR2(f.path, key, f.mimetype);
        try { unlinkSync(f.path); } catch {} // já está no R2, apaga o local
      } catch {
        storedPath = f.path; // se o R2 falhar, não perde: mantém no disco
      }
    }
    const info = stmt.run(folder_id || null, client_id || null, name, f.mimetype, f.size, storedPath, stage, req.orgId);
    created.push(db.prepare("SELECT id, original_name, mime, size, created_at FROM files WHERE id = ?").get(info.lastInsertRowid));
  }
  res.status(201).json(created);
});

// Descobre o tipo (mime) de uma foto/vídeo pela extensão do nome.
const MIME_BY_EXT = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif", ".bmp": "image/bmp",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska", ".m4v": "video/x-m4v",
};

// POST /api/files/upload-zip — importa em massa: recebe UM arquivo .zip e cria
// um arquivo para cada foto/vídeo de dentro dele, no cliente/pasta escolhidos.
router.post("/upload-zip", upload.single("zip"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Envie um arquivo .zip." });
  const { client_id, folder_id } = req.body || {};
  const stage = STAGES.includes(req.body?.stage) ? req.body.stage : "originais";

  let entries;
  try {
    entries = new AdmZip(req.file.path).getEntries();
  } catch {
    try { unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: "Não consegui ler o .zip. Confira se o arquivo está certo." });
  }

  const stmt = db.prepare(
    `INSERT INTO files (folder_id, client_id, original_name, mime, size, stored_path, stage, org_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let count = 0, ignorados = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    const nome = basename(e.entryName);
    if (!nome || nome.startsWith(".") || e.entryName.startsWith("__MACOSX")) continue;
    const mime = MIME_BY_EXT[extname(nome).toLowerCase()];
    if (!mime) { ignorados++; continue; } // só fotos e vídeos

    const buf = e.getData();
    const localName = `${Date.now()}-${randomUUID()}`;
    const localPath = join(UPLOADS_DIR, localName);
    try {
      writeFileSync(localPath, buf);
      let storedPath = localPath;
      if (storageConfigured()) {
        try {
          storedPath = await uploadFileToR2(localPath, `uploads/${req.orgId}/${localName}`, mime);
          try { unlinkSync(localPath); } catch {}
        } catch { storedPath = localPath; }
      }
      stmt.run(folder_id || null, client_id || null, nome, mime, buf.length, storedPath, stage, req.orgId);
      count++;
    } catch { ignorados++; }
  }
  try { unlinkSync(req.file.path); } catch {} // apaga o zip temporário

  res.status(201).json({ count, ignorados });
});

// GET /api/files/:id/download — devolve o arquivo original, intacto.
router.get("/:id/download", async (req, res) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!file) return res.status(404).json({ error: "Arquivo não encontrado." });
  await serveFile(res, file, true);
});

// PUT /api/files/:id/stage — move o arquivo entre etapas (originais → ... → programados).
router.put("/:id/stage", (req, res) => {
  const stage = STAGES.includes(req.body?.stage) ? req.body.stage : null;
  if (!stage) return res.status(400).json({ error: "Etapa inválida." });
  db.prepare("UPDATE files SET stage = ? WHERE id = ? AND org_id = ?").run(stage, req.params.id, req.orgId);
  res.json({ ok: true, stage });
});

// PUT /api/files/:id/keep — trava o arquivo para nunca expirar.
router.put("/:id/keep", (req, res) => {
  db.prepare("UPDATE files SET keep_forever = ? WHERE id = ? AND org_id = ?")
    .run(req.body?.keep ? 1 : 0, req.params.id, req.orgId);
  res.json({ ok: true, keep: !!req.body?.keep });
});

router.delete("/:id", async (req, res) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (file) {
    await removeStored(file.stored_path);
    db.prepare("DELETE FROM files WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  }
  res.json({ ok: true });
});

export default router;
