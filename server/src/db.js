import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import "dotenv/config";

const DB_PATH = process.env.DB_PATH || "./data/agency.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
// Concorrência: com vários funcionários usando ao mesmo tempo, se duas
// gravações caírem no mesmo instante, uma espera até 5s em vez de dar erro.
db.pragma("busy_timeout = 5000");
// Com WAL ligado, NORMAL é seguro e deixa as gravações mais rápidas.
db.pragma("synchronous = NORMAL");

// ---------------------------------------------------------------------------
// Schema — reflete os módulos do sistema: usuários/permissões, clientes,
// projetos, tarefas (kanban), financeiro, contratos, metas, agenda, eventos.
// ---------------------------------------------------------------------------
db.exec(`
-- Cada escritório/agência que usa o sistema. O escritório 'master' é o dono
-- do sistema (Perspecta Media) e enxerga todos os outros.
CREATE TABLE IF NOT EXISTS organizations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  is_master     INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Planos do Perspecta Media para cobrar as agências (por nº de pessoas).
CREATE TABLE IF NOT EXISTS saas_plans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  max_users  INTEGER,                         -- limite de pessoas (vazio = ilimitado)
  price      REAL NOT NULL DEFAULT 0,          -- valor mensal
  active     INTEGER NOT NULL DEFAULT 1,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',      -- 'superadmin' | 'admin' | 'member'
  permissions   TEXT NOT NULL DEFAULT '{}',          -- JSON: { módulo: bool }
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  company       TEXT,
  drive_url     TEXT,                                 -- Google Drive do cliente
  status        TEXT NOT NULL DEFAULT 'active',       -- 'active' | 'inactive'
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  client_id     INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'active',       -- 'active' | 'done'
  start_date    TEXT,
  end_date      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kanban_stages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  is_done       INTEGER NOT NULL DEFAULT 0            -- etapa de conclusão
);

CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  description   TEXT,
  client_id     INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  assignee_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  stage_id      INTEGER REFERENCES kanban_stages(id) ON DELETE SET NULL,
  priority      TEXT NOT NULL DEFAULT 'medium',       -- 'low'|'medium'|'high'
  tags          TEXT NOT NULL DEFAULT '[]',           -- JSON array
  due_date      TEXT,
  completed_at  TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS financial_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL,                        -- 'income' | 'expense'
  description   TEXT NOT NULL,
  amount        REAL NOT NULL DEFAULT 0,
  client_id     INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  category      TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',      -- 'paid' | 'pending'
  due_date      TEXT,
  paid_at       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Planejamento: datas importantes por empresa (efemérides, campanhas, prazos).
CREATE TABLE IF NOT EXISTS planning_dates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL,
  client_id     INTEGER REFERENCES clients(id) ON DELETE CASCADE, -- null = geral (todas)
  date          TEXT NOT NULL,                        -- 'AAAA-MM-DD'
  title         TEXT NOT NULL,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contracts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  value          REAL NOT NULL DEFAULT 0,
  duration_months INTEGER,                            -- null = indeterminado
  start_date     TEXT,
  first_due_date TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  description   TEXT,
  target        REAL NOT NULL DEFAULT 0,
  current       REAL NOT NULL DEFAULT 0,
  due_date      TEXT,
  owner_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_types (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#EA580C'
);

CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  type_id       INTEGER REFERENCES event_types(id) ON DELETE SET NULL,
  client_id     INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  start_at      TEXT NOT NULL,
  end_at        TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS folders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  client_id     INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  parent_id     INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS services (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  default_price  REAL NOT NULL DEFAULT 0,
  contract_template TEXT,                 -- modelo com {{placeholders}}
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS client_services (
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id     INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  price          REAL NOT NULL DEFAULT 0, -- valor negociado para este cliente
  PRIMARY KEY (client_id, service_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  audience      TEXT NOT NULL DEFAULT 'agency',   -- 'agency' | 'client'
  client_id     INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  task_id       INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  message       TEXT NOT NULL,
  is_read       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_attachments (
  task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_id       INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, file_id)
);

CREATE TABLE IF NOT EXISTS workspace_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'note',  -- 'credential'|'doc'|'link'|'note'
  title         TEXT NOT NULL,
  content       TEXT,                          -- texto do doc/nota
  username      TEXT,                          -- credencial: login
  secret        TEXT,                          -- credencial: senha (criptografada)
  url           TEXT,                          -- link
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id     INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  client_id     INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime          TEXT,
  size          INTEGER NOT NULL DEFAULT 0,
  stored_path   TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------------------------------------------------------------------------
// Migrações idempotentes — adicionam colunas novas em bancos já existentes.
// ---------------------------------------------------------------------------
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  // Tabela ainda não existe (ex.: migração roda antes do CREATE): pula sem
  // quebrar o boot. O CREATE mais abaixo cuida das colunas dela.
  if (!cols.length) return;
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

// Tarefas de conteúdo: tipo (post/reel/foto), legenda e data de programação.
ensureColumn("tasks", "content_type", "content_type TEXT");
ensureColumn("tasks", "caption", "caption TEXT");
ensureColumn("tasks", "scheduled_at", "scheduled_at TEXT");
// Aprovação pelo cliente (portal): status, legenda editada e observações.
ensureColumn("tasks", "approval_status", "approval_status TEXT NOT NULL DEFAULT 'pending'");
ensureColumn("tasks", "client_caption", "client_caption TEXT");
ensureColumn("tasks", "client_note", "client_note TEXT");
// Arquivo da galeria que o cliente apontou ao pedir ajuste (referência visual).
ensureColumn("tasks", "client_ref_file_id", "client_ref_file_id INTEGER");
// Capa do post na "visão de perfil" (foto separada). Vazio = usa a própria arte.
ensureColumn("tasks", "cover_file_id", "cover_file_id INTEGER");
// Quantidade agrupada: ao lançar, cria 1 tarefa por tipo com N peças dentro.
// Ao entrar na Distribuição, ela se abre em N tarefas individuais (quantity=1).
ensureColumn("tasks", "quantity", "quantity INTEGER NOT NULL DEFAULT 1");
// Acesso do cliente ao portal.
ensureColumn("clients", "portal_email", "portal_email TEXT");
ensureColumn("clients", "portal_password_hash", "portal_password_hash TEXT");
// Nome de acesso do cliente (login por nome, como a equipe). O e-mail
// continua aceito no login para não quebrar quem já usa.
ensureColumn("clients", "portal_username", "portal_username TEXT");
// Dados comerciais do cliente.
ensureColumn("clients", "segment", "segment TEXT");            // segmento de atuação
ensureColumn("clients", "address", "address TEXT");            // endereço
ensureColumn("clients", "work_start", "work_start TEXT");      // início do trabalho
ensureColumn("clients", "work_end", "work_end TEXT");          // fim (vazio = indeterminado)
ensureColumn("clients", "payment_day", "payment_day INTEGER"); // dia do pagamento no mês
// Plano mensal de conteúdo (gera o projeto base automaticamente).
ensureColumn("clients", "posts_per_month", "posts_per_month INTEGER");
ensureColumn("clients", "videos_per_month", "videos_per_month INTEGER");
ensureColumn("projects", "monthly_posts", "monthly_posts INTEGER");
ensureColumn("projects", "monthly_videos", "monthly_videos INTEGER");
// Dia-limite para lançar o mês seguinte (lembrete no card: "Lançar X — até dia N").
ensureColumn("projects", "launch_by_day", "launch_by_day INTEGER");
// Metas tipadas: valor (R$), clientes novos, concluir projeto, quantidade livre.
ensureColumn("goals", "goal_type", "goal_type TEXT NOT NULL DEFAULT 'quantity'");
ensureColumn("goals", "project_id", "project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL");
// Agenda individual + compromissos visíveis ao cliente, com plano anexado.
ensureColumn("events", "owner_id", "owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL");
ensureColumn("events", "doc_content", "doc_content TEXT");
ensureColumn("events", "link_url", "link_url TEXT");
ensureColumn("events", "visible_to_client", "visible_to_client INTEGER NOT NULL DEFAULT 1");
// Meios de pagamento (preenchidos manualmente ou por integração futura).
ensureColumn("financial_entries", "payment_link", "payment_link TEXT");
ensureColumn("financial_entries", "pix_code", "pix_code TEXT");
ensureColumn("financial_entries", "boleto_url", "boleto_url TEXT");
ensureColumn("financial_entries", "invoice_url", "invoice_url TEXT");
// Despesa/receita mensal recorrente: marca as parcelas geradas e o dia do mês.
ensureColumn("financial_entries", "recurring", "recurring INTEGER NOT NULL DEFAULT 0");
ensureColumn("financial_entries", "recurring_day", "recurring_day INTEGER");

// ---------------------------------------------------------------------------
// Multi-escritório: cada agência só enxerga os próprios dados. O escritório
// master (Perspecta Media) enxerga todos.
// ---------------------------------------------------------------------------
// Login por nome de usuário (em vez de e-mail).
ensureColumn("users", "username", "username TEXT");
// Troca de senha obrigatória (usado para tirar senhas-padrão fracas de circulação).
ensureColumn("users", "must_change_password", "must_change_password INTEGER NOT NULL DEFAULT 0");

// Marca do escritório: logo da barra superior e favicon (guardados como
// data URI — carregam sem depender de rede nem de login).
ensureColumn("organizations", "logo", "logo TEXT");
ensureColumn("organizations", "favicon", "favicon TEXT");

// Assinatura de cada agência com o Perspecta Media: plano, teste e cobrança.
ensureColumn("organizations", "plan_id", "plan_id INTEGER");
ensureColumn("organizations", "trial_ends", "trial_ends TEXT");   // fim do teste grátis
ensureColumn("organizations", "billing_active", "billing_active INTEGER NOT NULL DEFAULT 0"); // já paga
ensureColumn("organizations", "whatsapp", "whatsapp TEXT");       // contato para confirmar
ensureColumn("organizations", "asaas_customer_id", "asaas_customer_id TEXT");
ensureColumn("organizations", "asaas_subscription_id", "asaas_subscription_id TEXT");
// Todo escritório novo ganha 30 dias de teste a partir da criação.
db.prepare(
  "UPDATE organizations SET trial_ends = datetime(created_at, '+30 days') WHERE trial_ends IS NULL AND is_master = 0"
).run();

// Função e responsabilidades: o que a pessoa faz e quais tipos de conteúdo
// produz. Serve para rotear tarefas e avisos para quem é responsável.
ensureColumn("users", "job_title", "job_title TEXT");        // ex: Social Media, Designer
ensureColumn("users", "duties", "duties TEXT");              // JSON: ["post","reel",...]
ensureColumn("users", "can_approve", "can_approve INTEGER NOT NULL DEFAULT 0"); // recebe aprovações

// Modelo de serviço com itens configuráveis (posts, reels, verba de tráfego...)
// e a configuração preenchida por cliente.
ensureColumn("services", "items_schema", "items_schema TEXT"); // JSON: [{label, unit}]
ensureColumn("client_services", "config", "config TEXT");       // JSON: {label: quantidade}

// Persona de IA por cliente: tom de voz, público, pilares, o que evitar.
ensureColumn("clients", "ai_persona", "ai_persona TEXT");       // JSON

// Configuração de IA por escritório (chave paga pelo próprio escritório).
db.exec(`
CREATE TABLE IF NOT EXISTS org_ai (
  org_id     INTEGER PRIMARY KEY,
  provider   TEXT NOT NULL DEFAULT 'openai',  -- openai | anthropic
  api_key    TEXT,                            -- criptografada
  model      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Consumo de IA acumulado por escritório (para o painel de custos).
CREATE TABLE IF NOT EXISTS ai_usage (
  org_id     INTEGER PRIMARY KEY,
  calls      INTEGER NOT NULL DEFAULT 0,
  tokens_in  INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Gateway de cobrança (Asaas) por escritório. O cartão NUNCA fica aqui —
-- fica no cofre do Asaas; guardamos só a chave da API e os ids da assinatura.
CREATE TABLE IF NOT EXISTS org_billing (
  org_id      INTEGER PRIMARY KEY,
  provider    TEXT NOT NULL DEFAULT 'asaas',
  api_key     TEXT,                           -- criptografada
  environment TEXT NOT NULL DEFAULT 'production', -- sandbox | production
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
// Vínculo do cliente com o Asaas (cliente e assinatura recorrente).
ensureColumn("clients", "asaas_customer_id", "asaas_customer_id TEXT");
ensureColumn("clients", "asaas_subscription_id", "asaas_subscription_id TEXT");

// Lembrete de aprovação parada: quando foi para o cliente e quando avisamos.
ensureColumn("tasks", "approval_sent_at", "approval_sent_at TEXT");
ensureColumn("tasks", "last_reminder_at", "last_reminder_at TEXT");
// Publicação pela Meta (Instagram/Facebook).
ensureColumn("tasks", "published_at", "published_at TEXT");
ensureColumn("tasks", "publish_error", "publish_error TEXT");
ensureColumn("tasks", "external_post_id", "external_post_id TEXT");
// Publicar sozinho na hora marcada é opcional e desligado por padrão.
ensureColumn("clients", "auto_publish", "auto_publish INTEGER NOT NULL DEFAULT 0");

// Aceite eletrônico do contrato pelo cliente.
ensureColumn("contracts", "signed_at", "signed_at TEXT");
ensureColumn("contracts", "signer_name", "signer_name TEXT");
ensureColumn("contracts", "signer_document", "signer_document TEXT");
ensureColumn("contracts", "signer_ip", "signer_ip TEXT");
ensureColumn("contracts", "signed_hash", "signed_hash TEXT"); // detecta edição posterior

// Ciclo de vida do arquivo entregue: o cliente tem um prazo para baixar.
ensureColumn("files", "expires_at", "expires_at TEXT");
ensureColumn("files", "keep_forever", "keep_forever INTEGER NOT NULL DEFAULT 0");
ensureColumn("files", "expiry_notified_at", "expiry_notified_at TEXT");
// Etapa do material no fluxo (estilo o quadro de tarefas), por cliente:
// originais | editados | aprovacao | aprovados | programados
ensureColumn("files", "stage", "stage TEXT NOT NULL DEFAULT 'originais'");
// Dias do mês em que cada tipo do plano é publicado (JSON: [5,12,19,26]).
ensureColumn("plan_items", "days", "days TEXT");
// Meses já lançados de um projeto (JSON: ["2026-08", ...]) — mostra "já lançado".
ensureColumn("projects", "launched_months", "launched_months TEXT");

// Limites do plano (vazio = ilimitado) e monitoramento de uso.
ensureColumn("saas_plans", "max_clients", "max_clients INTEGER");
ensureColumn("saas_plans", "storage_gb", "storage_gb INTEGER");
// Preço promocional escalonado: 1º mês, depois promo por N meses, depois cheio.
ensureColumn("saas_plans", "promo_price", "promo_price REAL");
ensureColumn("saas_plans", "promo_months", "promo_months INTEGER");   // 0 = só 1º mês; 6 = seis meses
ensureColumn("saas_plans", "first_month_price", "first_month_price REAL");
ensureColumn("saas_plans", "trial_days", "trial_days INTEGER");       // teste grátis (dias)
// Quando a assinatura (cobrança) daquela agência começou — base da escada.
ensureColumn("organizations", "plan_started_at", "plan_started_at TEXT");
// Último valor cobrado na assinatura (para a escada só mexer quando muda de fase).
ensureColumn("organizations", "current_price", "current_price REAL");
// Tolerância: quando estoura um limite, ganha alguns dias antes de restringir.
ensureColumn("organizations", "limit_grace_until", "limit_grace_until TEXT");
ensureColumn("organizations", "usage_notified_at", "usage_notified_at TEXT");

// Planos padrão do Creator (só cria se ainda não houver nenhum).
(function seedDefaultPlans() {
  const n = db.prepare("SELECT COUNT(*) AS n FROM saas_plans").get().n;
  if (n > 0) return;
  const ins = db.prepare(
    `INSERT INTO saas_plans (name, max_users, max_clients, storage_gb, price,
       first_month_price, promo_price, promo_months, trial_days, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // NULL = ilimitado. Escada: 1º mês → promo por N meses → preço cheio.
  //           nome            users clients gb   cheio  1ºmes promo promoM trial pos
  ins.run("Creator One",        1,    15,    5,   289,   89,   189,   6,    7,   0);
  ins.run("Creator Plus",       5,    50,    20,  389,   null, 189,   6,    7,   1);
  ins.run("Creator Pro",        10,   null,  100, 489,   null, 289,   6,    7,   2);
  ins.run("Creator Enterprise", null, null,  500, 0,     null, null,  null, 7,   3);
})();

db.exec(`
-- Plano mensal configurável: cada linha diz o que produzir, quantas e para quem.
-- Monta uma vez; todo mês é só clicar "Lançar" que já cria tudo roteado.
CREATE TABLE IF NOT EXISTS plan_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL DEFAULT 'post',   -- post|reel|foto|stories|outro
  label        TEXT,                            -- ex: "Post institucional"
  quantity     INTEGER NOT NULL DEFAULT 1,
  assignee_id  INTEGER REFERENCES users(id) ON DELETE SET NULL, -- vazio = por função
  position     INTEGER NOT NULL DEFAULT 0,
  days         TEXT                             -- dias do mês (JSON: [5,12,19,26])
);
CREATE INDEX IF NOT EXISTS idx_planitems_project ON plan_items(project_id);

-- Tipos de tarefa/serviço configuráveis por escritório (post, reel, planejamento…)
-- com o responsável de cada um. É o que o "Lançar mês" usa para distribuir.
CREATE TABLE IF NOT EXISTS task_types (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id              INTEGER NOT NULL,
  key                 TEXT NOT NULL,
  label               TEXT NOT NULL,
  emoji               TEXT,
  responsible_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  position            INTEGER NOT NULL DEFAULT 0,
  active              INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tasktypes_org ON task_types(org_id);
-- Dias do mês em que cada tipo é publicado (JSON: [5,12,19,26]).
-- O "Lançar mês" agenda as peças nesses dias do mês escolhido.

-- Conversa por post: legenda fica fixa, os comentários vêm abaixo.
CREATE TABLE IF NOT EXISTS task_comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL,
  task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_type  TEXT NOT NULL,             -- 'agency' | 'client'
  author_id    INTEGER,
  author_name  TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id);

-- Apontamento de horas: quanto tempo cada coisa realmente leva.
CREATE TABLE IF NOT EXISTS time_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL,
  task_id      INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  client_id    INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  minutes      INTEGER NOT NULL,
  note         TEXT,
  entry_date   TEXT NOT NULL DEFAULT (date('now')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_time_org ON time_entries(org_id);

-- Cronômetro em andamento: um por (tarefa, pessoa). Ao parar, vira time_entries.
CREATE TABLE IF NOT EXISTS active_timers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL,
  task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  started_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_timers_task ON active_timers(task_id);

-- Sessão de trabalho POR CLIENTE: começa, marca o tempo e ao finalizar
-- registra quantas tarefas foram concluídas naquele período.
CREATE TABLE IF NOT EXISTS work_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  client_id    INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT,
  minutes      INTEGER,
  tasks_done   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_worksessions_user ON work_sessions(user_id, ended_at);

-- Prospecção: quem ainda não é cliente, com o histórico de contatos.
CREATE TABLE IF NOT EXISTS prospects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL,
  name         TEXT NOT NULL,
  company      TEXT,
  segment      TEXT,
  phone        TEXT,
  email        TEXT,
  instagram    TEXT,
  status       TEXT NOT NULL DEFAULT 'novo',  -- novo|conversando|proposta|fechado|perdido
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prospects_org ON prospects(org_id);

CREATE TABLE IF NOT EXISTS prospect_touches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id  INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  touch_date   TEXT NOT NULL DEFAULT (date('now')),
  channel      TEXT,                       -- whatsapp|ligação|e-mail|presencial
  summary      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Conexões com a Meta, uma por cliente.
db.exec(`
CREATE TABLE IF NOT EXISTS integrations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id         INTEGER NOT NULL,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL DEFAULT 'meta',
  page_id        TEXT,
  page_name      TEXT,
  ig_user_id     TEXT,
  ig_username    TEXT,
  access_token   TEXT,                    -- criptografado em repouso
  token_expires  TEXT,
  connected_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_integrations_org ON integrations(org_id);
`);

// Toda tabela de dados carrega o escritório dona da linha.
export const TENANT_TABLES = [
  "users", "clients", "projects", "tasks", "kanban_stages", "financial_entries",
  "contracts", "goals", "events", "event_types", "services", "workspace_items",
  "folders", "files", "notifications", "task_comments", "time_entries", "prospects",
  "plan_items",
];
TENANT_TABLES.forEach((t) => ensureColumn(t, "org_id", "org_id INTEGER"));

// Índices para as consultas filtradas por escritório.
TENANT_TABLES.forEach((t) => {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_org ON ${t}(org_id)`);
});

// --- Semente: o escritório master e o primeiro escritório cliente -----------
function seedOrganizations() {
  const insertOrg = db.prepare("INSERT INTO organizations (name, is_master) VALUES (?, ?)");
  const findOrg = db.prepare("SELECT * FROM organizations WHERE name = ?");

  let master = findOrg.get("Perspecta Media");
  if (!master) {
    insertOrg.run("Perspecta Media", 1);
    master = findOrg.get("Perspecta Media");
  }
  let perspectiva = findOrg.get("Perspectiva");
  if (!perspectiva) {
    insertOrg.run("Perspectiva", 0);
    perspectiva = findOrg.get("Perspectiva");
  }

  // Usuários fixos pedidos: admin (master) e Katy (Perspectiva).
  const upsertUser = ({ name, username, email, password, role, orgId }) => {
    const existing = db.prepare("SELECT id FROM users WHERE lower(username) = lower(?) AND org_id = ?").get(username, orgId);
    if (existing) return;
    const byEmail = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    const hash = bcrypt.hashSync(password, 10);
    if (byEmail) {
      db.prepare("UPDATE users SET name=?, username=?, password_hash=?, role=?, org_id=? WHERE id=?")
        .run(name, username, hash, role, orgId, byEmail.id);
    } else {
      db.prepare(
        "INSERT INTO users (name, username, email, password_hash, role, org_id) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(name, username, email, hash, role, orgId);
    }
  };

  // Senhas iniciais configuráveis por ambiente (evita "001" em produção).
  // Só valem na PRIMEIRA criação de cada usuário; não mexem em quem já existe.
  upsertUser({
    name: "Perspecta Media", username: "admin", email: "admin@perspectamedia.com",
    password: process.env.SEED_ADMIN_PASSWORD || "001", role: "superadmin", orgId: master.id,
  });
  upsertUser({
    name: "Katy", username: "Katy", email: "katy@perspectiva.com",
    password: process.env.SEED_KATY_PASSWORD || "001", role: "admin", orgId: perspectiva.id,
  });

  // Dados que existiam antes do multi-escritório passam a ser da Perspectiva.
  TENANT_TABLES.forEach((t) => {
    db.prepare(`UPDATE ${t} SET org_id = ? WHERE org_id IS NULL`).run(perspectiva.id);
  });
  // O usuário master não pertence a nenhum escritório cliente.
  db.prepare("UPDATE users SET org_id = ? WHERE role = 'superadmin'").run(master.id);

  // Deploy zerado (disco novo): garante etapas do kanban e tipos de evento no
  // escritório de trabalho, para o quadro não nascer vazio. Idempotente —
  // se já houver etapas (banco atual), não faz nada.
  const semEtapas = db.prepare("SELECT COUNT(*) AS n FROM kanban_stages WHERE org_id = ?").get(perspectiva.id).n === 0;
  if (semEtapas) {
    const stages = [
      ["Planejamento", 0, 0], ["Captação", 1, 0], ["Criação", 2, 0],
      ["Distribuição", 3, 0], ["Aprovação", 4, 0], ["Programados", 5, 1],
    ];
    const ins = db.prepare("INSERT INTO kanban_stages (name, position, is_done, org_id) VALUES (?, ?, ?, ?)");
    stages.forEach((s) => ins.run(...s, perspectiva.id));
  }
  const semTipos = db.prepare("SELECT COUNT(*) AS n FROM event_types WHERE org_id = ?").get(perspectiva.id).n === 0;
  if (semTipos) {
    const types = [["Reunião", "#EA580C"], ["Captação", "#FB923C"], ["Entrega", "#78716C"]];
    const insT = db.prepare("INSERT INTO event_types (name, color, org_id) VALUES (?, ?, ?)");
    types.forEach((t) => insT.run(...t, perspectiva.id));
  }
}
seedOrganizations();

// Segurança: qualquer usuário que ainda esteja com a senha-padrão fraca "001"
// é obrigado a trocar no próximo login. Idempotente — some sozinho quando a
// pessoa troca a senha (aí "001" deixa de bater).
(function flagWeakSeedPasswords() {
  const users = db.prepare("SELECT id, password_hash FROM users").all();
  const flag = db.prepare("UPDATE users SET must_change_password = 1 WHERE id = ?");
  users.forEach((u) => {
    try { if (u.password_hash && bcrypt.compareSync("001", u.password_hash)) flag.run(u.id); }
    catch { /* hash inválido: ignora */ }
  });
})();

// Exclusão automática desligada: cancela qualquer prazo de expiração que ainda
// esteja marcado, para que nenhum arquivo seja apagado sozinho. A limpeza passa
// a ser 100% manual (aba Arquivos). Idempotente — depois disso nada mais marca.
db.prepare("UPDATE files SET expires_at = NULL, expiry_notified_at = NULL WHERE expires_at IS NOT NULL").run();

// ---------------------------------------------------------------------------
// Migração única do fluxo de etapas para o novo padrão:
//   Planejamento → Captação → Criação → Distribuição → Aprovação → Concluído.
// Só mexe em quadros que ainda estão no padrão antigo (renomeia sem perder
// nenhuma tarefa). Depois que "Criação" existe, nunca mais toca nas etapas.
// ---------------------------------------------------------------------------
(function migrateStageFlow() {
  const orgs = db.prepare("SELECT id FROM organizations").all();
  const has = db.prepare("SELECT id FROM kanban_stages WHERE org_id = ? AND lower(name) = lower(?)");
  const rename = db.prepare("UPDATE kanban_stages SET name = ? WHERE org_id = ? AND lower(name) = lower(?)");
  const setPos = db.prepare("UPDATE kanban_stages SET position = ? WHERE org_id = ? AND lower(name) = lower(?)");
  orgs.forEach(({ id }) => {
    const total = db.prepare("SELECT COUNT(*) AS n FROM kanban_stages WHERE org_id = ?").get(id).n;
    if (!total) return;                 // ainda sem quadro
    if (has.get(id, "Criação")) return; // já migrado
    // Só converte boards que ainda têm os nomes padrão antigos.
    if (!has.get(id, "A fazer") && !has.get(id, "Programação")) return;

    rename.run("Planejamento", id, "A fazer");
    rename.run("Captação", id, "Em andamento");
    rename.run("Distribuição", id, "Programação");
    if (!has.get(id, "Criação")) {
      db.prepare("INSERT INTO kanban_stages (name, position, is_done, org_id) VALUES (?, ?, 0, ?)")
        .run("Criação", 2, id);
    }
    // Reordena para o fluxo novo.
    setPos.run(0, id, "Planejamento");
    setPos.run(1, id, "Captação");
    setPos.run(2, id, "Criação");
    setPos.run(3, id, "Distribuição");
    setPos.run(4, id, "Aprovação");
    setPos.run(5, id, "Concluído");
  });
})();

// A coluna final vira "Programados" (a organização do que já foi programado).
// Idempotente: só renomeia enquanto ainda existir "Concluído".
(function renameConcluidoParaProgramados() {
  const orgs = db.prepare("SELECT id FROM organizations").all();
  const has = db.prepare("SELECT id FROM kanban_stages WHERE org_id = ? AND lower(name) = lower(?)");
  orgs.forEach(({ id }) => {
    if (has.get(id, "Programados")) return;
    if (!has.get(id, "Concluído")) return;
    db.prepare("UPDATE kanban_stages SET name = 'Programados' WHERE org_id = ? AND lower(name) = lower('Concluído')").run(id);
  });
})();

export default db;
