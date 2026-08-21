import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { db } from "./db.js";
import { storageConfigured, uploadFileToR2, deleteR2Object, listR2Objects } from "./storage.js";

// ---------------------------------------------------------------------------
// Backup do BANCO (agency.db) — os dados estruturados: logins, clientes,
// tarefas, financeiro, etc. NÃO inclui os arquivos de mídia (fotos/vídeos),
// que ficam em /var/data/uploads — esses são protegidos à parte (ex.: R2).
//
// Usa a cópia online do better-sqlite3 (db.backup), que gera um arquivo
// consistente mesmo com o WAL ativo (não é um simples copy do arquivo).
// ---------------------------------------------------------------------------
const DB_PATH = process.env.DB_PATH || "./data/agency.db";
const BACKUP_DIR = process.env.BACKUP_DIR || join(dirname(DB_PATH), "backups");
const KEEP = 7; // mantém as 7 cópias diárias mais recentes

// Gera uma cópia consistente do banco no caminho indicado.
export async function makeBackup(destPath) {
  await db.backup(destPath);
  return destPath;
}

// Apaga as cópias diárias mais antigas, mantendo só as KEEP mais novas.
function pruneOld() {
  try {
    const files = readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("agency-") && f.endsWith(".db"))
      .map((f) => ({ f, t: statSync(join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    files.slice(KEEP).forEach(({ f }) => {
      try { unlinkSync(join(BACKUP_DIR, f)); } catch { /* já não existe */ }
    });
  } catch { /* diretório ainda vazio */ }
}

const R2_PREFIX = "backups/"; // cópias remotas do banco (fora do disco do Render)

// Envia a cópia diária também para o R2 e mantém só as KEEP remotas.
// É o backup contra PERDA DO DISCO: se o disco/serviço do Render sumir, o disco
// local vai junto, mas a cópia no R2 sobrevive. Se o R2 falhar, registra no log.
async function copyToR2(localPath, day) {
  if (!storageConfigured()) return; // sem R2, fica só a cópia local
  try {
    await uploadFileToR2(localPath, `${R2_PREFIX}agency-${day}.db`, "application/x-sqlite3");
    const remotos = await listR2Objects(R2_PREFIX);
    for (const o of remotos.slice(KEEP)) {
      try { await deleteR2Object(o.key); } catch { /* ignora */ }
    }
  } catch (e) {
    console.error("⚠️ backup remoto (R2) FALHOU — só há cópia local:", e.message);
  }
}

// Cópia diária: agency-YYYY-MM-DD.db no disco persistente + no R2.
export async function dailyBackup() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const dest = join(BACKUP_DIR, `agency-${day}.db`);
  await makeBackup(dest);
  pruneOld();
  await copyToR2(dest, day);
  return dest;
}

// Liga a rotina: uma cópia ~1 min após subir e depois 1x por dia.
export function startBackups() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const run = () => dailyBackup().catch((e) => console.error("backup diário:", e.message));
  setTimeout(run, 60 * 1000);
  setInterval(run, 24 * 60 * 60 * 1000).unref?.();
}
