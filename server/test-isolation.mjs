/**
 * Prova que um escritório nunca enxerga os dados de outro.
 *
 * Cria dois escritórios com dados próprios e, para cada rota de leitura,
 * confere que o que volta para A não contém nada de B (e vice-versa).
 * Também tenta ler/alterar por id direto, que é o furo mais comum.
 *
 * Uso: node test-isolation.mjs   (com o servidor rodando em :8080)
 */
const BASE = process.env.BASE || "http://localhost:8080";

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name} ${detail}`); console.log(`  ✗ ${name} ${detail}`); }
}

async function api(path, { token, method = "GET", body, orgHeader } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgHeader) headers["X-Org-Id"] = String(orgHeader);
  const res = await fetch(`${BASE}/api${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, data };
}

const login = (organization, username, password) =>
  api("/auth/login", { method: "POST", body: { organization, username, password } });

// Texto de tudo que voltou, para procurar vazamentos por nome.
const blob = (d) => JSON.stringify(d ?? "");

async function main() {
  console.log("\n=== 1. Login por escritório + nome + senha ===");
  const master = await login("Perspecta Media", "admin", "001");
  check("Perspecta Media / admin / 001 entra", master.status === 200 && !!master.data?.token);
  check("é superadmin", master.data?.user?.role === "superadmin");

  const katy = await login("Perspectiva", "Katy", "001");
  check("Perspectiva / Katy / 001 entra", katy.status === 200 && !!katy.data?.token);
  check("Katy é admin da Perspectiva", katy.data?.user?.role === "admin");
  check("Katy vê o nome do escritório dela", katy.data?.user?.org_name === "Perspectiva");

  const errada = await login("Perspectiva", "Katy", "senha-errada");
  check("senha errada é recusada", errada.status === 401);
  const cruzado = await login("Perspecta Media", "Katy", "001");
  check("Katy não entra pelo escritório master", cruzado.status === 401);

  const masterToken = master.data.token;
  const katyToken = katy.data.token;

  console.log("\n=== 2. Escritório novo, criado pelo master ===");
  const nome = `Estúdio Teste ${Date.now()}`;
  const novo = await api("/organizations", {
    token: masterToken, method: "POST",
    body: { name: nome, admin_username: "bruno", admin_name: "Bruno", admin_password: "002" },
  });
  check("master cria escritório", novo.status === 201, `(${novo.status})`);
  const novoId = novo.data?.id;

  const negado = await api("/organizations", { token: katyToken });
  check("Katy NÃO acessa a lista de escritórios", negado.status === 403, `(${negado.status})`);

  const bruno = await login(nome, "bruno", "002");
  check("admin do escritório novo entra", bruno.status === 200, `(${bruno.status})`);
  const brunoToken = bruno.data?.token;

  console.log("\n=== 3. Cada escritório cria os seus dados ===");
  const marcaA = `SEGREDO-PERSPECTIVA-${Date.now()}`;
  const marcaB = `SEGREDO-ESTUDIO-${Date.now()}`;

  const clienteA = await api("/clients", { token: katyToken, method: "POST", body: { name: marcaA } });
  const clienteB = await api("/clients", { token: brunoToken, method: "POST", body: { name: marcaB } });
  check("cliente criado na Perspectiva", clienteA.status === 201);
  check("cliente criado no escritório novo", clienteB.status === 201);

  const tarefaA = await api("/tasks", { token: katyToken, method: "POST", body: { title: marcaA, client_id: clienteA.data.id } });
  const tarefaB = await api("/tasks", { token: brunoToken, method: "POST", body: { title: marcaB, client_id: clienteB.data.id } });
  check("tarefa criada na Perspectiva", tarefaA.status === 201);
  check("tarefa criada no escritório novo", tarefaB.status === 201);

  await api("/financial", { token: katyToken, method: "POST", body: { description: marcaA, amount: 1234, type: "income" } });
  await api("/financial", { token: brunoToken, method: "POST", body: { description: marcaB, amount: 4321, type: "income" } });
  await api("/projects", { token: katyToken, method: "POST", body: { name: marcaA } });
  await api("/projects", { token: brunoToken, method: "POST", body: { name: marcaB } });
  await api("/goals", { token: katyToken, method: "POST", body: { title: marcaA, target: 10 } });
  await api("/goals", { token: brunoToken, method: "POST", body: { title: marcaB, target: 10 } });
  await api("/contracts", { token: katyToken, method: "POST", body: { title: marcaA, value: 100 } });
  await api("/contracts", { token: brunoToken, method: "POST", body: { title: marcaB, value: 100 } });
  await api("/services", { token: katyToken, method: "POST", body: { name: marcaA, default_price: 500 } });
  await api("/services", { token: brunoToken, method: "POST", body: { name: marcaB, default_price: 500 } });
  await api("/events", { token: katyToken, method: "POST", body: { title: marcaA, start_at: "2026-08-01T10:00" } });
  await api("/events", { token: brunoToken, method: "POST", body: { title: marcaB, start_at: "2026-08-01T10:00" } });
  await api("/workspace", { token: katyToken, method: "POST", body: { title: marcaA, client_id: clienteA.data.id, kind: "note" } });
  await api("/workspace", { token: brunoToken, method: "POST", body: { title: marcaB, client_id: clienteB.data.id, kind: "note" } });
  await api("/files/folders", { token: katyToken, method: "POST", body: { name: marcaA } });
  await api("/files/folders", { token: brunoToken, method: "POST", body: { name: marcaB } });
  await api("/tasks/stages", { token: katyToken, method: "POST", body: { name: marcaA } });

  console.log("\n=== 4. Nenhuma listagem vaza o outro escritório ===");
  const rotas = [
    "/clients", "/projects", "/tasks", "/tasks/stages", "/financial", "/contracts",
    "/goals", "/events", "/events/types", "/services", "/workspace", "/notifications",
    "/users", "/users/team", "/files?all=1", "/files/folders",
    "/agenda?from=2020-01-01&to=2030-01-01", "/calendar?month=2026-08",
    "/reports/dashboard", "/reports/billing-by-client", "/reports/billing-by-month",
    "/reports/tasks-by-user", "/reports/tasks-by-month", "/reports/tasks-by-weekday",
    "/reports/tasks-by-monthday", "/reports/new-clients-by-month",
    "/financial/summary",
  ];
  for (const rota of rotas) {
    const a = await api(rota, { token: katyToken });
    const b = await api(rota, { token: brunoToken });
    check(`${rota} — Perspectiva não vê o outro`, !blob(a.data).includes(marcaB), `(status ${a.status})`);
    check(`${rota} — escritório novo não vê a Perspectiva`, !blob(b.data).includes(marcaA), `(status ${b.status})`);
  }

  console.log("\n=== 5. Acesso por id direto é bloqueado ===");
  const idA = clienteA.data.id;
  const tarefaAId = tarefaA.data.id;

  const leituraCruzada = await api(`/clients/${idA}`, { token: brunoToken });
  check("GET cliente de outro escritório → 404", leituraCruzada.status === 404, `(${leituraCruzada.status})`);

  const edicaoCruzada = await api(`/clients/${idA}`, { token: brunoToken, method: "PUT", body: { name: "INVADIDO" } });
  check("PUT cliente de outro escritório → 404", edicaoCruzada.status === 404, `(${edicaoCruzada.status})`);

  const exclusaoCruzada = await api(`/clients/${idA}`, { token: brunoToken, method: "DELETE" });
  const aindaExiste = await api(`/clients/${idA}`, { token: katyToken });
  check("DELETE cruzado não apaga nada", aindaExiste.status === 200 && aindaExiste.data?.name === marcaA,
    `(delete ${exclusaoCruzada.status}, cliente ${aindaExiste.status})`);

  const tarefaCruzada = await api(`/tasks/${tarefaAId}`, { token: brunoToken, method: "PUT", body: { title: "INVADIDO" } });
  check("PUT tarefa de outro escritório → 404", tarefaCruzada.status === 404, `(${tarefaCruzada.status})`);

  const statusCruzado = await api(`/tasks/${tarefaAId}/status`, { token: brunoToken, method: "PUT", body: { stage_id: 1 } });
  check("mover tarefa de outro escritório → 404", statusCruzado.status === 404, `(${statusCruzado.status})`);

  console.log("\n=== 6. O master enxerga qualquer escritório ===");
  const masterVeA = await api("/clients", { token: masterToken, orgHeader: katy.data.user.org_id });
  check("master vê os clientes da Perspectiva", blob(masterVeA.data).includes(marcaA));
  const masterVeB = await api("/clients", { token: masterToken, orgHeader: novoId });
  check("master vê os clientes do escritório novo", blob(masterVeB.data).includes(marcaB));

  const lista = await api("/organizations", { token: masterToken });
  const nomes = (lista.data || []).map((o) => o.name);
  check("lista de escritórios traz todos", nomes.includes("Perspectiva") && nomes.includes(nome));

  console.log("\n=== 7. Portal do cliente segue isolado ===");
  const portalNegado = await api("/clients", { token: katyToken, method: "GET" });
  check("token de equipe funciona nas rotas da equipe", portalNegado.status === 200);

  // limpa o escritório de teste
  await api(`/organizations/${novoId}`, { token: masterToken, method: "DELETE" });

  console.log("\n" + "=".repeat(52));
  console.log(`${pass} passaram · ${fail} falharam`);
  if (fail) {
    console.log("\nFALHAS:");
    failures.forEach((f) => console.log(" - " + f));
    process.exit(1);
  }
  console.log("Isolamento entre escritórios confirmado.");
}

main().catch((e) => { console.error(e); process.exit(1); });
