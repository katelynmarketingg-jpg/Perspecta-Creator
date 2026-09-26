import { Router } from "express";
import { pipeline } from "node:stream/promises";
import multer from "multer";
import AdmZip from "adm-zip";
import { mkdirSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, join, dirname, basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { db } from "../db.js";
import { authRequired, moduleAllowed, JWT_SECRET } from "../auth.js";
import { storageConfigured, isR2Path, r2Key, uploadFileToR2, getR2Object, deleteR2Object, tipoQueONavegadorToca, testarR2, enderecoAssinado, nomeParaBaixar } from "../storage.js";
import { confere } from "../pertence.js";
import { bilheteDeMidia, enderecoDeMidia, enderecoDePrevia, previasDe } from "../midia-url.js";
import { emParalelo } from "../em-paralelo.js";
import { erroDeEnvio } from "../erro-de-envio.js";

// Rotas abertas (link assinado) precisam ficar antes do authRequired.
export const sharedRouter = Router();

const router = Router();

// Serve um arquivo para o cliente HTTP, esteja ele no R2 ou no disco.
// Quando `asAttachment` é falso, entrega "inline" (o navegador mostra a foto ou
// toca o vídeo direto na tela) e respeita Range (bytes=…) — é isso que faz o
// vídeo abrir na hora, mostrar o 1º quadro e deixar arrastar sem baixar tudo.
// O Chrome se recusa a tocar "video/quicktime" no <video>, mesmo quando o .mov
// é H.264 por dentro — que é o caso dos vídeos de iPhone. Rotulando como mp4,
// ele toca normalmente. O arquivo não é convertido: só o rótulo muda.

async function serveFile(res, file, asAttachment, range, paraCapturar = false) {
  if (isR2Path(file.stored_path)) {
    // CAMINHO RÁPIDO: manda o navegador buscar direto na Cloudflare. O arquivo
    // deixa de atravessar esta máquina — é o que faz vídeo grande abrir rápido,
    // porque a Cloudflare tem servidor perto de quem está assistindo.
    // paraCapturar: NÃO redireciona. O navegador vai desenhar isto num canvas e
    // um redirecionamento para outro domínio sujaria o canvas (ver
    // bilheteDeMidia). Aqui os bytes passam por dentro do servidor.
    const direto = paraCapturar ? null : await enderecoAssinado(r2Key(file.stored_path), {
      tipo: asAttachment ? undefined : tipoQueONavegadorToca(file),
      baixarComoNome: asAttachment ? file.original_name : undefined,
    });
    if (direto) {
      // 302: o navegador refaz o pedido no R2, levando o Range junto.
      res.setHeader("Cache-Control", "private, max-age=3600");
      return res.redirect(302, direto);
    }
    // Não deu para assinar: segue repassando pelo servidor, como antes.
    try {
      const obj = await getR2Object(r2Key(file.stored_path), asAttachment ? undefined : range);
      // Baixando: o tipo real. Vendo na tela: o tipo que o navegador toca.
      res.setHeader("Content-Type", asAttachment
        ? (obj.ContentType || file.mime || "application/octet-stream")
        : tipoQueONavegadorToca(file));
      if (!asAttachment) res.setHeader("Accept-Ranges", "bytes");
      if (obj.ContentLength != null) res.setHeader("Content-Length", obj.ContentLength);
      if (!asAttachment && obj.ContentRange) { res.status(206); res.setHeader("Content-Range", obj.ContentRange); }
      if (asAttachment) res.setHeader("Content-Disposition", nomeParaBaixar(file.original_name));
      else res.setHeader("Cache-Control", "private, max-age=86400");
      // Um erro no meio do envio (R2 caiu, ou o navegador cancelou a imagem)
      // emite 'error' no stream. Sem tratar, o Node derruba o processo inteiro
      // e TODO MUNDO vê 502 — e uma tela cheia de fotos cancela requisições o
      // tempo todo. `pipeline` fecha os dois lados e devolve o erro aqui.
      await pipeline(obj.Body, res).catch((e) => {
        if (!res.headersSent) res.status(404).end();
        else res.destroy();
        if (e?.code !== "ERR_STREAM_PREMATURE_CLOSE") {
          console.error("[arquivo] envio interrompido:", e?.message);
        }
      });
    } catch {
      res.status(404).json({ error: "Arquivo não encontrado." });
    }
    return;
  }
  if (!existsSync(file.stored_path)) return res.status(404).json({ error: "Arquivo não encontrado." });
  if (asAttachment) {
    // O arquivo é gravado com nome sem extensão, então o Express não adivinha o
    // tipo e mandava "application/octet-stream". Dizemos o tipo real.
    if (file.mime) res.type(file.mime);
    return res.download(file.stored_path, file.original_name);
  }
  // sendFile já trata Range e define Accept-Ranges/Content-Type sozinho.
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(file.stored_path, { headers: { "Content-Type": tipoQueONavegadorToca(file) } });
}

// Assina uma URL "inline" curta para uma foto/vídeo — o <img>/<video> carrega
// direto por ela (sem cabeçalho de autenticação), com streaming e cache. Vai
// junto de cada arquivo na listagem, então a galeria mostra a prévia na hora.
const mediaUrl = (fileId, orgId) => bilheteDeMidia(fileId, orgId);

// Remove o arquivo físico (R2 ou disco).
async function removeStored(stored_path) {
  if (isR2Path(stored_path)) { try { await deleteR2Object(r2Key(stored_path)); } catch {} }
  else { try { unlinkSync(stored_path); } catch {} }
}

// Os arquivos são gravados em disco exatamente como chegaram (byte a byte).
// Nenhuma compressão ou conversão — a qualidade original é preservada.
// Guarda os uploads no MESMO disco persistente do banco (ex.: /var/data/uploads
// no Render). Antes caía em "./data/uploads", que é efêmero e some a cada
// redeploy — por isso as imagens sumiam. (Quando o R2 está ligado, vai pro R2.)
const DATA_DIR = dirname(process.env.DB_PATH || "./data/agency.db");
const UPLOADS_DIR = resolve(process.env.UPLOADS_DIR || join(DATA_DIR, "uploads"));
mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // até 2 GB por arquivo
});

// GET /api/files/shared/:ticket — link assinado e temporário, usado só para a
// Meta buscar a arte na hora de publicar. Fica antes do authRequired.
// GET /api/files/previa/:bilhete — a arte reduzida, em bytes.
//
// Fica aqui (antes do authRequired) porque <img src> não manda cabeçalho de
// autenticação: quem entra é o bilhete assinado. Cache longo de propósito —
// a prévia de um arquivo nunca muda, então na segunda visita não custa nada.
sharedRouter.get("/previa/:bilhete", (req, res) => {
  let dados;
  try {
    dados = jwt.verify(req.params.bilhete, JWT_SECRET);
  } catch {
    return res.status(403).json({ error: "Link expirado ou inválido." });
  }
  if (!dados?.previa) return res.status(403).json({ error: "Link inválido." });
  const linha = db.prepare("SELECT preview FROM files WHERE id = ? AND org_id = ?")
    .get(dados.file_id, dados.org_id);
  if (!linha?.preview) return res.status(404).json({ error: "Sem prévia." });

  // A prévia é guardada como data URI ("data:image/jpeg;base64,...").
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(linha.preview);
  if (!m) return res.status(404).json({ error: "Sem prévia." });
  res.setHeader("Content-Type", m[1]);
  res.setHeader("Cache-Control", "private, max-age=604800, immutable");
  res.send(Buffer.from(m[2], "base64"));
});

sharedRouter.get("/shared/:ticket", async (req, res) => {
  let payload;
  try {
    payload = jwt.verify(req.params.ticket, JWT_SECRET);
  } catch {
    return res.status(403).json({ error: "Link expirado ou inválido." });
  }
  const file = db
    .prepare("SELECT * FROM files WHERE id = ? AND org_id = ?")
    .get(payload.file_id, payload.org_id);
  if (!file) return res.status(404).json({ error: "Arquivo não encontrado." });
  // payload.capturar: o navegador vai desenhar isto num canvas, então o arquivo
  // tem que vir por dentro do nosso servidor (ver bilheteDeMidia).
  await serveFile(res, file, false, req.headers.range, Boolean(payload.capturar));
});

router.use(authRequired, moduleAllowed("arquivos"));

// ---- Pastas ---------------------------------------------------------------
// GET /api/files/folders?client_id=&parent_id=
router.get("/folders", (req, res) => {
  const { client_id, parent_id, all } = req.query;
  const where = ["org_id = @org_id"];
  const params = { org_id: req.orgId };
  if (client_id) { where.push("client_id = @client_id"); params.client_id = client_id; }
  // all=1 → todas as pastas do cliente (para o seletor "mover para pasta").
  if (!all) {
    where.push(parent_id ? "parent_id = @parent_id" : "parent_id IS NULL");
    if (parent_id) params.parent_id = parent_id;
  }
  res.json(
    db.prepare(`SELECT * FROM folders WHERE ${where.join(" AND ")} ORDER BY name`).all(params)
  );
});

router.post("/folders", (req, res) => {
  const naoEhDaCasa = confere(req.orgId, { clients: req.body?.client_id });
  if (naoEhDaCasa) return res.status(400).json({ error: naoEhDaCasa });
  const { name, client_id, parent_id } = req.body || {};
  if (!name) return res.status(400).json({ error: "Nome da pasta é obrigatório." });
  const info = db
    .prepare("INSERT INTO folders (name, client_id, parent_id, org_id) VALUES (?, ?, ?, ?)")
    .run(name, client_id ?? null, parent_id ?? null, req.orgId);
  res.status(201).json(db.prepare("SELECT * FROM folders WHERE id = ?").get(info.lastInsertRowid));
});

// Pastas que já vêm prontas dentro de cada cliente (as antigas "etapas").
// A dona da agência pode apagar as que não usar e criar outras à vontade.
const DEFAULT_FOLDERS = ["Originais", "Editados", "Para aprovação", "Aprovados", "Programados"];

// POST /api/files/folders/ensure-defaults { client_id }
// Garante as pastas padrão na raiz do cliente (cria só as que faltam). Idempotente.
router.post("/folders/ensure-defaults", (req, res) => {
  const naoEhDaCasa = confere(req.orgId, { clients: req.body?.client_id });
  if (naoEhDaCasa) return res.status(400).json({ error: naoEhDaCasa });
  const clientId = req.body?.client_id;
  if (!clientId) return res.status(400).json({ error: "Informe o cliente." });
  const existentes = db
    .prepare("SELECT name FROM folders WHERE org_id = ? AND client_id = ? AND parent_id IS NULL")
    .all(req.orgId, clientId);
  const tem = new Set(existentes.map((f) => f.name));
  const faltando = DEFAULT_FOLDERS.filter((nome) => !tem.has(nome));
  const ins = db.prepare("INSERT INTO folders (name, client_id, parent_id, org_id) VALUES (?, ?, NULL, ?)");
  const tx = db.transaction(() => {
    faltando.forEach((nome) => ins.run(nome, clientId, req.orgId));
  });
  tx();
  // Não criou nada: não avisa ninguém. Esta rota é chamada toda vez que alguém
  // abre um cliente na Galeria, e como é um POST, o aviso automático saía
  // SEMPRE — fazendo todas as telas abertas do escritório recarregarem a lista
  // de arquivos (1,25 MB num cliente com 120) por nada.
  if (!faltando.length) res.locals.semAviso = true;
  res.json(
    db.prepare("SELECT * FROM folders WHERE org_id = ? AND client_id = ? AND parent_id IS NULL ORDER BY name")
      .all(req.orgId, clientId)
  );
});

router.delete("/folders/:id", async (req, res) => {
  const folder = db.prepare("SELECT id, name FROM folders WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!folder) return res.status(404).json({ error: "Pasta não encontrada." });

  // A PASTA INTEIRA, INCLUSIVE AS DE DENTRO.
  //
  // Antes só os arquivos soltos na pasta escolhida eram apagados de verdade.
  // Os que estavam numa SUBPASTA sumiam do banco (por cascata) e os bytes
  // ficavam na nuvem para sempre — invisíveis na galeria, impossíveis de
  // recuperar e cobrados no fim do mês. Aqui a árvore é percorrida inteira.
  const arvore = [Number(req.params.id)];
  for (let i = 0; i < arvore.length; i++) {
    const filhas = db.prepare("SELECT id FROM folders WHERE parent_id = ? AND org_id = ?").all(arvore[i], req.orgId);
    for (const f of filhas) arvore.push(f.id);
  }
  const marcas = arvore.map(() => "?").join(",");
  const arquivos = db.prepare(
    `SELECT stored_path FROM files WHERE org_id = ? AND folder_id IN (${marcas})`
  ).all(req.orgId, ...arvore);

  // `await`: sem ele, a resposta saía antes de a remoção sequer começar, e
  // qualquer falha da nuvem sumia sem deixar rastro.
  await emParalelo(arquivos, 4, (f) => removeStored(f.stored_path));

  db.prepare("DELETE FROM folders WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
  res.json({ ok: true, pastas: arvore.length, arquivos: arquivos.length });
});

// ---- Arquivos ---------------------------------------------------------------
// GET /api/files?client_id=&folder_id=&all=1  (all=1 ignora pastas)
router.get("/", async (req, res) => {
  const { client_id, folder_id, all } = req.query;
  const where = ["f.org_id = @org_id"];
  const params = { org_id: req.orgId };
  if (client_id) { where.push("f.client_id = @client_id"); params.client_id = client_id; }
  if (!all) {
    where.push(folder_id ? "f.folder_id = @folder_id" : "f.folder_id IS NULL");
    if (folder_id) params.folder_id = folder_id;
  }
  const rows = db.prepare(
    // f.stored_path entra aqui só para decidir o endereço (e sai antes de
    // responder). Sem ele, enderecoDeMidia não tinha como saber que o arquivo
    // está na nuvem e devolvia SEMPRE o caminho pelo nosso servidor: a galeria
    // inteira passava por dentro do Render, uma ida por foto, em vez de ir
    // direto na Cloudflare. O endereço direto existia e não estava sendo usado.
    `SELECT f.id, f.original_name, f.mime, f.size, f.created_at, f.folder_id, f.client_id,
            f.expires_at, f.keep_forever, f.stage, f.thumb, f.stored_path,
            f.carrossel_id, f.carrossel_pos, c.name AS client_name
     FROM files f LEFT JOIN clients c ON c.id = f.client_id
     WHERE ${where.join(" AND ")} ORDER BY f.original_name`
  ).all(params);
  // media_url: o endereço que o <img>/<video> usa. Para arquivo no R2 vai o
  // endereço DIRETO da Cloudflare — assim a galeria não faz o navegador bater
  // no nosso servidor uma vez por foto antes de começar a carregar.
  const previas = previasDe(db, rows.map((f) => f.id), req.orgId);
  await Promise.all(rows.map(async (f) => {
    f.media_url = await enderecoDeMidia(f, req.orgId);
    f.preview_url = previas.get(f.id) || null;
    delete f.stored_path;   // caminho interno não sai daqui
  }));
  res.json(rows);
});

// POST /api/files/upload — multipart; aceita vários arquivos de uma vez.
const STAGES = ["originais", "editados", "aprovacao", "aprovados", "programados"];

router.post("/upload", upload.array("files", 20), async (req, res) => {
  const { client_id, folder_id } = req.body || {};
  const stage = STAGES.includes(req.body?.stage) ? req.body.stage : "originais";
  const stmt = db.prepare(
    `INSERT INTO files (folder_id, client_id, original_name, mime, size, stored_path, stage, thumb, org_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // O navegador manda uma miniatura por arquivo, na mesma ordem. Limite
  // defensivo: miniatura é pequena; qualquer coisa maior é ignorada.
  const LIMITE_THUMB = 400 * 1024;
  let thumbs = [];
  try {
    const bruto = req.body?.thumbs;
    thumbs = bruto ? JSON.parse(Array.isArray(bruto) ? bruto[0] : bruto) : [];
  } catch { thumbs = []; }
  // Os arquivos vão para a nuvem em paralelo (alguns de cada vez). Em fila,
  // 10 fotos eram 10 esperas de rede uma atrás da outra — e quem enviou ficava
  // vendo a barra parada em 100% esse tempo todo.
  const AO_MESMO_TEMPO = 4;
  const guardados = await emParalelo(req.files || [], AO_MESMO_TEMPO, async (f) => {
    if (!storageConfigured()) return f.path; // sem R2: fica no disco
    try {
      const key = `uploads/${req.orgId}/${f.filename}`;
      const caminho = await uploadFileToR2(f.path, key, f.mimetype);
      try { unlinkSync(f.path); } catch {} // já está no R2, apaga o local
      return caminho;
    } catch {
      return f.path; // se o R2 falhar, não perde: mantém no disco
    }
  });

  // JÁ TEM UMA IGUAL AQUI?
  //
  // A galeria dela enche de "1.png", "2.png", "3.png" repetidos: manda o mesmo
  // arquivo duas vezes e ficam dois, sem ninguém avisar. Bloquear seria pior —
  // às vezes é de propósito, e perder o envio é imperdoável. Então o arquivo
  // entra do mesmo jeito, mas a resposta diz que já havia um igual (mesmo nome
  // e mesmo tamanho, na mesma pasta do mesmo cliente) e a tela mostra o aviso.
  const jaTinha = db.prepare(
    `SELECT id FROM files
      WHERE org_id = ? AND original_name = ? AND size = ?
        AND client_id IS ? AND folder_id IS ?
      LIMIT 1`
  );

  const created = [];
  for (const [i, f] of (req.files || []).entries()) {
    // originalname chega em latin1 no multer — normaliza para UTF-8.
    const name = Buffer.from(f.originalname, "latin1").toString("utf8");
    const repetida = Boolean(jaTinha.get(req.orgId, name, f.size, client_id || null, folder_id || null));
    const storedPath = guardados[i];
    const t = thumbs[i];
    const thumb = typeof t === "string" && t.startsWith("data:image/") && t.length <= LIMITE_THUMB ? t : null;
    const info = stmt.run(folder_id || null, client_id || null, name, f.mimetype, f.size, storedPath, stage, thumb, req.orgId);
    const novo = db.prepare("SELECT id, original_name, mime, size, created_at, thumb FROM files WHERE id = ?").get(info.lastInsertRowid);
    // O endereço direto vai junto na resposta. Sem isso, quem acabou de subir um
    // arquivo não tinha como mostrá-lo a não ser baixando tudo de novo — e era o
    // que fazia as slides recém-cortadas ficarem rodando sem fim, mesmo sendo
    // pequenas: nenhuma delas estava na listagem ainda.
    novo.media_url = await enderecoDeMidia(
      { id: novo.id, mime: novo.mime, original_name: novo.original_name, stored_path: storedPath },
      req.orgId,
    );
    novo.repetida = repetida;
    created.push(novo);
  }
  res.status(201).json(created);
});

// Recusa do multer vira uma frase que diz o limite, em vez de "Erro interno".
router.use("/upload", erroDeEnvio({ porArquivo: 2 * 1024 * 1024 * 1024, porVez: 20 }));

// Descobre o tipo (mime) de uma foto/vídeo pela extensão do nome.
const MIME_BY_EXT = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif", ".bmp": "image/bmp",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska", ".m4v": "video/x-m4v",
};

// POST /api/files/upload-zip — importa em massa: recebe UM arquivo .zip e cria
// um arquivo para cada foto/vídeo de dentro dele, no cliente/pasta escolhidos.
router.post("/upload-zip", upload.single("zip"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Envie um arquivo .zip." });
  const { client_id, folder_id } = req.body || {};
  const stage = STAGES.includes(req.body?.stage) ? req.body.stage : "originais";

  let entries;
  try {
    entries = new AdmZip(req.file.path).getEntries();
  } catch {
    try { unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: "Não consegui ler o .zip. Confira se o arquivo está certo." });
  }

  const stmt = db.prepare(
    `INSERT INTO files (folder_id, client_id, original_name, mime, size, stored_path, stage, org_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let ignorados = 0;
  // Primeiro separa o que vale (fotos e vídeos); o resto nem é aberto.
  const aproveitar = [];
  for (const e of entries) {
    if (e.isDirectory) continue;
    const nome = basename(e.entryName);
    if (!nome || nome.startsWith(".") || e.entryName.startsWith("__MACOSX")) continue;
    const mime = MIME_BY_EXT[extname(nome).toLowerCase()];
    if (!mime) { ignorados++; continue; } // só fotos e vídeos
    aproveitar.push({ e, nome, mime });
  }

  // Um .zip de 200 fotos era 200 idas à nuvem em fila, dentro de UM pedido só,
  // sem nada aparecer na tela enquanto isso. Agora alguns sobem juntos. O
  // limite baixo é de propósito: segurar 200 fotos na memória derruba o
  // servidor, e aqui no máximo 4 ficam abertas ao mesmo tempo.
  const AO_MESMO_TEMPO = 4;
  const prontos = await emParalelo(aproveitar, AO_MESMO_TEMPO, async ({ e, nome, mime }) => {
    const localName = `${Date.now()}-${randomUUID()}`;
    const localPath = join(UPLOADS_DIR, localName);
    try {
      const buf = e.getData();
      writeFileSync(localPath, buf);
      let storedPath = localPath;
      if (storageConfigured()) {
        try {
          storedPath = await uploadFileToR2(localPath, `uploads/${req.orgId}/${localName}`, mime);
          try { unlinkSync(localPath); } catch {}
        } catch { storedPath = localPath; }
      }
      return { nome, mime, tamanho: buf.length, storedPath };
    } catch {
      try { unlinkSync(localPath); } catch {}
      return null;
    }
  });

  let count = 0;
  // A gravação no banco fica aqui fora, na ordem do .zip — é rápida e mantém a
  // sequência das fotos igual à da pasta que ela compactou.
  for (const p of prontos) {
    if (!p) { ignorados++; continue; }
    stmt.run(folder_id || null, client_id || null, p.nome, p.mime, p.tamanho, p.storedPath, stage, req.orgId);
    count++;
  }
  try { unlinkSync(req.file.path); } catch {} // apaga o zip temporário

  res.status(201).json({ count, ignorados });
});

// GET /api/files/:id/download — devolve o arquivo original, intacto.
router.get("/:id/download", async (req, res) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!file) return res.status(404).json({ error: "Arquivo não encontrado." });
  await serveFile(res, file, true);
});

// PUT /api/files/:id — renomear e/ou mover para outra pasta.
// GET /api/files/:id/thumb — só a miniatura (leve). A Distribuição usa isso
// para desenhar a grade do perfil sem baixar a arte inteira de cada quadrado —
// e é o que faz o VÍDEO aparecer ali, já que <img> não toca vídeo.
// GET /api/files/armazenamento — onde os arquivos estão de verdade.
//
// Existe para responder uma pergunta simples sem ter que abrir o Render: o R2
// está ligado? Está sendo usado? Arquivo antigo continua no disco (o R2 só vale
// do momento em que foi ligado), e é isso que esta tela mostra.
router.get("/armazenamento", (req, res) => {
  const conta = db.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN stored_path LIKE 'r2:%' THEN 1 ELSE 0 END) AS no_r2,
       SUM(CASE WHEN stored_path LIKE 'r2:%' THEN 0 ELSE 1 END) AS no_disco,
       COALESCE(SUM(CASE WHEN stored_path LIKE 'r2:%' THEN size ELSE 0 END), 0) AS bytes_r2,
       COALESCE(SUM(CASE WHEN stored_path LIKE 'r2:%' THEN 0 ELSE size END), 0) AS bytes_disco
     FROM files WHERE org_id = ?`
  ).get(req.orgId);

  const videos = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN stored_path LIKE 'r2:%' THEN 1 ELSE 0 END) AS no_r2
       FROM files WHERE org_id = ? AND mime LIKE 'video/%'`
  ).get(req.orgId);

  res.json({
    r2_ligado: storageConfigured(),
    ...conta,
    videos_total: videos.total || 0,
    videos_no_r2: videos.no_r2 || 0,
  });
});

// GET /api/files/diagnostico — "as fotos sumiram, por quê?" em uma resposta.
//
// Existe porque a falha mais assustadora deste sistema é silenciosa: se o
// acesso ao R2 quebra (chave trocada, variável perdida num deploy, permissão
// removida), TODA foto e TODO vídeo somem de uma vez, sem erro nenhum na tela
// e sem nada de errado no banco. Os arquivos continuam guardados; é o acesso
// que caiu. Esta rota diz isso com todas as letras, em vez de deixar a pessoa
// achando que perdeu o trabalho.
router.get("/diagnostico", async (req, res) => {
  const noR2 = db.prepare(
    "SELECT stored_path FROM files WHERE org_id = ? AND stored_path LIKE 'r2:%' ORDER BY id DESC LIMIT 1"
  ).get(req.orgId);

  const emDisco = db.prepare(
    "SELECT stored_path FROM files WHERE org_id = ? AND stored_path NOT LIKE 'r2:%' ORDER BY id DESC LIMIT 20"
  ).all(req.orgId);
  const sumiramDoDisco = emDisco.filter((f) => !existsSync(f.stored_path)).length;

  const r2 = await testarR2(noR2 ? r2Key(noR2.stored_path) : null);

  const conta = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN stored_path LIKE 'r2:%' THEN 1 ELSE 0 END) AS no_r2
       FROM files WHERE org_id = ?`
  ).get(req.orgId);

  // O veredito em uma frase — é o que a pessoa precisa ler primeiro.
  let veredito;
  if (!r2.ok && conta.no_r2 > 0) {
    veredito = `${conta.no_r2} de ${conta.total} arquivos estão no R2 e NENHUM deles consegue ser mostrado agora. ${r2.mensagem}`;
  } else if (sumiramDoDisco > 0) {
    veredito = `Pelo menos ${sumiramDoDisco} arquivos guardados no disco deste servidor não estão mais lá. `
      + "Disco de servidor é apagado a cada troca de máquina — é para isso que serve o R2.";
  } else if (conta.no_r2 === 0) {
    // R2 desligado sem nenhum arquivo lá não é problema nenhum: dizer
    // "DESLIGADO" aqui só assusta quem não tem nada para perder.
    veredito = "Nada errado com o armazenamento: os arquivos estão acessíveis."
      + (r2.ok ? "" : " (A nuvem R2 não está ligada, mas nenhum arquivo depende dela.)");
  } else if (r2.ok) {
    veredito = "Nada errado com o armazenamento: os arquivos estão acessíveis.";
  } else {
    veredito = r2.mensagem;
  }

  res.json({ veredito, r2, total: conta.total, no_r2: conta.no_r2,
             amostra_disco: emDisco.length, sumiram_do_disco: sumiramDoDisco });
});

// GET /api/files/:id/link — o endereço PELO NOSSO SERVIDOR para um arquivo.
//
// Existe para o caso em que o endereço direto da nuvem não serve: telas que
// CAPTURAM um quadro do vídeo (escolher a capa) desenham num canvas, e o
// navegador proíbe capturar de mídia que veio de outro domínio. Deste endereço
// a captura funciona, porque é o nosso próprio domínio.
router.get("/:id/link", (req, res) => {
  const f = db.prepare("SELECT id FROM files WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!f) return res.status(404).json({ error: "Arquivo não encontrado." });
  // Esta rota existe para as telas que CAPTURAM o arquivo num canvas (o quadro
  // de capa do vídeo, a prévia de uma arte antiga). Por isso o bilhete vem
  // marcado: o arquivo passa por dentro do servidor em vez de terminar num
  // redirecionamento para a Cloudflare, que sujaria o canvas.
  res.json({ url: bilheteDeMidia(f.id, req.orgId, { paraCapturar: true }) });
});

router.get("/:id/thumb", (req, res) => {
  const f = db.prepare("SELECT thumb FROM files WHERE id = ? AND org_id = ?")
    .get(req.params.id, req.orgId);
  if (!f) return res.status(404).json({ error: "Arquivo não encontrado." });
  // Arquivo enviado antes de a miniatura existir simplesmente não tem uma —
  // isso é normal, não é erro. Devolvendo 200 com thumb: null, a grade cai na
  // arte inteira sem encher o console de 404 a cada quadradinho (o 404 aqui
  // fica só para arquivo que não existe mesmo).
  res.json({ thumb: f.thumb || null });
});

// PUT /api/files/:id/thumb — guarda a miniatura de um arquivo que ainda não
// tinha. Quem gera é o navegador, a partir da mídia que já está na tela: assim
// os arquivos enviados ANTES desta função também ficam leves na grade, sem
// precisar reenviar nada e sem biblioteca de imagem no servidor.
router.put("/:id/thumb", (req, res) => {
  const file = db.prepare("SELECT id, thumb FROM files WHERE id = ? AND org_id = ?")
    .get(req.params.id, req.orgId);
  if (!file) return res.status(404).json({ error: "Arquivo não encontrado." });
  if (file.thumb) { res.locals.semAviso = true; return res.json({ ok: true, ja_tinha: true }); }

  const t = req.body?.thumb;
  if (typeof t !== "string" || !t.startsWith("data:image/")) {
    return res.status(400).json({ error: "Miniatura inválida." });
  }
  if (t.length > 300 * 1024) return res.status(400).json({ error: "Miniatura grande demais." });

  db.prepare("UPDATE files SET thumb = ? WHERE id = ? AND org_id = ?").run(t, file.id, req.orgId);
  // Miniatura é conserto interno, não mudança de conteúdo: ninguém precisa ser
  // avisado. Sem isto, cada miniatura guardada por uma grade fazia TODAS as
  // telas abertas do escritório recarregarem a lista de arquivos — que num
  // cliente com 120 arquivos são 1,25 MB, vezes o número de quadros da grade.
  res.locals.semAviso = true;
  res.json({ ok: true });
});

// PUT /api/files/:id/previa — o navegador manda a arte reduzida depois de
// desenhá-la. Arquivo antigo (enviado antes disso existir) ganha a sua prévia
// na primeira vez que alguém abre a tela, sem ninguém precisar fazer nada.
router.put("/:id/previa", (req, res) => {
  const file = db.prepare("SELECT id, preview FROM files WHERE id = ? AND org_id = ?")
    .get(req.params.id, req.orgId);
  if (!file) return res.status(404).json({ error: "Arquivo não encontrado." });
  const p = req.body?.previa;
  if (typeof p !== "string" || !p.startsWith("data:image/")) {
    return res.status(400).json({ error: "Prévia inválida." });
  }
  // 1,6 MB de folga. A prévia de um post passa longe disso; a de uma TIRA de
  // carrossel é maior de propósito, porque ela guarda várias lâminas lado a
  // lado — e ainda assim é uma fração do arquivo original.
  if (p.length > 1600 * 1024) return res.status(400).json({ error: "Prévia grande demais." });

  // UMA PRÉVIA MELHOR SUBSTITUI A ANTIGA.
  //
  // Antes esta rota recusava qualquer prévia quando já havia uma: respondia
  // "já tinha" e jogava a nova fora. Era o que travava o conserto das tiras de
  // carrossel — o navegador refazia a prévia em alta a partir do original, e o
  // servidor descartava em silêncio. A tela continuava borrada e ninguém via
  // erro nenhum.
  //
  // O critério é o tamanho: para a mesma arte, mais resolução é mais bytes.
  // Prévia menor ou igual não substitui, então uma tela antiga não estraga o
  // que já está bom.
  if (file.preview && file.preview.length >= p.length) {
    res.locals.semAviso = true;
    return res.json({ ok: true, ja_tinha: true });
  }

  db.prepare("UPDATE files SET preview = ? WHERE id = ? AND org_id = ?").run(p, file.id, req.orgId);
  res.locals.semAviso = true;   // conserto interno, igual à miniatura acima
  res.json({ ok: true });
});

// --- CARROSSEL MONTADO NA GALERIA -------------------------------------------
//
// Pedido dela: "se eu segurar um e arrastar pra cima de outro, o que eu
// arrastar vira o segundo slide daquele post; se arrasto mais um, fica como o
// terceiro... e aí vai. Unifica."
//
// NADA É RECORTADO NEM REGRAVADO. Unir é só pendurar uma etiqueta: quem é a
// CAPA (a primeira lâmina) e em que ordem vêm as outras. Cada lâmina continua
// sendo o arquivo original, inteiro, com a qualidade que subiu. É por isso que
// o "baixar" já sai separado — as lâminas nunca chegaram a virar um arquivo só.

const UNIVEL = /^(image|video)\//;   // só arte vira lâmina de post

function laminasDe(orgId, capaId) {
  return db.prepare(
    `SELECT id, original_name, carrossel_pos FROM files
     WHERE org_id = ? AND carrossel_id = ? ORDER BY carrossel_pos, id`
  ).all(orgId, capaId);
}

// Renumera 1, 2, 3… para não sobrar buraco quando uma lâmina sai do meio.
function arrumarOrdem(orgId, capaId) {
  const laminas = laminasDe(orgId, capaId);
  if (laminas.length <= 1) {
    // Carrossel de uma lâmina só não é carrossel: desfaz a etiqueta.
    db.prepare("UPDATE files SET carrossel_id = NULL, carrossel_pos = 0 WHERE org_id = ? AND carrossel_id = ?")
      .run(orgId, capaId);
    return [];
  }
  const passo = db.prepare("UPDATE files SET carrossel_pos = ? WHERE id = ? AND org_id = ?");
  laminas.forEach((l, i) => passo.run(i + 1, l.id, orgId));
  return laminasDe(orgId, capaId);
}

// POST /api/files/:id/carrossel — { ids: [...] } entram como próximas lâminas
// do post cuja capa é :id. Arrastar um carrossel inteiro leva as lâminas dele
// junto, na ordem em que estavam.
router.post("/:id/carrossel", (req, res) => {
  const alvo = db.prepare("SELECT * FROM files WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!alvo) return res.status(404).json({ error: "Arquivo não encontrado." });
  if (!UNIVEL.test(alvo.mime || "")) return res.status(400).json({ error: "Só foto e vídeo viram carrossel." });

  // Soltar em cima de uma lâmina do meio vale como soltar no post inteiro.
  const capaId = alvo.carrossel_id || alvo.id;

  const pedidos = (Array.isArray(req.body?.ids) ? req.body.ids : [req.body?.id])
    .map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
  if (!pedidos.length) return res.status(400).json({ error: "Nenhuma arte para unir." });

  // Quem já é lâmina deste mesmo post não entra de novo (soltar dentro do
  // próprio carrossel não faz nada).
  const jaSao = new Set(laminasDe(req.orgId, capaId).map((l) => l.id));

  // Abre cada pedido nas lâminas que ele representa, na ordem certa.
  const entrando = [];
  for (const id of pedidos) {
    const f = db.prepare("SELECT * FROM files WHERE id = ? AND org_id = ?").get(id, req.orgId);
    if (!f) continue;
    if (!UNIVEL.test(f.mime || "")) continue;
    const grupo = f.carrossel_id ? laminasDe(req.orgId, f.carrossel_id).map((l) => l.id) : [f.id];
    for (const gid of grupo) {
      if (gid === capaId || jaSao.has(gid)) continue;   // não se une a si mesmo
      if (!entrando.includes(gid)) entrando.push(gid);
    }
  }
  if (!entrando.length) return res.status(400).json({ error: "Nenhuma arte para unir." });

  const capa = db.prepare("SELECT * FROM files WHERE id = ? AND org_id = ?").get(capaId, req.orgId);
  const jaTem = laminasDe(req.orgId, capaId);
  let pos = jaTem.length ? jaTem[jaTem.length - 1].carrossel_pos : 0;
  if (!jaTem.length) {
    // A capa entra como lâmina 1 do próprio carrossel.
    db.prepare("UPDATE files SET carrossel_id = ?, carrossel_pos = 1 WHERE id = ? AND org_id = ?")
      .run(capaId, capaId, req.orgId);
    pos = 1;
  }
  // A lâmina acompanha a capa de pasta: o post não fica partido em duas telas.
  const juntar = db.prepare(
    "UPDATE files SET carrossel_id = ?, carrossel_pos = ?, folder_id = ? WHERE id = ? AND org_id = ?"
  );
  db.transaction(() => {
    for (const id of entrando) juntar.run(capaId, ++pos, capa.folder_id, id, req.orgId);
  })();

  res.json({ ok: true, capa_id: capaId, laminas: arrumarOrdem(req.orgId, capaId) });
});

// DELETE /api/files/:id/carrossel — separa de novo. Na capa, desfaz o post
// inteiro; numa lâmina do meio, tira só ela e as outras se reordenam.
router.delete("/:id/carrossel", (req, res) => {
  const f = db.prepare("SELECT * FROM files WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!f) return res.status(404).json({ error: "Arquivo não encontrado." });
  if (!f.carrossel_id) return res.json({ ok: true, laminas: [] });
  const capaId = f.carrossel_id;
  if (capaId === f.id) {
    db.prepare("UPDATE files SET carrossel_id = NULL, carrossel_pos = 0 WHERE org_id = ? AND carrossel_id = ?")
      .run(req.orgId, capaId);
    return res.json({ ok: true, laminas: [] });
  }
  db.prepare("UPDATE files SET carrossel_id = NULL, carrossel_pos = 0 WHERE id = ? AND org_id = ?")
    .run(f.id, req.orgId);
  res.json({ ok: true, capa_id: capaId, laminas: arrumarOrdem(req.orgId, capaId) });
});

// POST /api/files/lote — apagar ou mover várias de uma vez. É o que os
// quadradinhos de seleção da Galeria usam: 20 arquivos marcados viravam 20
// pedidos, e o navegador só deixa seis conversas abertas de cada vez.
router.post("/lote", async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
    .map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
  const acao = req.body?.acao;
  if (!ids.length) return res.status(400).json({ error: "Nenhum arquivo selecionado." });

  const marcas = ids.map(() => "?").join(",");
  const alvos = db.prepare(`SELECT * FROM files WHERE org_id = ? AND id IN (${marcas})`).all(req.orgId, ...ids);

  if (acao === "apagar") {
    // Apagar a capa levaria o post inteiro junto sem querer: as lâminas ficam,
    // e a próxima vira capa.
    const capas = new Set(alvos.map((f) => f.carrossel_id).filter(Boolean));
    for (const f of alvos) await removeStored(f.stored_path);
    db.prepare(`DELETE FROM files WHERE org_id = ? AND id IN (${marcas})`).run(req.orgId, ...ids);
    for (const capaId of capas) promoverCapa(req.orgId, capaId);
    return res.json({ ok: true, apagados: alvos.length });
  }

  if (acao === "mover") {
    let destino = null;
    if (req.body?.folder_id) {
      const pasta = db.prepare("SELECT id FROM folders WHERE id = ? AND org_id = ?").get(req.body.folder_id, req.orgId);
      if (!pasta) return res.status(400).json({ error: "Pasta de destino inválida." });
      destino = pasta.id;
    }
    // Mover a capa leva o post inteiro: um carrossel partido entre duas pastas
    // não é um carrossel.
    const todos = new Set(ids);
    for (const f of alvos) {
      if (f.carrossel_id) for (const l of laminasDe(req.orgId, f.carrossel_id)) todos.add(l.id);
    }
    const lista = [...todos];
    const m2 = lista.map(() => "?").join(",");
    db.prepare(`UPDATE files SET folder_id = ? WHERE org_id = ? AND id IN (${m2})`).run(destino, req.orgId, ...lista);
    return res.json({ ok: true, movidos: lista.length });
  }

  res.status(400).json({ error: "Ação desconhecida." });
});

// Sobrou lâmina sem capa? A primeira que restou assume — o post não some
// porque a primeira arte foi apagada.
function promoverCapa(orgId, capaId) {
  const capa = db.prepare("SELECT id FROM files WHERE id = ? AND org_id = ?").get(capaId, orgId);
  if (capa) { arrumarOrdem(orgId, capaId); return; }
  const restantes = laminasDe(orgId, capaId);
  if (!restantes.length) return;
  const nova = restantes[0].id;
  db.prepare("UPDATE files SET carrossel_id = ? WHERE org_id = ? AND carrossel_id = ?").run(nova, orgId, capaId);
  arrumarOrdem(orgId, nova);
}

router.put("/:id", (req, res) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (!file) return res.status(404).json({ error: "Arquivo não encontrado." });
  const b = req.body || {};
  // Se veio folder_id, valida que a pasta é do mesmo escritório.
  let folderId = file.folder_id;
  if (b.folder_id !== undefined) {
    if (b.folder_id === null || b.folder_id === "") { folderId = null; }
    else {
      const f = db.prepare("SELECT id FROM folders WHERE id = ? AND org_id = ?").get(b.folder_id, req.orgId);
      if (!f) return res.status(400).json({ error: "Pasta de destino inválida." });
      folderId = f.id;
    }
  }
  const name = (b.original_name && String(b.original_name).trim()) || file.original_name;
  db.prepare("UPDATE files SET original_name = ?, folder_id = ? WHERE id = ? AND org_id = ?")
    .run(name, folderId, req.params.id, req.orgId);
  res.json(db.prepare("SELECT id, original_name, mime, size, folder_id, created_at FROM files WHERE id = ?").get(req.params.id));
});

// PUT /api/files/:id/stage — move o arquivo entre etapas (originais → ... → programados).
router.put("/:id/stage", (req, res) => {
  const stage = STAGES.includes(req.body?.stage) ? req.body.stage : null;
  if (!stage) return res.status(400).json({ error: "Etapa inválida." });
  db.prepare("UPDATE files SET stage = ? WHERE id = ? AND org_id = ?").run(stage, req.params.id, req.orgId);
  res.json({ ok: true, stage });
});

// PUT /api/files/:id/keep — trava o arquivo para nunca expirar.
router.put("/:id/keep", (req, res) => {
  db.prepare("UPDATE files SET keep_forever = ? WHERE id = ? AND org_id = ?")
    .run(req.body?.keep ? 1 : 0, req.params.id, req.orgId);
  res.json({ ok: true, keep: !!req.body?.keep });
});

router.delete("/:id", async (req, res) => {
  const file = db.prepare("SELECT * FROM files WHERE id = ? AND org_id = ?").get(req.params.id, req.orgId);
  if (file) {
    await removeStored(file.stored_path);
    db.prepare("DELETE FROM files WHERE id = ? AND org_id = ?").run(req.params.id, req.orgId);
    if (file.carrossel_id) promoverCapa(req.orgId, file.carrossel_id);
  }
  res.json({ ok: true });
});

export default router;
