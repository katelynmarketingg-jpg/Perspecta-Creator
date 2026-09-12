// ---------------------------------------------------------------------------
// TRANCA DA PORTA — trava de tentativas de senha.
//
// Por que existe: medido no servidor de verdade, a porta aceitava 60 senhas
// erradas seguidas em 5 segundos, sem nenhuma trava — na entrada da agência e
// na do cliente. São ~11 palpites por segundo, quase um milhão por dia: senha
// de cliente (mínimo 6 caracteres) cai numa lista de senhas comuns numa tarde.
// E cada palpite ainda gasta uma conferência de senha no servidor do Render,
// então quem quiser só derrubar o sistema também conseguia por aqui.
//
// Como funciona: depois de algumas tentativas erradas, a porta espera — e a
// espera vai crescendo. Acertar a senha limpa a contagem na hora, então quem é
// de casa e errou uma vez não fica preso. A contagem é por IP + nome de quem
// está tentando: errar a senha de alguém não tranca esse alguém no mundo todo,
// só naquele computador (senão qualquer um poderia trancar a conta da Katy de
// propósito).
//
// Fica na memória de propósito: é um servidor só no Render, não vale a pena
// tabela no banco para isso. Reiniciar o servidor zera — e tudo bem, ninguém
// adivinha senha na janela de um reinício.
// ---------------------------------------------------------------------------

const LIVRES = 5;                 // erros perdoados antes de começar a esperar
const ESPERA_BASE = 5_000;        // 6º erro: 5s; depois 10s, 20s... até o teto
const ESPERA_MAX = 15 * 60_000;   // teto: 15 minutos
const ESQUECE = 30 * 60_000;      // sem errar por 30 min, a contagem some

const portas = new Map();   // chave -> { erros, ultimo }

function limpaVelhas(agora) {
  if (portas.size < 500) return;   // só varre quando o mapa cresce
  for (const [k, v] of portas) if (agora - v.ultimo > ESQUECE) portas.delete(k);
}

function esperaDe(erros) {
  if (erros <= LIVRES) return 0;
  return Math.min(ESPERA_MAX, ESPERA_BASE * 2 ** (erros - LIVRES - 1));
}

export function chaveDaPorta(req, quem) {
  return `${req?.ip || "?"}|${String(quem || "").trim().toLowerCase()}`;
}

/**
 * Quanto falta esperar nesta porta, em milissegundos. 0 = pode tentar.
 */
export function faltaEsperar(chave, agora = Date.now()) {
  const p = portas.get(chave);
  if (!p) return 0;
  if (agora - p.ultimo > ESQUECE) { portas.delete(chave); return 0; }
  return Math.max(0, esperaDe(p.erros) - (agora - p.ultimo));
}

export function registraErro(chave, agora = Date.now()) {
  limpaVelhas(agora);
  const p = portas.get(chave) || { erros: 0, ultimo: agora };
  if (agora - p.ultimo > ESQUECE) p.erros = 0;
  p.erros += 1;
  p.ultimo = agora;
  portas.set(chave, p);
  return p.erros;
}

export function registraAcerto(chave) {
  portas.delete(chave);
}

/**
 * Resposta pronta de "espera aí". Devolve true se já respondeu (a rota deve
 * parar ali), false se pode seguir.
 */
export function trancada(req, res, chave) {
  const falta = faltaEsperar(chave);
  if (!falta) return false;
  const seg = Math.ceil(falta / 1000);
  const texto = seg >= 60 ? `${Math.ceil(seg / 60)} minuto(s)` : `${seg} segundo(s)`;
  res.set("Retry-After", String(seg));
  res.status(429).json({
    error: `Muitas tentativas. Espere ${texto} e tente de novo.`,
    espere_segundos: seg,
  });
  return true;
}

// Só para os testes: recomeça do zero.
export function _zera() { portas.clear(); }
