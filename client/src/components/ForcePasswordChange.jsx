import { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Stack, Alert, Typography,
} from "@mui/material";
import api from "../api/client.js";
import { useAuth } from "../auth/AuthContext.jsx";

// Bloqueia o sistema até a pessoa trocar uma senha-padrão fraca (ex.: "001").
// Aparece só quando o usuário está marcado com must_change_password.
export default function ForcePasswordChange() {
  const { user, markPasswordChanged } = useAuth();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [conf, setConf] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  if (!user?.must_change_password) return null;

  async function salvar() {
    setErro("");
    if (nova.length < 4) return setErro("A nova senha precisa ter ao menos 4 caracteres.");
    if (nova !== conf) return setErro("A confirmação não bate com a nova senha.");
    if (nova === "001") return setErro("Escolha uma senha diferente de '001'.");
    setSalvando(true);
    try {
      await api.put("/auth/password", { current_password: atual, new_password: nova });
      markPasswordChanged();
    } catch (e) {
      setErro(e.response?.data?.error || "Não foi possível trocar a senha.");
    }
    setSalvando(false);
  }

  return (
    <Dialog open fullWidth maxWidth="xs" disableEscapeKeyDown>
      <DialogTitle>Troque sua senha para continuar</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Sua conta ainda usa uma senha padrão fraca. Defina uma senha nova para proteger o acesso.
          </Typography>
          {erro && <Alert severity="error">{erro}</Alert>}
          <TextField label="Senha atual" type="password" value={atual} onChange={(e) => setAtual(e.target.value)} fullWidth />
          <TextField label="Nova senha" type="password" value={nova} onChange={(e) => setNova(e.target.value)} fullWidth />
          <TextField label="Confirmar nova senha" type="password" value={conf} onChange={(e) => setConf(e.target.value)} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={salvar} disabled={salvando || !atual || !nova}>
          Salvar nova senha
        </Button>
      </DialogActions>
    </Dialog>
  );
}
