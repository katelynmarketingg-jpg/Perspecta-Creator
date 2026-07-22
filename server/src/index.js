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
import integrationsRoutes from "./routes/integrations.js";
import { sharedRouter } from "./routes/files.js";
import { startReminders } from "./reminders.js";
import { startPublisher } from "./publisher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

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
app.use("/api/integrations", integrationsRoutes);
app.use("/api/files", sharedRouter); // link assinado, sem login

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

app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
  startReminders();  // cobra aprovações paradas
  startPublisher();  // publica os posts com hora marcada (quando ligado)
});
