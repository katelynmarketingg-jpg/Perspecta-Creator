import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";

const router = Router();
router.use(authRequired, moduleAllowed("financeiro"));

const SELECT = `
  SELECT f.*, c.name AS client_name
  FROM financial_entries f LEFT JOIN clients c ON c.id = f.client_id`;

router.get("/", (req, res) => {
  const { type, status, from, to } = req.query;
  const where = ["f.org_id = @org_id"];
  const params = { org_id: req.orgId };
  if (type) { where.push("f.type = @type"); params.type = type; }
  if (status) { where.push("f.status = @status"); params.status = status; }
  // Filtro de período pela data de vencimento (ou criação, se sem vencimento).
  if (from) { where.push("date(COALESCE(f.due_date, f.created_at)) >= @from"); params.from = from; }
  if (to) { where.push("date(COALESCE(f.due_date, f.created_at)) <= @to"); params.to = to; }
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

  const income = sum("AND type='income'");
  const expense = sum("AND type='expense'");
  const paidIncome = sum("AND type='income' AND status='paid'");
  const paidExpense = sum("AND type='expense' AND status='paid'");
  const pending = sum("AND status='pending'");

  const series = db.prepare(`
    SELECT strftime('%Y-%m', COALESCE(due_date, created_at)) AS month,
           COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
           COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
    FROM financial_entries
    WHERE org_id = ? AND COALESCE(due_date, created_at) >= date('now','-6 months')
    GROUP BY month ORDER BY month`).all(org);

  res.json({
    income, expense, profit: income - expense,
    paidIncome, paidExpense, pending,
    lucroRealizado: paidIncome - paidExpense, // o que de fato entrou menos o que saiu
    series,
  });
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
                                  payment_link, pix_code, boleto_url, invoice_url, recurring, recurring_day, org_id)
   VALUES (@type, @description, @amount, @client_id, @category, @status, @due_date, @paid_at,
           @payment_link, @pix_code, @boleto_url, @invoice_url, @recurring, @recurring_day, @org_id)`
);

// Monta a data de vencimento "AAAA-MM-DD" de um mês, encaixando o dia no último
// dia do mês quando ele não existe (ex.: dia 31 em fevereiro vira 28/29).
function dueForMonth(year, monthIndex, day) {
  const ultimo = new Date(year, monthIndex + 1, 0).getDate();
  const d = Math.min(Math.max(1, day), ultimo);
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// POST /api/financial/generate-monthly { month:'YYYY-MM' }
// Lança as MENSALIDADES do mês como receita prevista (pendente), uma por cliente
// ativo que tenha valor de serviços > 0. Idempotente: não duplica no mesmo mês.
router.post("/generate-monthly", (req, res) => {
  const month = (req.body?.month || new Date().toISOString().slice(0, 7)).slice(0, 7);
  const [year, m] = month.split("-").map(Number);
  const clientes = db.prepare(`
    SELECT c.id, c.name, c.payment_day,
           (SELECT COALESCE(SUM(cs.price),0) FROM client_services cs WHERE cs.client_id = c.id) AS valor
    FROM clients c WHERE c.org_id = ? AND c.status = 'active'
  `).all(req.orgId);

  const jaExiste = db.prepare(`
    SELECT 1 FROM financial_entries
    WHERE org_id = ? AND client_id = ? AND category = 'Mensalidade'
      AND strftime('%Y-%m', due_date) = ? LIMIT 1`);

  let criadas = 0, puladas = 0;
  const tx = db.transaction(() => {
    for (const c of clientes) {
      if (!c.valor || c.valor <= 0) { puladas++; continue; }
      if (jaExiste.get(req.orgId, c.id, month)) { puladas++; continue; }
      const dia = Math.min(Math.max(1, Number(c.payment_day) || 5), new Date(year, m, 0).getDate());
      const due = `${year}-${String(m).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
      insertEntry.run({
        type: "income", description: `Mensalidade — ${c.name}`, amount: c.valor,
        client_id: c.id, category: "Mensalidade", status: "pending", due_date: due, paid_at: null,
        payment_link: null, pix_code: null, boleto_url: null, invoice_url: null,
        recurring: 0, recurring_day: null, org_id: req.orgId,
      });
      criadas++;
    }
  });
  tx();
  res.json({ created: criadas, skipped: puladas, month });
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.description || b.amount == null) {
    return res.status(400).json({ error: "Descrição e valor são obrigatórios." });
  }

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
    org_id: req.orgId,
  };

  // Lançamento mensal recorrente: cria uma parcela por mês, no mesmo dia, para
  // os próximos N meses (padrão 12). Cada parcela fica editável/excluível.
  if (b.recurring) {
    const meses = Math.min(Math.max(Number(b.months) || 12, 1), 36);
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
        criadas.push(info.lastInsertRowid);
        mes += 1;
        if (mes > 11) { mes = 0; ano += 1; }
      }
    });
    tx();
    return res.status(201).json({
      recurring: true, count: criadas.length,
      first: db.prepare(`${SELECT} WHERE f.id = ?`).get(criadas[0]),
    });
  }

  const info = insertEntry.run(base);
  res.status(201).json(db.prepare(`${SELECT} WHERE f.id = ?`).get(info.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM financial_entries WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: "Lançamento não encontrado." });
  const merged = { ...cur, ...req.body, id: req.params.id, org_id: req.orgId };
  merged.paid_at = merged.status === "paid" ? (merged.paid_at ?? new Date().toISOString()) : null;
  db.prepare(
    `UPDATE financial_entries SET type=@type, description=@description, amount=@amount,
     client_id=@client_id, category=@category, status=@status, due_date=@due_date, paid_at=@paid_at,
     payment_link=@payment_link, pix_code=@pix_code, boleto_url=@boleto_url, invoice_url=@invoice_url
     WHERE id=@id AND org_id=@org_id`
  ).run(merged);
  res.json(db.prepare(`${SELECT} WHERE f.id = ?`).get(req.params.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM financial_entries WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

export default router;
