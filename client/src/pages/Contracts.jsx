import { useEffect, useState } from "react";
import {
  Button, Card, Table, TableBody, TableCell, TableHead, TableRow, IconButton, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, MenuItem,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";
import PrintIcon from "@mui/icons-material/Print";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { Box, Typography, Tooltip, Alert } from "@mui/material";
import api from "../api/client.js";
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

  async function gerarLink(c) {
    const { data } = await api.post(`/contracts/${c.id}/sign-link`);
    setLink(data);
  }

  const load = () => api.get("/contracts").then((r) => setRows(r.data));
  useEffect(() => { load(); api.get("/clients").then((r) => setClients(r.data)); }, []);

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
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => { setDraft(EMPTY); setOpen(true); }}>Novo contrato</Button>}
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
