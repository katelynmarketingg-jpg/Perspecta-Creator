import { db } from "./db.js";

// ---------------------------------------------------------------------------
// Sincroniza a mídia anexada a uma peça com as pastas da Galeria do cliente.
//
// Ideia: a foto/vídeo que a peça usa "acompanha" o conteúdo. Quando a peça
// muda de etapa (vai para aprovação, é aprovada, é programada), o arquivo pula
// para a pasta correspondente na Galeria daquele cliente — Para aprovação →
// Aprovados → Programados —, mantendo o material organizado sozinho.
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

// Move a mídia anexada da peça para a pasta da etapa `key` (chave de STAGE_FOLDER).
// Silencioso: se a peça não tem cliente ou não tem anexo, não faz nada.
export function syncTaskMediaToStage(orgId, taskId, key) {
  const map = STAGE_FOLDER[key];
  if (!map) return;
  const task = db.prepare("SELECT client_id FROM tasks WHERE id = ? AND org_id = ?").get(taskId, orgId);
  if (!task || !task.client_id) return;
  const att = db.prepare("SELECT file_id FROM task_attachments WHERE task_id = ? LIMIT 1").get(taskId);
  if (!att?.file_id) return;
  const folderId = ensureClientFolder(orgId, task.client_id, map.folder);
  if (!folderId) return;
  db.prepare("UPDATE files SET folder_id = ?, stage = ? WHERE id = ? AND org_id = ?")
    .run(folderId, map.stage, att.file_id, orgId);
}
