import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";

// ---------------------------------------------------------------------------
// Finanças pessoais — PRIVADO por usuário. Toda query filtra por req.user.id,
// então ninguém (nem admin) vê as finanças de outra pessoa.
// ---------------------------------------------------------------------------
const router = Router();
router.use(authRequired);

const uid = (req) => req.user.id;

function summary(rows, salary) {
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const pago = rows.filter((r) => r.paid).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const byCat = {}, byMethod = {};
  rows.forEach((r) => {
    byCat[r.category || "Sem categoria"] = (byCat[r.category || "Sem categoria"] || 0) + (Number(r.amount) || 0);
    byMethod[r.method || "Sem método"] = (byMethod[r.method || "Sem método"] || 0) + (Number(r.amount) || 0);
  });
  return {
    total, pago, aPagar: Math.max(0, total - pago),
    salary: Number(salary) || 0,
    comprometido: salary > 0 ? Math.round((total / salary) * 100) : null,
    porCategoria: Object.entries(byCat).map(([k, v]) => ({ nome: k, valor: +v.toFixed(2) })).sort((a, b) => b.valor - a.valor),
    porMetodo: Object.entries(byMethod).map(([k, v]) => ({ nome: k, valor: +v.toFixed(2) })).sort((a, b) => b.valor - a.valor),
  };
}

// GET /api/personal-finance?ym=AAAA-MM
router.get("/", (req, res) => {
  const ym = (req.query.ym || new Date().toISOString().slice(0, 7)).slice(0, 7);
  const rows = db.prepare(
    "SELECT * FROM personal_finance WHERE org_id=? AND user_id=? AND ym=? ORDER BY position, id"
  ).all(req.orgId, uid(req), ym);
  const cfg = db.prepare("SELECT salary FROM personal_finance_config WHERE org_id=? AND user_id=?").get(req.orgId, uid(req));
  const salary = cfg?.salary || 0;
  res.json({ ym, salary, entries: rows.map((r) => ({ ...r, paid: !!r.paid })), summary: summary(rows, salary) });
});

// PUT /api/personal-finance/config { salary }
router.put("/config", (req, res) => {
  const salary = Number(req.body?.salary) || 0;
  db.prepare(
    `INSERT INTO personal_finance_config (org_id, user_id, salary) VALUES (?, ?, ?)
     ON CONFLICT(org_id, user_id) DO UPDATE SET salary = excluded.salary`
  ).run(req.orgId, uid(req), salary);
  res.json({ ok: true, salary });
});

const insert = db.prepare(
  `INSERT INTO personal_finance (org_id, user_id, ym, name, parcela, amount, method, category, paid, position)
   VALUES (@org_id, @user_id, @ym, @name, @parcela, @amount, @method, @category, @paid, @position)`
);

// POST /api/personal-finance  { ym, name, ... }
router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.name?.trim()) return res.status(400).json({ error: "Informe o nome do gasto." });
  const ym = (b.ym || new Date().toISOString().slice(0, 7)).slice(0, 7);
  const info = insert.run({
    org_id: req.orgId, user_id: uid(req), ym, name: b.name.trim(),
    parcela: b.parcela ?? null, amount: Number(b.amount) || 0,
    method: b.method ?? null, category: b.category ?? null,
    paid: b.paid ? 1 : 0, position: Number(b.position) || 0,
  });
  res.status(201).json(db.prepare("SELECT * FROM personal_finance WHERE id=?").get(info.lastInsertRowid));
});

// POST /api/personal-finance/import { ym, entries:[...] } — importa o CSV.
router.post("/import", (req, res) => {
  const ym = (req.body?.ym || new Date().toISOString().slice(0, 7)).slice(0, 7);
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  const replace = req.body?.replace === true;
  let n = 0;
  const tx = db.transaction(() => {
    if (replace) db.prepare("DELETE FROM personal_finance WHERE org_id=? AND user_id=? AND ym=?").run(req.orgId, uid(req), ym);
    entries.forEach((e, i) => {
      if (!e?.name?.toString().trim()) return;
      insert.run({
        org_id: req.orgId, user_id: uid(req), ym, name: String(e.name).trim(),
        parcela: e.parcela ?? null, amount: Number(e.amount) || 0,
        method: e.method ?? null, category: e.category ?? null,
        paid: e.paid ? 1 : 0, position: i,
      });
      n++;
    });
  });
  tx();
  res.json({ imported: n, ym });
});

// PUT /api/personal-finance/pay-method { ym, method, paid } — marca/desmarca a
// fatura inteira daquele local de pagamento (todos os itens do método no mês).
router.put("/pay-method", (req, res) => {
  const ym = (req.body?.ym || "").slice(0, 7);
  const method = req.body?.method ?? null;
  const paid = req.body?.paid ? 1 : 0;
  if (!ym) return res.status(400).json({ error: "Informe o mês." });
  const where = method === null || method === "" ? "method IS NULL OR method = ''" : "method = @method";
  db.prepare(
    `UPDATE personal_finance SET paid=@paid WHERE org_id=@org AND user_id=@uid AND ym=@ym AND (${where})`
  ).run({ paid, org: req.orgId, uid: uid(req), ym, method });
  res.json({ ok: true });
});

// PUT /api/personal-finance/:id — só o dono edita.
router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM personal_finance WHERE id=? AND org_id=? AND user_id=?").get(req.params.id, req.orgId, uid(req));
  if (!cur) return res.status(404).json({ error: "Não encontrado." });
  const b = req.body || {};
  const m = { ...cur, ...b, paid: b.paid !== undefined ? (b.paid ? 1 : 0) : cur.paid, amount: b.amount !== undefined ? (Number(b.amount) || 0) : cur.amount };
  db.prepare(
    `UPDATE personal_finance SET name=@name, parcela=@parcela, amount=@amount, method=@method,
       category=@category, paid=@paid WHERE id=@id AND user_id=@user_id`
  ).run({ ...m, id: req.params.id, user_id: uid(req) });
  res.json(db.prepare("SELECT * FROM personal_finance WHERE id=?").get(req.params.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM personal_finance WHERE id=? AND org_id=? AND user_id=?").run(req.params.id, req.orgId, uid(req));
  res.json({ ok: true });
});

export default router;
