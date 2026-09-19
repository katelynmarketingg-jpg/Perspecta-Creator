import { Router } from "express";
import multer from "multer";
import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { db } from "../db.js";
import { authRequired } from "../auth.js";
import {
  storageConfigured, uploadFileToR2, isR2Path, r2Key, getR2Object,
  enderecoAssinado, deleteR2Object,
} from "../storage.js";

// ---------------------------------------------------------------------------
// AS IMAGENS DAS PERGUNTAS VISUAIS.
//
// Uma pergunta pode mostrar opções em imagem — três paletas, quatro estilos de
// foto, dois jeitos de mostrar o produto — e pedir que o cliente escolha e
// escreva por quê. Isto aqui é o lugar dessas imagens.
//
// Elas têm um endereço PÚBLICO de propósito: quem responde o briefing não tem
// login. O endereço é um token sorteado, não o número da imagem, para que
// ninguém consiga ir passeando pelas imagens dos outros escritórios trocando
// um número na barra do navegador.
// ---------------------------------------------------------------------------

const DATA_DIR = dirname(process.env.DB_PATH || "./data/agency.db");
const UPLOADS_DIR = resolve(process.env.UPLOADS_DIR || join(DATA_DIR, "uploads"));
mkdirSync(UPLOADS_DIR, { recursive: true });

const MAX_IMAGEM = 8 * 1024 * 1024;   // é uma referência visual, não o arquivo final

const envio = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, _f, cb) => cb(null, `briefing-${Date.now()}-${randomUUID()}`),
  }),
  limits: { fileSize: MAX_IMAGEM, files: 1 },
  fileFilter: (_req, f, cb) => cb(null, /^image\//.test(f.mimetype)),
});

// ---- Lado da EQUIPE: subir e apagar as imagens ----------------------------
export const midiaAuthRouter = Router();
midiaAuthRouter.use(authRequired);

// POST /api/briefing-midia — sobe uma imagem e devolve o endereço dela.
midiaAuthRouter.post("/", envio.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Mande uma imagem (JPG, PNG ou WEBP) de até 8 MB." });
  }
  let caminho = req.file.path;
  if (storageConfigured()) {
    try {
      caminho = await uploadFileToR2(req.file.path, `briefing/${req.orgId}/${req.file.filename}`, req.file.mimetype);
      try { unlinkSync(req.file.path); } catch { /* já está no R2 */ }
    } catch { caminho = req.file.path; }   // R2 fora: fica no disco, não perde
  }
  const token = randomBytes(18).toString("base64url");
  db.prepare(
    "INSERT INTO briefing_media (org_id, token, mime, size, stored_path) VALUES (?, ?, ?, ?, ?)"
  ).run(req.orgId, token, req.file.mimetype, req.file.size, caminho);
  res.status(201).json({ token, url: `/api/briefing-midia/${token}` });
});

// DELETE /api/briefing-midia/:token — tirou a opção da pergunta, some a imagem.
midiaAuthRouter.delete("/:token", async (req, res) => {
  const m = db.prepare("SELECT * FROM briefing_media WHERE token = ? AND org_id = ?")
    .get(req.params.token, req.orgId);
  if (!m) return res.status(404).json({ error: "Imagem não encontrada." });
  db.prepare("DELETE FROM briefing_media WHERE id = ?").run(m.id);
  try {
    if (isR2Path(m.stored_path)) await deleteR2Object(r2Key(m.stored_path));
    else if (existsSync(m.stored_path)) unlinkSync(m.stored_path);
  } catch { /* o registro já saiu; o arquivo solto não atrapalha ninguém */ }
  res.json({ ok: true });
});

// ---- Lado do CLIENTE: ver a imagem, sem login ----------------------------
export const midiaPublicRouter = Router();

midiaPublicRouter.get("/:token", async (req, res) => {
  const m = db.prepare("SELECT mime, stored_path FROM briefing_media WHERE token = ?").get(req.params.token);
  if (!m) return res.status(404).json({ error: "Imagem não encontrada." });

  // Na nuvem: o navegador busca direto na Cloudflare, perto de quem responde.
  if (isR2Path(m.stored_path)) {
    const direto = await enderecoAssinado(r2Key(m.stored_path), { tipo: m.mime });
    if (direto) {
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.redirect(302, direto);
    }
    try {
      const obj = await getR2Object(r2Key(m.stored_path));
      res.setHeader("Content-Type", obj.ContentType || m.mime || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      await pipeline(obj.Body, res).catch(() => { if (!res.headersSent) res.status(404).end(); else res.destroy(); });
    } catch {
      res.status(404).json({ error: "Imagem não encontrada." });
    }
    return;
  }

  if (!existsSync(m.stored_path)) return res.status(404).json({ error: "Imagem não encontrada." });
  res.setHeader("Content-Type", m.mime || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  createReadStream(m.stored_path).on("error", () => res.destroy()).pipe(res);
});
