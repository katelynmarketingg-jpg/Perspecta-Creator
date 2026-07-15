import { createTheme, alpha } from "@mui/material/styles";

// Identidade: preto, branco e laranja. Cinzas quentes (stone) em toda a UI.
export const ACCENT = { light: "#EA580C", dark: "#F97316" };

export function getTheme(mode) {
  const dark = mode === "dark";
  const accent = dark ? ACCENT.dark : ACCENT.light;

  return createTheme({
    palette: {
      mode,
      primary: { main: accent, contrastText: "#FFFFFF" },
      secondary: { main: dark ? "#FAFAF9" : "#1C1917" },
      background: dark
        ? { default: "#0C0A09", paper: "#151312" }
        : { default: "#FAFAF9", paper: "#FFFFFF" },
      text: dark
        ? { primary: "#FAFAF9", secondary: "#A8A29E" }
        : { primary: "#1C1917", secondary: "#78716C" },
      divider: dark ? "#26221F" : "#E7E5E4",
      success: { main: dark ? "#4ADE80" : "#16A34A" },
      warning: { main: dark ? "#FB923C" : "#D97706" },
      error: { main: dark ? "#F87171" : "#DC2626" },
      action: {
        hover: dark ? "rgba(250,250,249,0.05)" : "rgba(28,25,23,0.04)",
      },
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
