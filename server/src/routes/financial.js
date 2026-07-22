import { Router } from "express";
import { db } from "../db.js";
import { authRequired, moduleAllowed } from "../auth.js";

const router = Router();
router.use(authRequired, moduleAllowed("financeiro"));

const SELECT = `
  SELECT f.*, c.name AS client_name
  FROM financial_entries f LEFT JOIN clients c ON c.id = f.client_id`;

router.get("/", (req, res) => {
  const { type, status } = req.query;
  const where = ["f.org_id = @org_id"];
  const params = { org_id: req.orgId };
  if (type) { where.push("f.type = @type"); params.type = type; }
  if (status) { where.push("f.status = @status"); params.status = status; }
  const sql = `${SELECT} WHERE ${where.join(" AND ")} ORDER BY f.due_date DESC, f.id DESC`;
  res.json(db.prepare(sql).all(params));
});

// GET /api/financial/summary — receitas, despesas, lucro, série 6 meses
router.get("/summary", (req, res) => {
  const org = req.orgId;
  const sum = (extra) =>
    db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM financial_entries WHERE org_id = ? ${extra}`).get(org).v;

  const income = sum("AND type='income'");
  const expense = sum("AND type='expense'");
  const paidIncome = sum("AND type='income' AND status='paid'");
  const pending = sum("AND status='pending'");

  const series = db.prepare(`
    SELECT strftime('%Y-%m', COALESCE(due_date, created_at)) AS month,
           COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
           COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
    FROM financial_entries
    WHERE org_id = ? AND COALESCE(due_date, created_at) >= date('now','-6 months')
    GROUP BY month ORDER BY month`).all(org);

  res.json({
    income, expense, profit: income - expense, paidIncome, pending, series,
  });
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.description || b.amount == null) {
    return res.status(400).json({ error: "Descrição e valor são obrigatórios." });
  }
  const info = db
    .prepare(
      `INSERT INTO financial_entries (type, description, amount, client_id, category, status, due_date, paid_at,
                                      payment_link, pix_code, boleto_url, invoice_url, org_id)
       VALUES (@type, @description, @amount, @client_id, @category, @status, @due_date, @paid_at,
               @payment_link, @pix_code, @boleto_url, @invoice_url, @org_id)`
    )
    .run({
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
      org_id: req.orgId,
    });
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
