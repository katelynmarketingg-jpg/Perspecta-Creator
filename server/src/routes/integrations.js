import { Router } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db.js";
import { authRequired, moduleAllowed, JWT_SECRET, hostServeParaLink, publicBaseUrl } from "../auth.js";
import {
  metaConfigured, authUrl, exchangeCode, saveConnection, getConnection,
  publicConnection, publishToInstagram, publishCarouselToInstagram, publishToFacebook, META_APP_ID,
  fetchIgProfile, updateIgProfile, conferirPagina, vincularInstagram, recadoDaMeta,
  savePendingPages, getPendingPages, clearPendingPages, publicPage, conferirApp, META_CONFIG_ID,
} from "../meta.js";
import { comecarPublicacao, terminarPublicacao, temVideo, diasAteVencer } from "../publicacao-demorada.js";
import { filaDoAutomatico } from "../publisher.js";
import { agoraNaAgencia } from "../fuso.js";
import { configuracaoDoEmail, enviarEmail, motivoDoErro, emailConfigured } from "../email.js";

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
// ---------------------------------------------------------------------------
// E-MAIL: COMO ESTÁ E POR QUE NÃO SAIU.
//
// "e-mail de verificação não vai". O envio falhava e a única coisa que
// aparecia era "não foi possível enviar" — o motivo do provedor morria num
// catch. Aqui ela vê a configuração (sem a senha) e manda um e-mail de teste
// para si mesma: se falhar, a tela mostra a frase do provedor, que é onde
// está a resposta (quase sempre o remetente num domínio não verificado).
// ---------------------------------------------------------------------------
router.get("/email", (req, res) => {
  res.json(configuracaoDoEmail());
});

router.post("/email/teste", async (req, res) => {
  const destino = String(req.body?.para || req.user?.email || "").trim();
  if (!emailConfigured()) {
    return res.status(400).json({
      error: "O envio de e-mail não está configurado no servidor.",
      ...configuracaoDoEmail(),
    });
  }
  if (!destino) return res.status(400).json({ error: "Diga para qual e-mail devo mandar o teste." });
  try {
    await enviarEmail({
      to: destino,
      subject: "Teste de envio — Perspecta Creator",
      text: "Deu certo: o envio de e-mail do seu Creator está funcionando.\n\n"
        + "É por este caminho que sai o código de 6 dígitos que o cliente usa para assinar o contrato.",
    });
    res.json({ ok: true, para: destino });
  } catch (e) {
    const motivo = motivoDoErro(e);
    console.error("[email] teste falhou:", motivo);
    res.status(502).json({ error: motivo, ...configuracaoDoEmail() });
  }
});

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
  // O ENDEREÇO DE RETORNO, PRONTO PARA COLAR NA META.
  //
  // É aqui que a configuração mais trava, e sempre pelo mesmo motivo: o
  // endereço cadastrado no app da Meta tem de ser IGUAL, letra por letra, ao
  // que o sistema usa. Um "/" a mais e a Meta devolve "URL bloqueada", sem
  // dizer qual é a certa. Então o sistema diz: esta, exatamente esta.
  const retornoCerto = `${publicBaseUrl(req)}/api/integrations/meta/callback`;
  const faltando = ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"]
    .filter((k) => !process.env[k]);

  res.json({
    configured: metaConfigured(),
    app_id: META_APP_ID ? `${META_APP_ID.slice(0, 6)}…` : null,
    faltando,
    // App "para empresas": as permissões moram numa configuração do painel, e
    // é o número dela que o login pede. Sem ele, num app desses, o token vem
    // sem permissão de publicar — e o erro só aparece lá na frente.
    config_id: META_CONFIG_ID ? `${META_CONFIG_ID.slice(0, 6)}…` : null,
    retorno_certo: retornoCerto,
    // Configurado, mas com o endereço errado, é pior que não configurado: o
    // login da Meta abre e morre no meio, e nada na tela explica por quê.
    retorno_confere: !process.env.META_REDIRECT_URI
      || process.env.META_REDIRECT_URI.replace(/\/+$/, "") === retornoCerto.replace(/\/+$/, ""),
    retorno_configurado: process.env.META_REDIRECT_URI || null,
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

/**
 * POST /api/integrations/meta/teste — as chaves do servidor servem?
 *
 * Três perguntas numa só, porque são as três que fazem a publicação direta
 * não sair mesmo com o app criado:
 *
 *   1. a Meta reconhece o par App ID + App Secret que está no servidor?
 *   2. o endereço de retorno guardado é o mesmo que o sistema atende?
 *   3. o sistema sabe o próprio endereço público (PUBLIC_URL)? Sem isso o
 *      robô até tenta, mas a Meta não tem de onde baixar a arte.
 *
 * Nenhuma delas se responde olhando a tela: todas moram do lado de lá.
 */
router.post("/meta/teste", async (req, res) => {
  const retornoCerto = `${publicBaseUrl(req)}/api/integrations/meta/callback`;
  const configurado = process.env.META_REDIRECT_URI || null;
  const semBarra = (u) => String(u || "").replace(/\/+$/, "");
  const resposta = {
    retorno_certo: retornoCerto,
    retorno_configurado: configurado,
    retorno_confere: Boolean(configurado) && semBarra(configurado) === semBarra(retornoCerto),
    // O robô roda sem pedido nenhum: o PUBLIC_URL é a única forma de ele
    // montar o link que a Meta vai baixar.
    endereco_publico: (process.env.PUBLIC_URL && hostServeParaLink(process.env.PUBLIC_URL))
      ? process.env.PUBLIC_URL : null,
    config_id: META_CONFIG_ID || null,
  };
  try {
    const app = await conferirApp();
    res.json({ ok: true, app, ...resposta });
  } catch (e) {
    res.json({ ok: false, erro: e.message, ...resposta });
  }
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

// POST /api/integrations/meta/:clientId/conferir — "por que não publica?"
//
// Pedido dela, depois de seguir todos os passos: "não está dando certo."
//
// E estava certa. O ig_user_id só era gravado no login completo, e NADA nunca
// perguntava de novo: vincular o Instagram à Página lá na Meta não chegava
// aqui nunca. O cliente ficava preso em "sem Instagram vinculado" para sempre,
// e o único jeito era desconectar e refazer o login inteiro.
//
// Esta rota re-pergunta à Meta pela Página já guardada. Se o Instagram entrou
// no meio-tempo, ele é gravado aqui — sem refazer login nenhum. Se não entrou,
// a resposta diz o que ainda falta, com nome e tudo.
router.post("/meta/:clientId/conferir", async (req, res) => {
  const conn = getConnection(req.params.clientId, req.orgId);
  if (!conn) {
    return res.status(404).json({
      error: "Este cliente não tem a Meta conectada. Use o botão de conectar.",
    });
  }
  const tinhaInstagram = Boolean(conn.ig_user_id);
  let pagina;
  try {
    pagina = await conferirPagina(conn);
  } catch (e) {
    // Token morto é o segundo motivo mais comum, e o erro da Meta não explica.
    const morto = /expired|session|OAuth|token|190|validat/i.test(e.message || "");
    return res.status(400).json({
      error: morto
        ? `A Meta não aceitou mais o acesso guardado desta conexão (${e.message}). `
          + "Isso acontece quando o cliente troca a senha do Facebook, tira o app ou o acesso vence. "
          + "Desconecte e conecte de novo em Integrações."
        : e.message,
    });
  }

  vincularInstagram(req.params.clientId, req.orgId, pagina);

  if (pagina.ig) {
    return res.json({
      ok: true,
      instagram: true,
      ig_username: pagina.ig.ig_username,
      page_name: pagina.page_name,
      mensagem: tinhaInstagram
        ? `Tudo certo: a Página ${pagina.page_name} está ligada ao Instagram @${pagina.ig.ig_username}. Carrossel, post e Reel podem sair daqui.`
        : `Achei agora: o Instagram @${pagina.ig.ig_username} já está vinculado à Página ${pagina.page_name}. `
          + "Gravei aqui — o carrossel já pode ser publicado, sem precisar reconectar.",
    });
  }

  res.json({
    ok: true,
    instagram: false,
    page_name: pagina.page_name,
    mensagem:
      `A Meta confirma a Página ${pagina.page_name}, mas diz que NÃO há Instagram vinculado a ela. `
      + "Confira três coisas, nessa ordem: (1) o Instagram do cliente é conta profissional "
      + "(Comercial ou Criador de conteúdo), não pessoal; (2) ele está vinculado a ESTA Página "
      + "(Configurações da Página → Instagram → Conectar conta) e não a outra; (3) quem conectou aqui "
      + "é administrador da Página. Depois de arrumar, clique em Conferir de novo — não precisa reconectar.",
  });
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

/** Roda a publicação e, se a Meta recusar, devolve o motivo em português. */
async function comRecado(fn, carrossel) {
  try {
    return await fn();
  } catch (e) {
    const traduzido = recadoDaMeta(e.message, { carrossel });
    throw traduzido === e.message ? e : new Error(traduzido);
  }
}

/** Publica uma tarefa nas redes do cliente. Usado pelo botão e pelo automático. */
export async function publishTask(task, orgId, host, protocol = "https") {
  // Reels NÃO são postados pelo sistema: a publicação pela API recomprime o
  // vídeo e perde qualidade. Eles são postados à mão pelo app de edição.
  if (task.content_type === "reel") {
    throw new Error("Reels são postados manualmente pelo app (para não perder a qualidade do vídeo).");
  }
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
    // CARROSSEL SEM INSTAGRAM NÃO SAI — E TEM DE DIZER ISSO.
    //
    // Aqui, antes, o carrossel caía na página do Facebook mandando SÓ A
    // PRIMEIRA lâmina. E o aviso logo abaixo escrevia "publicado no facebook
    // (carrossel de 6 slides)": o sistema anunciava seis e tinha mandado uma.
    // Era o mesmo erro que o midiasDaPeca já tinha consertado do outro lado —
    // publicar menos do que foi aprovado e chamar isso de sucesso.
    //
    // Ter Página do Facebook não basta: o carrossel é recurso do Instagram, e
    // a Meta só aceita publicar nele por uma conta PROFISSIONAL vinculada à
    // Página. Sem esse vínculo, melhor não publicar nada do que publicar 1/6.
    if (destino !== "instagram") {
      throw new Error(
        `Esta peça é um carrossel de ${itens.length} lâminas, e carrossel só existe no Instagram. `
        + `${conn.page_name ? `A conexão de ${conn.page_name}` : "A conexão deste cliente"} tem só a Página do `
        + "Facebook, sem Instagram vinculado — a Meta não aceita carrossel por aí. "
        + "Em Integrações, reconecte a Meta marcando a Página do cliente e confira que o Instagram dele é "
        + "conta profissional vinculada a essa Página. Enquanto isso, dá para baixar as lâminas e postar pelo app."
      );
    }
    // O QUE A META RESPONDEU, EM PORTUGUÊS. Vale para o botão e para o robô:
    // os dois passam por aqui, e os dois gravam esta frase em publish_error —
    // que agora aparece grudada na peça, em vez de sumir com o aviso.
    postId = await comRecado(() => publishCarouselToInstagram({ conn, itens, caption }), true);
  } else {
    postId = await comRecado(() => (destino === "instagram"
      ? publishToInstagram({ conn, mediaUrl: itens[0].url, caption, isVideo: itens[0].isVideo })
      : publishToFacebook({ conn, mediaUrl: itens[0].url, caption, isVideo: itens[0].isVideo })), false);
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
