import { createTheme, alpha } from "@mui/material/styles";

// Identidade: laranja sobre cinzas quentes (stone). Três climas: claro,
// bege (sépia) e escuro. A sidebar é terracota nos dois modos claros.
export const ACCENT = { light: "#EA580C", dark: "#F97316" };

// Cor da barra lateral por modo — terracota nos claros, quase-preto no escuro.
export const SIDEBAR = {
  light: { bg: "#9A3412", border: "#7C2D12" },
  sepia: { bg: "#8A3A1E", border: "#6E2E17" },
  dark: { bg: "#0C0A09", border: "#26221F" },
};

// Paletas de fundo/texto por modo.
const PALETTES = {
  light: {
    bgDefault: "#FAFAF9", bgPaper: "#FFFFFF",
    textPrimary: "#1C1917", textSecondary: "#78716C",
    divider: "#E7E5E4", hover: "rgba(28,25,23,0.04)",
  },
  sepia: {
    // Bege quente, nada de branco duro.
    bgDefault: "#F1EADD", bgPaper: "#FBF6EE",
    textPrimary: "#3A322A", textSecondary: "#8A7E6E",
    divider: "#E3D8C6", hover: "rgba(58,50,42,0.05)",
  },
  dark: {
    bgDefault: "#0C0A09", bgPaper: "#151312",
    textPrimary: "#FAFAF9", textSecondary: "#A8A29E",
    divider: "#26221F", hover: "rgba(250,250,249,0.05)",
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
