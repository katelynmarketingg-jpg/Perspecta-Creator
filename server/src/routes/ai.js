import { Router } from "express";
import { db } from "../db.js";
import { authRequired, adminRequired } from "../auth.js";
import {
  getAiConfig, saveAiConfig, askAi, personaSystem, getBudget, saveBudget,
  usageBreakdown, testKey, temasRecentes, PERSONA_FIELDS,
} from "../ai.js";
import { createHash } from "node:crypto";

const router = Router();
router.use(authRequired);

// ---------------------------------------------------------------------------
// Proteção de custo antes de qualquer geração (memória do processo — 1 instância):
//  • rate limit por usuário (nº de gerações por minuto);
//  • anti-duplo-clique/idempotência: pedido idêntico em curto intervalo é barrado.
// ---------------------------------------------------------------------------
const RL = new Map();          // userId -> [timestamps]
const INFLIGHT = new Map();    // hash -> timestamp (pedido em andamento/recente)
const RL_MAX = Number(process.env.AI_RL_PER_MIN) || 20;

function guardGeneration(req, res, next) {
  const uid = req.user?.id;
  if (!uid) return res.status(401).json({ error: "Sessão necessária." });
  const agora = Date.now();
  const janela = (RL.get(uid) || []).filter((t) => agora - t < 60000);
  if (janela.length >= RL_MAX) {
    return res.status(429).json({ error: "Muitas gerações seguidas. Espere um instante e tente de novo." });
  }
  const hash = createHash("sha1").update(`${uid}:${JSON.stringify(req.body || {})}`).digest("hex");
  const prev = INFLIGHT.get(hash);
  if (prev && agora - prev < 8000) {
    return res.status(409).json({ error: "Esse mesmo pedido já está sendo gerado — evite clicar duas vezes." });
  }
  INFLIGHT.set(hash, agora);
  janela.push(agora); RL.set(uid, janela);
  res.on("finish", () => INFLIGHT.delete(hash));
  // limpeza leve para não crescer sem fim
  if (INFLIGHT.size > 500) for (const [k, t] of INFLIGHT) if (agora - t > 30000) INFLIGHT.delete(k);
  next();
}

// ---- Configuração (chave) — só admin ----
router.get("/config", (req, res) => {
  const cfg = getAiConfig(req.orgId);
  res.json({
    configured: cfg.configured, provider: cfg.provider, model: cfg.model,
    key_unreadable: Boolean(cfg.key_unreadable),
  });
});

// POST /api/ai/test — testa a chave com a chamada mais barata possível e diz,
// em português, o que está acontecendo. É o que responde "por que o botão de
// gerar não funciona" sem a pessoa precisar decifrar o erro do provedor.
router.post("/test", adminRequired, async (req, res) => {
  res.json(await testKey(req.orgId));
});

router.put("/config", adminRequired, (req, res) => {
  const { provider, api_key, model } = req.body || {};
  saveAiConfig(req.orgId, { provider, api_key, model });
  const cfg = getAiConfig(req.orgId);
  res.json({ configured: cfg.configured, provider: cfg.provider, model: cfg.model });
});

// ---- Uso e limite de gasto (R$/mês) ----
router.get("/usage", (req, res) => {
  res.json(getBudget(req.orgId));
});

router.put("/budget", adminRequired, (req, res) => {
  const { warn1, warn2, limit } = req.body || {};
  res.json(saveBudget(req.orgId, { warn1, warn2, limit }));
});

// ---- Persona por cliente ----
router.get("/persona/:clientId", (req, res) => {
  const c = db.prepare("SELECT id, ai_persona, ai_memory FROM clients WHERE id = ? AND org_id = ?")
    .get(req.params.clientId, req.orgId);
  if (!c) return res.status(404).json({ error: "Cliente não encontrado." });
  // O perfil vai puro (o front já espera isso); a memória e a lista de campos
  // vão em chaves próprias, com "_" para não colidirem com um campo de perfil.
  const persona = c.ai_persona ? JSON.parse(c.ai_persona) : {};
  res.json({ ...persona, _memory: c.ai_memory || "", _fields: PERSONA_FIELDS });
});

// PUT /api/ai/memory/:clientId — a memória resumida do cliente (preferências já
// combinadas). É o que evita reenviar conversas antigas a cada geração.
router.put("/memory/:clientId", (req, res) => {
  const c = db.prepare("SELECT id FROM clients WHERE id = ? AND org_id = ?").get(req.params.clientId, req.orgId);
  if (!c) return res.status(404).json({ error: "Cliente não encontrado." });
  const txt = String(req.body?.memory || "").trim().slice(0, 1500);
  db.prepare("UPDATE clients SET ai_memory = ? WHERE id = ?").run(txt || null, c.id);
  res.json({ ok: true, memory: txt });
});

router.put("/persona/:clientId", (req, res) => {
  const c = db.prepare("SELECT id FROM clients WHERE id = ? AND org_id = ?").get(req.params.clientId, req.orgId);
  if (!c) return res.status(404).json({ error: "Cliente não encontrado." });
  // Só grava campos de perfil conhecidos — as chaves de controle ("_memory",
  // "_fields") não entram no JSON da persona nem viram contexto.
  const entrada = req.body || {};
  const limpo = {};
  for (const f of PERSONA_FIELDS) {
    const v = String(entrada[f.key] ?? "").trim();
    if (v) limpo[f.key] = v.slice(0, (f.max || 200) * 3); // folga; o corte fino é no prompt
  }
  db.prepare("UPDATE clients SET ai_persona = ? WHERE id = ?").run(JSON.stringify(limpo), c.id);
  res.json({ ok: true });
});

// ---- Geração ----
// kind: caption (legendas) | ideas (ideias de post) | plan (planejamento do mês)
router.post("/generate", guardGeneration, async (req, res) => {
  const { client_id, kind, topic, count, image } = req.body || {};
  const client = db.prepare("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(client_id, req.orgId);
  if (!client) return res.status(404).json({ error: "Cliente não encontrado." });

  const persona = client.ai_persona ? JSON.parse(client.ai_persona) : {};
  // Camada 4 — memória resumida. Entra em tarefas de ESCRITA, onde continuidade
  // de estilo importa; numa lista de ideias ela não muda a resposta.
  const usaMemoria = ["caption", "rewrite", "variations", "plan", "strategy", "positioning"].includes(kind);
  const system = personaSystem(client, persona, kind, usaMemoria ? client.ai_memory : null);

  const n = Math.min(Math.max(Number(count) || 3, 1), 10);
  let user;
  if (kind === "caption") {
    user = (image
      ? `Olhe a arte do post em anexo e escreva ${n} ${n === 1 ? "legenda" : "opções de legenda"} que combine com o que aparece nela`
      : `Escreva ${n} ${n === 1 ? "legenda" : "opções de legenda"} para um post`)
      + `${topic ? ` (contexto: ${topic})` : ""}. `
      + `Cada uma com no máximo 4 linhas, com uma chamada para ação e hashtags no fim. `
      + (n === 1 ? "Responda só com a legenda, sem numerar." : `Separe as opções com "---".`);
  } else if (kind === "ideas") {
    // RECUPERAÇÃO SELETIVA: para não repetir assunto, a IA precisa saber o que
    // já foi feito — mas só os TÍTULOS. Mandar os posts inteiros custaria
    // milhares de tokens e não melhoraria a lista.
    const jaFeitos = temasRecentes(req.orgId, client.id, { dias: 60, max: 20 });
    user = `Sugira ${n} ideias de post${topic ? ` no tema: ${topic}` : ""}. `
      + `Para cada uma: um título curto e uma frase explicando o que mostrar. Numere.`
      + (jaFeitos.length ? `\nNão repita estes assuntos já publicados: ${jaFeitos.join("; ")}.` : "");
  } else if (kind === "plan") {
    const jaFeitos = temasRecentes(req.orgId, client.id, { dias: 45, max: 15 });
    user = `Monte um rascunho de planejamento de conteúdo para o próximo mês${topic ? ` com foco em: ${topic}` : ""}. `
      + `Organize por semana, misturando os pilares de conteúdo, com o formato sugerido (post, reel, story) para cada item.`
      + (jaFeitos.length ? `\nEvite repetir o que já saiu: ${jaFeitos.join("; ")}.` : "");
  } else {
    return res.status(400).json({ error: "Tipo inválido." });
  }

  try {
    const text = await askAi(req.orgId, {
      system, user, image, feature: kind, clientId: client.id, userId: req.user?.id,
    });
    res.json({ text });
  } catch (e) {
    if (e.code === "NO_KEY") return res.status(400).json({ error: e.message, needs_key: true, code: e.code });
    if (e.code === "BUDGET") return res.status(400).json({ error: e.message, budget_blocked: true, code: e.code });
    if (e.code === "TOO_BIG") return res.status(400).json({ error: e.message, code: e.code });
    // Erro do provedor já traduzido: manda o código junto para a tela poder
    // orientar (falta de crédito é bem diferente de chave errada).
    res.status(502).json({ error: e.message, code: e.code || "RECUSADO" });
  }
});

// ---- Relatório de custo (hoje, mês, por cliente/usuário/funcionalidade/modelo) ----
router.get("/usage/breakdown", (req, res) => {
  res.json(usageBreakdown(req.orgId));
});

export default router;
