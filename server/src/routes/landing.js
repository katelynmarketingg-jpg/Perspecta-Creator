import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";
import {
  vencimentoDoAno, diasAte, situacaoDaRenovacao, soData,
  mensagemDeRenovacao, VALOR_LP_PADRAO, VALOR_RENOVACAO_PADRAO, AVISO_LEMBRETE,
} from "../landing.js";

// ---------------------------------------------------------------------------
// LANDING PAGES — o lado da equipe.
//
// Uma venda única que vira obrigação anual. O que esta rota precisa garantir,
// acima de tudo: que toda LP publicada TENHA uma renovação agendada. Uma LP sem
// renovação é um cliente que ninguém vai cobrar e um site que cai sozinho.
// ---------------------------------------------------------------------------
const router = Router();
router.use(authRequired);

const num = (v, padrao = 0) => {
  if (v === "" || v === null || v === undefined) return padrao;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : padrao;
};
const texto = (v, max = 200) => String(v ?? "").trim().slice(0, max) || null;

const PAGAMENTOS = ["pendente", "parcial", "pago"];
const SITUACOES = ["em_dia", "avisado", "pago", "cancelado"];

/** O que entra no banco — nada de campo solto vindo do formulário. */
function saneia(b = {}) {
  return {
    nicho: texto(b.nicho, 80),
    valor: num(b.valor, VALOR_LP_PADRAO),
    forma_pagamento: texto(b.forma_pagamento, 60),
    parcelas: Math.max(1, Math.round(num(b.parcelas, 1))),
    status_pagamento: PAGAMENTOS.includes(b.status_pagamento) ? b.status_pagamento : "pendente",
    contrato_assinado_em: soData(b.contrato_assinado_em),
    publicado_em: soData(b.publicado_em),
    endereco: texto(b.endereco, 200),
    contrato_url: texto(b.contrato_url, 500),
    entrega_url: texto(b.entrega_url, 500),
    valor_renovacao: num(b.valor_renovacao, VALOR_RENOVACAO_PADRAO),
    dominio_vence_em: soData(b.dominio_vence_em),
    vercel_projeto: texto(b.vercel_projeto, 120),
    vercel_url: texto(b.vercel_url, 500),
    status: b.status === "cancelada" ? "cancelada" : "ativa",
    observacoes: texto(b.observacoes, 2000),
  };
}

/**
 * Garante que existe a renovação do próximo ano ainda não pago.
 *
 * É o coração do módulo: sem isto, publicar um site não agenda nada e o
 * vencimento chega sem ninguém saber. Chamado ao salvar e ao marcar como pago.
 */
export function garanteRenovacao(lp) {
  if (!lp.publicado_em || lp.status === "cancelada") return null;

  const pagos = db.prepare(
    "SELECT ano FROM lp_renovacoes WHERE lp_id = ? AND status = 'pago' ORDER BY ano DESC LIMIT 1"
  ).get(lp.id);
  const proximoAno = (pagos?.ano || 0) + 1;

  const jaExiste = db.prepare("SELECT * FROM lp_renovacoes WHERE lp_id = ? AND ano = ?")
    .get(lp.id, proximoAno);
  if (jaExiste) {
    // A data de publicação pode ter sido corrigida depois: o vencimento
    // acompanha, senão a cobrança sai no dia errado.
    const certo = vencimentoDoAno(lp.publicado_em, proximoAno);
    if (certo && certo !== jaExiste.vence_em) {
      db.prepare("UPDATE lp_renovacoes SET vence_em = ? WHERE id = ?").run(certo, jaExiste.id);
    }
    return db.prepare("SELECT * FROM lp_renovacoes WHERE id = ?").get(jaExiste.id);
  }

  const vence = vencimentoDoAno(lp.publicado_em, proximoAno);
  if (!vence) return null;
  const info = db.prepare(
    `INSERT INTO lp_renovacoes (org_id, lp_id, ano, vence_em, valor) VALUES (?, ?, ?, ?, ?)`
  ).run(lp.org_id, lp.id, proximoAno, vence, lp.valor_renovacao ?? VALOR_RENOVACAO_PADRAO);
  return db.prepare("SELECT * FROM lp_renovacoes WHERE id = ?").get(info.lastInsertRowid);
}

/** Uma LP com o que a tela precisa: o cliente, a próxima renovação e o prazo. */
function comContexto(lp, hoje = new Date()) {
  if (!lp) return lp;
  const renovacoes = db.prepare(
    "SELECT * FROM lp_renovacoes WHERE lp_id = ? ORDER BY ano DESC"
  ).all(lp.id);
  // A próxima é a de maior ano que ainda não foi paga nem cancelada.
  const proxima = [...renovacoes].reverse().find((r) => r.status !== "pago" && r.status !== "cancelado") || null;
  const situacao = proxima ? situacaoDaRenovacao(proxima, hoje) : (lp.status === "cancelada" ? "cancelado" : "em_dia");
  return {
    ...lp,
    renovacoes: renovacoes.map((r) => ({ ...r, situacao: situacaoDaRenovacao(r, hoje) })),
    proxima_renovacao: proxima,
    vence_em: proxima?.vence_em || null,
    dias_para_vencer: proxima ? diasAte(proxima.vence_em, hoje) : null,
    situacao,
  };
}

const SELECT = `SELECT lp.*, c.name AS client_name FROM landing_pages lp
                JOIN clients c ON c.id = lp.client_id`;

// GET /api/landing — todas as LPs, do vencimento mais próximo para o mais longe.
router.get("/", (req, res) => {
  const linhas = db.prepare(`${SELECT} WHERE lp.org_id = ?`).all(req.orgId).map((l) => comContexto(l));
  linhas.sort((a, b) => {
    // Quem não tem vencimento (ainda não publicou) vai para o fim: não há o
    // que cobrar, e ficaria na frente de quem vence amanhã.
    if (a.vence_em && b.vence_em) return a.vence_em.localeCompare(b.vence_em);
    if (a.vence_em) return -1;
    if (b.vence_em) return 1;
    return a.client_name.localeCompare(b.client_name);
  });
  res.json(linhas);
});

// GET /api/landing/relatorio — o que ela precisa olhar antes de começar o mês.
router.get("/relatorio", (req, res) => {
  const hoje = new Date();
  const dias = Math.min(365, Math.max(1, Math.round(num(req.query.dias, 60))));
  const nicho = texto(req.query.nicho, 80);
  const de = soData(req.query.de);
  const ate = soData(req.query.ate);

  let lps = db.prepare(`${SELECT} WHERE lp.org_id = ?`).all(req.orgId).map((l) => comContexto(l, hoje));
  if (nicho) lps = lps.filter((l) => (l.nicho || "") === nicho);

  const noPeriodo = (data) => (!de || (data && data >= de)) && (!ate || (data && data <= ate));
  const vendas = lps.filter((l) => noPeriodo(l.contrato_assinado_em || l.publicado_em));

  const aVencer = lps
    .filter((l) => l.dias_para_vencer !== null && l.dias_para_vencer >= 0 && l.dias_para_vencer <= dias)
    .filter((l) => l.situacao !== "pago" && l.situacao !== "cancelado");
  const atrasadas = lps.filter((l) => l.situacao === "atrasado" || l.situacao === "tolerancia_vencida");

  const ano = hoje.toISOString().slice(0, 4);
  const mes = hoje.toISOString().slice(0, 7);
  const doMes = lps.filter((l) => (l.contrato_assinado_em || l.publicado_em || "").startsWith(mes));
  const doAno = lps.filter((l) => (l.contrato_assinado_em || l.publicado_em || "").startsWith(ano));

  // Receita prevista: o que vence nos próximos 12 meses e ainda não foi pago.
  const limite = new Date(hoje.getTime() + 365 * 86400000).toISOString().slice(0, 10);
  const previstas = db.prepare(
    `SELECT r.valor FROM lp_renovacoes r JOIN landing_pages l ON l.id = r.lp_id
      WHERE r.org_id = ? AND r.status NOT IN ('pago','cancelado')
        AND l.status = 'ativa' AND r.vence_em <= ?`
  ).all(req.orgId, limite);

  const soma = (arr, campo) => arr.reduce((t, x) => t + (Number(x[campo]) || 0), 0);

  res.json({
    dias,
    proximas: aVencer,
    atrasadas,
    vendas_do_mes: { quantidade: doMes.length, valor: soma(doMes, "valor") },
    vendas_do_ano: { quantidade: doAno.length, valor: soma(doAno, "valor") },
    vendas_no_periodo: de || ate ? { quantidade: vendas.length, valor: soma(vendas, "valor") } : null,
    receita_prevista_12m: soma(previstas, "valor"),
    no_ar: lps.filter((l) => l.status === "ativa").length,
    canceladas: lps.filter((l) => l.status === "cancelada").length,
    nichos: [...new Set(lps.map((l) => l.nicho).filter(Boolean))].sort(),
    aviso_lembrete: AVISO_LEMBRETE,
  });
});

// GET /api/landing/:id — a ficha inteira.
router.get("/:id", (req, res) => {
  const lp = db.prepare(`${SELECT} WHERE lp.id = ? AND lp.org_id = ?`).get(req.params.id, req.orgId);
  if (!lp) return res.status(404).json({ error: "Landing page não encontrada." });
  const alteracoes = db.prepare(
    "SELECT * FROM lp_alteracoes WHERE lp_id = ? ORDER BY data DESC, id DESC"
  ).all(lp.id);
  res.json({ ...comContexto(lp), alteracoes });
});

router.post("/", (req, res) => {
  const clientId = Number(req.body?.client_id);
  const c = db.prepare("SELECT id FROM clients WHERE id = ? AND org_id = ?").get(clientId, req.orgId);
  if (!c) return res.status(400).json({ error: "Escolha um cliente." });

  const d = saneia(req.body);
  const campos = Object.keys(d);
  const info = db.prepare(
    `INSERT INTO landing_pages (org_id, client_id, ${campos.join(", ")})
     VALUES (?, ?, ${campos.map(() => "?").join(", ")})`
  ).run(req.orgId, clientId, ...campos.map((k) => d[k]));

  const lp = db.prepare("SELECT * FROM landing_pages WHERE id = ?").get(info.lastInsertRowid);
  garanteRenovacao(lp);
  res.status(201).json(comContexto(db.prepare(`${SELECT} WHERE lp.id = ?`).get(lp.id)));
});

router.put("/:id", (req, res) => {
  const atual = db.prepare("SELECT * FROM landing_pages WHERE id = ? AND org_id = ?")
    .get(req.params.id, req.orgId);
  if (!atual) return res.status(404).json({ error: "Landing page não encontrada." });

  const d = saneia({ ...atual, ...req.body });
  const campos = Object.keys(d);
  db.prepare(`UPDATE landing_pages SET ${campos.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND org_id = ?`)
    .run(...campos.map((k) => d[k]), atual.id, req.orgId);

  const lp = db.prepare("SELECT * FROM landing_pages WHERE id = ?").get(atual.id);
  garanteRenovacao(lp);
  res.json(comContexto(db.prepare(`${SELECT} WHERE lp.id = ?`).get(lp.id)));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM landing_pages WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

// ---- renovações -----------------------------------------------------------

// PUT /api/landing/:id/renovacao/:rid — marcar paga, avisada, cancelada.
router.put("/:id/renovacao/:rid", (req, res) => {
  const r = db.prepare(
    "SELECT r.* FROM lp_renovacoes r JOIN landing_pages l ON l.id = r.lp_id WHERE r.id = ? AND r.lp_id = ? AND r.org_id = ?"
  ).get(req.params.rid, req.params.id, req.orgId);
  if (!r) return res.status(404).json({ error: "Renovação não encontrada." });

  const status = SITUACOES.includes(req.body?.status) ? req.body.status : r.status;
  const valor = req.body?.valor === undefined ? r.valor : num(req.body.valor, r.valor);
  // Marcar paga sem dizer quando é o caso comum: é hoje.
  const pagoEm = status === "pago" ? (soData(req.body?.pago_em) || new Date().toISOString().slice(0, 10)) : null;
  const avisadoEm = status === "avisado" ? (r.avisado_em || new Date().toISOString().slice(0, 10)) : r.avisado_em;

  db.prepare("UPDATE lp_renovacoes SET status = ?, valor = ?, pago_em = ?, avisado_em = ? WHERE id = ?")
    .run(status, valor, pagoEm, avisadoEm, r.id);

  // Paga: já agenda a do ano seguinte, senão o ciclo para aqui.
  const lp = db.prepare("SELECT * FROM landing_pages WHERE id = ?").get(r.lp_id);
  if (status === "pago") garanteRenovacao(lp);

  res.json(comContexto(db.prepare(`${SELECT} WHERE lp.id = ?`).get(lp.id)));
});

// GET /api/landing/:id/mensagem — o texto pronto para ela copiar e mandar.
router.get("/:id/mensagem", (req, res) => {
  const lp = db.prepare(`${SELECT} WHERE lp.id = ? AND lp.org_id = ?`).get(req.params.id, req.orgId);
  if (!lp) return res.status(404).json({ error: "Landing page não encontrada." });
  const com = comContexto(lp);
  const org = db.prepare("SELECT name FROM organizations WHERE id = ?").get(req.orgId);
  res.json({
    mensagem: mensagemDeRenovacao({
      cliente: lp.client_name,
      endereco: lp.endereco,
      vence_em: com.vence_em,
      valor: com.proxima_renovacao?.valor ?? lp.valor_renovacao,
      agencia: org?.name,
    }),
  });
});

// ---- pedidos de alteração -------------------------------------------------
router.post("/:id/alteracoes", (req, res) => {
  const lp = db.prepare("SELECT id FROM landing_pages WHERE id = ? AND org_id = ?")
    .get(req.params.id, req.orgId);
  if (!lp) return res.status(404).json({ error: "Landing page não encontrada." });
  const descricao = texto(req.body?.descricao, 500);
  if (!descricao) return res.status(400).json({ error: "Escreva o que foi pedido." });
  const info = db.prepare(
    "INSERT INTO lp_alteracoes (org_id, lp_id, data, descricao, valor, cobrado) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(req.orgId, lp.id, soData(req.body?.data) || new Date().toISOString().slice(0, 10),
        descricao, num(req.body?.valor, 0), req.body?.cobrado ? 1 : 0);
  res.status(201).json(db.prepare("SELECT * FROM lp_alteracoes WHERE id = ?").get(info.lastInsertRowid));
});

router.delete("/:id/alteracoes/:aid", (req, res) => {
  db.prepare("DELETE FROM lp_alteracoes WHERE id = ? AND lp_id = ? AND org_id = ?")
    .run(req.params.aid, req.params.id, req.orgId);
  res.json({ ok: true });
});

export default router;
