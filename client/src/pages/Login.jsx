import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Card, CardContent, TextField, Button, Typography, Alert, Stack,
} from "@mui/material";
import { useAuth } from "../auth/AuthContext.jsx";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ organization: "", username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(form.organization, form.username, form.password);
      navigate(user.role === "superadmin" ? "/organizations" : "/");
    } catch (err) {
      setError(err.response?.data?.error || "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
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
              Entre com o seu escritório, nome e senha
            </Typography>
          </Stack>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <form onSubmit={submit}>
            <Stack spacing={2}>
              <TextField label="Escritório" value={form.organization} onChange={set("organization")}
                fullWidth required autoFocus placeholder="Perspectiva" />
              <TextField label="Nome" value={form.username} onChange={set("username")}
                fullWidth required placeholder="Katy" />
              <TextField label="Senha" type="password" value={form.password} onChange={set("password")}
                fullWidth required />
              <Button type="submit" variant="contained" size="large" disabled={loading}>
                {loading ? "Aguarde..." : "Entrar"}
              </Button>
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
