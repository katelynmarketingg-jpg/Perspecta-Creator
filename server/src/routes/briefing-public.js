import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { unlinkSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { db } from "../db.js";
import { getTemplate, perguntasDe, progresso, faltando } from "../briefing.js";
import { hashPassword, publicBaseUrl } from "../auth.js";
import { makeSignToken } from "./sign.js";
import { storageConfigured, uploadFileToR2 } from "../storage.js";
import { fechaOnboarding } from "../onboarding.js";

// Mesma pasta do upload da equipe (disco persistente no Render).
const DATA_DIR = dirname(process.env.DB_PATH || "./data/agency.db");
const UPLOADS_DIR = resolve(process.env.UPLOADS_DIR || join(DATA_DIR, "uploads"));
mkdirSync(UPLOADS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Briefing — lado do CLIENTE. Sem login: quem tem o link responde.
//
// O que o cliente escreve é salvo a cada passo, então ele pode fechar e voltar
// depois sem perder nada — a diferença mais importante para um formulário do
// Google, junto do fato de as respostas virarem direto a inteligência da IA.
// ---------------------------------------------------------------------------
export const briefingPublicRouter = Router();

const TAMANHO_MAX = 4000;   // por resposta: um texto colado enorme não entra

function carrega(token) {
  return db.prepare("SELECT * FROM briefings WHERE token = ?").get(String(token || ""));
}

// As perguntas são as DO ESCRITÓRIO (ele pode ter editado o briefing), não uma
// lista fixa no código.
function idsValidos(orgId) {
  return new Set(perguntasDe(getTemplate(orgId).secoes).map((p) => p.id));
}

// GET /api/briefing/:token — as perguntas e o que já foi respondido.
briefingPublicRouter.get("/:token", (req, res) => {
  const b = carrega(req.params.token);
  if (!b) return res.status(404).json({ error: "Este link não existe mais." });

  if (!b.opened_at) {
    db.prepare("UPDATE briefings SET opened_at = datetime('now') WHERE id = ?").run(b.id);
  }
  const modelo = getTemplate(b.org_id);   // o briefing DESTE escritório
  const cliente = db.prepare("SELECT name FROM clients WHERE id = ?").get(b.client_id);
  // A logo vem junto: a página é aberta por quem não tem conta, então não pode
  // buscar a marca pelas rotas da equipe — e chegar sem marca nenhuma faria o
  // convite parecer um formulário qualquer.
  const org = db.prepare("SELECT name, logo FROM organizations WHERE id = ?").get(b.org_id);
  const respostas = JSON.parse(b.answers || "{}");

  res.json({
    secoes: modelo.secoes,
    welcome: modelo.welcome,
    respostas,
    client_name: cliente?.name || "",
    agency_name: org?.name || "",
    agency_logo: org?.logo || null,
    status: b.status,
    progresso: progresso(modelo.secoes, respostas),
    answered_at: b.answered_at,
  });
});

// PUT /api/briefing/:token — salva o que já foi digitado (a cada passo).
briefingPublicRouter.put("/:token", (req, res) => {
  const b = carrega(req.params.token);
  if (!b) return res.status(404).json({ error: "Este link não existe mais." });

  const entrada = req.body?.respostas || {};
  const atual = JSON.parse(b.answers || "{}");
  // Só perguntas que existem, e cada resposta com teto de tamanho.
  const ids = idsValidos(b.org_id);
  for (const [k, v] of Object.entries(entrada)) {
    if (!ids.has(k)) continue;
    const texto = Array.isArray(v) ? v.join(", ") : String(v ?? "");
    atual[k] = texto.slice(0, TAMANHO_MAX);
  }
  db.prepare("UPDATE briefings SET answers = ? WHERE id = ?").run(JSON.stringify(atual), b.id);
  res.json({ ok: true, progresso: progresso(getTemplate(b.org_id).secoes, atual) });
});

// ---------------------------------------------------------------------------
// ENVIO DE MATERIAL pelo cliente, de dentro do briefing.
//
// O que ele manda cai na galeria do cliente, numa pasta própria — a equipe abre
// a Galeria e já está tudo lá. Sem login: quem tem o link envia.
//
// Como é uma porta aberta, tem trava: só foto, vídeo e PDF; 200 MB por arquivo;
// 10 por vez; e um teto por briefing, para o link não virar hospedagem grátis.
// ---------------------------------------------------------------------------
const TIPOS_ACEITOS = /^(image|video)\//;
const MAX_ARQUIVO = 200 * 1024 * 1024;
const MAX_POR_VEZ = 10;
const MAX_POR_BRIEFING = 200;
const PASTA = "Enviado pelo cliente";

const envio = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, _f, cb) => cb(null, `${Date.now()}-${randomUUID()}`),
  }),
  limits: { fileSize: MAX_ARQUIVO, files: MAX_POR_VEZ },
  fileFilter: (_req, f, cb) => cb(null, TIPOS_ACEITOS.test(f.mimetype) || f.mimetype === "application/pdf"),
});

/** A pasta do cliente onde cai o que ele mandou (cria na primeira vez). */
function pastaDoCliente(clientId) {
  const achada = db.prepare("SELECT id FROM folders WHERE client_id = ? AND name = ? AND parent_id IS NULL")
    .get(clientId, PASTA);
  if (achada) return achada.id;
  return db.prepare("INSERT INTO folders (name, client_id, parent_id) VALUES (?, ?, NULL)")
    .run(PASTA, clientId).lastInsertRowid;
}

// GET /api/briefing/:token/arquivos — o que o cliente já mandou.
briefingPublicRouter.get("/:token/arquivos", (req, res) => {
  const b = carrega(req.params.token);
  if (!b) return res.status(404).json({ error: "Este link não existe mais." });
  const pasta = db.prepare("SELECT id FROM folders WHERE client_id = ? AND name = ?").get(b.client_id, PASTA);
  if (!pasta) return res.json([]);
  res.json(db.prepare(
    "SELECT id, original_name, mime, size, created_at FROM files WHERE folder_id = ? ORDER BY id DESC"
  ).all(pasta.id));
});

// POST /api/briefing/:token/arquivos — o cliente manda fotos, vídeos e referências.
briefingPublicRouter.post("/:token/arquivos", envio.array("files", MAX_POR_VEZ), async (req, res) => {
  const b = carrega(req.params.token);
  if (!b) return res.status(404).json({ error: "Este link não existe mais." });

  const pasta = pastaDoCliente(b.client_id);
  const jaTem = db.prepare("SELECT COUNT(*) n FROM files WHERE folder_id = ?").get(pasta).n;
  if (jaTem + (req.files?.length || 0) > MAX_POR_BRIEFING) {
    return res.status(400).json({ error: "Você já mandou bastante coisa! Fale com a equipe para enviar o resto." });
  }

  const stmt = db.prepare(
    `INSERT INTO files (folder_id, client_id, original_name, mime, size, stored_path, stage, org_id)
     VALUES (?, ?, ?, ?, ?, ?, 'originais', ?)`
  );
  const criados = [];
  for (const f of req.files || []) {
    // originalname chega em latin1 no multer — normaliza para UTF-8.
    const nome = Buffer.from(f.originalname, "latin1").toString("utf8");
    let caminho = f.path;
    if (storageConfigured()) {
      try {
        caminho = await uploadFileToR2(f.path, `uploads/${b.org_id}/${f.filename}`, f.mimetype);
        try { unlinkSync(f.path); } catch { /* já está no R2 */ }
      } catch { caminho = f.path; }   // R2 fora: guarda no disco, não perde
    }
    const info = stmt.run(pasta, b.client_id, nome, f.mimetype, f.size, caminho, b.org_id);
    criados.push(db.prepare("SELECT id, original_name, mime, size FROM files WHERE id = ?").get(info.lastInsertRowid));
  }

  // A resposta da pergunta guarda o resumo, para o progresso contar e a equipe
  // ver de relance quanto veio.
  const perguntaId = String(req.query.pergunta || "");
  if (perguntaId && idsValidos(b.org_id).has(perguntaId)) {
    const respostas = JSON.parse(b.answers || "{}");
    const total = jaTem + criados.length;
    respostas[perguntaId] = `${total} arquivo(s) enviado(s)`;
    db.prepare("UPDATE briefings SET answers = ? WHERE id = ?").run(JSON.stringify(respostas), b.id);
  }
  res.status(201).json(criados);
});

// ---------------------------------------------------------------------------
// DEPOIS DO BRIEFING: o contrato para assinar e o acesso do cliente.
//
// A pessoa acabou de contar tudo sobre o negócio dela; é o melhor momento para
// resolver o resto de uma vez, sem trocar mais mensagens.
// ---------------------------------------------------------------------------

// GET /api/briefing/:token/proximos-passos — o que falta para ela fazer.
briefingPublicRouter.get("/:token/proximos-passos", (req, res) => {
  const b = carrega(req.params.token);
  if (!b) return res.status(404).json({ error: "Este link não existe mais." });

  const cliente = db.prepare("SELECT name, portal_username, portal_password_hash FROM clients WHERE id = ?")
    .get(b.client_id);
  const org = db.prepare("SELECT name FROM organizations WHERE id = ?").get(b.org_id);

  // O contrato mais recente que ainda espera assinatura.
  const contrato = db.prepare(
    `SELECT id, title, signed_at FROM contracts
      WHERE client_id = ? AND org_id = ? ORDER BY signed_at IS NULL DESC, id DESC LIMIT 1`
  ).get(b.client_id, b.org_id);

  res.json({
    client_name: cliente?.name || "",
    agency_name: org?.name || "",
    tem_acesso: Boolean(cliente?.portal_password_hash),
    usuario: cliente?.portal_username || "",
    portal_url: `${publicBaseUrl(req)}/portal/login`,
    contrato: contrato
      ? {
          titulo: contrato.title,
          assinado: Boolean(contrato.signed_at),
          url: contrato.signed_at ? null : `${publicBaseUrl(req)}/assinar/${makeSignToken(contrato.id)}`,
        }
      : null,
  });
});

// POST /api/briefing/:token/acesso — o cliente cria o próprio acesso.
// Quem tem o link do briefing é quem a agência convidou, então é ele quem
// escolhe o nome de acesso e a senha. Se JÁ existe acesso, não mexe: um link
// antigo não pode servir para trocar a senha de ninguém.
briefingPublicRouter.post("/:token/acesso", (req, res) => {
  const b = carrega(req.params.token);
  if (!b) return res.status(404).json({ error: "Este link não existe mais." });

  const cliente = db.prepare("SELECT * FROM clients WHERE id = ?").get(b.client_id);
  if (cliente?.portal_password_hash) {
    return res.status(409).json({ error: "Você já tem acesso criado. Entre com o que você escolheu antes." });
  }

  const usuario = String(req.body?.usuario || "").trim().toLowerCase();
  const senha = String(req.body?.senha || "");
  if (usuario.length < 3) return res.status(400).json({ error: "O nome de acesso precisa de pelo menos 3 letras." });
  if (!/^[a-z0-9._-]+$/.test(usuario)) {
    return res.status(400).json({ error: "Use só letras, números, ponto, hífen ou _ no nome de acesso." });
  }
  if (senha.length < 6) return res.status(400).json({ error: "A senha precisa de pelo menos 6 caracteres." });

  const ocupado = db.prepare(
    "SELECT id FROM clients WHERE org_id = ? AND lower(portal_username) = ? AND id <> ?"
  ).get(b.org_id, usuario, b.client_id);
  if (ocupado) return res.status(409).json({ error: "Esse nome de acesso já está em uso. Escolha outro." });

  db.prepare("UPDATE clients SET portal_username = ?, portal_password_hash = ? WHERE id = ?")
    .run(usuario, hashPassword(senha), b.client_id);

  // A equipe fica sabendo, e o nome de acesso fica no cadastro do cliente.
  try {
    db.prepare(
      "INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('agency', ?, NULL, ?, ?)"
    ).run(b.client_id, `🔑 ${cliente?.name || "Um cliente"} criou o acesso dele: "${usuario}".`, b.org_id);
  } catch { /* o aviso não pode derrubar a criação */ }

  res.status(201).json({ ok: true, usuario, portal_url: `${publicBaseUrl(req)}/portal/login` });
});

// POST /api/briefing/:token/enviar — o cliente diz que terminou.
briefingPublicRouter.post("/:token/enviar", (req, res) => {
  const b = carrega(req.params.token);
  if (!b) return res.status(404).json({ error: "Este link não existe mais." });

  const respostas = JSON.parse(b.answers || "{}");
  const faltam = faltando(getTemplate(b.org_id).secoes, respostas);
  if (faltam.length) {
    return res.status(400).json({ error: "Ainda faltam perguntas obrigatórias.", faltando: faltam });
  }
  db.prepare("UPDATE briefings SET status = 'respondido', answered_at = datetime('now') WHERE id = ?").run(b.id);

  // Daqui o resto anda sozinho: o cadastro dele é preenchido, as senhas vão
  // para a Central e o contrato nasce pronto com os termos que a agência
  // definiu ao abrir o onboarding.
  const fim = fechaOnboarding(b, respostas);

  // A equipe fica sabendo na hora, sem precisar ficar conferindo.
  const cliente = db.prepare("SELECT name FROM clients WHERE id = ?").get(b.client_id);
  const aviso = (texto) => {
    try {
      db.prepare(
        "INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('agency', ?, NULL, ?, ?)"
      ).run(b.client_id, texto, b.org_id);
    } catch { /* o aviso não pode derrubar o envio */ }
  };
  const nome = cliente?.name || "Um cliente";
  aviso(fim.contrato
    ? `📝 ${nome} respondeu o onboarding. O contrato já está pronto para ele assinar.`
    : `📝 ${nome} respondeu o onboarding. Aplique na inteligência da IA.`);
  if (fim.erroContrato) aviso(`⚠️ Não deu para gerar o contrato de ${nome}: ${fim.erroContrato}`);

  res.json({ ok: true, contrato: Boolean(fim.contrato) });
});
