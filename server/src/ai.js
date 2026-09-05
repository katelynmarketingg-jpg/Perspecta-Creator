import { db } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";

// Modelos padrão de cada provedor (bons e baratos para texto).
const DEFAULT_MODEL = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
};

// ---------------------------------------------------------------------------
// ROTEAMENTO DE MODELOS (Model Router). Centralizado aqui para trocar o modelo
// de cada nível sem mexer no resto do código. Tarefa simples (legenda, título,
// ideia) usa o modelo BARATO; tarefa que exige raciocínio (estratégia) usa um
// mais forte. Dá para sobrescrever por ambiente (AI_MODEL_FAST etc.).
// ---------------------------------------------------------------------------
export const AI_MODELS = {
  openai: {
    fast: process.env.AI_MODEL_FAST || "gpt-4o-mini",
    standard: process.env.AI_MODEL_STD || "gpt-4o-mini",
    advanced: process.env.AI_MODEL_ADV || "gpt-4o",
  },
  anthropic: {
    fast: "claude-haiku-4-5-20251001",
    standard: "claude-haiku-4-5-20251001",
    advanced: "claude-haiku-4-5-20251001",
  },
};

// Que nível cada funcionalidade usa. Só entra no "advanced" quem precisa mesmo.
export const FEATURE_TIER = {
  caption: "fast", ideas: "fast", hooks: "fast", cta: "fast", rewrite: "fast",
  title: "fast", summary: "fast", variations: "fast",
  plan: "standard", strategy: "advanced", positioning: "advanced",
};
// Teto de tokens de SAÍDA por funcionalidade (não paga token à toa).
export const FEATURE_MAX_OUT = {
  caption: 320, hooks: 200, cta: 120, title: 200, rewrite: 400, summary: 300,
  variations: 400, ideas: 700, plan: 1400, strategy: 1600, positioning: 1600,
};

function pickModel(cfg, tier) {
  const prov = AI_MODELS[cfg.provider] ? cfg.provider : "openai";
  // O modelo que o escritório configurou vale como "standard" (respeita a escolha);
  // fast/advanced usam os do roteador para economizar/reforçar conforme a tarefa.
  if (tier === "standard" && cfg.model) return cfg.model;
  return AI_MODELS[prov][tier] || AI_MODELS[prov].standard;
}

// Preço estimado por 1 milhão de tokens (USD) — entrada/cache/saída. Estimativa
// para controle de custo; a cobrança real é do provedor. Cache custa ~50% da entrada.
const PRICE_USD = {
  "gpt-4o-mini": { in: 0.15, out: 0.60 },
  "gpt-4o": { in: 2.5, out: 10.0 },
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
};
const USD_BRL = Number(process.env.AI_USD_BRL) || 5.5; // câmbio p/ estimar em R$
const ym = () => new Date().toISOString().slice(0, 7);

function custoBRL(model, tokensIn, tokensOut, cached = 0) {
  const p = PRICE_USD[model] || PRICE_USD["gpt-4o-mini"];
  const ti = Number(tokensIn) || 0, to = Number(tokensOut) || 0, tc = Number(cached) || 0;
  const usd = ((ti - tc) * p.in + tc * p.in * 0.5 + to * p.out) / 1e6;
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
// ao mês corrente (com custo estimado), grava o registro DETALHADO por chamada
// e dispara os avisos de gasto.
function recordUsage(orgId, { tokensIn, tokensOut, cached = 0, model, tier, feature, clientId, userId, ms, ok = true, error = null }) {
  const ti = Number(tokensIn) || 0, to = Number(tokensOut) || 0, tc = Number(cached) || 0;
  const custo = custoBRL(model, ti, to, tc);
  try {
    db.prepare(
      `INSERT INTO ai_calls (org_id, user_id, client_id, feature, model, tier, tokens_in, tokens_cached, tokens_out, cost_brl, ms, ok, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(orgId, userId ?? null, clientId ?? null, feature ?? null, model ?? null, tier ?? null, ti, tc, to, custo, ms ?? null, ok ? 1 : 0, error);
    if (!ok) return; // chamada que falhou não conta no orçamento nem no total
    db.prepare(
      `INSERT INTO ai_usage (org_id, calls, tokens_in, tokens_out, updated_at)
       VALUES (?, 1, ?, ?, datetime('now'))
       ON CONFLICT(org_id) DO UPDATE SET
         calls = calls + 1, tokens_in = tokens_in + excluded.tokens_in,
         tokens_out = tokens_out + excluded.tokens_out, updated_at = datetime('now')`
    ).run(orgId, ti, to);
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

// Relatório de custo: hoje, mês, e quebras por cliente/usuário/funcionalidade/modelo.
export function usageBreakdown(orgId) {
  const hoje = new Date().toISOString().slice(0, 10);
  const gasto = (whereExtra, params = []) => db.prepare(
    `SELECT COUNT(*) n, COALESCE(SUM(cost_brl),0) brl, COALESCE(SUM(tokens_in+tokens_out),0) tok
     FROM ai_calls WHERE org_id=? AND ok=1 ${whereExtra}`
  ).get(orgId, ...params);
  const porGrupo = (col) => db.prepare(
    `SELECT ${col} k, COUNT(*) n, COALESCE(SUM(cost_brl),0) brl FROM ai_calls
     WHERE org_id=? AND ok=1 AND strftime('%Y-%m', created_at)=? GROUP BY ${col} ORDER BY brl DESC LIMIT 20`
  ).all(orgId, ym());
  const dia = gasto("AND date(created_at)=?", [hoje]);
  const mes = gasto("AND strftime('%Y-%m', created_at)=?", [ym()]);
  return {
    hoje: +dia.brl.toFixed(2), mes: +mes.brl.toFixed(2),
    geracoes_mes: mes.n, media_por_geracao: mes.n ? +(mes.brl / mes.n).toFixed(3) : 0,
    por_funcionalidade: porGrupo("feature"),
    por_modelo: porGrupo("model"),
    por_cliente: porGrupo("client_id"),
    por_usuario: porGrupo("user_id"),
  };
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
export async function askAi(orgId, { system, user, image, feature, tier, maxTokens, clientId, userId }) {
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
  // Guarda de tamanho: prompt gigante nunca deve ir pra API (proteção de custo).
  if ((String(system).length + String(user).length) > 24000) {
    const err = new Error("O contexto ficou grande demais para uma geração.");
    err.code = "TOO_BIG";
    throw err;
  }

  const nivel = tier || FEATURE_TIER[feature] || "standard";
  const model = pickModel(cfg, nivel);
  const max_out = maxTokens || FEATURE_MAX_OUT[feature] || 700;
  // `image` (opcional) é um data URL. Com ele a IA OLHA a arte (visão).
  const img = /^data:(image\/[a-z.+-]+);base64,(.+)$/i.exec(image || "");

  // Timeout: nunca fica pendurado gastando o pedido (proteção contra travas).
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), Number(process.env.AI_TIMEOUT_MS) || 60000);
  const t0 = Date.now();
  const anthropic = cfg.provider === "anthropic";
  const url = anthropic ? "https://api.anthropic.com/v1/messages" : "https://api.openai.com/v1/chat/completions";
  const headers = anthropic
    ? { "content-type": "application/json", "x-api-key": cfg._key, "anthropic-version": "2023-06-01" }
    : { "content-type": "application/json", authorization: `Bearer ${cfg._key}` };
  const body = anthropic
    ? { model, max_tokens: max_out, system, messages: [{ role: "user", content: [...(img ? [{ type: "image", source: { type: "base64", media_type: img[1], data: img[2] } }] : []), { type: "text", text: user }] }] }
    : { model, max_tokens: max_out, temperature: 0.7, messages: [
        { role: "system", content: system },
        { role: "user", content: img ? [{ type: "text", text: user }, { type: "image_url", image_url: { url: image } }] : user },
      ] };

  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ac.signal });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "A IA recusou o pedido.");
    const u = data.usage || {};
    const tokensIn = anthropic ? u.input_tokens : u.prompt_tokens;
    const tokensOut = anthropic ? u.output_tokens : u.completion_tokens;
    const cached = anthropic ? (u.cache_read_input_tokens || 0) : (u.prompt_tokens_details?.cached_tokens || 0);
    recordUsage(orgId, { tokensIn, tokensOut, cached, model, tier: nivel, feature, clientId, userId, ms: Date.now() - t0, ok: true });
    return anthropic ? (data.content?.map((c) => c.text).join("") || "") : (data.choices?.[0]?.message?.content || "");
  } catch (e) {
    recordUsage(orgId, { tokensIn: 0, tokensOut: 0, model, tier: nivel, feature, clientId, userId, ms: Date.now() - t0, ok: false, error: e.name === "AbortError" ? "timeout" : e.message });
    if (e.name === "AbortError") throw new Error("A IA demorou demais para responder. Tente de novo.");
    throw e;
  } finally {
    clearTimeout(to);
  }
}

// Instrução FIXA da plataforma (curta e estável — primeira parte do system,
// para aproveitar cache de prompt do provedor). Não repita regras aqui.
const PLATAFORMA = "Você é uma assistente de social media de uma agência brasileira. "
  + "Escreva em português do Brasil, natural, sem clichês de marketing. É um rascunho para revisão.";

// Quais campos da persona importam em cada tipo de tarefa — CONTEXT BUILDER:
// manda só o necessário, não a persona inteira, para gastar menos tokens.
const CAMPOS_POR_TAREFA = {
  caption: ["tone", "audience", "avoid", "extra"],
  hooks: ["tone", "audience"],
  cta: ["tone", "audience"],
  title: ["tone", "audience"],
  ideas: ["audience", "pillars", "avoid"],
  plan: ["audience", "pillars", "tone", "avoid", "extra"],
  strategy: ["tone", "audience", "pillars", "avoid", "extra"],
};
const ROTULO = { tone: "Tom", audience: "Público", pillars: "Pilares", avoid: "Evitar", extra: "Notas" };

// Monta a instrução de sistema com SÓ o pedaço relevante da persona do cliente.
export function personaSystem(client, persona, feature = "caption") {
  const p = persona || {};
  const campos = CAMPOS_POR_TAREFA[feature] || CAMPOS_POR_TAREFA.caption;
  const marca = [
    `Cliente: ${client.name}${client.company ? ` (${client.company})` : ""}${client.segment ? ` — ${client.segment}` : ""}.`,
    ...campos.filter((k) => p[k]).map((k) => `${ROTULO[k]}: ${p[k]}.`),
  ].join("\n");
  return `${PLATAFORMA}\n${marca}`;
}
