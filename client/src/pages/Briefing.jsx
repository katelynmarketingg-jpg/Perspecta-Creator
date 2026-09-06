import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Box, Typography, TextField, Button, Stack, Chip, Alert, CircularProgress, Fade,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import FavoriteRoundedIcon from "@mui/icons-material/FavoriteRounded";

// ---------------------------------------------------------------------------
// O BRIEFING que o cliente responde — página pública, sem login.
//
// A primeira tela não pede nada: recebe a pessoa, explica por que aquilo
// importa e quanto tempo leva. Quem entende o porquê responde melhor — e um
// briefing respondido pela metade não serve para escrever no jeito de ninguém.
//
// Depois, uma etapa por vez, com o que já foi escrito salvo a cada passo:
// dá para fechar no meio e voltar depois pelo mesmo link. Feito para o celular.
// ---------------------------------------------------------------------------

const api = {
  async get(url) {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Não consegui abrir.");
    return j;
  },
  async send(url, metodo, corpo) {
    const r = await fetch(url, {
      method: metodo, headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || "Não consegui salvar."); e.dados = j; throw e; }
    return j;
  },
};

export default function Briefing() {
  const { token } = useParams();
  const base = `/api/briefing/${token}`;

  const [dados, setDados] = useState(null);
  const [respostas, setRespostas] = useState({});
  const [passo, setPasso] = useState(-1);        // -1 = tela de boas-vindas
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [faltando, setFaltando] = useState([]);
  const topo = useRef(null);

  useEffect(() => {
    api.get(base)
      .then((d) => {
        setDados(d);
        setRespostas(d.respostas || {});
        if (d.status !== "aberto") setPronto(true);
      })
      .catch((e) => setErro(e.message));
  }, [base]);

  // Salva o que já foi digitado — chamado ao trocar de etapa e ao enviar.
  async function guardar() {
    setSalvando(true);
    try { await api.send(base, "PUT", { respostas }); } catch { /* tenta de novo no próximo passo */ }
    setSalvando(false);
  }

  async function irPara(n) {
    if (passo >= 0) await guardar();
    setPasso(n);
    setFaltando([]);
    setErro("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function enviar() {
    setEnviando(true); setErro("");
    try {
      await guardar();
      await api.send(`${base}/enviar`, "POST");
      setPronto(true);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setErro(e.message);
      setFaltando(e.dados?.faltando || []);
    } finally { setEnviando(false); }
  }

  // ---- estados de exceção -------------------------------------------------
  if (erro && !dados) {
    return (
      <Tela>
        <Cartao>
          <Typography variant="h6" sx={{ mb: 1 }}>Este link não está mais valendo</Typography>
          <Typography color="text.secondary">
            {erro} Peça um link novo para quem cuida das suas redes — leva um segundo.
          </Typography>
        </Cartao>
      </Tela>
    );
  }
  if (!dados) {
    return <Tela><Stack alignItems="center" sx={{ py: 10 }}><CircularProgress /></Stack></Tela>;
  }

  // ---- fim ----------------------------------------------------------------
  if (pronto) {
    return (
      <Tela logo={dados.agency_logo}>
        <Fade in>
          <Box sx={{ textAlign: "center", py: { xs: 4, sm: 7 } }}>
            <Box sx={{
              width: 92, height: 92, borderRadius: "50%", mx: "auto", mb: 3,
              display: "grid", placeItems: "center",
              bgcolor: (t) => alpha(t.palette.success.main, 0.12),
            }}>
              <CheckCircleRoundedIcon color="success" sx={{ fontSize: 54 }} />
            </Box>
            <Typography variant="h4" sx={{ fontWeight: 800, mb: 1.5, letterSpacing: "-0.02em" }}>
              Recebemos. Obrigado!
            </Typography>
            <Typography sx={{ fontSize: 17, color: "text.secondary", maxWidth: 460, mx: "auto", lineHeight: 1.7 }}>
              Suas respostas já estão com a equipe da <b>{dados.agency_name}</b>. É com elas que
              vamos escrever com a sua voz — e não com a de qualquer um.
            </Typography>
            <Stack direction="row" spacing={1} justifyContent="center" alignItems="center"
              sx={{ mt: 4, color: "text.disabled" }}>
              <FavoriteRoundedIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">Pode fechar esta página.</Typography>
            </Stack>
          </Box>
        </Fade>
      </Tela>
    );
  }

  // ---- boas-vindas --------------------------------------------------------
  if (passo === -1) {
    const jaComecou = Object.values(respostas).some((v) => String(v || "").trim());
    return (
      <Tela logo={dados.agency_logo}>
        <Fade in>
          <Box>
            <Typography sx={{
              fontSize: { xs: 30, sm: 40 }, fontWeight: 800, lineHeight: 1.12,
              letterSpacing: "-0.03em", mb: 2.5,
            }}>
              Seja bem-vindo à{" "}
              <Box component="span" sx={{ color: "primary.main" }}>{dados.agency_name}</Box>.
            </Typography>

            <Stack spacing={2} sx={{ fontSize: 17, lineHeight: 1.75, color: "text.secondary", mb: 4 }}>
              <Typography sx={{ fontSize: "inherit", lineHeight: "inherit" }}>
                Se você recebeu este link, é porque deu um passo importante: decidiu que a
                comunicação de <b style={{ color: "inherit" }}>{dados.client_name}</b> merece
                ser feita com intenção, e não no improviso.
              </Typography>
              <Typography sx={{ fontSize: "inherit", lineHeight: "inherit" }}>
                O que vem a seguir é uma conversa. Queremos entender o seu negócio de verdade —
                o que você vende, para quem, o que te diferencia e, principalmente,{" "}
                <b style={{ color: "inherit" }}>como você fala</b>. É isso que faz um conteúdo
                parecer seu, e não de qualquer empresa do seu ramo.
              </Typography>
              <Typography sx={{ fontSize: "inherit", lineHeight: "inherit" }}>
                Não existe resposta errada aqui. Escreva do seu jeito, como se estivesse
                explicando para um amigo. Quanto mais você contar, menos a gente vai precisar
                adivinhar.
              </Typography>
            </Stack>

            <Stack spacing={1.5} sx={{ mb: 4 }}>
              <Aviso icone={<ChatBubbleOutlineRoundedIcon />} titulo={`${dados.secoes.length} etapas curtas`}
                texto="Uma de cada vez, sem pressa e sem rolagem infinita." />
              <Aviso icone={<ScheduleRoundedIcon />} titulo="Cerca de 10 minutos"
                texto="Menos do que uma reunião — e vale por várias." />
              <Aviso icone={<SaveRoundedIcon />} titulo="Salva sozinho"
                texto="Pode fechar no meio e voltar depois pelo mesmo link. Nada se perde." />
            </Stack>

            <Button variant="contained" size="large" onClick={() => irPara(0)}
              endIcon={<ArrowForwardRoundedIcon />}
              sx={{ px: 4, py: 1.5, fontSize: 16.5, fontWeight: 700, borderRadius: 2.5 }}>
              {jaComecou ? "Continuar de onde parei" : "Vamos começar"}
            </Button>
            {jaComecou && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
                Você já respondeu {dados.progresso}% — o resto está esperando por você.
              </Typography>
            )}
          </Box>
        </Fade>
      </Tela>
    );
  }

  // ---- etapas -------------------------------------------------------------
  const secao = dados.secoes[passo];
  const ultima = passo === dados.secoes.length - 1;
  const total = dados.secoes.reduce((n, s) => n + s.perguntas.length, 0);
  const preenchidas = Object.values(respostas).filter((v) => String(v || "").trim()).length;
  const pct = Math.round((preenchidas / total) * 100);
  const setResp = (id, v) => setRespostas((r) => ({ ...r, [id]: v }));

  return (
    <Tela logo={dados.agency_logo}>
      <Box ref={topo} />

      {/* Trilha de etapas: mostra onde está sem virar barrinha genérica */}
      <Stack direction="row" spacing={0.75} sx={{ mb: 1.25 }}>
        {dados.secoes.map((s, i) => (
          <Box key={s.id} onClick={() => i < passo && irPara(i)}
            sx={{
              flex: 1, height: 5, borderRadius: 3, cursor: i < passo ? "pointer" : "default",
              transition: "background-color .25s ease",
              bgcolor: (t) => i < passo ? alpha(t.palette.primary.main, 0.55)
                : i === passo ? t.palette.primary.main
                : alpha(t.palette.text.primary, 0.1),
            }} />
        ))}
      </Stack>
      <Stack direction="row" sx={{ mb: 4 }}>
        <Typography variant="caption" color="text.secondary">
          Etapa {passo + 1} de {dados.secoes.length}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {salvando ? "salvando…" : `${pct}% respondido`}
        </Typography>
      </Stack>

      <Fade in key={secao.id}>
        <Box>
          <Typography sx={{
            fontSize: { xs: 26, sm: 32 }, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.2,
          }}>
            {secao.titulo}
          </Typography>
          {secao.intro && (
            <Typography sx={{ fontSize: 16.5, color: "text.secondary", mt: 1, mb: 4, lineHeight: 1.6 }}>
              {secao.intro}
            </Typography>
          )}

          <Stack spacing={3.5}>
            {secao.perguntas.map((p) => (
              <Pergunta key={p.id} p={p} valor={respostas[p.id]} onChange={(v) => setResp(p.id, v)}
                faltando={faltando.includes(p.id)} />
            ))}
          </Stack>
        </Box>
      </Fade>

      {erro && <Alert severity="warning" sx={{ mt: 3, borderRadius: 2 }}>{erro}</Alert>}

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 5, mb: 8 }}>
        <Button startIcon={<ArrowBackRoundedIcon />} disabled={salvando} color="inherit"
          onClick={() => irPara(passo - 1)} sx={{ color: "text.secondary" }}>
          Voltar
        </Button>
        <Box sx={{ flex: 1 }} />
        {ultima ? (
          <Button variant="contained" size="large" onClick={enviar} disabled={enviando}
            sx={{ px: 3.5, py: 1.35, fontSize: 16, fontWeight: 700, borderRadius: 2.5 }}>
            {enviando ? "Enviando…" : "Enviar briefing"}
          </Button>
        ) : (
          <Button variant="contained" size="large" endIcon={<ArrowForwardRoundedIcon />}
            onClick={() => irPara(passo + 1)} disabled={salvando}
            sx={{ px: 3.5, py: 1.35, fontSize: 16, fontWeight: 700, borderRadius: 2.5 }}>
            Continuar
          </Button>
        )}
      </Stack>
    </Tela>
  );
}

// --- pedaços --------------------------------------------------------------

function Aviso({ icone, titulo, texto }) {
  return (
    <Stack direction="row" spacing={1.75} alignItems="flex-start">
      <Box sx={{
        width: 38, height: 38, borderRadius: 2, flexShrink: 0, display: "grid", placeItems: "center",
        bgcolor: (t) => alpha(t.palette.primary.main, 0.1), color: "primary.main",
        "& svg": { fontSize: 20 },
      }}>{icone}</Box>
      <Box>
        <Typography sx={{ fontWeight: 700, fontSize: 15 }}>{titulo}</Typography>
        <Typography variant="body2" color="text.secondary">{texto}</Typography>
      </Box>
    </Stack>
  );
}

function Pergunta({ p, valor, onChange, faltando }) {
  if (p.tipo === "escolhas") {
    const marcadas = String(valor || "").split(",").map((s) => s.trim()).filter(Boolean);
    const alterna = (o) => {
      if (p.multipla) {
        onChange((marcadas.includes(o) ? marcadas.filter((x) => x !== o) : [...marcadas, o]).join(", "));
      } else {
        onChange(marcadas[0] === o ? "" : o);   // clicar de novo desmarca
      }
    };
    return (
      <Box>
        <Rotulo p={p} faltando={faltando} />
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, mt: 1.5 }}>
          {p.opcoes.map((o) => (
            <Chip key={o} label={o} clickable onClick={() => alterna(o)}
              color={marcadas.includes(o) ? "primary" : "default"}
              variant={marcadas.includes(o) ? "filled" : "outlined"}
              sx={{ height: 38, borderRadius: 2, px: 0.5, fontSize: 14.5 }} />
          ))}
        </Stack>
        {p.multipla && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            Pode marcar mais de uma.
          </Typography>
        )}
      </Box>
    );
  }
  return (
    <Box>
      <Rotulo p={p} faltando={faltando} />
      <TextField fullWidth value={valor || ""} onChange={(e) => onChange(e.target.value)}
        multiline={p.tipo === "longo"} minRows={p.tipo === "longo" ? 3 : 1}
        error={faltando} sx={{ mt: 1.5, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 16 } }}
        placeholder={p.tipo === "longo" ? "Escreva do seu jeito…" : ""} />
    </Box>
  );
}

function Rotulo({ p, faltando }) {
  return (
    <>
      <Typography sx={{ fontWeight: 700, fontSize: 17, lineHeight: 1.35 }}>
        {p.label}
        {p.obrigatoria && <Box component="span" sx={{ color: "primary.main" }}> *</Box>}
      </Typography>
      {p.ajuda && (
        <Typography sx={{ fontSize: 14.5, color: "text.secondary", mt: 0.4 }}>{p.ajuda}</Typography>
      )}
      {faltando && (
        <Typography variant="caption" color="error.main" sx={{ display: "block", mt: 0.4 }}>
          Esta a gente precisa mesmo.
        </Typography>
      )}
    </>
  );
}

function Cartao({ children }) {
  return (
    <Box sx={{ p: 3, borderRadius: 3, bgcolor: "background.paper", border: 1, borderColor: "divider" }}>
      {children}
    </Box>
  );
}

// Moldura: um brilho quente da cor da marca no alto e muito ar em volta. Quem
// abre isso está no celular, provavelmente pela primeira vez.
function Tela({ children, logo }) {
  return (
    <Box sx={{
      minHeight: "100vh", bgcolor: "background.default",
      backgroundImage: (t) =>
        `radial-gradient(1100px 480px at 50% -12%, ${alpha(t.palette.primary.main, 0.14)}, transparent 70%)`,
      px: 2.5, pt: { xs: 4, sm: 7 }, pb: 6,
    }}>
      <Box sx={{ maxWidth: 620, mx: "auto" }}>
        {logo && (
          <Box component="img" src={logo} alt=""
            sx={{ height: 40, maxWidth: 190, objectFit: "contain", display: "block", mb: 4 }} />
        )}
        {children}
      </Box>
    </Box>
  );
}
