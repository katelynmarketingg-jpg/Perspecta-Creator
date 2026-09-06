import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import "dotenv/config";
import { db } from "./db.js";

// Segurança: em produção o JWT_SECRET é obrigatório. Sem ele, auth e
// criptografia cairiam num segredo conhecido — então o servidor RECUSA subir.
// Em desenvolvimento, mantém um fallback com aviso para não travar o dia a dia.
const IS_PROD = process.env.NODE_ENV === "production" || Boolean(process.env.RENDER);
if (IS_PROD && !process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET não definido em produção. Configure-o no Render (aba Environment) antes de subir.");
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.warn("⚠️  JWT_SECRET não definido — usando segredo inseguro de desenvolvimento.");
}
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const TOKEN_TTL = "12h";

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, org_id: user.org_id },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

/** Middleware: exige um Bearer token válido DA EQUIPE. Popula req.user. */
export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Token ausente." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Tokens do portal do cliente não têm acesso às rotas da agência.
    if (payload.portal) return res.status(403).json({ error: "Acesso restrito à equipe." });

    // Relê o usuário a cada chamada: assim desativar alguém tem efeito na
    // hora, sem esperar o token de 12h expirar.
    const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.id);
    if (!fresh) return res.status(401).json({ error: "Usuário não existe mais." });
    if (!fresh.active) return res.status(403).json({ error: "Usuário desativado." });

    req.user = { ...payload, role: fresh.role, org_id: fresh.org_id };
    req.userPermissions = JSON.parse(fresh.permissions || "{}");

    // Escopo de escritório: cada um só enxerga os próprios dados. O master
    // (Perspecta Media) pode olhar um escritório específico via cabeçalho.
    const asked = Number(req.headers["x-org-id"]) || null;
    req.orgId = fresh.role === "superadmin" && asked ? asked : fresh.org_id;
    req.isSuperadmin = fresh.role === "superadmin";
    next();
  } catch {
    res.status(401).json({ error: "Token inválido ou expirado." });
  }
}

/**
 * Middleware de permissão por módulo. Admin e master passam sempre; um
 * colaborador só entra se a permissão estiver ligada no cadastro dele.
 * (Sem isso, as permissões da tela de Usuários seriam só decorativas.)
 */
export function moduleAllowed(moduleName) {
  return (req, res, next) => {
    if (req.user?.role === "admin" || req.user?.role === "superadmin") return next();
    const perms = req.userPermissions || {};
    if (perms[moduleName] === false) {
      return res.status(403).json({ error: `Você não tem acesso a ${moduleName}.` });
    }
    next();
  };
}

/** Middleware: exige o escritório master (Perspecta Media). */
export function superadminRequired(req, res, next) {
  if (req.user?.role !== "superadmin") {
    return res.status(403).json({ error: "Acesso restrito ao Perspecta Media." });
  }
  next();
}

/** Middleware do PORTAL: exige token de cliente. Popula req.client. */
export function portalAuthRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Token ausente." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.portal || !payload.client_id) {
      return res.status(403).json({ error: "Acesso restrito ao portal do cliente." });
    }
    req.client = payload;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido ou expirado." });
  }
}

export { JWT_SECRET };

/**
 * Um endereço serve para montar link? Precisa ter domínio de verdade (um ponto)
 * ou ser a máquina local. "saas-agency-k9ft" sozinho NÃO serve: o navegador não
 * acha esse nome no DNS.
 */
export function hostServeParaLink(valor) {
  const host = String(valor || "").replace(/^https?:\/\//, "").split("/")[0];
  if (!host) return false;
  const semPorta = host.split(":")[0];
  return semPorta.includes(".") || semPorta === "localhost";
}

let avisouPublicUrl = false;

/**
 * Endereço público do sistema, para montar links (assinatura, briefing, Meta,
 * Asaas).
 *
 * PUBLIC_URL manda quando é um endereço completo. Só que no Render essa
 * variável pode acabar guardando apenas o NOME do serviço ("saas-agency-k9ft",
 * sem o .onrender.com) — e aí todo link gerado apontava para um domínio que não
 * existe: o navegador respondia "não é possível acessar esse site". Nesse caso
 * usamos o endereço pelo qual a pessoa realmente chegou até aqui, que é sempre
 * o certo, e deixamos um aviso no log para arrumar a variável.
 */
export function publicBaseUrl(req) {
  const doAmbiente = process.env.PUBLIC_URL;
  if (doAmbiente && hostServeParaLink(doAmbiente)) {
    if (doAmbiente.startsWith("http")) return doAmbiente;
    // Na máquina local não existe https — só fora dela.
    const local = /^(localhost|127\.)/.test(doAmbiente);
    return `${local ? "http" : "https"}://${doAmbiente}`;
  }
  if (doAmbiente && !avisouPublicUrl) {
    avisouPublicUrl = true;
    console.warn(`[links] PUBLIC_URL="${doAmbiente}" não é um endereço completo `
      + "(falta o domínio). Usando o endereço do próprio pedido para montar os links.");
  }
  const host = req?.headers?.["x-forwarded-host"] || req?.headers?.host || "localhost:8080";
  const primeiro = String(host).split(",")[0].trim();   // pode vir uma lista
  const proto = primeiro.startsWith("localhost") || primeiro.startsWith("127.") ? "http" : "https";
  return `${proto}://${primeiro}`;
}

/** Middleware: exige papel admin (o master também é admin em toda parte). */
export function adminRequired(req, res, next) {
  if (req.user?.role !== "admin" && req.user?.role !== "superadmin") {
    return res.status(403).json({ error: "Acesso restrito a administradores." });
  }
  next();
}
