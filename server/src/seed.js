// Popula o banco com um admin e dados de exemplo. Rode com: npm run seed
import { db } from "./db.js";
import { hashPassword } from "./auth.js";

const has = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n > 0;

if (!has("users")) {
  db.prepare("INSERT INTO users (name, email, password_hash, role, permissions) VALUES (?, ?, ?, 'admin', '{}')")
    .run("Administrador", "admin@agencia.com", hashPassword("admin123"));
  console.log("• admin criado -> admin@agencia.com / admin123");
}

if (!has("kanban_stages")) {
  const stages = [
    ["A fazer", 0, 0],
    ["Em andamento", 1, 0],
    ["Aprovação", 2, 0],
    ["Programação", 3, 0],
    ["Concluído", 4, 1],
  ];
  const stmt = db.prepare("INSERT INTO kanban_stages (name, position, is_done) VALUES (?, ?, ?)");
  stages.forEach((s) => stmt.run(...s));
  console.log("• etapas do kanban criadas");
}

if (!has("event_types")) {
  const types = [["Reunião", "#EA580C"], ["Entrega", "#78716C"], ["Gravação", "#FB923C"]];
  const stmt = db.prepare("INSERT INTO event_types (name, color) VALUES (?, ?)");
  types.forEach((t) => stmt.run(...t));
}

if (!has("clients")) {
  const c = db.prepare("INSERT INTO clients (name, company, email, status) VALUES (?, ?, ?, 'active')");
  const c1 = c.run("Alves & Teixeira", "Alves & Teixeira Advocacia", "contato@alvesteixeira.com").lastInsertRowid;
  const c2 = c.run("Bistrô Camila", "Bistrô Camila", "camila@bistro.com").lastInsertRowid;

  db.prepare("INSERT INTO projects (name, client_id, status) VALUES (?, ?, 'active')").run("Gestão de Redes Sociais", c1);
  db.prepare("INSERT INTO projects (name, client_id, status) VALUES (?, ?, 'active')").run("Tráfego Pago", c2);

  const stage = db.prepare("SELECT id FROM kanban_stages ORDER BY position LIMIT 1").get().id;
  const t = db.prepare("INSERT INTO tasks (title, client_id, stage_id, priority) VALUES (?, ?, ?, ?)");
  t.run("Criar calendário editorial", c1, stage, "high");
  t.run("Configurar campanha de tráfego", c2, stage, "medium");

  const f = db.prepare("INSERT INTO financial_entries (type, description, amount, client_id, status, due_date) VALUES (?, ?, ?, ?, ?, ?)");
  f.run("income", "Mensalidade Alves & Teixeira", 2500, c1, "paid", new Date().toISOString().slice(0, 10));
  f.run("income", "Mensalidade Bistrô Camila", 1800, c2, "pending", new Date().toISOString().slice(0, 10));
  f.run("expense", "Ferramentas / SaaS", 600, null, "paid", new Date().toISOString().slice(0, 10));
  console.log("• dados de exemplo criados");
}

console.log("Seed concluído.");
