import { db } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";

// Modelos padrão de cada provedor (bons e baratos para texto).
const DEFAULT_MODEL = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
};

// Preço estimado por 1 milhão de tokens (USD) — entrada/saída. É estimativa
// para o controle de gasto; a cobrança real é do provedor.
const PRICE_USD = {
  "gpt-4o-mini": { in: 0.15, out: 0.60 },
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
};
const USD_BRL = Number(process.env.AI_USD_BRL) || 5.5; // câmbio p/ estimar em R$
const ym = () => new Date().toISOString().slice(0, 7);

function custoBRL(model, tokensIn, tokensOut) {
  const p = PRICE_USD[model] || PRICE_USD["gpt-4o-mini"];
  const usd = (Number(tokensIn) || 0) / 1e6 * p.in + (Number(tokensOut) || 0) / 1e6 * p.out;
  return usd * USD_BRL;
}

// Limites (R$/mês) + quanto já gastou no mês corrente. Estimativa.
export function getBudget(orgId) {
  const cfg = db.prepare("SELECT budget_warn1, budget_warn2, budget_limit FROM org_ai WHERE org_id = ?").get(orgId) || {};
  const mo = db.prepare("SELECT * FROM ai_usage_month WHERE org_id = ? AND ym = ?").get(orgId, ym());
  return {
    warn1: cfg.budget_warn1 ?? 50, warn2: cfg.budget_warn2 ?? 75, limit: cfg.budget_limit ?? 100,
    spent: +(mo?.cost_brl || 0).toFixed(2),
    calls: mo?.calls || 0, tokens_in: mo?.tokens_in || 0, tokens_out: mo?.tokens_out || 0,
    ym: ym(),
  };
}

export function saveBudget(orgId, { warn1, warn2, limit }) {
  // Garante a linha do org_ai (mesmo sem chave ainda) e grava os limites.
  db.prepare(`INSERT INTO org_ai (org_id) VALUES (?) ON CONFLICT(org_id) DO NOTHING`).run(orgId);
  db.prepare(
    "UPDATE org_ai SET budget_warn1 = ?, budget_warn2 = ?, budget_limit = ? WHERE org_id = ?"
  ).run(Math.max(0, Number(warn1) || 0), Math.max(0, Number(warn2) || 0), Math.max(0, Number(limit) || 0), orgId);
  return getBudget(orgId);
}

// Avisa a equipe quando cruza 50/75/limite — uma vez cada, por mês.
function alertaOrcamento(orgId, b, mo) {
  const jaEnviados = mo?.alerts || 0;
  const marcos = [
    { n: 1, valor: b.warn1, msg: `⚠️ IA: você já usou cerca de R$ ${b.spent.toFixed(2)} este mês (aviso de R$ ${b.warn1.toFixed(2)}).` },
    { n: 2, valor: b.warn2, msg: `⚠️ IA: gasto do mês perto do teto — cerca de R$ ${b.spent.toFixed(2)} (aviso de R$ ${b.warn2.toFixed(2)}).` },
    { n: 3, valor: b.limit, msg: `⛔ IA: você atingiu o limite de R$ ${b.limit.toFixed(2)} do mês. A geração fica pausada até virar o mês ou você aumentar o limite.` },
  ];
  let nivel = jaEnviados;
  for (const m of marcos) if (b.spent >= m.valor && m.n > jaEnviados) {
    try {
      db.prepare("INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('agency', NULL, NULL, ?, ?)").run(m.msg, orgId);
    } catch { /* aviso não deve derrubar */ }
    nivel = Math.max(nivel, m.n);
  }
  if (nivel !== jaEnviados) {
    db.prepare("UPDATE ai_usage_month SET alerts = ? WHERE org_id = ? AND ym = ?").run(nivel, orgId, ym());
  }
}

export function getAiConfig(orgId) {
  const row = db.prepare("SELECT * FROM org_ai WHERE org_id = ?").get(orgId);
  if (!row) return { configured: false, provider: "openai", model: DEFAULT_MODEL.openai };
  return {
    configured: Boolean(row.api_key),
    provider: row.provider,
    model: row.model || DEFAULT_MODEL[row.provider],
    _key: decrypt(row.api_key),
  };
}

// Soma o consumo de tokens de uma chamada ao total do escritório (histórico) e
// ao mês corrente (com custo estimado), e dispara os avisos de gasto.
function recordUsage(orgId, tokensIn, tokensOut, model) {
  const ti = Number(tokensIn) || 0, to = Number(tokensOut) || 0;
  try {
    db.prepare(
      `INSERT INTO ai_usage (org_id, calls, tokens_in, tokens_out, updated_at)
       VALUES (?, 1, ?, ?, datetime('now'))
       ON CONFLICT(org_id) DO UPDATE SET
         calls = calls + 1, tokens_in = tokens_in + excluded.tokens_in,
         tokens_out = tokens_out + excluded.tokens_out, updated_at = datetime('now')`
    ).run(orgId, ti, to);
    const custo = custoBRL(model, ti, to);
    db.prepare(
      `INSERT INTO ai_usage_month (org_id, ym, calls, tokens_in, tokens_out, cost_brl, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, datetime('now'))
       ON CONFLICT(org_id, ym) DO UPDATE SET
         calls = calls + 1, tokens_in = tokens_in + excluded.tokens_in,
         tokens_out = tokens_out + excluded.tokens_out,
         cost_brl = cost_brl + excluded.cost_brl, updated_at = datetime('now')`
    ).run(orgId, ym(), ti, to, custo);
    const mo = db.prepare("SELECT * FROM ai_usage_month WHERE org_id = ? AND ym = ?").get(orgId, ym());
    alertaOrcamento(orgId, getBudget(orgId), mo);
  } catch { /* medição não deve derrubar a resposta */ }
}

export function saveAiConfig(orgId, { provider, api_key, model }) {
  const prov = provider === "anthropic" ? "anthropic" : "openai";
  db.prepare(
    `INSERT INTO org_ai (org_id, provider, api_key, model, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(org_id) DO UPDATE SET
       provider = excluded.provider,
       api_key = COALESCE(excluded.api_key, org_ai.api_key),
       model = excluded.model, updated_at = datetime('now')`
  ).run(orgId, prov, api_key ? encrypt(api_key) : null, model || DEFAULT_MODEL[prov]);
}

/**
 * Chama o modelo com uma instrução de sistema + o pedido do usuário.
 * Abstrai OpenAI e Anthropic para o resto do sistema não se importar com qual é.
 */
export async function askAi(orgId, { system, user, image }) {
  const cfg = getAiConfig(orgId);
  if (!cfg.configured) {
    const err = new Error("A chave de IA ainda não foi configurada.");
    err.code = "NO_KEY";
    throw err;
  }
  // Trava de gasto: se já bateu o limite do mês, não chama o provedor.
  const b = getBudget(orgId);
  if (b.limit > 0 && b.spent >= b.limit) {
    const err = new Error(`Você atingiu o limite de R$ ${b.limit.toFixed(2)} de IA neste mês. Aumente o limite na aba IA ou espere virar o mês.`);
    err.code = "BUDGET";
    throw err;
  }
  // `image` (opcional) é um data URL "data:image/jpeg;base64,....". Com ele a IA
  // OLHA a arte para escrever a legenda. Os dois modelos padrão têm visão.
  const img = /^data:(image\/[a-z.+-]+);base64,(.+)$/i.exec(image || "");

  if (cfg.provider === "anthropic") {
    const content = [];
    if (img) content.push({ type: "image", source: { type: "base64", media_type: img[1], data: img[2] } });
    content.push({ type: "text", text: user });
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg._key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 1500,
        system,
        messages: [{ role: "user", content }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "A IA recusou o pedido.");
    recordUsage(orgId, data.usage?.input_tokens, data.usage?.output_tokens, cfg.model);
    return data.content?.map((c) => c.text).join("") || "";
  }

  // OpenAI (padrão)
  const userContent = img
    ? [{ type: "text", text: user }, { type: "image_url", image_url: { url: image } }]
    : user;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg._key}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      temperature: 0.8,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "A IA recusou o pedido.");
  recordUsage(orgId, data.usage?.prompt_tokens, data.usage?.completion_tokens, cfg.model);
  return data.choices?.[0]?.message?.content || "";
}

// Monta a instrução de sistema com a persona do cliente.
export function personaSystem(client, persona) {
  const p = persona || {};
  return [
    "Você é uma assistente de social media de uma agência de marketing brasileira.",
    "Escreva em português do Brasil, natural e humano, sem clichês de marketing.",
    `Cliente: ${client.name}${client.company ? ` (${client.company})` : ""}.`,
    client.segment ? `Segmento: ${client.segment}.` : "",
    p.tone ? `Tom de voz: ${p.tone}.` : "",
    p.audience ? `Público: ${p.audience}.` : "",
    p.pillars ? `Pilares de conteúdo: ${p.pillars}.` : "",
    p.avoid ? `Evite: ${p.avoid}.` : "",
    p.extra ? `Observações: ${p.extra}.` : "",
    "As sugestões são um rascunho — alguém da equipe vai revisar antes de publicar.",
  ].filter(Boolean).join("\n");
}
