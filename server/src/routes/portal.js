import { Router } from "express";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { db } from "../db.js";
import { verifyPassword, portalAuthRequired, JWT_SECRET } from "../auth.js";
import { remindOverdue } from "../overdue.js";
import { syncTaskMediaToStage } from "../gallery-sync.js";
import { isR2Path, r2Key, getR2Object, tipoQueONavegadorToca } from "../storage.js";
import { receiptView, ensureReceiptForEntry } from "../receipts.js";

const router = Router();

// Link inline (streaming, sem login) para o <img>/<video> mostrar/tocar a mídia
// direto na Área do Cliente — o mesmo mecanismo da Galeria da equipe.
function mediaUrl(fileId, orgId) {
  const ticket = jwt.sign({ file_id: fileId, org_id: orgId, inline: true }, JWT_SECRET, { expiresIn: "12h" });
  return `/api/files/shared/${ticket}`;
}

// userId opcional: mira o aviso numa pessoa (ex.: quem programa). NULL = equipe.
function notifyAgency(clientId, taskId, message, orgId, userId = null) {
  db.prepare(
    "INSERT INTO notifications (audience, client_id, task_id, message, org_id, user_id) VALUES ('agency', ?, ?, ?, ?, ?)"
  ).run(clientId, taskId, message, orgId, userId);
}

// A etapa é sempre a do escritório dono do cliente.
function findStageByName(pattern, orgId) {
  return db
    .prepare("SELECT * FROM kanban_stages WHERE name LIKE ? AND org_id = ? ORDER BY position LIMIT 1")
    .get(pattern, orgId);
}

// ---------------------------------------------------------------------------
// POST /api/portal/login — acesso do cliente
// ---------------------------------------------------------------------------
router.post("/login", (req, res) => {
  const { username, email, password } = req.body || {};
  // O cliente entra pelo NOME DE ACESSO (ou, para compatibilidade, pelo e-mail).
  // O front manda o que foi digitado em 'username'; aceitamos os dois campos.
  const identifier = (username ?? email ?? "").trim();
  // Vários clientes podem ter o mesmo nome de acesso: confere a senha em cada
  // candidato em vez de assumir o primeiro (o par nome+senha é o que decide).
  const candidates = db
    .prepare(
      `SELECT * FROM clients
        WHERE (lower(portal_username) = lower(?) OR lower(portal_email) = lower(?))
          AND status = 'active'`
    )
    .all(identifier, identifier);
  const client = candidates.find(
    (c) => c.portal_password_hash && verifyPassword(password || "", c.portal_password_hash)
  );
  if (!client) {
    return res.status(401).json({ error: "Nome de acesso ou senha inválidos." });
  }
  const token = jwt.sign(
    { portal: true, client_id: client.id, name: client.name, org_id: client.org_id },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
  res.json({ token, client: { id: client.id, name: client.name, company: client.company } });
});

// Daqui para baixo, tudo exige token do portal e é limitado ao próprio cliente.
router.use(portalAuthRequired);

router.get("/me", (req, res) => {
  const c = db.prepare("SELECT id, name, company, email FROM clients WHERE id = ?").get(req.client.client_id);
  res.json(c);
});

// ---- Pagamentos -------------------------------------------------------------
router.get("/payments", (req, res) => {
  const rows = db
    .prepare(
      // Cobrança paga = recibo disponível, ponto. `receipt_id` vem quando ele já
      // foi emitido; quando não (cobranças pagas antes de existir recibo), o
      // botão continua aparecendo e o documento é emitido no clique.
      `SELECT f.id, f.description, f.amount, f.status, f.due_date, f.paid_at,
              f.payment_link, f.pix_code, f.boleto_url, f.invoice_url,
              (f.status = 'paid') AS can_receipt,
              (SELECT r.id FROM receipts r
                WHERE r.entry_id = f.id AND r.status = 'issued' AND f.status = 'paid') AS receipt_id
       FROM financial_entries f
       WHERE f.client_id = ? AND f.type = 'income'
       ORDER BY f.due_date DESC, f.id DESC`
    )
    .all(req.client.client_id);
  res.json(rows);
});

// GET /api/portal/payment-methods — formas de pagamento que o escritório oferece.
router.get("/payment-methods", (req, res) => {
  const org = db.prepare("SELECT pay_config FROM organizations WHERE id = ?").get(req.client.org_id);
  let cfg = {};
  try { cfg = org?.pay_config ? JSON.parse(org.pay_config) : {}; } catch { cfg = {}; }
  res.json({
    asaas: !!cfg.asaas?.enabled,
    mercadopago: cfg.mercadopago?.enabled ? { link: cfg.mercadopago.link || "" } : null,
    infinitepay: cfg.infinitepay?.enabled ? { link: cfg.infinitepay.link || "" } : null,
    pass_interest: cfg.pass_interest !== false,
  });
});

// ---- Recibos ----------------------------------------------------------------
// O cliente só enxerga recibo emitido de cobrança PAGA — e só das dele.
const SELECT_RECIBOS = `
  SELECT r.* FROM receipts r
  JOIN financial_entries f ON f.id = r.entry_id
  WHERE r.client_id = @client_id AND r.org_id = @org_id
    AND r.status = 'issued' AND f.status = 'paid'`;

router.get("/receipts", (req, res) => {
  const rows = db.prepare(`${SELECT_RECIBOS} ORDER BY r.year DESC, r.seq DESC`)
    .all({ client_id: req.client.client_id, org_id: req.client.org_id });
  // Na lista não vai imagem (logo/assinatura): só o resumo para montar o card.
  res.json(rows.map((r) => ({
    id: r.id, number: r.number, amount: r.amount, description: r.description,
    receipt_date: r.receipt_date, entry_id: r.entry_id,
  })));
});

// GET /api/portal/receipts/entry/:entryId — recibo de uma cobrança do cliente.
// Se a cobrança está paga e ainda não tem recibo (as que foram quitadas antes
// desta função existir), o documento é emitido agora — assim toda cobrança paga
// tem recibo para baixar, sem depender de alguém abrir a tela da equipe.
router.get("/receipts/entry/:entryId", (req, res) => {
  const entry = db.prepare(
    "SELECT * FROM financial_entries WHERE id = ? AND client_id = ? AND type = 'income'"
  ).get(req.params.entryId, req.client.client_id);
  if (!entry) return res.status(404).json({ error: "Cobrança não encontrada." });
  if (entry.status !== "paid") {
    return res.status(403).json({ error: "Recibo indisponível — a cobrança precisa estar paga." });
  }
  const r = ensureReceiptForEntry(entry.id, { ip: req.ip });
  if (!r) return res.status(404).json({ error: "Não foi possível emitir o recibo desta cobrança." });
  res.json(receiptView(r));
});

router.get("/receipts/:id", (req, res) => {
  const r = db.prepare(`${SELECT_RECIBOS} AND r.id = @id`)
    .get({ client_id: req.client.client_id, org_id: req.client.org_id, id: req.params.id });
  if (!r) {
    return res.status(403).json({ error: "Recibo indisponível — a cobrança precisa estar paga." });
  }
  res.json(receiptView(r));
});

// ---- Contratos --------------------------------------------------------------
router.get("/contracts", (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, title, value, duration_months, start_date, first_due_date, status, notes,
              signed_at, signer_name
       FROM contracts WHERE client_id = ? ORDER BY created_at DESC`
    )
    .all(req.client.client_id);
  res.json(rows);
});

// POST /api/portal/contracts/:id/sign — aceite eletrônico.
// Guardamos nome, documento, IP, data e o hash do texto: se o contrato for
// editado depois, o hash não bate mais e isso fica evidente.
router.post("/contracts/:id/sign", (req, res) => {
  const contract = db
    .prepare("SELECT * FROM contracts WHERE id = ? AND client_id = ?")
    .get(req.params.id, req.client.client_id);
  if (!contract) return res.status(404).json({ error: "Contrato não encontrado." });
  if (contract.signed_at) return res.status(400).json({ error: "Este contrato já foi assinado." });

  const { signer_name, signer_document, agreed } = req.body || {};
  if (!signer_name || !agreed) {
    return res.status(400).json({ error: "Informe seu nome completo e marque que leu e concorda." });
  }

  const hash = createHash("sha256")
    .update(`${contract.id}|${contract.title}|${contract.value}|${contract.notes || ""}`)
    .digest("hex");
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();

  db.prepare(
    `UPDATE contracts SET signed_at = datetime('now'), signer_name = ?, signer_document = ?,
     signer_ip = ?, signed_hash = ? WHERE id = ?`
  ).run(signer_name.trim(), signer_document ?? null, ip, hash, contract.id);

  db.prepare(
    "INSERT INTO notifications (audience, client_id, message, org_id) VALUES ('agency', ?, ?, ?)"
  ).run(req.client.client_id, `✍️ ${signer_name} assinou o contrato "${contract.title}".`, contract.org_id);

  res.json({ ok: true, signed_at: new Date().toISOString(), hash });
});

// ---- Galeria: tudo que é do cliente, por etapa, com prazo para baixar --------
router.get("/gallery", (req, res) => {
  const rows = db
    .prepare(
      `SELECT f.id, f.original_name, f.mime, f.size, f.created_at, f.expires_at, f.keep_forever, f.stage,
              f.thumb,
              t.id AS task_id, t.title AS task_title, t.content_type, t.scheduled_at,
              t.approval_status, s.name AS stage_name, s.is_done AS stage_done
       FROM files f
       LEFT JOIN task_attachments ta ON ta.file_id = f.id
       LEFT JOIN tasks t ON t.id = ta.task_id
       LEFT JOIN kanban_stages s ON s.id = t.stage_id
       WHERE f.client_id = ?
       ORDER BY f.created_at DESC`
    )
    .all(req.client.client_id);

  const VALIDAS = ["originais", "editados", "aprovacao", "aprovados", "programados"];
  // Agrupa do jeito que o cliente pensa. Se o arquivo foi organizado no quadro
  // (etapa definida na aba Arquivos), respeita a etapa; senão, infere pela tarefa.
  const grupo = (f) => {
    if (f.stage && f.stage !== "originais" && VALIDAS.includes(f.stage)) return f.stage;
    if (f.task_id) {
      if (f.scheduled_at && (f.stage_done || f.approval_status === "approved")) return "programados";
      if (f.approval_status === "approved") return "aprovados";
      if (/Aprova/i.test(f.stage_name || "")) return "aprovacao";
      return "editados";
    }
    return VALIDAS.includes(f.stage) ? f.stage : "originais";
  };
  const out = { originais: [], editados: [], aprovacao: [], aprovados: [], programados: [] };
  rows.forEach((f) => { f.media_url = mediaUrl(f.id, req.client.org_id); out[grupo(f)].push(f); });
  res.json(out);
});

// ---- Galeria por PASTAS (a mesma estrutura da aba Galeria da equipe) --------
// GET /api/portal/gallery-folders?parent_id=
router.get("/gallery-folders", (req, res) => {
  const where = ["client_id = @client_id"];
  const params = { client_id: req.client.client_id };
  where.push(req.query.parent_id ? "parent_id = @parent_id" : "parent_id IS NULL");
  if (req.query.parent_id) params.parent_id = req.query.parent_id;
  res.json(db.prepare(`SELECT id, name, parent_id FROM folders WHERE ${where.join(" AND ")} ORDER BY name`).all(params));
});

// GET /api/portal/gallery-files?folder_id=  (fotos e vídeos da pasta)
router.get("/gallery-files", (req, res) => {
  const where = ["client_id = @client_id"];
  const params = { client_id: req.client.client_id };
  where.push(req.query.folder_id ? "folder_id = @folder_id" : "folder_id IS NULL");
  if (req.query.folder_id) params.folder_id = req.query.folder_id;
  const rows = db.prepare(
    `SELECT id, original_name, mime, size, thumb FROM files WHERE ${where.join(" AND ")} ORDER BY created_at DESC`
  ).all(params);
  res.json(
    rows.filter((f) => /^(image|video)\//.test(f.mime || ""))
      .map((f) => ({ ...f, media_url: mediaUrl(f.id, req.client.org_id) }))
  );
});

// ---- Calendário (só os posts do cliente) ------------------------------------
router.get("/calendar", (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.content_type, t.caption, t.scheduled_at, t.approval_status,
              s.name AS stage_name, s.is_done AS stage_done,
              (SELECT ta.file_id FROM task_attachments ta WHERE ta.task_id = t.id LIMIT 1) AS file_id
       FROM tasks t LEFT JOIN kanban_stages s ON s.id = t.stage_id
       WHERE t.client_id = ? AND strftime('%Y-%m', t.scheduled_at) = ?
       ORDER BY t.scheduled_at`
    )
    .all(req.client.client_id, month);
  res.json(rows);
});

// ---- Aprovações -------------------------------------------------------------
// Posts do cliente que estão na etapa "Aprovação".
router.get("/approvals", (req, res) => {
  const stage = findStageByName("%Aprova%", req.client.org_id);
  if (!stage) return res.json([]);
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.description, t.content_type, t.caption, t.scheduled_at,
              t.approval_status, t.client_caption, t.client_note
       FROM tasks t WHERE t.client_id = ? AND t.stage_id = ?
       ORDER BY t.scheduled_at, t.id`
    )
    .all(req.client.client_id, stage.id);
  res.json(rows);
});

// GET /api/portal/approved — conteúdos que o cliente JÁ aprovou (qualquer etapa).
router.get("/approved", (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.content_type, t.caption, t.scheduled_at, t.approval_status
       FROM tasks t WHERE t.client_id = ? AND t.approval_status = 'approved'
       ORDER BY t.scheduled_at DESC, t.id DESC`
    )
    .all(req.client.client_id);
  res.json(rows);
});

function getOwnTask(req, res) {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND client_id = ?").get(req.params.id, req.client.client_id);
  if (!task) res.status(404).json({ error: "Post não encontrado." });
  return task;
}

// POST /api/portal/approvals/:id/approve — aprova e avança para Programação.
router.post("/approvals/:id/approve", (req, res) => {
  const task = getOwnTask(req, res);
  if (!task) return;
  // Modo do escritório: 'auto' programa direto (vai para "Programados"); 'notify'
  // (padrão) apenas marca aprovado e avisa a equipe, que clica em "Programar".
  const org = db.prepare("SELECT approval_mode FROM organizations WHERE id = ?").get(task.org_id);
  const auto = (org?.approval_mode || "notify") === "auto";
  const next = auto
    ? db.prepare("SELECT * FROM kanban_stages WHERE org_id = ? AND is_done = 1 ORDER BY position LIMIT 1").get(task.org_id)
    : null;
  db.prepare("UPDATE tasks SET approval_status = 'approved', stage_id = COALESCE(?, stage_id) WHERE id = ?")
    .run(next?.id ?? null, task.id);
  // A mídia acompanha: aprovado → pasta "Aprovados"; se já programou (modo auto),
  // vai direto para "Programados".
  syncTaskMediaToStage(task.org_id, task.id, auto ? "programados" : "aprovados");
  const aviso = auto
    ? `✅ ${req.client.name} aprovou "${task.title}" — programado.`
    : `✅ ${req.client.name} aprovou "${task.title}". Clique em Programar para agendar.`;
  notifyAgency(task.client_id, task.id, aviso, task.org_id, task.assignee_id || null);
  res.json({ ok: true });
});

// POST /api/portal/approvals/:id/request-changes — legenda editada e/ou
// observações. O post volta para "Em andamento" e a agência é notificada.
router.post("/approvals/:id/request-changes", (req, res) => {
  const task = getOwnTask(req, res);
  if (!task) return;
  const { client_caption, client_note, client_ref_file_id } = req.body || {};
  if (!client_caption && !client_note && !client_ref_file_id) {
    return res.status(400).json({ error: "Edite a legenda, escreva uma observação ou aponte um arquivo." });
  }
  // Referência: só aceita um arquivo que seja do próprio cliente.
  let refId = null;
  if (client_ref_file_id) {
    const own = db.prepare("SELECT id FROM files WHERE id = ? AND client_id = ?")
      .get(client_ref_file_id, req.client.client_id);
    refId = own?.id ?? null;
  }
  // Pediu ajuste → volta para a Distribuição, para a equipe corrigir e reenviar.
  const back = findStageByName("%Distribui%", task.org_id);
  db.prepare(
    `UPDATE tasks SET approval_status = 'changes_requested',
     client_caption = ?, client_note = ?, client_ref_file_id = ?, stage_id = COALESCE(?, stage_id) WHERE id = ?`
  ).run(client_caption ?? null, client_note ?? null, refId, back?.id ?? null, task.id);
  notifyAgency(task.client_id, task.id, `✏️ ${req.client.name} pediu ajustes em "${task.title}".`, task.org_id, task.assignee_id || null);
  res.json({ ok: true });
});

// ---- Avisos para o cliente ---------------------------------------------------
router.get("/notifications", (req, res) => {
  try { remindOverdue(req.client.org_id, req.client.client_id); } catch { /* não bloqueia */ }
  const rows = db
    .prepare(
      `SELECT id, message, task_id, is_read, created_at
       FROM notifications
       WHERE audience = 'client' AND client_id = ?
       ORDER BY created_at DESC LIMIT 20`
    )
    .all(req.client.client_id);
  res.json(rows);
});

router.put("/notifications/read-all", (req, res) => {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE audience = 'client' AND client_id = ?")
    .run(req.client.client_id);
  res.json({ ok: true });
});

// ---- Agenda do cliente -------------------------------------------------------
// Compromissos visíveis (captação, reunião...) com o plano e link acessíveis.
router.get("/events", (req, res) => {
  const from = req.query.from || new Date().toISOString().slice(0, 10);
  const days = Math.min(Number(req.query.days) || 60, 180);
  const rows = db
    .prepare(
      `SELECT e.id, e.title, e.start_at, e.end_at, e.notes, e.doc_content, e.link_url,
              et.name AS type_name, et.color AS type_color, u.name AS owner_name
       FROM events e
       LEFT JOIN event_types et ON et.id = e.type_id
       LEFT JOIN users u ON u.id = e.owner_id
       WHERE e.client_id = ? AND e.visible_to_client = 1
         AND date(e.start_at) BETWEEN ? AND date(?, '+' || ? || ' days')
       ORDER BY e.start_at`
    )
    .all(req.client.client_id, from, from, days);
  res.json(rows);
});

// ---- Conversa por post -------------------------------------------------------
router.get("/tasks/:id/comments", (req, res) => {
  const task = getOwnTask(req, res);
  if (!task) return;
  res.json(db.prepare("SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at, id").all(task.id));
});

router.post("/tasks/:id/comments", (req, res) => {
  const task = getOwnTask(req, res);
  if (!task) return;
  const body = (req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "Escreva alguma coisa." });

  const info = db
    .prepare(
      `INSERT INTO task_comments (org_id, task_id, author_type, author_id, author_name, body)
       VALUES (?, ?, 'client', ?, ?, ?)`
    )
    .run(task.org_id, task.id, req.client.client_id, req.client.name, body);

  notifyAgency(task.client_id, task.id, `💬 ${req.client.name} comentou em "${task.title}".`, task.org_id, task.assignee_id || null);
  res.status(201).json(db.prepare("SELECT * FROM task_comments WHERE id = ?").get(info.lastInsertRowid));
});

// ---- Preview do feed: como o perfil vai ficar, na ordem programada ----------
router.get("/feed", (req, res) => {
  const rows = db
    .prepare(
      // A arte da grade é a CAPA escolhida na Distribuição; sem capa, o 1º anexo.
      // Vem com a miniatura pronta (leve) e o tipo, para o perfil desenhar foto
      // e vídeo sem baixar a arte inteira de cada quadradinho.
      `SELECT t.id, t.title, t.caption, t.client_caption, t.content_type, t.scheduled_at,
              t.approval_status, s.is_done AS stage_done,
              COALESCE(t.cover_file_id,
                       (SELECT ta.file_id FROM task_attachments ta WHERE ta.task_id = t.id LIMIT 1)) AS file_id,
              (SELECT f.thumb FROM files f WHERE f.id = COALESCE(t.cover_file_id,
                       (SELECT ta.file_id FROM task_attachments ta WHERE ta.task_id = t.id LIMIT 1))) AS thumb,
              (SELECT f.mime FROM files f WHERE f.id = COALESCE(t.cover_file_id,
                       (SELECT ta.file_id FROM task_attachments ta WHERE ta.task_id = t.id LIMIT 1))) AS mime
       FROM tasks t LEFT JOIN kanban_stages s ON s.id = t.stage_id
       WHERE t.client_id = ? AND t.scheduled_at IS NOT NULL
       ORDER BY t.scheduled_at DESC`
    )
    .all(req.client.client_id);
  res.json(rows);
});

// ---- Anexos (arte do post) ---------------------------------------------------
router.get("/tasks/:id/attachments", (req, res) => {
  const task = getOwnTask(req, res);
  if (!task) return;
  const rows = db
    .prepare(
      `SELECT f.id, f.original_name, f.mime, f.size
       FROM task_attachments ta JOIN files f ON f.id = ta.file_id
       WHERE ta.task_id = ?`
    )
    .all(task.id);
  res.json(rows);
});

// Download/preview limitado a arquivos do próprio cliente. Serve do R2 quando
// o arquivo está lá (stored_path "r2:..."), senão do disco.
router.get("/files/:id/download", async (req, res) => {
  const file = db
    .prepare("SELECT * FROM files WHERE id = ? AND client_id = ?")
    .get(req.params.id, req.client.client_id);
  if (!file) return res.status(404).json({ error: "Arquivo não encontrado." });
  if (isR2Path(file.stored_path)) {
    try {
      const obj = await getR2Object(r2Key(file.stored_path));
      res.setHeader("Content-Type", obj.ContentType && obj.ContentType !== "application/octet-stream"
        ? obj.ContentType
        : tipoQueONavegadorToca(file));
      if (obj.ContentLength != null) res.setHeader("Content-Length", obj.ContentLength);
      // Idem: sem tratar o erro do stream, uma foto cancelada pelo navegador
      // derruba o servidor e a área do cliente inteira responde 502.
      return await pipeline(obj.Body, res).catch((e) => {
        if (!res.headersSent) res.status(404).end();
        else res.destroy();
        if (e?.code !== "ERR_STREAM_PREMATURE_CLOSE") {
          console.error("[portal] envio de arquivo interrompido:", e?.message);
        }
      });
    } catch { return res.status(404).json({ error: "Arquivo não encontrado." }); }
  }
  if (!existsSync(file.stored_path)) return res.status(404).json({ error: "Arquivo não encontrado." });
  // O arquivo é gravado com nome SEM extensão, então o Express não adivinha o
  // tipo e mandava "application/octet-stream". O navegador, por sua vez, se
  // recusa a desenhar um blob desse tipo dentro de <img> — era exatamente por
  // isso que as fotos não apareciam na prévia do feed da área do cliente.
  res.setHeader("Cache-Control", "private, max-age=86400");
  return res.sendFile(file.stored_path, {
    headers: { "Content-Type": tipoQueONavegadorToca(file) },
  });
});

export default router;
