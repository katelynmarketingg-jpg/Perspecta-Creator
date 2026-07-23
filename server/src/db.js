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
// Acesso do cliente ao portal.
ensureColumn("clients", "portal_email", "portal_email TEXT");
ensureColumn("clients", "portal_password_hash", "portal_password_hash TEXT");
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

// ---------------------------------------------------------------------------
// Multi-escritório: cada agência só enxerga os próprios dados. O escritório
// master (Perspecta Media) enxerga todos.
// ---------------------------------------------------------------------------
// Login por nome de usuário (em vez de e-mail).
ensureColumn("users", "username", "username TEXT");

// Modelo de serviço com itens configuráveis (posts, reels, verba de tráfego...)
// e a configuração preenchida por cliente.
ensureColumn("services", "items_schema", "items_schema TEXT"); // JSON: [{label, unit}]
ensureColumn("client_services", "config", "config TEXT");       // JSON: {label: quantidade}

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

db.exec(`
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

  upsertUser({
    name: "Perspecta Media", username: "admin", email: "admin@perspectamedia.com",
    password: "001", role: "superadmin", orgId: master.id,
  });
  upsertUser({
    name: "Katy", username: "Katy", email: "katy@perspectiva.com",
    password: "001", role: "admin", orgId: perspectiva.id,
  });

  // Dados que existiam antes do multi-escritório passam a ser da Perspectiva.
  TENANT_TABLES.forEach((t) => {
    db.prepare(`UPDATE ${t} SET org_id = ? WHERE org_id IS NULL`).run(perspectiva.id);
  });
  // O usuário master não pertence a nenhum escritório cliente.
  db.prepare("UPDATE users SET org_id = ? WHERE role = 'superadmin'").run(master.id);
}
seedOrganizations();

export default db;
