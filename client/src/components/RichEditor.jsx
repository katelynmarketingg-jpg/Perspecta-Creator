import { useEffect, useRef } from "react";
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
