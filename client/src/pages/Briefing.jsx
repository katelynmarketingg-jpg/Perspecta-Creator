import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Box, Card, CardContent, Typography, TextField, Button, Stack, LinearProgress,
  Chip, Alert, CircularProgress, Divider,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

// ---------------------------------------------------------------------------
// O BRIEFING que o cliente responde — página pública, sem login.
//
// Uma etapa por vez, com barra de progresso. O que ele escreve é salvo a cada
// passo, então dá para fechar no meio e voltar depois pelo mesmo link: é a
// diferença que faz numa entrevista longa, e o que um formulário do Google não
// entrega. Feito para responder pelo celular.
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
  const [passo, setPasso] = useState(0);
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

  // Salva o que já foi digitado. Chamado ao trocar de etapa e ao enviar —
  // assim o cliente nunca perde o que escreveu.
  async function guardar() {
    setSalvando(true);
    try { await api.send(base, "PUT", { respostas }); } catch { /* tenta de novo no próximo passo */ }
    setSalvando(false);
  }

  async function irPara(n) {
    await guardar();
    setPasso(n);
    setFaltando([]);
    topo.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function enviar() {
    setEnviando(true); setErro("");
    try {
      await guardar();
      await api.send(`${base}/enviar`, "POST");
      setPronto(true);
    } catch (e) {
      setErro(e.message);
      setFaltando(e.dados?.faltando || []);
    } finally { setEnviando(false); }
  }

  if (erro && !dados) {
    return (
      <Tela>
        <Alert severity="error">{erro}</Alert>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Peça um link novo para quem cuida das suas redes.
        </Typography>
      </Tela>
    );
  }
  if (!dados) return <Tela><CircularProgress /></Tela>;

  if (pronto) {
    return (
      <Tela>
        <Stack alignItems="center" spacing={2} sx={{ py: 4, textAlign: "center" }}>
          <CheckCircleIcon color="success" sx={{ fontSize: 64 }} />
          <Typography variant="h5">Recebemos, obrigado!</Typography>
          <Typography variant="body1" color="text.secondary">
            Suas respostas já estão com a equipe da <b>{dados.agency_name}</b>. É com elas que
            vamos escrever no jeito certo do seu negócio.
          </Typography>
        </Stack>
      </Tela>
    );
  }

  const secao = dados.secoes[passo];
  const ultima = passo === dados.secoes.length - 1;
  const preenchidas = Object.values(respostas).filter((v) => String(v || "").trim()).length;
  const total = dados.secoes.reduce((n, s) => n + s.perguntas.length, 0);
  const pct = Math.round((preenchidas / total) * 100);

  const setResp = (id, v) => setRespostas((r) => ({ ...r, [id]: v }));

  return (
    <Tela>
      <Box ref={topo} />
      <Typography variant="overline" color="text.secondary">{dados.agency_name}</Typography>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        Briefing — {dados.client_name}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        São {dados.secoes.length} etapas curtas. Pode fechar e voltar depois pelo mesmo
        link — o que você escrever fica salvo.
      </Typography>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          Etapa {passo + 1} de {dados.secoes.length}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {salvando ? "salvando…" : `${pct}% respondido`}
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={pct} sx={{ height: 8, borderRadius: 4, mb: 3 }} />

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" sx={{ mb: 0.5 }}>{secao.titulo}</Typography>
          {secao.intro && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>{secao.intro}</Typography>
          )}

          <Stack spacing={3}>
            {secao.perguntas.map((p) => (
              <Pergunta key={p.id} p={p} valor={respostas[p.id]} onChange={(v) => setResp(p.id, v)}
                faltando={faltando.includes(p.id)} />
            ))}
          </Stack>
        </CardContent>
      </Card>

      {erro && <Alert severity="warning" sx={{ mt: 2 }}>{erro}</Alert>}

      <Stack direction="row" spacing={1.5} sx={{ mt: 3, mb: 6 }}>
        <Button startIcon={<ArrowBackIcon />} disabled={passo === 0 || salvando}
          onClick={() => irPara(passo - 1)}>Voltar</Button>
        <Box sx={{ flex: 1 }} />
        {ultima ? (
          <Button variant="contained" size="large" onClick={enviar} disabled={enviando}>
            {enviando ? "Enviando…" : "Enviar briefing"}
          </Button>
        ) : (
          <Button variant="contained" size="large" endIcon={<ArrowForwardIcon />}
            onClick={() => irPara(passo + 1)} disabled={salvando}>
            Continuar
          </Button>
        )}
      </Stack>
    </Tela>
  );
}

function Pergunta({ p, valor, onChange, faltando }) {
  if (p.tipo === "escolhas") {
    const selecionadas = String(valor || "").split(",").map((s) => s.trim()).filter(Boolean);
    const alterna = (o) => {
      if (p.multipla) {
        const novo = selecionadas.includes(o)
          ? selecionadas.filter((x) => x !== o)
          : [...selecionadas, o];
        onChange(novo.join(", "));
      } else {
        onChange(selecionadas[0] === o ? "" : o);   // clicar de novo desmarca
      }
    };
    return (
      <Box>
        <Rotulo p={p} faltando={faltando} />
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, mt: 1 }}>
          {p.opcoes.map((o) => (
            <Chip key={o} label={o} clickable onClick={() => alterna(o)}
              color={selecionadas.includes(o) ? "primary" : "default"}
              variant={selecionadas.includes(o) ? "filled" : "outlined"} />
          ))}
        </Stack>
        {p.multipla && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
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
        error={faltando} sx={{ mt: 1 }} placeholder={p.tipo === "longo" ? "Escreva com suas palavras…" : ""} />
    </Box>
  );
}

function Rotulo({ p, faltando }) {
  return (
    <>
      <Typography sx={{ fontWeight: 600, fontSize: 15.5 }}>
        {p.label}{p.obrigatoria && <Box component="span" sx={{ color: "error.main" }}> *</Box>}
      </Typography>
      {p.ajuda && <Typography variant="body2" color="text.secondary">{p.ajuda}</Typography>}
      {faltando && <Typography variant="caption" color="error.main">Esta a gente precisa mesmo.</Typography>}
    </>
  );
}

// Moldura simples e centralizada: a página é aberta por alguém de fora, num
// celular na maior parte das vezes.
function Tela({ children }) {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", py: { xs: 3, sm: 6 }, px: 2 }}>
      <Box sx={{ maxWidth: 640, mx: "auto" }}>{children}</Box>
    </Box>
  );
}
