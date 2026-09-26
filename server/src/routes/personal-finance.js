import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";
import { topicoDoSalario, quantoJaPeguei, quantoEhOMeu, oQueFaltaDoMeu, ultimoDiaDoMes } from "../salario-katy.js";

// ---------------------------------------------------------------------------
// Finanças pessoais — PRIVADO por usuário. Toda query filtra por req.user.id,
// então ninguém (nem admin) vê as finanças de outra pessoa.
// ---------------------------------------------------------------------------
const router = Router();
router.use(authRequired);

const uid = (req) => req.user.id;

function summary(rows, salary) {
  // "o que falta pagar do meu" — a conta que ela pediu pra ver em cima.
  const meu = oQueFaltaDoMeu(rows.map((r) => ({ ...r, paid: !!r.paid })), salary);
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const pago = rows.filter((r) => r.paid).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const byCat = {}, byMethod = {};
  rows.forEach((r) => {
    byCat[r.category || "Sem categoria"] = (byCat[r.category || "Sem categoria"] || 0) + (Number(r.amount) || 0);
    byMethod[r.method || "Sem método"] = (byMethod[r.method || "Sem método"] || 0) + (Number(r.amount) || 0);
  });
  // IMPAGÁVEIS: o que ela marcou como "não posso deixar de pagar" — o aluguel,
  // a parcela do carro. O que importa não é o total deles, e sim quanto AINDA
  // falta pagar: é esse o dinheiro que tem de sair primeiro.
  const impagaveis = rows.filter((r) => r.impagavel);
  const impagavelTotal = impagaveis.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const impagavelAPagar = impagaveis.filter((r) => !r.paid).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return {
    total, pago, aPagar: Math.max(0, total - pago),
    impagavelTotal, impagavelAPagar, impagavelQuantos: impagaveis.length,
    salary: Number(salary) || 0,
    comprometido: salary > 0 ? Math.round((total / salary) * 100) : null,
    meu,
    porCategoria: Object.entries(byCat).map(([k, v]) => ({ nome: k, valor: +v.toFixed(2) })).sort((a, b) => b.valor - a.valor),
    porMetodo: Object.entries(byMethod).map(([k, v]) => ({ nome: k, valor: +v.toFixed(2) })).sort((a, b) => b.valor - a.valor),
  };
}

/**
 * O QUE TERMINOU NO MÊS PASSADO.
 *
 * A conta que chegou na última parcela (5/5) sai da lista no mês seguinte — é
 * o certo, já está paga. Mas sumir sem dizer nada assusta: dá a impressão de
 * que a conta se perdeu. Então o mês guarda, lá embaixo e miudinho, o registro
 * do que acabou: o que quitou de vez e o que era só daquele mês.
 *
 * É calculado na hora, olhando o mês anterior — nada a mais para guardar.
 */
function terminadasAntesDe(org, user, ym) {
  const anterior = ymPrev(ym);
  const antes = db.prepare(
    "SELECT * FROM personal_finance WHERE org_id=? AND user_id=? AND ym=? ORDER BY position, id"
  ).all(org, user, anterior);
  if (!antes.length) return [];

  return antes.flatMap((l) => {
    // Mesma leitura do rollForward: a linha antiga só tem o texto ("3/3"), os
    // campos de número vieram vazios. Ler só os campos deixava a conta de fora
    // da lista justamente no mês em que ela some — que é quando importa.
    const pi = parcelaInfo(l.parcela);
    const total = l.installment_total != null ? Number(l.installment_total) : pi.total;
    const atual = l.installment_total != null ? Number(l.installment_num) || 0 : Number(pi.num) || 0;
    const acabou = total != null && atual >= total;
    if (!acabou && !l.avulso) return [];
    // Se ela recadastrou a conta neste mês, não é "terminou": está aí na lista.
    if (nameExistsInMonth.get(org, user, ym, l.name)) return [];
    return [{
      name: l.name, parcela: l.parcela, amount: Number(l.amount) || 0,
      category: l.category, method: l.method, ym: anterior,
      motivo: acabou ? "quitou" : "so_daquele_mes",
    }];
  });
}

/**
 * AS CONTAS DA PERSPECTIVA QUE CAEM NA MESMA FATURA.
 *
 * Gasto da empresa mora no Financeiro — isso não muda, é lá que ele é pago e
 * contabilizado. Só que ele sai do MESMO cartão que as contas dela: o Nubank PJ
 * tem Adobe e Netcomet da agência junto com a gasolina e o mercado. Sem ver as
 * duas coisas no mesmo lugar, o total da fatura aqui fica mentindo, e ela não
 * consegue responder "quanto preciso pagar neste cartão".
 *
 * Então elas APARECEM aqui, marcadas, mas continuam sendo do Financeiro: nada
 * é copiado para cá. A regra de quem aparece é ter meio de pagamento
 * preenchido — é isso que quer dizer "saiu por um cartão meu". Salário não
 * entra: não sai de cartão, e o "Salário Katy" é a soma DESTAS contas, entraria
 * duas vezes.
 */
function daPerspectivaNoMes(orgId, ym, nomeDoDono) {
  const topicoSalario = topicoDoSalario(nomeDoDono);
  return db.prepare(
    `SELECT id, description, amount, category, card, status, paid_amount, due_date, impagavel
       FROM financial_entries
      WHERE org_id = ? AND type = 'expense'
        AND card IS NOT NULL AND TRIM(card) != ''
        AND COALESCE(category, '') != ?
        AND strftime('%Y-%m', due_date) = ?
      ORDER BY due_date, id`
  ).all(orgId, topicoSalario, ym).map((f) => ({
    id: `f${f.id}`,                       // id de tela; o de verdade vai em entry_id
    entry_id: f.id,
    da_perspectiva: true,                 // a tela marca e não deixa editar aqui
    name: f.description,
    parcela: null,
    amount: Number(f.amount) || 0,
    method: f.card,
    category: (f.category || "").trim() || "Perspectiva",
    paid: f.status === "paid",
    impagavel: !!f.impagavel,
    avulso: false,
    recurring: 0,
    installment_num: null,
    installment_total: null,
  }));
}

// GET /api/personal-finance?ym=AAAA-MM
router.get("/", (req, res) => {
  const ym = (req.query.ym || new Date().toISOString().slice(0, 7)).slice(0, 7);
  // Mês vazio se preenche sozinho com as contas do mês anterior — e a tela avisa
  // de onde elas vieram, pra ela saber que não é lançamento novo.
  const preenchido_de = ensureMonth(req.orgId, uid(req), ym);
  const rows = db.prepare(
    "SELECT * FROM personal_finance WHERE org_id=? AND user_id=? AND ym=? ORDER BY position, id"
  ).all(req.orgId, uid(req), ym);
  const cfg = db.prepare("SELECT salary FROM personal_finance_config WHERE org_id=? AND user_id=?").get(req.orgId, uid(req));
  const salary = cfg?.salary || 0;
  const daCasa = daPerspectivaNoMes(req.orgId, ym, req.user.name);
  const minhas = rows.map((r) => ({ ...r, paid: !!r.paid, impagavel: !!r.impagavel, avulso: !!r.avulso }));

  // O resumo é sobre o dinheiro DELA: a conta da empresa entra na fatura, mas
  // não é gasto dela. Por isso o summary continua olhando só as linhas daqui.
  const resumo = summary(rows, salary);
  resumo.meu.topico = topicoDoSalario(req.user.name); // o nome da linha lá no Financeiro
  resumo.perspectiva = {
    total: +daCasa.reduce((t, f) => t + f.amount, 0).toFixed(2),
    aberto: +daCasa.filter((f) => !f.paid).reduce((t, f) => t + f.amount, 0).toFixed(2),
    quantos: daCasa.length,
  };

  res.json({
    ym, salary, preenchido_de,
    entries: [...minhas, ...daCasa],
    terminadas: terminadasAntesDe(req.orgId, uid(req), ym),
    summary: resumo,
  });
});

/**
 * Marcar paga (ou impagável) uma conta da Perspectiva sem sair desta tela.
 * Ela está fechando a fatura do cartão aqui; mandá-la ao Financeiro para dar um
 * check seria trocar de tela no meio da conta. O que muda é o lançamento de lá
 * — aqui não fica cópia nenhuma.
 */
router.put("/perspectiva/:entryId", (req, res) => {
  const alvo = db.prepare(
    "SELECT * FROM financial_entries WHERE id = ? AND org_id = ? AND type = 'expense'"
  ).get(req.params.entryId, req.orgId);
  if (!alvo) return res.status(404).json({ error: "Lançamento não encontrado." });

  const b = req.body || {};
  if (b.paid !== undefined) {
    db.prepare("UPDATE financial_entries SET status = ?, paid_at = ? WHERE id = ?")
      .run(b.paid ? "paid" : "pending", b.paid ? new Date().toISOString() : null, alvo.id);
  }
  if (b.impagavel !== undefined) {
    db.prepare("UPDATE financial_entries SET impagavel = ? WHERE id = ?").run(b.impagavel ? 1 : 0, alvo.id);
  }
  res.json({ ok: true });
});

// PUT /api/personal-finance/config { salary }
router.put("/config", (req, res) => {
  const salary = Number(req.body?.salary) || 0;
  db.prepare(
    `INSERT INTO personal_finance_config (org_id, user_id, salary) VALUES (?, ?, ?)
     ON CONFLICT(org_id, user_id) DO UPDATE SET salary = excluded.salary`
  ).run(req.orgId, uid(req), salary);
  // O lazer entra no salário dela: mexer aqui refaz a linha do Financeiro.
  // Sem mês no corpo, vale o mês aberto na tela; sem ele, o mês de hoje.
  const ym = (req.body?.ym || new Date().toISOString().slice(0, 7)).slice(0, 7);
  const salario = sincronizaSalarioKaty(req.orgId, uid(req), ym, req.user.name);
  res.json({ ok: true, salary, salario });
});

const insert = db.prepare(
  `INSERT INTO personal_finance (org_id, user_id, ym, name, parcela, amount, method, category, paid, position,
     recurring, installment_num, installment_total, import_id, avulso)
   VALUES (@org_id, @user_id, @ym, @name, @parcela, @amount, @method, @category, @paid, @position,
     @recurring, @installment_num, @installment_total, @import_id, @avulso)`
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
     payment_link, pix_code, boleto_url, invoice_url, recurring, recurring_day, card, impagavel, org_id)
   VALUES ('expense', @description, @amount, NULL, @category, @status, @due_date, @paid_at,
     NULL, NULL, NULL, NULL, @recurring, @recurring_day, @card, @impagavel, @org_id)`
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
        // A marca de impagável acompanha a conta quando ela muda de lugar.
        paid_at: paid ? new Date().toISOString() : null,
        recurring, recurring_day: recurring ? day : null, card: row.method ?? null,
        impagavel: row.impagavel ? 1 : 0, org_id: org,
      });
      created++;
    }
    m++; if (m > 12) { m = 1; y++; }
  }
  return created;
}

/**
 * MANDA A CONTA PARA O FINANCEIRO E TIRA DAQUI.
 *
 * A categoria "Perspectiva" quer dizer "isto é da empresa". A importação de CSV
 * já respeitava isso, mas só ela: criar um gasto à mão nessa categoria, ou
 * trocar a categoria de um gasto que já existia, deixava a conta parada nas
 * finanças pessoais. Ela mudava lá e não mudava no Financeiro — tinha que
 * lembrar de clicar no aviso depois.
 */
function mandarParaOFinanceiro(orgId, userId, linha) {
  const criadas = pushExpenseSeries(orgId, linha, linha.ym);
  db.prepare("DELETE FROM personal_finance WHERE id=? AND user_id=?").run(linha.id, userId);
  return criadas;
}

/**
 * SALÁRIO KATY — uma linha só no Financeiro, ao lado dos outros salários.
 *
 * O que a empresa paga para ela no mês é, nas palavras dela, "o que está lá nas
 * minhas finanças de gastos, mais o que eu colocar de lazer". Então esta linha
 * é o total do mês dela — pago ou não — mais o lazer. Mexeu lá, muda aqui.
 *
 * Não é "o que já saiu": dar um check numa conta não aumenta o salário, porque
 * a conta já estava contada. O que muda o número é mudar as contas ou o lazer.
 *
 * Gasto da Perspectiva não entra: aquilo é da empresa, não é salário dela. E o
 * "pago" da linha é dela: quando a reescrevemos, o status fica como estava.
 */
export function sincronizaSalarioKaty(orgId, userId, ym, nome) {
  const topico = topicoDoSalario(nome);
  const linhas = db.prepare(
    "SELECT amount, paid, category FROM personal_finance WHERE org_id=? AND user_id=? AND ym=?"
  ).all(orgId, userId, ym).map((l) => ({ ...l, paid: !!l.paid }));
  const cfg = db.prepare("SELECT salary FROM personal_finance_config WHERE org_id=? AND user_id=?")
    .get(orgId, userId);
  const total = quantoEhOMeu(linhas, cfg?.salary || 0);

  const atual = db.prepare(
    `SELECT id FROM financial_entries
      WHERE org_id=? AND type='expense' AND category=? AND strftime('%Y-%m', due_date)=?
      ORDER BY id LIMIT 1`
  ).get(orgId, topico, ym);

  if (total <= 0) {
    if (atual) db.prepare("DELETE FROM financial_entries WHERE id=?").run(atual.id);
    return { topico, total: 0 };
  }
  if (atual) {
    // Só o valor e o nome. Se ela marcou como pago lá, continua pago.
    db.prepare("UPDATE financial_entries SET description=?, amount=? WHERE id=?")
      .run(topico, total, atual.id);
  } else {
    insertExpense.run({
      description: topico, amount: total, category: topico,
      status: "pending", due_date: ultimoDiaDoMes(ym), paid_at: null,
      recurring: 0, recurring_day: null, card: null, impagavel: 0, org_id: orgId,
    });
  }
  return { topico, total };
}

const ymNext = (ym) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const ymPrev = (ym) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const monthHasRows = (org, user, ym) => !!db.prepare("SELECT 1 FROM personal_finance WHERE org_id=? AND user_id=? AND ym=? LIMIT 1").get(org, user, ym);

// Avança uma conta um mês pra frente. Devolve a linha do mês seguinte, ou null
// se a conta acabou (parcela final) ou não se repete.
function rollForward(row, ym, i) {
  // O PADRÃO É ACOMPANHAR. Antes, só ia para o mês seguinte a conta com
  // "Mensal" ou "1/10" escrito na parcela — e como quase nenhuma tem isso
  // escrito, o mês novo abria vazio e ela tinha de reimportar o CSV. Conta de
  // casa é conta que volta: agora a exceção é a conta marcada "só neste mês".
  if (row.avulso) return null;
  if (isPerspectiva(row.category)) return null; // Perspectiva vive no Financeiro, não aqui
  let parcela = row.parcela, num = row.installment_num, total = row.installment_total;
  // A LINHA ANTIGA SÓ TEM O TEXTO. Importações antigas gravaram "3/3" na
  // parcela e deixaram os campos de número vazios. Sem reler o texto, a conta
  // era copiada como "3/3" mês após mês: nunca andava e nunca acabava.
  if (total == null) {
    const pi = parcelaInfo(row.parcela);
    if (pi.total != null) { num = pi.num; total = pi.total; }
  }
  if (total != null) {
    const next = (Number(num) || 0) + 1;
    if (next > total) return null;               // acabou de pagar — some no próximo mês
    num = next; parcela = `${next}/${total}`;
  }
  return {
    org_id: row.org_id, user_id: row.user_id, ym, name: row.name,
    parcela, amount: Number(row.amount) || 0, method: row.method ?? null, category: row.category ?? null,
    paid: 0, position: i, recurring: row.recurring ? 1 : 0,
    installment_num: num ?? null, installment_total: total ?? null, import_id: null, avulso: 0,
  };
}

// Garante que o mês pedido esteja preenchido, puxando as contas dos meses
// anteriores automaticamente (sem precisar reimportar). Só gera em meses vazios.
function ensureMonth(org, user, ym) {
  if (monthHasRows(org, user, ym)) return null;
  // acha o mês anterior mais recente que tenha lançamentos
  let src = null, cur = ymPrev(ym);
  for (let i = 0; i < 36 && cur >= "2000-01"; i++) {
    if (monthHasRows(org, user, cur)) { src = cur; break; }
    cur = ymPrev(cur);
  }
  if (!src) return null;                         // nada pra puxar
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
  return monthHasRows(org, user, ym) ? src : null;
}

// Verifica se um mês já tem uma conta com aquele nome (pra não duplicar).
const nameExistsInMonth = db.prepare(
  "SELECT 1 FROM personal_finance WHERE org_id=? AND user_id=? AND ym=? AND lower(name)=lower(?) LIMIT 1"
);

// Propaga uma conta recorrente (recém-criada ou recém-marcada como fixa/parcelada)
// para os PRÓXIMOS meses QUE JÁ EXISTEM (que já foram abertos). Meses futuros
// ainda vazios são preenchidos sozinhos pelo ensureMonth quando você entra neles.
// Sem isso, marcar algo como "fixa"/"8/10" só repetia em mês vazio — se o mês
// seguinte já tinha lançamentos, a conta nova não aparecia lá. Não duplica: pula
// meses que já têm uma conta com o mesmo nome.
function propagateForward(org, user, startYm, row) {
  if (!row.recurring) return 0;
  if (isPerspectiva(row.category)) return 0; // Perspectiva vive no Financeiro
  const total = row.installment_total != null ? Number(row.installment_total) : null;
  const baseNum = Number(row.installment_num) || 0;
  let created = 0;
  const tx = db.transaction(() => {
    let m = ymNext(startYm);
    for (let step = 0; step < 240; step++) {      // trava de segurança
      if (!monthHasRows(org, user, m)) break;      // fim do que já existe
      let parcela = row.parcela, curNum = null;
      if (total != null) {
        curNum = baseNum + (step + 1);
        if (curNum > total) break;                 // acabaram as parcelas
        parcela = `${curNum}/${total}`;
      }
      if (!nameExistsInMonth.get(org, user, m, row.name)) {
        insert.run({
          org_id: org, user_id: user, ym: m, name: row.name,
          parcela, amount: Number(row.amount) || 0, method: row.method ?? null,
          category: row.category ?? null, paid: 0, position: Number(row.position) || 0,
          recurring: 1, installment_num: total != null ? curNum : null,
          installment_total: total, import_id: null, avulso: 0,
        });
        created++;
      }
      m = ymNext(m);
    }
  });
  tx();
  return created;
}

// POST /api/personal-finance  { ym, name, ... }
router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.name?.trim()) return res.status(400).json({ error: "Informe o nome do gasto." });
  const ym = (b.ym || new Date().toISOString().slice(0, 7)).slice(0, 7);
  // Lançar num mês que ela nunca abriu não pode "inaugurar" o mês com essa conta
  // sozinha: as contas que vinham dos meses anteriores têm de estar lá também.
  ensureMonth(req.orgId, uid(req), ym);
  // se veio recurring/parcelas explícitas usa; senão deriva do texto da parcela
  const pi = parcelaInfo(b.parcela);
  const recurring = b.recurring !== undefined ? (b.recurring ? 1 : 0) : pi.recurring;
  const info = insert.run({
    org_id: req.orgId, user_id: uid(req), ym, name: b.name.trim(),
    parcela: b.parcela ?? null, amount: Number(b.amount) || 0,
    method: b.method ?? null, category: b.category ?? null,
    paid: b.paid ? 1 : 0, position: Number(b.position) || 0,
    recurring, installment_num: b.installment_num ?? pi.num, installment_total: b.installment_total ?? pi.total,
    import_id: null, avulso: b.avulso ? 1 : 0,
  });
  const created = db.prepare("SELECT * FROM personal_finance WHERE id=?").get(info.lastInsertRowid);
  // Gasto da empresa não fica aqui: vai direto para o Financeiro → Despesas.
  if (isPerspectiva(created.category)) {
    const criadas = mandarParaOFinanceiro(req.orgId, uid(req), created);
    return res.status(201).json({ ...created, foi_para_o_financeiro: true, despesas: criadas });
  }
  // Se é fixa/parcelada, já leva pros próximos meses que existem (os vazios são
  // preenchidos sozinhos quando ela entrar neles).
  if (created.recurring) propagateForward(req.orgId, uid(req), ym, created);
  sincronizaSalarioKaty(req.orgId, uid(req), ym, req.user.name);
  res.status(201).json(created);
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
        recurring: pi.recurring, installment_num: pi.num, installment_total: pi.total,
        import_id: importId, avulso: e.avulso ? 1 : 0,
      });
      n++;
    });
    db.prepare("UPDATE personal_finance_imports SET count=? WHERE id=?").run(n, importId);
  });
  tx();
  sincronizaSalarioKaty(req.orgId, uid(req), ym, req.user.name);
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
  sincronizaSalarioKaty(req.orgId, uid(req), imp.ym, req.user.name);
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
  const salario = sincronizaSalarioKaty(req.orgId, uid(req), ym, req.user.name);
  res.json({ ok: true, salario });
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

  // Renomeou uma categoria inteira PARA Perspectiva: todas essas contas passam
  // a ser da empresa e vão junto, na mesma ação.
  let foram = 0, despesas = 0;
  if (isPerspectiva(to)) {
    const tx = db.transaction(() => {
      const linhas = db.prepare(
        "SELECT * FROM personal_finance WHERE org_id=? AND user_id=? AND ym=? AND category=?"
      ).all(req.orgId, uid(req), ym, to);
      for (const l of linhas) { despesas += mandarParaOFinanceiro(req.orgId, uid(req), l); foram++; }
    });
    tx();
  }
  res.json({ ok: true, foi_para_o_financeiro: foram, despesas });
});

// PUT /api/personal-finance/:id — só o dono edita.
router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM personal_finance WHERE id=? AND org_id=? AND user_id=?").get(req.params.id, req.orgId, uid(req));
  if (!cur) return res.status(404).json({ error: "Não encontrado." });
  const b = req.body || {};
  const m = {
    ...cur, ...b,
    paid: b.paid !== undefined ? (b.paid ? 1 : 0) : cur.paid,
    impagavel: b.impagavel !== undefined ? (b.impagavel ? 1 : 0) : cur.impagavel,
    avulso: b.avulso !== undefined ? (b.avulso ? 1 : 0) : cur.avulso,
    amount: b.amount !== undefined ? (Number(b.amount) || 0) : cur.amount,
  };
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
       category=@category, paid=@paid, impagavel=@impagavel, avulso=@avulso, recurring=@recurring,
       installment_num=@installment_num, installment_total=@installment_total
     WHERE id=@id AND user_id=@user_id`
  ).run({ ...m, id: req.params.id, user_id: uid(req) });
  const updated = db.prepare("SELECT * FROM personal_finance WHERE id=?").get(req.params.id);
  // TROCOU A CATEGORIA PARA PERSPECTIVA: a conta muda de lugar na hora.
  // É o que ela pediu — mudar aqui tem que mudar lá, sem um segundo clique.
  if (isPerspectiva(updated.category) && !isPerspectiva(cur.category)) {
    const criadas = mandarParaOFinanceiro(req.orgId, uid(req), updated);
    return res.json({ ...updated, foi_para_o_financeiro: true, despesas: criadas });
  }
  // Virou fixa/parcelada (ou mudou a parcela)? Repete pros próximos meses que já
  // existem — sem duplicar os que já têm essa conta.
  if (updated.recurring && (b.parcela !== undefined || b.recurring !== undefined)) {
    propagateForward(req.orgId, uid(req), updated.ym, updated);
  }
  // Deu (ou tirou) o check: a linha "Salário Katy" do Financeiro acompanha.
  const salario = sincronizaSalarioKaty(req.orgId, uid(req), updated.ym, req.user.name);
  res.json({ ...updated, salario });
});

router.delete("/:id", (req, res) => {
  const linha = db.prepare("SELECT ym FROM personal_finance WHERE id=? AND org_id=? AND user_id=?").get(req.params.id, req.orgId, uid(req));
  db.prepare("DELETE FROM personal_finance WHERE id=? AND org_id=? AND user_id=?").run(req.params.id, req.orgId, uid(req));
  if (linha) sincronizaSalarioKaty(req.orgId, uid(req), linha.ym, req.user.name);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// DÍVIDAS pessoais — "estou devendo X pra fulano e vou pagando aos poucos".
// Cada dívida tem um total e uma lista de pagamentos; o saldo é total - pago.
// Tudo privado por usuário (uid), como o resto desta aba.
// ---------------------------------------------------------------------------

// Monta uma dívida com seus pagamentos e o saldo já calculado.
function debtWithPayments(debt, uidv, org) {
  const payments = db.prepare(
    "SELECT id, amount, paid_on, note, created_at FROM personal_debt_payments WHERE debt_id=? AND user_id=? AND org_id=? ORDER BY COALESCE(paid_on, created_at), id"
  ).all(debt.id, uidv, org);
  const pago = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const total = Number(debt.total) || 0;
  return { ...debt, payments, pago: +pago.toFixed(2), saldo: +Math.max(0, total - pago).toFixed(2), quitada: pago >= total && total > 0 };
}

// GET /api/personal-finance/debts — lista as dívidas em aberto (com pagamentos).
router.get("/debts", (req, res) => {
  const incluirArquivadas = req.query.all === "1";
  const debts = db.prepare(
    `SELECT * FROM personal_debts WHERE org_id=? AND user_id=? ${incluirArquivadas ? "" : "AND archived=0"} ORDER BY archived, created_at DESC, id DESC`
  ).all(req.orgId, uid(req));
  res.json(debts.map((d) => debtWithPayments(d, uid(req), req.orgId)));
});

// POST /api/personal-finance/debts { name, total, note }
router.post("/debts", (req, res) => {
  const b = req.body || {};
  if (!b.name?.trim()) return res.status(400).json({ error: "Diga pra quem você deve." });
  const info = db.prepare(
    "INSERT INTO personal_debts (org_id, user_id, name, total, note) VALUES (?, ?, ?, ?, ?)"
  ).run(req.orgId, uid(req), b.name.trim(), Number(b.total) || 0, b.note?.trim() || null);
  const debt = db.prepare("SELECT * FROM personal_debts WHERE id=?").get(info.lastInsertRowid);
  res.status(201).json(debtWithPayments(debt, uid(req), req.orgId));
});

// PUT /api/personal-finance/debts/:id { name, total, note, archived }
router.put("/debts/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM personal_debts WHERE id=? AND org_id=? AND user_id=?").get(req.params.id, req.orgId, uid(req));
  if (!cur) return res.status(404).json({ error: "Não encontrado." });
  const b = req.body || {};
  db.prepare("UPDATE personal_debts SET name=?, total=?, note=?, archived=? WHERE id=? AND user_id=?").run(
    b.name?.trim() || cur.name,
    b.total !== undefined ? (Number(b.total) || 0) : cur.total,
    b.note !== undefined ? (b.note?.trim() || null) : cur.note,
    b.archived !== undefined ? (b.archived ? 1 : 0) : cur.archived,
    req.params.id, uid(req)
  );
  const debt = db.prepare("SELECT * FROM personal_debts WHERE id=?").get(req.params.id);
  res.json(debtWithPayments(debt, uid(req), req.orgId));
});

// DELETE /api/personal-finance/debts/:id — apaga a dívida e seus pagamentos.
router.delete("/debts/:id", (req, res) => {
  const cur = db.prepare("SELECT id FROM personal_debts WHERE id=? AND org_id=? AND user_id=?").get(req.params.id, req.orgId, uid(req));
  if (cur) {
    db.prepare("DELETE FROM personal_debt_payments WHERE debt_id=? AND user_id=?").run(req.params.id, uid(req));
    db.prepare("DELETE FROM personal_debts WHERE id=? AND user_id=?").run(req.params.id, uid(req));
  }
  res.json({ ok: true });
});

// POST /api/personal-finance/debts/:id/payments { amount, paid_on, note }
router.post("/debts/:id/payments", (req, res) => {
  const debt = db.prepare("SELECT * FROM personal_debts WHERE id=? AND org_id=? AND user_id=?").get(req.params.id, req.orgId, uid(req));
  if (!debt) return res.status(404).json({ error: "Dívida não encontrada." });
  const b = req.body || {};
  const amount = Number(b.amount) || 0;
  if (amount <= 0) return res.status(400).json({ error: "Informe quanto você pagou." });
  const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(b.paid_on || "") ? b.paid_on : new Date().toISOString().slice(0, 10);
  db.prepare(
    "INSERT INTO personal_debt_payments (debt_id, org_id, user_id, amount, paid_on, note) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(debt.id, req.orgId, uid(req), amount, paidOn, b.note?.trim() || null);
  res.status(201).json(debtWithPayments(debt, uid(req), req.orgId));
});

// DELETE /api/personal-finance/debts/:id/payments/:pid — desfaz um pagamento.
router.delete("/debts/:id/payments/:pid", (req, res) => {
  const debt = db.prepare("SELECT * FROM personal_debts WHERE id=? AND org_id=? AND user_id=?").get(req.params.id, req.orgId, uid(req));
  if (!debt) return res.status(404).json({ error: "Dívida não encontrada." });
  db.prepare("DELETE FROM personal_debt_payments WHERE id=? AND debt_id=? AND user_id=?").run(req.params.pid, debt.id, uid(req));
  res.json(debtWithPayments(debt, uid(req), req.orgId));
});

export default router;
