import { Router } from "express";
import { db } from "../db.js";
import { authRequired, adminRequired } from "../auth.js";

const router = Router();
router.use(authRequired);

// GET /api/branding — logo e favicon do escritório atual.
router.get("/", (req, res) => {
  const org = db.prepare("SELECT logo, favicon, name, approval_mode FROM organizations WHERE id = ?").get(req.orgId);
  res.json({
    logo: org?.logo || null, favicon: org?.favicon || null, name: org?.name || null,
    approval_mode: org?.approval_mode || "notify",
  });
});

// PUT /api/branding/approval-mode — 'notify' (avisar a equipe) | 'auto' (programar direto).
router.put("/approval-mode", adminRequired, (req, res) => {
  const mode = req.body?.approval_mode === "auto" ? "auto" : "notify";
  db.prepare("UPDATE organizations SET approval_mode = ? WHERE id = ?").run(mode, req.orgId);
  res.json({ ok: true, approval_mode: mode });
});

// PUT /api/branding — atualiza logo e/ou favicon (data URI). Só admin.
router.put("/", adminRequired, (req, res) => {
  const b = req.body || {};
  // Limite defensivo: imagens de marca são pequenas (data URI ~ base64).
  const LIMITE = 700 * 1024; // ~700 KB de data URI
  for (const campo of ["logo", "favicon"]) {
    if (b[campo] && typeof b[campo] === "string" && b[campo].length > LIMITE) {
      return res.status(400).json({ error: `Imagem de ${campo} muito grande. Use um arquivo menor.` });
    }
  }
  const cur = db.prepare("SELECT logo, favicon FROM organizations WHERE id = ?").get(req.orgId);
  db.prepare("UPDATE organizations SET logo = ?, favicon = ? WHERE id = ?").run(
    b.logo !== undefined ? (b.logo || null) : cur.logo,
    b.favicon !== undefined ? (b.favicon || null) : cur.favicon,
    req.orgId
  );
  res.json({ ok: true });
});

export default router;
