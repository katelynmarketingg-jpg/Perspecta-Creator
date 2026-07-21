import { createContext, useContext, useEffect, useState } from "react";
import api from "../api/client.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  // Escritório que o Perspecta Media está olhando no momento.
  const [viewingOrg, setViewingOrg] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("viewing_org") || "null");
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get("/auth/me")
      .then((res) => {
        setUser(res.data);
        localStorage.setItem("user", JSON.stringify(res.data));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function login(organization, username, password) {
    const { data } = await api.post("/auth/login", { organization, username, password });
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    localStorage.removeItem("viewing_org");
    setViewingOrg(null);
    setUser(data.user);
    return data.user;
  }

  // Master entra num escritório para ver os dados dele.
  function enterOrg(org) {
    localStorage.setItem("viewing_org", JSON.stringify(org));
    setViewingOrg(org);
  }

  function leaveOrg() {
    localStorage.removeItem("viewing_org");
    setViewingOrg(null);
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("viewing_org");
    setViewingOrg(null);
    setUser(null);
  }

  const isMaster = user?.role === "superadmin";

  return (
    <AuthContext.Provider
      value={{
        user, loading, login, logout,
        isAdmin: user?.role === "admin" || isMaster,
        isMaster,
        viewingOrg, enterOrg, leaveOrg,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
