import { Router } from "express";
import { db } from "../db.js";
import { authRequired, adminRequired } from "../auth.js";
import { getAiConfig, saveAiConfig, askAi, personaSystem } from "../ai.js";

const router = Router();
router.use(authRequired);

// ---- Configuração (chave) — só admin ----
router.get("/config", (req, res) => {
  const cfg = getAiConfig(req.orgId);
  res.json({ configured: cfg.configured, provider: cfg.provider, model: cfg.model });
});

router.put("/config", adminRequired, (req, res) => {
  const { provider, api_key, model } = req.body || {};
  saveAiConfig(req.orgId, { provider, api_key, model });
  const cfg = getAiConfig(req.orgId);
  res.json({ configured: cfg.configured, provider: cfg.provider, model: cfg.model });
});

// ---- Persona por cliente ----
router.get("/persona/:clientId", (req, res) => {
  const c = db.prepare("SELECT id, ai_persona FROM clients WHERE id = ? AND org_id = ?").get(req.params.clientId, req.orgId);
  if (!c) return res.status(404).json({ error: "Cliente não encontrado." });
  res.json(c.ai_persona ? JSON.parse(c.ai_persona) : {});
});

router.put("/persona/:clientId", (req, res) => {
  const c = db.prepare("SELECT id FROM clients WHERE id = ? AND org_id = ?").get(req.params.clientId, req.orgId);
  if (!c) return res.status(404).json({ error: "Cliente não encontrado." });
  db.prepare("UPDATE clients SET ai_persona = ? WHERE id = ?").run(JSON.stringify(req.body || {}), c.id);
  res.json({ ok: true });
});

// ---- Geração ----
// kind: caption (legendas) | ideas (ideias de post) | plan (planejamento do mês)
router.post("/generate", async (req, res) => {
  const { client_id, kind, topic, count } = req.body || {};
  const client = db.prepare("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(client_id, req.orgId);
  if (!client) return res.status(404).json({ error: "Cliente não encontrado." });

  const persona = client.ai_persona ? JSON.parse(client.ai_persona) : {};
  const system = personaSystem(client, persona);

  const n = Math.min(Math.max(Number(count) || 3, 1), 10);
  let user;
  if (kind === "caption") {
    user = `Escreva ${n} opções de legenda para um post${topic ? ` sobre: ${topic}` : ""}. `
      + `Cada uma com no máximo 4 linhas, com uma chamada para ação e hashtags no fim. `
      + `Separe as opções com "---".`;
  } else if (kind === "ideas") {
    user = `Sugira ${n} ideias de post${topic ? ` no tema: ${topic}` : ""}. `
      + `Para cada uma: um título curto e uma frase explicando o que mostrar. Numere.`;
  } else if (kind === "plan") {
    user = `Monte um rascunho de planejamento de conteúdo para o próximo mês${topic ? ` com foco em: ${topic}` : ""}. `
      + `Organize por semana, misturando os pilares de conteúdo, com o formato sugerido (post, reel, story) para cada item.`;
  } else {
    return res.status(400).json({ error: "Tipo inválido." });
  }

  try {
    const text = await askAi(req.orgId, { system, user });
    res.json({ text });
  } catch (e) {
    if (e.code === "NO_KEY") return res.status(400).json({ error: e.message, needs_key: true });
    res.status(502).json({ error: e.message });
  }
});

export default router;
