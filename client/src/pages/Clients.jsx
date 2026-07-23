import { useEffect, useState } from "react";
import {
  Button, Card, Table, TableBody, TableCell, TableHead, TableRow, IconButton,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack,
  MenuItem, Link, Tooltip, Divider, Autocomplete, Box, Typography,
  FormControlLabel, Switch, Alert,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import DriveIcon from "@mui/icons-material/AddToDrive";
import DescriptionIcon from "@mui/icons-material/Description";
import VisibilityIcon from "@mui/icons-material/Visibility";
import PrintIcon from "@mui/icons-material/Print";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import api from "../api/client.js";
import { PageHeader, EmptyState, TableSkeleton } from "../components/ui.jsx";
import { currency, formatDate } from "../utils.js";

const EMPTY = {
  name: "", company: "", email: "", phone: "", drive_url: "", status: "active", notes: "",
  segment: "", address: "", work_start: "", work_end: "", payment_day: "",
  posts_per_month: "", videos_per_month: "",
  services: [], generate_contract: false,
};

export default function Clients() {
  const [rows, setRows] = useState([]);
  const [allServices, setAllServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  // Contratos do cliente (tudo pela ficha, sem aba separada).
  const [contratos, setContratos] = useState(null); // { client, lista: [] }
  const [ver, setVer] = useState(null);   // contrato em visualização
  const [link, setLink] = useState(null); // { url }
  const [copiado, setCopiado] = useState(false);
  const [contratoMsg, setContratoMsg] = useState("");

  async function abrirContratos(client) {
    const { data } = await api.get(`/clients/${client.id}/contracts`);
    setContratos({ client, lista: data });
    setContratoMsg("");
  }
  async function recarregarContratos() {
    const { data } = await api.get(`/clients/${contratos.client.id}/contracts`);
    setContratos((c) => ({ ...c, lista: data }));
  }
  async function gerarContrato() {
    try {
      await api.post(`/clients/${contratos.client.id}/generate-contract`);
      await recarregarContratos();
      setContratoMsg("Contrato gerado a partir dos serviços. Veja abaixo e mande para assinatura.");
    } catch (err) {
      setContratoMsg(err.response?.data?.error || "Não foi possível gerar o contrato.");
    }
  }
  async function gerarLink(c) {
    const { data } = await api.post(`/clients/${contratos.client.id}/contracts/${c.id}/sign-link`);
    setLink(data);
  }
  // Impressão limpa (o "Salvar como PDF" do navegador gera o arquivo).
  function imprimir(c) {
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    const assinatura = c.signed_at
      ? `<div style="margin-top:40px;padding-top:16px;border-top:1px solid #ccc;font-size:13px;color:#555">
           Assinado eletronicamente por <b>${c.signer_name || ""}</b>${c.signer_document ? " (" + c.signer_document + ")" : ""}
           em ${new Date(c.signed_at.replace(" ", "T") + "Z").toLocaleString("pt-BR")}.
         </div>`
      : "";
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${c.title}</title>
      <style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;padding:0 24px;color:#1a1a1a;line-height:1.7}
      h1{font-size:20px;border-bottom:2px solid #EA580C;padding-bottom:8px}
      pre{white-space:pre-wrap;font-family:inherit;font-size:14.5px}</style></head>
      <body><h1>${c.title}</h1><pre>${(c.notes || "").replace(/</g, "&lt;")}</pre>${assinatura}
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }

  const filtrados = rows.filter((c) => {
    if (filtroStatus && c.status !== filtroStatus) return false;
    if (busca) {
      const alvo = `${c.name} ${c.company || ""} ${c.segment || ""}`.toLowerCase();
      if (!alvo.includes(busca.toLowerCase())) return false;
    }
    return true;
  });

  const load = () => api.get("/clients").then((r) => { setRows(r.data); setLoading(false); });
  useEffect(() => {
    load();
    api.get("/services").then((r) => setAllServices(r.data)).catch(() => {});
  }, []);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  function openNew() { setDraft(EMPTY); setOpen(true); }
  function openEdit(row) {
    setDraft({
      ...EMPTY,
      ...row,
      payment_day: row.payment_day || "",
      posts_per_month: row.posts_per_month || "",
      videos_per_month: row.videos_per_month || "",
      services: row.services || [],
      generate_contract: false,
      portal_password: "",
    });
    setOpen(true);
  }

  // Lê o schema de itens de um serviço (pode vir string do banco ou já array).
  const itemsDo = (svc) => {
    if (!svc) return [];
    const raw = svc.items_schema;
    if (Array.isArray(raw)) return raw;
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
  };

  // Seleção de serviços: preenche o valor padrão; o preço é editável por cliente.
  function setServices(selected) {
    setDraft((d) => ({
      ...d,
      services: selected.map((s) => {
        const existing = d.services.find((x) => x.service_id === (s.service_id ?? s.id));
        return existing || { service_id: s.id, name: s.name, price: s.default_price, config: {} };
      }),
    }));
  }

  function setServicePrice(serviceId, price) {
    setDraft((d) => ({
      ...d,
      services: d.services.map((s) => (s.service_id === serviceId ? { ...s, price } : s)),
    }));
  }

  // Quantidade de um item (ex: "Posts no feed") daquele serviço.
  function setServiceItem(serviceId, label, qtd) {
    setDraft((d) => ({
      ...d,
      services: d.services.map((s) =>
        s.service_id === serviceId
          ? { ...s, config: { ...(s.config || {}), [label]: qtd } }
          : s
      ),
    }));
  }

  const total = draft.services.reduce((sum, s) => sum + (Number(s.price) || 0), 0);

  async function save() {
    const payload = { ...draft, payment_day: draft.payment_day || null };
    if (draft.id) await api.put(`/clients/${draft.id}`, payload);
    else await api.post("/clients", payload);
    setOpen(false);
    load();
  }

  async function remove(id) {
    if (!confirm("Excluir cliente?")) return;
    await api.delete(`/clients/${id}`);
    load();
  }

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Acompanhe o progresso por cliente e projeto"
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>Novo cliente</Button>}
      />

      {!loading && rows.length > 0 && (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 2.5 }}>
          <TextField size="small" placeholder="Buscar por nome, empresa ou segmento…"
            value={busca} onChange={(e) => setBusca(e.target.value)} sx={{ flex: 1, minWidth: 240 }} />
          <TextField select size="small" label="Status" value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="">Todos</MenuItem>
            <MenuItem value="active">Ativos</MenuItem>
            <MenuItem value="inactive">Inativos</MenuItem>
          </TextField>
        </Stack>
      )}

      {loading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : rows.length === 0 ? (
        <EmptyState message="Nenhum cliente cadastrado." action={<Button onClick={openNew}>Adicionar</Button>} />
      ) : filtrados.length === 0 ? (
        <EmptyState message="Nenhum cliente encontrado com esse filtro." />
      ) : (
        <Card>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Cliente</TableCell>
                <TableCell>Segmento</TableCell>
                <TableCell>Serviços</TableCell>
                <TableCell>Contrato</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtrados.map((c) => (
                <TableRow key={c.id} hover>
                  <TableCell>
                    <strong>{c.name}</strong>
                    {c.company && <div style={{ fontSize: 12, color: "#888" }}>{c.company}</div>}
                  </TableCell>
                  <TableCell>{c.segment || "—"}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
                      {(c.services || []).map((s) => (
                        <Tooltip key={s.service_id} title={currency(s.price)}>
                          <Chip size="small" variant="outlined" label={s.name} />
                        </Tooltip>
                      ))}
                      {(c.services || []).length === 0 && "—"}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const valor = (c.services || []).reduce((s, x) => s + (Number(x.price) || 0), 0);
                      const encerraMesQueVem = c.work_end && (() => {
                        const fim = new Date(c.work_end + "T00:00:00");
                        const alvo = new Date(); alvo.setMonth(alvo.getMonth() + 1);
                        return fim.getFullYear() === alvo.getFullYear() && fim.getMonth() === alvo.getMonth();
                      })();
                      return (
                        <>
                          {valor > 0 && <div style={{ fontWeight: 600 }}>{currency(valor)}/mês</div>}
                          <div style={{ fontSize: 12, color: encerraMesQueVem ? "#D97706" : "#888", fontWeight: encerraMesQueVem ? 700 : 400 }}>
                            {c.work_end
                              ? `até ${formatDate(c.work_end)}${encerraMesQueVem ? " ⚠ renovar" : ""}`
                              : "prazo indeterminado"}
                          </div>
                          {c.payment_day && <div style={{ fontSize: 12, color: "#888" }}>Pgto dia {c.payment_day}</div>}
                        </>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={c.status === "active" ? "Ativo" : "Inativo"}
                      color={c.status === "active" ? "success" : "default"} />
                  </TableCell>
                  <TableCell align="right">
                    {c.drive_url && (
                      <Tooltip title="Abrir Google Drive do cliente">
                        <IconButton size="small" component={Link} href={c.drive_url} target="_blank"><DriveIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Contratos do cliente">
                      <IconButton size="small" onClick={() => abrirContratos(c)}><DescriptionIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    <IconButton size="small" onClick={() => openEdit(c)}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => remove(c.id)}><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{draft.id ? "Editar cliente" : "Novo cliente"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Nome *" value={draft.name} onChange={set("name")} fullWidth />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Empresa" value={draft.company || ""} onChange={set("company")} fullWidth />
              <TextField label="Segmento" value={draft.segment || ""} onChange={set("segment")} fullWidth
                placeholder="Ex: gastronomia, advocacia, moda..." />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="E-mail" value={draft.email || ""} onChange={set("email")} fullWidth />
              <TextField label="Telefone" value={draft.phone || ""} onChange={set("phone")} fullWidth />
            </Stack>
            <TextField label="Endereço" value={draft.address || ""} onChange={set("address")} fullWidth
              placeholder="Rua, número, bairro, cidade" />
            <TextField label="Google Drive (URL)" value={draft.drive_url || ""} onChange={set("drive_url")} fullWidth />

            <Divider>Trabalho e pagamento</Divider>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Início do trabalho" type="date" InputLabelProps={{ shrink: true }}
                value={draft.work_start || ""} onChange={set("work_start")} fullWidth />
              <TextField label="Fim (vazio = indeterminado)" type="date" InputLabelProps={{ shrink: true }}
                value={draft.work_end || ""} onChange={set("work_end")} fullWidth />
              <TextField label="Dia do pagamento" type="number" inputProps={{ min: 1, max: 31 }}
                value={draft.payment_day} onChange={set("payment_day")} sx={{ minWidth: 140 }} />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Posts por mês" type="number" inputProps={{ min: 0 }}
                value={draft.posts_per_month} onChange={set("posts_per_month")} fullWidth
                helperText="Cria o projeto base automaticamente" />
              <TextField label="Vídeos por mês" type="number" inputProps={{ min: 0 }}
                value={draft.videos_per_month} onChange={set("videos_per_month")} fullWidth
                helperText='Depois use "Lançar mês" em Projetos' />
            </Stack>

            <Divider>Serviços prestados</Divider>
            <Autocomplete
              multiple
              options={allServices}
              value={draft.services.map((s) => allServices.find((o) => o.id === s.service_id) || { id: s.service_id, name: s.name })}
              onChange={(_, v) => setServices(v)}
              getOptionLabel={(o) => o.name}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              renderInput={(params) => (
                <TextField {...params} label="Selecionar serviços"
                  helperText={allServices.length === 0 ? "Cadastre os serviços em Configurações." : "O valor padrão preenche sozinho — ajuste abaixo se quiser."} />
              )}
            />
            {draft.services.map((s) => {
              const itens = itemsDo(allServices.find((o) => o.id === s.service_id));
              return (
                <Box key={s.service_id} sx={{ p: 1.5, borderRadius: 2, border: 1, borderColor: "divider" }}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Typography sx={{ flex: 1, fontWeight: 600 }}>{s.name}</Typography>
                    <TextField label="Valor (R$/mês)" type="number" size="small" sx={{ width: 160 }}
                      value={s.price} onChange={(e) => setServicePrice(s.service_id, e.target.value)} />
                  </Stack>
                  {itens.length > 0 && (
                    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5, mt: 1.5 }}>
                      {itens.map((item) => (
                        <TextField key={item.label} size="small" type="number"
                          label={item.label} placeholder="0"
                          helperText={item.unit || " "}
                          value={s.config?.[item.label] ?? ""}
                          onChange={(e) => setServiceItem(s.service_id, item.label, e.target.value)} />
                      ))}
                    </Box>
                  )}
                </Box>
              );
            })}
            {draft.services.length > 0 && (
              <Box sx={{ textAlign: "right" }}>
                <Typography variant="subtitle2">Total: {currency(total)}/mês</Typography>
              </Box>
            )}
            <FormControlLabel
              control={<Switch checked={draft.generate_contract}
                onChange={(e) => setDraft((d) => ({ ...d, generate_contract: e.target.checked }))} />}
              label="Gerar contrato automaticamente ao salvar (usa o modelo de cada serviço)"
            />

            <Divider>Outros</Divider>
            <TextField select label="Status" value={draft.status} onChange={set("status")} fullWidth>
              <MenuItem value="active">Ativo</MenuItem>
              <MenuItem value="inactive">Inativo</MenuItem>
            </TextField>
            <TextField label="Observações" value={draft.notes || ""} onChange={set("notes")} fullWidth multiline rows={2} />

            <Divider>Acesso ao portal do cliente</Divider>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="E-mail de acesso" value={draft.portal_email || ""} onChange={set("portal_email")} fullWidth
                helperText={draft.portal_enabled ? "Acesso ativo" : "Sem acesso ainda"} />
              <TextField label={draft.portal_enabled ? "Nova senha (vazio = manter)" : "Senha do portal"}
                type="password" value={draft.portal_password || ""} onChange={set("portal_password")} fullWidth
                helperText="O cliente entra em /portal" />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={save} disabled={!draft.name}>Salvar</Button>
        </DialogActions>
      </Dialog>

      {/* Contratos do cliente */}
      <Dialog open={Boolean(contratos)} onClose={() => setContratos(null)} fullWidth maxWidth="sm">
        <DialogTitle>Contratos — {contratos?.client?.name}</DialogTitle>
        <DialogContent>
          {contratoMsg && <Alert severity="info" sx={{ mb: 2 }}>{contratoMsg}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Gere o contrato a partir dos serviços do cliente (usa o modelo de cada serviço,
            configurado em Configurações) e mande para assinatura por aqui mesmo.
          </Typography>
          <Stack spacing={1.2}>
            {(contratos?.lista || []).map((c) => (
              <Box key={c.id} sx={{ p: 1.5, borderRadius: 2, border: 1, borderColor: "divider" }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography noWrap sx={{ fontWeight: 600 }}>{c.title}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {currency(c.value)}{c.duration_months ? ` · ${c.duration_months} meses` : " · indeterminado"}
                    </Typography>
                  </Box>
                  {c.signed_at
                    ? <Chip size="small" color="success" icon={<CheckCircleIcon />} label="Assinado" />
                    : <Chip size="small" variant="outlined" label="Pendente" />}
                  <Tooltip title="Ver / imprimir">
                    <IconButton size="small" onClick={() => setVer(c)}><VisibilityIcon fontSize="small" /></IconButton>
                  </Tooltip>
                  {!c.signed_at && (
                    <Tooltip title="Link de assinatura">
                      <IconButton size="small" color="success" onClick={() => gerarLink(c)}><WhatsAppIcon fontSize="small" /></IconButton>
                    </Tooltip>
                  )}
                </Stack>
              </Box>
            ))}
            {(contratos?.lista || []).length === 0 && (
              <Typography variant="body2" color="text.secondary">Nenhum contrato ainda.</Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setContratos(null)}>Fechar</Button>
          <Button variant="contained" startIcon={<DescriptionIcon />} onClick={gerarContrato}>
            Gerar contrato dos serviços
          </Button>
        </DialogActions>
      </Dialog>

      {/* Ver contrato + imprimir */}
      <Dialog open={Boolean(ver)} onClose={() => setVer(null)} fullWidth maxWidth="md">
        <DialogTitle>{ver?.title}</DialogTitle>
        <DialogContent>
          {ver?.signed_at && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Assinado por <strong>{ver.signer_name}</strong>
              {ver.signer_document ? ` (${ver.signer_document})` : ""} em{" "}
              {new Date(ver.signed_at.replace(" ", "T") + "Z").toLocaleString("pt-BR")}.
            </Alert>
          )}
          <Box sx={{ p: 2, borderRadius: 2, bgcolor: "action.hover" }}>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", fontFamily: "Georgia, serif", lineHeight: 1.7 }}>
              {ver?.notes || "Este contrato não tem texto."}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setVer(null)}>Fechar</Button>
          <Button startIcon={<PrintIcon />} onClick={() => imprimir(ver)}>Imprimir / PDF</Button>
          {!ver?.signed_at && (
            <Button variant="contained" startIcon={<WhatsAppIcon />} onClick={() => gerarLink(ver)}>
              Link de assinatura
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Link de assinatura */}
      <Dialog open={Boolean(link)} onClose={() => setLink(null)} fullWidth maxWidth="sm">
        <DialogTitle>Link de assinatura</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Mande este link para o cliente. Ele abre, lê o contrato e assina com nome e CPF —
            sem precisar de senha. O link vale 30 dias.
          </Typography>
          <TextField value={link?.url || ""} fullWidth size="small" InputProps={{ readOnly: true }}
            onFocus={(e) => e.target.select()} sx={{ mb: 2 }} />
          <Stack direction="row" spacing={1.5}>
            <Button variant="outlined" startIcon={<ContentCopyIcon />}
              onClick={() => { navigator.clipboard.writeText(link.url); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }}>
              {copiado ? "Copiado!" : "Copiar link"}
            </Button>
            <Button variant="contained" color="success" startIcon={<WhatsAppIcon />}
              component="a" target="_blank" rel="noopener"
              href={`https://wa.me/?text=${encodeURIComponent(`Olá! Segue o contrato para assinatura: ${link?.url || ""}`)}`}>
              Abrir no WhatsApp
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLink(null)}>Fechar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
