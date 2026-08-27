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

// Em vez de deslogar no primeiro 401 (o que chutava a pessoa pra tela de login
// no meio de um cadastro quando o servidor dava um soluço — ex.: durante um
// deploy), a gente CONFIRMA que o token está mesmo inválido antes de encerrar a
// sessão. Só desloga se o /auth/me também recusar. Assim uma falha passageira
// não faz o site "sair da aba" a cada instante.
let verificandoSessao = false;

function encerrarSessao() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  if (!location.pathname.startsWith("/login")) location.href = "/login";
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const status = err.response?.status;
    const cfg = err.config || {};
    // Sem token não há sessão pra confirmar: comportamento antigo.
    if (status === 401 && !cfg._skipAuthRedirect) {
      if (!localStorage.getItem("token")) { encerrarSessao(); return Promise.reject(err); }
      if (verificandoSessao) return Promise.reject(err); // já estamos checando
      try {
        verificandoSessao = true;
        await api.get("/auth/me", { _skipAuthRedirect: true, timeout: 8000 });
        // /auth/me respondeu: o token vale — foi um erro pontual. Não desloga.
        return Promise.reject(err);
      } catch (e2) {
        // Só encerra se a própria checagem confirmou 401 (token realmente inválido).
        if (e2.response?.status === 401) encerrarSessao();
        return Promise.reject(err);
      } finally {
        verificandoSessao = false;
      }
    }
    return Promise.reject(err);
  }
);

export default api;
