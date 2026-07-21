import axios from "axios";

// Cliente HTTP central — espelha o app original: baseURL /api + Bearer token.
const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Quando o Perspecta Media está dentro de um escritório, as chamadas
  // passam a valer para aquele escritório.
  try {
    const viewing = JSON.parse(localStorage.getItem("viewing_org") || "null");
    if (viewing?.id) config.headers["X-Org-Id"] = String(viewing.id);
  } catch { /* sem escritório selecionado */ }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      if (!location.pathname.startsWith("/login")) location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;
