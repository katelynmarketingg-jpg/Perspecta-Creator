import { Router } from "express";
import { pipeline } from "node:stream/promises";
import multer from "multer";
import AdmZip from "adm-zip";
import { mkdirSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, join, dirname, basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { db } from "../db.js";
import { authRequired, moduleAllowed, JWT_SECRET } from "../auth.js";
import { storageConfigured, isR2Path, r2Key, uploadFileToR2, getR2Object, deleteR2Object } from "../storage.js";

// Rotas abertas (link assinado) precisam ficar antes do authRequired.
export const sharedRouter = Router();

const router = Router();

// Serve um arquivo para o cliente HTTP, esteja ele no R2 ou no disco.
// Quando `asAttachment` é falso, entrega "inline" (o navegador mostra a foto ou
// toca o vídeo direto na tela) e respeita Range (bytes=…) — é isso que faz o
// vídeo abrir na hora, mostrar o 1º quadro e deixar arrastar sem baixar tudo.
async function serveFile(res, file, asAttachment, range) {
  if (isR2Path(file.stored_path)) {
    try {
      const obj = await getR2Object(r2Key(file.stored_path), asAttachment ? undefined : range);
      res.setHeader("Content-Type", obj.ContentType || file.mime || "application/octet-stream");
      if (!asAttachment) res.setHeader("Accept-Ranges", "bytes");
      if (obj.ContentLength != null) res.setHeader("Content-Length", obj.ContentLength);
      if (!asAttachment && obj.ContentRange) { res.status(206); res.setHeader("Content-Range", obj.ContentRange); }
      if (asAttachment) res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.original_name)}"`);
      else res.setHeader("Cache-Control", "private, max-age=86400");
      // Um erro no meio do envio (R2 caiu, ou o navegador cancelou a imagem)
      // emite 'error' no stream. Sem tratar, o Node derruba o processo inteiro
      // e TODO MUNDO vê 502 — e uma tela cheia de fotos cancela requisições o
      // tempo todo. `pipeline` fecha os dois lados e devolve o erro aqui.
      await pipeline(obj.Body, res).catch((e) => {
        if (!res.headersSent) res.status(404).end();
        else res.destroy();
        if (e?.code !== "ERR_STREAM_PREMATURE_CLOSE") {
          console.error("[arquivo] envio interrompido:", e?.message);
        }
      });
    } catch {
      res.status(404).json({ error: "Arquivo não encontrado." });
    }
    return;
  }
  if (!existsSync(file.stored_path)) return res.status(404).json({ error: "Arquivo não encontrado." });
  if (asAttachment) return res.download(file.stored_path, file.original_name);
  // sendFile já trata Range e define Accept-Ranges/Content-Type sozinho.
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(file.stored_path, { headers: { "Content-Type": file.mime || undefined } });
}

// Assina uma URL "inline" curta para uma foto/vídeo — o <img>/<video> carrega
// direto por ela (sem cabeçalho de autenticação), com streaming e cache. Vai
// junto de cada arquivo na listagem, então a galeria mostra a prévia na hora.
function mediaUrl(fileId, orgId) {
  const ticket = jwt.sign({ file_id: fileId, org_id: orgId, inline: true }, JWT_SECRET, { expiresIn: "12h" });
  return `/api/files/shared/${ticket}`;
}

// Remove o arquivo físico (R2 ou disco).
async function removeStored(stored_path) {
  if (isR2Path(stored_path)) { try { await deleteR2Object(r2Key(stored_path)); } catch {} }
  else { try { unlinkSync(stored_path); } catch {} }
}

// Os arquivos são gravados em disco exatamente como chegaram (byte a byte).
// Nenhuma compressão ou conversão — a qualidade original é preservada.
// Guarda os uploads no MESMO disco persistente do banco (ex.: /var/data/uploads
// no Render). Antes caía em "./data/uploads", que é efêmero e some a cada
// redeploy — por isso as imagens sumiam. (Quando o R2 está ligado, vai pro R2.)
const DATA_DIR = dirname(process.env.DB_PATH || "./data/agency.db");
const UPLOADS_DIR = resolve(process.env.UPLOADS_DIR || join(DATA_DIR, "uploads"));
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
  await serveFile(res, file, false, req.headers.range);
});

router.use(authRequired, moduleAllowed("arquivos"));

// ---- Pastas ---------------------------------------------------------------
// GET /api/files/folders?client_id=&parent_id=
router.get("/folders", (req, res) => {
  const { client_id, parent_id, all } = req.query;
  const where = ["org_id = @org_id"];
  const params = { org_id: req.orgId };
  if (client_id) { where.push("client_id = @client_id"); params.client_id = client_id; }
  // all=1 → todas as pastas do cliente (para o seletor "mover para pasta").
  if (!all) {
    where.push(parent_id ? "parent_id = @parent_id" : "parent_id IS NULL");
    if (parent_id) params.parent_id = parent_id;
  }
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

// Pastas que já vêm prontas dentro de cada cliente (as antigas "etapas").
// A dona da agência pode apagar as que não usar e criar outras à vontade.
const DEFAULT_FOLDERS = ["Originais", "Editados", "Para aprovação", "Aprovados", "Programados"];

// POST /api/files/folders/ensure-defaults { client_id }
// Garante as pastas padrão na raiz do cliente (cria só as que faltam). Idempotente.
router.post("/folders/ensure-defaults", (req, res) => {
  const clientId = req.body?.client_id;
  if (!clientId) return res.status(400).json({ error: "Informe o cliente." });
  const existentes = db
    .prepare("SELECT name FROM folders WHERE org_id = ? AND client_id = ? AND parent_id IS NULL")
    .all(req.orgId, clientId);
  const tem = new Set(existentes.map((f) => f.name));
  const ins = db.prepare("INSERT INTO folders (name, client_id, parent_id, org_id) VALUES (?, ?, NULL, ?)");
  const tx = db.transaction(() => {
    DEFAULT_FOLDERS.forEach((nome) => { if (!tem.has(nome)) ins.run(nome, clientId, req.orgId); });
  });
  tx();
  res.json(
    db.prepare("SELECT * FROM folders WHERE org_id = ? AND client_id = ? AND parent_id IS NULL ORDER BY name")
      .all(req.orgId, clientId)
  );
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
  const rows = db.prepare(
    `SELECT f.id, f.original_name, f.mime, f.size, f.created_at, f.folder_id, f.client_id,
            f.expires_at, f.keep_forever, f.stage, c.name AS client_name
     FROM files f LEFT JOIN clients c ON c.id = f.client_id
     WHERE ${where.join(" AND ")} ORDER BY f.original_name`
  ).all(params);
  // media_url: link inline (streaming) para o <img>/<video> mostrar a prévia na
  // hora, sem cada tela ter de baixar o arquivo inteiro só para ver a miniatura.
  for (const f of rows) f.media_url = mediaUrl(f.id, req.orgId);
  res.json(rows);
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

// PUT /api/files/:id — renomear e/ou mover para outra pasta.
router.put("/:id", (req, res) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!file) return res.status(404).json({ error: "Arquivo não encontrado." });
  const b = req.body || {};
  // Se veio folder_id, valida que a pasta é do mesmo escritório.
  let folderId = file.folder_id;
  if (b.folder_id !== undefined) {
    if (b.folder_id === null || b.folder_id === "") { folderId = null; }
    else {
      const f = db.prepare("SELECT id FROM folders WHERE id = ? AND org_id = ?").get(b.folder_id, req.orgId);
      if (!f) return res.status(400).json({ error: "Pasta de destino inválida." });
      folderId = f.id;
    }
  }
  const name = (b.original_name && String(b.original_name).trim()) || file.original_name;
  db.prepare("UPDATE files SET original_name = ?, folder_id = ? WHERE id = ? AND org_id = ?")
    .run(name, folderId, req.params.id, req.orgId);
  res.json(db.prepare("SELECT id, original_name, mime, size, folder_id, created_at FROM files WHERE id = ?").get(req.params.id));
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
