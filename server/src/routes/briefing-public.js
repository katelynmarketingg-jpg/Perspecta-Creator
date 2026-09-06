import { Router } from "express";
import { db } from "../db.js";
import { BRIEFING, PERGUNTAS, progresso, faltando } from "../briefing.js";

// ---------------------------------------------------------------------------
// Briefing — lado do CLIENTE. Sem login: quem tem o link responde.
//
// O que o cliente escreve é salvo a cada passo, então ele pode fechar e voltar
// depois sem perder nada — a diferença mais importante para um formulário do
// Google, junto do fato de as respostas virarem direto a inteligência da IA.
// ---------------------------------------------------------------------------
export const briefingPublicRouter = Router();

const TAMANHO_MAX = 4000;   // por resposta: um texto colado enorme não entra
const IDS = new Set(PERGUNTAS.map((p) => p.id));

function carrega(token) {
  return db.prepare("SELECT * FROM briefings WHERE token = ?").get(String(token || ""));
}

// GET /api/briefing/:token — as perguntas e o que já foi respondido.
briefingPublicRouter.get("/:token", (req, res) => {
  const b = carrega(req.params.token);
  if (!b) return res.status(404).json({ error: "Este link não existe mais." });

  if (!b.opened_at) {
    db.prepare("UPDATE briefings SET opened_at = datetime('now') WHERE id = ?").run(b.id);
  }
  const cliente = db.prepare("SELECT name FROM clients WHERE id = ?").get(b.client_id);
  const org = db.prepare("SELECT name FROM organizations WHERE id = ?").get(b.org_id);
  const respostas = JSON.parse(b.answers || "{}");

  res.json({
    secoes: BRIEFING,
    respostas,
    client_name: cliente?.name || "",
    agency_name: org?.name || "",
    status: b.status,
    progresso: progresso(respostas),
    answered_at: b.answered_at,
  });
});

// PUT /api/briefing/:token — salva o que já foi digitado (a cada passo).
briefingPublicRouter.put("/:token", (req, res) => {
  const b = carrega(req.params.token);
  if (!b) return res.status(404).json({ error: "Este link não existe mais." });

  const entrada = req.body?.respostas || {};
  const atual = JSON.parse(b.answers || "{}");
  // Só perguntas que existem, e cada resposta com teto de tamanho.
  for (const [k, v] of Object.entries(entrada)) {
    if (!IDS.has(k)) continue;
    const texto = Array.isArray(v) ? v.join(", ") : String(v ?? "");
    atual[k] = texto.slice(0, TAMANHO_MAX);
  }
  db.prepare("UPDATE briefings SET answers = ? WHERE id = ?").run(JSON.stringify(atual), b.id);
  res.json({ ok: true, progresso: progresso(atual) });
});

// POST /api/briefing/:token/enviar — o cliente diz que terminou.
briefingPublicRouter.post("/:token/enviar", (req, res) => {
  const b = carrega(req.params.token);
  if (!b) return res.status(404).json({ error: "Este link não existe mais." });

  const respostas = JSON.parse(b.answers || "{}");
  const faltam = faltando(respostas);
  if (faltam.length) {
    return res.status(400).json({ error: "Ainda faltam perguntas obrigatórias.", faltando: faltam });
  }
  db.prepare("UPDATE briefings SET status = 'respondido', answered_at = datetime('now') WHERE id = ?").run(b.id);

  // A equipe fica sabendo na hora, sem precisar ficar conferindo.
  const cliente = db.prepare("SELECT name FROM clients WHERE id = ?").get(b.client_id);
  try {
    db.prepare(
      "INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('agency', ?, NULL, ?, ?)"
    ).run(b.client_id, `📝 ${cliente?.name || "Um cliente"} respondeu o briefing. Aplique na inteligência da IA.`, b.org_id);
  } catch { /* o aviso não pode derrubar o envio */ }

  res.json({ ok: true });
});
