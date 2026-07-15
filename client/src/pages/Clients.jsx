import { useEffect, useState } from "react";
import {
  Button, Card, Table, TableBody, TableCell, TableHead, TableRow, IconButton,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack,
  MenuItem, Link, Tooltip, Divider, Autocomplete, Box, Typography,
  FormControlLabel, Switch,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import DriveIcon from "@mui/icons-material/AddToDrive";
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

  // Seleção de serviços: preenche o valor padrão; o preço é editável por cliente.
  function setServices(selected) {
    setDraft((d) => ({
      ...d,
      services: selected.map((s) => {
        const existing = d.services.find((x) => x.service_id === (s.service_id ?? s.id));
        return existing || { service_id: s.id, name: s.name, price: s.default_price };
      }),
    }));
  }

  function setServicePrice(serviceId, price) {
    setDraft((d) => ({
      ...d,
      services: d.services.map((s) => (s.service_id === serviceId ? { ...s, price } : s)),
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

      {loading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : rows.length === 0 ? (
        <EmptyState message="Nenhum cliente cadastrado." action={<Button onClick={openNew}>Adicionar</Button>} />
      ) : (
        <Card>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Cliente</TableCell>
                <TableCell>Segmento</TableCell>
                <TableCell>Serviços</TableCell>
                <TableCell>Trabalho até</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((c) => (
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
                    {c.work_end ? formatDate(c.work_end) : <Chip size="small" label="Indeterminado" />}
                    {c.payment_day && <div style={{ fontSize: 12, color: "#888" }}>Pgto dia {c.payment_day}</div>}
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
            {draft.services.map((s) => (
              <Stack key={s.service_id} direction="row" spacing={2} alignItems="center">
                <Typography sx={{ flex: 1 }}>{s.name}</Typography>
                <TextField label="Valor (R$/mês)" type="number" size="small" sx={{ width: 180 }}
                  value={s.price} onChange={(e) => setServicePrice(s.service_id, e.target.value)} />
              </Stack>
            ))}
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
    </>
  );
}
