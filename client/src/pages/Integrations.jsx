import { useEffect, useState } from "react";
import {
  Box, Button, Card, CardContent, Typography, Chip, Stack, Alert, Divider,
  Switch, FormControlLabel, Tooltip, IconButton, Link, MenuItem, TextField,
  Tabs, Tab,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import InstagramIcon from "@mui/icons-material/Instagram";
import FacebookIcon from "@mui/icons-material/Facebook";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import PaidIcon from "@mui/icons-material/Paid";
import ArticleIcon from "@mui/icons-material/Article";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import api from "../api/client.js";
import { PageHeader } from "../components/ui.jsx";
import { useAuth } from "../auth/AuthContext.jsx";

// Google Docs/Sheets/Slides abrem embutidos usando a versão /preview.
function toPreview(url) {
  try {
    if (/docs\.google\.com/.test(url)) return url.replace(/\/(edit|view)[^/]*$/, "/preview").replace(/\?.*$/, "");
    return url;
  } catch { return url; }
}

export default function Integrations() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState("redes");
  const [status, setStatus] = useState(null);
  const [clients, setClients] = useState([]);
  const [erro, setErro] = useState("");
  // Cobrança recorrente (Asaas)
  const [billing, setBilling] = useState(null);
  const [asaasKey, setAsaasKey] = useState("");
  const [asaasEnv, setAsaasEnv] = useState("production");
  // Formas de pagamento oferecidas ao cliente
  const [payCfg, setPayCfg] = useState(null);
  const [payMsg, setPayMsg] = useState("");
  // Documentos (Google Docs)
  const [docs, setDocs] = useState([]);
  const [novoDoc, setNovoDoc] = useState({ title: "", url: "", client_id: "" });
  const [abrindo, setAbrindo] = useState(null); // doc aberto embutido

  const load = () => {
    api.get("/integrations/meta/status").then((r) => setStatus(r.data)).catch(() => {});
    api.get("/clients").then((r) => setClients(r.data.filter((c) => c.status === "active"))).catch(() => {});
    api.get("/billing/status").then((r) => setBilling(r.data)).catch(() => {});
    api.get("/org-docs").then((r) => setDocs(r.data)).catch(() => {});
    api.get("/branding").then((r) => setPayCfg(r.data?.pay_config || null)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  async function salvarPayCfg() {
    try {
      await api.put("/branding/pay-config", { pay_config: payCfg });
      setPayMsg("Formas de pagamento salvas.");
    } catch { setPayMsg("Não foi possível salvar."); }
    setTimeout(() => setPayMsg(""), 4000);
  }
  const setPay = (prov, patch) => setPayCfg((c) => ({ ...c, [prov]: { ...(c?.[prov] || {}), ...patch } }));

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

  const conexaoDe = (clientId) => (status?.connections || []).find((c) => c.client_id === clientId);

  async function conectar(client) {
    setErro("");
    try {
      const { data } = await api.post("/integrations/meta/connect", { client_id: client.id });
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

  async function addDoc() {
    if (!novoDoc.title || !novoDoc.url) return;
    await api.post("/org-docs", { ...novoDoc, client_id: novoDoc.client_id || null });
    setNovoDoc({ title: "", url: "", client_id: "" });
    load();
  }
  async function removeDoc(id) {
    if (!confirm("Remover este documento?")) return;
    if (abrindo?.id === id) setAbrindo(null);
    await api.delete(`/org-docs/${id}`);
    load();
  }

  return (
    <>
      <PageHeader title="Integrações" subtitle="Redes sociais, pagamentos e documentos — tudo num lugar só" />

      {erro && <Alert severity="error" sx={{ mb: 2 }}>{erro}</Alert>}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2.5, borderBottom: 1, borderColor: "divider" }}>
        <Tab value="redes" icon={<InstagramIcon fontSize="small" />} iconPosition="start" label="Redes sociais" />
        <Tab value="pagamentos" icon={<PaidIcon fontSize="small" />} iconPosition="start" label="Pagamentos" />
        <Tab value="documentos" icon={<ArticleIcon fontSize="small" />} iconPosition="start" label="Documentos" />
      </Tabs>

      {/* ===================== REDES SOCIAIS (Meta) ===================== */}
      {tab === "redes" && (
        <>
          {status && !status.configured && (
            <Alert severity="info" sx={{ mb: 2.5 }}>
              <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Falta criar o app na Meta</Typography>
              A publicação direta precisa de um app seu em{" "}
              <Link href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com</Link>.
              Com o App ID e o App Secret em mãos, coloque-os nas variáveis
              <code> META_APP_ID</code>, <code>META_APP_SECRET</code> e <code>META_REDIRECT_URI</code> do servidor.
              Enquanto isso, o resto do sistema funciona normalmente.
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
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Nenhuma rede conectada.</Typography>
                        )}
                      </Box>
                      <Stack direction="row" spacing={1} alignItems="center">
                        {conn ? (
                          <>
                            <Tooltip title="Publica sozinho na data programada. Deixe desligado para publicar só com o seu clique.">
                              <FormControlLabel
                                control={<Switch checked={!!conn.auto_publish} onChange={(e) => alternarAuto(c, e.target.checked)} />}
                                label={<Typography variant="body2">Publicar sozinho</Typography>} />
                            </Tooltip>
                            <IconButton color="error" onClick={() => desconectar(c)} title="Desconectar"><LinkOffIcon /></IconButton>
                          </>
                        ) : (
                          <Button variant="contained" startIcon={<InstagramIcon />} disabled={!status?.configured} onClick={() => conectar(c)}>
                            Conectar Meta
                          </Button>
                        )}
                      </Stack>
                    </Stack>
                    {conn?.auto_publish ? (
                      <Box sx={{ mt: 1.5, p: 1.25, borderRadius: 2, bgcolor: (t) => alpha(t.palette.warning.main, 0.1) }}>
                        <Typography variant="caption">Posts aprovados pelo cliente e com arte anexada vão ao ar sozinhos na hora marcada.</Typography>
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
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2.5, maxWidth: "70ch" }}>
            Publicar exige que o post esteja <strong>aprovado pelo cliente</strong> e tenha a <strong>arte anexada</strong>.
            O Instagram precisa ser uma conta profissional ligada a uma página do Facebook.
          </Typography>
        </>
      )}

      {/* ===================== PAGAMENTOS (Asaas) ===================== */}
      {tab === "pagamentos" && (
        <>
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
                  <TextField select size="small" label="Ambiente" value={asaasEnv} onChange={(e) => setAsaasEnv(e.target.value)} sx={{ minWidth: 150 }}>
                    <MenuItem value="production">Produção</MenuItem>
                    <MenuItem value="sandbox">Teste (sandbox)</MenuItem>
                  </TextField>
                  <TextField size="small" type="password" value={asaasKey} onChange={(e) => setAsaasKey(e.target.value)} sx={{ flex: 1 }}
                    label={billing?.configured ? "Nova chave (vazio = manter)" : "Chave de API do Asaas"} placeholder="$aact_..." />
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
                    <Button color="error" variant="outlined" startIcon={<LinkOffIcon />} onClick={() => cancelarAssinatura(c)}>Cancelar</Button>
                  ) : (
                    <Button variant="contained" disabled={!billing?.configured || !c.valor} onClick={() => assinar(c)}>Ativar cobrança</Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, maxWidth: "70ch" }}>
            Ao ativar, geramos um link seguro do Asaas para o cliente cadastrar o cartão uma vez.
            Depois, todo mês o Asaas cobra sozinho e o pagamento aparece aqui como confirmado.
          </Typography>
          {/* Formas de pagamento oferecidas ao cliente */}
          {isAdmin && payCfg && (
            <Card sx={{ mt: 3 }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 0.5 }}>Formas de pagamento na área do cliente</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Escolha quais formas o cliente pode usar. Ele decide na hora de pagar.
                </Typography>
                {payMsg && <Alert severity="success" sx={{ mb: 2 }}>{payMsg}</Alert>}

                <Stack spacing={1.5}>
                  <FormControlLabel
                    control={<Switch checked={!!payCfg.asaas?.enabled} onChange={(e) => setPay("asaas", { enabled: e.target.checked })} />}
                    label="Asaas (cartão / PIX / boleto — cobrança automática)" />

                  <Box>
                    <FormControlLabel
                      control={<Switch checked={!!payCfg.mercadopago?.enabled} onChange={(e) => setPay("mercadopago", { enabled: e.target.checked })} />}
                      label="Mercado Pago" />
                    {payCfg.mercadopago?.enabled && (
                      <TextField size="small" fullWidth sx={{ mt: 0.5 }} label="Link de pagamento do Mercado Pago"
                        placeholder="https://mpago.la/..." value={payCfg.mercadopago?.link || ""}
                        onChange={(e) => setPay("mercadopago", { link: e.target.value })} />
                    )}
                  </Box>

                  <Box>
                    <FormControlLabel
                      control={<Switch checked={!!payCfg.infinitepay?.enabled} onChange={(e) => setPay("infinitepay", { enabled: e.target.checked })} />}
                      label="Infinite Pay" />
                    {payCfg.infinitepay?.enabled && (
                      <TextField size="small" fullWidth sx={{ mt: 0.5 }} label="Link de pagamento do Infinite Pay"
                        placeholder="https://invoice.infinitepay.io/..." value={payCfg.infinitepay?.link || ""}
                        onChange={(e) => setPay("infinitepay", { link: e.target.value })} />
                    )}
                  </Box>

                  <FormControlLabel
                    control={<Switch checked={payCfg.pass_interest !== false} onChange={(e) => setPayCfg((c) => ({ ...c, pass_interest: e.target.checked }))} />}
                    label="Juro do parcelamento por conta do cliente" />

                  <Box><Button variant="contained" onClick={salvarPayCfg}>Salvar formas de pagamento</Button></Box>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
                  Por enquanto, Mercado Pago e Infinite Pay abrem o seu link de cobrança (o cliente informa o valor).
                  A cobrança automática por valor de cada mês precisa das chaves de API — a gente liga depois.
                </Typography>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ===================== DOCUMENTOS (Google Docs) ===================== */}
      {tab === "documentos" && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: "70ch" }}>
            Cole o link de um <strong>Google Docs / Planilhas / Apresentações</strong> (ou qualquer link) para abrir
            aqui dentro do sistema. Dica: no Google, use "Compartilhar" e deixe como "qualquer pessoa com o link".
          </Typography>

          {isAdmin && (
            <Card sx={{ mb: 2.5 }}>
              <CardContent>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "flex-start" }}>
                  <TextField size="small" label="Nome do documento" value={novoDoc.title}
                    onChange={(e) => setNovoDoc((d) => ({ ...d, title: e.target.value }))} sx={{ minWidth: 180 }} />
                  <TextField size="small" label="Link (URL)" value={novoDoc.url} sx={{ flex: 1, minWidth: 200 }}
                    onChange={(e) => setNovoDoc((d) => ({ ...d, url: e.target.value }))} placeholder="https://docs.google.com/..." />
                  <TextField select size="small" label="Empresa" value={novoDoc.client_id} sx={{ minWidth: 150 }}
                    onChange={(e) => setNovoDoc((d) => ({ ...d, client_id: e.target.value }))}>
                    <MenuItem value="">Geral</MenuItem>
                    {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                  </TextField>
                  <Button variant="contained" startIcon={<AddIcon />} onClick={addDoc} disabled={!novoDoc.title || !novoDoc.url}>
                    Adicionar
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          )}

          <Stack spacing={1.5}>
            {docs.map((d) => (
              <Card key={d.id}>
                <CardContent sx={{ py: 1.5 }}>
                  <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1 }}>
                    <ArticleIcon color="primary" />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600 }} noWrap>{d.title}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                        {d.client_name ? `${d.client_name} · ` : ""}{d.url}
                      </Typography>
                    </Box>
                    <Button size="small" onClick={() => setAbrindo(abrindo?.id === d.id ? null : d)}>
                      {abrindo?.id === d.id ? "Fechar" : "Abrir aqui"}
                    </Button>
                    <Button size="small" startIcon={<OpenInNewIcon />} component={Link} href={d.url} target="_blank" rel="noopener">
                      Nova aba
                    </Button>
                    {isAdmin && (
                      <IconButton size="small" color="error" onClick={() => removeDoc(d.id)}><DeleteIcon fontSize="small" /></IconButton>
                    )}
                  </Stack>
                  {abrindo?.id === d.id && (
                    <Box sx={{ mt: 1.5, borderRadius: 2, overflow: "hidden", border: 1, borderColor: "divider" }}>
                      <Box component="iframe" src={toPreview(d.url)} title={d.title}
                        sx={{ width: "100%", height: "70vh", border: 0, display: "block" }} />
                    </Box>
                  )}
                </CardContent>
              </Card>
            ))}
            {docs.length === 0 && (
              <Card><CardContent sx={{ textAlign: "center", py: 5 }}>
                <Typography color="text.secondary">Nenhum documento ainda. Cole um link acima.</Typography>
              </CardContent></Card>
            )}
          </Stack>
        </>
      )}
    </>
  );
}
