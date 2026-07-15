import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Card, CardContent, TextField, Button, Typography, Alert, Stack } from "@mui/material";
import portalApi from "../api/portal.js";

export default function PortalLogin() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await portalApi.post("/login", form);
      localStorage.setItem("portal_token", data.token);
      localStorage.setItem("portal_client", JSON.stringify(data.client));
      navigate("/portal");
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
              SA
            </Box>
            <Typography variant="h6">Área do Cliente</Typography>
            <Typography variant="body2" color="text.secondary" align="center">
              Acompanhe seus posts, aprovações e pagamentos
            </Typography>
          </Stack>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <form onSubmit={submit}>
            <Stack spacing={2}>
              <TextField label="E-mail" type="email" value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} fullWidth required />
              <TextField label="Senha" type="password" value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} fullWidth required />
              <Button type="submit" variant="contained" size="large" disabled={loading}>
                {loading ? "Aguarde..." : "Entrar"}
              </Button>
            </Stack>
          </form>

          <Typography variant="caption" color="text.secondary" align="center" sx={{ display: "block", mt: 2.5 }}>
            Não tem acesso? Fale com a sua agência.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
