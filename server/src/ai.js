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
  "gpt-4.1-mini": { in: 0.40, out: 1.60 },
  "gpt-4.1": { in: 2.0, out: 8.0 },
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
};
// Modelo fora da tabela: em vez de fingir que custa o mais barato (o que
// esconderia gasto no painel), estima pelo mais CARO conhecido. Assim o número
// erra para o lado seguro e o limite do mês protege de verdade.
const PRICE_DESCONHECIDO = { in: 2.5, out: 10.0 };
const USD_BRL = Number(process.env.AI_USD_BRL) || 5.5; // câmbio p/ estimar em R$
const ym = () => new Date().toISOString().slice(0, 7);

function custoBRL(model, tokensIn, tokensOut, cached = 0) {
  const p = PRICE_USD[model] || PRICE_DESCONHECIDO;
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
  // A chave fica cifrada. Se o segredo do servidor mudou, decrypt() devolve
  // null — e antes isso ia para a API como "Bearer null", que a OpenAI recusa
  // com uma mensagem sem sentido para quem está usando. Agora dizemos a
  // verdade: a chave existe, mas não é mais legível; é preciso colar de novo.
  const chave = decrypt(row.api_key);
  return {
    configured: Boolean(chave),
    key_unreadable: Boolean(row.api_key) && !chave,
    provider: row.provider,
    model: row.model || DEFAULT_MODEL[row.provider],
    _key: chave,
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

/**
 * Limpa a chave colada. O site do provedor costuma trazer junto espaço, quebra
 * de linha ou aspas — e um "\n" no meio faz o pedido nem sair do servidor
 * (o Node recusa o cabeçalho). Some com tudo o que não é caractere de chave.
 */
export function limpaChave(bruta) {
  const k = String(bruta ?? "").replace(/[\s"'`]+/g, "");
  return k || null;
}

export function saveAiConfig(orgId, { provider, api_key, model }) {
  const prov = provider === "anthropic" ? "anthropic" : "openai";
  api_key = limpaChave(api_key);
  db.prepare(
    `INSERT INTO org_ai (org_id, provider, api_key, model, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(org_id) DO UPDATE SET
       provider = excluded.provider,
       api_key = COALESCE(excluded.api_key, org_ai.api_key),
       model = excluded.model, updated_at = datetime('now')`
  ).run(orgId, prov, api_key ? encrypt(api_key) : null, model || DEFAULT_MODEL[prov]);
}

// ---------------------------------------------------------------------------
// O QUE O PROVEDOR RESPONDEU, EM PORTUGUÊS.
//
// Antes a mensagem da OpenAI ia crua para a tela ("You exceeded your current
// quota…") — em inglês e sem dizer o que fazer. Aqui viram frases que apontam
// o conserto. `code` deixa o front tratar cada caso.
// ---------------------------------------------------------------------------
export function traduzErroProvedor(status, data, provider = "openai") {
  const bruto = data?.error?.message || data?.message || "";
  const tipo = data?.error?.type || data?.error?.code || "";
  const t = `${tipo} ${bruto}`.toLowerCase();
  const M = (code, msg) => ({ code, message: msg, raw: bruto });

  if (/insufficient_quota|exceeded your current quota|credit balance is too low|billing/.test(t)) {
    return M("SEM_CREDITO", provider === "anthropic"
      ? "A conta da Anthropic está sem créditos. Adicione créditos em console.anthropic.com → Billing."
      : "A conta da OpenAI está sem créditos. Atenção: a API é pré-paga e é SEPARADA do ChatGPT Plus — "
        + "ter o Plus não libera a API. Adicione créditos em platform.openai.com → Billing → Add to credit balance.");
  }
  if (status === 401 || /invalid_api_key|incorrect api key|authentication/.test(t)) {
    return M("CHAVE_INVALIDA", "A chave não foi aceita pelo provedor. Gere uma nova e cole de novo — "
      + "copie inteira, sem espaços, e confira se o provedor selecionado é o mesmo da chave.");
  }
  if (status === 403 && /country|region|territory|unsupported/.test(t)) {
    return M("REGIAO", "O provedor recusou o acesso a partir deste país/região.");
  }
  if (status === 403 || /permission|does not have access|model_not_found|do not have access/.test(t)) {
    return M("SEM_ACESSO_MODELO", "Sua conta não tem acesso a este modelo. "
      + "Em contas novas da OpenAI o acesso costuma liberar depois do primeiro crédito comprado.");
  }
  if (status === 404) return M("MODELO_INEXISTENTE", "O modelo configurado não existe nesta conta.");
  if (status === 429) {
    return M("MUITOS_PEDIDOS", "O provedor pediu para esperar (muitos pedidos seguidos). Tente de novo em alguns segundos.");
  }
  if (status >= 500) return M("PROVEDOR_FORA", "O provedor está instável agora. Tente de novo em instantes.");
  // Erro que não sabemos classificar: explica em português e mostra o que o
  // provedor disse — sem isso, sobra um "não funcionou" que não ajuda ninguém.
  return M("RECUSADO", bruto
    ? `O provedor recusou o pedido. Ele respondeu: "${bruto}"`
    : "O provedor recusou o pedido, sem dizer o motivo.");
}

// Alguns modelos mais novos da OpenAI recusam `max_tokens` (querem
// `max_completion_tokens`) ou só aceitam a temperatura padrão. Em vez de manter
// uma lista de nomes de modelo que envelhece, lemos a reclamação e refazemos o
// pedido UMA vez sem o parâmetro reclamado.
function ajustaParametroRecusado(body, mensagem) {
  const m = String(mensagem || "");
  if (/max_tokens/.test(m) && /max_completion_tokens/.test(m) && body.max_tokens != null) {
    const b = { ...body, max_completion_tokens: body.max_tokens };
    delete b.max_tokens;
    return b;
  }
  if (/temperature/.test(m) && body.temperature != null) {
    const b = { ...body };
    delete b.temperature;
    return b;
  }
  return null;
}

/**
 * Testa a chave com a chamada mais barata possível (1 token de saída).
 * Devolve o que está acontecendo, em português.
 */
export async function testKey(orgId) {
  const cfg = getAiConfig(orgId);
  if (cfg.key_unreadable) {
    return { ok: false, code: "CHAVE_ILEGIVEL",
      message: "A chave guardada não pôde ser lida (o segredo do servidor mudou). Cole a chave de novo." };
  }
  if (!cfg.configured) return { ok: false, code: "NO_KEY", message: "Nenhuma chave configurada ainda." };

  const anthropic = cfg.provider === "anthropic";
  const model = AI_MODELS[anthropic ? "anthropic" : "openai"].fast;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await fetch(
      anthropic ? "https://api.anthropic.com/v1/messages" : "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: anthropic
          ? { "content-type": "application/json", "x-api-key": cfg._key, "anthropic-version": "2023-06-01" }
          : { "content-type": "application/json", authorization: `Bearer ${cfg._key}` },
        body: JSON.stringify(anthropic
          ? { model, max_tokens: 1, messages: [{ role: "user", content: "ok" }] }
          : { model, max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
        signal: ac.signal,
      }
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, model, message: `Chave funcionando (${model}).` };
    return { ok: false, ...traduzErroProvedor(res.status, data, cfg.provider) };
  } catch (e) {
    return { ok: false, code: "REDE",
      message: e.name === "AbortError"
        ? "O provedor não respondeu a tempo."
        : `Não consegui falar com o provedor: ${e.message}` };
  } finally {
    clearTimeout(to);
  }
}

/**
 * Chama o modelo com uma instrução de sistema + o pedido do usuário.
 * Abstrai OpenAI e Anthropic para o resto do sistema não se importar com qual é.
 */
export async function askAi(orgId, { system, user, image, feature, tier, maxTokens, clientId, userId }) {
  const cfg = getAiConfig(orgId);
  if (cfg.key_unreadable) {
    const err = new Error("A chave de IA guardada não pôde ser lida (o segredo do servidor mudou). "
      + "Abra a aba IA e cole a chave de novo.");
    err.code = "NO_KEY";
    throw err;
  }
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
    let corpo = body;
    let res = await fetch(url, { method: "POST", headers, body: JSON.stringify(corpo), signal: ac.signal });
    let data = await res.json();
    // Parâmetro recusado por um modelo mais novo: refaz UMA vez sem ele.
    if (!res.ok && res.status === 400) {
      const ajustado = ajustaParametroRecusado(corpo, data.error?.message);
      if (ajustado) {
        corpo = ajustado;
        res = await fetch(url, { method: "POST", headers, body: JSON.stringify(corpo), signal: ac.signal });
        data = await res.json();
      }
    }
    if (!res.ok) {
      const t = traduzErroProvedor(res.status, data, cfg.provider);
      const err = new Error(t.message);
      err.code = t.code;
      err.provider_raw = t.raw;
      throw err;
    }
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

// ---------------------------------------------------------------------------
// CAMADA 1 — instrução FIXA da plataforma. Curta, estável e sempre no começo do
// system: é a parte que o provedor pode reaproveitar em cache. Não repita
// regras aqui; regra de marca vive na camada 2.
// ---------------------------------------------------------------------------
const PLATAFORMA = "Você é uma assistente de social media de uma agência brasileira. "
  + "Escreva em português do Brasil, natural, sem clichês de marketing. É um rascunho para revisão.";

// ---------------------------------------------------------------------------
// PERFIL ESTRUTURADO DO CLIENTE (camada 2).
//
// Os campos ficam guardados por cliente e NÃO viram um prompt gigante: cada
// tarefa leva só os que mudam a resposta dela. As cinco primeiras chaves são as
// antigas — o que já estava preenchido continua valendo.
// `max` é o teto de caracteres do campo dentro do prompt: um campo escrito à
// vontade não estoura o orçamento da geração.
// ---------------------------------------------------------------------------
export const PERSONA_FIELDS = [
  { key: "tone", label: "Tom", max: 200 },
  { key: "audience", label: "Público", max: 200 },
  { key: "pillars", label: "Pilares", max: 260 },
  { key: "avoid", label: "Evitar", max: 200 },
  { key: "extra", label: "Notas", max: 400 },
  { key: "segment", label: "Segmento", max: 120 },
  { key: "services", label: "Serviços", max: 260 },
  { key: "positioning", label: "Posicionamento", max: 200 },
  { key: "personality", label: "Personalidade", max: 160 },
  { key: "expressions", label: "Expressões da marca", max: 200 },
  { key: "avoid_words", label: "Palavras proibidas", max: 200 },
  { key: "differentials", label: "Diferenciais", max: 240 },
  { key: "goals", label: "Objetivo", max: 160 },
  { key: "location", label: "Onde atua", max: 120 },
  { key: "cta", label: "CTA preferido", max: 160 },
  { key: "rules", label: "Regras", max: 300 },
  { key: "restrictions", label: "Restrições", max: 240 },
  { key: "examples", label: "Exemplo aprovado", max: 500 },
];
const CAMPO = Object.fromEntries(PERSONA_FIELDS.map((f) => [f.key, f]));

// CONTEXT BUILDER: quais campos cada tarefa realmente usa, em ordem de
// importância. Se o contexto estourar o orçamento, o corte começa pelo fim.
const CAMPOS_POR_TAREFA = {
  caption: ["tone", "audience", "cta", "avoid_words", "avoid", "expressions", "restrictions", "rules", "location", "extra"],
  hooks: ["tone", "audience", "expressions", "avoid_words"],
  cta: ["tone", "audience", "cta", "goals"],
  title: ["tone", "audience", "avoid_words"],
  rewrite: ["tone", "avoid_words", "avoid", "expressions"],
  variations: ["tone", "audience", "avoid_words"],
  summary: [],
  ideas: ["segment", "audience", "pillars", "services", "goals", "differentials", "avoid", "location"],
  plan: ["segment", "audience", "pillars", "services", "tone", "goals", "avoid", "location", "extra"],
  strategy: ["segment", "positioning", "audience", "services", "differentials", "goals", "pillars", "tone", "personality", "restrictions", "location", "extra"],
  positioning: ["segment", "positioning", "audience", "services", "differentials", "goals", "personality", "location", "extra"],
};

// ---------------------------------------------------------------------------
// ORÇAMENTO DE CONTEXTO por tamanho de tarefa (em caracteres — ~4 por token).
// Legenda precisa de pouco; planejamento precisa de mais; estratégia, mais
// ainda. O que passar do teto é cortado do fim, campo a campo.
// ---------------------------------------------------------------------------
// (O orçamento vale para a parte do CLIENTE — perfil + memória. A instrução
// fixa da plataforma e a linha "Cliente: ..." ficam sempre, e são curtas.)
export const CONTEXT_BUDGET = { fast: 900, standard: 1800, advanced: 3200 };

/** Corta no limite sem picar palavra no meio. */
function apara(texto, max) {
  const t = String(texto || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

/**
 * Monta a instrução de sistema com SÓ o pedaço relevante do perfil do cliente,
 * dentro do orçamento da tarefa. Devolve texto pronto.
 *
 * `memoria` é o resumo curto de preferências aprendidas (camada 4) — entra
 * quando existe, e é o primeiro a sair se o orçamento apertar.
 */
export function personaSystem(client, persona, feature = "caption", memoria = null) {
  const p = persona || {};
  const tier = FEATURE_TIER[feature] || "standard";
  const orcamento = CONTEXT_BUDGET[tier] || CONTEXT_BUDGET.standard;

  const cabecalho = `Cliente: ${client.name}${client.company ? ` (${client.company})` : ""}`
    + `${client.segment ? ` — ${client.segment}` : ""}.`;

  const chaves = CAMPOS_POR_TAREFA[feature] || CAMPOS_POR_TAREFA.caption;
  const linhas = chaves
    .filter((k) => p[k] && String(p[k]).trim())
    .map((k) => `${CAMPO[k]?.label || k}: ${apara(p[k], CAMPO[k]?.max || 200)}`);

  const mem = memoria ? `Preferências já combinadas: ${apara(memoria, 400)}` : null;

  // Corta do fim até caber. O cabeçalho (quem é o cliente) nunca sai.
  const partes = [...linhas, ...(mem ? [mem] : [])];
  while (partes.length && partes.join("\n").length + cabecalho.length > orcamento) partes.pop();

  return [PLATAFORMA, cabecalho, ...partes].join("\n");
}

// ---------------------------------------------------------------------------
// RECUPERAÇÃO SELETIVA (camada 3). Para "não repetir assunto" a IA precisa
// saber o que JÁ foi feito — mas só os TÍTULOS, nunca os textos inteiros.
// Alguns títulos custam dezenas de tokens; os posts completos custariam
// milhares e não melhorariam a resposta.
// ---------------------------------------------------------------------------
export function temasRecentes(orgId, clientId, { dias = 60, max = 20 } = {}) {
  if (!clientId) return [];
  const linhas = db.prepare(
    `SELECT DISTINCT title FROM tasks
      WHERE org_id = ? AND client_id = ? AND title IS NOT NULL AND title <> ''
        AND COALESCE(scheduled_at, created_at) >= date('now', ?)
      ORDER BY COALESCE(scheduled_at, created_at) DESC LIMIT ?`
  ).all(orgId, clientId, `-${Number(dias) || 60} days`, Math.min(Number(max) || 20, 40));
  // Teto do bloco inteiro: um cliente com títulos muito longos não pode fazer
  // a lista de "não repita" custar mais do que a própria resposta.
  const out = [];
  let usado = 0;
  for (const l of linhas) {
    const t = apara(l.title, 60);
    if (!t) continue;
    if (usado + t.length > 900) break;
    out.push(t); usado += t.length + 2;
  }
  return out;
}
