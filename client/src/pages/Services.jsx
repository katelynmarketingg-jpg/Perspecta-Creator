import { useEffect, useState } from "react";
import {
  Box, Card, CardContent, Typography, Stack, Button, IconButton, Chip, TextField,
  Dialog, DialogContent, Alert, Divider, Tooltip, AppBar, Toolbar,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import DesignServicesIcon from "@mui/icons-material/DesignServices";
import CloseIcon from "@mui/icons-material/Close";
import SaveIcon from "@mui/icons-material/Save";
import PrintIcon from "@mui/icons-material/Print";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import api from "../api/client.js";
import { PageHeader, EmptyState } from "../components/ui.jsx";
import { currency } from "../utils.js";
import RichEditor from "../components/RichEditor.jsx";
import LogoBanner, { BAND_H } from "../components/LogoBanner.jsx";

const VAZIO = { name: "", category: "", default_price: "", contract_template: "", items_schema: [], contract_style: {} };
const parseStyle = (s) => { try { return typeof s === "string" ? JSON.parse(s) : (s || {}); } catch { return {}; } };

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
      contract_style: parseStyle(s.contract_style),
      items_schema: Array.isArray(s.items_schema) ? s.items_schema : (s.items_schema ? JSON.parse(s.items_schema) : []),
    });
  }

  async function salvar() {
    if (!draft.name.trim()) return;
    const payload = {
      ...draft,
      default_price: Number(draft.default_price) || 0,
      contract_style: JSON.stringify(draft.contract_style || {}),
    };
    let saved;
    if (draft.id) saved = (await api.put(`/services/${draft.id}`, payload)).data;
    else saved = (await api.post("/services", payload)).data;
    setMsg("Serviço salvo. ✅");
    setTimeout(() => setMsg(""), 3000);
    await load();
    // Continua no editor com o serviço salvo (para poder imprimir etc.).
    if (saved) abrirEditar(saved);
  }
  async function excluir(id) {
    if (!confirm("Excluir este serviço? (não afeta clientes que já o têm)")) return;
    await api.delete(`/services/${id}`);
    load();
  }

  function addItem() { setDraft((d) => ({ ...d, items_schema: [...(d.items_schema || []), { label: "", unit: "" }] })); }
  function setItem(i, field, val) {
    setDraft((d) => ({ ...d, items_schema: d.items_schema.map((it, k) => (k === i ? { ...it, [field]: val } : it)) }));
  }
  function delItem(i) { setDraft((d) => ({ ...d, items_schema: d.items_schema.filter((_, k) => k !== i) })); }

  // Impressão/PDF do modelo (logo + texto do contrato).
  function imprimir() {
    const st = draft.contract_style || {};
    const win = window.open("", "_blank");
    if (!win) return;
    api.get("/branding").then((r) => {
      const logo = r.data?.logo;
      const leftCss = st.logoX == null ? "left:50%;transform:translateX(-50%)" : `left:${st.logoX}px`;
      const cab = logo
        ? `<div style="position:relative;height:${BAND_H}px"><img src="${logo}" style="position:absolute;top:${st.logoY ?? 16}px;${leftCss};width:${st.logoW || 200}px;object-fit:contain" /></div>`
        : "";
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${draft.name || "Contrato"}</title>
        <style>@page{margin:0} body{margin:0;padding:20mm;font-family:Georgia,serif;line-height:1.6;color:#111} ul,ol{padding-left:22px}</style>
        </head><body>${cab}<h2 style="text-align:center">${draft.name || ""}</h2>${draft.contract_template || ""}
        <script>window.onload=function(){window.focus();window.print();}<\/script></body></html>`);
      win.document.close();
    });
  }

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
                <Card key={s.id} variant="outlined" onClick={() => abrirEditar(s)}
                  sx={{ cursor: "pointer", "&:hover": { borderColor: "primary.main" } }}>
                  <CardContent>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <DesignServicesIcon color="primary" />
                      <Typography sx={{ flex: 1, fontWeight: 700 }} noWrap>{s.name}</Typography>
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); excluir(s.id); }} color="error"><DeleteIcon fontSize="small" /></IconButton>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{currency(s.default_price)} (valor padrão)</Typography>
                    <Chip size="small" sx={{ mt: 1 }} variant="outlined"
                      color={s.contract_template ? "success" : "default"}
                      label={s.contract_template ? "Modelo de contrato ✓" : "Sem modelo"} />
                  </CardContent>
                </Card>
              ))}
            </Box>
          </Box>
        ))
      )}

      {/* Editor em TELA CHEIA */}
      <Dialog open={Boolean(draft)} onClose={() => setDraft(null)} fullScreen>
        <AppBar position="sticky" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Toolbar sx={{ gap: 1, flexWrap: "wrap" }}>
            <IconButton edge="start" onClick={() => setDraft(null)}><CloseIcon /></IconButton>
            <Typography variant="h6" sx={{ mr: 2 }}>{draft?.id ? "Editar serviço" : "Novo serviço"}</Typography>
            <Box sx={{ flex: 1 }} />
            <Button variant="outlined" startIcon={<PrintIcon />} onClick={imprimir} disabled={!draft?.contract_template}>Imprimir</Button>
            <Tooltip title="Abre a impressão — escolha 'Salvar como PDF'">
              <Button variant="outlined" startIcon={<PictureAsPdfIcon />} onClick={imprimir} disabled={!draft?.contract_template}>PDF</Button>
            </Tooltip>
            <Button variant="contained" startIcon={<SaveIcon />} onClick={salvar} disabled={!draft?.name?.trim()}>Salvar</Button>
          </Toolbar>
          {/* Modelos já salvos — clique para abrir/editar */}
          {services.length > 0 && (
            <Box sx={{ px: 2, pb: 1, display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
              <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>Modelos salvos:</Typography>
              {services.map((s) => (
                <Chip key={s.id} size="small" label={s.name}
                  color={draft?.id === s.id ? "primary" : "default"}
                  variant={draft?.id === s.id ? "filled" : "outlined"}
                  onClick={() => abrirEditar(s)} />
              ))}
            </Box>
          )}
        </AppBar>

        <DialogContent sx={{ bgcolor: "background.default" }}>
          {draft && (
            <Box sx={{ maxWidth: 900, mx: "auto", py: 2 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
                <TextField label="Nome *" value={draft.name} fullWidth
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                <TextField label="Classificação / categoria" value={draft.category} fullWidth
                  onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                  placeholder="Ex.: Social media, Tráfego, Site…" />
                <TextField label="Valor padrão (R$)" type="number" value={draft.default_price} sx={{ minWidth: 150 }}
                  onChange={(e) => setDraft((d) => ({ ...d, default_price: e.target.value }))} />
              </Stack>

              <Divider sx={{ mb: 1.5 }}>Quantidades do serviço (opcional)</Divider>
              {(draft.items_schema || []).map((it, i) => (
                <Stack key={i} direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <TextField size="small" label="Nome" value={it.label} sx={{ flex: 1 }}
                    onChange={(e) => setItem(i, "label", e.target.value)} placeholder="Ex.: Posts" />
                  <TextField size="small" label="Unidade" value={it.unit} sx={{ width: 140 }}
                    onChange={(e) => setItem(i, "unit", e.target.value)} placeholder="por mês" />
                  <IconButton size="small" color="error" onClick={() => delItem(i)}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
              ))}
              <Button size="small" startIcon={<AddIcon />} onClick={addItem} sx={{ mb: 2 }}>Adicionar quantidade</Button>

              <Divider sx={{ mb: 1.5 }}>Modelo de contrato deste serviço</Divider>
              <Alert severity="info" sx={{ mb: 1.5, "& .MuiAlert-message": { width: "100%" } }}>
                Marcadores que o sistema troca ao gerar para o cliente:
                <Box sx={{ mt: 0.5, fontFamily: "monospace", fontSize: 13 }}>
                  {"{{cliente}} {{empresa}} {{email}} {{telefone}} {{segmento}} {{endereco}} {{valor}} {{duracao}} {{data}} {{servico}}"}
                </Box>
              </Alert>

              {/* Barra em cima; o logo (móvel) fica dentro da folha, acima do texto */}
              <Card variant="outlined" sx={{ overflow: "hidden", mb: 2 }}>
                <Box sx={{ p: 2 }}>
                  <RichEditor
                    docKey={draft.id || "novo"}
                    value={draft.contract_template}
                    onChange={(html) => setDraft((d) => ({ ...d, contract_template: html }))}
                    minHeight={360}
                    placeholder="Escreva aqui o contrato deste serviço (com os marcadores acima)…"
                    header={
                      <Box sx={{ overflow: "hidden" }}>
                        <LogoBanner geom={draft.contract_style || {}}
                          onGeom={(g) => setDraft((d) => ({ ...d, contract_style: g }))} />
                      </Box>
                    }
                  />
                </Box>
              </Card>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
