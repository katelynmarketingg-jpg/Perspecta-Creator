import express from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import "dotenv/config";

import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";
import clientsRoutes from "./routes/clients.js";
import projectsRoutes from "./routes/projects.js";
import tasksRoutes from "./routes/tasks.js";
import financialRoutes from "./routes/financial.js";
import contractsRoutes from "./routes/contracts.js";
import goalsRoutes from "./routes/goals.js";
import eventsRoutes from "./routes/events.js";
import agendaRoutes from "./routes/agenda.js";
import reportsRoutes from "./routes/reports.js";
import calendarRoutes from "./routes/calendar.js";
import filesRoutes from "./routes/files.js";
import workspaceRoutes from "./routes/workspace.js";
import portalRoutes from "./routes/portal.js";
import notificationsRoutes from "./routes/notifications.js";
import servicesRoutes from "./routes/services.js";
import organizationsRoutes from "./routes/organizations.js";
import plansRoutes from "./routes/plans.js";
import integrationsRoutes from "./routes/integrations.js";
import { sharedRouter } from "./routes/files.js";
import { signRouter } from "./routes/sign.js";
import commentsRoutes from "./routes/comments.js";
import timeRoutes from "./routes/time.js";
import prospectsRoutes from "./routes/prospects.js";
import aiRoutes from "./routes/ai.js";
import billingRoutes, { billingWebhook } from "./routes/billing.js";
import brandingRoutes from "./routes/branding.js";
import taskTypesRoutes from "./routes/task-types.js";
import distributionRoutes from "./routes/distribution.js";
import planningRoutes from "./routes/planning.js";
import prioritiesRoutes from "./routes/priorities.js";
import personalFinanceRoutes from "./routes/personal-finance.js";
import orgDocsRoutes from "./routes/org-docs.js";
import contractTemplatesRoutes from "./routes/contract-templates.js";
import receiptsRoutes from "./routes/receipts.js";
import adminRoutes from "./routes/admin.js";
import backupRoutes from "./routes/backup.js";
import { startBackups } from "./backup.js";
import { startReminders } from "./reminders.js";
import { startPublisher } from "./publisher.js";
import { startPlanMonitor } from "./plans-monitor.js";
import { liveNotifier, sseHandler } from "./live.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
// A checagem do JWT_SECRET (fail-fast em produção) fica em auth.js, que é
// importado antes de qualquer uso da criptografia.

const app = express();
app.set("trust proxy", 1); // atrás do proxy do Render: HTTPS e IP reais
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// Canal de atualização ao vivo (SSE). Fica fora do liveNotifier (é um GET) e
// se autentica pela própria URL (?token=...), pois o EventSource do navegador
// não envia cabeçalhos.
app.get("/api/live", sseHandler);

// A partir daqui, toda gravação bem-sucedida avisa as telas do escritório.
app.use(liveNotifier);

app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/clients", clientsRoutes);
app.use("/api/projects", projectsRoutes);
app.use("/api/tasks", tasksRoutes);
app.use("/api/financial", financialRoutes);
app.use("/api/contracts", contractsRoutes);
app.use("/api/goals", goalsRoutes);
app.use("/api/events", eventsRoutes);
app.use("/api/agenda", agendaRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/files", filesRoutes);
app.use("/api/workspace", workspaceRoutes);
app.use("/api/portal", portalRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/services", servicesRoutes);
app.use("/api/organizations", organizationsRoutes);
app.use("/api/plans", plansRoutes);
app.use("/api/integrations", integrationsRoutes);
app.use("/api/files", sharedRouter); // link assinado, sem login
app.use("/api/sign", signRouter);    // assinatura por link público
app.use("/api/comments", commentsRoutes);
app.use("/api/time", timeRoutes);
app.use("/api/prospects", prospectsRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/branding", brandingRoutes);
app.use("/api/task-types", taskTypesRoutes);
app.use("/api/distribution", distributionRoutes);
app.use("/api/planning", planningRoutes);
app.use("/api/priorities", prioritiesRoutes);
app.use("/api/personal-finance", personalFinanceRoutes);
app.use("/api/org-docs", orgDocsRoutes);
app.use("/api/contract-templates", contractTemplatesRoutes);
app.use("/api/receipts", receiptsRoutes);
app.use("/api/admin", adminRoutes); // porta de serviço (token) p/ painel central
app.use("/api/backup", backupRoutes); // baixar o banco (só superadmin)
app.use("/api/webhooks", billingWebhook); // Asaas confirma pagamentos aqui

// Política de Privacidade e instruções de exclusão de dados — páginas públicas
// simples, exigidas pela Meta (e por outras plataformas) para liberar o app.
const PRIVACY_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Política de Privacidade — Perspecta Media</title>
<style>body{font-family:system-ui,Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1c1917;line-height:1.6}h1{color:#EA580C}h2{margin-top:1.6em}small{color:#78716c}</style>
</head><body>
<h1>Política de Privacidade</h1>
<small>Perspecta Media · última atualização: setembro de 2026</small>
<p>A Perspecta Media ("nós") oferece uma plataforma de gestão de agência e de
publicação de conteúdo em redes sociais. Esta política explica quais dados
tratamos e como.</p>
<h2>Quais dados usamos</h2>
<p>Quando um cliente conecta as próprias redes sociais (Facebook e Instagram)
ao sistema, recebemos da Meta apenas o necessário para publicar e acompanhar o
conteúdo autorizado: identificação da Página e da conta profissional do
Instagram, nome de usuário e um token de acesso. Não coletamos mensagens
privadas nem dados de terceiros.</p>
<h2>Como usamos</h2>
<p>Os dados são usados exclusivamente para publicar as artes aprovadas nas
contas que o próprio titular conectou e autorizou. Não vendemos nem
compartilhamos esses dados com terceiros.</p>
<h2>Armazenamento e segurança</h2>
<p>Os tokens de acesso ficam guardados de forma criptografada e são usados
apenas nas chamadas às APIs oficiais da Meta. O acesso pode ser revogado a
qualquer momento desconectando a conta dentro do sistema ou nas configurações
da própria conta Meta.</p>
<h2>Exclusão de dados</h2>
<p>Para remover seus dados, desconecte a conta no sistema ou solicite a exclusão
pelo e-mail abaixo. Também é possível remover o app em
<em>Configurações &gt; Apps e sites</em> da sua conta do Facebook.</p>
<h2>Contato</h2>
<p>Dúvidas ou pedidos: <a href="mailto:katelynmarketingg@gmail.com">katelynmarketingg@gmail.com</a>.</p>
</body></html>`;

const DELETION_HTML = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Exclusão de dados — Perspecta Media</title>
<style>body{font-family:system-ui,Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1c1917;line-height:1.6}h1{color:#EA580C}</style>
</head><body>
<h1>Instruções de exclusão de dados</h1>
<p>Para excluir os dados que a Perspecta Media guarda da sua conta Meta:</p>
<ol>
<li>Dentro do sistema, abra o cliente e clique em <strong>Desconectar</strong> na integração da Meta; ou</li>
<li>Envie um pedido para <a href="mailto:katelynmarketingg@gmail.com">katelynmarketingg@gmail.com</a> com o nome da conta;</li>
<li>Você também pode remover o app em <em>Configurações &gt; Apps e sites</em> da sua conta do Facebook.</li>
</ol>
<p>A remoção do token e dos dados vinculados é feita em até 30 dias.</p>
</body></html>`;

const sendHtml = (html) => (req, res) => res.type("html").send(html);
app.get(["/privacy", "/privacidade", "/politica-de-privacidade"], sendHtml(PRIVACY_HTML));
app.get(["/data-deletion", "/exclusao-de-dados"], sendHtml(DELETION_HTML));

// Serve o build do frontend (client/dist) em produção
const clientDist = join(__dirname, "../../client/dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res) => res.sendFile(join(clientDist, "index.html")));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno do servidor." });
});

// Rede de segurança: no Node, uma promessa rejeitada sem dono ou uma exceção
// solta ENCERRAM o processo — e aí o site inteiro responde 502 até o Render
// reiniciar. Registrar aqui não conserta o erro, mas evita que um pedido
// ruim derrube todo mundo. O erro fica no log para ser corrigido.
process.on("unhandledRejection", (motivo) => {
  console.error("[servidor] promessa rejeitada sem tratamento:", motivo);
});
process.on("uncaughtException", (erro) => {
  console.error("[servidor] exceção não tratada:", erro);
});

app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
  startReminders();  // cobra aprovações paradas
  startPublisher();  // publica os posts com hora marcada (quando ligado)
  // Exclusão automática de arquivos DESLIGADA: a limpeza é manual, na aba
  // Arquivos. (startRetention não é mais chamado.)
  startPlanMonitor(); // vigia limites de plano e testes acabando
  startBackups();     // cópia diária do banco (mantém as últimas 7)
});
