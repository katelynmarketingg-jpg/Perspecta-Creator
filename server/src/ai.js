import { db } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";

// Modelos padrão de cada provedor (bons e baratos para texto).
const DEFAULT_MODEL = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
};

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
export async function askAi(orgId, { system, user }) {
  const cfg = getAiConfig(orgId);
  if (!cfg.configured) {
    const err = new Error("A chave de IA ainda não foi configurada.");
    err.code = "NO_KEY";
    throw err;
  }

  if (cfg.provider === "anthropic") {
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
        messages: [{ role: "user", content: user }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "A IA recusou o pedido.");
    return data.content?.map((c) => c.text).join("") || "";
  }

  // OpenAI (padrão)
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg._key}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.8,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "A IA recusou o pedido.");
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
