// ---------------------------------------------------------------------------
// COFRE DE ACESSOS DO CLIENTE.
//
// Guarda os acessos que a agência administra pelo cliente — Registro.br (domínio),
// hospedagem, e-mail, Google Meu Negócio, Instagram, etc. As SENHAS ficam
// CRIPTOGRAFADAS no banco (AES-256-GCM, a mesma do token da Meta), nunca em
// texto puro. Só quem tem login da agência (authRequired) vê/edita.
// ---------------------------------------------------------------------------
import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";
import { encrypt, decrypt } from "../crypto.js";

db.exec(`CREATE TABLE IF NOT EXISTS client_credentials (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER NOT NULL,
  client_id   INTEGER NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'outro',   -- registro_br | hospedagem | email | google_meu_negocio | instagram | outro
  label       TEXT,                            -- nome que aparece (ex.: "Domínio principal")
  login       TEXT,                            -- usuário/e-mail/domínio
  secret_enc  TEXT,                            -- a senha, CRIPTOGRAFADA
  url         TEXT,                            -- endereço para entrar
  notes       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);`);

const router = Router();
router.use(authRequired);

// Confere que o cliente é desta casa (senão dava para ler o cofre de outra).
function clienteDaCasa(clientId, orgId) {
  return db.prepare("SELECT id FROM clients WHERE id = ? AND org_id = ?").get(clientId, orgId);
}

// Para a tela do cofre: devolve a senha em claro (é o cofre da própria agência).
function paraTela(row) {
  const { secret_enc, ...resto } = row;
  return { ...resto, secret: decrypt(secret_enc) || "" };
}

// GET /api/credentials/:clientId — os acessos daquele cliente.
router.get("/:clientId", (req, res) => {
  if (!clienteDaCasa(req.params.clientId, req.orgId)) return res.status(404).json({ error: "Cliente não encontrado." });
  const rows = db.prepare(
    "SELECT * FROM client_credentials WHERE client_id = ? AND org_id = ? ORDER BY id"
  ).all(req.params.clientId, req.orgId);
  res.json(rows.map(paraTela));
});

// POST /api/credentials/:clientId — novo acesso.
router.post("/:clientId", (req, res) => {
  if (!clienteDaCasa(req.params.clientId, req.orgId)) return res.status(404).json({ error: "Cliente não encontrado." });
  const b = req.body || {};
  const info = db.prepare(
    `INSERT INTO client_credentials (org_id, client_id, kind, label, login, secret_enc, url, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(req.orgId, req.params.clientId, String(b.kind || "outro"),
        b.label || null, b.login || null, encrypt(b.secret || ""), b.url || null, b.notes || null);
  res.status(201).json(paraTela(db.prepare("SELECT * FROM client_credentials WHERE id = ?").get(info.lastInsertRowid)));
});

// PUT /api/credentials/:clientId/:id — editar.
router.put("/:clientId/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM client_credentials WHERE id = ? AND client_id = ? AND org_id = ?")
    .get(req.params.id, req.params.clientId, req.orgId);
  if (!cur) return res.status(404).json({ error: "Acesso não encontrado." });
  const b = req.body || {};
  // Senha: só troca quando veio uma nova (campo preenchido); senão mantém.
  const secret_enc = b.secret !== undefined && b.secret !== "" ? encrypt(b.secret) : cur.secret_enc;
  db.prepare(
    `UPDATE client_credentials SET kind = ?, label = ?, login = ?, secret_enc = ?, url = ?, notes = ?,
       updated_at = datetime('now') WHERE id = ? AND org_id = ?`
  ).run(b.kind ?? cur.kind, b.label ?? cur.label, b.login ?? cur.login, secret_enc,
        b.url ?? cur.url, b.notes ?? cur.notes, req.params.id, req.orgId);
  res.json(paraTela(db.prepare("SELECT * FROM client_credentials WHERE id = ?").get(req.params.id)));
});

// DELETE /api/credentials/:clientId/:id
router.delete("/:clientId/:id", (req, res) => {
  db.prepare("DELETE FROM client_credentials WHERE id = ? AND client_id = ? AND org_id = ?")
    .run(req.params.id, req.params.clientId, req.orgId);
  res.json({ ok: true });
});

export default router;
