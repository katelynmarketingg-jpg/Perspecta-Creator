import { Routes, Route, Navigate } from "react-router-dom";
import { Box, CircularProgress } from "@mui/material";
import { useAuth } from "./auth/AuthContext.jsx";
import Layout from "./components/Layout.jsx";

import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Clients from "./pages/Clients.jsx";
import Projects from "./pages/Projects.jsx";
import Tasks from "./pages/Tasks.jsx";
import Financial from "./pages/Financial.jsx";
import Contracts from "./pages/Contracts.jsx";
import Goals from "./pages/Goals.jsx";
import Agenda from "./pages/Agenda.jsx";
import Events from "./pages/Events.jsx";
import Calendar from "./pages/Calendar.jsx";
import Files from "./pages/Files.jsx";
import Workspace from "./pages/Workspace.jsx";
import Reports from "./pages/Reports.jsx";
import Users from "./pages/Users.jsx";
import Settings from "./pages/Settings.jsx";
import NotFound from "./pages/NotFound.jsx";
import PortalLogin from "./pages/PortalLogin.jsx";
import Portal from "./pages/Portal.jsx";

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

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/portal/login" element={<PortalLogin />} />
      <Route path="/portal" element={<Portal />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/financial" element={<Financial />} />
        <Route path="/contracts" element={<Contracts />} />
        <Route path="/goals" element={<Goals />} />
        <Route path="/agenda" element={<Agenda />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/files" element={<Files />} />
        <Route path="/workspace" element={<Workspace />} />
        <Route path="/events" element={<Events />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/users" element={<Users />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
