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

  // `manterAviso` é usado ao clicar numa pergunta que faltou: a lista some, mas
  // o campo continua destacado na etapa de destino — senão a pessoa chega lá e
  // não sabe qual era.
  async function irPara(n, manterAviso = false) {
    if (passo >= 0) await guardar();
    setPasso(n);
    if (!manterAviso) { setFaltando([]); setErro(""); }
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

  // ---- fim: contrato + acesso ---------------------------------------------
  if (pronto) return <Concluido base={base} dados={dados} />;

  // ---- boas-vindas --------------------------------------------------------
  if (passo === -1) {
    const jaComecou = Object.values(respostas).some((v) => String(v || "").trim());
    const bv = dados.welcome || {};
    return (
      <Tela logo={dados.agency_logo}>
        <Fade in>
          <Box>
            {/* O texto é o que o escritório escreveu na aba Briefing. */}
            <Typography sx={{
              fontSize: { xs: 30, sm: 40 }, fontWeight: 800, lineHeight: 1.12,
              letterSpacing: "-0.03em", mb: 2.5,
            }}>
              {troca(bv.titulo, dados)}
            </Typography>

            <Stack spacing={2} sx={{ fontSize: 17, lineHeight: 1.75, color: "text.secondary", mb: 4 }}>
              {bv.paragrafos.map((t, i) => (
                <Typography key={i} sx={{ fontSize: "inherit", lineHeight: "inherit" }}>
                  {troca(t, dados)}
                </Typography>
              ))}
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
              {jaComecou ? "Continuar de onde parei" : bv.botao}
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
                faltando={faltando.includes(p.id)} base={base} />
            ))}
          </Stack>
        </Box>
      </Fade>

      {erro && (
        <Alert severity="warning" sx={{ mt: 3, borderRadius: 2 }}>
          {erro}
          {/* Dizer QUAIS faltam, e levar até elas: a pessoa está na última etapa
              e não tem como adivinhar o que ficou para trás. */}
          {faltando.length > 0 && (
            <Box sx={{ mt: 1 }}>
              {faltando.map((id) => {
                const i = dados.secoes.findIndex((sec) => sec.perguntas.some((q) => q.id === id));
                const q = i >= 0 && dados.secoes[i].perguntas.find((x) => x.id === id);
                if (!q) return null;
                return (
                  <Box key={id} component="button" type="button" onClick={() => irPara(i, true)}
                    sx={{
                      display: "block", width: "100%", textAlign: "left", border: 0, p: 0, mt: 0.4,
                      bgcolor: "transparent", cursor: "pointer", font: "inherit", fontSize: 13,
                      color: "inherit", opacity: 0.9, "&:hover": { textDecoration: "underline" },
                    }}>
                    • {q.label}
                    <Box component="span" sx={{ opacity: 0.65 }}> — etapa {i + 1}</Box>
                  </Box>
                );
              })}
            </Box>
          )}
        </Alert>
      )}

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

// ---------------------------------------------------------------------------
// A tela de depois do briefing. A pessoa acabou de contar tudo sobre o negócio
// dela — é a hora de resolver o resto de uma vez: assinar o contrato e abrir o
// próprio acesso. Ela pode voltar a este mesmo link depois, se quiser.
// ---------------------------------------------------------------------------
function Concluido({ base, dados }) {
  const [passos, setPassos] = useState(null);
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState("");
  const [criado, setCriado] = useState(null);

  const carregar = () => api.get(`${base}/proximos-passos`).then(setPassos).catch(() => {});
  useEffect(() => { carregar(); }, [base]);

  async function criarAcesso() {
    setErro("");
    if (senha !== confirma) { setErro("As duas senhas não são iguais."); return; }
    setCriando(true);
    try {
      const r = await api.send(`${base}/acesso`, "POST", { usuario, senha });
      setCriado(r);
      await carregar();
    } catch (e) { setErro(e.message); }
    finally { setCriando(false); }
  }

  const temAcesso = criado || passos?.tem_acesso;
  const contrato = passos?.contrato;

  return (
    <Tela logo={dados.agency_logo}>
      <Fade in>
        <Box>
          <Box sx={{ textAlign: "center", mb: 5 }}>
            <Box sx={{
              width: 76, height: 76, borderRadius: "50%", mx: "auto", mb: 2.5,
              display: "grid", placeItems: "center",
              bgcolor: (t) => alpha(t.palette.success.main, 0.12),
            }}>
              <CheckCircleRoundedIcon color="success" sx={{ fontSize: 46 }} />
            </Box>
            <Typography sx={{ fontSize: { xs: 27, sm: 34 }, fontWeight: 800, letterSpacing: "-0.02em", mb: 1.5 }}>
              Recebemos. Obrigado!
            </Typography>
            <Typography sx={{ fontSize: 16.5, color: "text.secondary", lineHeight: 1.7, maxWidth: 470, mx: "auto" }}>
              Suas respostas já estão com a equipe da <b>{dados.agency_name}</b>. É com elas que vamos
              escrever com a sua voz — e não com a de qualquer um.
            </Typography>
          </Box>

          <Typography sx={{ fontWeight: 800, fontSize: 19, mb: 0.5 }}>Faltam só dois passos</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Dá para resolver agora, aqui mesmo. Se preferir, volte a este link depois — ele continua seu.
          </Typography>

          <Stack spacing={2}>
            {/* ---- 1. contrato ---- */}
            <Passo numero="1" titulo="Seu contrato" pronto={contrato?.assinado}>
              {contrato?.assinado ? (
                <Typography variant="body2" color="text.secondary">
                  Assinado — está tudo certo. Você encontra a via no seu acesso, quando quiser.
                </Typography>
              ) : contrato?.url ? (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Já está pronto, com os seus dados preenchidos. Leia com calma e assine por aqui —
                    não precisa imprimir nem escanear nada.
                  </Typography>
                  <Button variant="contained" component="a" href={contrato.url} target="_blank" rel="noreferrer"
                    endIcon={<ArrowForwardRoundedIcon />}
                    sx={{ px: 3, py: 1.2, borderRadius: 2, fontWeight: 700 }}>
                    Ler e assinar
                  </Button>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  A equipe está preparando o seu contrato com os dados que você acabou de enviar.
                  Assim que ficar pronto, ele aparece aqui — e você recebe um aviso.
                </Typography>
              )}
            </Passo>

            {/* ---- 2. acesso ---- */}
            <Passo numero="2" titulo="Seu acesso" pronto={Boolean(temAcesso)}>
              {temAcesso ? (
                <>
                  <Alert severity="success" sx={{ borderRadius: 2, mb: 2 }}>
                    Acesso criado! Seu nome de acesso é <b>{criado?.usuario || passos?.usuario}</b>.
                    Guarde a senha que você escolheu — ela é só sua.
                  </Alert>
                  <Button variant="contained" component="a"
                    href={criado?.portal_url || passos?.portal_url} target="_blank" rel="noreferrer"
                    endIcon={<ArrowForwardRoundedIcon />}
                    sx={{ px: 3, py: 1.2, borderRadius: 2, fontWeight: 700 }}>
                    Entrar na minha área
                  </Button>
                </>
              ) : (
                <>
                  <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.75, mb: 2 }}>
                    É a sua área dentro da {dados.agency_name} — um lugar só seu, aberto o tempo todo.
                    Lá você <b>vê os conteúdos antes de irem ao ar</b> e aprova ou pede ajuste;
                    acompanha a <b>prévia do seu feed</b>, para saber como o perfil vai ficar;
                    <b> manda fotos e vídeos</b> que achar importantes, a qualquer hora; e ainda
                    encontra o <b>contrato</b> e os <b>pagamentos</b> reunidos, sem precisar procurar
                    conversa antiga.
                  </Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary", mb: 2.5 }}>
                    Escolha agora como quer entrar:
                  </Typography>
                  <Stack spacing={2}>
                    <TextField label="Nome de acesso" value={usuario} fullWidth
                      onChange={(e) => setUsuario(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))}
                      helperText="Letras e números, sem espaço. Ex.: knadvocacia"
                      sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
                    <TextField label="Senha" type="password" value={senha} fullWidth
                      onChange={(e) => setSenha(e.target.value)}
                      helperText="No mínimo 6 caracteres"
                      sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
                    <TextField label="Repita a senha" type="password" value={confirma} fullWidth
                      onChange={(e) => setConfirma(e.target.value)}
                      sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
                    {erro && <Alert severity="warning" sx={{ borderRadius: 2 }}>{erro}</Alert>}
                    <Button variant="contained" onClick={criarAcesso}
                      disabled={criando || usuario.length < 3 || senha.length < 6}
                      sx={{ alignSelf: "flex-start", px: 3, py: 1.2, borderRadius: 2, fontWeight: 700 }}>
                      {criando ? "Criando…" : "Criar meu acesso"}
                    </Button>
                  </Stack>
                </>
              )}
            </Passo>
          </Stack>

          <Stack direction="row" spacing={1} justifyContent="center" alignItems="center"
            sx={{ mt: 5, mb: 4, color: "text.disabled" }}>
            <FavoriteRoundedIcon sx={{ fontSize: 15 }} />
            <Typography variant="caption">Que venha muito conteúdo bom pela frente.</Typography>
          </Stack>
        </Box>
      </Fade>
    </Tela>
  );
}

function Passo({ numero, titulo, pronto, children }) {
  return (
    <Box sx={{
      p: { xs: 2.5, sm: 3 }, borderRadius: 3, border: 1, borderColor: "divider",
      bgcolor: "background.paper",
    }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
        <Box sx={{
          width: 30, height: 30, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
          fontSize: 14, fontWeight: 800,
          bgcolor: (t) => pronto ? alpha(t.palette.success.main, 0.15) : alpha(t.palette.primary.main, 0.12),
          color: pronto ? "success.main" : "primary.main",
        }}>
          {pronto ? "✓" : numero}
        </Box>
        <Typography sx={{ fontWeight: 800, fontSize: 18 }}>{titulo}</Typography>
      </Stack>
      {children}
    </Box>
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

function Pergunta({ p, valor, onChange, faltando, base }) {
  if (p.tipo === "cnpj") return <PerguntaCnpj p={p} valor={valor} onChange={onChange} faltando={faltando} />;
  if (p.tipo === "dia") return <PerguntaDia p={p} valor={valor} onChange={onChange} faltando={faltando} />;
  if (p.tipo === "arquivos") return <PerguntaArquivos p={p} onChange={onChange} base={base} />;
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

// {agencia} e {cliente} no texto de boas-vindas.
function troca(texto, dados) {
  return String(texto || "")
    .replaceAll("{agencia}", dados.agency_name || "")
    .replaceAll("{cliente}", dados.client_name || "");
}

// CNPJ com máscara: vai formatando enquanto a pessoa digita, para o número
// chegar bonito no contrato.
function PerguntaCnpj({ p, valor, onChange, faltando }) {
  const formata = (v) => {
    const d = String(v).replace(/\D/g, "").slice(0, 14);
    return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
  };
  return (
    <Box>
      <Rotulo p={p} faltando={faltando} />
      <TextField fullWidth value={formata(valor || "")} error={faltando}
        onChange={(e) => onChange(formata(e.target.value))}
        placeholder="00.000.000/0000-00"
        inputProps={{ inputMode: "numeric" }}
        sx={{ mt: 1.5, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 16 } }} />
    </Box>
  );
}

// Envio de material: o cliente manda fotos, vídeos e referências de dentro do
// briefing, e tudo cai na galeria dele com a agência. Sem login, sem e-mail,
// sem "me manda por WhatsApp".
function PerguntaArquivos({ p, onChange, base }) {
  const [enviados, setEnviados] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    fetch(`${base}/arquivos`).then((r) => r.json())
      .then((l) => { if (Array.isArray(l)) setEnviados(l); }).catch(() => {});
  }, [base]);

  async function mandar(lista) {
    const arquivos = Array.from(lista || []);
    if (!arquivos.length) return;
    setEnviando(true); setErro("");
    try {
      // De 10 em 10, que é o teto por vez do servidor.
      for (let i = 0; i < arquivos.length; i += 10) {
        const fd = new FormData();
        arquivos.slice(i, i + 10).forEach((f) => fd.append("files", f));
        const r = await fetch(`${base}/arquivos?pergunta=${encodeURIComponent(p.id)}`, { method: "POST", body: fd });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || "Não consegui enviar.");
        }
      }
      const l = await (await fetch(`${base}/arquivos`)).json();
      setEnviados(l);
      onChange(`${l.length} arquivo(s) enviado(s)`);
    } catch (e) { setErro(e.message); }
    finally { setEnviando(false); }
  }

  return (
    <Box>
      <Rotulo p={p} faltando={false} />
      <Box
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); mandar(e.dataTransfer.files); }}
        sx={{
          mt: 1.5, p: 3, borderRadius: 2.5, border: "2px dashed", borderColor: "divider",
          textAlign: "center", bgcolor: "action.hover",
        }}
      >
        <Typography sx={{ fontSize: 15, mb: 1.5 }}>
          Arraste os arquivos aqui, ou:
        </Typography>
        <Button variant="contained" component="label" disabled={enviando}
          sx={{ px: 3, py: 1.2, borderRadius: 2, fontWeight: 700 }}>
          {enviando ? "Enviando…" : "Escolher do meu aparelho"}
          <input hidden type="file" multiple accept="image/*,video/*,application/pdf"
            onChange={(e) => { mandar(e.target.files); e.target.value = ""; }} />
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
          Fotos, vídeos e PDF — até 200 MB cada. Pode voltar depois e mandar mais.
        </Typography>
      </Box>

      {erro && <Alert severity="warning" sx={{ mt: 1.5, borderRadius: 2 }}>{erro}</Alert>}

      {enviados.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            {enviados.length} arquivo(s) recebido(s):
          </Typography>
          <Stack sx={{ mt: 0.5 }}>
            {enviados.slice(0, 12).map((f) => (
              <Typography key={f.id} variant="body2" noWrap sx={{ fontSize: 13.5 }}>
                ✓ {f.original_name}
              </Typography>
            ))}
            {enviados.length > 12 && (
              <Typography variant="caption" color="text.secondary">
                e mais {enviados.length - 12}…
              </Typography>
            )}
          </Stack>
        </Box>
      )}
    </Box>
  );
}

// Dia do mês, para a cobrança. Botões em vez de digitação: é mais rápido no
// celular e não deixa entrar "dia 45".
function PerguntaDia({ p, valor, onChange, faltando }) {
  // Só os dias que o escritório oferece (ex.: do 10 ao 15).
  const min = Number(p.dia_min) || 1;
  const max = Number(p.dia_max) || 28;
  const dias = Array.from({ length: Math.max(1, max - min + 1) }, (_, i) => min + i);
  const umSo = dias.length === 1;
  return (
    <Box>
      <Rotulo p={p} faltando={faltando} />
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1.5 }}>
        {dias.map((d) => (
          <Chip key={d} label={d} clickable onClick={() => onChange(String(d) === String(valor) ? "" : String(d))}
            color={String(d) === String(valor) ? "primary" : "default"}
            variant={String(d) === String(valor) ? "filled" : "outlined"}
            sx={{ width: 44, height: 40, borderRadius: 2, fontSize: 14.5 }} />
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        {umSo
          ? `O pagamento fica no dia ${min} de cada mês.`
          : `Escolha entre o dia ${min} e o dia ${max} — é a data que vale todo mês.`}
      </Typography>
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
