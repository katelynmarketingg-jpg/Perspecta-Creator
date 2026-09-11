import { useCallback, useEffect, useRef } from "react";
import { Box, Stack, IconButton, Tooltip, Divider, Select, MenuItem } from "@mui/material";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatUnderlinedIcon from "@mui/icons-material/FormatUnderlined";
import FormatAlignLeftIcon from "@mui/icons-material/FormatAlignLeft";
import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import FormatAlignRightIcon from "@mui/icons-material/FormatAlignRight";
import FormatAlignJustifyIcon from "@mui/icons-material/FormatAlignJustify";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";

const FONTS = ["Arial", "Georgia", "Times New Roman", "Courier New", "Verdana"];
const SIZES = [["2", "Pequeno"], ["3", "Normal"], ["4", "Médio"], ["5", "Grande"], ["6", "Enorme"]];

// ---------------------------------------------------------------------------
// COLAR DE FORA (Google Docs, Word, site) sem trazer o lixo junto.
//
// Colar um contrato do Docs traz milhares de <span style="...">, comentários e
// atributos que o Google usa por dentro: o texto parece o mesmo, mas o
// documento fica DEZENAS DE VEZES maior — e um documento grande demais não
// salva. Aqui fica só o que é de fato formatação.
// ---------------------------------------------------------------------------
const TAGS_OK = new Set([
  "P", "BR", "DIV", "SPAN", "B", "STRONG", "I", "EM", "U", "S", "SUB", "SUP",
  "UL", "OL", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "HR",
  "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "A", "IMG", "FONT",
]);
// Só o estilo que a pessoa vê: alinhamento, negrito, itálico, sublinhado.
const ESTILOS_OK = ["text-align", "font-weight", "font-style", "text-decoration", "font-family", "font-size"];

export function limpaHtmlColado(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  doc.querySelectorAll("style, script, meta, link, title").forEach((n) => n.remove());

  // Comentários (o Word enche o documento deles).
  const it = doc.createNodeIterator(doc.body, NodeFilter.SHOW_COMMENT);
  const comentarios = [];
  for (let n = it.nextNode(); n; n = it.nextNode()) comentarios.push(n);
  comentarios.forEach((n) => n.remove());

  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    if (!TAGS_OK.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
    const estilo = el.getAttribute("style") || "";
    const href = el.tagName === "A" ? el.getAttribute("href") : null;
    const src = el.tagName === "IMG" ? el.getAttribute("src") : null;
    for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);

    const guardar = estilo.split(";")
      .map((r) => r.trim())
      .filter((r) => ESTILOS_OK.some((ok) => r.toLowerCase().startsWith(ok + ":")))
      .join("; ");
    if (guardar) el.setAttribute("style", guardar);
    if (href && /^(https?:|mailto:|tel:)/i.test(href)) el.setAttribute("href", href);
    if (src && /^(https?:|data:image\/)/i.test(src)) el.setAttribute("src", src);
  }
  return doc.body.innerHTML;
}

// Editor de texto rico reutilizável (contentEditable + execCommand).
// value = HTML; onChange(html) a cada digitação. `docKey` reinicia o conteúdo
// quando muda (ex.: trocou de serviço).
// `header` é um bloco opcional renderizado ENTRE a barra e o texto (ex.: o logo
// dentro da folha). A barra fica no topo (sticky).
export default function RichEditor({ value = "", onChange, docKey, minHeight = 260, placeholder = "Escreva aqui…", header = null }) {
  const ref = useRef(null);

  // (Re)inicia o conteúdo quando o documento muda.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || "")) {
      ref.current.innerHTML = value || "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // Cola limpo: o texto e a formatação que a pessoa vê, sem o lixo do Docs.
  const colar = useCallback((e) => {
    const html = e.clipboardData?.getData("text/html");
    const texto = e.clipboardData?.getData("text/plain") || "";
    e.preventDefault();
    const limpo = html ? limpaHtmlColado(html) : texto.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])).replace(/\n/g, "<br>");
    document.execCommand("insertHTML", false, limpo);
    onChange?.(ref.current?.innerHTML || "");
  }, [onChange]);

  const cmd = (name, val = null) => {
    ref.current?.focus();
    try { document.execCommand("styleWithCSS", false, true); } catch { /* ok */ }
    document.execCommand(name, false, val);
    onChange?.(ref.current?.innerHTML || "");
  };

  return (
    <Box>
      <Stack direction="row" spacing={0.5} alignItems="center"
        sx={{ flexWrap: "wrap", gap: 0.5, p: 0.75, border: 1, borderColor: "divider", borderRadius: 2, mb: 1, position: "sticky", top: 8, bgcolor: "background.paper", zIndex: 2 }}>
        <Select size="small" defaultValue="Arial" onChange={(e) => cmd("fontName", e.target.value)} sx={{ minWidth: 120 }}>
          {FONTS.map((f) => <MenuItem key={f} value={f} sx={{ fontFamily: f }}>{f}</MenuItem>)}
        </Select>
        <Select size="small" defaultValue="3" onChange={(e) => cmd("fontSize", e.target.value)} sx={{ minWidth: 100 }}>
          {SIZES.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
        </Select>
        <Divider orientation="vertical" flexItem />
        <Tooltip title="Negrito"><IconButton size="small" onClick={() => cmd("bold")}><FormatBoldIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Itálico"><IconButton size="small" onClick={() => cmd("italic")}><FormatItalicIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Sublinhado"><IconButton size="small" onClick={() => cmd("underline")}><FormatUnderlinedIcon fontSize="small" /></IconButton></Tooltip>
        <Divider orientation="vertical" flexItem />
        <Tooltip title="Esquerda"><IconButton size="small" onClick={() => cmd("justifyLeft")}><FormatAlignLeftIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Centro"><IconButton size="small" onClick={() => cmd("justifyCenter")}><FormatAlignCenterIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Direita"><IconButton size="small" onClick={() => cmd("justifyRight")}><FormatAlignRightIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Justificar"><IconButton size="small" onClick={() => cmd("justifyFull")}><FormatAlignJustifyIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Lista"><IconButton size="small" onClick={() => cmd("insertUnorderedList")}><FormatListBulletedIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Lista numerada"><IconButton size="small" onClick={() => cmd("insertOrderedList")}><FormatListNumberedIcon fontSize="small" /></IconButton></Tooltip>
      </Stack>
      {header}
      <Box
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange?.(ref.current?.innerHTML || "")}
        onPaste={colar}
        sx={{
          minHeight, px: 2, py: 1.5, borderRadius: 2, border: 1, borderColor: "divider",
          outline: "none", fontFamily: "Georgia, serif", lineHeight: 1.6, overflowY: "auto",
          "& ul, & ol": { pl: 3 },
          "&:empty:before": { content: `"${placeholder}"`, color: "text.disabled" },
        }}
      />
    </Box>
  );
}
