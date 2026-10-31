// ---------------------------------------------------------------------------
// CLIENTE-HUB — abrir um cliente e ter TUDO dele num lugar só.
//
// Pedido dela: "um cadastro de cliente com várias seções em cima" — abas por
// etapa (Cadastro, Contratos, Serviços, Financeiro, Onboarding), clicar numa já
// abre a outra. O cadastro é o mesmo que vem do onboarding e que ela edita à
// mão; as alterações salvam sozinhas (ao sair de cada campo).
//
// Mesmo visual/cores/fontes do resto do Creator — só o LAYOUT é novo.
// ---------------------------------------------------------------------------
import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box, Card, CardContent, Typography, Tabs, Tab, TextField, Stack, MenuItem,
  Button, Chip, Divider, CircularProgress, Alert, FormControlLabel, Switch,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import api from "../api/client.js";
import { currency, formatDate } from "../utils.js";

// Um bloco de seção (título em cima, campos dentro) — a cara do cadastro.
function Secao({ titulo, children }) {
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: "0.06em" }}>
          {titulo}
        </Typography>
        <Stack spacing={2} sx={{ mt: 1.5 }}>{children}</Stack>
      </CardContent>
    </Card>
  );
}

export default function ClientHub() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [aba, setAba] = useState(0);
  const [cli, setCli] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [salvoEm, setSalvoEm] = useState(null);

  // dados das outras abas, carregados sob demanda
  const [contratos, setContratos] = useState(null);
  const [financeiro, setFinanceiro] = useState(null);
  const [onboardings, setOnboardings] = useState(null);
  const [projetos, setProjetos] = useState(null);
  const [persona, setPersona] = useState(null);
  const [arquivar, setArquivar] = useState(null); // { observacao, pagamento_ate }

  useEffect(() => {
    setCarregando(true);
    api.get(`/clients/${id}`)
      .then((r) => setCli(r.data))
      .catch((e) => setErro(e.response?.data?.error || "Não foi possível abrir o cliente."))
      .finally(() => setCarregando(false));
  }, [id]);

  // Edita um campo localmente (a tela responde na hora).
  const campo = (k) => (e) => setCli((c) => ({ ...c, [k]: e.target.value }));

  // Salva sozinho ao sair do campo — só manda o que mudou de verdade.
  const salvar = useCallback(async (parcial) => {
    setSalvando(true);
    try {
      const { data } = await api.put(`/clients/${id}`, parcial);
      setCli((c) => ({ ...c, ...data }));
      setSalvoEm(new Date());
    } catch (e) {
      setErro(e.response?.data?.error || "Não foi possível salvar.");
    } finally { setSalvando(false); }
  }, [id]);

  // onBlur: manda o valor atual daquele campo.
  const aoSair = (k) => () => { if (cli) salvar({ [k]: cli[k] ?? null }); };

  function abrir(indice) {
    setAba(indice);
    if (indice === 1 && !contratos) {
      api.get(`/clients/${id}/contracts`).then((r) => setContratos(r.data.lista || r.data || []))
        .catch(() => setContratos([]));
    }
    if (indice === 3 && !financeiro) {
      api.get("/financial").then((r) => setFinanceiro((r.data || []).filter((f) => String(f.client_id) === String(id))))
        .catch(() => setFinanceiro([]));
    }
    if (indice === 4 && !onboardings) {
      api.get("/briefings").then((r) => setOnboardings((r.data || []).filter((b) => String(b.client_id) === String(id))))
        .catch(() => setOnboardings([]));
    }
    if (indice === 5 && !projetos) {
      api.get("/projects").then((r) => setProjetos((r.data || []).filter((p) => String(p.client_id) === String(id))))
        .catch(() => setProjetos([]));
    }
    if (indice === 6 && !persona) {
      api.get(`/ai/persona/${id}`).then((r) => setPersona(r.data || {})).catch(() => setPersona({}));
    }
  }

  // Arquivar / reativar o cliente — o arquivar guarda o combinado e não perde nada.
  async function confirmarArquivar() {
    try {
      await api.post(`/clients/${id}/arquivar`, {
        observacao: arquivar?.observacao || null,
        pagamento_ate: arquivar?.pagamento_ate || null,
      });
      navigate("/clients");
    } catch (e) { setErro(e.response?.data?.error || "Não foi possível arquivar."); }
  }
  async function reativar() {
    try {
      await api.post(`/clients/${id}/reativar`);
      const { data } = await api.get(`/clients/${id}`);
      setCli(data);
    } catch (e) { setErro(e.response?.data?.error || "Não foi possível reativar."); }
  }

  if (carregando) {
    return <Box sx={{ display: "grid", placeItems: "center", py: 10 }}><CircularProgress /></Box>;
  }
  if (erro && !cli) {
    return (
      <Box sx={{ p: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/clients")}>Clientes</Button>
        <Alert severity="error" sx={{ mt: 2 }}>{erro}</Alert>
      </Box>
    );
  }

  const servicos = cli.services || [];

  return (
    <Box>
      {/* Cabeçalho: voltar · nome · salvar sozinho */}
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1, flexWrap: "wrap" }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate("/clients")}>Clientes</Button>
        <Typography variant="h5" sx={{ fontWeight: 800, flex: 1, minWidth: 0 }}>{cli.name}</Typography>
        {cli.status === "inactive" && <Chip size="small" label="Inativo" />}
        <Typography variant="caption" color="text.secondary">
          {salvando ? "Salvando…" : salvoEm ? "Alterações salvas" : "As alterações salvam sozinhas"}
        </Typography>
        {cli.archived_at
          ? <Button size="small" variant="outlined" onClick={reativar}>Reativar</Button>
          : <Button size="small" variant="outlined" color="error" startIcon={<Inventory2Icon />}
              onClick={() => setArquivar({ observacao: "", pagamento_ate: "" })}>Arquivar</Button>}
      </Stack>

      <Tabs value={aba} onChange={(_, v) => abrir(v)} variant="scrollable" scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
        <Tab label="Cadastro" />
        <Tab label="Contratos" />
        <Tab label="Serviços" />
        <Tab label="Financeiro" />
        <Tab label="Onboarding" />
        <Tab label="Projetos" />
        <Tab label="Inteligência" />
      </Tabs>

      {erro && cli && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErro("")}>{erro}</Alert>}

      {/* ---- CADASTRO ---- */}
      {aba === 0 && (
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr", lg: "1fr 1fr 1fr" } }}>
          <Secao titulo="Dados principais">
            <TextField label="Nome do cliente" value={cli.name || ""} onChange={campo("name")} onBlur={aoSair("name")} fullWidth size="small" />
            <TextField label="Nome fantasia / empresa" value={cli.company || ""} onChange={campo("company")} onBlur={aoSair("company")} fullWidth size="small" />
            <TextField label="Segmento" value={cli.segment || ""} onChange={campo("segment")} onBlur={aoSair("segment")} fullWidth size="small" />
            <TextField label="CNPJ / CPF" value={cli.document || ""} onChange={campo("document")} onBlur={aoSair("document")} fullWidth size="small" />
            <TextField label="Razão social" value={cli.legal_name || ""} onChange={campo("legal_name")} onBlur={aoSair("legal_name")} fullWidth size="small" />
          </Secao>

          <Secao titulo="Contato">
            <TextField label="E-mail" value={cli.email || ""} onChange={campo("email")} onBlur={aoSair("email")} fullWidth size="small" />
            <TextField label="Celular / WhatsApp" value={cli.phone || ""} onChange={campo("phone")} onBlur={aoSair("phone")} fullWidth size="small" />
            <TextField label="Endereço" value={cli.address || ""} onChange={campo("address")} onBlur={aoSair("address")} fullWidth size="small" multiline minRows={2} />
          </Secao>

          <Secao titulo="Quem assina o contrato">
            <TextField label="Nome de quem assina" value={cli.rep_name || ""} onChange={campo("rep_name")} onBlur={aoSair("rep_name")} fullWidth size="small" />
            <TextField select label="Tipo do documento" value={cli.rep_doc_type || "cpf"} onChange={(e) => { setCli((c) => ({ ...c, rep_doc_type: e.target.value })); salvar({ rep_doc_type: e.target.value }); }} fullWidth size="small">
              <MenuItem value="cpf">CPF</MenuItem>
              <MenuItem value="oab">OAB</MenuItem>
            </TextField>
            <TextField label="Número do documento" value={cli.rep_document || ""} onChange={campo("rep_document")} onBlur={aoSair("rep_document")} fullWidth size="small" />
          </Secao>

          <Secao titulo="Contrato & cobrança">
            <TextField label="Começo" type="date" value={cli.work_start || ""} onChange={campo("work_start")} onBlur={aoSair("work_start")} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <TextField label="Fim (vazio = indeterminado)" type="date" value={cli.work_end || ""} onChange={campo("work_end")} onBlur={aoSair("work_end")} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <TextField label="Dia do pagamento" type="number" value={cli.payment_day || ""} onChange={campo("payment_day")} onBlur={aoSair("payment_day")} fullWidth size="small" />
            <TextField label="Pasta de arquivos (Drive)" value={cli.drive_url || ""} onChange={campo("drive_url")} onBlur={aoSair("drive_url")} fullWidth size="small" />
          </Secao>

          <Secao titulo="Acesso ao portal do cliente">
            <Typography variant="caption" color={cli.portal_enabled ? "success.main" : "text.secondary"}>
              {cli.portal_enabled ? "✅ Acesso ativo" : "Sem acesso — preencha um nome de acesso e uma senha."}
            </Typography>
            <TextField label="Nome de acesso" value={cli.portal_username || ""} onChange={campo("portal_username")} onBlur={aoSair("portal_username")} fullWidth size="small" />
            <TextField label="E-mail de acesso" value={cli.portal_email || ""} onChange={campo("portal_email")} onBlur={aoSair("portal_email")} fullWidth size="small" />
            <TextField label="Nova senha (deixe em branco para manter)" type="password" value={cli.portal_password || ""}
              onChange={campo("portal_password")} onBlur={() => { if (cli.portal_password) salvar({ portal_password: cli.portal_password }).then(() => setCli((c) => ({ ...c, portal_password: "" }))); }}
              fullWidth size="small" />
          </Secao>

          <Secao titulo="Observações">
            <TextField label="Anotações internas" value={cli.notes || ""} onChange={campo("notes")} onBlur={aoSair("notes")} fullWidth size="small" multiline minRows={6} />
          </Secao>
        </Box>
      )}

      {/* ---- CONTRATOS ---- */}
      {aba === 1 && (
        <Card variant="outlined"><CardContent>
          {!contratos ? <CircularProgress size={22} />
            : contratos.length === 0 ? <Typography color="text.secondary">Nenhum contrato ainda.</Typography>
            : (
              <Stack divider={<Divider />} spacing={1}>
                {contratos.map((c) => (
                  <Stack key={c.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5, flexWrap: "wrap" }}>
                    <Typography sx={{ fontWeight: 600, flex: 1, minWidth: 160 }}>{c.title}</Typography>
                    {c.value ? <Typography variant="body2" color="text.secondary">{currency(c.value)}</Typography> : null}
                    {c.signed_at
                      ? <Chip size="small" color="success" label="Assinado" />
                      : <Chip size="small" variant="outlined" label="Pendente" />}
                  </Stack>
                ))}
              </Stack>
            )}
          <Button sx={{ mt: 2 }} onClick={() => navigate("/contracts")}>Abrir em Contratos</Button>
        </CardContent></Card>
      )}

      {/* ---- SERVIÇOS ---- */}
      {aba === 2 && (
        <Card variant="outlined"><CardContent>
          {servicos.length === 0 ? <Typography color="text.secondary">Nenhum serviço contratado.</Typography>
            : (
              <Stack divider={<Divider />} spacing={1}>
                {servicos.map((s) => (
                  <Stack key={s.service_id || s.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5 }}>
                    <Typography sx={{ fontWeight: 600, flex: 1 }}>{s.name}</Typography>
                    <Chip size="small" label={s.billing === "avulso" ? "Avulso" : "Mensal"} />
                    <Typography variant="body2" color="text.secondary">{currency(s.price)}</Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          <Button sx={{ mt: 2 }} onClick={() => navigate("/services")}>Gerenciar serviços</Button>
        </CardContent></Card>
      )}

      {/* ---- FINANCEIRO ---- */}
      {aba === 3 && (
        <Card variant="outlined"><CardContent>
          {!financeiro ? <CircularProgress size={22} />
            : financeiro.length === 0 ? <Typography color="text.secondary">Nada no financeiro deste cliente ainda.</Typography>
            : (() => {
                const pago = financeiro.filter((f) => f.status === "paid");
                const total = pago.reduce((s, f) => s + (Number(f.amount) || 0), 0);
                return (
                  <>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      Já pago: <b>{currency(total)}</b> · {pago.length} cobrança(s)
                    </Typography>
                    <Stack divider={<Divider />} spacing={1}>
                      {financeiro.map((f) => (
                        <Stack key={f.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5, flexWrap: "wrap" }}>
                          <Typography sx={{ flex: 1, minWidth: 160 }}>{f.description}</Typography>
                          <Typography variant="body2" color="text.secondary">{f.due_date ? formatDate(f.due_date) : ""}</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{currency(f.amount)}</Typography>
                          <Chip size="small" color={f.status === "paid" ? "success" : "warning"}
                            label={f.status === "paid" ? "Pago" : "Pendente"} />
                        </Stack>
                      ))}
                    </Stack>
                  </>
                );
              })()}
          <Button sx={{ mt: 2 }} onClick={() => navigate("/financial")}>Abrir no Financeiro</Button>
        </CardContent></Card>
      )}

      {/* ---- ONBOARDING ---- */}
      {aba === 4 && (
        <Card variant="outlined"><CardContent>
          {!onboardings ? <CircularProgress size={22} />
            : onboardings.length === 0 ? <Typography color="text.secondary">Nenhum onboarding para este cliente.</Typography>
            : (
              <Stack divider={<Divider />} spacing={1}>
                {onboardings.map((b) => (
                  <Stack key={b.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5, flexWrap: "wrap" }}>
                    <Typography sx={{ flex: 1, minWidth: 160 }}>{b.servico || "Onboarding"}</Typography>
                    <Chip size="small" color={b.status === "aplicado" ? "success" : b.status === "respondido" ? "info" : "default"}
                      label={b.status || "aberto"} />
                  </Stack>
                ))}
              </Stack>
            )}
          <Button sx={{ mt: 2 }} onClick={() => navigate("/onboarding")}>Abrir em Onboarding</Button>
        </CardContent></Card>
      )}

      {/* ---- PROJETOS ---- */}
      {aba === 5 && (
        <Card variant="outlined"><CardContent>
          {!projetos ? <CircularProgress size={22} />
            : projetos.length === 0 ? <Typography color="text.secondary">Nenhum projeto deste cliente.</Typography>
            : (
              <Stack divider={<Divider />} spacing={1}>
                {projetos.map((p) => (
                  <Stack key={p.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5, flexWrap: "wrap" }}>
                    <Typography sx={{ fontWeight: 600, flex: 1, minWidth: 160 }}>{p.name}</Typography>
                    {p.status && <Chip size="small" label={p.status} />}
                  </Stack>
                ))}
              </Stack>
            )}
          <Button sx={{ mt: 2 }} onClick={() => navigate("/projects")}>Abrir em Projetos</Button>
        </CardContent></Card>
      )}

      {/* ---- INTELIGÊNCIA ---- */}
      {aba === 6 && (
        <Card variant="outlined"><CardContent>
          {!persona ? <CircularProgress size={22} />
            : (() => {
                const campos = Object.entries(persona).filter(([, v]) => String(v || "").trim());
                return campos.length === 0
                  ? <Typography color="text.secondary">A IA ainda não sabe nada deste cliente. Aplique um onboarding ou preencha em Inteligência.</Typography>
                  : (
                    <Stack spacing={1.25}>
                      <Typography variant="body2" color="text.secondary">{campos.length} campo(s) preenchido(s).</Typography>
                      {campos.map(([k, v]) => (
                        <Box key={k}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>{k}</Typography>
                          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{String(v)}</Typography>
                        </Box>
                      ))}
                    </Stack>
                  );
              })()}
          <Button sx={{ mt: 2 }} onClick={() => navigate("/intelligence")}>Editar em Inteligência</Button>
        </CardContent></Card>
      )}

      {/* ---- Arquivar ---- */}
      <Dialog open={Boolean(arquivar)} onClose={() => setArquivar(null)} fullWidth maxWidth="xs">
        <DialogTitle>Arquivar cliente</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Nada é apagado — ele sai do dia a dia e vai para "Inativos". Dá para reativar depois.
          </Typography>
          <Stack spacing={2}>
            <TextField label="Até quando ele ainda paga (opcional)" type="month" InputLabelProps={{ shrink: true }}
              value={arquivar?.pagamento_ate || ""} onChange={(e) => setArquivar((a) => ({ ...a, pagamento_ate: e.target.value }))} fullWidth size="small" />
            <TextField label="Observação (opcional)" value={arquivar?.observacao || ""}
              onChange={(e) => setArquivar((a) => ({ ...a, observacao: e.target.value }))} fullWidth size="small" multiline minRows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setArquivar(null)}>Cancelar</Button>
          <Button color="error" variant="contained" onClick={confirmarArquivar}>Arquivar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
