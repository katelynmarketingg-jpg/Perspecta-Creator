import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { getTheme } from "./theme.js";
import { ColorModeContext } from "./ColorModeContext.jsx";
import { AuthProvider } from "./auth/AuthContext.jsx";
import App from "./App.jsx";

const MODES = ["light", "sepia", "dark"]; // claro → bege → escuro

function Root() {
  const [mode, setMode] = useState(() => {
    const stored = localStorage.getItem("color_mode");
    if (MODES.includes(stored)) return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  const theme = useMemo(() => getTheme(mode), [mode]);
  const colorMode = useMemo(
    () => ({
      mode,
      // Ciclo de três: claro → bege → escuro → claro...
      toggle: () =>
        setMode((m) => {
          const next = MODES[(MODES.indexOf(m) + 1) % MODES.length];
          localStorage.setItem("color_mode", next);
          return next;
        }),
      setMode: (m) => { if (MODES.includes(m)) { localStorage.setItem("color_mode", m); setMode(m); } },
    }),
    [mode]
  );

  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}

// Registra o service worker para o app poder ser instalado no celular.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
