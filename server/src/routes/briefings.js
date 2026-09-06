import { Router } from "express";
import { randomBytes } from "node:crypto";
import { db } from "../db.js";
import { authRequired, publicBaseUrl } from "../auth.js";
import { BRIEFING, PERGUNTAS, progresso, faltando, respostasParaPersona } from "../briefing.js";
import { PERSONA_FIELDS } from "../ai.js";

// ---------------------------------------------------------------------------
// Briefing — lado da EQUIPE (exige login). O lado do cliente é público e mora
// em routes/briefing-public.js.
// ---------------------------------------------------------------------------
const router = Router();
router.use(authRequired);

const CAMPOS_VALIDOS = new Set(PERSONA_FIELDS.map((f) => f.key));

function resumo(b, req) {
  const respostas = JSON.parse(b.answers || "{}");
  return {
    id: b.id, client_id: b.client_id, token: b.token, status: b.status,
    url: req ? `${publicBaseUrl(req)}/briefing/${b.token}` : null,
    created_at: b.created_at, opened_at: b.opened_at,
    answered_at: b.answered_at, applied_at: b.applied_at,
    progresso: progresso(respostas),
    respondidas: PERGUNTAS.filter((p) => String(respostas[p.id] ?? "").trim()).length,
    total: PERGUNTAS.length,
  };
}

// GET /api/briefings — um por cliente (o mais recente), para a lista da tela.
router.get("/", (req, res) => {
  const linhas = db.prepare(
    `SELECT b.*, c.name AS client_name FROM briefings b
       JOIN clients c ON c.id = b.client_id
      WHERE b.org_id = ? ORDER BY b.created_at DESC`
  ).all(req.orgId);
  res.json(linhas.map((b) => ({ ...resumo(b, req), client_name: b.client_name })));
});

// GET /api/briefings/perguntas — a lista de perguntas (para a equipe conferir).
router.get("/perguntas", (_req, res) => res.json(BRIEFING));

// POST /api/briefings — cria (ou devolve) o link do cliente.
router.post("/", (req, res) => {
  const clientId = Number(req.body?.client_id);
  const c = db.prepare("SELECT id FROM clients WHERE id = ? AND org_id = ?").get(clientId, req.orgId);
  if (!c) return res.status(404).json({ error: "Cliente não encontrado." });

  // Um briefing ABERTO por cliente: clicar de novo devolve o mesmo link, em vez
  // de espalhar links diferentes para a mesma pessoa.
  const existente = db.prepare(
    "SELECT * FROM briefings WHERE org_id = ? AND client_id = ? AND status <> 'aplicado' ORDER BY created_at DESC LIMIT 1"
  ).get(req.orgId, clientId);
  if (existente) return res.json(resumo(existente, req));

  const token = randomBytes(24).toString("base64url");
  const id = db.prepare("INSERT INTO briefings (org_id, client_id, token) VALUES (?, ?, ?)")
    .run(req.orgId, clientId, token).lastInsertRowid;
  res.status(201).json(resumo(db.prepare("SELECT * FROM briefings WHERE id = ?").get(id), req));
});

// GET /api/briefings/:id — as respostas, com as perguntas junto para exibir.
router.get("/:id", (req, res) => {
  const b = db.prepare("SELECT * FROM briefings WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!b) return res.status(404).json({ error: "Briefing não encontrado." });
  const respostas = JSON.parse(b.answers || "{}");
  res.json({ ...resumo(b, req), respostas, secoes: BRIEFING, faltando: faltando(respostas) });
});

// POST /api/briefings/:id/aplicar — as respostas viram a inteligência da IA.
// Por padrão só preenche campo VAZIO (não apaga o que a equipe já escreveu);
// com sobrescrever=true, o briefing manda.
router.post("/:id/aplicar", (req, res) => {
  const b = db.prepare("SELECT * FROM briefings WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!b) return res.status(404).json({ error: "Briefing não encontrado." });

  const cliente = db.prepare("SELECT id, ai_persona FROM clients WHERE id = ? AND org_id = ?").get(b.client_id, req.orgId);
  if (!cliente) return res.status(404).json({ error: "Cliente não encontrado." });

  const atual = cliente.ai_persona ? JSON.parse(cliente.ai_persona) : {};
  const doBriefing = respostasParaPersona(JSON.parse(b.answers || "{}"));
  const sobrescrever = Boolean(req.body?.sobrescrever);

  const novo = { ...atual };
  const mudou = [];
  for (const [k, v] of Object.entries(doBriefing)) {
    if (!CAMPOS_VALIDOS.has(k)) continue;
    const jaTinha = String(atual[k] ?? "").trim();
    if (jaTinha && !sobrescrever) continue;
    if (jaTinha === v) continue;
    novo[k] = v;
    mudou.push(k);
  }
  db.prepare("UPDATE clients SET ai_persona = ? WHERE id = ?").run(JSON.stringify(novo), cliente.id);
  db.prepare("UPDATE briefings SET status = 'aplicado', applied_at = datetime('now') WHERE id = ?").run(b.id);
  res.json({ ok: true, campos: mudou, persona: novo });
});

// DELETE /api/briefings/:id — apaga o briefing e invalida o link.
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM briefings WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

export default router;
