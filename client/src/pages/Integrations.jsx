import { useEffect, useState } from "react";
import {
  Box, Button, Card, CardContent, Typography, Chip, Stack, Alert, Divider,
  Switch, FormControlLabel, Tooltip, IconButton, Link, MenuItem, TextField,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import InstagramIcon from "@mui/icons-material/Instagram";
import FacebookIcon from "@mui/icons-material/Facebook";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import api from "../api/client.js";
import { PageHeader } from "../components/ui.jsx";
import { useAuth } from "../auth/AuthContext.jsx";

export default function Integrations() {
  const { isAdmin } = useAuth();
  const [status, setStatus] = useState(null);
  const [clients, setClients] = useState([]);
  const [erro, setErro] = useState("");
  // Cobrança recorrente (Asaas)
  const [billing, setBilling] = useState(null);
  const [asaasKey, setAsaasKey] = useState("");
  const [asaasEnv, setAsaasEnv] = useState("production");

  const load = () => {
    api.get("/integrations/meta/status").then((r) => setStatus(r.data)).catch(() => {});
    api.get("/clients").then((r) => setClients(r.data.filter((c) => c.status === "active"))).catch(() => {});
    api.get("/billing/status").then((r) => setBilling(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  async function salvarAsaas() {
    await api.put("/billing/config", { api_key: asaasKey || undefined, environment: asaasEnv });
    setAsaasKey("");
    load();
  }

  async function assinar(client) {
    setErro("");
    try {
      const { data } = await api.post(`/billing/subscribe/${client.id}`);
      if (data.invoice_url) {
        window.open(`https://wa.me/?text=${encodeURIComponent(`Para deixar o pagamento automático no cartão, cadastre aqui: ${data.invoice_url}`)}`, "_blank");
      }
      load();
    } catch (e) {
      setErro(e.response?.data?.error || "Não foi possível criar a assinatura.");
    }
  }

  async function cancelarAssinatura(client) {
    if (!confirm(`Cancelar a cobrança automática de ${client.name}?`)) return;
    await api.delete(`/billing/subscribe/${client.id}`);
    load();
  }

  const conexaoDe = (clientId) =>
    (status?.connections || []).find((c) => c.client_id === clientId);

  async function conectar(client) {
    setErro("");
    try {
      const { data } = await api.post("/integrations/meta/connect", { client_id: client.id });
      // O login da Meta abre em janela separada; ao fechar, recarregamos.
      const janela = window.open(data.url, "meta", "width=620,height=720");
      const timer = setInterval(() => {
        if (janela?.closed) { clearInterval(timer); load(); }
      }, 1000);
    } catch (e) {
      setErro(e.response?.data?.error || "Não foi possível iniciar a conexão.");
    }
  }

  async function desconectar(client) {
    if (!confirm(`Desconectar as redes de ${client.name}?`)) return;
    await api.delete(`/integrations/meta/${client.id}`);
    load();
  }

  async function alternarAuto(client, ligado) {
    await api.put("/integrations/auto-publish", { client_id: client.id, enabled: ligado });
    load();
  }

  return (
    <>
      <PageHeader
        title="Integrações"
        subtitle="Conecte as redes de cada cliente para publicar direto daqui"
      />

      {erro && <Alert severity="error" sx={{ mb: 2 }}>{erro}</Alert>}

      {status && !status.configured && (
        <Alert severity="info" sx={{ mb: 2.5 }}>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Falta criar o app na Meta</Typography>
          A publicação direta precisa de um app seu em{" "}
          <Link href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com</Link>.
          Com o App ID e o App Secret em mãos, é só colocá-los nas variáveis
          <code> META_APP_ID</code>, <code>META_APP_SECRET</code> e <code>META_REDIRECT_URI</code> do servidor.
          Enquanto isso, o resto do sistema funciona normalmente — só a publicação automática fica de fora.
        </Alert>
      )}

      <Stack spacing={2}>
        {clients.map((c) => {
          const conn = conexaoDe(c.id);
          return (
            <Card key={c.id}>
              <CardContent>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}
                  justifyContent="space-between" alignItems={{ sm: "center" }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700 }}>{c.name}</Typography>
                    {conn ? (
                      <Stack direction="row" spacing={0.75} sx={{ mt: 0.75, flexWrap: "wrap", gap: 0.75 }}>
                        {conn.ig_username && (
                          <Chip size="small" icon={<InstagramIcon sx={{ fontSize: 15 }} />}
                            label={`@${conn.ig_username}`} color="primary" />
                        )}
                        {conn.page_name && (
                          <Chip size="small" variant="outlined" icon={<FacebookIcon sx={{ fontSize: 15 }} />}
                            label={conn.page_name} />
                        )}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Nenhuma rede conectada.
                      </Typography>
                    )}
                  </Box>

                  <Stack direction="row" spacing={1} alignItems="center">
                    {conn ? (
                      <>
                        <Tooltip title="Publica sozinho na data programada. Deixe desligado para publicar só com o seu clique.">
                          <FormControlLabel
                            control={<Switch checked={!!conn.auto_publish}
                              onChange={(e) => alternarAuto(c, e.target.checked)} />}
                            label={<Typography variant="body2">Publicar sozinho</Typography>}
                          />
                        </Tooltip>
                        <IconButton color="error" onClick={() => desconectar(c)} title="Desconectar">
                          <LinkOffIcon />
                        </IconButton>
                      </>
                    ) : (
                      <Button variant="contained" startIcon={<InstagramIcon />}
                        disabled={!status?.configured} onClick={() => conectar(c)}>
                        Conectar Meta
                      </Button>
                    )}
                  </Stack>
                </Stack>

                {conn?.auto_publish ? (
                  <Box sx={{ mt: 1.5, p: 1.25, borderRadius: 2, bgcolor: (t) => alpha(t.palette.warning.main, 0.1) }}>
                    <Typography variant="caption">
                      Posts aprovados pelo cliente e com arte anexada vão ao ar sozinhos na hora marcada.
                    </Typography>
                  </Box>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
        {clients.length === 0 && (
          <Card><CardContent sx={{ textAlign: "center", py: 5 }}>
            <Typography color="text.secondary">Cadastre clientes para conectar as redes.</Typography>
          </CardContent></Card>
        )}
      </Stack>

      <Divider sx={{ my: 3 }} />
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: "70ch" }}>
        Publicar exige que o post esteja <strong>aprovado pelo cliente</strong> e tenha a{" "}
        <strong>arte anexada</strong> na tarefa. O Instagram precisa ser uma conta
        profissional ligada a uma página do Facebook.
      </Typography>

      {/* ---- Cobrança automática no cartão (Asaas) ---- */}
      <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>Cobrança automática no cartão</Typography>
      {billing && !billing.configured && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Falta ligar o Asaas</Typography>
          Crie uma conta grátis no <Link href="https://www.asaas.com" target="_blank" rel="noopener">Asaas</Link>,
          pegue a chave de API e cole abaixo. O cartão do cliente fica guardado no cofre do Asaas — nunca no nosso sistema.
        </Alert>
      )}
      {isAdmin && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              Chave do Asaas {billing?.configured && <Chip size="small" color="success" label="ligada" sx={{ ml: 1 }} />}
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
              <TextField select size="small" label="Ambiente" value={asaasEnv}
                onChange={(e) => setAsaasEnv(e.target.value)} sx={{ minWidth: 150 }}>
                <MenuItem value="production">Produção</MenuItem>
                <MenuItem value="sandbox">Teste (sandbox)</MenuItem>
              </TextField>
              <TextField size="small" type="password" value={asaasKey}
                onChange={(e) => setAsaasKey(e.target.value)} sx={{ flex: 1 }}
                label={billing?.configured ? "Nova chave (vazio = manter)" : "Chave de API do Asaas"}
                placeholder="$aact_..." />
              <Button variant="contained" onClick={salvarAsaas} disabled={!asaasKey && !billing?.configured}>Salvar</Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      <Stack spacing={1.5}>
        {(billing?.clients || []).map((c) => (
          <Card key={c.id}>
            <CardContent sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
              <Box>
                <Typography sx={{ fontWeight: 600 }}>{c.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {c.valor ? `R$ ${Number(c.valor).toFixed(2)}/mês` : "sem valor definido"}
                  {c.subscribed && " · cobrança ativa"}
                </Typography>
              </Box>
              {c.subscribed ? (
                <Button color="error" variant="outlined" startIcon={<LinkOffIcon />}
                  onClick={() => cancelarAssinatura(c)}>Cancelar</Button>
              ) : (
                <Button variant="contained" disabled={!billing?.configured || !c.valor}
                  onClick={() => assinar(c)}>
                  Ativar cobrança
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, maxWidth: "70ch" }}>
        Ao ativar, geramos um link seguro do Asaas para o cliente cadastrar o cartão uma vez.
        Depois, todo mês o Asaas cobra sozinho e o pagamento aparece aqui como confirmado.
      </Typography>
    </>
  );
}
