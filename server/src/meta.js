import { db } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";
import "dotenv/config";

// Credenciais do app da Meta. Sem elas, a integração fica desligada e o
// sistema diz isso na tela em vez de falhar silenciosamente.
export const META_APP_ID = process.env.META_APP_ID || "";
export const META_APP_SECRET = process.env.META_APP_SECRET || "";
export const META_REDIRECT_URI = process.env.META_REDIRECT_URI || "";
const GRAPH = "https://graph.facebook.com/v21.0";

/** Teto do Instagram para carrossel. Passar disso, a Meta recusa a peça toda. */
export const MAX_SLIDES = 10;

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
  // NEM TODA RESPOSTA DA META É JSON. Quando ela cai, limita o uso ou devolve
  // uma página de erro do gateway, vem HTML — e o `json()` estourava com
  // "Unexpected token '<'", que é o que a pessoa lia na tela no lugar do
  // problema real. Aqui o texto cru vira um recado curto e legível.
  const texto = await res.text();
  let data;
  try {
    data = JSON.parse(texto);
  } catch {
    const resumo = texto.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    throw new Error(
      res.ok
        ? `A Meta respondeu algo que não dá para ler${resumo ? `: ${resumo}` : "."}`
        : `A Meta respondeu ${res.status}${resumo ? `: ${resumo}` : "."}`
    );
  }
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Meta respondeu ${res.status}`);
  }
  return data;
}

/**
 * Troca o código do login por um token de longa duração e devolve TODAS as
 * páginas da conta — quem escolhe qual é a do cliente é a pessoa, na tela.
 * Pegar a primeira dava a página errada em quem tem mais de um cliente.
 */
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
  const lista = (pages.data || []).map((page) => {
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
  });
  if (!lista.length) {
    // ESTA MENSAGEM PRECISA DIZER O QUE FAZER, NÃO SÓ O QUE FALTA.
    //
    // Ela dizia "crie uma Página" — e quase nunca é esse o caso: a Página
    // existe, mas na tela de permissões da Meta ela não foi MARCADA (a Meta
    // abre a lista com tudo desmarcado e um "Optar por todos" fácil de pular),
    // ou quem entrou não é administrador dela, ou a Página está num Portfólio
    // Empresarial que ainda não liberou o app. Em todos esses casos o
    // /me/accounts volta vazio, igualzinho. Mandar criar uma Página que já
    // existe faz a pessoa perder a tarde no lugar errado.
    throw new Error(
      "A Meta não devolveu nenhuma Página nessa conta. Quase sempre é um destes: "
      + "(1) na tela de permissões da Meta a Página do cliente não foi marcada — refaça o login e marque a Página, "
      + "(2) quem entrou não é administrador dela, ou "
      + "(3) ela está num Portfólio Empresarial que ainda não deu acesso ao app. "
      + "Se a Página existe mesmo, é um destes três — não precisa criar outra."
    );
  }
  // Página com Instagram vinculado primeiro: é quase sempre a que se quer.
  lista.sort((a, b) => (b.ig_user_id ? 1 : 0) - (a.ig_user_id ? 1 : 0));
  return lista;
}

// --- Escolha da página (quando a conta tem mais de uma) ----------------------
// As candidatas ficam guardadas até a pessoa escolher. Guardamos cifrado porque
// cada página vem com o token dela.
export function savePendingPages(orgId, clientId, pages) {
  db.prepare(
    `INSERT INTO meta_pending (org_id, client_id, pages, created_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(client_id) DO UPDATE SET
       org_id=excluded.org_id, pages=excluded.pages, created_at=datetime('now')`
  ).run(orgId, clientId, encrypt(JSON.stringify(pages)));
}

export function getPendingPages(orgId, clientId) {
  const row = db.prepare("SELECT * FROM meta_pending WHERE client_id = ? AND org_id = ?")
    .get(clientId, orgId);
  if (!row) return null;
  try { return JSON.parse(decrypt(row.pages)); } catch { return null; }
}

export function clearPendingPages(orgId, clientId) {
  db.prepare("DELETE FROM meta_pending WHERE client_id = ? AND org_id = ?").run(clientId, orgId);
}

/** Sem o token: é o que a tela precisa para montar a lista de escolha. */
export function publicPage(p) {
  return {
    page_id: p.page_id, page_name: p.page_name,
    ig_username: p.ig_username, ig_name: p.ig_name, ig_picture: p.ig_picture,
    ig_followers: p.ig_followers, has_instagram: !!p.ig_user_id,
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

/**
 * RE-PERGUNTA À META O QUE MUDOU NA PÁGINA — sem refazer o login.
 *
 * O buraco: ig_user_id só era gravado no login completo (saveConnection), e
 * NADA nunca perguntava de novo. Quem conectava o cliente antes de vincular o
 * Instagram à Página ficava preso: vinculava lá na Meta, voltava aqui, e o
 * sistema seguia dizendo "sem Instagram vinculado" para sempre. O único jeito
 * era desconectar e refazer o login inteiro — e ninguém adivinha isso.
 *
 * Aqui a gente pergunta à Meta, agora, pela PÁGINA que já está guardada. Se o
 * Instagram apareceu no meio-tempo, ele entra. Se não apareceu, a resposta diz
 * o que ainda falta, em vez de um erro cru.
 */
export async function conferirPagina(conn) {
  if (!conn?.page_id) throw new Error("Esta conexão não tem Página do Facebook guardada. Reconecte em Integrações.");
  const p = await graph(`/${conn.page_id}`, {
    fields: "name,instagram_business_account{id,username,name,profile_picture_url,followers_count,media_count}",
    access_token: conn.access_token,
  });
  const ig = p.instagram_business_account || null;
  return {
    page_id: conn.page_id,
    page_name: p.name || conn.page_name || null,
    ig: ig ? {
      ig_user_id: ig.id,
      ig_username: ig.username || null,
      ig_name: ig.name || null,
      ig_picture: ig.profile_picture_url || null,
      ig_followers: ig.followers_count ?? null,
      ig_media_count: ig.media_count ?? null,
    } : null,
  };
}

/** Grava o Instagram que apareceu na conferência — inclusive o ig_user_id. */
export function vincularInstagram(clientId, orgId, pagina) {
  const ig = pagina.ig;
  db.prepare(
    `UPDATE integrations SET page_name = COALESCE(?, page_name),
       ig_user_id = ?, ig_username = ?, ig_name = ?, ig_picture = ?,
       ig_followers = ?, ig_media_count = ?
     WHERE client_id = ? AND org_id = ? AND provider = 'meta'`
  ).run(pagina.page_name, ig?.ig_user_id ?? null, ig?.ig_username ?? null,
        ig?.ig_name ?? null, ig?.ig_picture ?? null,
        ig?.ig_followers ?? null, ig?.ig_media_count ?? null,
        clientId, orgId);
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

// Espera um container terminar o processamento na Meta. A Meta não guarda o
// arquivo: ela BAIXA a arte do nosso link e processa — e isso leva tempo, mesmo
// numa foto, mesmo que quase sempre seja rápido.
async function waitForContainer(containerId, accessToken, { tentativas = 20, intervaloMs = 6000, oque = "o vídeo" } = {}) {
  for (let i = 0; i < tentativas; i++) {
    const st = await graph(`/${containerId}`, { fields: "status_code,status", access_token: accessToken });
    if (st.status_code === "FINISHED") return;
    // SEM status_code, NÃO FICAMOS ESPERANDO O QUE NINGUÉM VAI RESPONDER.
    // A Meta nem sempre informa progresso: quando ela não manda o campo, não há
    // o que acompanhar, e insistir faria a publicação morrer de espera por uma
    // resposta que não existe. Aí vale o comportamento de antes — segue adiante.
    if (st.status_code == null) return;
    if (st.status_code === "ERROR") {
      // O `status` traz o motivo de verdade ("Media download failed", formato,
      // proporção). Sem ele, a pessoa lia só "a Meta falhou" e não dava para
      // fazer nada com isso.
      throw new Error(`A Meta recusou ${oque}${st.status ? `: ${st.status}` : "."}`);
    }
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
  throw new Error(`A Meta ainda está processando ${oque}. Tente publicar de novo em instantes.`);
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

/**
 * Publica um CARROSSEL no Instagram (2 a 10 slides, na ordem).
 *
 * Faltava por inteiro: o caminho de publicação não tinha uma linha sequer sobre
 * carrossel. Uma peça de 5 slides ia ao ar como UMA imagem — e o sistema dizia
 * "publicado", porque do ponto de vista dele tinha publicado mesmo. Quem monta
 * carrossel na Galeria toda semana só descobriria olhando o perfil.
 *
 * A Meta pede três passos: um container por slide (marcado como item de
 * carrossel), um container-pai com a lista dos filhos, e só então o publicar.
 */
export async function publishCarouselToInstagram({ conn, itens, caption }) {
  if (!conn?.ig_user_id) throw new Error("Este cliente não tem Instagram profissional conectado.");
  if (itens.length < 2) throw new Error("Um carrossel precisa de pelo menos 2 slides.");
  if (itens.length > MAX_SLIDES) {
    throw new Error(`O Instagram aceita no máximo ${MAX_SLIDES} slides por carrossel — esta peça tem ${itens.length}.`);
  }

  // Um container por slide. A legenda vai só no pai.
  const filhos = [];
  for (const item of itens) {
    const params = item.isVideo
      ? { media_type: "VIDEO", video_url: item.url, is_carousel_item: true, access_token: conn.access_token }
      : { image_url: item.url, is_carousel_item: true, access_token: conn.access_token };
    const c = await graph(`/${conn.ig_user_id}/media`, params, { method: "POST" });
    filhos.push({ id: c.id, isVideo: item.isVideo });
  }

  // TODA LÂMINA PRECISA ESTAR PRONTA — não só as de vídeo.
  //
  // Era aqui o buraco: só o vídeo era esperado. A Meta não guarda o arquivo,
  // ela BAIXA a arte do nosso link; numa foto isso costuma ser instantâneo,
  // mas não é garantido — se o Render estiver frio, ou a arte for pesada, o
  // container ainda está IN_PROGRESS quando a gente monta o pai do carrossel.
  // A Meta então recusa com "Media ID is not available", que não diz nada.
  // Por isso o carrossel de um cliente saía e o de outro não: é corrida, não
  // configuração.
  //
  // Foto é esperada de perto (1,5s) e vídeo de longe (6s), senão uma foto
  // pronta ficaria parada esperando o relógio do vídeo.
  for (const f of filhos) {
    await waitForContainer(f.id, conn.access_token, f.isVideo
      ? { tentativas: 20, intervaloMs: 6000, oque: "o vídeo de uma das lâminas" }
      : { tentativas: 20, intervaloMs: 1500, oque: "a arte de uma das lâminas" });
  }

  const pai = await graph(`/${conn.ig_user_id}/media`, {
    media_type: "CAROUSEL",
    children: filhos.map((f) => f.id).join(","),
    caption: caption || "",
    access_token: conn.access_token,
  }, { method: "POST" });

  const published = await graph(`/${conn.ig_user_id}/media_publish`, {
    creation_id: pai.id,
    access_token: conn.access_token,
  }, { method: "POST" });

  return published.id;
}

/**
 * O QUE A META DISSE, EM PORTUGUÊS — e com o que fazer.
 *
 * As mensagens da Meta são em inglês, técnicas e, nas piores horas, mudas
 * ("Media ID is not available"). Ela lia isso no sininho e não tinha o que
 * fazer com a informação. Aqui cada caso que a gente já viu vira uma frase que
 * diz o problema E a saída; o que não se reconhece volta inteiro, nunca
 * engolido.
 */
export function recadoDaMeta(mensagem, { carrossel = false } = {}) {
  const m = String(mensagem || "");
  const peca = carrossel ? "uma das lâminas" : "a arte";

  if (/Media ID is not available|not available|still being processed/i.test(m)) {
    return `A Meta não conseguiu terminar de preparar ${peca} a tempo. `
      + "Quase sempre é a arte demorando a ser baixada. Tente publicar de novo em um minuto.";
  }
  if (/aspect ratio|proporç/i.test(m)) {
    return `O Instagram recusou a proporção de ${peca}. Ele aceita de 4:5 (vertical) a 1.91:1 (horizontal) — `
      + "1080×1350 e 1080×1080 passam sempre. Refaça a arte fora desses extremos."
      + (carrossel ? " Num carrossel, todas as lâminas vão na proporção da primeira." : "");
  }
  if (/format|unsupported|not supported|image type|corrupt/i.test(m)) {
    return `O Instagram não aceitou o formato de ${peca}. Ele publica JPEG — PNG, HEIC e WEBP costumam ser recusados. `
      + "Exporte em JPG e troque a arte na peça.";
  }
  if (/too large|file size|exceeds|maximum size/i.test(m)) {
    return `${carrossel ? "Uma das lâminas" : "A arte"} é pesada demais para o Instagram (o teto é 8 MB por foto). `
      + "Exporte em JPG com qualidade um pouco menor.";
  }
  if (/download|fetch|url|unreachable|timed out/i.test(m)) {
    return `A Meta não conseguiu baixar ${peca} pelo link que o sistema mandou. `
      + "Tente de novo; se repetir, me avise — é do lado do sistema, não da arte.";
  }
  if (/\(#10\)|permission|instagram_content_publish|not authorized/i.test(m)) {
    return "A Meta diz que o app não tem permissão para publicar nesta conta. "
      + "Desconecte e conecte o cliente de novo em Integrações, marcando a Página dele na tela de permissões.";
  }
  if (/\(#4\)|\(#17\)|rate limit|request limit|quota/i.test(m)) {
    return "O Instagram bloqueou por limite de publicações (são 50 posts por conta a cada 24 horas). "
      + "Espere e tente mais tarde — a peça continua aqui.";
  }
  if (/expired|session has expired|validating access token|\(#190\)/i.test(m)) {
    return "O acesso guardado deste cliente venceu ou foi retirado na Meta. "
      + "Desconecte e conecte de novo em Integrações.";
  }
  return m;
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

/**
 * AS CHAVES QUE ESTÃO NO SERVIDOR SÃO MESMO AS DO APP DELA?
 *
 * "isso já tenho app e tudo mais." O app existir não é o que o sistema usa —
 * ele usa o que está guardado nas variáveis do servidor. E entre as duas
 * coisas cabem erros que nenhuma tela mostra: a chave de outro app, o segredo
 * com um espaço colado no fim, o App Secret que foi regenerado na Meta depois
 * de copiado. Em todos esses casos o botão "Conectar" aparece, ela clica, e a
 * Meta é que diz não — num inglês que não ajuda.
 *
 * Aqui a gente pergunta à Meta, com as chaves que estão no servidor agora,
 * quem é esse app. Se ela responder o nome, as chaves são boas. Se não, o
 * motivo vem traduzido.
 *
 * Usa o token de aplicativo (APP_ID|APP_SECRET), que só vale se os dois
 * estiverem certos — é exatamente a conferência que se quer.
 */
export async function conferirApp() {
  if (!META_APP_ID || !META_APP_SECRET) {
    throw new Error("Faltam META_APP_ID e/ou META_APP_SECRET no servidor.");
  }
  try {
    const app = await graph(`/${META_APP_ID}`, {
      fields: "name,link,app_type",
      access_token: `${META_APP_ID}|${META_APP_SECRET}`,
    });
    return { nome: app.name || null, link: app.link || null };
  } catch (e) {
    const m = String(e.message || "");
    if (/Invalid OAuth access token|Invalid appsecret|client secret|\(#?1?0?1\)/i.test(m)) {
      throw new Error(
        "A Meta não reconheceu o par App ID + App Secret. Confira os dois no painel do app "
        + "(Configurações → Básico) e cole de novo no Render, sem espaço sobrando. "
        + "Se o App Secret foi gerado de novo lá, o antigo deixou de valer."
      );
    }
    // "fetch failed" é o que o Node diz quando nem chegou lá. Sozinho, não
    // diz nada a ninguém — e faria parecer que a chave está errada.
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(m)) {
      throw new Error(
        "Não consegui falar com a Meta agora: o servidor não alcançou graph.facebook.com. "
        + "Isso é rede, não chave — tente de novo em um minuto."
      );
    }
    if (/does not exist|Unsupported get request|cannot be loaded/i.test(m)) {
      throw new Error(
        `A Meta diz que o app ${META_APP_ID} não existe ou não está visível. `
        + "Quase sempre é App ID de outro app, ou um dígito trocado."
      );
    }
    throw new Error(m);
  }
}
