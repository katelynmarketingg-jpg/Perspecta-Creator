import { Box } from "@mui/material";

// ---------------------------------------------------------------------------
// O TEXTO DO CONTRATO, do jeito que ele foi escrito.
//
// O contrato vem de dois lugares e em dois formatos: o modelo da casa é texto
// puro, e o contrato de cada serviço é escrito no editor da aba Serviços, que
// guarda HTML. Todas as telas mostravam como texto puro — então quem abria o
// link para assinar via, na cara, "<h2>CONTRATO DE PRESTAÇÃO DE SERVIÇOS</h2>
// <p><strong>CLÁUSULA PRIMEIRA</strong>…". Num documento que a pessoa vai
// assinar.
//
// Aqui o formato é reconhecido e cada um é desenhado do seu jeito. O HTML
// passa por uma limpeza antes: o texto é escrito por quem tem acesso ao
// sistema, mas ele é EXIBIDO NUMA PÁGINA PÚBLICA, então nada de script, estilo
// ou endereço executável entra.
// ---------------------------------------------------------------------------

const TAGS_OK = new Set([
  "P", "BR", "DIV", "SPAN", "B", "STRONG", "I", "EM", "U", "S", "SUB", "SUP",
  "UL", "OL", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "HR",
  "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "A", "IMG", "FONT",
]);
const ESTILOS_OK = ["text-align", "font-weight", "font-style", "text-decoration", "font-family", "font-size"];

/** Parece HTML? Uma etiqueta de verdade, não um "<" solto no meio da frase. */
export function pareceHtml(texto) {
  return /<(p|div|br|h[1-6]|ul|ol|li|strong|b|em|i|span|table|img)\b[^>]*>/i.test(String(texto || ""));
}

/** Deixa só o que é formatação. Nunca lança: no pior caso devolve vazio. */
export function limpaContrato(html) {
  try {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    doc.querySelectorAll("script, style, iframe, object, embed, link, meta, form, input, button").forEach((n) => n.remove());
    for (const el of Array.from(doc.body.querySelectorAll("*"))) {
      if (!TAGS_OK.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
      const estilo = el.getAttribute("style") || "";
      const href = el.tagName === "A" ? el.getAttribute("href") : null;
      const src = el.tagName === "IMG" ? el.getAttribute("src") : null;
      // Tira TUDO e devolve só o que passa pela peneira — assim um atributo
      // novo (onmouseover, por exemplo) nunca escapa por esquecimento.
      for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
      const guardar = estilo.split(";").map((r) => r.trim())
        .filter((r) => ESTILOS_OK.some((ok) => r.toLowerCase().startsWith(ok + ":")))
        .join("; ");
      if (guardar) el.setAttribute("style", guardar);
      if (href && /^(https?:|mailto:|tel:)/i.test(href)) {
        el.setAttribute("href", href);
        el.setAttribute("rel", "noopener noreferrer");
        el.setAttribute("target", "_blank");
      }
      if (src && /^(https?:|data:image\/)/i.test(src)) el.setAttribute("src", src);
    }
    return doc.body.innerHTML;
  } catch {
    return "";
  }
}

export default function TextoDoContrato({ texto, sx = {} }) {
  const base = {
    fontFamily: "Georgia, serif", lineHeight: 1.7, fontSize: 14,
    "& h1, & h2, & h3": { fontSize: 17, fontWeight: 700, mt: 2, mb: 1 },
    "& p": { my: 1 },
    "& ul, & ol": { pl: 3, my: 1 },
    "& img": { maxWidth: "100%", height: "auto" },
    "& table": { width: "100%", borderCollapse: "collapse" },
    "& td, & th": { border: "1px solid", borderColor: "divider", p: 0.5 },
    ...sx,
  };
  if (!String(texto || "").trim()) {
    return <Box sx={{ ...base, color: "text.secondary" }}>Este contrato não tem texto.</Box>;
  }
  if (pareceHtml(texto)) {
    return <Box sx={base} dangerouslySetInnerHTML={{ __html: limpaContrato(texto) }} />;
  }
  // Texto puro: as quebras de linha do modelo da casa são a formatação dele.
  return <Box sx={{ ...base, whiteSpace: "pre-wrap" }}>{texto}</Box>;
}
