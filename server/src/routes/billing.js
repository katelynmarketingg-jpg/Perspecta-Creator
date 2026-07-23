import { Router } from "express";
import { db } from "../db.js";
import { authRequired, adminRequired } from "../auth.js";
import { encrypt, decrypt } from "../crypto.js";

const router = Router();

function asaasBase(env) {
  return env === "sandbox" ? "https://sandbox.asaas.com/api/v3" : "https://api.asaas.com/v3";
}

export function getBilling(orgId) {
  const row = db.prepare("SELECT * FROM org_billing WHERE org_id = ?").get(orgId);
  if (!row) return { configured: false, environment: "production" };
  return { configured: Boolean(row.api_key), environment: row.environment, _key: decrypt(row.api_key) };
}

export async function asaas(orgId, path, { method = "GET", body } = {}) {
  const cfg = getBilling(orgId);
  if (!cfg.configured) {
    const e = new Error("A cobrança automática (Asaas) ainda não foi configurada.");
    e.code = "NO_KEY";
    throw e;
  }
  const res = await fetch(`${asaasBase(cfg.environment)}${path}`, {
    method,
    headers: { "Content-Type": "application/json", access_token: cfg._key },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.errors?.[0]?.description || "O Asaas recusou a operação.");
  return data;
}

// ---- Webhook do Asaas (público): confirma pagamentos ----
// Fica antes do authRequired porque quem chama é o Asaas.
export const billingWebhook = Router();
billingWebhook.post("/asaas", (req, res) => {
  const evt = req.body || {};
  const pay = evt.payment;
  // Quando um pagamento é confirmado, marca a mensalidade como paga.
  if (pay && ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"].includes(evt.event)) {
    // 1) É o pagamento de uma AGÊNCIA ao Perspecta Media (plano)?
    const org = db.prepare("SELECT id FROM organizations WHERE asaas_customer_id = ?").get(pay.customer);
    if (org) {
      db.prepare("UPDATE organizations SET billing_active = 1 WHERE id = ?").run(org.id);
    }
    // 2) Ou o pagamento de um CLIENTE a uma agência?
    const client = db.prepare("SELECT id, org_id FROM clients WHERE asaas_customer_id = ?").get(pay.customer);
    if (client) {
      // Marca a mensalidade em aberto mais antiga como paga.
      const entry = db.prepare(
        `SELECT id FROM financial_entries WHERE client_id = ? AND org_id = ? AND type='income'
         AND status='pending' ORDER BY due_date LIMIT 1`
      ).get(client.id, client.org_id);
      if (entry) {
        db.prepare("UPDATE financial_entries SET status='paid', paid_at=datetime('now') WHERE id=?").run(entry.id);
      }
      db.prepare("INSERT INTO notifications (audience, client_id, message, org_id) VALUES ('agency', ?, ?, ?)")
        .run(client.id, `💳 Pagamento confirmado no cartão (${pay.value ? "R$ " + pay.value : "assinatura"}).`, client.org_id);
    }
  }
  res.json({ received: true });
});

router.use(authRequired);

// ---- Configuração (admin) ----
router.get("/config", (req, res) => {
  const cfg = getBilling(req.orgId);
  res.json({ configured: cfg.configured, environment: cfg.environment });
});

router.put("/config", adminRequired, (req, res) => {
  const { api_key, environment } = req.body || {};
  const env = environment === "sandbox" ? "sandbox" : "production";
  db.prepare(
    `INSERT INTO org_billing (org_id, provider, api_key, environment, updated_at)
     VALUES (?, 'asaas', ?, ?, datetime('now'))
     ON CONFLICT(org_id) DO UPDATE SET
       api_key = COALESCE(excluded.api_key, org_billing.api_key),
       environment = excluded.environment, updated_at = datetime('now')`
  ).run(req.orgId, api_key ? encrypt(api_key) : null, env);
  res.json(getBilling(req.orgId).configured ? { configured: true, environment: env } : { configured: false, environment: env });
});

// ---- Status por cliente ----
router.get("/status", (req, res) => {
  const rows = db.prepare(
    `SELECT id, name, asaas_customer_id, asaas_subscription_id,
            (SELECT COALESCE(SUM(price),0) FROM client_services cs WHERE cs.client_id = clients.id) AS valor,
            payment_day
     FROM clients WHERE org_id = ? AND status = 'active' ORDER BY name`
  ).all(req.orgId);
  res.json({ ...getBilling(req.orgId), clients: rows.map((r) => ({ ...r, subscribed: Boolean(r.asaas_subscription_id) })) });
});

// ---- Criar assinatura recorrente no cartão ----
// Devolve um link onde o cliente cadastra o cartão (página segura do Asaas).
router.post("/subscribe/:clientId", async (req, res) => {
  const c = db.prepare("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(req.params.clientId, req.orgId);
  if (!c) return res.status(404).json({ error: "Cliente não encontrado." });

  const valor = db.prepare("SELECT COALESCE(SUM(price),0) AS v FROM client_services WHERE client_id = ?").get(c.id).v;
  if (!valor) return res.status(400).json({ error: "Defina os serviços e valores do cliente antes de cobrar." });

  try {
    // 1) Garante o cliente no Asaas.
    let customerId = c.asaas_customer_id;
    if (!customerId) {
      const created = await asaas(req.orgId, "/customers", {
        method: "POST",
        body: { name: c.name, email: c.email || undefined, phone: c.phone || undefined, company: c.company || undefined },
      });
      customerId = created.id;
      db.prepare("UPDATE clients SET asaas_customer_id = ? WHERE id = ?").run(customerId, c.id);
    }

    // 2) Cria a assinatura mensal por cartão de crédito.
    const proxDia = c.payment_day || 10;
    const hoje = new Date();
    let venc = new Date(hoje.getFullYear(), hoje.getMonth(), proxDia);
    if (venc < hoje) venc = new Date(hoje.getFullYear(), hoje.getMonth() + 1, proxDia);

    const sub = await asaas(req.orgId, "/subscriptions", {
      method: "POST",
      body: {
        customer: customerId,
        billingType: "CREDIT_CARD",
        cycle: "MONTHLY",
        value: valor,
        nextDueDate: venc.toISOString().slice(0, 10),
        description: `Mensalidade — ${c.name}`,
      },
    });
    db.prepare("UPDATE clients SET asaas_subscription_id = ? WHERE id = ?").run(sub.id, c.id);

    // Link onde o cliente informa o cartão (fatura da 1ª cobrança).
    const invoiceUrl = sub.invoiceUrl || null;
    res.json({ ok: true, subscription_id: sub.id, invoice_url: invoiceUrl });
  } catch (e) {
    if (e.code === "NO_KEY") return res.status(400).json({ error: e.message, needs_key: true });
    res.status(502).json({ error: e.message });
  }
});

// ---- Cancelar assinatura ----
router.delete("/subscribe/:clientId", async (req, res) => {
  const c = db.prepare("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(req.params.clientId, req.orgId);
  if (!c?.asaas_subscription_id) return res.status(404).json({ error: "Sem assinatura ativa." });
  try {
    await asaas(req.orgId, `/subscriptions/${c.asaas_subscription_id}`, { method: "DELETE" });
    db.prepare("UPDATE clients SET asaas_subscription_id = NULL WHERE id = ?").run(c.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

export default router;
