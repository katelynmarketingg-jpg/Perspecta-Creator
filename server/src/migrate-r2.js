// Migra os arquivos que estão no disco para o Cloudflare R2, sem perder nada.
// Rode DEPOIS de configurar as variáveis do R2. Uso: npm run migrate-r2
import { basename } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { db } from "./db.js";
import { storageConfigured, uploadFileToR2, isR2Path } from "./storage.js";

if (!storageConfigured()) {
  console.error("R2 não configurado. Defina R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e R2_BUCKET.");
  process.exit(1);
}

const files = db.prepare("SELECT id, stored_path, mime, org_id FROM files").all();
let migrados = 0, pulados = 0, faltando = 0;

for (const f of files) {
  if (isR2Path(f.stored_path)) { pulados++; continue; }
  if (!existsSync(f.stored_path)) { faltando++; continue; }
  const key = `uploads/${f.org_id}/${basename(f.stored_path)}`;
  try {
    const novo = await uploadFileToR2(f.stored_path, key, f.mime);
    db.prepare("UPDATE files SET stored_path = ? WHERE id = ?").run(novo, f.id);
    try { unlinkSync(f.stored_path); } catch {}
    migrados++;
    if (migrados % 20 === 0) console.log(`... ${migrados} enviados`);
  } catch (e) {
    console.error(`Falhou no arquivo ${f.id}:`, e.message);
  }
}

console.log(`\nConcluído: ${migrados} enviados ao R2, ${pulados} já estavam no R2, ${faltando} sumidos do disco.`);
process.exit(0);
