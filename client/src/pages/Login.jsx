import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Card, CardContent, TextField, Button, Typography, Alert, Stack, Avatar, Link,
} from "@mui/material";
import { useAuth } from "../auth/AuthContext.jsx";

// Guarda o último acesso deste aparelho: empresa + pessoa (nunca a senha).
const REMEMBER_KEY = "perspecta_last_login";
function loadRemembered() {
  try { return JSON.parse(localStorage.getItem(REMEMBER_KEY) || "null"); } catch { return null; }
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const remembered = loadRemembered();
  const [form, setForm] = useState({
    organization: remembered?.organization || "",
    username: remembered?.username || "",
    password: "",
  });
  // Modo "bem-vindo de volta": só pede a senha quando já há um acesso salvo.
  const [quick, setQuick] = useState(Boolean(remembered));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(form.organization, form.username, form.password);
      // Salva empresa + pessoa para o próximo acesso (sem a senha).
      localStorage.setItem(REMEMBER_KEY, JSON.stringify({
        organization: form.organization,
        username: form.username,
      }));
      navigate(user.role === "superadmin" ? "/organizations" : "/");
    } catch (err) {
      setError(err.response?.data?.error || "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  function trocarConta() {
    localStorage.removeItem(REMEMBER_KEY);
    setForm({ organization: "", username: "", password: "" });
    setQuick(false);
    setError("");
  }

  return (
    <Box
      sx={{
        minHeight: "100dvh", display: "grid", placeItems: "center", p: 2,
        bgcolor: "#0C0A09",
        backgroundImage: `
          radial-gradient(900px 480px at 15% -10%, rgba(234,88,12,0.28), transparent 60%),
          radial-gradient(700px 420px at 110% 110%, rgba(234,88,12,0.14), transparent 55%)
        `,
      }}
    >
      <Card sx={{ width: 400, maxWidth: "100%" }}>
        <CardContent sx={{ p: 4 }}>
          <Stack alignItems="center" spacing={1} sx={{ mb: 3 }}>
            <Box sx={{ width: 52, height: 52, borderRadius: 2.5, bgcolor: "primary.main", color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 20, fontFamily: '"Outfit", sans-serif' }}>
              PM
            </Box>
            <Typography variant="h6">Perspecta Media</Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              {quick ? "Confirme a sua senha para entrar" : "Entre com o seu escritório, nome e senha"}
            </Typography>
          </Stack>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <form onSubmit={submit}>
            <Stack spacing={2}>
              {quick ? (
                // Já sabemos empresa e pessoa: mostra quem está entrando e pede só a senha.
                <Stack direction="row" spacing={1.5} alignItems="center"
                  sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}>
                  <Avatar sx={{ bgcolor: "primary.main", width: 40, height: 40 }}>
                    {(form.username || "?").slice(0, 1).toUpperCase()}
                  </Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontWeight: 700, lineHeight: 1.2 }}>{form.username}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>{form.organization}</Typography>
                  </Box>
                </Stack>
              ) : (
                <>
                  <TextField label="Escritório" value={form.organization} onChange={set("organization")}
                    fullWidth required autoFocus placeholder="Perspectiva" />
                  <TextField label="Nome" value={form.username} onChange={set("username")}
                    fullWidth required placeholder="Katy" />
                </>
              )}
              <TextField label="Senha" type="password" value={form.password} onChange={set("password")}
                fullWidth required autoFocus={quick} />
              <Button type="submit" variant="contained" size="large" disabled={loading}>
                {loading ? "Aguarde..." : "Entrar"}
              </Button>
              {quick && (
                <Link component="button" type="button" underline="hover" onClick={trocarConta}
                  sx={{ alignSelf: "center", fontSize: 13 }}>
                  Entrar com outra conta
                </Link>
              )}
            </Stack>
          </form>

          <Typography variant="caption" color="text.secondary" align="center" sx={{ display: "block", mt: 2.5 }}>
            É cliente da agência? Use a <Box component="a" href="/portal" sx={{ color: "primary.main" }}>área do cliente</Box>.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
