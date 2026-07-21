import { Router } from "express";
import { db } from "../db.js";
import { authRequired, hashPassword } from "../auth.js";

const router = Router();
router.use(authRequired);

// Nunca expõe o hash da senha do portal; informa apenas se há acesso ativo.
function publicClient(row, servicesByClient) {
  if (!row) return row;
  const { portal_password_hash, ...rest } = row;
  return {
    ...rest,
    portal_enabled: Boolean(row.portal_email && portal_password_hash),
    services: servicesByClient?.[row.id] ?? loadServices(row.id),
  };
}

function loadServices(clientId) {
  return db
    .prepare(
      `SELECT cs.service_id, cs.price, s.name
       FROM client_services cs JOIN services s ON s.id = cs.service_id
       WHERE cs.client_id = ? ORDER BY s.name`
    )
    .all(clientId);
}

function saveServices(clientId, services, orgId) {
  if (!Array.isArray(services)) return;
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM client_services WHERE client_id = ?").run(clientId);
    const ins = db.prepare("INSERT OR IGNORE INTO client_services (client_id, service_id, price) VALUES (?, ?, ?)");
    services.forEach((s) => {
      // Só aceita serviços do próprio escritório.
      const owned = db.prepare("SELECT 1 FROM services WHERE id = ? AND org_id = ?").get(s.service_id, orgId);
      if (owned) ins.run(clientId, s.service_id, Number(s.price) || 0);
    });
  });
  tx();
}

// ---------------------------------------------------------------------------
// Geração automática de contrato a partir dos modelos dos serviços.
// ---------------------------------------------------------------------------
const DEFAULT_TEMPLATE = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS — {{servico}}

CONTRATANTE: {{cliente}}{{empresa_linha}}
SEGMENTO: {{segmento}}
ENDEREÇO: {{endereco}}

OBJETO: prestação do serviço de {{servico}} pelo valor mensal de {{valor}}.
VIGÊNCIA: de {{inicio}} até {{fim}}.
PAGAMENTO: todo dia {{dia_pagamento}} de cada mês.`;

function monthsBetween(startStr, endStr) {
  if (!startStr || !endStr) return null;
  const s = new Date(`${startStr}T00:00:00`);
  const e = new Date(`${endStr}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  let m = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  // fim inclusivo: 01/07 → 30/06 do ano seguinte conta como 12 meses
  if (e.getDate() !== s.getDate() && e.getDate() >= s.getDate() - 1) m += 1;
  return Math.max(m, 1);
}

function brDate(str) {
  if (!str) return "indeterminado";
  const d = new Date(`${str}T00:00:00`);
  return Number.isNaN(d.getTime()) ? str : d.toLocaleDateString("pt-BR");
}

function brl(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fillTemplate(template, ctx) {
  return template
    .replaceAll("{{cliente}}", ctx.cliente)
    .replaceAll("{{empresa}}", ctx.empresa)
    .replaceAll("{{empresa_linha}}", ctx.empresa ? ` (${ctx.empresa})` : "")
    .replaceAll("{{segmento}}", ctx.segmento)
    .replaceAll("{{endereco}}", ctx.endereco)
    .replaceAll("{{servico}}", ctx.servico)
    .replaceAll("{{valor}}", ctx.valor)
    .replaceAll("{{valor_total}}", ctx.valor_total)
    .replaceAll("{{inicio}}", ctx.inicio)
    .replaceAll("{{fim}}", ctx.fim)
    .replaceAll("{{duracao_meses}}", ctx.duracao_meses)
    .replaceAll("{{dia_pagamento}}", ctx.dia_pagamento);
}

function generateContract(client, services) {
  if (!services.length) return null;
  const rows = services
    .map((s) => ({
      ...s,
      template: db.prepare("SELECT contract_template FROM services WHERE id = ?").get(s.service_id)?.contract_template,
    }));
  const total = rows.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
  const duration = monthsBetween(client.work_start, client.work_end);

  const baseCtx = {
    cliente: client.name,
    empresa: client.company || "",
    segmento: client.segment || "—",
    endereco: client.address || "—",
    valor_total: brl(total),
    inicio: brDate(client.work_start),
    fim: brDate(client.work_end),
    duracao_meses: duration ? String(duration) : "indeterminado",
    dia_pagamento: client.payment_day ? String(client.payment_day) : "—",
  };

  const body = rows
    .map((s) =>
      fillTemplate(s.template || DEFAULT_TEMPLATE, { ...baseCtx, servico: s.name, valor: brl(s.price) })
    )
    .join("\n\n────────────────────────\n\n");

  // 1º vencimento: dia de pagamento no mês do início do trabalho.
  let firstDue = null;
  if (client.work_start && client.payment_day) {
    const start = new Date(`${client.work_start}T00:00:00`);
    const due = new Date(start.getFullYear(), start.getMonth(), client.payment_day);
    if (due < start) due.setMonth(due.getMonth() + 1);
    firstDue = due.toISOString().slice(0, 10);
  }

  const info = db
    .prepare(
      `INSERT INTO contracts (client_id, title, value, duration_months, start_date, first_due_date, status, notes, org_id)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
    .run(
      client.id,
      `Contrato — ${rows.map((s) => s.name).join(" + ")}`,
      total,
      duration,
      client.work_start ?? null,
      firstDue,
      body,
      client.org_id
    );
  return info.lastInsertRowid;
}

// ---------------------------------------------------------------------------
// Projeto base mensal: criado/atualizado automaticamente no cadastro.
// ---------------------------------------------------------------------------
function upsertPlanProject(client) {
  const posts = Number(client.posts_per_month) || 0;
  const videos = Number(client.videos_per_month) || 0;
  if (!posts && !videos) return;
  const existing = db
    .prepare("SELECT id FROM projects WHERE client_id = ? AND name LIKE 'Plano mensal%'")
    .get(client.id);
  if (existing) {
    db.prepare("UPDATE projects SET monthly_posts = ?, monthly_videos = ? WHERE id = ?")
      .run(posts, videos, existing.id);
  } else {
    db.prepare(
      `INSERT INTO projects (name, client_id, description, status, monthly_posts, monthly_videos, org_id)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      `Plano mensal — ${client.name}`,
      client.id,
      `Base de conteúdo: ${posts} posts + ${videos} vídeos por mês. Use "Lançar mês" para criar as tarefas.`,
      posts,
      videos,
      client.org_id
    );
  }
}

// Mensalidades no financeiro: uma cobrança por mês da vigência do contrato.
function generateReceivables(client, total, durationMonths) {
  if (!client.payment_day || !total) return 0;
  const already = db
    .prepare("SELECT COUNT(*) AS n FROM financial_entries WHERE client_id = ? AND description LIKE 'Mensalidade%'")
    .get(client.id).n;
  if (already > 0) return 0; // não duplica

  const months = Math.min(durationMonths || 12, 24);
  const start = client.work_start ? new Date(`${client.work_start}T00:00:00`) : new Date();
  const ins = db.prepare(
    `INSERT INTO financial_entries (type, description, amount, client_id, status, due_date, org_id)
     VALUES ('income', ?, ?, ?, 'pending', ?, ?)`
  );
  const tx = db.transaction(() => {
    for (let m = 0; m < months; m++) {
      const due = new Date(start.getFullYear(), start.getMonth() + m, client.payment_day);
      if (m === 0 && due < start) due.setMonth(due.getMonth() + 1);
      ins.run(
        `Mensalidade ${client.name} — ${String(due.getMonth() + 1).padStart(2, "0")}/${due.getFullYear()}`,
        total,
        client.id,
        due.toISOString().slice(0, 10),
        client.org_id
      );
    }
  });
  tx();
  return months;
}

// ---------------------------------------------------------------------------

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM clients WHERE org_id = ? ORDER BY name").all(req.orgId);
  // agrupa serviços numa única query para evitar N+1
  const all = db
    .prepare(
      `SELECT cs.client_id, cs.service_id, cs.price, s.name
       FROM client_services cs
       JOIN services s ON s.id = cs.service_id
       JOIN clients c ON c.id = cs.client_id
       WHERE c.org_id = ?`
    )
    .all(req.orgId);
  const grouped = {};
  all.forEach((r) => { (grouped[r.client_id] ||= []).push(r); });
  rows.forEach((r) => { grouped[r.id] ||= []; });
  res.json(rows.map((r) => publicClient(r, grouped)));
});

router.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!row) return res.status(404).json({ error: "Cliente não encontrado." });
  res.json(publicClient(row));
});

router.post("/", (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "Nome é obrigatório." });
  const info = db
    .prepare(
      `INSERT INTO clients (name, email, phone, company, drive_url, status, notes,
                            segment, address, work_start, work_end, payment_day,
                            posts_per_month, videos_per_month,
                            portal_email, portal_password_hash, org_id)
       VALUES (@name, @email, @phone, @company, @drive_url, @status, @notes,
               @segment, @address, @work_start, @work_end, @payment_day,
               @posts_per_month, @videos_per_month,
               @portal_email, @portal_password_hash, @org_id)`
    )
    .run({
      org_id: req.orgId,
      posts_per_month: b.posts_per_month ? Number(b.posts_per_month) : null,
      videos_per_month: b.videos_per_month ? Number(b.videos_per_month) : null,
      name: b.name,
      email: b.email ?? null,
      phone: b.phone ?? null,
      company: b.company ?? null,
      drive_url: b.drive_url ?? null,
      status: b.status ?? "active",
      notes: b.notes ?? null,
      segment: b.segment ?? null,
      address: b.address ?? null,
      work_start: b.work_start ?? null,
      work_end: b.work_end ?? null,
      payment_day: b.payment_day ? Number(b.payment_day) : null,
      portal_email: b.portal_email ? b.portal_email.toLowerCase() : null,
      portal_password_hash: b.portal_password ? hashPassword(b.portal_password) : null,
    });

  saveServices(info.lastInsertRowid, b.services, req.orgId);
  const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(info.lastInsertRowid);
  upsertPlanProject(client); // projeto base criado automaticamente
  if (b.generate_contract && Array.isArray(b.services) && b.services.length) {
    generateContract(client, loadServices(client.id));
    const svcs = loadServices(client.id);
    const total = svcs.reduce((s, x) => s + (Number(x.price) || 0), 0);
    generateReceivables(client, total, monthsBetween(client.work_start, client.work_end));
  }
  res.status(201).json(publicClient(client));
});

router.put("/:id", (req, res) => {
  const cur = db.prepare("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: "Cliente não encontrado." });
  const b = req.body || {};
  const merged = {
    ...cur,
    ...b,
    payment_day: b.payment_day !== undefined ? (b.payment_day ? Number(b.payment_day) : null) : cur.payment_day,
    posts_per_month: b.posts_per_month !== undefined ? (b.posts_per_month ? Number(b.posts_per_month) : null) : cur.posts_per_month,
    videos_per_month: b.videos_per_month !== undefined ? (b.videos_per_month ? Number(b.videos_per_month) : null) : cur.videos_per_month,
    portal_email: b.portal_email !== undefined ? (b.portal_email ? b.portal_email.toLowerCase() : null) : cur.portal_email,
    // Senha do portal: só troca se veio uma nova; nunca aceita hash de fora.
    portal_password_hash: b.portal_password ? hashPassword(b.portal_password) : cur.portal_password_hash,
    id: req.params.id,
    org_id: req.orgId,
  };
  db.prepare(
    `UPDATE clients SET name=@name, email=@email, phone=@phone, company=@company,
     drive_url=@drive_url, status=@status, notes=@notes,
     segment=@segment, address=@address, work_start=@work_start, work_end=@work_end,
     payment_day=@payment_day, posts_per_month=@posts_per_month,
     videos_per_month=@videos_per_month, portal_email=@portal_email,
     portal_password_hash=@portal_password_hash WHERE id=@id AND org_id=@org_id`
  ).run(merged);

  if (b.services !== undefined) saveServices(req.params.id, b.services, req.orgId);
  const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(req.params.id);
  upsertPlanProject(client); // mantém o projeto base em dia
  if (b.generate_contract) {
    const svcs = loadServices(client.id);
    if (svcs.length) {
      generateContract(client, svcs);
      const total = svcs.reduce((s, x) => s + (Number(x.price) || 0), 0);
      generateReceivables(client, total, monthsBetween(client.work_start, client.work_end));
    }
  }
  res.json(publicClient(client));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM clients WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true });
});

export default router;
