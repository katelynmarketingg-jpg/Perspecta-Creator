import { useEffect, useRef, useState, useCallback } from "react";
import {
  Box, Stack, IconButton, Tooltip, Button, Divider, Select, MenuItem, Typography, Chip,
} from "@mui/material";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatUnderlinedIcon from "@mui/icons-material/FormatUnderlined";
import FormatAlignLeftIcon from "@mui/icons-material/FormatAlignLeft";
import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import FormatAlignRightIcon from "@mui/icons-material/FormatAlignRight";
import FormatAlignJustifyIcon from "@mui/icons-material/FormatAlignJustify";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import FormatColorTextIcon from "@mui/icons-material/FormatColorText";
import SaveIcon from "@mui/icons-material/Save";
import PrintIcon from "@mui/icons-material/Print";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import EventNoteIcon from "@mui/icons-material/EventNote";
import api from "../api/client.js";

const FONTS = ["Arial", "Georgia", "Times New Roman", "Courier New", "Verdana", "Tahoma", "Trebuchet MS"];
const SIZES = [["2", "Pequeno"], ["3", "Normal"], ["4", "Médio"], ["5", "Grande"], ["6", "Enorme"], ["7", "Gigante"]];
const SPACINGS = [["1", "Simples"], ["1.4", "1,5"], ["1.8", "Duplo"]];
const MARGINS = [["10mm", "Estreita"], ["20mm", "Normal"], ["30mm", "Larga"]];

const pad = (n) => String(n).padStart(2, "0");
const brDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${pad(d)}/${pad(m)}/${y}`; };

// escapa texto para montar HTML com segurança
const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export default function PlanningEditor({ clientId, clientName, ym, monthLabel, monthDates = [] }) {
  const ref = useRef(null);
  const [fontFamily, setFontFamily] = useState("Arial");
  const [lineHeight, setLineHeight] = useState("1.4");
  const [margin, setMargin] = useState("20mm");
  const [showLogo, setShowLogo] = useState(true);
  const [logo, setLogo] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const dirty = useRef(false);

  useEffect(() => { api.get("/branding").then((r) => setLogo(r.data?.logo || null)).catch(() => {}); }, []);

  // Carrega o documento do cliente/mês.
  useEffect(() => {
    if (!clientId || !ym) return;
    let vivo = true;
    api.get("/planning/doc", { params: { client_id: clientId, ym } }).then((r) => {
      if (!vivo) return;
      let html = "", style = {}, sl = true;
      const raw = r.data?.content;
      if (raw) {
        try {
          const j = JSON.parse(raw);
          html = j.html || ""; style = j.style || {}; sl = j.showLogo !== false;
        } catch { html = raw; } // conteúdo antigo em HTML puro
      }
      setFontFamily(style.fontFamily || "Arial");
      setLineHeight(style.lineHeight || "1.4");
      setMargin(style.margin || "20mm");
      setShowLogo(sl);
      if (ref.current) ref.current.innerHTML = html || "";
      setSavedAt(r.data?.updated_at || null);
      dirty.current = false;
      try { document.execCommand("styleWithCSS", false, true); } catch { /* ok */ }
    }).catch(() => {});
    return () => { vivo = false; };
  }, [clientId, ym]);

  const cmd = useCallback((name, value = null) => {
    ref.current?.focus();
    try { document.execCommand("styleWithCSS", false, true); } catch { /* ok */ }
    document.execCommand(name, false, value);
    dirty.current = true;
  }, []);

  const salvar = useCallback(async (silent) => {
    if (!clientId || !ym) return;
    setSaving(true);
    try {
      const payload = {
        html: ref.current?.innerHTML || "",
        style: { fontFamily, lineHeight, margin },
        showLogo,
      };
      await api.put("/planning/doc", { client_id: clientId, ym, content: JSON.stringify(payload) });
      setSavedAt(new Date().toISOString());
      dirty.current = false;
    } finally { setSaving(false); }
  }, [clientId, ym, fontFamily, lineHeight, margin, showLogo]);

  // Insere a lista das datas do mês no ponto do cursor.
  function inserirDatas() {
    if (!monthDates.length) return;
    const linhas = [...monthDates]
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((d) => `<li><b>${esc(brDate(d.date))} — ${esc(d.title)}</b>${d.notes ? `: ${esc(d.notes)}` : ""}</li>`)
      .join("");
    const bloco = `<h3>Datas importantes — ${esc(monthLabel)}</h3><ul>${linhas}</ul><p><br/></p>`;
    ref.current?.focus();
    document.execCommand("insertHTML", false, bloco);
    dirty.current = true;
  }

  // Monta o HTML de impressão (usado por Imprimir e Baixar PDF).
  function abrirImpressao() {
    const conteudo = ref.current?.innerHTML || "";
    const cab = showLogo && logo
      ? `<img src="${logo}" style="max-height:70px;max-width:260px;object-fit:contain;display:block;margin:0 auto 10px" />`
      : "";
    const titulo = `${esc(clientName || "Planejamento")} — ${esc(monthLabel)}`;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${titulo}</title>
      <style>
        @page { margin: ${margin}; }
        body { font-family: ${fontFamily}, sans-serif; line-height: ${lineHeight}; color: #111; }
        h1.doc-title { font-size: 18px; text-align:center; margin: 0 0 16px; }
        img { max-width: 100%; }
        ul, ol { padding-left: 22px; }
      </style></head><body>
      ${cab}
      <h1 class="doc-title">${titulo}</h1>
      ${conteudo}
      <script>window.onload=function(){window.focus();window.print();}<\/script>
      </body></html>`);
    win.document.close();
  }

  if (!clientId) {
    return (
      <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
        <Typography>Selecione um cliente (acima) para escrever o planejamento dele.</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Barra de formatação */}
      <Stack direction="row" spacing={0.5} alignItems="center"
        sx={{ flexWrap: "wrap", gap: 0.5, p: 1, border: 1, borderColor: "divider", borderRadius: 2, mb: 1.5, position: "sticky", top: 8, bgcolor: "background.paper", zIndex: 2 }}>
        <Select size="small" value={fontFamily} onChange={(e) => { setFontFamily(e.target.value); cmd("fontName", e.target.value); }} sx={{ minWidth: 130 }}>
          {FONTS.map((f) => <MenuItem key={f} value={f} sx={{ fontFamily: f }}>{f}</MenuItem>)}
        </Select>
        <Select size="small" defaultValue="3" onChange={(e) => cmd("fontSize", e.target.value)} sx={{ minWidth: 110 }}>
          {SIZES.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
        </Select>
        <Divider orientation="vertical" flexItem />
        <Tooltip title="Negrito"><IconButton size="small" onClick={() => cmd("bold")}><FormatBoldIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Itálico"><IconButton size="small" onClick={() => cmd("italic")}><FormatItalicIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Sublinhado"><IconButton size="small" onClick={() => cmd("underline")}><FormatUnderlinedIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Cor do texto">
          <IconButton size="small" component="label">
            <FormatColorTextIcon fontSize="small" />
            <input type="color" hidden onChange={(e) => cmd("foreColor", e.target.value)} />
          </IconButton>
        </Tooltip>
        <Divider orientation="vertical" flexItem />
        <Tooltip title="Alinhar à esquerda"><IconButton size="small" onClick={() => cmd("justifyLeft")}><FormatAlignLeftIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Centralizar"><IconButton size="small" onClick={() => cmd("justifyCenter")}><FormatAlignCenterIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Alinhar à direita"><IconButton size="small" onClick={() => cmd("justifyRight")}><FormatAlignRightIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Justificar"><IconButton size="small" onClick={() => cmd("justifyFull")}><FormatAlignJustifyIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Lista"><IconButton size="small" onClick={() => cmd("insertUnorderedList")}><FormatListBulletedIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Lista numerada"><IconButton size="small" onClick={() => cmd("insertOrderedList")}><FormatListNumberedIcon fontSize="small" /></IconButton></Tooltip>
        <Divider orientation="vertical" flexItem />
        <Tooltip title="Espaçamento entre linhas">
          <Select size="small" value={lineHeight} onChange={(e) => { setLineHeight(e.target.value); dirty.current = true; }} sx={{ minWidth: 96 }}>
            {SPACINGS.map(([v, l]) => <MenuItem key={v} value={v}>Linha: {l}</MenuItem>)}
          </Select>
        </Tooltip>
        <Tooltip title="Margem da página (impressão/PDF)">
          <Select size="small" value={margin} onChange={(e) => { setMargin(e.target.value); dirty.current = true; }} sx={{ minWidth: 110 }}>
            {MARGINS.map(([v, l]) => <MenuItem key={v} value={v}>Margem: {l}</MenuItem>)}
          </Select>
        </Tooltip>
        <Tooltip title={showLogo ? "Logo aparece no topo (clique para tirar)" : "Logo escondido (clique para mostrar)"}>
          <Chip size="small" label="Logo" color={showLogo ? "primary" : "default"} variant={showLogo ? "filled" : "outlined"}
            onClick={() => { setShowLogo((v) => !v); dirty.current = true; }} />
        </Tooltip>
      </Stack>

      {/* Ações */}
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: "wrap", gap: 1 }} alignItems="center">
        <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={() => salvar(false)} disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
        {monthDates.length > 0 && (
          <Button size="small" variant="outlined" startIcon={<EventNoteIcon />} onClick={inserirDatas}>
            Inserir datas do mês
          </Button>
        )}
        <Button size="small" variant="outlined" startIcon={<PrintIcon />} onClick={abrirImpressao}>Imprimir</Button>
        <Tooltip title="Abre a impressão — em Destino escolha 'Salvar como PDF'">
          <Button size="small" variant="outlined" startIcon={<PictureAsPdfIcon />} onClick={abrirImpressao}>Baixar PDF</Button>
        </Tooltip>
        {savedAt && <Typography variant="caption" color="text.secondary">Salvo</Typography>}
      </Stack>

      {/* Folha do documento */}
      <Box sx={{ display: "flex", justifyContent: "center" }}>
        <Box sx={{ width: "100%", maxWidth: 820, bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: 2, boxShadow: 1, overflow: "hidden" }}>
          {showLogo && logo && (
            <Box sx={{ textAlign: "center", pt: 3, pb: 1 }}>
              <Box component="img" src={logo} alt="" sx={{ maxHeight: 70, maxWidth: 260, objectFit: "contain" }} />
            </Box>
          )}
          <Typography sx={{ textAlign: "center", fontWeight: 700, fontSize: 18, pt: showLogo && logo ? 0 : 3, pb: 1 }}>
            {clientName} — {monthLabel}
          </Typography>
          <Box
            ref={ref}
            contentEditable
            suppressContentEditableWarning
            onBlur={() => { if (dirty.current) salvar(true); }}
            sx={{
              minHeight: 420, px: { xs: 3, sm: 6 }, py: 3, outline: "none",
              fontFamily, lineHeight: Number(lineHeight),
              "& ul, & ol": { pl: 3 },
              "&:empty:before": { content: '"Escreva aqui o planejamento do mês..."', color: "text.disabled" },
            }}
          />
        </Box>
      </Box>
    </Box>
  );
}
