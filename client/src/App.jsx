import { Component, lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
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
// E O QUE ACONTECE QUANDO O ARQUIVO DA TELA NÃO EXISTE MAIS.
//
// "creator não tá abrindo a galeria na versão mobile."
//
// Cada tela é um arquivo com o nome carimbado pelo conteúdo
// (Files-Bkd8x6pt.js). A cada publicação os nomes mudam e os antigos somem do
// servidor. Quem está com o aplicativo ABERTO desde antes — e no celular ele
// fica aberto dias — continua rodando a versão velha; ao tocar numa tela que
// ainda não tinha aberto, o programa vai buscar um arquivo que não existe mais.
//
// Reproduzido no Chromium, em tela de iPhone: TELA EM BRANCO, com
// "Failed to fetch dynamically imported module". Nenhum aviso, nada. Pior: o
// servidor responde o index.html no lugar do arquivo que falta (é o curinga do
// endereço), então o navegador recebe HTML onde esperava programa.
//
// É por isso que batia só no celular, e só em algumas telas: as que ela abre
// com menos frequência, cujo arquivo nunca tinha sido baixado antes.
//
// A saída é simples: se o arquivo sumiu, a versão na mão é velha — recarrega
// a página uma vez e pronto, volta com a nova. A guarda impede laço: se mesmo
// depois de recarregar continuar faltando, aí é outra coisa, e quem conta é o
// aviso na tela (ver TelaQueFalhou).
// ---------------------------------------------------------------------------
const MARCA_DE_RECARGA = "pc-recarreguei-por-tela-que-sumiu";
const lembrete = {
  ja: () => { try { return sessionStorage.getItem(MARCA_DE_RECARGA); } catch { return null; } },
  marca: () => { try { sessionStorage.setItem(MARCA_DE_RECARGA, "1"); } catch { /* anônima */ } },
  limpa: () => { try { sessionStorage.removeItem(MARCA_DE_RECARGA); } catch { /* anônima */ } },
};

/**
 * A REDE DE SEGURANÇA: NUNCA MAIS TELA EM BRANCO.
 *
 * Se o carregamento falhar DEPOIS de já ter recarregado uma vez, não adianta
 * recarregar de novo — vira laço. Aí o que a pessoa precisa é de uma frase e
 * um botão, não de um retângulo branco sem explicação nenhuma.
 */
class TelaQueFalhou extends Component {
  constructor(props) { super(props); this.state = { caiu: false }; }
  static getDerivedStateFromError() { return { caiu: true }; }
  componentDidCatch(erro) { console.error("[tela] não deu para abrir:", erro?.message || erro); }
  render() {
    if (!this.state.caiu) return this.props.children;
    return (
      <Box sx={{ minHeight: "60dvh", display: "grid", placeItems: "center", p: 3, textAlign: "center" }}>
        <Box>
          <Typography variant="h6" sx={{ mb: 1 }}>Não deu para abrir esta tela</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: "42ch" }}>
            Costuma ser versão antiga aberta no aparelho. Recarregue — se continuar,
            feche e abra o aplicativo.
          </Typography>
          <Button variant="contained" onClick={() => { lembrete.limpa(); window.location.reload(); }}>
            Recarregar
          </Button>
        </Box>
      </Box>
    );
  }
}

function telaAdiada(carregar) {
  return lazy(async () => {
    try {
      const tela = await carregar();
      lembrete.limpa();            // abriu: a versão na mão está boa
      return tela;
    } catch (erro) {
      if (lembrete.ja()) throw erro;   // já recarreguei nesta sessão: não insisto
      lembrete.marca();
      window.location.reload();
      // Segura o carregamento até a página trocar — sem isto, a tela em branco
      // aparece por um instante antes de recarregar.
      return new Promise(() => {});
    }
  });
}

// ---------------------------------------------------------------------------
// O painel puxa os gráficos (390 KB). Adiado também: assim o cliente, que
// nunca vê um gráfico, não baixa essa parte para entrar na área dele.
const Dashboard = telaAdiada(() => import("./pages/Dashboard.jsx"));
const Clients = telaAdiada(() => import("./pages/Clients.jsx"));
const Projects = telaAdiada(() => import("./pages/Projects.jsx"));
const Tasks = telaAdiada(() => import("./pages/Tasks.jsx"));
const Financial = telaAdiada(() => import("./pages/Financial.jsx"));
const Contracts = telaAdiada(() => import("./pages/Contracts.jsx"));
const Goals = telaAdiada(() => import("./pages/Goals.jsx"));
const Agenda = telaAdiada(() => import("./pages/Agenda.jsx"));
const Events = telaAdiada(() => import("./pages/Events.jsx"));
const Calendar = telaAdiada(() => import("./pages/Calendar.jsx"));
const Files = telaAdiada(() => import("./pages/Files.jsx"));
const Workspace = telaAdiada(() => import("./pages/Workspace.jsx"));
const Reports = telaAdiada(() => import("./pages/Reports.jsx"));
const Users = telaAdiada(() => import("./pages/Users.jsx"));
const Settings = telaAdiada(() => import("./pages/Settings.jsx"));
const Organizations = telaAdiada(() => import("./pages/Organizations.jsx"));
const Integrations = telaAdiada(() => import("./pages/Integrations.jsx"));
const Prospects = telaAdiada(() => import("./pages/Prospects.jsx"));
const Deliveries = telaAdiada(() => import("./pages/Deliveries.jsx"));
const Distribution = telaAdiada(() => import("./pages/Distribution.jsx"));
const Planning = telaAdiada(() => import("./pages/Planning.jsx"));
const Services = telaAdiada(() => import("./pages/Services.jsx"));
const Priorities = telaAdiada(() => import("./pages/Priorities.jsx"));
const MinhasFinancas = telaAdiada(() => import("./pages/MinhasFinancas.jsx"));
const ClientArea = telaAdiada(() => import("./pages/ClientArea.jsx"));
const AI = telaAdiada(() => import("./pages/AI.jsx"));
const SignContract = telaAdiada(() => import("./pages/SignContract.jsx"));
const Verificar = telaAdiada(() => import("./pages/Verificar.jsx"));
const Intelligence = telaAdiada(() => import("./pages/Intelligence.jsx"));
const Briefing = telaAdiada(() => import("./pages/Briefing.jsx"));
const Onboarding = telaAdiada(() => import("./pages/Onboarding.jsx"));
const LandingPages = telaAdiada(() => import("./pages/LandingPages.jsx"));

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
    <TelaQueFalhou>
    <Suspense fallback={<Carregando />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/portal/login" element={<PortalLogin />} />
      <Route path="/portal" element={<Portal />} />
      <Route path="/assinar/:token" element={<SignContract />} />
      {/* Conferir um documento assinado: público, sem login. O código e o QR
          saem impressos no Termo de Veracidade, no fim do contrato. */}
      <Route path="/verificar" element={<Verificar />} />
      <Route path="/verificar/:codigo" element={<Verificar />} />
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
    </TelaQueFalhou>
  );
}
