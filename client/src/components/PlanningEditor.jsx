import { useEffect, useRef, useState, useCallback } from "react";
import {
  Box, Stack, IconButton, Tooltip, Button, Divider, Select, MenuItem, Typography, Chip,
  Collapse, TextField, Alert,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import PsychologyIcon from "@mui/icons-material/Psychology";
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
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import api from "../api/client.js";
import { CATEGORY_HEX } from "../data/seasonalDates.js";

const FONTS = ["Arial", "Georgia", "Times New Roman", "Courier New", "Verdana", "Tahoma", "Trebuchet MS"];
const SIZES = [["2", "Pequeno"], ["3", "Normal"], ["4", "Médio"], ["5", "Grande"], ["6", "Enorme"], ["7", "Gigante"]];
const SPACINGS = [["1", "Simples"], ["1.4", "1,5"], ["1.8", "Duplo"]];
const MARGINS = [["10mm", "Estreita"], ["20mm", "Normal"], ["30mm", "Larga"]];
const WD = ["D", "S", "T", "Q", "Q", "S", "S"];

// Campos da "inteligência" do cliente (a persona que a IA usa nas legendas e no
// planejamento). Ficam salvos por cliente e valem também no botão da Distribuição.
const PERSONA_FIELDS = [
  ["tone", "Tom de voz", "Ex.: próximo, acolhedor, direto…"],
  ["audience", "Público", "Ex.: mulheres 30-45, mães, empreendedoras…"],
  ["pillars", "Pilares de conteúdo", "Ex.: dicas, bastidores, depoimentos, ofertas…"],
  ["avoid", "Evitar", "Ex.: gírias, promessas exageradas…"],
  ["extra", "Prompt / observações", "Escreva instruções livres pra IA sobre este cliente."],
];

const pad = (n) => String(n).padStart(2, "0");
const brDate = (isoStr) => { const [y, m, d] = isoStr.split("-").map(Number); return `${pad(d)}/${pad(m)}/${y}`; };
const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const BAND_H = 150; // altura da faixa onde o logo flutua

// Calendário compacto do mês, com bolinha para datas do cliente e sazonais.
// Clicar num dia abre o mesmo diálogo de "adicionar data" do Planejamento.
function MiniCalendar({ year, month, byDay, seasonalByDay, onDay }) {
  const first = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <Box sx={{ maxWidth: 520, mx: "auto", mb: 2, border: 1, borderColor: "divider", borderRadius: 2, overflow: "hidden" }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", bgcolor: "action.hover" }}>
        {WD.map((w, i) => <Typography key={i} variant="caption" sx={{ textAlign: "center", py: 0.4, fontWeight: 700, color: "text.secondary" }}>{w}</Typography>)}
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {cells.map((d, i) => {
          const isoStr = d ? `${year}-${pad(month + 1)}-${pad(d)}` : null;
          const mine = (d && byDay[isoStr]) || [];
          const saz = (d && seasonalByDay?.[isoStr]) || [];
          return (
            <Box key={i} onClick={() => d && onDay(isoStr)}
              sx={{
                minHeight: 46, p: 0.4, borderRight: (i + 1) % 7 !== 0 ? 1 : 0, borderTop: 1, borderColor: "divider",
                cursor: d ? "pointer" : "default", "&:hover": d ? { bgcolor: "action.hover" } : {},
                display: "flex", flexDirection: "column", gap: 0.25,
              }}>
              {d && (
                <>
                  <Typography sx={{ fontSize: 11, fontWeight: mine.length ? 800 : 500, color: mine.length ? "primary.main" : "text.secondary" }}>{d}</Typography>
                  <Stack direction="row" spacing={0.3} sx={{ flexWrap: "wrap" }}>
                    {mine.length > 0 && <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "primary.main" }} />}
                    {saz.slice(0, 3).map((s, k) => <Box key={k} sx={{ width: 5, height: 5, borderRadius: "50%", bgcolor: CATEGORY_HEX[s.category] || "#999" }} />)}
                  </Stack>
                </>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// Bloco HTML das datas do mês (para semear o documento vazio e para inserir).
function blocoDatas(monthDates, monthLabel) {
  if (!monthDates.length) return "";
  const linhas = [...monthDates]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((d) => `<li><b>${esc(brDate(d.date))} — ${esc(d.title)}</b>${d.notes ? `: ${esc(d.notes)}` : ""}</li>`)
    .join("");
  return `<h3>Datas importantes — ${esc(monthLabel)}</h3><ul>${linhas}</ul><p><br/></p>`;
}

// Editor do planejamento por cliente/mês.
export default function PlanningEditor({
  clientId, clientName, ym, monthLabel, monthDates = [],
  year, month, byDay = {}, seasonalByDay = {}, onOpenDay,
}) {
  const ref = useRef(null);
  const bandRef = useRef(null);
  const [fontFamily, setFontFamily] = useState("Arial");
  const [lineHeight, setLineHeight] = useState("1.4");
  const [margin, setMargin] = useState("20mm");
  const [showLogo, setShowLogo] = useState(true);
  const [logo, setLogo] = useState(null);
  // Geometria do logo (px dentro da faixa). x null = centralizado.
  const [logoW, setLogoW] = useState(200);
  const [logoX, setLogoX] = useState(null);
  const [logoY, setLogoY] = useState(16);
  const [showCal, setShowCal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const dirty = useRef(false);
  const drag = useRef(null);
  // IA do cliente (persona) + geração do planejamento
  const [iaOpen, setIaOpen] = useState(false);
  const [persona, setPersona] = useState({});
  const [personaSaved, setPersonaSaved] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [iaMsg, setIaMsg] = useState(null);

  useEffect(() => { api.get("/branding").then((r) => setLogo(r.data?.logo || null)).catch(() => {}); }, []);

  // Carrega a persona do cliente (a "inteligência" que a IA usa).
  useEffect(() => {
    setPersonaSaved(false); setIaMsg(null);
    if (!clientId) { setPersona({}); return; }
    api.get(`/ai/persona/${clientId}`).then((r) => setPersona(r.data || {})).catch(() => setPersona({}));
  }, [clientId]);

  async function salvarPersona() {
    if (!clientId) return;
    try { await api.put(`/ai/persona/${clientId}`, persona); setPersonaSaved(true); setTimeout(() => setPersonaSaved(false), 3000); }
    catch { setIaMsg({ t: "error", m: "Não consegui salvar a inteligência do cliente." }); }
  }

  // Gera um rascunho de planejamento do mês com a IA e insere no documento.
  async function gerarPlanejamento() {
    if (!clientId) return;
    setGerando(true); setIaMsg(null);
    try {
      const datas = monthDates.map((d) => `${brDate(d.date)} — ${d.title}`).join("; ");
      const { data } = await api.post("/ai/generate", {
        client_id: clientId, kind: "plan",
        topic: `mês de ${monthLabel}${datas ? `. Datas importantes: ${datas}` : ""}`,
      });
      const txt = (data.text || "").trim();
      if (!txt) { setIaMsg({ t: "error", m: "A IA não retornou nada. Tente de novo." }); return; }
      const html = `<h3>Sugestão da IA — ${esc(monthLabel)}</h3>`
        + esc(txt).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("")
        + "<p><br/></p>";
      ref.current?.focus();
      document.execCommand("insertHTML", false, html);
      dirty.current = true; salvar();
      setIaMsg({ t: "success", m: "Planejamento sugerido pela IA — ajuste como quiser. ✨" });
    } catch (err) {
      const d = err.response?.data;
      setIaMsg({ t: "error", m: d?.needs_key ? "Configure a chave de IA na aba IA primeiro." : (d?.error || "Não foi possível gerar.") });
    } finally { setGerando(false); }
  }

  // Carrega o documento do cliente/mês (e semeia com as datas se estiver vazio).
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
        } catch { html = raw; }
      }
      setFontFamily(style.fontFamily || "Arial");
      setLineHeight(style.lineHeight || "1.4");
      setMargin(style.margin || "20mm");
      setShowLogo(sl);
      setLogoW(style.logoW || 200);
      setLogoX(style.logoX ?? null);
      setLogoY(style.logoY ?? 16);
      // Documento novo (vazio) já vem com as datas importantes do mês.
      const seed = (!html && monthDates.length) ? blocoDatas(monthDates, monthLabel) : html;
      if (ref.current) ref.current.innerHTML = seed || "";
      setSavedAt(r.data?.updated_at || null);
      dirty.current = Boolean(!html && seed); // se semeou, marca para salvar
      try { document.execCommand("styleWithCSS", false, true); } catch { /* ok */ }
    }).catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, ym]);

  const cmd = useCallback((name, value = null) => {
    ref.current?.focus();
    try { document.execCommand("styleWithCSS", false, true); } catch { /* ok */ }
    document.execCommand(name, false, value);
    dirty.current = true;
  }, []);

  const salvar = useCallback(async () => {
    if (!clientId || !ym) return;
    setSaving(true);
    try {
      const payload = {
        html: ref.current?.innerHTML || "",
        style: { fontFamily, lineHeight, margin, logoW, logoX, logoY },
        showLogo,
      };
      await api.put("/planning/doc", { client_id: clientId, ym, content: JSON.stringify(payload) });
      setSavedAt(new Date().toISOString());
      dirty.current = false;
    } finally { setSaving(false); }
  }, [clientId, ym, fontFamily, lineHeight, margin, showLogo, logoW, logoX, logoY]);

  function inserirDatas() {
    const bloco = blocoDatas(monthDates, monthLabel);
    if (!bloco) return;
    ref.current?.focus();
    document.execCommand("insertHTML", false, bloco);
    dirty.current = true;
  }

  // ---- Arrastar e redimensionar o logo (segurar e arrastar) ----
  function iniciarDrag(e, modo) {
    e.preventDefault();
    const band = bandRef.current?.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const baseX = logoX == null ? (band ? (band.width - logoW) / 2 : 0) : logoX;
    drag.current = { modo, startX, startY, baseX, baseY: logoY, baseW: logoW, bandW: band?.width || 820 };
    window.addEventListener("pointermove", moverDrag);
    window.addEventListener("pointerup", soltarDrag);
  }
  function moverDrag(e) {
    const g = drag.current; if (!g) return;
    if (g.modo === "move") {
      const nx = Math.max(0, Math.min(g.bandW - logoW, g.baseX + (e.clientX - g.startX)));
      const ny = Math.max(0, Math.min(BAND_H - 20, g.baseY + (e.clientY - g.startY)));
      setLogoX(nx); setLogoY(ny);
    } else {
      const nw = Math.max(60, Math.min(g.bandW, g.baseW + (e.clientX - g.startX)));
      setLogoW(nw);
    }
    dirty.current = true;
  }
  function soltarDrag() {
    drag.current = null;
    window.removeEventListener("pointermove", moverDrag);
    window.removeEventListener("pointerup", soltarDrag);
    salvar();
  }

  function abrirImpressao() {
    const conteudo = ref.current?.innerHTML || "";
    const leftCss = logoX == null ? "left:50%;transform:translateX(-50%)" : `left:${logoX}px`;
    const cab = showLogo && logo
      ? `<div style="position:relative;height:${BAND_H}px"><img src="${logo}" style="position:absolute;top:${logoY}px;${leftCss};width:${logoW}px;object-fit:contain" /></div>`
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
        <Tooltip title={showLogo ? "Logo no topo — arraste para mover e use o canto para redimensionar (clique aqui para tirar)" : "Logo escondido (clique para mostrar)"}>
          <Chip size="small" label="Logo" color={showLogo ? "primary" : "default"} variant={showLogo ? "filled" : "outlined"}
            onClick={() => { setShowLogo((v) => !v); dirty.current = true; }} />
        </Tooltip>
      </Stack>

      {/* Ações */}
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: "wrap", gap: 1 }} alignItems="center">
        <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={salvar} disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
        <Button size="small" variant={showCal ? "contained" : "outlined"} startIcon={<CalendarMonthIcon />}
          onClick={() => setShowCal((v) => !v)}>
          {showCal ? "Esconder calendário" : "Ver calendário"}
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
        <Divider orientation="vertical" flexItem />
        <Button size="small" variant={iaOpen ? "contained" : "outlined"} color="secondary"
          startIcon={<PsychologyIcon />} onClick={() => setIaOpen((v) => !v)}>
          IA deste cliente
        </Button>
        <Tooltip title="A IA olha as datas do mês + a inteligência do cliente e sugere o planejamento">
          <Button size="small" variant="outlined" color="secondary" startIcon={<AutoAwesomeIcon />}
            onClick={gerarPlanejamento} disabled={gerando}>
            {gerando ? "Gerando…" : "Gerar com IA"}
          </Button>
        </Tooltip>
        {savedAt && <Typography variant="caption" color="text.secondary">Salvo</Typography>}
      </Stack>

      {/* Inteligência do cliente (persona): vale aqui e nas legendas da Distribuição */}
      <Collapse in={iaOpen}>
        <Box sx={{ mb: 1.5, p: 1.5, border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "action.hover" }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Inteligência deste cliente</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            A IA usa isto pra escrever no jeito do cliente — nas <b>legendas</b> (botão na Distribuição) e no <b>planejamento</b> (botão “Gerar com IA” acima).
          </Typography>
          {iaMsg && <Alert severity={iaMsg.t} sx={{ mb: 1.5 }} onClose={() => setIaMsg(null)}>{iaMsg.m}</Alert>}
          <Stack spacing={1.5}>
            {PERSONA_FIELDS.map(([k, label, ph]) => (
              <TextField key={k} label={label} placeholder={ph} value={persona[k] || ""}
                onChange={(e) => setPersona((p) => ({ ...p, [k]: e.target.value }))}
                fullWidth size="small" multiline={k === "extra"} minRows={k === "extra" ? 2 : 1} />
            ))}
            <Button variant="contained" size="small" onClick={salvarPersona} sx={{ alignSelf: "flex-start" }}>
              {personaSaved ? "Salvo ✓" : "Salvar inteligência"}
            </Button>
          </Stack>
        </Box>
      </Collapse>

      {/* Calendário do mês em cima (opcional) — clicar num dia adiciona a data */}
      {showCal && year != null && (
        <MiniCalendar year={year} month={month} byDay={byDay} seasonalByDay={seasonalByDay}
          onDay={(isoStr) => onOpenDay && onOpenDay(isoStr)} />
      )}

      {/* Folha do documento */}
      <Box sx={{ display: "flex", justifyContent: "center" }}>
        <Box sx={{ width: "100%", maxWidth: 820, bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: 2, boxShadow: 1, overflow: "hidden" }}>
          {showLogo && logo && (
            <Box ref={bandRef} sx={{ position: "relative", height: BAND_H, borderBottom: 1, borderColor: "divider" }}>
              <Box sx={{
                position: "absolute", top: logoY,
                left: logoX == null ? "50%" : logoX,
                transform: logoX == null ? "translateX(-50%)" : "none",
                width: logoW, cursor: "move", "&:hover .rz": { opacity: 1 },
              }}
                onPointerDown={(e) => iniciarDrag(e, "move")}>
                <Box component="img" src={logo} alt="" draggable={false}
                  sx={{ width: "100%", objectFit: "contain", display: "block", userSelect: "none", pointerEvents: "none" }} />
                {/* Alça de redimensionar (canto inferior direito) */}
                <Box className="rz" onPointerDown={(e) => { e.stopPropagation(); iniciarDrag(e, "resize"); }}
                  sx={{ position: "absolute", right: -6, bottom: -6, width: 14, height: 14, bgcolor: "primary.main", borderRadius: "50%", cursor: "nwse-resize", opacity: 0.5, transition: "opacity .15s" }} />
              </Box>
            </Box>
          )}
          <Typography sx={{ textAlign: "center", fontWeight: 700, fontSize: 18, pt: showLogo && logo ? 1 : 3, pb: 1 }}>
            {clientName} — {monthLabel}
          </Typography>
          <Box
            ref={ref}
            contentEditable
            suppressContentEditableWarning
            onBlur={() => { if (dirty.current) salvar(); }}
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
