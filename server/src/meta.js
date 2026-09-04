import { db } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";
import "dotenv/config";

// Credenciais do app da Meta. Sem elas, a integração fica desligada e o
// sistema diz isso na tela em vez de falhar silenciosamente.
export const META_APP_ID = process.env.META_APP_ID || "";
export const META_APP_SECRET = process.env.META_APP_SECRET || "";
export const META_REDIRECT_URI = process.env.META_REDIRECT_URI || "";
const GRAPH = "https://graph.facebook.com/v21.0";

export function metaConfigured() {
  return Boolean(META_APP_ID && META_APP_SECRET && META_REDIRECT_URI);
}

// Permissões necessárias para publicar em nome do cliente.
export const META_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
].join(",");

export function authUrl(state) {
  const params = new URLSearchParams({
    client_id: META_APP_ID,
    redirect_uri: META_REDIRECT_URI,
    state,
    scope: META_SCOPES,
    response_type: "code",
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

async function graph(path, params = {}, options = {}) {
  const url = new URL(`${GRAPH}${path}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Meta respondeu ${res.status}`);
  }
  return data;
}

/** Troca o código do login por um token de longa duração e descobre a página/IG. */
export async function exchangeCode(code) {
  const short = await graph("/oauth/access_token", {
    client_id: META_APP_ID,
    client_secret: META_APP_SECRET,
    redirect_uri: META_REDIRECT_URI,
    code,
  });
  const long = await graph("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: META_APP_ID,
    client_secret: META_APP_SECRET,
    fb_exchange_token: short.access_token,
  });

  const pages = await graph("/me/accounts", {
    access_token: long.access_token,
    fields: "id,name,access_token,instagram_business_account{id,username,name,profile_picture_url,followers_count,media_count}",
  });
  const page = pages.data?.[0];
  if (!page) throw new Error("Nenhuma página do Facebook foi encontrada nessa conta.");
  const ig = page.instagram_business_account || null;

  return {
    page_id: page.id,
    page_name: page.name,
    page_token: page.access_token,
    ig_user_id: ig?.id || null,
    ig_username: ig?.username || null,
    ig_name: ig?.name || null,
    ig_picture: ig?.profile_picture_url || null,
    ig_followers: ig?.followers_count ?? null,
    ig_media_count: ig?.media_count ?? null,
    expires_in: long.expires_in || null,
  };
}

/** Relê o perfil do Instagram (foto, nome, seguidores, posts) com o token salvo. */
export async function fetchIgProfile(igUserId, accessToken) {
  const p = await graph(`/${igUserId}`, {
    fields: "username,name,profile_picture_url,followers_count,media_count",
    access_token: accessToken,
  });
  return {
    ig_username: p.username || null,
    ig_name: p.name || null,
    ig_picture: p.profile_picture_url || null,
    ig_followers: p.followers_count ?? null,
    ig_media_count: p.media_count ?? null,
  };
}

export function saveConnection(orgId, clientId, conn) {
  const expires = conn.expires_in
    ? new Date(Date.now() + conn.expires_in * 1000).toISOString()
    : null;
  db.prepare(
    `INSERT INTO integrations (org_id, client_id, provider, page_id, page_name,
                               ig_user_id, ig_username, ig_name, ig_picture,
                               ig_followers, ig_media_count, access_token, token_expires)
     VALUES (?, ?, 'meta', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(client_id, provider) DO UPDATE SET
       page_id=excluded.page_id, page_name=excluded.page_name,
       ig_user_id=excluded.ig_user_id, ig_username=excluded.ig_username,
       ig_name=excluded.ig_name, ig_picture=excluded.ig_picture,
       ig_followers=excluded.ig_followers, ig_media_count=excluded.ig_media_count,
       access_token=excluded.access_token, token_expires=excluded.token_expires,
       connected_at=datetime('now')`
  ).run(orgId, clientId, conn.page_id, conn.page_name, conn.ig_user_id,
        conn.ig_username, conn.ig_name ?? null, conn.ig_picture ?? null,
        conn.ig_followers ?? null, conn.ig_media_count ?? null,
        encrypt(conn.page_token), expires);
}

/** Atualiza só os dados do perfil do IG de uma conexão já existente. */
export function updateIgProfile(clientId, orgId, prof) {
  db.prepare(
    `UPDATE integrations SET ig_username=COALESCE(?, ig_username), ig_name=?, ig_picture=?,
       ig_followers=?, ig_media_count=? WHERE client_id=? AND org_id=? AND provider='meta'`
  ).run(prof.ig_username, prof.ig_name, prof.ig_picture, prof.ig_followers,
        prof.ig_media_count, clientId, orgId);
}

export function getConnection(clientId, orgId) {
  const row = db
    .prepare("SELECT * FROM integrations WHERE client_id = ? AND org_id = ? AND provider = 'meta'")
    .get(clientId, orgId);
  if (!row) return null;
  return { ...row, access_token: decrypt(row.access_token) };
}

/** Some com o token na resposta da API — ele nunca precisa sair do servidor. */
export function publicConnection(row) {
  if (!row) return null;
  const { access_token, ...rest } = row;
  return { ...rest, connected: true };
}

// Espera o container de VÍDEO terminar o processamento na Meta (o vídeo não
// publica na hora: a Meta baixa e processa antes). Faz polling com limite.
async function waitForContainer(containerId, accessToken, { tentativas = 20, intervaloMs = 6000 } = {}) {
  for (let i = 0; i < tentativas; i++) {
    const st = await graph(`/${containerId}`, { fields: "status_code", access_token: accessToken });
    if (st.status_code === "FINISHED") return;
    if (st.status_code === "ERROR") throw new Error("A Meta falhou ao processar o vídeo.");
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
  throw new Error("O vídeo ainda está processando na Meta. Tente publicar de novo em instantes.");
}

/**
 * Publica no Instagram (foto ou reel). O arquivo precisa estar acessível por
 * URL pública. Vídeo vira REELS: cria o container, espera processar e confirma.
 */
export async function publishToInstagram({ conn, mediaUrl, caption, isVideo }) {
  if (!conn?.ig_user_id) throw new Error("Este cliente não tem Instagram profissional conectado.");
  const params = isVideo
    ? { media_type: "REELS", video_url: mediaUrl, caption: caption || "", access_token: conn.access_token }
    : { image_url: mediaUrl, caption: caption || "", access_token: conn.access_token };

  const container = await graph(`/${conn.ig_user_id}/media`, params, { method: "POST" });
  if (isVideo) await waitForContainer(container.id, conn.access_token);

  const published = await graph(`/${conn.ig_user_id}/media_publish`, {
    creation_id: container.id,
    access_token: conn.access_token,
  }, { method: "POST" });

  return published.id;
}

/** Publica na página do Facebook (foto ou vídeo). */
export async function publishToFacebook({ conn, mediaUrl, caption, isVideo }) {
  if (!conn?.page_id) throw new Error("Nenhuma página do Facebook conectada.");
  if (isVideo) {
    const result = await graph(`/${conn.page_id}/videos`, {
      file_url: mediaUrl,
      description: caption || "",
      access_token: conn.access_token,
    }, { method: "POST" });
    return result.id;
  }
  const result = await graph(`/${conn.page_id}/photos`, {
    url: mediaUrl,
    caption: caption || "",
    access_token: conn.access_token,
  }, { method: "POST" });
  return result.post_id || result.id;
}
