import { Router } from "express";
import { db } from "../db.js";
import { authRequired, adminRequired } from "../auth.js";

const router = Router();
router.use(authRequired);

// Formas de pagamento padrão (todas desligadas; Asaas ligado por padrão).
const PAY_DEFAULT = {
  asaas: { enabled: true },
  mercadopago: { enabled: false, link: "" },
  infinitepay: { enabled: false, link: "" },
  pass_interest: true, // juro do parcelamento por conta do cliente
};
function parsePay(raw) {
  try { return { ...PAY_DEFAULT, ...(raw ? JSON.parse(raw) : {}) }; }
  catch { return { ...PAY_DEFAULT }; }
}

// GET /api/branding — logo e favicon do escritório atual.
router.get("/", (req, res) => {
  const org = db.prepare("SELECT logo, favicon, name, approval_mode, pay_config FROM organizations WHERE id = ?").get(req.orgId);
  res.json({
    logo: org?.logo || null, favicon: org?.favicon || null, name: org?.name || null,
    approval_mode: org?.approval_mode || "notify",
    pay_config: parsePay(org?.pay_config),
  });
});

// PUT /api/branding/pay-config — formas de pagamento oferecidas ao cliente.
router.put("/pay-config", adminRequired, (req, res) => {
  const b = req.body?.pay_config || {};
  const clean = {
    asaas: { enabled: !!b.asaas?.enabled },
    mercadopago: { enabled: !!b.mercadopago?.enabled, link: String(b.mercadopago?.link || "").trim() },
    infinitepay: { enabled: !!b.infinitepay?.enabled, link: String(b.infinitepay?.link || "").trim() },
    pass_interest: b.pass_interest !== false,
  };
  db.prepare("UPDATE organizations SET pay_config = ? WHERE id = ?").run(JSON.stringify(clean), req.orgId);
  res.json({ ok: true, pay_config: clean });
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
