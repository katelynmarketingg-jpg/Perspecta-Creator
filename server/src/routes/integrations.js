import { Router } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db.js";
import { authRequired, moduleAllowed, JWT_SECRET } from "../auth.js";
import {
  metaConfigured, authUrl, exchangeCode, saveConnection, getConnection,
  publicConnection, publishToInstagram, publishToFacebook, META_APP_ID,
} from "../meta.js";

const router = Router();

// GET /api/integrations/meta/callback — a Meta redireciona para cá depois do
// login do cliente. Fica antes do authRequired porque quem chega é o navegador.
router.get("/meta/callback", async (req, res) => {
  const { code, state, error_description } = req.query;
  const fecha = (msg, ok = false) => res.send(
    `<html><body style="font-family:system-ui;background:#0C0A09;color:#FAFAF9;
      display:grid;place-items:center;height:100vh;margin:0;text-align:center">
      <div><h2 style="color:${ok ? "#4ADE80" : "#F87171"}">${msg}</h2>
      <p style="color:#A8A29E">Pode fechar esta janela.</p></div>
      <script>setTimeout(()=>window.close(),2500)</script></body></html>`
  );

  if (error_description) return fecha(`A Meta recusou: ${error_description}`);
  if (!code || !state) return fecha("Retorno inválido da Meta.");

  try {
    const payload = jwt.verify(String(state), JWT_SECRET);
    const conn = await exchangeCode(String(code));
    saveConnection(payload.org_id, payload.client_id, conn);
    fecha(`Conectado a ${conn.ig_username ? "@" + conn.ig_username : conn.page_name}`, true);
  } catch (e) {
    fecha(`Não foi possível conectar: ${e.message}`);
  }
});

router.use(authRequired, moduleAllowed("clientes"));

// GET /api/integrations/meta/status — o que está conectado neste escritório.
router.get("/meta/status", (req, res) => {
  const rows = db
    .prepare(
      `SELECT i.*, c.name AS client_name, c.auto_publish
       FROM integrations i JOIN clients c ON c.id = i.client_id
       WHERE i.org_id = ? AND i.provider = 'meta'`
    )
    .all(req.orgId);
  res.json({
    configured: metaConfigured(),
    app_id: META_APP_ID ? `${META_APP_ID.slice(0, 6)}…` : null,
    connections: rows.map(publicConnection),
  });
});

// POST /api/integrations/meta/connect — devolve o link do login da Meta.
router.post("/meta/connect", (req, res) => {
  if (!metaConfigured()) {
    return res.status(400).json({
      error: "A integração com a Meta ainda não foi configurada.",
      missing: ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"].filter((k) => !process.env[k]),
    });
  }
  const { client_id } = req.body || {};
  const client = db.prepare("SELECT id FROM clients WHERE id = ? AND org_id = ?").get(client_id, req.orgId);
  if (!client) return res.status(404).json({ error: "Cliente não encontrado." });

  // O state carrega quem está conectando, assinado para não ser forjado.
  const state = jwt.sign({ client_id: client.id, org_id: req.orgId }, JWT_SECRET, { expiresIn: "15m" });
  res.json({ url: authUrl(state) });
});

router.delete("/meta/:clientId", (req, res) => {
  db.prepare("DELETE FROM integrations WHERE client_id = ? AND org_id = ? AND provider = 'meta'")
    .run(req.params.clientId, req.orgId);
  res.json({ ok: true });
});

// PUT /api/integrations/auto-publish — liga/desliga a publicação automática.
router.put("/auto-publish", (req, res) => {
  const { client_id, enabled } = req.body || {};
  db.prepare("UPDATE clients SET auto_publish = ? WHERE id = ? AND org_id = ?")
    .run(enabled ? 1 : 0, client_id, req.orgId);
  res.json({ ok: true, enabled: !!enabled });
});

// POST /api/integrations/publish/:taskId — publica agora, a pedido.
router.post("/publish/:taskId", async (req, res) => {
  const task = db
    .prepare(`SELECT t.*, c.name AS client_name FROM tasks t
              LEFT JOIN clients c ON c.id = t.client_id
              WHERE t.id = ? AND t.org_id = ?`)
    .get(req.params.taskId, req.orgId);
  if (!task) return res.status(404).json({ error: "Tarefa não encontrada." });
  if (task.published_at) return res.status(400).json({ error: "Este post já foi publicado." });

  try {
    const result = await publishTask(task, req.orgId, req.headers.host, req.protocol);
    res.json(result);
  } catch (e) {
    db.prepare("UPDATE tasks SET publish_error = ? WHERE id = ?").run(e.message, task.id);
    res.status(400).json({ error: e.message });
  }
});

/** Publica uma tarefa nas redes do cliente. Usado pelo botão e pelo automático. */
export async function publishTask(task, orgId, host, protocol = "https") {
  const conn = getConnection(task.client_id, orgId);
  if (!conn) throw new Error("Este cliente não tem a Meta conectada.");

  const anexo = db.prepare(
    `SELECT f.id, f.mime FROM task_attachments ta JOIN files f ON f.id = ta.file_id
     WHERE ta.task_id = ? LIMIT 1`
  ).get(task.id);
  if (!anexo) throw new Error("A tarefa não tem arte anexada.");

  // A Meta busca a imagem por URL, então ela precisa estar acessível sem login.
  // Em vez de abrir os arquivos, geramos um link assinado que vale 1 hora.
  // PUBLIC_URL é obrigatório aqui (a Meta não alcança localhost).
  let base = process.env.PUBLIC_URL || (host ? `${protocol}://${host}` : "");
  if (base && !base.startsWith("http")) base = `https://${base}`;
  const ticket = jwt.sign({ file_id: anexo.id, org_id: orgId }, JWT_SECRET, { expiresIn: "1h" });
  const imageUrl = `${base}/api/files/shared/${ticket}`;
  const caption = task.client_caption || task.caption || "";

  const destino = conn.ig_user_id ? "instagram" : "facebook";
  const postId = destino === "instagram"
    ? await publishToInstagram({ conn, imageUrl, caption })
    : await publishToFacebook({ conn, imageUrl, caption });

  db.prepare(
    "UPDATE tasks SET published_at = datetime('now'), external_post_id = ?, publish_error = NULL WHERE id = ?"
  ).run(postId, task.id);
  db.prepare("INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('agency', ?, ?, ?, ?)")
    .run(task.client_id, task.id, `🚀 "${task.title}" publicado no ${destino}.`, orgId);

  return { ok: true, destino, post_id: postId };
}

export default router;
