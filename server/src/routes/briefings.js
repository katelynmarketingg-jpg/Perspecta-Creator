import { Router } from "express";
import { randomBytes } from "node:crypto";
import { db } from "../db.js";
import { authRequired, adminRequired, publicBaseUrl } from "../auth.js";
import {
  BRIEFING, BEM_VINDO, perguntasDe, progresso, faltando,
  respostasParaPersona, respostasParaCliente, CAMPOS_CLIENTE,
  getTemplate, saveTemplate, resetTemplate,
} from "../briefing.js";
import { buscaCnpj } from "../cnpj.js";
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
  const secoes = getTemplate(b.org_id).secoes;
  return {
    id: b.id, client_id: b.client_id, token: b.token, status: b.status,
    url: req ? `${publicBaseUrl(req)}/briefing/${b.token}` : null,
    created_at: b.created_at, opened_at: b.opened_at,
    answered_at: b.answered_at, applied_at: b.applied_at,
    progresso: progresso(secoes, respostas),
    respondidas: perguntasDe(secoes).filter((p) => String(respostas[p.id] ?? "").trim()).length,
    total: perguntasDe(secoes).length,
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

// ---- O MODELO do briefing: texto de boas-vindas + perguntas, editáveis -----
// GET devolve o do escritório (o de fábrica enquanto ninguém editou), junto do
// que é possível preencher com cada resposta.
router.get("/template", (req, res) => {
  const t = getTemplate(req.orgId);
  res.json({
    ...t,
    padrao: { welcome: BEM_VINDO, secoes: BRIEFING },
    campos_cliente: Object.entries(CAMPOS_CLIENTE).map(([k, v]) => ({ key: k, rotulo: v.rotulo })),
  });
});

router.put("/template", adminRequired, (req, res) => {
  try {
    res.json(saveTemplate(req.orgId, { welcome: req.body?.welcome, secoes: req.body?.secoes }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Volta ao briefing de fábrica.
router.delete("/template", adminRequired, (req, res) => res.json(resetTemplate(req.orgId)));

// Consulta de CNPJ pelo lado da equipe (para completar um cadastro na mão).
router.get("/cnpj/:cnpj", async (req, res) => res.json(await buscaCnpj(req.params.cnpj)));

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
  const secoes = getTemplate(req.orgId).secoes;
  res.json({ ...resumo(b, req), respostas, secoes, faltando: faltando(secoes, respostas) });
});

// POST /api/briefings/:id/aplicar — as respostas viram a inteligência da IA.
// Por padrão só preenche campo VAZIO (não apaga o que a equipe já escreveu);
// com sobrescrever=true, o briefing manda.
router.post("/:id/aplicar", (req, res) => {
  const b = db.prepare("SELECT * FROM briefings WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!b) return res.status(404).json({ error: "Briefing não encontrado." });

  const cliente = db.prepare("SELECT id, ai_persona FROM clients WHERE id = ? AND org_id = ?").get(b.client_id, req.orgId);
  if (!cliente) return res.status(404).json({ error: "Cliente não encontrado." });

  const respostas = JSON.parse(b.answers || "{}");
  const secoes = getTemplate(req.orgId).secoes;
  const atual = cliente.ai_persona ? JSON.parse(cliente.ai_persona) : {};
  const doBriefing = respostasParaPersona(secoes, respostas);
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

  // E o CADASTRO: razão social, CNPJ, endereço, quem assina, dia do pagamento.
  // É isso que faz o contrato sair pronto e a cobrança nascer na data certa.
  const doCadastro = respostasParaCliente(secoes, respostas);
  const cadastroMudou = [];
  const linha = db.prepare("SELECT * FROM clients WHERE id = ?").get(cliente.id);
  for (const [col, valor] of Object.entries(doCadastro)) {
    const jaTinha = linha[col];
    const regra = CAMPOS_CLIENTE[col];
    // Coluna com valor padrão (rep_doc_type nasce 'cpf') conta como vazia:
    // senão o padrão venceria a resposta do cliente.
    const vazio = regra.contaComoVazio
      ? regra.contaComoVazio(jaTinha)
      : (jaTinha === null || jaTinha === "" || jaTinha === undefined);
    // Fora isso, não apaga o que a equipe já preencheu — a não ser que ela peça.
    if (!vazio && !sobrescrever) continue;
    if (String(jaTinha ?? "") === String(valor)) continue;
    db.prepare(`UPDATE clients SET ${col} = ? WHERE id = ?`).run(valor, cliente.id);
    cadastroMudou.push(col);
  }

  db.prepare("UPDATE briefings SET status = 'aplicado', applied_at = datetime('now') WHERE id = ?").run(b.id);
  res.json({ ok: true, campos: mudou, cadastro: cadastroMudou, persona: novo });
});

// DELETE /api/briefings/:id — apaga o briefing e invalida o link.
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM briefings WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

export default router;
