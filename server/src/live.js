// ---------------------------------------------------------------------------
// Atualização ao vivo (tempo real) via SSE — Server-Sent Events.
//
// Ideia em uma frase: o servidor mantém um "canal" aberto com cada tela e,
// quando alguém grava algo, avisa na hora todas as telas DAQUELE escritório
// para que elas recarreguem só o que mudou. Estilo "planilha do Google".
//
// Por que SSE (e não WebSocket): o Render roda um servidor Node comum (não é
// serverless), então conexões longas funcionam bem. SSE é HTTP puro, leve e
// não precisa de nenhuma infra extra (nada de Redis) — ideal para 1 instância.
// ---------------------------------------------------------------------------
import jwt from "jsonwebtoken";
import { db } from "./db.js";
import { JWT_SECRET } from "./auth.js";

// Conexões abertas no momento. Cada item: { orgId, res }.
const clients = new Set();

// Descobre o "recurso" a partir do caminho: /api/tasks/12 -> "tasks".
// É esse nome que as telas usam para saber se o aviso é para elas.
function resourceFromPath(path) {
  const m = String(path || "").match(/^\/api\/([a-z0-9-]+)/i);
  return m ? m[1] : null;
}

// Envia um aviso "mudou X" para todas as telas abertas daquele escritório.
export function broadcast(orgId, resource) {
  if (!orgId || !resource) return;
  const line = `data: ${JSON.stringify({ resource, ts: Date.now() })}\n\n`;
  for (const c of clients) {
    if (c.orgId === orgId) {
      try {
        c.res.write(line);
      } catch {
        // Conexão morta: será removida no evento 'close'. Ignora aqui.
      }
    }
  }
}

// Middleware GLOBAL: depois de qualquer gravação bem-sucedida (POST/PUT/PATCH/
// DELETE que retornou 2xx), avisa o escritório dono da requisição. Assim não
// precisamos editar as ~30 rotas uma por uma — o aviso sai automaticamente.
export function liveNotifier(req, res, next) {
  const m = req.method;
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next();
  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 300 && req.orgId) {
      const resource = resourceFromPath(req.originalUrl);
      if (resource) broadcast(req.orgId, resource);
    }
  });
  next();
}

// Endpoint do canal: GET /api/live?token=...&org=...
// O EventSource do navegador NÃO consegue enviar cabeçalhos, então o token
// vai na URL (mesma verificação do authRequired) e o org também.
export function sseHandler(req, res) {
  const token = req.query.token;
  if (!token) return res.status(401).end();

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).end();
  }
  // Tokens do portal do cliente não entram no canal da equipe.
  if (payload.portal) return res.status(403).end();

  // Relê o usuário: desativar alguém corta o canal na hora também.
  const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.id);
  if (!fresh || !fresh.active) return res.status(401).end();

  // Mesmo escopo do authRequired: master pode olhar um escritório via ?org=.
  const asked = Number(req.query.org) || null;
  const orgId = fresh.role === "superadmin" && asked ? asked : fresh.org_id;

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Impede o proxy (Render/nginx) de segurar os dados em buffer.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  // Sugere ao navegador reconectar em 5s se a conexão cair; e um "olá" inicial.
  res.write("retry: 5000\n\n");
  res.write(`data: ${JSON.stringify({ resource: "__hello", ts: Date.now() })}\n\n`);

  const client = { orgId, res };
  clients.add(client);

  // Ping a cada 25s: mantém a conexão viva (proxies cortam conexões ociosas).
  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* ignora — o 'close' faz a limpeza */
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(ping);
    clients.delete(client);
  });
}
