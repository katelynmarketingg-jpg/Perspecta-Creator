import { unlinkSync } from "node:fs";
import { db } from "./db.js";

// Quanto tempo o cliente tem para baixar o material entregue.
export const DIAS_PARA_BAIXAR = 30;

/** Todo arquivo de cliente nasce com prazo. Roda uma vez no boot. */
export function backfillExpiry() {
  db.prepare(
    `UPDATE files SET expires_at = datetime(created_at, '+${DIAS_PARA_BAIXAR} days')
     WHERE expires_at IS NULL AND client_id IS NOT NULL`
  ).run();
}

/** Avisa o cliente um dia antes de o material sair do ar. */
export function notifyExpiring() {
  const proximos = db.prepare(`
    SELECT f.id, f.original_name, f.client_id, f.org_id, f.expires_at
    FROM files f
    WHERE f.client_id IS NOT NULL
      AND f.keep_forever = 0
      AND f.expiry_notified_at IS NULL
      AND f.expires_at IS NOT NULL
      AND julianday(f.expires_at) - julianday('now') BETWEEN 0 AND 1
  `).all();
  if (!proximos.length) return { avisados: 0 };

  // Um aviso por cliente, listando quantos arquivos vencem.
  const porCliente = {};
  proximos.forEach((f) => { (porCliente[f.client_id] ||= []).push(f); });

  const ins = db.prepare(
    "INSERT INTO notifications (audience, client_id, message, org_id) VALUES (?, ?, ?, ?)"
  );
  const marca = db.prepare("UPDATE files SET expiry_notified_at = datetime('now') WHERE id = ?");

  const tx = db.transaction(() => {
    Object.entries(porCliente).forEach(([clientId, arquivos]) => {
      const org = arquivos[0].org_id;
      const n = arquivos.length;
      ins.run("client", clientId,
        `⬇️ ${n === 1 ? "1 arquivo sai" : `${n} arquivos saem`} do ar amanhã. ` +
        `Baixe pela aba Galeria enquanto dá tempo.`, org);
      ins.run("agency", clientId,
        `⬇️ ${n} arquivo(s) de material vencem amanhã e serão apagados.`, org);
      arquivos.forEach((f) => marca.run(f.id));
    });
  });
  tx();
  return { avisados: proximos.length };
}

/** Apaga o que passou do prazo — arquivo do disco e registro. */
export function purgeExpired() {
  const vencidos = db.prepare(`
    SELECT id, stored_path FROM files
    WHERE client_id IS NOT NULL AND keep_forever = 0
      AND expires_at IS NOT NULL AND julianday('now') > julianday(expires_at)
  `).all();
  if (!vencidos.length) return { apagados: 0 };

  const del = db.prepare("DELETE FROM files WHERE id = ?");
  vencidos.forEach((f) => {
    try { unlinkSync(f.stored_path); } catch { /* já não existe */ }
    del.run(f.id);
  });
  return { apagados: vencidos.length };
}

export function startRetention() {
  backfillExpiry();
  const passada = () => {
    try { notifyExpiring(); purgeExpired(); }
    catch (e) { console.error("retenção de arquivos:", e.message); }
  };
  setTimeout(passada, 45 * 1000);
  setInterval(passada, 6 * 60 * 60 * 1000).unref?.(); // 4x por dia
}
