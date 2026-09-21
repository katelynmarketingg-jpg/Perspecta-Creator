import { Router } from "express";
import { randomBytes } from "node:crypto";
import { db } from "../db.js";
import { authRequired, adminRequired, publicBaseUrl } from "../auth.js";
import {
  BRIEFING, BEM_VINDO, perguntasDe, progresso, faltando,
  respostasParaPersona, respostasParaCliente, CAMPOS_CLIENTE,
  respostasParaCentral, DESTINOS_CENTRAL,
  getTemplate, saveTemplate, resetTemplate,
  secoesDoBriefing, leSecoesProprias, salvaSecoesDoBriefing, usaSecoesPadrao,
  listaDeFormularios, getFormulario, criaFormulario, salvaFormulario,
  apagaFormulario, usaFormulario, origemDasPerguntas,
} from "../briefing.js";
import { guardaNaCentral } from "../central.js";
import { modelosDisponiveis, mesesDeVigencia, numeroBR } from "../contract-gen.js";
import { PERSONA_FIELDS } from "../ai.js";

// ---------------------------------------------------------------------------
// Briefing — lado da EQUIPE (exige login). O lado do cliente é público e mora
// em routes/briefing-public.js.
// ---------------------------------------------------------------------------
const router = Router();
router.use(authRequired);

const CAMPOS_VALIDOS = new Set(PERSONA_FIELDS.map((f) => f.key));

/** Os termos comerciais guardados (o que a AGÊNCIA preencheu ao abrir o onboarding). */
function leTermos(b) {
  try { return b.terms ? JSON.parse(b.terms) : null; } catch { return null; }
}

/**
 * Só o que faz sentido guardar — e nada de lixo vindo do formulário. Datas em
 * AAAA-MM-DD, números como números, o resto texto curto.
 */
function saneiaTermos(entrada = {}) {
  const data = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
  // numeroBR e não Number: quem preenche escreve "1.500,50", do jeito daqui.
  // Com Number, isso virava 0 e o contrato saía valendo zero, sem aviso.
  const num = (v) => (v === "" || v === null || v === undefined ? null : numeroBR(v));
  const itens = Array.isArray(entrada.itens)
    ? entrada.itens
        .map((i) => ({ label: String(i.label || "").trim().slice(0, 80), unit: String(i.unit || "").trim().slice(0, 40), quantidade: num(i.quantidade) }))
        .filter((i) => i.label)
        .slice(0, 20)
    : [];
  return {
    service_id: entrada.service_id ? Number(entrada.service_id) : null,
    template_id: entrada.template_id ? Number(entrada.template_id) : null,
    servico: String(entrada.servico || "").trim().slice(0, 160),
    value: num(entrada.value),
    itens,
    start_date: data(entrada.start_date),
    end_date: data(entrada.end_date),
    contract_date: data(entrada.contract_date),
    duration_months: mesesDeVigencia(data(entrada.start_date), data(entrada.end_date)),
    observacoes: String(entrada.observacoes || "").trim().slice(0, 1000),
  };
}

function resumo(b, req) {
  const respostas = JSON.parse(b.answers || "{}");
  // As perguntas DESTE cliente (as dele, se tiver; senão as da casa).
  const secoes = secoesDoBriefing(b);
  return {
    id: b.id, client_id: b.client_id, token: b.token, status: b.status,
    url: req ? `${publicBaseUrl(req)}/briefing/${b.token}` : null,
    created_at: b.created_at, opened_at: b.opened_at,
    answered_at: b.answered_at, applied_at: b.applied_at,
    closed_at: b.closed_at || null,
    progresso: progresso(secoes, respostas),
    respondidas: perguntasDe(secoes).filter((p) => String(respostas[p.id] ?? "").trim()).length,
    total: perguntasDe(secoes).length,
    perguntas_proprias: Boolean(leSecoesProprias(b)),
    form_id: b.form_id || null,
    origem: origemDasPerguntas(b),   // de onde saem as perguntas deste cliente
    termos: leTermos(b),
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
    destinos_central: Object.entries(DESTINOS_CENTRAL).map(([k, v]) => ({ key: k, rotulo: v.rotulo })),
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

// POST /api/briefings — cria (ou devolve) o link do cliente.
router.post("/", (req, res) => {
  const clientId = Number(req.body?.client_id);
  const c = db.prepare("SELECT id FROM clients WHERE id = ? AND org_id = ?").get(clientId, req.orgId);
  if (!c) return res.status(404).json({ error: "Cliente não encontrado." });

  // Um briefing ABERTO por cliente: clicar de novo devolve o mesmo link, em vez
  // de espalhar links diferentes para a mesma pessoa.
  // Encerrado também não conta: se ela fechou aquele onboarding e está abrindo
  // de novo, é porque quer um novo — não reaproveitar o link fechado.
  const existente = db.prepare(
    `SELECT * FROM briefings WHERE org_id = ? AND client_id = ?
       AND status NOT IN ('aplicado', 'encerrado') ORDER BY created_at DESC LIMIT 1`
  ).get(req.orgId, clientId);
  if (existente) {
    if (req.body?.termos) {
      db.prepare("UPDATE briefings SET terms = ? WHERE id = ?")
        .run(JSON.stringify(saneiaTermos(req.body.termos)), existente.id);
    }
    // Trocar o formulário de quem já tem link aberto: o link continua o mesmo,
    // só as perguntas mudam. `form_id` ausente no corpo não mexe em nada.
    if ("form_id" in (req.body || {})) {
      try { usaFormulario(existente.id, req.orgId, Number(req.body.form_id) || null); }
      catch (e) { return res.status(400).json({ error: e.message }); }
    }
    return res.json(resumo(db.prepare("SELECT * FROM briefings WHERE id = ?").get(existente.id), req));
  }

  const token = randomBytes(24).toString("base64url");
  // Os termos que só a agência sabe (serviço, quantidades, valor, vigência e a
  // data do contrato) viajam junto: é com eles que o contrato nasce pronto
  // assim que o cliente termina de responder.
  const termos = req.body?.termos ? JSON.stringify(saneiaTermos(req.body.termos)) : null;
  // Qual formulário este cliente vai responder. Sem escolha, o padrão da casa.
  const formId = req.body?.form_id ? Number(req.body.form_id) : null;
  if (formId && !getFormulario(req.orgId, formId)) {
    return res.status(400).json({ error: "Esse formulário não existe mais." });
  }
  const id = db.prepare(
    "INSERT INTO briefings (org_id, client_id, token, terms, form_id) VALUES (?, ?, ?, ?, ?)"
  ).run(req.orgId, clientId, token, termos, formId).lastInsertRowid;
  res.status(201).json(resumo(db.prepare("SELECT * FROM briefings WHERE id = ?").get(id), req));
});

// GET /api/briefings/modelos — os contratos que a casa pode usar, dos dois
// lugares onde ela escreve: Serviços e Modelos de contrato.
router.get("/modelos", (req, res) => res.json(modelosDisponiveis(req.orgId)));

// ---------------------------------------------------------------------------
// FORMULÁRIOS COM NOME.
//
// Ficam ANTES de /:id de propósito: registrada depois, a rota "/formularios"
// seria engolida por "/:id" e cairia como se "formularios" fosse um número.
// ---------------------------------------------------------------------------

// GET /api/briefings/formularios — a estante de formulários da casa.
router.get("/formularios", (req, res) => {
  const padrao = getTemplate(req.orgId);
  res.json({
    // O padrão entra na lista como uma opção de verdade: é ele que vale quando
    // ela não escolhe nada, e é dele que um formulário novo costuma nascer.
    padrao: { id: null, name: "Padrão da casa", etapas: padrao.secoes.length,
              perguntas: perguntasDe(padrao.secoes).length },
    formularios: listaDeFormularios(req.orgId),
  });
});

// POST /api/briefings/formularios — cria. Sem perguntas, nasce igual ao padrão.
router.post("/formularios", (req, res) => {
  try {
    // `copiar_de` faz o novo nascer igual a um formulário que já existe — é o
    // caminho de "quase igual ao de advocacia, mas com três perguntas a menos".
    let secoes = req.body?.secoes;
    if (!secoes && req.body?.copiar_de) {
      secoes = getFormulario(req.orgId, Number(req.body.copiar_de))?.secoes;
    }
    res.status(201).json(criaFormulario(req.orgId, { nome: req.body?.nome, secoes }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/briefings/formularios/:fid — um formulário inteiro, para editar.
router.get("/formularios/:fid", (req, res) => {
  const f = getFormulario(req.orgId, Number(req.params.fid));
  if (!f) return res.status(404).json({ error: "Formulário não encontrado." });
  res.json({
    ...f,
    campos_cliente: Object.entries(CAMPOS_CLIENTE).map(([k, v]) => ({ key: k, rotulo: v.rotulo })),
    destinos_central: Object.entries(DESTINOS_CENTRAL).map(([k, v]) => ({ key: k, rotulo: v.rotulo })),
  });
});

// PUT /api/briefings/formularios/:fid — salvar (as perguntas, o nome, ou os dois).
router.put("/formularios/:fid", (req, res) => {
  try {
    const f = salvaFormulario(req.orgId, Number(req.params.fid), {
      nome: req.body?.nome,
      secoes: req.body?.secoes,
    });
    if (!f) return res.status(404).json({ error: "Formulário não encontrado." });
    res.json(f);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/briefings/formularios/:fid — quem usava volta ao padrão da casa.
router.delete("/formularios/:fid", (req, res) => {
  const r = apagaFormulario(req.orgId, Number(req.params.fid));
  if (!r.apagado) return res.status(404).json({ error: "Formulário não encontrado." });
  res.json(r);
});

// PUT /api/briefings/:id/formulario — trocar o formulário DESTE cliente.
router.put("/:id/formulario", (req, res) => {
  const b = db.prepare("SELECT * FROM briefings WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!b) return res.status(404).json({ error: "Onboarding não encontrado." });
  try {
    usaFormulario(b.id, req.orgId, Number(req.body?.form_id) || null);
    res.json(resumo(db.prepare("SELECT * FROM briefings WHERE id = ?").get(b.id), req));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/briefings/:id/termos — corrigir o que ela preencheu, sem refazer o link.
router.put("/:id/termos", (req, res) => {
  const b = db.prepare("SELECT * FROM briefings WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!b) return res.status(404).json({ error: "Onboarding não encontrado." });
  db.prepare("UPDATE briefings SET terms = ? WHERE id = ?")
    .run(JSON.stringify(saneiaTermos(req.body?.termos || {})), b.id);
  res.json(resumo(db.prepare("SELECT * FROM briefings WHERE id = ?").get(b.id), req));
});

// GET /api/briefings/:id — as respostas, com as perguntas junto para exibir.
router.get("/:id", (req, res) => {
  const b = db.prepare("SELECT * FROM briefings WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!b) return res.status(404).json({ error: "Briefing não encontrado." });
  const respostas = JSON.parse(b.answers || "{}");
  const secoes = secoesDoBriefing(b);
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
  const secoes = secoesDoBriefing(b);
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

  // E a CENTRAL: acessos e senhas. A resposta sai do texto do briefing e passa
  // a viver lá, criptografada — senha não pode ficar em texto puro no
  // formulário nem à vista de quem abrir as respostas.
  const paraCentral = respostasParaCentral(secoes, respostas);
  const central = [];
  let mexeuNasRespostas = false;
  for (const item of paraCentral) {
    guardaNaCentral(req.orgId, cliente.id, item);
    central.push(item.title);
    if (item.kind === "credential") {
      respostas[item.pergunta] = "(guardado na Central)";
      mexeuNasRespostas = true;
    }
  }
  if (mexeuNasRespostas) {
    db.prepare("UPDATE briefings SET answers = ? WHERE id = ?").run(JSON.stringify(respostas), b.id);
  }

  db.prepare("UPDATE briefings SET status = 'aplicado', applied_at = datetime('now') WHERE id = ?").run(b.id);
  res.json({ ok: true, campos: mudou, cadastro: cadastroMudou, central, persona: novo });
});

// ---------------------------------------------------------------------------
// O QUESTIONÁRIO DESTE CLIENTE.
//
// O modelo da casa serve para a maioria, mas não para todo mundo: um escritório
// de advocacia e uma pastelaria não respondem às mesmas perguntas. Aqui ela
// monta um questionário só daquele cliente, que fica guardado com ele. Voltar
// ao padrão é um clique — o modelo da casa continua inteiro, sem risco.
// ---------------------------------------------------------------------------

// GET /api/briefings/:id/perguntas — as perguntas que valem para este cliente.
router.get("/:id/perguntas", (req, res) => {
  const b = db.prepare("SELECT * FROM briefings WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!b) return res.status(404).json({ error: "Onboarding não encontrado." });
  const proprias = leSecoesProprias(b);
  res.json({
    proprias: Boolean(proprias),
    // O que ele responde hoje — venha de onde vier. É o ponto de partida da
    // edição: ela não começa de uma folha em branco.
    secoes: secoesDoBriefing(b),
    origem: origemDasPerguntas(b),
    form_id: b.form_id || null,
    // A estante inteira, para ela poder só trocar de formulário em vez de editar.
    formularios: listaDeFormularios(req.orgId),
    padrao: getTemplate(req.orgId).secoes,   // para ela comparar, ou começar dali
    campos_cliente: Object.entries(CAMPOS_CLIENTE).map(([k, v]) => ({ key: k, rotulo: v.rotulo })),
    destinos_central: Object.entries(DESTINOS_CENTRAL).map(([k, v]) => ({ key: k, rotulo: v.rotulo })),
  });
});

// PUT /api/briefings/:id/perguntas — guarda o questionário só deste cliente.
router.put("/:id/perguntas", (req, res) => {
  const b = db.prepare("SELECT * FROM briefings WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!b) return res.status(404).json({ error: "Onboarding não encontrado." });
  try {
    const secoes = salvaSecoesDoBriefing(b.id, req.body?.secoes);
    const atualizado = db.prepare("SELECT * FROM briefings WHERE id = ?").get(b.id);
    res.json({ proprias: true, secoes, ...resumo(atualizado, req) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/briefings/:id/perguntas — volta este cliente ao modelo da casa.
router.delete("/:id/perguntas", (req, res) => {
  const b = db.prepare("SELECT id FROM briefings WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!b) return res.status(404).json({ error: "Onboarding não encontrado." });
  usaSecoesPadrao(b.id);
  const atualizado = db.prepare("SELECT * FROM briefings WHERE id = ?").get(b.id);
  res.json({ proprias: false, secoes: getTemplate(req.orgId).secoes, ...resumo(atualizado, req) });
});

// ---------------------------------------------------------------------------
// FECHAR O ONBOARDING.
//
// Chega uma hora em que aquele onboarding acabou: o cliente respondeu o que
// tinha de responder, ou entrou por outro caminho e não vai preencher nada.
// Encerrar tira ele da fila de pendentes e faz o link parar de aceitar
// resposta — sem apagar nada do que já foi dito.
// ---------------------------------------------------------------------------
router.post("/:id/encerrar", (req, res) => {
  const b = db.prepare("SELECT * FROM briefings WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!b) return res.status(404).json({ error: "Onboarding não encontrado." });
  db.prepare("UPDATE briefings SET status = 'encerrado', closed_at = datetime('now') WHERE id = ?").run(b.id);
  res.json(resumo(db.prepare("SELECT * FROM briefings WHERE id = ?").get(b.id), req));
});

// E o caminho de volta: encerrou sem querer, ou o cliente pediu para responder.
router.post("/:id/reabrir", (req, res) => {
  const b = db.prepare("SELECT * FROM briefings WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!b) return res.status(404).json({ error: "Onboarding não encontrado." });
  // Quem já tinha respondido volta para "respondido"; o resto, para "aberto".
  const volta = b.answered_at ? "respondido" : "aberto";
  db.prepare("UPDATE briefings SET status = ?, closed_at = NULL WHERE id = ?").run(volta, b.id);
  res.json(resumo(db.prepare("SELECT * FROM briefings WHERE id = ?").get(b.id), req));
});

// DELETE /api/briefings/:id — apaga o briefing e invalida o link.
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM briefings WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

export default router;
