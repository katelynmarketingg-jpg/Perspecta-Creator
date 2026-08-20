// ---------------------------------------------------------------------------
// Rotação da chave de criptografia dos segredos guardados no banco.
//
// Decifra TODOS os campos cifrados com a chave ANTIGA e recifra com a NOVA,
// numa transação, fazendo um backup do banco antes. Depois de rodar, atualize
// ENCRYPTION_KEY no Render para a chave NOVA e reinicie.
//
// Uso:
//   OLD_KEY="<antiga>" NEW_KEY="<nova>" npm run reencrypt
//   (ou)  node src/reencrypt.js "<antiga>" "<nova>"
//
// A chave ANTIGA é o valor com que os dados foram cifrados — hoje é o
// JWT_SECRET atual (pois ENCRYPTION_KEY ainda não foi definida).
// ---------------------------------------------------------------------------
import { db } from "./db.js";
import { encryptWith, decryptWith } from "./crypto.js";
import { dailyBackup } from "./backup.js";

const OLD = process.env.OLD_KEY || process.argv[2];
const NEW = process.env.NEW_KEY || process.argv[3];

if (!OLD || !NEW) {
  console.error('Uso: OLD_KEY="<antiga>" NEW_KEY="<nova>" npm run reencrypt');
  console.error('  ou: node src/reencrypt.js "<antiga>" "<nova>"');
  process.exit(1);
}
if (OLD === NEW) {
  console.error("A chave antiga e a nova são iguais — nada a fazer.");
  process.exit(1);
}

// Todos os campos cifrados do sistema.
const FIELDS = [
  { table: "org_ai", column: "api_key", id: "org_id" },
  { table: "org_billing", column: "api_key", id: "org_id" },
  { table: "integrations", column: "access_token", id: "id" },
  { table: "workspace_items", column: "secret", id: "id" },
];

console.log("Fazendo backup do banco antes de mexer...");
try {
  const p = await dailyBackup();
  console.log("Backup salvo em:", p);
} catch (e) {
  console.error("Não consegui fazer backup — abortando por segurança:", e.message);
  process.exit(1);
}

let total = 0, migrados = 0, pulados = 0;
const tx = db.transaction(() => {
  for (const f of FIELDS) {
    let rows;
    try {
      rows = db.prepare(`SELECT ${f.id} AS id, ${f.column} AS val FROM ${f.table} WHERE ${f.column} IS NOT NULL`).all();
    } catch {
      continue; // tabela pode não existir neste banco
    }
    const upd = db.prepare(`UPDATE ${f.table} SET ${f.column} = ? WHERE ${f.id} = ?`);
    for (const r of rows) {
      total++;
      const plain = decryptWith(OLD, r.val);
      if (plain == null) { pulados++; continue; } // não decifrou com a chave antiga
      upd.run(encryptWith(NEW, plain), r.id);
      migrados++;
    }
  }
});
tx();

console.log(`\nConcluído: ${migrados} recifrado(s), ${pulados} pulado(s) (não decifraram com a chave antiga), ${total} no total.`);
console.log("Agora atualize ENCRYPTION_KEY no Render para a chave NOVA e reinicie o serviço.");
process.exit(0);
