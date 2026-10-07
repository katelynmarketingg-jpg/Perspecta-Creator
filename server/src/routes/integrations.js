import { Router } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db.js";
import { authRequired, moduleAllowed, JWT_SECRET, hostServeParaLink } from "../auth.js";
import {
  metaConfigured, authUrl, exchangeCode, saveConnection, getConnection,
  publicConnection, publishToInstagram, publishCarouselToInstagram, publishToFacebook, META_APP_ID,
  fetchIgProfile, updateIgProfile,
  savePendingPages, getPendingPages, clearPendingPages, publicPage,
} from "../meta.js";
import { comecarPublicacao, terminarPublicacao, temVideo, diasAteVencer } from "../publicacao-demorada.js";
import { filaDoAutomatico } from "../publisher.js";
import { agoraNaAgencia } from "../fuso.js";

const router = Router();

/**
 * Texto que vai PARA DENTRO de uma página HTML, sem poder virar código.
 *
 * Esta tela montava o HTML colando direto o que vinha no endereço. Quem
 * mandasse para a Katy um link com um script no lugar da mensagem de erro
 * (".../meta/callback?error_description=<script>...") executava esse script no
 * endereço do sistema dela — e é ali que o navegador guarda o crachá de quem
 * está logado. Ou seja: um link no WhatsApp virava a conta inteira na mão de
 * outra pessoa (clientes, contratos, financeiro e a Central de senhas).
 *
 * A página é aberta pelo navegador, não pela API, então não dá para responder
 * JSON: o jeito é montar HTML — e tudo que entra nele passa por aqui.
 */
function textoSeguro(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// GET /api/integrations/meta/callback — a Meta redireciona para cá depois do
// login do cliente. Fica antes do authRequired porque quem chega é o navegador.
router.get("/meta/callback", async (req, res) => {
  const { code, state, error_description } = req.query;
  // O escape acontece AQUI, não em cada chamada: assim nenhum caso novo desta
  // tela pode esquecer dele.
  const fecha = (msg, ok = false) => res.send(
    `<html><body style="font-family:system-ui;background:#0C0A09;color:#FAFAF9;
      display:grid;place-items:center;height:100vh;margin:0;text-align:center">
      <div><h2 style="color:${ok ? "#4ADE80" : "#F87171"}">${textoSeguro(msg)}</h2>
      <p style="color:#A8A29E">Pode fechar esta janela.</p></div>
      <script>setTimeout(()=>window.close(),2500)</script></body></html>`
  );

  if (error_description) return fecha(`A Meta recusou: ${error_description}`);
  if (!code || !state) return fecha("Retorno inválido da Meta.");

  try {
    const payload = jwt.verify(String(state), JWT_SECRET);
    const pages = await exchangeCode(String(code));

    // Uma página só: conecta direto, como sempre foi. Mais de uma: guarda as
    // candidatas e deixa a pessoa escolher na tela — antes o sistema pegava a
    // primeira e ligava o cliente errado.
    if (pages.length === 1) {
      clearPendingPages(payload.org_id, payload.client_id);
      saveConnection(payload.org_id, payload.client_id, pages[0]);
      const p = pages[0];
      return fecha(`Conectado a ${p.ig_username ? "@" + p.ig_username : p.page_name}`, true);
    }

    savePendingPages(payload.org_id, payload.client_id, pages);
    fecha(`${pages.length} páginas encontradas — escolha a certa em Integrações.`, true);
  } catch (e) {
    fecha(`Não foi possível conectar: ${e.message}`);
  }
});

router.use(authRequired, moduleAllowed("clientes"));

// GET /api/integrations/meta/status — o que está conectado neste escritório.
router.get("/meta/status", (req, res) => {
  const rows = db
    .prepare(
      `SELECT i.*, c.name AS client_name, c.auto_publish
       FROM integrations i JOIN clients c ON c.id = i.client_id
       WHERE i.org_id = ? AND i.provider = 'meta'`
    )
    .all(req.orgId);
  // Clientes que voltaram do login da Meta com várias páginas e ainda esperam
  // a escolha — é o que acende o aviso na tela.
  const pendentes = db.prepare("SELECT client_id FROM meta_pending WHERE org_id = ?")
    .all(req.orgId).map((r) => r.client_id);
  res.json({
    configured: metaConfigured(),
    app_id: META_APP_ID ? `${META_APP_ID.slice(0, 6)}…` : null,
    // dias_para_vencer acompanha a conexão: é o que acende o aviso na tela
    // antes de o token morrer e as publicações começarem a falhar.
    // A fila vai junto: é o que deixa ela conferir sozinha o que sai e o que
    // está marcado mas não vai sair — em vez de ter de perguntar.
    connections: rows.map((r) => ({
      ...publicConnection(r),
      dias_para_vencer: diasAteVencer(r.token_expires),
      fila: filaDoAutomatico(req.orgId, r.client_id),
    })),
    pending: pendentes,
  });
});

// POST /api/integrations/meta/connect — devolve o link do login da Meta.
router.post("/meta/connect", (req, res) => {
  if (!metaConfigured()) {
    return res.status(400).json({
      error: "A integração com a Meta ainda não foi configurada.",
      missing: ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"].filter((k) => !process.env[k]),
    });
  }
  const { client_id } = req.body || {};
  const client = db.prepare("SELECT id FROM clients WHERE id = ? AND org_id = ?").get(client_id, req.orgId);
  if (!client) return res.status(404).json({ error: "Cliente não encontrado." });

  // O state carrega quem está conectando, assinado para não ser forjado.
  const state = jwt.sign({ client_id: client.id, org_id: req.orgId }, JWT_SECRET, { expiresIn: "15m" });
  res.json({ url: authUrl(state) });
});

// GET /api/integrations/meta/pending/:clientId — páginas aguardando escolha.
router.get("/meta/pending/:clientId", (req, res) => {
  const pages = getPendingPages(req.orgId, req.params.clientId);
  res.json({ pages: (pages || []).map(publicPage) });
});

// POST /api/integrations/meta/choose — grava a página escolhida para o cliente.
router.post("/meta/choose", (req, res) => {
  const { client_id, page_id } = req.body || {};
  const client = db.prepare("SELECT id FROM clients WHERE id = ? AND org_id = ?").get(client_id, req.orgId);
  if (!client) return res.status(404).json({ error: "Cliente não encontrado." });

  const pages = getPendingPages(req.orgId, client_id);
  if (!pages?.length) {
    return res.status(400).json({ error: "Nenhuma escolha pendente. Conecte a Meta de novo." });
  }
  const escolhida = pages.find((p) => String(p.page_id) === String(page_id));
  if (!escolhida) return res.status(404).json({ error: "Essa página não está entre as encontradas." });

  saveConnection(req.orgId, client.id, escolhida);
  clearPendingPages(req.orgId, client.id);
  res.json({ ok: true, page_name: escolhida.page_name, ig_username: escolhida.ig_username });
});

// POST /api/integrations/meta/:clientId/refresh — reatualiza foto/nome/seguidores
// do Instagram (útil quando o cliente mudou a foto ou ganhou seguidores).
router.post("/meta/:clientId/refresh", async (req, res) => {
  const conn = getConnection(req.params.clientId, req.orgId);
  if (!conn) return res.status(404).json({ error: "Cliente não conectado." });
  if (!conn.ig_user_id) return res.status(400).json({ error: "Este cliente não tem Instagram conectado." });
  try {
    const prof = await fetchIgProfile(conn.ig_user_id, conn.access_token);
    updateIgProfile(req.params.clientId, req.orgId, prof);
    res.json({ ok: true, ...prof });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/meta/:clientId", (req, res) => {
  clearPendingPages(req.orgId, req.params.clientId);
  db.prepare("DELETE FROM integrations WHERE client_id = ? AND org_id = ? AND provider = 'meta'")
    .run(req.params.clientId, req.orgId);
  res.json({ ok: true });
});

// PUT /api/integrations/auto-publish — liga/desliga a publicação automática.
//
// Ligar grava O MOMENTO. Daí para frente o robô só pega o que for programado
// depois disso: sem essa marca, ligar o interruptor hoje jogaria no ar, de uma
// vez, tudo que estava aprovado e atrasado dentro da janela. Publicar é
// irreversível — a surpresa tem de ser impossível, não improvável.
router.put("/auto-publish", (req, res) => {
  const { client_id, enabled } = req.body || {};
  const ligado = enabled ? 1 : 0;
  const atual = db.prepare("SELECT auto_publish FROM clients WHERE id = ? AND org_id = ?").get(client_id, req.orgId);
  if (!atual) return res.status(404).json({ error: "Cliente não encontrado." });
  // Só remarca quando estava desligado e passou a ligado — reabrir a tela não
  // pode empurrar a marca para a frente.
  // A hora DAQUI: esta marca é comparada com a hora marcada dos posts, que é
  // hora do Brasil. Em Greenwich, dava três horas de diferença — ver fuso.js.
  const desde = ligado && !atual.auto_publish ? agoraNaAgencia() : undefined;
  if (desde !== undefined) {
    db.prepare("UPDATE clients SET auto_publish = ?, auto_publish_desde = ? WHERE id = ? AND org_id = ?")
      .run(ligado, desde, client_id, req.orgId);
  } else {
    db.prepare("UPDATE clients SET auto_publish = ? WHERE id = ? AND org_id = ?")
      .run(ligado, client_id, req.orgId);
  }
  res.json({ ok: true, enabled: !!ligado });
});

// POST /api/integrations/publish/:taskId — publica agora, a pedido.
//
// FOTO VOLTA COM O RESULTADO; VÍDEO VOLTA NA HORA E AVISA DEPOIS.
//
// A Meta baixa e processa o vídeo antes de publicar, e a gente espera até 2
// minutos por isso. Esperar dentro do pedido fazia o navegador desistir: a
// pessoa via erro de demora mesmo quando o post ia ao ar logo depois — e podia
// clicar de novo, publicando duas vezes. Agora o vídeo responde 202 ("comecei")
// e o aviso vem no fim, dando certo ou dando errado.
router.post("/publish/:taskId", async (req, res) => {
  const task = db
    .prepare(`SELECT t.*, c.name AS client_name FROM tasks t
              LEFT JOIN clients c ON c.id = t.client_id
              WHERE t.id = ? AND t.org_id = ?`)
    .get(req.params.taskId, req.orgId);
  if (!task) return res.status(404).json({ error: "Tarefa não encontrada." });
  if (task.published_at) return res.status(400).json({ error: "Este post já foi publicado." });

  // O portão contra o clique duplo. Vale para foto também: dois cliques rápidos
  // em sequência viravam dois posts.
  if (!comecarPublicacao(task.id, req.orgId)) {
    return res.status(409).json({ error: "Esta peça já está sendo publicada. Aguarde o aviso." });
  }

  const host = req.headers.host;
  const protocolo = req.protocol;
  const publicar = () => publishTask(task, req.orgId, host, protocolo);
  const aoFalhar = (e) => {
    db.prepare("UPDATE tasks SET publish_error = ? WHERE id = ?").run(e.message, task.id);
  };

  if (!temVideo(midiasDaPeca(task))) {
    try {
      const result = await publicar();
      res.json(result);
    } catch (e) {
      aoFalhar(e);
      res.status(400).json({ error: e.message });
    } finally {
      terminarPublicacao(task.id, req.orgId);
    }
    return;
  }

  // Vídeo: responde já e segue trabalhando. O aviso de sucesso quem escreve é o
  // publishTask; aqui só o de falha, que ninguém mais veria.
  res.status(202).json({
    ok: true, emAndamento: true,
    aviso: "A Meta está processando o vídeo. Você recebe um aviso quando ele entrar no ar.",
  });
  publicar()
    .catch((e) => {
      aoFalhar(e);
      db.prepare(
        "INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('agency', ?, ?, ?, ?)"
      ).run(task.client_id, task.id, `⚠️ Falha ao publicar "${task.title}": ${e.message}`, req.orgId);
    })
    .finally(() => terminarPublicacao(task.id, req.orgId));
});

/**
 * As MÍDIAS da peça, na ordem em que vão ao ar.
 *
 * Antes isto era um `LIMIT 1` sem ordem nenhuma. Três consequências:
 *   · carrossel de 5 slides ia como UMA imagem, e o sistema anunciava
 *     "publicado" — porque, para ele, tinha publicado;
 *   · a CAPA escolhida era ignorada: subia o anexo que o banco devolvesse;
 *   · sem ORDER BY, "o primeiro anexo" não queria dizer nada.
 *
 * Agora: carrossel sai das slides (media_ids, na ordem montada na Galeria);
 * peça simples sai da capa, e só se não houver capa é que cai no anexo — e aí
 * pelo mais antigo, que é uma ordem de verdade.
 */
export function midiasDaPeca(task) {
  const daGaleria = (() => {
    try { return JSON.parse(task.media_ids || "[]"); } catch { return []; }
  })().map(Number).filter(Number.isFinite);

  const porId = (ids) => {
    if (!ids.length) return [];
    const marcas = ids.map(() => "?").join(",");
    const linhas = db.prepare(`SELECT id, mime FROM files WHERE id IN (${marcas})`).all(...ids);
    const mapa = new Map(linhas.map((f) => [f.id, f]));
    return ids.map((id) => mapa.get(id)).filter(Boolean);   // mantém A ORDEM das slides
  };

  if (daGaleria.length > 1) return porId(daGaleria);
  if (daGaleria.length === 1) return porId(daGaleria);

  if (task.cover_file_id) {
    const capa = db.prepare("SELECT id, mime FROM files WHERE id = ?").get(task.cover_file_id);
    if (capa) return [capa];
  }
  // task_attachments não tem id próprio (a chave é task_id + file_id), então a
  // ordem estável possível é a do arquivo: o mais antigo primeiro.
  const anexo = db.prepare(
    `SELECT f.id, f.mime FROM task_attachments ta JOIN files f ON f.id = ta.file_id
      WHERE ta.task_id = ? ORDER BY f.id LIMIT 1`
  ).get(task.id);
  return anexo ? [anexo] : [];
}

/** Publica uma tarefa nas redes do cliente. Usado pelo botão e pelo automático. */
export async function publishTask(task, orgId, host, protocol = "https") {
  const conn = getConnection(task.client_id, orgId);
  if (!conn) throw new Error("Este cliente não tem a Meta conectada.");

  const midias = midiasDaPeca(task);
  if (!midias.length) throw new Error("A tarefa não tem arte anexada.");

  // A Meta busca a imagem por URL, então ela precisa estar acessível sem login.
  // Em vez de abrir os arquivos, geramos um link assinado que vale 1 hora.
  // PUBLIC_URL é obrigatório aqui (a Meta não alcança localhost).
  // Mesma regra dos outros links: PUBLIC_URL só vale se for endereço completo
  // (no Render ela pode guardar só o nome do serviço, sem o domínio).
  let base = (process.env.PUBLIC_URL && hostServeParaLink(process.env.PUBLIC_URL))
    ? process.env.PUBLIC_URL
    : (host ? `${protocol}://${host}` : "");
  if (base && !base.startsWith("http")) base = `https://${base}`;
  // SEM ENDEREÇO PÚBLICO, O AUTOMÁTICO NÃO TEM COMO FUNCIONAR — E TEM DE DIZER
  // ISSO. A rota manual tira o endereço do próprio pedido HTTP; o robô roda
  // sozinho, sem pedido nenhum, e só tem o PUBLIC_URL. Faltando ele, a conta
  // montava um link relativo ("/api/files/shared/..."), a Meta recusava, e o
  // aviso no sininho vinha com um erro da Meta que não explica nada.
  if (!base) {
    throw new Error(
      "Falta o endereço público do sistema (PUBLIC_URL). A Meta baixa a arte por um link, "
      + "e sem isso o robô não tem como montar esse link. Publicar pelo botão continua funcionando."
    );
  }
  const enderecoDe = (id) =>
    `${base}/api/files/shared/${jwt.sign({ file_id: id, org_id: orgId }, JWT_SECRET, { expiresIn: "2h" })}`;
  const itens = midias.map((f) => ({
    url: enderecoDe(f.id),
    isVideo: (f.mime || "").startsWith("video"),
  }));
  const caption = task.client_caption || task.caption || "";

  const destino = conn.ig_user_id ? "instagram" : "facebook";
  let postId;
  if (itens.length > 1) {
    // Carrossel só existe no Instagram. Na página do Facebook, vai a primeira.
    postId = destino === "instagram"
      ? await publishCarouselToInstagram({ conn, itens, caption })
      : await publishToFacebook({ conn, mediaUrl: itens[0].url, caption, isVideo: itens[0].isVideo });
  } else {
    postId = destino === "instagram"
      ? await publishToInstagram({ conn, mediaUrl: itens[0].url, caption, isVideo: itens[0].isVideo })
      : await publishToFacebook({ conn, mediaUrl: itens[0].url, caption, isVideo: itens[0].isVideo });
  }

  // A hora DAQUI: é esta data que aparece no selo verde da grade do perfil.
  db.prepare(
    "UPDATE tasks SET published_at = ?, external_post_id = ?, publish_error = NULL WHERE id = ?"
  ).run(agoraNaAgencia(), postId, task.id);
  const quantas = itens.length > 1 ? ` (carrossel de ${itens.length} slides)` : "";
  db.prepare("INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('agency', ?, ?, ?, ?)")
    .run(task.client_id, task.id, `🚀 "${task.title}" publicado no ${destino}${quantas}.`, orgId);

  return { ok: true, destino, post_id: postId, slides: itens.length };
}

export default router;
export { textoSeguro };
