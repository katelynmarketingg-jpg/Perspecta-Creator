import { db } from "./db.js";
import { broadcast } from "./live.js";

// ---------------------------------------------------------------------------
// A GALERIA ACOMPANHA A DISTRIBUIÇÃO.
//
// Ideia: a arte que a peça usa "acompanha" o conteúdo. Quando a peça muda de
// etapa (vai para aprovação, é aprovada, é programada), a arte pula para a
// pasta correspondente na Galeria daquele cliente — Para aprovação → Aprovados
// → Programados. Assim o material se organiza sozinho, e ao escolher "Da
// galeria" a arte já não aparece mais na pasta antiga.
//
// TRÊS COISAS ESTAVAM FALTANDO, e eram elas que faziam parecer que não
// funcionava:
//
//   1. só o PRIMEIRO arquivo se mexia. A peça guarda a arte em três lugares —
//      o anexo, a lista de lâminas do carrossel e a capa do perfil — e a conta
//      antiga lia só o anexo, com LIMIT 1. Num carrossel de sete lâminas, seis
//      ficavam para trás na pasta antiga;
//   2. ANEXAR A ARTE DEPOIS não movia nada. A mudança de etapa avisava, mas
//      escolher a arte numa peça JÁ programada não — e esse é o caminho comum:
//      programa primeiro, escolhe a arte depois;
//   3. lâmina de um post unido na Galeria ia sozinha, partindo o post entre
//      duas pastas.
// ---------------------------------------------------------------------------

// Nome da pasta padrão de cada etapa + o valor equivalente do campo `stage`.
export const STAGE_FOLDER = {
  aprovacao:   { folder: "Para aprovação", stage: "aprovacao" },
  aprovados:   { folder: "Aprovados", stage: "aprovados" },
  programados: { folder: "Programados", stage: "programados" },
  editados:    { folder: "Editados", stage: "editados" },
  originais:   { folder: "Originais", stage: "originais" },
};

// Acha (ou cria) a pasta padrão daquele nome na raiz do cliente.
export function ensureClientFolder(orgId, clientId, name) {
  if (!clientId || !name) return null;
  const found = db
    .prepare("SELECT id FROM folders WHERE org_id = ? AND client_id = ? AND parent_id IS NULL AND name = ?")
    .get(orgId, clientId, name);
  if (found) return found.id;
  const info = db
    .prepare("INSERT INTO folders (name, client_id, parent_id, org_id) VALUES (?, ?, NULL, ?)")
    .run(name, clientId, orgId);
  return info.lastInsertRowid;
}

function idsDeMediaIds(texto) {
  try {
    const v = JSON.parse(texto || "[]");
    return Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : [];
  } catch { return []; }
}

/**
 * TODOS os arquivos que a peça usa: o anexo, as lâminas do carrossel e a capa
 * do perfil. E, para cada um, as outras lâminas do post unido na Galeria — um
 * carrossel montado lá não pode ficar partido entre duas pastas.
 */
export function arquivosDaPeca(orgId, taskId) {
  const t = db.prepare("SELECT media_ids, cover_file_id FROM tasks WHERE id = ? AND org_id = ?")
    .get(taskId, orgId);
  if (!t) return [];
  const ids = new Set();
  for (const a of db.prepare("SELECT file_id FROM task_attachments WHERE task_id = ?").all(taskId)) {
    if (a.file_id) ids.add(Number(a.file_id));
  }
  for (const id of idsDeMediaIds(t.media_ids)) ids.add(id);
  if (t.cover_file_id) ids.add(Number(t.cover_file_id));
  if (!ids.size) return [];

  const marcas = [...ids].map(() => "?").join(",");
  const linhas = db.prepare(
    `SELECT id, carrossel_id FROM files WHERE org_id = ? AND id IN (${marcas})`
  ).all(orgId, ...ids);
  const grupos = new Set(linhas.map((f) => f.carrossel_id).filter(Boolean));
  const todos = new Set(linhas.map((f) => f.id));
  for (const capa of grupos) {
    for (const l of db.prepare("SELECT id FROM files WHERE org_id = ? AND carrossel_id = ?").all(orgId, capa)) {
      todos.add(l.id);
    }
  }
  return [...todos];
}

/**
 * Em que pasta a arte desta peça deveria estar, pela etapa em que ela está.
 * Devolve null enquanto a peça está em preparação — aí a arte fica onde está,
 * que é justamente onde a pessoa a deixou.
 */
export function etapaDaPeca(orgId, taskId) {
  const t = db.prepare(
    `SELECT t.approval_status, s.name AS etapa, s.is_done
     FROM tasks t LEFT JOIN kanban_stages s ON s.id = t.stage_id
     WHERE t.id = ? AND t.org_id = ?`
  ).get(taskId, orgId);
  if (!t) return null;
  if (t.is_done) return "programados";
  if (t.approval_status === "approved") return "aprovados";
  if (/aprova/i.test(t.etapa || "")) return "aprovacao";
  return null;
}

// Move a arte da peça para a pasta da etapa `key` (chave de STAGE_FOLDER).
// Silencioso: se a peça não tem cliente ou não tem arte, não faz nada.
// Devolve quantos arquivos de fato mudaram de pasta.
export function syncTaskMediaToStage(orgId, taskId, key) {
  const map = STAGE_FOLDER[key];
  if (!map) return 0;
  const task = db.prepare("SELECT client_id FROM tasks WHERE id = ? AND org_id = ?").get(taskId, orgId);
  if (!task || !task.client_id) return 0;
  const ids = arquivosDaPeca(orgId, taskId);
  if (!ids.length) return 0;
  const folderId = ensureClientFolder(orgId, task.client_id, map.folder);
  if (!folderId) return 0;

  const marcas = ids.map(() => "?").join(",");
  // Conta só o que realmente sai do lugar: é o que decide se vale avisar as
  // telas abertas.
  const mexer = db.prepare(
    `SELECT COUNT(*) AS n FROM files
     WHERE org_id = ? AND id IN (${marcas}) AND (folder_id IS NOT ? OR stage IS NOT ?)`
  ).get(orgId, ...ids, folderId, map.stage).n;
  if (!mexer) return 0;

  db.prepare(
    `UPDATE files SET folder_id = ?, stage = ? WHERE org_id = ? AND id IN (${marcas})`
  ).run(folderId, map.stage, orgId, ...ids);
  // A Galeria aberta em outra aba precisa saber: a arte saiu da pasta em que
  // ela está mostrando.
  try { broadcast(orgId, "files"); } catch { /* sem canal aberto, tudo bem */ }
  return mexer;
}

/**
 * É uma PEÇA DE CONTEÚDO (post, reel, carrossel…) ou uma tarefa comum do
 * quadro? Só peça de conteúdo arrasta a arte pelas pastas da Galeria: uma
 * tarefa qualquer com um anexo — um contrato, uma referência — não tem nada
 * que fazer numa pasta chamada "Programados".
 */
function ehPecaDeConteudo(orgId, taskId) {
  const t = db.prepare("SELECT content_type FROM tasks WHERE id = ? AND org_id = ?").get(taskId, orgId);
  return Boolean(t && t.content_type);
}

/**
 * A arte mudou numa peça: leva a arte NOVA para a pasta da etapa em que a peça
 * já está. É o caso de escolher "Da galeria" numa peça que já foi programada —
 * antes nada se movia, porque só a mudança de etapa avisava.
 */
export function syncTaskMediaToCurrentStage(orgId, taskId) {
  if (!ehPecaDeConteudo(orgId, taskId)) return 0;
  const key = etapaDaPeca(orgId, taskId);
  return key ? syncTaskMediaToStage(orgId, taskId, key) : 0;
}

// ---------------------------------------------------------------------------
// CONSERTO DO QUE JÁ ESTÁ NO AR — roda uma vez.
//
// As peças que já foram para aprovação ou já foram programadas ficaram com a
// arte parada na pasta antiga, pelos motivos lá de cima. Este conserto passa
// por elas e leva a arte para a pasta que corresponde à etapa em que cada uma
// está hoje.
//
// Uma vez só, de propósito: depois disso a pessoa é dona das pastas. Se ela
// mover uma arte à mão, ninguém a puxa de volta na próxima reinicialização.
// ---------------------------------------------------------------------------
const CHAVE_CONSERTO = "galeria-segue-distribuicao-2026-09";

export function arrumarPastasAtrasadas() {
  db.exec(`CREATE TABLE IF NOT EXISTS migracoes (
    chave      TEXT PRIMARY KEY,
    rodou_em   TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  if (db.prepare("SELECT 1 FROM migracoes WHERE chave = ?").get(CHAVE_CONSERTO)) return 0;

  // Só PEÇAS DE CONTEÚDO, com cliente e com arte. Uma tarefa comum do quadro
  // com um anexo pendurado não entra: o anexo dela não é material de post.
  const pecas = db.prepare(
    `SELECT t.id, t.org_id FROM tasks t
     WHERE t.client_id IS NOT NULL AND t.content_type IS NOT NULL AND t.content_type <> ''
       AND (t.cover_file_id IS NOT NULL
            OR (t.media_ids IS NOT NULL AND t.media_ids <> '[]')
            OR EXISTS (SELECT 1 FROM task_attachments ta WHERE ta.task_id = t.id))`
  ).all();

  let mexidas = 0;
  for (const p of pecas) {
    const key = etapaDaPeca(p.org_id, p.id);
    if (!key) continue;                       // em preparação: a arte fica onde está
    if (syncTaskMediaToStage(p.org_id, p.id, key)) mexidas += 1;
  }
  db.prepare("INSERT INTO migracoes (chave) VALUES (?)").run(CHAVE_CONSERTO);
  return mexidas;
}
