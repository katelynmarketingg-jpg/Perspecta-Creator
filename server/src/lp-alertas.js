import { db } from "./db.js";
import { avisosDevidos, textoDoAviso, diasAte, situacaoDaRenovacao } from "./landing.js";

// ---------------------------------------------------------------------------
// OS AVISOS DA RENOVAÇÃO.
//
// Ninguém abre a tela de Landing Pages todo dia — e é justamente por isso que
// a renovação passa batida. Esta passada roda sozinha e cria o aviso na hora
// certa: 45 dias antes (chamar para conversar), 30 dias antes (cobrar), no
// vencimento sem pagar (atrasado) e 15 dias depois (acabou a tolerância).
//
// É seguro rodar quantas vezes quiser: cada renovação guarda os avisos que já
// saíram, então o mesmo aviso não aparece todo dia.
// ---------------------------------------------------------------------------

const leJson = (t) => { try { const v = JSON.parse(t || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };

export function rodaAvisosDeRenovacao(hoje = new Date()) {
  const linhas = db.prepare(`
    SELECT r.*, l.endereco, l.status AS lp_status, l.org_id AS org,
           l.client_id, c.name AS client_name
      FROM lp_renovacoes r
      JOIN landing_pages l ON l.id = r.lp_id
      LEFT JOIN clients c ON c.id = l.client_id
     WHERE r.status NOT IN ('pago', 'cancelado')
       AND l.status = 'ativa'
  `).all();

  if (!linhas.length) return { avisos: 0 };

  const insNotif = db.prepare(
    "INSERT INTO notifications (audience, client_id, task_id, message, org_id) VALUES ('agency', ?, NULL, ?, ?)"
  );
  const marca = db.prepare("UPDATE lp_renovacoes SET avisos = ? WHERE id = ?");

  let contados = 0;
  const tx = db.transaction(() => {
    for (const r of linhas) {
      const jaAvisados = leJson(r.avisos);
      const devidos = avisosDevidos(r, hoje, jaAvisados);
      if (!devidos.length) continue;

      const dias = diasAte(r.vence_em, hoje);
      for (const chave of devidos) {
        insNotif.run(r.client_id, textoDoAviso(chave, {
          cliente: r.client_name || "Cliente",
          endereco: r.endereco,
          vence_em: r.vence_em,
          valor: r.valor,
          dias,
        }), r.org);
        contados += 1;
      }
      marca.run(JSON.stringify([...jaAvisados, ...devidos]), r.id);
    }
  });
  tx();
  return { avisos: contados };
}

/**
 * O estado guardado acompanha o calendário.
 *
 * Sem isto, uma renovação vencida ontem continuaria escrita como "em dia" no
 * banco — e qualquer relatório que leia a coluna crua mentiria. A tela já
 * calcula na hora; isto é para os outros lugares que leem direto.
 */
export function sincronizaSituacoes(hoje = new Date()) {
  const abertas = db.prepare(
    "SELECT * FROM lp_renovacoes WHERE status NOT IN ('pago','cancelado')"
  ).all();
  const upd = db.prepare("UPDATE lp_renovacoes SET status = ? WHERE id = ?");
  let mexidos = 0;
  const tx = db.transaction(() => {
    for (const r of abertas) {
      const certo = situacaoDaRenovacao(r, hoje);
      // "atrasado" e "tolerancia_vencida" são situações calculadas; no banco a
      // coluna guarda só o que é decisão ('avisado'). Não sobrescreve.
      if (certo === "avisado" && r.status !== "avisado") { upd.run("avisado", r.id); mexidos += 1; }
    }
  });
  tx();
  return { mexidos };
}
