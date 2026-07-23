import { useEffect, useState } from "react";
import { NavLink, useNavigate, Outlet } from "react-router-dom";
import {
  AppBar, Box, Drawer, IconButton, List, ListItemButton, ListItemIcon,
  ListItemText, Toolbar, Typography, Avatar, Menu, MenuItem, Divider, Tooltip,
  Badge, Button,
} from "@mui/material";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import api from "../api/client.js";
import { alpha } from "@mui/material/styles";
import DashboardIcon from "@mui/icons-material/Dashboard";
import PeopleIcon from "@mui/icons-material/People";
import FolderIcon from "@mui/icons-material/Folder";
import ViewKanbanIcon from "@mui/icons-material/ViewKanban";
import ChecklistRtlIcon from "@mui/icons-material/ChecklistRtl";
import PaidIcon from "@mui/icons-material/Paid";
import DescriptionIcon from "@mui/icons-material/Description";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import EventIcon from "@mui/icons-material/Event";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import FolderCopyIcon from "@mui/icons-material/FolderCopy";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";
import ApartmentIcon from "@mui/icons-material/Apartment";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import HubIcon from "@mui/icons-material/Hub";
import PersonSearchIcon from "@mui/icons-material/PersonSearch";
import BarChartIcon from "@mui/icons-material/BarChart";
import GroupIcon from "@mui/icons-material/Group";
import SettingsIcon from "@mui/icons-material/Settings";
import MenuIcon from "@mui/icons-material/Menu";
import LogoutIcon from "@mui/icons-material/Logout";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import { useAuth } from "../auth/AuthContext.jsx";
import { useColorMode } from "../ColorModeContext.jsx";
import { SIDEBAR } from "../theme.js";

const DRAWER_WIDTH = 248;

const NAV = [
  { to: "/organizations", label: "Escritórios", icon: <ApartmentIcon />, masterOnly: true },
  { to: "/", label: "Dashboard", icon: <DashboardIcon />, end: true },
  { to: "/clients", label: "Clientes", icon: <PeopleIcon /> },
  { to: "/prospects", label: "Prospecção", icon: <PersonSearchIcon /> },
  { to: "/workspace", label: "Central", icon: <SpaceDashboardIcon /> },
  { to: "/projects", label: "Projetos", icon: <FolderIcon /> },
  { to: "/tasks", label: "Tarefas", icon: <ViewKanbanIcon /> },
  { to: "/deliveries", label: "Entregas", icon: <ChecklistRtlIcon /> },
  { to: "/financial", label: "Financeiro", icon: <PaidIcon /> },
  { to: "/contracts", label: "Contratos", icon: <DescriptionIcon /> },
  { to: "/goals", label: "Metas", icon: <EmojiEventsIcon /> },
  { to: "/calendar", label: "Calendário", icon: <CalendarMonthIcon /> },
  { to: "/files", label: "Arquivos", icon: <FolderCopyIcon /> },
  { to: "/agenda", label: "Agenda", icon: <EventIcon /> },
  { to: "/reports", label: "Relatórios", icon: <BarChartIcon /> },
  { to: "/integrations", label: "Integrações", icon: <HubIcon /> },
  { to: "/users", label: "Usuários", icon: <GroupIcon />, adminOnly: true },
  { to: "/settings", label: "Configurações", icon: <SettingsIcon /> },
];

export default function Layout() {
  const { user, logout, isAdmin, isMaster, viewingOrg, leaveOrg } = useAuth();
  const { mode, toggle } = useColorMode();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const [notifAnchor, setNotifAnchor] = useState(null);
  const [notifs, setNotifs] = useState([]);

  // Notificações do portal (aprovações e pedidos de ajuste dos clientes).
  useEffect(() => {
    const fetchNotifs = () => api.get("/notifications").then((r) => setNotifs(r.data)).catch(() => {});
    fetchNotifs();
    const id = setInterval(fetchNotifs, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const unread = notifs.filter((n) => !n.is_read).length;

  async function openNotifs(e) {
    setNotifAnchor(e.currentTarget);
  }

  async function markAllRead() {
    await api.put("/notifications/read-all").catch(() => {});
    setNotifs((ns) => ns.map((n) => ({ ...n, is_read: 1 })));
  }

  // Cores da barra lateral conforme o clima. Nos modos claros ela é terracota
  // (texto branco); no escuro, quase-preta com destaque laranja.
  const sb = SIDEBAR[mode] || SIDEBAR.light;
  const terracota = mode !== "dark";
  const sbText = terracota ? "rgba(255,255,255,0.82)" : "#A8A29E";
  const sbTextDim = terracota ? "rgba(255,255,255,0.55)" : "#78716C";
  const sbIcon = terracota ? "rgba(255,255,255,0.7)" : "#57534E";
  const activeBg = terracota ? "rgba(255,255,255,0.18)" : (t) => alpha(t.palette.primary.main, 0.16);
  const activeColor = terracota ? "#FFFFFF" : (t) => t.palette.primary.main;

  // O master só vê as telas de dados quando entra num escritório.
  const items = NAV.filter((n) => {
    if (n.masterOnly) return isMaster;
    if (n.adminOnly && !isAdmin) return false;
    if (isMaster && !viewingOrg) return false;
    return true;
  });

  const drawer = (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: sb.bg }}>
      <Toolbar sx={{ px: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.2 }}>
          <Box sx={{
            width: 34, height: 34, borderRadius: 2,
            bgcolor: terracota ? "rgba(255,255,255,0.16)" : "primary.main", color: "#fff",
            display: "grid", placeItems: "center", fontWeight: 800, fontFamily: '"Outfit", sans-serif',
            fontSize: 13,
          }}>
            {(viewingOrg?.name || user?.org_name || "PM").slice(0, 2).toUpperCase()}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 700, lineHeight: 1, color: "#fff", fontFamily: '"Outfit", sans-serif' }}>
              {viewingOrg?.name || user?.org_name || "Perspecta Media"}
            </Typography>
            <Typography variant="caption" sx={{ color: sbTextDim }}>
              {viewingOrg ? "visto pelo Perspecta Media" : isMaster ? "administração" : "gestão da agência"}
            </Typography>
          </Box>
        </Box>
      </Toolbar>
      <Divider sx={{ borderColor: sb.border }} />
      <List sx={{ px: 1.5, py: 1.5, flex: 1, overflowY: "auto" }}>
        {items.map((n) => (
          <ListItemButton
            key={n.to}
            component={NavLink}
            to={n.to}
            end={n.end}
            onClick={() => setMobileOpen(false)}
            sx={{
              borderRadius: 2.5, mb: 0.3, color: sbText,
              transition: "background-color .2s ease, color .2s ease",
              "& .MuiListItemIcon-root": { color: sbIcon, transition: "color .2s ease" },
              "&:hover": { bgcolor: "rgba(255,255,255,0.08)", color: "#fff" },
              "&.active": {
                bgcolor: activeBg,
                color: activeColor,
                "& .MuiListItemIcon-root": { color: activeColor },
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>{n.icon}</ListItemIcon>
            <ListItemText primary={n.label} primaryTypographyProps={{ fontSize: 14.5, fontWeight: 600 }} />
          </ListItemButton>
        ))}
      </List>
      <Divider sx={{ borderColor: sb.border }} />
      <Box sx={{ p: 2, color: sbTextDim, fontSize: 12 }}>© {new Date().getFullYear()} Perspecta Media</Box>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh" }}>
      <AppBar
        position="fixed"
        elevation={0}
        color="transparent"
        sx={{
          borderBottom: 1, borderColor: "divider",
          bgcolor: (t) => alpha(t.palette.background.default, 0.85),
          backdropFilter: "blur(8px)",
          zIndex: (t) => t.zIndex.drawer + 1,
        }}
      >
        <Toolbar>
          <IconButton edge="start" sx={{ mr: 1, display: { md: "none" } }} onClick={() => setMobileOpen(true)}>
            <MenuIcon />
          </IconButton>
          {viewingOrg && (
            <Button size="small" startIcon={<ArrowBackIcon />}
              onClick={() => { leaveOrg(); navigate("/organizations"); }}
              sx={{ mr: 1 }}>
              Voltar aos escritórios
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Notificações">
            <IconButton onClick={openNotifs} sx={{ mr: 0.5 }}>
              <Badge badgeContent={unread} color="primary">
                <NotificationsNoneIcon />
              </Badge>
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={notifAnchor} open={Boolean(notifAnchor)} onClose={() => setNotifAnchor(null)}
            slotProps={{ paper: { sx: { width: 360, maxHeight: "55vh" } } }}
          >
            <MenuItem disabled sx={{ opacity: "1 !important" }}>
              <Typography sx={{ fontWeight: 700, flex: 1 }}>Notificações</Typography>
              {unread > 0 && (
                <Typography variant="caption" color="primary" sx={{ cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); markAllRead(); }}>
                  Marcar todas como lidas
                </Typography>
              )}
            </MenuItem>
            <Divider />
            {notifs.length === 0 && <MenuItem disabled>Nenhuma notificação.</MenuItem>}
            {notifs.map((n) => (
              <MenuItem key={n.id} onClick={() => { setNotifAnchor(null); navigate("/tasks"); }}
                sx={{ whiteSpace: "normal", alignItems: "flex-start", opacity: n.is_read ? 0.55 : 1 }}>
                <Box>
                  <Typography variant="body2">{n.message}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(n.created_at + "Z").toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </Menu>
          <Tooltip title={`Tema: ${mode === "light" ? "claro" : mode === "sepia" ? "bege" : "escuro"} — clique para trocar`}>
            <IconButton onClick={toggle} sx={{ mr: 0.5 }}>
              {mode === "light" ? <LightModeOutlinedIcon />
                : mode === "sepia" ? <Brightness4Icon />
                : <DarkModeOutlinedIcon />}
            </IconButton>
          </Tooltip>
          <Typography variant="body2" color="text.secondary" sx={{ mr: 1.5, display: { xs: "none", sm: "block" } }}>
            {user?.name}
          </Typography>
          <IconButton onClick={(e) => setAnchor(e.currentTarget)}>
            <Avatar sx={{ width: 34, height: 34, bgcolor: "primary.main", fontSize: 15, borderRadius: 2.5 }}>
              {(user?.name || "?").slice(0, 1).toUpperCase()}
            </Avatar>
          </IconButton>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
            <MenuItem disabled>{user?.email}</MenuItem>
            <Divider />
            <MenuItem onClick={() => { logout(); navigate("/login"); }}>
              <LogoutIcon fontSize="small" sx={{ mr: 1 }} /> Sair
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: "block", md: "none" }, "& .MuiDrawer-paper": { width: DRAWER_WIDTH, bgcolor: sb.bg, borderRight: `1px solid ${sb.border}` } }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{ display: { xs: "none", md: "block" }, "& .MuiDrawer-paper": { width: DRAWER_WIDTH, bgcolor: sb.bg, borderRight: `1px solid ${sb.border}` } }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, width: { md: `calc(100% - ${DRAWER_WIDTH}px)` }, p: { xs: 2, md: 3.5 } }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
