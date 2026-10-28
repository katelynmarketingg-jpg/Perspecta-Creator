import { useCallback, useEffect, useRef, useState } from "react";
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
import RemoveIcon from "@mui/icons-material/Remove";
import AddIcon from "@mui/icons-material/Add";

const FONTS = ["Arial", "Georgia", "Times New Roman", "Courier New", "Verdana"];
// Os tamanhos que os botões − e + percorrem (em pt, como no Word/Docs).
const PASSOS_PT = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40];

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
// `footer` é o par do `header`, logo DEPOIS do texto: é onde entra a faixa do
// logo no rodapé do contrato, para ela ver o documento inteiro de uma vez.
// `header` é um bloco opcional renderizado ENTRE a barra e o texto (ex.: o logo
// dentro da folha). A barra fica no topo (sticky).
export default function RichEditor({
  value = "", onChange, docKey, minHeight = 260, placeholder = "Escreva aqui…",
  header = null, footer = null,
  // A página do contrato: margem (cm), entrelinha e tamanho do texto (pt).
  // Vindo, o editor passa a ter a MESMA PROPORÇÃO do papel — a largura da
  // coluna de texto aqui é a largura que ela vai ter no A4.
  pagina = null,
}) {
  const ref = useRef(null);
  // A barra mostra o que está valendo. Antes dizia "Arial" e "Normal" para
  // sempre, mesmo depois de trocar — ela mudava o tamanho e o campo continuava
  // dizendo "Normal", como se nada tivesse acontecido.
  const [fonte, setFonte] = useState("Arial");
  // O tamanho mostrado na barra, em pt. Acompanha o trecho onde está o cursor.
  const [tamPt, setTamPt] = useState(12);

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

  /**
   * FONTE E TAMANHO SEM PRECISAR MARCAR O TEXTO ANTES.
   *
   * Pedido dela: "quero poder mudar tamanho de fonte". A letra e o tamanho
   * só valiam para o trecho marcado — quem escolhia "Grande" sem ter marcado
   * nada não via nada acontecer, porque o comando caía no cursor.
   *
   * Agora: tem trecho marcado, vale para ele; não tem, vale para o DOCUMENTO
   * INTEIRO, que é o que se quer num contrato. No fim o texto é
   * desmarcado — deixar tudo azul depois de aplicar assusta.
   */
  // O MESMO estilo que vamos aplicar, mas EMBUTIDO em trechos de dentro, ganha
  // do novo — por isso "escolhi o tamanho e não padronizou". O contrato veio
  // colado do Docs/Word com "font-size: 11pt" (e a fonte) grudado em cada
  // pedaço; antes de aplicar o tamanho novo, tiramos o antigo de dentro do
  // trecho, aí a mudança pega no texto todo.
  const PROP_DO_COMANDO = { fontSize: "font-size", fontName: "font-family" };
  const limparEstiloNaSelecao = (comando) => {
    const prop = PROP_DO_COMANDO[comando];
    const sel = window.getSelection();
    if (!prop || !sel || !sel.rangeCount || !ref.current) return;
    // removeProperty mexe só no atributo style — não tira nenhum nó, então o
    // trecho marcado continua válido para o comando logo em seguida.
    ref.current.querySelectorAll(`[style*="${prop}"]`).forEach((el) => {
      if (sel.containsNode(el, true)) {
        el.style.removeProperty(prop);
        if (!el.getAttribute("style")) el.removeAttribute("style");
      }
    });
  };

  const aplicaNoTexto = (comando, valor) => {
    if (!ref.current) return;
    // O dropdown de tamanho/fonte ROUBA O FOCO do texto. Com o foco ainda no
    // dropdown, o comando caía no vazio e "não mudava nada" — era isso que fazia
    // "escolhi o tamanho e não pegou". Trazer o foco de volta para o texto ANTES
    // de aplicar é o que faltava para a mudança pegar no documento inteiro.
    ref.current.focus();
    const sel = window.getSelection();
    const marcado = Boolean(
      sel && sel.rangeCount > 0 && !sel.isCollapsed &&
      ref.current.contains(sel.anchorNode) && ref.current.contains(sel.focusNode)
    );
    // Sem trecho marcado, vale para o DOCUMENTO INTEIRO — que é o que se quer
    // num contrato ("quero padronizar tudo").
    if (!marcado) {
      const r = document.createRange();
      r.selectNodeContents(ref.current);
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
    // Tira o tamanho/fonte que veio EMBUTIDO de dentro do trecho (colado do
    // Docs/Word), senão ele ganha do valor novo e a mudança não pega no texto
    // todo.
    limparEstiloNaSelecao(comando);
    cmd(comando, valor);
    // Desmarca no fim: deixar o contrato inteiro azul assusta — e, pior, uma
    // tecla a seguir apagaria tudo o que ficou selecionado.
    if (!marcado) window.getSelection()?.collapseToEnd();
  };

  // ---------------------------------------------------------------------------
  // TAMANHO DO TEXTO COM OS BOTÕES − E + (sem perder a marcação).
  //
  // Pedido dela: "o texto não muda o tamanho, coloca botão de aumentar e
  // diminuir pequeno, que aí não desmarca tudo que eu marquei." O dropdown
  // roubava o foco e desmarcava; um botão não desmarca se a gente impedir o
  // mousedown de tirar o foco do texto (onMouseDown preventDefault na barra).
  // ---------------------------------------------------------------------------

  /** O tamanho (pt) do texto onde o cursor/seleção está agora. */
  const tamanhoAtualPt = () => {
    try {
      const sel = window.getSelection();
      let no = sel && sel.anchorNode ? sel.anchorNode : null;
      if (no && no.nodeType === 3) no = no.parentElement;
      if (!no || !ref.current || !ref.current.contains(no)) no = ref.current;
      const px = no ? parseFloat(getComputedStyle(no).fontSize) : 0;
      return px ? Math.max(6, Math.round(px * 0.75)) : 12;   // px → pt
    } catch { return 12; }
  };

  /**
   * Põe o texto marcado (ou o documento todo, se nada marcado) em `pt`.
   * Usa um tamanho "âncora" do execCommand e troca pelo pt de verdade — assim dá
   * para usar qualquer pt, não só os 7 tamanhos que o navegador conhece.
   */
  const aplicaPt = (pt) => {
    const ed = ref.current;
    if (!ed) return;
    ed.focus();
    const sel = window.getSelection();
    const marcado = Boolean(
      sel && sel.rangeCount > 0 && !sel.isCollapsed &&
      ed.contains(sel.anchorNode) && ed.contains(sel.focusNode)
    );
    if (!marcado) {
      const r = document.createRange();
      r.selectNodeContents(ed);
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
    limparEstiloNaSelecao("fontSize");
    try { document.execCommand("styleWithCSS", false, true); } catch { /* ok */ }
    document.execCommand("fontSize", false, "7");   // âncora que trocamos a seguir
    const s2 = window.getSelection();
    ed.querySelectorAll('font[size="7"], [style*="xxx-large"]').forEach((el) => {
      if (s2 && !s2.containsNode(el, true)) return;
      if (el.tagName === "FONT") { el.removeAttribute("size"); el.style.fontSize = `${pt}pt`; }
      else if (/xxx-large/i.test(el.style.fontSize)) el.style.fontSize = `${pt}pt`;
    });
    onChange?.(ed.innerHTML || "");
    setTamPt(pt);
    // Com trecho marcado, MANTÉM a marcação (ela quer continuar vendo o que
    // mexeu, e dar outro passo sem reselecionar). Só o "documento todo" desmarca.
    if (!marcado) window.getSelection()?.collapseToEnd();
  };

  /** Um passo de tamanho para cima (+1) ou para baixo (−1), a partir do atual. */
  const passoDeTamanho = (dir) => {
    const atual = tamanhoAtualPt();
    const alvo = dir > 0
      ? (PASSOS_PT.find((v) => v > atual) ?? atual + 1)
      : ([...PASSOS_PT].reverse().find((v) => v < atual) ?? Math.max(6, atual - 1));
    aplicaPt(alvo);
  };

  // Mantém o número da barra igual ao tamanho de onde o cursor está.
  const sincronizaTamanho = () => setTamPt(tamanhoAtualPt());

  return (
    <Box>
      <Stack direction="row" spacing={0.5} alignItems="center"
        sx={{ flexWrap: "wrap", gap: 0.5, p: 0.75, border: 1, borderColor: "divider", borderRadius: 2, mb: 1, position: "sticky", top: 8, bgcolor: "background.paper", zIndex: 2 }}>
        <Tooltip disableInteractive placement="top" title="Letra. Marque um trecho para mudar só ele — sem nada marcado, muda o texto todo.">
          <Select size="small" value={fonte} sx={{ minWidth: 120 }}
            onChange={(e) => { setFonte(e.target.value); aplicaNoTexto("fontName", e.target.value); }}>
            {FONTS.map((f) => <MenuItem key={f} value={f} sx={{ fontFamily: f }}>{f}</MenuItem>)}
          </Select>
        </Tooltip>
        {/* TAMANHO DO TEXTO: − [12] +. O onMouseDown preventDefault segura o
            foco no texto, então clicar aqui NÃO desmarca o trecho marcado —
            era isso que o dropdown fazia. Marca um trecho e vai no + / −; sem
            nada marcado, muda o texto todo. */}
        <Box onMouseDown={(e) => e.preventDefault()}
          sx={{ display: "flex", alignItems: "center", border: 1, borderColor: "divider", borderRadius: 1.5 }}>
          <Tooltip disableInteractive placement="top" title="Diminuir o tamanho do texto">
            <IconButton size="small" onClick={() => passoDeTamanho(-1)}><RemoveIcon fontSize="small" /></IconButton>
          </Tooltip>
          <Box sx={{ minWidth: 32, textAlign: "center", fontSize: 13, color: "text.secondary",
            fontVariantNumeric: "tabular-nums" }}>{tamPt}</Box>
          <Tooltip disableInteractive placement="top" title="Aumentar o tamanho do texto">
            <IconButton size="small" onClick={() => passoDeTamanho(1)}><AddIcon fontSize="small" /></IconButton>
          </Tooltip>
        </Box>
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
        onMouseUp={sincronizaTamanho}
        onKeyUp={sincronizaTamanho}
        sx={{
          minHeight, borderRadius: 2, border: 1, borderColor: "divider",
          outline: "none", fontFamily: "Georgia, serif", overflowY: "auto",
          // Sem página definida, segue como sempre foi.
          px: pagina ? undefined : 2,
          py: pagina ? undefined : 1.5,
          lineHeight: pagina ? pagina.entrelinha : 1.6,
          fontSize: pagina ? `${pagina.corpo}pt` : undefined,
          // A4 tem 21 cm de largura: a margem em cm vira a MESMA fatia aqui.
          // Assim a coluna de texto na tela tem a proporção da folha.
          paddingLeft: pagina ? `${((pagina.esquerda / 21) * 100).toFixed(2)}%` : undefined,
          paddingRight: pagina ? `${((pagina.direita / 21) * 100).toFixed(2)}%` : undefined,
          paddingTop: pagina ? `${((pagina.topo / 21) * 100).toFixed(2)}%` : undefined,
          paddingBottom: pagina ? `${((pagina.baixo / 21) * 100).toFixed(2)}%` : undefined,
          textAlign: pagina ? "justify" : undefined,
          "& ul, & ol": { pl: 3 },
          "&:empty:before": { content: `"${placeholder}"`, color: "text.disabled" },
        }}
      />
      {footer}
    </Box>
  );
}
