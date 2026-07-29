// ---------------------------------------------------------------------------
// Monitor de planos: mede o uso de cada agência contra os limites do plano,
// avisa o dono (master) e a agência, dá uns dias de tolerância antes de
// restringir, e lembra de testes acabando. Roda de tempos em tempos.
// ---------------------------------------------------------------------------
import { db } from "./db.js";
import { asaas } from "./routes/billing.js";

const GB = 1024 * 1024 * 1024;
const GRACE_DAYS = 7;

// Preço da escada no mês N (0 = primeiro mês). Regras:
//  - se há "1º mês", o mês 0 usa esse valor;
//  - depois a promo vale por "promo_months" meses;
//  - em seguida, o preço cheio.
export function ladderPrice(plan, months) {
  if (!plan) return 0;
  const fm = plan.first_month_price != null ? 1 : 0;
  if (fm && months < 1) return plan.first_month_price;
  const promoAte = fm + (plan.promo_months || 0);
  if (plan.promo_price != null && months < promoAte) return plan.promo_price;
  return plan.price || 0;
}

// Quantos meses inteiros se passaram desde o início da assinatura.
function monthsSince(iso) {
  if (!iso) return 0;
  const ini = new Date(iso.replace(" ", "T") + "Z");
  const now = new Date();
  let m = (now.getFullYear() - ini.getFullYear()) * 12 + (now.getMonth() - ini.getMonth());
  if (now.getDate() < ini.getDate()) m -= 1; // ainda não completou o mês
  return Math.max(0, m);
}

// Ajusta o valor das assinaturas Asaas conforme a escada de preço.
// Só age quando há assinatura ativa e o valor-alvo mudou de fase.
export async function runPriceLadder() {
  const orgs = db.prepare(
    `SELECT o.*, p.price, p.promo_price, p.promo_months, p.first_month_price
     FROM organizations o JOIN saas_plans p ON p.id = o.plan_id
     WHERE o.is_master = 0 AND o.asaas_subscription_id IS NOT NULL AND o.plan_started_at IS NOT NULL`
  ).all();
  for (const o of orgs) {
    const alvo = ladderPrice(o, monthsSince(o.plan_started_at));
    if (!alvo || Number(o.current_price) === Number(alvo)) continue;
    try {
      // Atualiza o valor da assinatura no Asaas (usa a chave do master).
      const master = db.prepare("SELECT id FROM organizations WHERE is_master = 1").get();
      await asaas(master.id, `/subscriptions/${o.asaas_subscription_id}`, {
        method: "POST", body: { value: alvo, updatePendingPayments: true },
      });
      db.prepare("UPDATE organizations SET current_price = ? WHERE id = ?").run(alvo, o.id);
    } catch (e) { console.error("price-ladder:", o.name, e.message); }
  }
}

// Uso atual de uma agência: pessoas, clientes ativos e armazenamento.
export function computeUsage(orgId) {
  const users = db.prepare("SELECT COUNT(*) AS n FROM users WHERE org_id = ?").get(orgId).n;
  const clients = db.prepare("SELECT COUNT(*) AS n FROM clients WHERE org_id = ? AND status = 'active'").get(orgId).n;
  const bytes = db.prepare("SELECT COALESCE(SUM(size), 0) AS b FROM files WHERE org_id = ?").get(orgId).b;
  return { users, clients, storage_bytes: bytes, storage_gb: +(bytes / GB).toFixed(2) };
}

// Junta uso + limites do plano + situação (ok / atenção / estourado / tolerância).
export function orgUsageStatus(org) {
  const plan = org.plan_id ? db.prepare("SELECT * FROM saas_plans WHERE id = ?").get(org.plan_id) : null;
  const u = computeUsage(org.id);
  const limite = {
    users: plan?.max_users ?? null,
    clients: plan?.max_clients ?? null,
    storage_gb: plan?.storage_gb ?? null,
  };
  const pct = (usado, max) => (max ? Math.round((usado / max) * 100) : null); // null = ilimitado
  const pcts = {
    users: pct(u.users, limite.users),
    clients: pct(u.clients, limite.clients),
    storage: pct(u.storage_gb, limite.storage_gb),
  };
  const maiorPct = Math.max(...Object.values(pcts).filter((x) => x != null), 0);
  const estourou = Object.values(pcts).some((x) => x != null && x >= 100);
  const graceAtiva = org.limit_grace_until && new Date(org.limit_grace_until.replace(" ", "T") + "Z") > new Date();
  let situacao = "ok";
  if (estourou) situacao = graceAtiva ? "tolerancia" : "estourado";
  else if (maiorPct >= 80) situacao = "atencao";
  return { usage: u, limits: limite, pcts, maiorPct, situacao, plan_name: plan?.name || null,
    grace_until: org.limit_grace_until || null };
}

// Enforcement suave: pode criar mais um cliente?
// Ao estourar, começa a tolerância NA HORA (libera) e avisa; só bloqueia
// quando a tolerância vence sem o upgrade.
export function canAddClient(orgId) {
  const org = db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId);
  if (!org || org.is_master) return { ok: true };
  const st = orgUsageStatus(org);
  if (st.limits.clients == null) return { ok: true };            // ilimitado
  if (st.usage.clients < st.limits.clients) return { ok: true }; // dentro do limite

  const graceVenceu = org.limit_grace_until && new Date(org.limit_grace_until.replace(" ", "T") + "Z") <= new Date();
  if (graceVenceu) {
    return { ok: false, error: `Você atingiu o limite de ${st.limits.clients} clientes do plano ${st.plan_name || ""}. Faça upgrade para adicionar mais.` };
  }
  // Ainda sem tolerância definida → começa agora, libera e avisa (uma vez).
  if (!org.limit_grace_until) {
    db.prepare("UPDATE organizations SET limit_grace_until = datetime('now', ?) WHERE id = ?")
      .run(`+${GRACE_DAYS} days`, org.id);
    avisar("agency", org.id, `⚠️ Você passou do limite de ${st.limits.clients} clientes do plano ${st.plan_name || ""}. Tem ${GRACE_DAYS} dias para fazer upgrade.`);
    const master = db.prepare("SELECT id FROM organizations WHERE is_master = 1").get();
    if (master) avisar("agency", master.id, `🚨 ${org.name} passou do limite de clientes (plano ${st.plan_name || ""}) — tolerância de ${GRACE_DAYS} dias.`);
  }
  return { ok: true };
}

function avisar(audience, orgId, message, clientId = null) {
  db.prepare("INSERT INTO notifications (audience, client_id, message, org_id) VALUES (?, ?, ?, ?)")
    .run(audience, clientId, message, orgId);
}

// Uma passada: avalia todas as agências e dispara os avisos (sem repetir no dia).
export function runPlanCheck() {
  const orgs = db.prepare("SELECT * FROM organizations WHERE is_master = 0").all();
  const master = db.prepare("SELECT id FROM organizations WHERE is_master = 1").get();
  const hoje = new Date().toISOString().slice(0, 10);

  orgs.forEach((org) => {
    const jaAvisouHoje = org.usage_notified_at && org.usage_notified_at.slice(0, 10) === hoje;
    const st = orgUsageStatus(org);

    // 1) Estouro de limite → inicia tolerância e avisa (uma vez).
    if (st.situacao === "estourado" && !org.limit_grace_until) {
      db.prepare("UPDATE organizations SET limit_grace_until = datetime('now', ?) WHERE id = ?")
        .run(`+${GRACE_DAYS} days`, org.id);
      avisar("agency", org.id, `⚠️ Você atingiu o limite do plano ${st.plan_name || ""}. Você tem ${GRACE_DAYS} dias para fazer upgrade antes de ficar restrito.`);
      if (master) avisar("agency", master.id, `🚨 ${org.name} estourou o limite do plano ${st.plan_name || ""} — tolerância de ${GRACE_DAYS} dias iniciada.`);
    } else if (st.situacao === "atencao" && !jaAvisouHoje) {
      // 2) Perto do limite (≥80%).
      avisar("agency", org.id, `📈 Você está usando ${st.maiorPct}% do seu plano ${st.plan_name || ""}. Considere um upgrade.`);
    }

    // 3) Tolerância venceu e ainda está estourado → avisa que restringiu.
    const graceVenceu = org.limit_grace_until && new Date(org.limit_grace_until.replace(" ", "T") + "Z") <= new Date();
    if (graceVenceu && st.situacao === "estourado" && !jaAvisouHoje) {
      avisar("agency", org.id, `⛔ O período de tolerância acabou. Novos clientes estão bloqueados até o upgrade do plano ${st.plan_name || ""}.`);
      if (master) avisar("agency", master.id, `⛔ ${org.name} segue acima do limite após a tolerância — cadastro de clientes restrito.`);
    }
    // Se voltou pra dentro do limite, zera a tolerância.
    if (st.situacao === "ok" && org.limit_grace_until) {
      db.prepare("UPDATE organizations SET limit_grace_until = NULL WHERE id = ?").run(org.id);
    }

    // 4) Teste grátis acabando (7/3/1 dias).
    const diasTeste = org.trial_ends
      ? Math.ceil((new Date(org.trial_ends.replace(" ", "T") + "Z") - new Date()) / 86400000)
      : null;
    if (!org.billing_active && [7, 3, 1].includes(diasTeste) && !jaAvisouHoje) {
      avisar("agency", org.id, `⏳ Seu teste grátis acaba em ${diasTeste} dia(s). Ative um plano para não perder o acesso.`);
      if (master) avisar("agency", master.id, `⏳ Teste de ${org.name} acaba em ${diasTeste} dia(s).`);
    }

    if (st.situacao !== "ok" || diasTeste != null) {
      db.prepare("UPDATE organizations SET usage_notified_at = datetime('now') WHERE id = ?").run(org.id);
    }
  });
}

export function startPlanMonitor() {
  const SEIS_HORAS = 6 * 60 * 60 * 1000;
  const passada = () => {
    try { runPlanCheck(); } catch (e) { console.error("plan-monitor:", e.message); }
    runPriceLadder().catch((e) => console.error("price-ladder:", e.message));
  };
  setTimeout(passada, 15000);
  setInterval(passada, SEIS_HORAS).unref?.();
}
