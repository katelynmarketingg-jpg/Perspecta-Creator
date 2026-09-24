import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Box, CircularProgress } from "@mui/material";
import { useAuth } from "./auth/AuthContext.jsx";
import Layout from "./components/Layout.jsx";
import { impedirAberturaPeloNavegador } from "./upload/arrastar.js";

import Login from "./pages/Login.jsx";
import NotFound from "./pages/NotFound.jsx";
import PortalLogin from "./pages/PortalLogin.jsx";
import Portal from "./pages/Portal.jsx";


// ---------------------------------------------------------------------------
// CADA TELA NO SEU PACOTE.
//
// Antes, o navegador baixava as TRINTA telas do sistema antes de desenhar
// qualquer coisa — inclusive para o cliente, que só abre a área dele. Medido
// no celular: 1,58 MB de programa (590 KB do sistema inteiro + 390 KB de
// gráficos) só para aparecer o campo de login do portal.
//
// Com lazy(), cada tela vira um arquivo à parte, baixado na hora em que ela é
// aberta pela primeira vez. As telas do começo (login, portal e o painel)
// continuam juntas, porque são as primeiras que todo mundo vê.
// ---------------------------------------------------------------------------
// O painel puxa os gráficos (390 KB). Adiado também: assim o cliente, que
// nunca vê um gráfico, não baixa essa parte para entrar na área dele.
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Clients = lazy(() => import("./pages/Clients.jsx"));
const Projects = lazy(() => import("./pages/Projects.jsx"));
const Tasks = lazy(() => import("./pages/Tasks.jsx"));
const Financial = lazy(() => import("./pages/Financial.jsx"));
const Contracts = lazy(() => import("./pages/Contracts.jsx"));
const Goals = lazy(() => import("./pages/Goals.jsx"));
const Agenda = lazy(() => import("./pages/Agenda.jsx"));
const Events = lazy(() => import("./pages/Events.jsx"));
const Calendar = lazy(() => import("./pages/Calendar.jsx"));
const Files = lazy(() => import("./pages/Files.jsx"));
const Workspace = lazy(() => import("./pages/Workspace.jsx"));
const Reports = lazy(() => import("./pages/Reports.jsx"));
const Users = lazy(() => import("./pages/Users.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));
const Organizations = lazy(() => import("./pages/Organizations.jsx"));
const Integrations = lazy(() => import("./pages/Integrations.jsx"));
const Prospects = lazy(() => import("./pages/Prospects.jsx"));
const Deliveries = lazy(() => import("./pages/Deliveries.jsx"));
const Distribution = lazy(() => import("./pages/Distribution.jsx"));
const Planning = lazy(() => import("./pages/Planning.jsx"));
const Services = lazy(() => import("./pages/Services.jsx"));
const Priorities = lazy(() => import("./pages/Priorities.jsx"));
const MinhasFinancas = lazy(() => import("./pages/MinhasFinancas.jsx"));
const ClientArea = lazy(() => import("./pages/ClientArea.jsx"));
const AI = lazy(() => import("./pages/AI.jsx"));
const SignContract = lazy(() => import("./pages/SignContract.jsx"));
const Intelligence = lazy(() => import("./pages/Intelligence.jsx"));
const Briefing = lazy(() => import("./pages/Briefing.jsx"));
const Onboarding = lazy(() => import("./pages/Onboarding.jsx"));
const LandingPages = lazy(() => import("./pages/LandingPages.jsx"));

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <Box sx={{ height: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/** Enquanto o pedaço da tela chega, a mesma bolinha de sempre. */
function Carregando() {
  return (
    <Box sx={{ height: "60vh", display: "grid", placeItems: "center" }}>
      <CircularProgress />
    </Box>
  );
}

export default function App() {
  // ARRASTAR ARQUIVO PARA CIMA DO SISTEMA NÃO PODE DERRUBAR O SISTEMA.
  //
  // Sem ninguém tratar, o navegador faz o padrão dele: abre o arquivo solto e a
  // tela do sistema some. Quem errava a mira ao arrastar uma foto perdia onde
  // estava. Aqui a janela inteira recusa o arquivo solto fora de uma área de
  // envio; as áreas de envio tratam o evento antes e seguem funcionando.
  useEffect(() => impedirAberturaPeloNavegador(), []);

  return (
    <Suspense fallback={<Carregando />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/portal/login" element={<PortalLogin />} />
      <Route path="/portal" element={<Portal />} />
      <Route path="/assinar/:token" element={<SignContract />} />
      {/* Briefing do cliente: link público, sem login (como a assinatura) */}
      <Route path="/briefing/:token" element={<Briefing />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/landing-pages" element={<LandingPages />} />
        <Route path="/services" element={<Services />} />
        <Route path="/prospects" element={<Prospects />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/deliveries" element={<Deliveries />} />
        <Route path="/intelligence" element={<Intelligence />} />
        <Route path="/onboarding" element={<Onboarding />} />
        {/* O endereço antigo continua valendo: quem tinha a aba salva não cai
            numa página em branco. */}
        <Route path="/briefing-admin" element={<Navigate to="/onboarding" replace />} />
        <Route path="/ai" element={<AI />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/distribution" element={<Distribution />} />
        <Route path="/financial" element={<Financial />} />
        <Route path="/contracts" element={<Contracts />} />
        <Route path="/goals" element={<Goals />} />
        <Route path="/agenda" element={<Agenda />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/planning" element={<Planning />} />
        <Route path="/priorities" element={<Priorities />} />
        <Route path="/minhas-financas" element={<MinhasFinancas />} />
        <Route path="/client-area" element={<ClientArea />} />
        <Route path="/files" element={<Files />} />
        <Route path="/workspace" element={<Workspace />} />
        <Route path="/events" element={<Events />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/organizations" element={<Organizations />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/users" element={<Users />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  );
}
