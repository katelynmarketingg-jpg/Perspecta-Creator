// ---------------------------------------------------------------------------
// TRÁFEGO — relatório de anúncios por cliente → plataforma (Meta/Google).
//
// Esta é a ESTRUTURA (a tela e o modelo de dados). Os números reais — saldo,
// valor usado, cliques, impressões — vêm das APIs de anúncios (Meta Ads com
// ads_read, Google Ads com developer token), que são uma conexão à parte e
// dependem de acesso externo. Enquanto não houver conexão, cada cliente aparece
// como "não conectado".
//
// Quando a conexão existir, basta gravar em ad_metrics (por cliente/plataforma),
// de 30 em 30 minutos, que esta mesma rota serve os números.
// ---------------------------------------------------------------------------
import { Router } from "express";
import { db } from "../db.js";
import { authRequired } from "../auth.js";

db.exec(`CREATE TABLE IF NOT EXISTS ad_metrics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER NOT NULL,
  client_id   INTEGER NOT NULL,
  platform    TEXT NOT NULL,                 -- 'meta' | 'google'
  balance     REAL,                          -- saldo da conta
  spent       REAL,                          -- valor usado no período
  clicks      INTEGER,
  impressions INTEGER,
  period      TEXT,                          -- ex.: '2026-11' ou 'últimos 30 dias'
  updated_at  TEXT,                          -- quando o número foi lido da plataforma
  UNIQUE(client_id, platform)
);`);

const router = Router();
router.use(authRequired);

// GET /api/trafego — clientes ativos + os números de cada plataforma (ou null).
router.get("/", (req, res) => {
  const clientes = db
    .prepare("SELECT id, name, company FROM clients WHERE org_id = ? AND archived_at IS NULL ORDER BY name")
    .all(req.orgId);
  const metricas = db.prepare("SELECT * FROM ad_metrics WHERE org_id = ?").all(req.orgId);
  const de = (clientId, plataforma) =>
    metricas.find((m) => m.client_id === clientId && m.platform === plataforma) || null;

  res.json(clientes.map((c) => ({
    id: c.id,
    name: c.name,
    company: c.company,
    meta: de(c.id, "meta"),
    google: de(c.id, "google"),
  })));
});

export default router;
