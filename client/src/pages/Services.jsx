import { useEffect, useState } from "react";
import {
  Box, Card, CardContent, Typography, Stack, Button, IconButton, Chip, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, Divider, MenuItem, Tooltip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import DesignServicesIcon from "@mui/icons-material/DesignServices";
import api from "../api/client.js";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { currency } from "../utils.js";
import RichEditor from "../components/RichEditor.jsx";

const VAZIO = { name: "", category: "", default_price: "", contract_template: "", items_schema: [] };

export default function Services() {
  const [services, setServices] = useState([]);
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState("");

  const load = () => api.get("/services").then((r) => setServices(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  function abrirNovo() { setDraft({ ...VAZIO }); }
  function abrirEditar(s) {
    setDraft({
      ...s,
      category: s.category || "",
      contract_template: s.contract_template || "",
      items_schema: Array.isArray(s.items_schema) ? s.items_schema : (s.items_schema ? JSON.parse(s.items_schema) : []),
    });
  }

  async function salvar() {
    if (!draft.name.trim()) return;
    const payload = { ...draft, default_price: Number(draft.default_price) || 0 };
    if (draft.id) await api.put(`/services/${draft.id}`, payload);
    else await api.post("/services", payload);
    setDraft(null);
    setMsg("Serviço salvo. ✅");
    setTimeout(() => setMsg(""), 3000);
    load();
  }
  async function excluir(id) {
    if (!confirm("Excluir este serviço? (não afeta clientes que já o têm)")) return;
    await api.delete(`/services/${id}`);
    load();
  }

  // Editor de itens (quantidades personalizadas do serviço).
  function addItem() { setDraft((d) => ({ ...d, items_schema: [...(d.items_schema || []), { label: "", unit: "" }] })); }
  function setItem(i, field, val) {
    setDraft((d) => ({ ...d, items_schema: d.items_schema.map((it, k) => (k === i ? { ...it, [field]: val } : it)) }));
  }
  function delItem(i) { setDraft((d) => ({ ...d, items_schema: d.items_schema.filter((_, k) => k !== i) })); }

  // Agrupa por categoria para exibir classificado.
  const grupos = {};
  services.forEach((s) => { (grupos[s.category || "Sem categoria"] ||= []).push(s); });

  return (
    <>
      <PageHeader title="Serviços" subtitle="Seus serviços, a classificação e o modelo de contrato de cada um"
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={abrirNovo}>Novo serviço</Button>} />

      {msg && <Alert severity="success" sx={{ mb: 2 }}>{msg}</Alert>}

      {services.length === 0 ? (
        <EmptyState message="Nenhum serviço ainda. Crie o primeiro (ex.: Gestão de rede social, Tráfego pago, Landing page)." />
      ) : (
        Object.entries(grupos).map(([cat, arr]) => (
          <Box key={cat} sx={{ mb: 3 }}>
            <Typography variant="subtitle2" color="primary" sx={{ fontWeight: 800, mb: 1 }}>{cat}</Typography>
            <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)" } }}>
              {arr.map((s) => (
                <Card key={s.id} variant="outlined">
                  <CardContent>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <DesignServicesIcon color="primary" />
                      <Typography sx={{ flex: 1, fontWeight: 700 }} noWrap>{s.name}</Typography>
                      <IconButton size="small" onClick={() => abrirEditar(s)}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => excluir(s.id)}><DeleteIcon fontSize="small" /></IconButton>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {currency(s.default_price)} (valor padrão)
                    </Typography>
                    <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: "wrap", gap: 0.5 }}>
                      {s.contract_template
                        ? <Chip size="small" color="success" variant="outlined" label="Modelo de contrato ✓" />
                        : <Chip size="small" variant="outlined" label="Sem modelo de contrato" />}
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Box>
          </Box>
        ))
      )}

      {/* Editor do serviço */}
      <Dialog open={Boolean(draft)} onClose={() => setDraft(null)} fullWidth maxWidth="md">
        <DialogTitle>{draft?.id ? "Editar serviço" : "Novo serviço"}</DialogTitle>
        <DialogContent>
          {draft && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label="Nome *" value={draft.name} autoFocus fullWidth
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                <TextField label="Classificação / categoria" value={draft.category} fullWidth
                  onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                  placeholder="Ex.: Social media, Tráfego, Site…" />
                <TextField label="Valor padrão (R$)" type="number" value={draft.default_price} sx={{ minWidth: 150 }}
                  onChange={(e) => setDraft((d) => ({ ...d, default_price: e.target.value }))} />
              </Stack>

              <Divider>Quantidades do serviço (opcional)</Divider>
              <Typography variant="caption" color="text.secondary">
                Campos de quantidade que aparecem no cadastro do cliente para este serviço (ex.: Posts, Reels, Criativos).
              </Typography>
              {(draft.items_schema || []).map((it, i) => (
                <Stack key={i} direction="row" spacing={1} alignItems="center">
                  <TextField size="small" label="Nome" value={it.label} sx={{ flex: 1 }}
                    onChange={(e) => setItem(i, "label", e.target.value)} placeholder="Ex.: Posts" />
                  <TextField size="small" label="Unidade" value={it.unit} sx={{ width: 140 }}
                    onChange={(e) => setItem(i, "unit", e.target.value)} placeholder="por mês" />
                  <IconButton size="small" color="error" onClick={() => delItem(i)}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
              ))}
              <Button size="small" startIcon={<AddIcon />} onClick={addItem} sx={{ alignSelf: "flex-start" }}>
                Adicionar quantidade
              </Button>

              <Divider>Modelo de contrato deste serviço</Divider>
              <Alert severity="info" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
                Escreva o contrato e use marcadores que o sistema troca sozinho ao gerar para o cliente:
                <Box sx={{ mt: 0.5, fontFamily: "monospace", fontSize: 13 }}>
                  {"{{cliente}} {{empresa}} {{email}} {{telefone}} {{segmento}} {{endereco}} {{valor}} {{duracao}} {{data}} {{servico}}"}
                </Box>
              </Alert>
              <RichEditor
                docKey={draft.id || "novo"}
                value={draft.contract_template}
                onChange={(html) => setDraft((d) => ({ ...d, contract_template: html }))}
                placeholder="Escreva aqui o contrato deste serviço (com os marcadores acima)…"
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>Cancelar</Button>
          <Button variant="contained" onClick={salvar} disabled={!draft?.name?.trim()}>Salvar serviço</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
