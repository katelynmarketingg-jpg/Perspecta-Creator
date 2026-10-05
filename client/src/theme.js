import { createTheme, alpha } from "@mui/material/styles";

// A PALETA DA MARCA, como ela definiu.
//
//   terracota  #ab480a   a barra lateral
//   off        #ede9de   o fundo claro
//   detalhes   #c9c2b2   os traços e as bordas
//              #333333   o texto
//   noturno    #000000   o fundo escuro
//
// Tudo abaixo sai daqui. Os poucos tons que não estão na lista são derivados
// destes (um terracota mais fechado para a borda da lateral, um preto um grau
// acima do #000 para os cartões do modo escuro não sumirem no fundo) — e estão
// marcados onde aparecem.
const MARCA_TERRACOTA = "#ab480a";

export const MARCA = {
  terracota: MARCA_TERRACOTA,
  off: "#ede9de",
  detalhe: "#c9c2b2",
  texto: "#333333",
  noturno: "#000000",
};

// Identidade: o terracota da marca sobre o off-white dela. Três climas: claro,
// bege (sépia) e escuro. A sidebar é terracota nos dois modos claros.
//
// O destaque (botões, selos, o que é clicável) ERA um laranja mais aberto,
// #EA580C, de antes de a paleta existir — e brigava com o terracota da lateral
// na mesma tela. Agora é o próprio terracota.
//
// No escuro ele é clareado: #ab480a sobre preto fica fechado demais, e texto
// branco em cima de botão nessa cor perde leitura. É o mesmo tom, com luz.
export const ACCENT = { light: MARCA_TERRACOTA, dark: "#D1621A" };

// Cor da barra lateral por modo — terracota nos claros, preto no escuro.
export const SIDEBAR = {
  light: { bg: MARCA.terracota, border: "#8A3A08" },   // borda: o terracota um grau mais fechado
  sepia: { bg: MARCA.terracota, border: "#8A3A08" },
  dark: { bg: MARCA.noturno, border: "#232323" },
};

// Paletas de fundo/texto por modo.
const PALETTES = {
  light: {
    // O off é o fundo; o cartão é branco, para ele se destacar do fundo.
    bgDefault: MARCA.off, bgPaper: "#FFFFFF",
    textPrimary: MARCA.texto, textSecondary: "#6F6A5F",   // o texto com menos peso
    divider: MARCA.detalhe, hover: "rgba(51,51,51,0.05)",
  },
  sepia: {
    // O mesmo bege, um grau mais quente: aqui o cartão é o próprio off.
    bgDefault: "#E4DECF", bgPaper: MARCA.off,
    textPrimary: MARCA.texto, textSecondary: "#6F6A5F",
    divider: MARCA.detalhe, hover: "rgba(51,51,51,0.06)",
  },
  dark: {
    // Preto de verdade no fundo. O cartão é um grau acima — no preto puro os
    // dois se fundiriam e não daria para ver onde um cartão começa.
    bgDefault: MARCA.noturno, bgPaper: "#121212",
    textPrimary: MARCA.off, textSecondary: MARCA.detalhe,
    divider: "#2A2A2A", hover: "rgba(237,233,222,0.06)",
  },
};

export function getTheme(mode) {
  const dark = mode === "dark";
  const p = PALETTES[mode] || PALETTES.light;
  const accent = dark ? ACCENT.dark : ACCENT.light;

  return createTheme({
    palette: {
      mode: dark ? "dark" : "light",
      primary: { main: accent, contrastText: "#FFFFFF" },
      secondary: { main: dark ? "#FAFAF9" : "#1C1917" },
      background: { default: p.bgDefault, paper: p.bgPaper },
      text: { primary: p.textPrimary, secondary: p.textSecondary },
      divider: p.divider,
      success: { main: dark ? "#4ADE80" : "#16A34A" },
      warning: { main: dark ? "#FB923C" : "#D97706" },
      error: { main: dark ? "#F87171" : "#DC2626" },
      action: { hover: p.hover },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif',
      h4: { fontFamily: '"Outfit", sans-serif', fontWeight: 700, letterSpacing: "-0.02em" },
      h5: { fontFamily: '"Outfit", sans-serif', fontWeight: 700, letterSpacing: "-0.02em" },
      h6: { fontFamily: '"Outfit", sans-serif', fontWeight: 600, letterSpacing: "-0.01em" },
      subtitle2: { fontWeight: 600 },
      button: { textTransform: "none", fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            transition: "background-color .25s ease",
            fontVariantNumeric: "tabular-nums",
          },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: ({ theme }) => ({
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 14,
            backgroundImage: "none",
          }),
        },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            transition: "transform .15s ease, box-shadow .2s ease, background-color .2s ease",
            "&:active": { transform: "scale(0.98)" },
          },
          containedPrimary: {
            boxShadow: `0 6px 16px -6px ${alpha(accent, 0.55)}`,
            "&:hover": {
              transform: "translateY(-1px)",
              boxShadow: `0 10px 22px -8px ${alpha(accent, 0.6)}`,
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: { root: { fontWeight: 600, borderRadius: 8 } },
      },
      MuiTableCell: {
        styleOverrides: {
          head: ({ theme }) => ({
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: theme.palette.text.secondary,
            borderBottomColor: theme.palette.divider,
          }),
          root: ({ theme }) => ({ borderBottomColor: theme.palette.divider }),
        },
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: 16, backgroundImage: "none" } },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: alpha(accent, theme.palette.mode === "dark" ? 0.18 : 0.12),
          }),
        },
      },
      MuiTab: { styleOverrides: { root: { fontWeight: 600 } } },
    },
  });
}

export default getTheme("light");
