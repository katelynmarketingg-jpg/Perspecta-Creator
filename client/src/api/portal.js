import axios from "axios";

// Cliente HTTP do PORTAL DO CLIENTE — token separado do token da equipe.
const portalApi = axios.create({
  baseURL: "/api/portal",
  headers: { "Content-Type": "application/json" },
});

portalApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("portal_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

portalApi.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("portal_token");
      localStorage.removeItem("portal_client");
      if (!location.pathname.startsWith("/portal/login")) location.href = "/portal/login";
    }
    return Promise.reject(err);
  }
);

export default portalApi;
