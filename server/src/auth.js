import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import "dotenv/config";

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
    req.user = payload;

    // Escopo de escritório: cada um só enxerga os próprios dados. O master
    // (Perspecta Media) pode olhar um escritório específico via cabeçalho.
    const asked = Number(req.headers["x-org-id"]) || null;
    req.orgId = payload.role === "superadmin" && asked ? asked : payload.org_id;
    req.isSuperadmin = payload.role === "superadmin";
    next();
  } catch {
    res.status(401).json({ error: "Token inválido ou expirado." });
  }
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

/** Middleware: exige papel admin (o master também é admin em toda parte). */
export function adminRequired(req, res, next) {
  if (req.user?.role !== "admin" && req.user?.role !== "superadmin") {
    return res.status(403).json({ error: "Acesso restrito a administradores." });
  }
  next();
}
