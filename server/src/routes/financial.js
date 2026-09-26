import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";
import { ensureReceiptForEntry, cancelReceiptForEntry } from "../receipts.js";
import { sincronizaAvisoDeAberto } from "../overdue.js";
import { confere } from "../pertence.js";
import { topicoDoSalario } from "../salario-katy.js";
import { sincronizaSalarioKaty } from "./personal-finance.js";
// numeroBR: "1.500,50" vira 1500.5. Com Number puro isso viraria 0 — e um
// recebimento entraria valendo nada, sem ninguém notar.
import { numeroBR } from "../contract-gen.js";

const router = Router();
router.use(authRequired, moduleAllowed("financeiro"));

const SELECT = `
  SELECT f.*, c.name AS client_name,
         r.id AS receipt_id, r.number AS receipt_number, r.status AS receipt_status
  FROM financial_entries f
  LEFT JOIN clients c ON c.id = f.client_id
  LEFT JOIN receipts r ON r.entry_id = f.id`;

router.get("/", (req, res) => {
  const { type, status, from, to } = req.query;
  const where = ["f.org_id = @org_id"];
  const params = { org_id: req.orgId };
  if (type) { where.push("f.type = @type"); params.type = type; }
  if (status) { where.push("f.status = @status"); params.status = status; }
  // Filtro de período pela data de vencimento (ou criação, se sem vencimento).
  if (from) { where.push("date(COALESCE(f.due_date, f.created_at)) >= @from"); params.from = from; }
  if (to) { where.push("date(COALESCE(f.due_date, f.created_at)) <= @to"); params.to = to; }
  // ?impagavel=1 traz só o que ela marcou como "não posso deixar de pagar";
  // ?impagavel=0 traz só o que pode esperar. Sem o parâmetro, traz tudo.
  if (req.query.impagavel === "1") where.push("f.impagavel = 1");
  if (req.query.impagavel === "0") where.push("COALESCE(f.impagavel,0) = 0");
  const sql = `${SELECT} WHERE ${where.join(" AND ")} ORDER BY f.due_date DESC, f.id DESC`;
  res.json(db.prepare(sql).all(params));
});

// GET /api/financial/summary?from=&to= — recorte do período (padrão: tudo).
router.get("/summary", (req, res) => {
  const org = req.orgId;
  const { from, to } = req.query;
  const periodo = [];
  const params = [org];
  if (from) { periodo.push("date(COALESCE(due_date, created_at)) >= ?"); params.push(from); }
  if (to) { periodo.push("date(COALESCE(due_date, created_at)) <= ?"); params.push(to); }
  const filtroPeriodo = periodo.length ? "AND " + periodo.join(" AND ") : "";

  const sum = (extra) =>
    db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE org_id = ? ${filtroPeriodo} ${extra}`)
      .get(...params).v;
  // Valor efetivamente realizado (conta pagamento parcial: pago total = amount,
  // parcial = o quanto já entrou/saiu).
  const realized = (tipo) =>
    db.prepare(`SELECT COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE COALESCE(paid_amount,0) END),0) AS v
                FROM financial_entries WHERE org_id = ? ${filtroPeriodo} AND type='${tipo}'`)
      .get(...params).v;

  const income = sum("AND type='income'");
  const expense = sum("AND type='expense'");
  const paidIncome = realized("income");
  const paidExpense = realized("expense");
  const pending = Math.max(0, (income - paidIncome)) + Math.max(0, (expense - paidExpense));

  const series = db.prepare(`
    SELECT strftime('%Y-%m', COALESCE(due_date, created_at)) AS month,
           COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
           COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
    FROM financial_entries
    WHERE org_id = ? AND COALESCE(due_date, created_at) >= date('now','-6 months')
    GROUP BY month ORDER BY month`).all(org);

  // IMPAGÁVEIS: o que ela marcou como "não posso deixar de pagar".
  // Dois números, porque são duas perguntas diferentes: quanto foi marcado, e
  // quanto disso ainda está em aberto.
  const impagavelTotal = sum("AND impagavel = 1");
  const impagavelAberto = db.prepare(
    `SELECT COALESCE(SUM(amount - COALESCE(paid_amount,0)),0) AS v FROM financial_entries
      WHERE org_id = ? ${filtroPeriodo} AND impagavel = 1 AND status != 'paid'`
  ).get(...params).v;

  res.json({
    income, expense, profit: income - expense,
    paidIncome, paidExpense, pending,
    lucroRealizado: paidIncome - paidExpense, // o que de fato entrou menos o que saiu
    impagavelTotal, impagavelAberto,
    series,
  });
});

// PUT /api/financial/:id/impagavel { impagavel: true|false }
//
// Rota própria, e não um campo do editar: marcar "não posso deixar de pagar" é um
// gesto de um clique no meio do aperto, e não pode exigir abrir a ficha inteira
// do lançamento para salvar.
router.put("/:id/impagavel", (req, res) => {
  const linha = db.prepare("SELECT id FROM financial_entries WHERE id = ? AND org_id = ?")
    .get(req.params.id, req.orgId);
  if (!linha) return res.status(404).json({ error: "Lançamento não encontrado." });
  const marca = req.body?.impagavel ? 1 : 0;
  db.prepare("UPDATE financial_entries SET impagavel = ? WHERE id = ? AND org_id = ?")
    .run(marca, linha.id, req.orgId);
  res.json({ ok: true, impagavel: Boolean(marca) });
});

// GET /api/financial/renewals — contratos que encerram no próximo mês.
router.get("/renewals", (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, company, work_end, payment_day,
           (SELECT COALESCE(SUM(cs.price),0) FROM client_services cs WHERE cs.client_id = clients.id) AS valor
    FROM clients
    WHERE org_id = ? AND status = 'active' AND work_end IS NOT NULL
      AND strftime('%Y-%m', work_end) = strftime('%Y-%m', date('now', '+1 month'))
    ORDER BY work_end
  `).all(req.orgId);
  res.json(rows);
});

const insertEntry = db.prepare(
  `INSERT INTO financial_entries (type, description, amount, client_id, category, status, due_date, paid_at,
                                  payment_link, pix_code, boleto_url, invoice_url, recurring, recurring_day, card, org_id)
   VALUES (@type, @description, @amount, @client_id, @category, @status, @due_date, @paid_at,
           @payment_link, @pix_code, @boleto_url, @invoice_url, @recurring, @recurring_day, @card, @org_id)`
);

// Monta a data de vencimento "AAAA-MM-DD" de um mês, encaixando o dia no último
// dia do mês quando ele não existe (ex.: dia 31 em fevereiro vira 28/29).
function dueForMonth(year, monthIndex, day) {
  const ultimo = new Date(year, monthIndex + 1, 0).getDate();
  const d = Math.min(Math.max(1, day), ultimo);
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// POST /api/financial/generate-monthly { month:'YYYY-MM', months?:N }
// Lança as MENSALIDADES como receita recorrente (prevista/pendente) a partir do
// que está cadastrado na aba Clientes: um lançamento por cliente ativo com valor
// de serviços > 0, no dia de pagamento do cliente. `months` (1..36, padrão 1)
// gera esse mesmo mês e os seguintes — cada parcela fica marcada como "Mensal".
// Idempotente: nunca duplica a mensalidade de um cliente no mesmo mês.
/**
 * A REGRA, num lugar só — quem entra na geração e, quando não entra, por quê.
 *
 * Ela mora fora da rota porque a PRÉVIA usa exatamente esta função. Se a
 * explicação da tela fosse uma segunda cópia da regra, ela ia divergir no
 * primeiro conserto e passar a mentir justamente quando mais importa.
 */
const mesDe = (data) => (data ? String(data).slice(0, 7) : null);

function porQueNaoEntra(c, mes) {
  if ((c.billing_type || "pagante") !== "pagante") return "não é cliente pagante";
  if (!c.valor || c.valor <= 0) return "sem valor de serviço cadastrado";

  const fimContrato = mesDe(c.work_end);
  if (fimContrato && fimContrato < mes) return `contrato encerrou em ${fimContrato}`;

  // QUEM MANDA É O ÚLTIMO PAGAMENTO COMBINADO.
  //
  // Antes essa data só era lida quando o cliente tinha `archived_at`, e há
  // mais de um jeito de um cliente ficar inativo sem isso: mudando o status
  // na ficha, ou vindo da migração dos que foram arquivados na versão antiga.
  // Nesses casos a regra "cliente inativo" batia primeiro e a data que ela
  // preencheu de propósito nem era olhada — a mensalidade do último mês
  // simplesmente não saía. Agora o campo mais específico vence: se tem
  // último pagamento, ele decide; o resto são os casos em que ele falta.
  if (c.archived_at || c.status !== "active") {
    const ate = mesDe(c.pagamento_ate);
    if (ate) {
      if (mes > ate) return `último pagamento em ${ate}`;
    } else if (c.archived_at) {
      return "cliente arquivado (sem último pagamento definido)";
    } else {
      return "cliente inativo";
    }
  }
  return null;
}

/** Todos os clientes da casa, com o valor somado dos serviços. */
const clientesDaCasa = (orgId) => db.prepare(`
  SELECT c.id, c.name, c.payment_day, c.status, c.billing_type, c.work_end,
         c.archived_at, c.pagamento_ate,
         (SELECT COALESCE(SUM(cs.price),0) FROM client_services cs WHERE cs.client_id = c.id) AS valor
  FROM clients c WHERE c.org_id = ? ORDER BY c.name
`).all(orgId);

/**
 * GET /api/financial/generate-monthly/previa?month=AAAA-MM
 *
 * O que vai acontecer se clicar: quem entra, quem não entra e por quê — ANTES
 * de gerar. Nasceu de um caso real: duas mensalidades não saíam e não havia
 * como descobrir o motivo sem abrir o banco. Aqui a tela mostra o que o
 * gerador está vendo, cliente por cliente, incluindo o valor cadastrado.
 */
router.get("/generate-monthly/previa", (req, res) => {
  const mes = (req.query.month || new Date().toISOString().slice(0, 7)).slice(0, 7);
  const jaExisteAqui = db.prepare(`
    SELECT 1 FROM financial_entries
    WHERE org_id = ? AND client_id = ? AND category = 'Mensalidade'
      AND strftime('%Y-%m', due_date) = ? LIMIT 1`);

  const linhas = clientesDaCasa(req.orgId).map((c) => {
    const motivo = porQueNaoEntra(c, mes);
    const jaTem = !motivo && !!jaExisteAqui.get(req.orgId, c.id, mes);
    return {
      id: c.id, cliente: c.name, valor: c.valor,
      entra: !motivo && !jaTem,
      motivo: motivo || (jaTem ? "já lançada neste mês" : null),
      // O que a regra olhou, para ela conseguir conferir o cadastro sozinha.
      status: c.status, arquivado_em: c.archived_at, pagamento_ate: c.pagamento_ate,
      fim_contrato: c.work_end,
    };
  });

  res.json({
    mes,
    total: linhas.length,
    entram: linhas.filter((l) => l.entra).length,
    linhas,
  });
});

router.post("/generate-monthly", (req, res) => {
  const startMonth = (req.body?.month || new Date().toISOString().slice(0, 7)).slice(0, 7);
  const meses = Math.min(Math.max(Number(req.body?.months) || 1, 1), 36);
  const [y0, m0] = startMonth.split("-").map(Number);

  // Todos os clientes da casa — quem entra e quem não entra é decidido abaixo,
  // um por um, COM MOTIVO. Antes a consulta já filtrava status = 'active' e
  // ninguém ficava sabendo de nada: o botão dizia só "N já existiam ou sem
  // valor definido", juntando num número só razões completamente diferentes.
  const clientes = clientesDaCasa(req.orgId);

  const jaExiste = db.prepare(`
    SELECT 1 FROM financial_entries
    WHERE org_id = ? AND client_id = ? AND category = 'Mensalidade'
      AND strftime('%Y-%m', due_date) = ? LIMIT 1`);

  // O lançamento é "recorrente" quando marca mais de um mês de uma vez.
  const recorrente = meses > 1 ? 1 : 0;

  let criadas = 0, puladas = 0;
  const motivos = new Map();       // "cliente — motivo" -> contagem de meses
  const tx = db.transaction(() => {
    for (let i = 0; i < meses; i++) {
      const d = new Date(y0, (m0 - 1) + i, 1);
      const year = d.getFullYear();
      const mIndex = d.getMonth();           // 0..11
      const month = `${year}-${String(mIndex + 1).padStart(2, "0")}`;
      for (const c of clientes) {
        const motivo = porQueNaoEntra(c, month);
        if (motivo) {
          puladas++;
          motivos.set(`${c.name}|${motivo}`, (motivos.get(`${c.name}|${motivo}`) || 0) + 1);
          continue;
        }
        if (jaExiste.get(req.orgId, c.id, month)) {
          puladas++;
          motivos.set(`${c.name}|já lançada neste mês`, (motivos.get(`${c.name}|já lançada neste mês`) || 0) + 1);
          continue;
        }
        const dia = Number(c.payment_day) || 5;
        const due = dueForMonth(year, mIndex, dia);
        insertEntry.run({
          type: "income", description: `Mensalidade — ${c.name}`, amount: c.valor,
          client_id: c.id, category: "Mensalidade", status: "pending", due_date: due, paid_at: null,
          payment_link: null, pix_code: null, boleto_url: null, invoice_url: null,
          recurring: recorrente, recurring_day: recorrente ? dia : null, card: null, org_id: req.orgId,
        });
        criadas++;
      }
    }
  });
  tx();
  // A lista de quem ficou de fora vai junto: sem ela, a pessoa clica, vê um
  // número e não tem como descobrir qual cliente faltou nem o que fazer.
  const foraDaLista = [...motivos.entries()]
    .map(([chave, meses_]) => {
      const [cliente, motivo] = chave.split("|");
      return { cliente, motivo, meses: meses_ };
    })
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
  res.json({ created: criadas, skipped: puladas, month: startMonth, months: meses, fora: foraDaLista });
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.description || b.amount == null) {
    return res.status(400).json({ error: "Descrição e valor são obrigatórios." });
  }

  // Cliente vindo do corpo do pedido: tem que ser desta casa. Ver pertence.js —
  // sem isto, uma agência amarrava uma cobrança ao cliente de OUTRA agência, e a
  // coisa aparecia na Área do Cliente dela.
  const naoEhDaCasa = confere(req.orgId, { clients: b.client_id });
  if (naoEhDaCasa) return res.status(400).json({ error: naoEhDaCasa });

  const base = {
    type: b.type ?? "income",
    description: b.description,
    amount: Number(b.amount) || 0,
    client_id: b.client_id ?? null,
    category: b.category ?? null,
    status: b.status ?? "pending",
    due_date: b.due_date ?? null,
    paid_at: b.status === "paid" ? (b.paid_at ?? new Date().toISOString()) : null,
    payment_link: b.payment_link ?? null,
    pix_code: b.pix_code ?? null,
    boleto_url: b.boleto_url ?? null,
    invoice_url: b.invoice_url ?? null,
    recurring: 0,
    recurring_day: null,
    card: b.card ?? null,
    org_id: req.orgId,
  };

  // Lançamento mensal recorrente: cria uma parcela por mês, no mesmo dia, para
  // os próximos N meses. "Fixa" (sem fim) gera um horizonte longo (36 meses).
  if (b.recurring) {
    const meses = b.fixed ? 36 : Math.min(Math.max(Number(b.months) || 12, 1), 36);
    // Dia do mês: o escolhido, ou o do vencimento informado, ou hoje.
    const hoje = new Date();
    const startDate = b.due_date ? new Date(b.due_date + "T00:00:00") : hoje;
    const day = Math.min(Math.max(Number(b.recurring_day) || startDate.getDate(), 1), 31);
    let ano = startDate.getFullYear();
    let mes = startDate.getMonth();
    const criadas = [];
    const tx = db.transaction(() => {
      for (let i = 0; i < meses; i++) {
        const due = dueForMonth(ano, mes, day);
        // Só a 1ª parcela herda o status informado; as futuras nascem pendentes.
        const status = i === 0 ? base.status : "pending";
        const info = insertEntry.run({
          ...base,
          status,
          due_date: due,
          paid_at: status === "paid" ? (base.paid_at ?? new Date().toISOString()) : null,
          recurring: 1,
          recurring_day: day,
        });
        criadas.push({ id: info.lastInsertRowid, status });
        mes += 1;
        if (mes > 11) { mes = 0; ano += 1; }
      }
    });
    tx();
    // Só a 1ª parcela pode nascer paga — se nasceu, já sai com recibo.
    for (const p of criadas) {
      if (base.type === "income" && p.status === "paid") {
        try { ensureReceiptForEntry(p.id, { userId: req.user?.id || null, ip: req.ip }); }
        catch (e) { console.error("[recibo] falha ao gerar na recorrência:", e.message); }
      }
    }
    return res.status(201).json({
      recurring: true, count: criadas.length,
      first: db.prepare(`${SELECT} WHERE f.id = ?`).get(criadas[0].id),
    });
  }

  const info = insertEntry.run(base);
  // Lançado já como pago: o recibo sai junto.
  if (base.type === "income" && base.status === "paid") {
    try { ensureReceiptForEntry(info.lastInsertRowid, { userId: req.user?.id || null, ip: req.ip }); }
    catch (e) { console.error("[recibo] falha ao gerar no lançamento novo:", e.message); }
  }
  res.status(201).json(db.prepare(`${SELECT} WHERE f.id = ?`).get(info.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM financial_entries WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: "Lançamento não encontrado." });
  // Reapontar um registro existente para o cliente de outra agência é o mesmo
  // buraco da criação — a trava vale nos dois (pertence.js).
  const naoEhDaCasaEdit = confere(req.orgId, { clients: req.body?.client_id });
  if (naoEhDaCasaEdit) return res.status(400).json({ error: naoEhDaCasaEdit });
  const b = req.body || {};
  const merged = { ...cur, ...b, id: req.params.id, org_id: req.orgId };
  const amount = Number(merged.amount) || 0;

  // Pagamento parcial: `pay` incrementa o valor já pago; `paid_amount` define o total.
  let paidAmount = Number(cur.paid_amount) || 0;
  if (b.paid_amount !== undefined) paidAmount = Number(b.paid_amount) || 0;
  if (b.pay !== undefined) paidAmount = paidAmount + (Number(b.pay) || 0);

  // Status: se veio explícito, respeita (e ajusta o pago); senão deriva do valor pago.
  if (b.status === "paid") paidAmount = amount;
  else if (b.status === "pending") paidAmount = 0;

  if (paidAmount < 0) paidAmount = 0;
  if (paidAmount > amount) paidAmount = amount;

  let status;
  if (b.status === "paid" || b.status === "pending" || b.status === "partial") status = b.status;
  else status = amount > 0 && paidAmount >= amount ? "paid" : paidAmount > 0 ? "partial" : "pending";
  if (status === "partial" && paidAmount >= amount && amount > 0) status = "paid"; // coerência

  merged.status = status;
  merged.paid_amount = paidAmount;
  // paid_at marca quando começou a ser pago (parcial ou total); some se voltar a pendente.
  merged.paid_at = status === "pending" ? null : (cur.paid_at ?? new Date().toISOString());

  db.prepare(
    `UPDATE financial_entries SET type=@type, description=@description, amount=@amount,
     client_id=@client_id, category=@category, status=@status, due_date=@due_date, paid_at=@paid_at,
     paid_amount=@paid_amount,
     payment_link=@payment_link, pix_code=@pix_code, boleto_url=@boleto_url, invoice_url=@invoice_url,
     card=@card
     WHERE id=@id AND org_id=@org_id`
  ).run(merged);

  // Virou "pago": o recibo daquele lançamento nasce aqui, já numerado e
  // assinado. Voltou para "pendente": o recibo fica cancelado (não some).
  // Se algo der errado na geração, o pagamento continua salvo do mesmo jeito.
  try {
    if (status === "paid") ensureReceiptForEntry(cur.id, { userId: req.user?.id || null, ip: req.ip });
    else if (status === "pending") cancelReceiptForEntry(cur.id);
  } catch (e) {
    console.error("[recibo] não consegui gerar o recibo do lançamento", cur.id, e.message);
  }

  // O aviso "você tem X em aberto" na área do cliente sai daqui: marcou como
  // paga, ele some na hora — antes ficava na tela mesmo depois de quitado.
  if (merged.type === "income" && merged.client_id) {
    try { sincronizaAvisoDeAberto(req.orgId, merged.client_id); }
    catch (e) { console.error("[aviso] não consegui acertar o aviso de pagamento:", e.message); }
  }

  res.json(db.prepare(`${SELECT} WHERE f.id = ?`).get(req.params.id));
});

router.delete("/:id", (req, res) => {
  const cur = db.prepare("SELECT client_id, type FROM financial_entries WHERE id = ? AND org_id = ?")
    .get(req.params.id, req.orgId);
  db.prepare("DELETE FROM financial_entries WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  if (cur?.type === "income" && cur.client_id) {
    try { sincronizaAvisoDeAberto(req.orgId, cur.client_id); } catch { /* o aviso não derruba a exclusão */ }
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// A PROJEÇÃO DO MÊS: vai sobrar ou vai faltar?
//
// Os cartões de cima diziam o que já aconteceu ("lucro realizado"). Faltava a
// pergunta que ela faz de verdade no fim do mês: com o que tenho para receber,
// eu consigo pagar tudo?
//
// A conta inclui, quando ela pede, os gastos dela que estão em Minhas Finanças
// e NÃO são da Perspectiva — porque o bolso é o mesmo, mesmo que a conta da
// empresa não os conheça.
// ---------------------------------------------------------------------------
/**
 * VAI SOBRAR OU VAI FALTAR — agora em cima de dinheiro de verdade.
 *
 * A versão anterior somava TODA a receita do mês (paga ou não) contra TODA a
 * despesa, e ainda somava as contas dela por fora. Dois problemas:
 *
 *  · O número grande não era saldo nenhum: misturava o que já entrou com o que
 *    ainda vai entrar. "Vai sobrar R$ 3.537" não queria dizer que havia esse
 *    dinheiro, e era por isso que a conta dela não fechava.
 *
 *  · CONTA DOBRADA. Desde que o "Salário Katy" virou o total das contas dela,
 *    esse total já está entre as despesas. Somar as contas dela outra vez por
 *    fora contava a mesma coisa duas vezes.
 *
 * Agora são as três perguntas dela, nesta ordem:
 *
 *   SALDO ATUAL          o que já entrou menos o que já saiu. Marcar uma conta
 *                        como paga — da casa ou dela — desconta aqui na hora.
 *   AINDA FALTA PAGAR    o que está em aberto dos dois lados, mais o lazer.
 *   VAI SOBRAR           saldo atual + o que ainda entra − o que ainda falta.
 *
 * A linha do salário dela fica de fora das somas da casa, e as contas dela
 * entram diretamente — separadas entre pagas e em aberto. Assim cada real
 * aparece uma vez só, e o check de cada conta move o dinheiro de um lado para
 * o outro em vez de mudar o total.
 */
router.get("/projecao", (req, res) => {
  const mes = String(req.query.month || new Date().toISOString().slice(0, 7)).slice(0, 7);
  const topicoSalario = topicoDoSalario(req.user.name);

  // A LINHA DO SALÁRIO DELA APARECE SOZINHA. Antes ela só nascia quando algo
  // mudava nas Minhas Finanças — quem não abrisse aquela tela no mês não via o
  // próprio salário entre os outros no Financeiro. Abrir o Financeiro basta.
  sincronizaSalarioKaty(req.orgId, req.user.id, mes, req.user.name);

  // A linha do salário dela é o espelho das contas dela; contar as duas seria
  // contar duas vezes. Aqui vale a origem, que tem o detalhe de pago/em aberto.
  const daCasa = (extra) => db.prepare(
    `SELECT COALESCE(SUM(amount),0) v FROM financial_entries
      WHERE org_id = ? AND strftime('%Y-%m', COALESCE(due_date, created_at)) = ?
        AND COALESCE(category, '') <> ? ${extra}`
  ).get(req.orgId, mes, topicoSalario).v;

  const entrou = daCasa("AND type='income' AND status='paid'");
  const aReceber = daCasa("AND type='income' AND status<>'paid'");
  const saiuCasa = daCasa("AND type='expense' AND status='paid'");
  const aPagarCasa = daCasa("AND type='expense' AND status<>'paid'");

  // AS CONTAS DELA, separadas por pago/em aberto. Gasto da Perspectiva não
  // entra: aquele já está nas despesas da casa acima.
  const minhas = (pago) => db.prepare(
    `SELECT COALESCE(SUM(amount),0) v FROM personal_finance
      WHERE org_id = ? AND user_id = ? AND ym = ? AND paid = ?
        AND COALESCE(category,'') NOT LIKE '%perspec%'`
  ).get(req.orgId, req.user.id, mes, pago).v;

  const meuPago = minhas(1);
  const meuAberto = minhas(0);
  const cfg = db.prepare("SELECT salary FROM personal_finance_config WHERE org_id=? AND user_id=?")
    .get(req.orgId, req.user.id);
  const lazer = Math.max(0, Number(cfg?.salary) || 0);

  // O que me devem, sem data: não entra na conta do mês (não tem mês), mas ela
  // precisa ver o número na hora de decidir.
  const meDevem = db.prepare(
    `SELECT COALESCE(SUM(a.total),0) - COALESCE((
        SELECT SUM(b.valor) FROM a_receber_baixa b
         JOIN a_receber_solto s ON s.id = b.a_receber_id
        WHERE s.org_id = ? AND s.arquivado = 0), 0) AS v
       FROM a_receber_solto a WHERE a.org_id = ? AND a.arquivado = 0`
  ).get(req.orgId, req.orgId).v;

  const cent = (n) => +Number(n || 0).toFixed(2);
  const saldoAtual = cent(entrou - saiuCasa - meuPago);
  const faltaPagar = cent(aPagarCasa + meuAberto + lazer);

  res.json({
    mes,
    // o que já aconteceu
    entrou: cent(entrou), saiu: cent(saiuCasa + meuPago),
    saiu_casa: cent(saiuCasa), meu_pago: cent(meuPago),
    saldo_atual: saldoAtual,
    // o que ainda vai acontecer
    a_receber: cent(aReceber),
    falta_pagar: faltaPagar,
    a_pagar_casa: cent(aPagarCasa), meu_aberto: cent(meuAberto), lazer: cent(lazer),
    // o fim do mês
    sobra_final: cent(saldoAtual + aReceber - faltaPagar),
    me_devem: cent(Math.max(0, meDevem)),
  });
});

// ---------------------------------------------------------------------------
// O QUE ME DEVEM — sem data.
//
// O espelho de "o que eu devo", que já existe em Minhas Finanças. Alguém ficou
// de pagar, não há vencimento combinado, e ela vai recebendo aos poucos. Fica
// fora dos lançamentos com data de propósito: isso não tem mês, e misturar
// faria a previsão mentir.
// ---------------------------------------------------------------------------
function comSaldo(linha) {
  const pago = db.prepare("SELECT COALESCE(SUM(valor),0) v FROM a_receber_baixa WHERE a_receber_id = ?")
    .get(linha.id).v;
  return { ...linha, recebido: pago, falta: Math.max(0, (linha.total || 0) - pago) };
}

router.get("/a-receber", (req, res) => {
  const linhas = db.prepare(
    `SELECT a.*, c.name AS client_name FROM a_receber_solto a
     LEFT JOIN clients c ON c.id = a.client_id
     WHERE a.org_id = ? AND a.arquivado = 0 ORDER BY a.created_at DESC`
  ).all(req.orgId).map(comSaldo);
  res.json(linhas);
});

router.post("/a-receber", (req, res) => {
  const quem = String(req.body?.quem || "").trim().slice(0, 120);
  if (!quem) return res.status(400).json({ error: "Diga quem está devendo." });
  const info = db.prepare(
    "INSERT INTO a_receber_solto (org_id, quem, client_id, total, nota) VALUES (?, ?, ?, ?, ?)"
  ).run(req.orgId, quem, Number(req.body?.client_id) || null,
        numeroBR(req.body?.total) || 0, String(req.body?.nota || "").slice(0, 300) || null);
  res.status(201).json(comSaldo(db.prepare("SELECT * FROM a_receber_solto WHERE id = ?").get(info.lastInsertRowid)));
});

/**
 * EDITAR A DÍVIDA. Nome errado, valor digitado torto, a nota que ficou vaga —
 * tudo isso se conserta aqui, sem precisar apagar e cadastrar de novo (o que
 * levaria junto o histórico do que já foi recebido).
 *
 * Só mexe no que veio no corpo: mandar `total` sozinho não apaga a nota.
 */
router.put("/a-receber/:id", (req, res) => {
  const atual = db.prepare("SELECT * FROM a_receber_solto WHERE id = ? AND org_id = ?")
    .get(req.params.id, req.orgId);
  if (!atual) return res.status(404).json({ error: "Cobrança não encontrada." });

  const b = req.body || {};
  const quem = b.quem !== undefined ? String(b.quem).trim().slice(0, 120) : atual.quem;
  if (!quem) return res.status(400).json({ error: "Diga quem está devendo." });
  const total = b.total !== undefined ? numeroBR(b.total) || 0 : atual.total;
  const nota = b.nota !== undefined ? (String(b.nota).slice(0, 300) || null) : atual.nota;
  const client_id = b.client_id !== undefined ? (Number(b.client_id) || null) : atual.client_id;

  db.prepare("UPDATE a_receber_solto SET quem = ?, total = ?, nota = ?, client_id = ? WHERE id = ? AND org_id = ?")
    .run(quem, total, nota, client_id, atual.id, req.orgId);

  const depois = comSaldo(db.prepare("SELECT * FROM a_receber_solto WHERE id = ?").get(atual.id));
  // Baixou o total para menos do que já entrou: a dívida está quitada, e some
  // da lista como sempre fez. Sem baixa nenhuma, um total zerado é só rascunho
  // — continua na tela para ela terminar de preencher.
  if (depois.recebido > 0 && depois.falta <= 0.005) {
    db.prepare("UPDATE a_receber_solto SET arquivado = 1 WHERE id = ?").run(atual.id);
    return res.json({ ...depois, arquivado: 1, quitado: true });
  }
  res.json(depois);
});

/** O histórico do que já foi recebido daquela dívida, do mais novo pro mais velho. */
router.get("/a-receber/:id/baixas", (req, res) => {
  const alvo = db.prepare("SELECT id FROM a_receber_solto WHERE id = ? AND org_id = ?")
    .get(req.params.id, req.orgId);
  if (!alvo) return res.status(404).json({ error: "Cobrança não encontrada." });
  res.json(db.prepare(
    "SELECT * FROM a_receber_baixa WHERE a_receber_id = ? AND org_id = ? ORDER BY recebido_em DESC, id DESC"
  ).all(alvo.id, req.orgId));
});

/**
 * DESFAZER UM VALOR LANÇADO. Lançar errado acontece — e o estrago é duplo: o
 * saldo da dívida fica torto E sobra uma entrada fantasma no Financeiro. Por
 * isso desfazer apaga as duas coisas de uma vez.
 */
router.delete("/a-receber/:id/baixa/:bid", (req, res) => {
  const baixa = db.prepare(
    "SELECT * FROM a_receber_baixa WHERE id = ? AND a_receber_id = ? AND org_id = ?"
  ).get(req.params.bid, req.params.id, req.orgId);
  if (!baixa) return res.status(404).json({ error: "Lançamento não encontrado." });

  const tx = db.transaction(() => {
    if (baixa.entry_id) {
      db.prepare("DELETE FROM financial_entries WHERE id = ? AND org_id = ?").run(baixa.entry_id, req.orgId);
    }
    db.prepare("DELETE FROM a_receber_baixa WHERE id = ?").run(baixa.id);
    // Se a dívida tinha sumido por estar quitada, ela volta pra lista: voltou a
    // faltar dinheiro, e some da tela é a última coisa que ajuda.
    db.prepare("UPDATE a_receber_solto SET arquivado = 0 WHERE id = ?").run(req.params.id);
  });
  tx();

  res.json(comSaldo(db.prepare("SELECT * FROM a_receber_solto WHERE id = ?").get(req.params.id)));
});

router.delete("/a-receber/:id", (req, res) => {
  db.prepare("UPDATE a_receber_solto SET arquivado = 1 WHERE id = ? AND org_id = ?")
    .run(req.params.id, req.orgId);
  res.json({ ok: true });
});

/**
 * Recebeu um pedaço: abate do saldo E lança no Financeiro.
 *
 * O lançamento é o ponto: sem ele, o dinheiro entrou e a previsão do mês não
 * soube. Com ele, o valor aparece UMA vez — a baixa guarda qual lançamento é.
 */
router.post("/a-receber/:id/baixa", (req, res) => {
  const alvo = db.prepare("SELECT * FROM a_receber_solto WHERE id = ? AND org_id = ?")
    .get(req.params.id, req.orgId);
  if (!alvo) return res.status(404).json({ error: "Cobrança não encontrada." });

  const valor = numeroBR(req.body?.valor);
  if (!valor || valor <= 0) return res.status(400).json({ error: "Informe o valor recebido." });
  const quando = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.recebido_em || ""))
    ? req.body.recebido_em : new Date().toISOString().slice(0, 10);

  const entry = db.prepare(
    `INSERT INTO financial_entries (org_id, type, description, amount, client_id, category, status, due_date, paid_amount)
     VALUES (?, 'income', ?, ?, ?, 'Recebimento', 'paid', ?, ?)`
  ).run(req.orgId, `Recebido de ${alvo.quem}`, valor, alvo.client_id || null, quando, valor);

  db.prepare(
    "INSERT INTO a_receber_baixa (org_id, a_receber_id, valor, recebido_em, entry_id, nota) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(req.orgId, alvo.id, valor, quando, entry.lastInsertRowid,
        String(req.body?.nota || "").slice(0, 300) || null);

  const atual = comSaldo(db.prepare("SELECT * FROM a_receber_solto WHERE id = ?").get(alvo.id));
  // Quitou: some da lista sozinho, como a dívida faz quando zera.
  if (atual.falta <= 0.005) {
    db.prepare("UPDATE a_receber_solto SET arquivado = 1 WHERE id = ?").run(alvo.id);
  }
  res.status(201).json({ ...atual, lancamento_id: entry.lastInsertRowid });
});

export default router;
