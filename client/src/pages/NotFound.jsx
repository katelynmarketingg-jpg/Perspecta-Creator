import { Link as RouterLink } from "react-router-dom";
import { Box, Button, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";

export default function NotFound() {
  return (
    <Box
      sx={{
        minHeight: "100dvh", display: "grid", placeItems: "center", p: 2,
        bgcolor: "#0C0A09",
        backgroundImage: "radial-gradient(800px 420px at 50% -10%, rgba(234,88,12,0.22), transparent 60%)",
      }}
    >
      <Box sx={{ textAlign: "center" }}>
        <Typography
          sx={{
            fontFamily: '"Outfit", sans-serif', fontWeight: 800, letterSpacing: "-0.04em",
            fontSize: { xs: 96, sm: 140 }, lineHeight: 1, color: "#FAFAF9",
          }}
        >
          4<Box component="span" sx={{ color: "#F97316" }}>0</Box>4
        </Typography>
        <Typography sx={{ color: "#A8A29E", mb: 3, mt: 1 }}>
          Esta página não existe ou foi movida.
        </Typography>
        <Button component={RouterLink} to="/" variant="contained" startIcon={<ArrowBackIcon />}>
          Voltar ao início
        </Button>
      </Box>
    </Box>
  );
}
