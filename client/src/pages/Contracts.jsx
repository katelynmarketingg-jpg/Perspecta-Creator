import { useEffect, useState } from "react";
import {
  Button, Card, Table, TableBody, TableCell, TableHead, TableRow, IconButton, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, MenuItem,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import ArticleIcon from "@mui/icons-material/Article";
import PostAddIcon from "@mui/icons-material/PostAdd";
import VisibilityIcon from "@mui/icons-material/Visibility";
import PrintIcon from "@mui/icons-material/Print";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { Box, Typography, Tooltip, Alert } from "@mui/material";
import api from "../api/client.js";
import { useLiveVersion } from "../live/LiveContext.jsx";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { currency, formatDate } from "../utils.js";

const EMPTY = { title: "", client_id: "", value: "", duration_months: "", start_date: "", first_due_date: "", status: "active", notes: "" };

export default function Contracts() {
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [ver, setVer] = useState(null); // contrato em visualização
  const [busca, setBusca] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("");
  const [link, setLink] = useState(null); // { url }
  const [copiado, setCopiado] = useState(false);
  // Modelos de contrato
  const [templates, setTemplates] = useState([]);
  const [services, setServices] = useState([]);
  const [tplManage, setTplManage] = useState(false);       // diálogo de gerenciar modelos
  const [tplDraft, setTplDraft] = useState(null);          // { id?, name, body }
  const [gen, setGen] = useState(null);                    // { template_id, client_id, value, duration_months, start_date }
  const [genMsg, setGenMsg] = useState("");

  const loadTemplates = () => api.get("/contract-templates").then((r) => setTemplates(r.data)).catch(() => {});

  async function salvarModelo() {
    if (!tplDraft?.name?.trim()) return;
    if (tplDraft.id) await api.put(`/contract-templates/${tplDraft.id}`, tplDraft);
    else await api.post("/contract-templates", tplDraft);
    setTplDraft(null);
    loadTemplates();
  }
  async function removerModelo(id) {
    if (!confirm("Excluir este modelo?")) return;
    await api.delete(`/contract-templates/${id}`);
    loadTemplates();
  }
  async function gerarDeModelo() {
    try {
      const { data } = await api.post(`/contract-templates/${gen.template_id}/generate`, {
        client_id: gen.client_id,
        value: Number(gen.value) || 0,
        duration_months: gen.duration_months ? Number(gen.duration_months) : null,
        start_date: gen.start_date || null,
      });
      setGen(null);
      load();
      setVer(data); // abre o contrato gerado para conferir e mandar assinar
    } catch (e) {
      setGenMsg(e.response?.data?.error || "Não foi possível gerar o contrato.");
    }
  }

  async function gerarLink(c) {
    const { data } = await api.post(`/contracts/${c.id}/sign-link`);
    setLink(data);
  }

  const load = () => api.get("/contracts").then((r) => setRows(r.data));
  useEffect(() => {
    load(); loadTemplates();
    api.get("/clients").then((r) => setClients(r.data));
    api.get("/services").then((r) => setServices(r.data)).catch(() => {});
  }, []);

  // Ao vivo: recarrega quando alguém mexe nos contratos.
  const vContracts = useLiveVersion("contracts");
  useEffect(() => { if (vContracts) load(); }, [vContracts]);

  const filtrados = rows.filter((c) => {
    if (filtroCliente && String(c.client_id) !== String(filtroCliente)) return false;
    if (busca && !`${c.title} ${c.client_name || ""}`.toLowerCase().includes(busca.toLowerCase())) return false;
    return true;
  });

  // Imprimir = janela limpa com o texto; o próprio "Salvar como PDF" do
  // navegador gera o arquivo. Não precisa de biblioteca nenhuma.
  function imprimir(c) {
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    const assinatura = c.signed_at
      ? `<div style="margin-top:40px;padding-top:16px;border-top:1px solid #ccc;font-size:13px;color:#555">
           ${c.signature_img ? `<img src="${c.signature_img}" style="max-height:80px;display:block;margin-bottom:8px" />` : ""}
           Assinado eletronicamente por <b>${c.signer_name || ""}</b>${c.signer_document ? " (" + c.signer_document + ")" : ""}
           em ${new Date(c.signed_at.replace(" ", "T") + "Z").toLocaleString("pt-BR")}${c.signer_ip ? " · IP " + c.signer_ip : ""}.
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

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  async function save() {
    const payload = {
      ...draft,
      value: Number(draft.value) || 0,
      client_id: draft.client_id || null,
      duration_months: draft.duration_months ? Number(draft.duration_months) : null,
    };
    if (draft.id) await api.put(`/contracts/${draft.id}`, payload);
    else await api.post("/contracts", payload);
    setOpen(false);
    load();
  }
  async function remove(id) {
    if (!confirm("Excluir contrato?")) return;
    await api.delete(`/contracts/${id}`);
    load();
  }

  return (
    <>
      <PageHeader
        title="Contratos"
        subtitle="Contratos com prazo definido ou indeterminado"
        action={
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            <Button variant="outlined" startIcon={<ArticleIcon />} onClick={() => { setTplManage(true); setTplDraft(null); }}>Modelos</Button>
            <Button variant="outlined" startIcon={<PostAddIcon />} disabled={templates.length === 0}
              onClick={() => { setGenMsg(""); setGen({ template_id: templates[0]?.id || "", client_id: "", value: "", duration_months: "", start_date: "" }); }}>
              Gerar de modelo
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setDraft(EMPTY); setOpen(true); }}>Novo contrato</Button>
          </Stack>
        }
      />

      {rows.length > 0 && (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 2.5 }}>
          <TextField size="small" placeholder="Buscar por título ou cliente…"
            value={busca} onChange={(e) => setBusca(e.target.value)} sx={{ flex: 1, minWidth: 220 }} />
          <TextField select size="small" label="Cliente" value={filtroCliente}
            onChange={(e) => setFiltroCliente(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">Todos</MenuItem>
            {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
        </Stack>
      )}

      {rows.length === 0 ? <EmptyState message="Nenhum contrato cadastrado." /> :
       filtrados.length === 0 ? <EmptyState message="Nenhum contrato com esse filtro." /> : (
        <Card>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Contrato</TableCell>
                <TableCell>Cliente</TableCell>
                <TableCell>Duração</TableCell>
                <TableCell>1º vencimento</TableCell>
                <TableCell>Assinatura</TableCell>
                <TableCell align="right">Valor</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtrados.map((c) => (
                <TableRow key={c.id} hover>
                  <TableCell>{c.title}</TableCell>
                  <TableCell>{c.client_name || "—"}</TableCell>
                  <TableCell>{c.duration_months ? `${c.duration_months} meses` : <Chip size="small" label="Indeterminado" />}</TableCell>
                  <TableCell>{formatDate(c.first_due_date)}</TableCell>
                  <TableCell>
                    {c.signed_at
                      ? <Chip size="small" color="success" icon={<CheckCircleIcon />} label="Assinado" />
                      : <Chip size="small" variant="outlined" label="Pendente" />}
                  </TableCell>
                  <TableCell align="right">{currency(c.value)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Ver / imprimir">
                      <IconButton size="small" onClick={() => setVer(c)}><VisibilityIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    <IconButton size="small" onClick={() => { setDraft({ ...c, client_id: c.client_id || "" }); setOpen(true); }}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => remove(c.id)}><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Ver contrato completo + imprimir */}
      <Dialog open={Boolean(ver)} onClose={() => setVer(null)} fullWidth maxWidth="md">
        <DialogTitle>{ver?.title}</DialogTitle>
        <DialogContent>
          {ver?.signed_at && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Assinado por <strong>{ver.signer_name}</strong>
              {ver.signer_document ? ` (${ver.signer_document})` : ""} em{" "}
              {new Date(ver.signed_at.replace(" ", "T") + "Z").toLocaleString("pt-BR")}
              {ver.signer_ip ? ` · IP ${ver.signer_ip}` : ""}.
              {ver.signature_img && (
                <Box component="img" src={ver.signature_img} alt="assinatura"
                  sx={{ display: "block", mt: 1, maxHeight: 70, bgcolor: "#fff", borderRadius: 1, p: 0.5 }} />
              )}
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
          <Button startIcon={<PrintIcon />} onClick={() => imprimir(ver)}>
            Imprimir / PDF
          </Button>
          {!ver?.signed_at && (
            <Button variant="contained" startIcon={<WhatsAppIcon />} onClick={() => gerarLink(ver)}>
              Link de assinatura
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Link de assinatura gerado */}
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

      {/* Gerenciar modelos de contrato */}
      <Dialog open={tplManage} onClose={() => { setTplManage(false); setTplDraft(null); }} fullWidth maxWidth="md">
        <DialogTitle>Modelos de contrato</DialogTitle>
        <DialogContent>
          {!tplDraft ? (
            <>
              <Button variant="contained" startIcon={<AddIcon />} sx={{ mb: 2 }}
                onClick={() => setTplDraft({ name: "", body: "" })}>Novo modelo</Button>
              {templates.length === 0 ? (
                <Typography color="text.secondary">Nenhum modelo ainda. Crie um para gerar contratos rapidinho.</Typography>
              ) : (
                <Stack spacing={1}>
                  {templates.map((t) => (
                    <Stack key={t.id} direction="row" alignItems="center" spacing={1}
                      sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, px: 1.5, py: 1 }}>
                      <ArticleIcon color="primary" />
                      <Typography sx={{ flex: 1, fontWeight: 600 }} noWrap>{t.name}</Typography>
                      {t.service_id && (
                        <Chip size="small" variant="outlined" label={services.find((s) => String(s.id) === String(t.service_id))?.name || "serviço"} />
                      )}
                      <IconButton size="small" onClick={() => setTplDraft({ ...t })}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => removerModelo(t.id)}><DeleteIcon fontSize="small" /></IconButton>
                    </Stack>
                  ))}
                </Stack>
              )}
            </>
          ) : (
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <TextField label="Nome do modelo *" value={tplDraft.name} autoFocus fullWidth
                onChange={(e) => setTplDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Ex: Contrato de Social Media" />
              <TextField select label="Serviço vinculado (opcional)" value={tplDraft.service_id || ""} fullWidth
                onChange={(e) => setTplDraft((d) => ({ ...d, service_id: e.target.value }))}
                helperText="Liga este modelo a um serviço, para puxar o contrato certo ao fechar aquele serviço.">
                <MenuItem value="">Sem vínculo (genérico)</MenuItem>
                {services.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
              </TextField>
              <Alert severity="info" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
                Use marcadores que o sistema troca sozinho ao gerar:
                <Box sx={{ mt: 0.5, fontFamily: "monospace", fontSize: 13 }}>
                  {"{{cliente}} {{empresa}} {{email}} {{telefone}} {{segmento}} {{endereco}} {{valor}} {{duracao}} {{data}}"}
                </Box>
              </Alert>
              <TextField label="Texto do contrato" value={tplDraft.body} fullWidth multiline minRows={12}
                onChange={(e) => setTplDraft((d) => ({ ...d, body: e.target.value }))}
                placeholder={"CONTRATO DE PRESTAÇÃO DE SERVIÇOS\n\nContratante: {{cliente}} ({{empresa}})...\nValor: {{valor}} — {{duracao}}.\n\n{{data}}."} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {tplDraft ? (
            <>
              <Button onClick={() => setTplDraft(null)}>Voltar</Button>
              <Button variant="contained" onClick={salvarModelo} disabled={!tplDraft.name.trim()}>Salvar modelo</Button>
            </>
          ) : (
            <Button onClick={() => setTplManage(false)}>Fechar</Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Gerar contrato a partir de um modelo */}
      <Dialog open={Boolean(gen)} onClose={() => setGen(null)} fullWidth maxWidth="sm">
        <DialogTitle>Gerar contrato de um modelo</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {genMsg && <Alert severity="error">{genMsg}</Alert>}
            <TextField select label="Modelo" value={gen?.template_id || ""} fullWidth
              onChange={(e) => setGen((g) => ({ ...g, template_id: e.target.value }))}>
              {templates.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}{t.service_id ? ` — ${services.find((s) => String(s.id) === String(t.service_id))?.name || ""}` : ""}
                </MenuItem>
              ))}
            </TextField>
            <TextField select label="Cliente *" value={gen?.client_id || ""} fullWidth
              onChange={(e) => setGen((g) => ({ ...g, client_id: e.target.value }))}>
              <MenuItem value="">Selecione…</MenuItem>
              {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Valor" type="number" value={gen?.value || ""} fullWidth
                onChange={(e) => setGen((g) => ({ ...g, value: e.target.value }))} />
              <TextField label="Duração (meses)" type="number" value={gen?.duration_months || ""} fullWidth
                onChange={(e) => setGen((g) => ({ ...g, duration_months: e.target.value }))}
                helperText="Vazio = indeterminado" />
            </Stack>
            <TextField label="Início" type="date" InputLabelProps={{ shrink: true }} value={gen?.start_date || ""} fullWidth
              onChange={(e) => setGen((g) => ({ ...g, start_date: e.target.value }))} />
            <Typography variant="caption" color="text.secondary">
              O sistema cria o contrato já preenchido. Depois é só abrir e mandar o link de assinatura.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGen(null)}>Cancelar</Button>
          <Button variant="contained" onClick={gerarDeModelo} disabled={!gen?.template_id || !gen?.client_id}>Gerar contrato</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{draft.id ? "Editar contrato" : "Novo contrato"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Título *" value={draft.title} onChange={set("title")} fullWidth />
            <TextField select label="Cliente" value={draft.client_id} onChange={set("client_id")} fullWidth>
              <MenuItem value="">Sem cliente</MenuItem>
              {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Valor" type="number" value={draft.value} onChange={set("value")} fullWidth />
              <TextField label="Duração (meses) — vazio = indeterminado" type="number" value={draft.duration_months || ""} onChange={set("duration_months")} fullWidth />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label="Início" type="date" InputLabelProps={{ shrink: true }} value={draft.start_date || ""} onChange={set("start_date")} fullWidth />
              <TextField label="1º vencimento" type="date" InputLabelProps={{ shrink: true }} value={draft.first_due_date || ""} onChange={set("first_due_date")} fullWidth />
            </Stack>
            <TextField label="Observações" value={draft.notes || ""} onChange={set("notes")} fullWidth multiline rows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={save} disabled={!draft.title}>Salvar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
