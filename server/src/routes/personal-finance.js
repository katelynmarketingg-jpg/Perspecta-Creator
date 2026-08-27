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
  ensureMonth(req.orgId, uid(req), ym); // puxa as contas dos meses anteriores se estiver vazio
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
  `INSERT INTO personal_finance (org_id, user_id, ym, name, parcela, amount, method, category, paid, position,
     recurring, installment_num, installment_total, import_id)
   VALUES (@org_id, @user_id, @ym, @name, @parcela, @amount, @method, @category, @paid, @position,
     @recurring, @installment_num, @installment_total, @import_id)`
);

// A partir do texto da "parcela" descobre se a conta se repete e em qual parcela
// está. 'fixa'/'variáveis' repetem sem fim; 'n/total' repete até acabar.
function parcelaInfo(parcela) {
  const s = String(parcela ?? "").trim().toLowerCase();
  if (/fix|vari|mensal|todo\s*m[êe]s/.test(s)) return { recurring: 1, num: null, total: null };
  const m = s.match(/(\d+)\s*\/\s*(\d+)/);
  if (m) return { recurring: 1, num: Number(m[1]), total: Number(m[2]) };
  return { recurring: 0, num: null, total: null };
}

// Gastos da categoria "Perspectiva" são da empresa: não ficam nas finanças
// pessoais, vão pro Financeiro (despesas, compartilhado).
const isPerspectiva = (cat) => /perspec/i.test(String(cat ?? ""));

const insertExpense = db.prepare(
  `INSERT INTO financial_entries (type, description, amount, client_id, category, status, due_date, paid_at,
     payment_link, pix_code, boleto_url, invoice_url, recurring, recurring_day, card, org_id)
   VALUES ('expense', @description, @amount, NULL, @category, @status, @due_date, @paid_at,
     NULL, NULL, NULL, NULL, @recurring, @recurring_day, @card, @org_id)`
);
const expenseExistsInMonth = db.prepare(
  "SELECT 1 FROM financial_entries WHERE org_id=? AND type='expense' AND description=? AND strftime('%Y-%m', due_date)=? LIMIT 1"
);

// Joga uma conta da Perspectiva no Financeiro como despesa. Se for fixa/parcelada
// gera os próximos meses (fixa: 36; parcelada: o que falta), sem duplicar.
function pushExpenseSeries(org, row, ym, day = 10) {
  const pi = parcelaInfo(row.parcela);
  let months = 1;
  if (pi.recurring) {
    months = pi.total != null ? Math.max(1, pi.total - (Number(pi.num) || 0) + 1) : 36;
  }
  const recurring = months > 1 ? 1 : 0;
  const desc = row.name;
  let created = 0;
  let [y, m] = ym.split("-").map(Number); // m: 1..12
  for (let i = 0; i < months; i++) {
    const mm = String(m).padStart(2, "0");
    const monthKey = `${y}-${mm}`;
    if (!expenseExistsInMonth.get(org, desc, monthKey)) {
      const last = new Date(y, m, 0).getDate();
      const d = String(Math.min(day, last)).padStart(2, "0");
      const paid = i === 0 && row.paid ? 1 : 0;
      insertExpense.run({
        description: desc, amount: Number(row.amount) || 0, category: "Perspectiva",
        status: paid ? "paid" : "pending", due_date: `${y}-${mm}-${d}`,
        paid_at: paid ? new Date().toISOString() : null,
        recurring, recurring_day: recurring ? day : null, card: row.method ?? null, org_id: org,
      });
      created++;
    }
    m++; if (m > 12) { m = 1; y++; }
  }
  return created;
}

const ymNext = (ym) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const ymPrev = (ym) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const monthHasRows = (org, user, ym) => !!db.prepare("SELECT 1 FROM personal_finance WHERE org_id=? AND user_id=? AND ym=? LIMIT 1").get(org, user, ym);

// Avança uma conta um mês pra frente. Devolve a linha do mês seguinte, ou null
// se a conta acabou (parcela final) ou não se repete.
function rollForward(row, ym, i) {
  if (!row.recurring) return null;
  if (isPerspectiva(row.category)) return null; // Perspectiva vive no Financeiro, não aqui
  let parcela = row.parcela, num = row.installment_num, total = row.installment_total;
  if (total != null) {
    const next = (Number(num) || 0) + 1;
    if (next > total) return null;               // acabou de pagar — some no próximo mês
    num = next; parcela = `${next}/${total}`;
  }
  return {
    org_id: row.org_id, user_id: row.user_id, ym, name: row.name,
    parcela, amount: Number(row.amount) || 0, method: row.method ?? null, category: row.category ?? null,
    paid: 0, position: i, recurring: 1, installment_num: num ?? null, installment_total: total ?? null, import_id: null,
  };
}

// Garante que o mês pedido esteja preenchido, puxando as contas dos meses
// anteriores automaticamente (sem precisar reimportar). Só gera em meses vazios.
function ensureMonth(org, user, ym) {
  if (monthHasRows(org, user, ym)) return;
  // acha o mês anterior mais recente que tenha lançamentos
  let src = null, cur = ymPrev(ym);
  for (let i = 0; i < 36 && cur >= "2000-01"; i++) {
    if (monthHasRows(org, user, cur)) { src = cur; break; }
    cur = ymPrev(cur);
  }
  if (!src) return;                              // nada pra puxar
  const tx = db.transaction(() => {
    let prev = db.prepare("SELECT * FROM personal_finance WHERE org_id=? AND user_id=? AND ym=? ORDER BY position, id").all(org, user, src);
    let m = ymNext(src);
    for (let step = 0; step < 24 && m <= ym; step++) {
      if (monthHasRows(org, user, m)) {
        prev = db.prepare("SELECT * FROM personal_finance WHERE org_id=? AND user_id=? AND ym=? ORDER BY position, id").all(org, user, m);
      } else {
        const gen = prev.map((r, i) => rollForward(r, m, i)).filter(Boolean);
        gen.forEach((g) => insert.run(g));
        prev = gen;                              // vira a base do próximo mês
      }
      m = ymNext(m);
    }
  });
  tx();
}

// POST /api/personal-finance  { ym, name, ... }
router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.name?.trim()) return res.status(400).json({ error: "Informe o nome do gasto." });
  const ym = (b.ym || new Date().toISOString().slice(0, 7)).slice(0, 7);
  // se veio recurring/parcelas explícitas usa; senão deriva do texto da parcela
  const pi = parcelaInfo(b.parcela);
  const recurring = b.recurring !== undefined ? (b.recurring ? 1 : 0) : pi.recurring;
  const info = insert.run({
    org_id: req.orgId, user_id: uid(req), ym, name: b.name.trim(),
    parcela: b.parcela ?? null, amount: Number(b.amount) || 0,
    method: b.method ?? null, category: b.category ?? null,
    paid: b.paid ? 1 : 0, position: Number(b.position) || 0,
    recurring, installment_num: b.installment_num ?? pi.num, installment_total: b.installment_total ?? pi.total, import_id: null,
  });
  res.status(201).json(db.prepare("SELECT * FROM personal_finance WHERE id=?").get(info.lastInsertRowid));
});

// POST /api/personal-finance/import { ym, entries:[...], replace, label } — importa o CSV.
router.post("/import", (req, res) => {
  const ym = (req.body?.ym || new Date().toISOString().slice(0, 7)).slice(0, 7);
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  const replace = req.body?.replace === true;
  const label = (req.body?.label || "").toString().slice(0, 120) || "Importação CSV";
  let n = 0, toFinanceiro = 0, importId = null;
  const tx = db.transaction(() => {
    if (replace) db.prepare("DELETE FROM personal_finance WHERE org_id=? AND user_id=? AND ym=?").run(req.orgId, uid(req), ym);
    const imp = db.prepare(
      "INSERT INTO personal_finance_imports (org_id, user_id, ym, label, count) VALUES (?, ?, ?, ?, 0)"
    ).run(req.orgId, uid(req), ym, label);
    importId = imp.lastInsertRowid;
    entries.forEach((e, i) => {
      if (!e?.name?.toString().trim()) return;
      // Perspectiva = empresa → vai pro Financeiro, não pras finanças pessoais.
      if (isPerspectiva(e.category)) {
        toFinanceiro += pushExpenseSeries(req.orgId, {
          name: String(e.name).trim(), amount: e.amount, method: e.method, parcela: e.parcela, paid: e.paid,
        }, ym);
        return;
      }
      const pi = parcelaInfo(e.parcela);
      insert.run({
        org_id: req.orgId, user_id: uid(req), ym, name: String(e.name).trim(),
        parcela: e.parcela ?? null, amount: Number(e.amount) || 0,
        method: e.method ?? null, category: e.category ?? null,
        paid: e.paid ? 1 : 0, position: i,
        recurring: pi.recurring, installment_num: pi.num, installment_total: pi.total, import_id: importId,
      });
      n++;
    });
    db.prepare("UPDATE personal_finance_imports SET count=? WHERE id=?").run(n, importId);
  });
  tx();
  res.json({ imported: n, toFinanceiro, ym, importId });
});

// POST /api/personal-finance/move-to-financeiro { ym } — move os gastos que já
// estão nas finanças pessoais e são da categoria Perspectiva pro Financeiro
// (despesas). Remove eles daqui. Se ym vier vazio, faz de todos os meses.
router.post("/move-to-financeiro", (req, res) => {
  const ym = (req.body?.ym || "").slice(0, 7);
  let moved = 0, expenses = 0;
  const tx = db.transaction(() => {
    const rows = ym
      ? db.prepare("SELECT * FROM personal_finance WHERE org_id=? AND user_id=? AND ym=?").all(req.orgId, uid(req), ym)
      : db.prepare("SELECT * FROM personal_finance WHERE org_id=? AND user_id=?").all(req.orgId, uid(req));
    for (const r of rows) {
      if (!isPerspectiva(r.category)) continue;
      expenses += pushExpenseSeries(req.orgId, r, r.ym);
      db.prepare("DELETE FROM personal_finance WHERE id=? AND user_id=?").run(r.id, uid(req));
      moved++;
    }
  });
  tx();
  res.json({ moved, expenses });
});

// GET /api/personal-finance/imports?ym= — registro das importações do mês.
router.get("/imports", (req, res) => {
  const ym = (req.query.ym || "").slice(0, 7);
  const rows = ym
    ? db.prepare("SELECT * FROM personal_finance_imports WHERE org_id=? AND user_id=? AND ym=? ORDER BY id DESC").all(req.orgId, uid(req), ym)
    : db.prepare("SELECT * FROM personal_finance_imports WHERE org_id=? AND user_id=? ORDER BY id DESC").all(req.orgId, uid(req));
  res.json(rows);
});

// DELETE /api/personal-finance/imports/:id — desfaz uma importação (apaga as
// linhas que ela criou naquele mês).
router.delete("/imports/:id", (req, res) => {
  const imp = db.prepare("SELECT * FROM personal_finance_imports WHERE id=? AND org_id=? AND user_id=?").get(req.params.id, req.orgId, uid(req));
  if (!imp) return res.status(404).json({ error: "Importação não encontrada." });
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM personal_finance WHERE org_id=? AND user_id=? AND import_id=?").run(req.orgId, uid(req), imp.id);
    db.prepare("DELETE FROM personal_finance_imports WHERE id=?").run(imp.id);
  });
  tx();
  res.json({ ok: true });
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

// PUT /api/personal-finance/rename-method { ym, from, to } — renomeia o banco/
// meio de pagamento inteiro (todos os itens daquele método no mês).
router.put("/rename-method", (req, res) => {
  const ym = (req.body?.ym || "").slice(0, 7);
  const from = (req.body?.from ?? "").toString();
  const to = (req.body?.to ?? "").toString().trim();
  if (!ym || !to) return res.status(400).json({ error: "Informe o mês e o novo nome." });
  const where = from === "" ? "(method IS NULL OR method = '')" : "method = @from";
  db.prepare(
    `UPDATE personal_finance SET method=@to WHERE org_id=@org AND user_id=@uid AND ym=@ym AND ${where}`
  ).run({ to, from, org: req.orgId, uid: uid(req), ym });
  res.json({ ok: true });
});

// PUT /api/personal-finance/rename-category { ym, from, to } — renomeia a
// categoria inteira (todos os itens dela no mês).
router.put("/rename-category", (req, res) => {
  const ym = (req.body?.ym || "").slice(0, 7);
  const from = (req.body?.from ?? "").toString();
  const to = (req.body?.to ?? "").toString().trim();
  if (!ym || !to) return res.status(400).json({ error: "Informe o mês e o novo nome." });
  const where = from === "" ? "(category IS NULL OR category = '')" : "category = @from";
  db.prepare(
    `UPDATE personal_finance SET category=@to WHERE org_id=@org AND user_id=@uid AND ym=@ym AND ${where}`
  ).run({ to, from, org: req.orgId, uid: uid(req), ym });
  res.json({ ok: true });
});

// PUT /api/personal-finance/:id — só o dono edita.
router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM personal_finance WHERE id=? AND org_id=? AND user_id=?").get(req.params.id, req.orgId, uid(req));
  if (!cur) return res.status(404).json({ error: "Não encontrado." });
  const b = req.body || {};
  const m = { ...cur, ...b, paid: b.paid !== undefined ? (b.paid ? 1 : 0) : cur.paid, amount: b.amount !== undefined ? (Number(b.amount) || 0) : cur.amount };
  // se mexeu na parcela e não mandou recurring/parcelas explícitas, rededuz do texto
  if (b.parcela !== undefined && b.recurring === undefined) {
    const pi = parcelaInfo(b.parcela);
    m.recurring = pi.recurring; m.installment_num = pi.num; m.installment_total = pi.total;
  } else if (b.recurring !== undefined) {
    m.recurring = b.recurring ? 1 : 0;
    m.installment_num = b.installment_num ?? m.installment_num ?? null;
    m.installment_total = b.installment_total ?? m.installment_total ?? null;
  }
  db.prepare(
    `UPDATE personal_finance SET name=@name, parcela=@parcela, amount=@amount, method=@method,
       category=@category, paid=@paid, recurring=@recurring, installment_num=@installment_num,
       installment_total=@installment_total WHERE id=@id AND user_id=@user_id`
  ).run({ ...m, id: req.params.id, user_id: uid(req) });
  res.json(db.prepare("SELECT * FROM personal_finance WHERE id=?").get(req.params.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM personal_finance WHERE id=? AND org_id=? AND user_id=?").run(req.params.id, req.orgId, uid(req));
  res.json({ ok: true });
});

export default router;
