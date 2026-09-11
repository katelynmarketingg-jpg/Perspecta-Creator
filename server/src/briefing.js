// ---------------------------------------------------------------------------
// O BRIEFING — o formulário que o cliente responde por um link.
//
// É a porta de entrada da inteligência: as respostas caem direto nos campos que
// a IA usa para escrever legendas, ideias e planejamento. Por isso cada
// pergunta declara em `campo` para onde vai; o que não tem `campo` é contexto
// para a equipe ler, não para a IA.
//
// As perguntas vivem SÓ aqui: a tela da equipe e a página pública do cliente
// leem esta mesma lista, então mudar uma pergunta muda os dois lados.
// ---------------------------------------------------------------------------

// O texto de boas-vindas de fábrica. Editável por escritório.
export const BEM_VINDO = {
  titulo: "Seja bem-vindo à {agencia}.",
  paragrafos: [
    "Se você recebeu este link, é porque deu um passo importante: decidiu que a comunicação de {cliente} merece ser feita com intenção, e não no improviso.",
    "O que vem a seguir é uma conversa. Queremos entender o seu negócio de verdade — o que você vende, para quem, o que te diferencia e, principalmente, como você fala. É isso que faz um conteúdo parecer seu, e não de qualquer empresa do seu ramo.",
    "Não existe resposta errada aqui. Escreva do seu jeito, como se estivesse explicando para um amigo. Quanto mais você contar, menos a gente vai precisar adivinhar.",
  ],
  botao: "Vamos começar",
};

export const BRIEFING = [
  {
    id: "empresa",
    titulo: "A empresa",
    intro: "Vamos começar pelo básico — quem é vocês.",
    perguntas: [
      { id: "nome", tipo: "texto", label: "Nome do negócio, do jeito que deve aparecer",
        obrigatoria: true, campo_cliente: "company" },
      { id: "resumo", tipo: "longo", label: "Em uma frase, o que vocês fazem?", ajuda: "Como você explicaria para alguém que nunca ouviu falar.", obrigatoria: true, campo: "services" },
      { id: "segmento", tipo: "texto", label: "Qual é o segmento?", ajuda: "Ex.: advocacia, pastelaria, estética, arquitetura", campo: "segment" },
      { id: "tempo", tipo: "texto", label: "Há quanto tempo estão no mercado?" },
      { id: "local", tipo: "texto", label: "Onde vocês atuam?", ajuda: "Bairro, cidade, região — ou 'todo o Brasil, online'", campo: "location" },
      { id: "links", tipo: "longo", label: "Site e redes sociais", ajuda: "Cole os links que tiver." },
    ],
  },
  {
    id: "oferta",
    titulo: "O que vocês vendem",
    intro: "Para a gente saber o que precisa aparecer.",
    perguntas: [
      { id: "servicos", tipo: "longo", label: "Liste os principais produtos ou serviços", obrigatoria: true, campo: "services" },
      { id: "carro_chefe", tipo: "texto", label: "Qual é o carro-chefe?", ajuda: "O que mais vende hoje." },
      { id: "quer_vender", tipo: "longo", label: "O que vocês gostariam de vender MAIS?", ajuda: "Nem sempre é o que mais vende hoje — isso muda o conteúdo.", campo: "goals" },
      { id: "preco", tipo: "escolhas", label: "Faixa de preço", opcoes: ["Popular", "Intermediário", "Premium", "Sob consulta"] },
    ],
  },
  {
    id: "publico",
    titulo: "Quem compra",
    intro: "Escrever para todo mundo é escrever para ninguém.",
    perguntas: [
      { id: "cliente_ideal", tipo: "longo", label: "Descreva o cliente ideal de vocês", ajuda: "Idade, onde mora, o que faz da vida, como é o dia dele.", obrigatoria: true, campo: "audience" },
      { id: "dor", tipo: "longo", label: "Que problema vocês resolvem para ele?" },
      { id: "objecao", tipo: "longo", label: "O que costuma travar a compra?", ajuda: "Ex.: acha caro, não conhece, tem medo de errar, precisa consultar alguém." },
      { id: "valoriza", tipo: "longo", label: "O que esse cliente mais valoriza?", ajuda: "Ex.: rapidez, preço, atendimento, discrição, segurança." },
    ],
  },
  {
    id: "diferencial",
    titulo: "Concorrência e diferencial",
    intro: "O que faz alguém escolher vocês e não o vizinho.",
    perguntas: [
      { id: "concorrentes", tipo: "longo", label: "Quem são os concorrentes?", ajuda: "Nome ou @ no Instagram, se souber." },
      { id: "diferenciais", tipo: "longo", label: "Por que escolhem vocês?", obrigatoria: true, campo: "differentials" },
      { id: "posicionamento", tipo: "longo", label: "Como vocês querem ser vistos?", ajuda: "Ex.: o mais técnico, o mais acolhedor, o mais rápido, o mais sofisticado.", campo: "positioning" },
    ],
  },
  {
    id: "voz",
    titulo: "O jeito de falar",
    intro: "É o que faz o conteúdo parecer de vocês, e não de qualquer um.",
    perguntas: [
      { id: "tom", tipo: "escolhas", multipla: true, label: "Como a marca deve soar?",
        opcoes: ["Próxima e informal", "Profissional", "Divertida", "Técnica", "Acolhedora", "Direta", "Sofisticada", "Inspiradora"], campo: "tone" },
      { id: "personalidade", tipo: "texto", label: "Se a marca fosse uma pessoa, como ela seria?", campo: "personality" },
      { id: "expressoes", tipo: "longo", label: "Palavras e expressões que vocês usam sempre", ajuda: "Bordões, jeitos de falar, como chamam os clientes.", campo: "expressions" },
      { id: "proibidas", tipo: "longo", label: "Palavras que vocês NÃO querem ver", ajuda: "Ex.: barato, promoção, imperdível.", campo: "avoid_words" },
      { id: "emoji", tipo: "escolhas", label: "Emojis?", opcoes: ["Pode usar à vontade", "Poucos e discretos", "Não usar"] },
      { id: "referencias", tipo: "longo", label: "Perfis que vocês admiram", ajuda: "Do seu ramo ou não — vale como referência de estilo." },
    ],
  },
  {
    id: "conteudo",
    titulo: "O conteúdo",
    intro: "O que você quer ver no perfil todo mês.",
    perguntas: [
      { id: "pilares", tipo: "longo", label: "Que assuntos não podem faltar?", ajuda: "Ex.: bastidores, dicas, depoimentos de clientes, novidades.", campo: "pillars" },
      { id: "evitar", tipo: "longo", label: "Que assuntos vocês preferem evitar?", campo: "avoid" },
      { id: "objetivo", tipo: "escolhas", multipla: true, label: "O que vocês esperam das redes?",
        opcoes: ["Ser reconhecido como autoridade", "Vender mais", "Ganhar seguidores", "Ser lembrado na hora certa", "Atrair currículos/parcerias"], campo: "goals" },
      { id: "cta", tipo: "texto", label: "O que a pessoa deve fazer ao ver um post?", ajuda: "Ex.: chamar no direct, clicar no link da bio, ir até a loja.", campo: "cta" },
    ],
  },
  {
    id: "regras",
    titulo: "Regras e limites",
    intro: "O que a gente precisa saber para nunca errar.",
    perguntas: [
      { id: "nunca", tipo: "longo", label: "O que NUNCA pode aparecer?", ajuda: "Assunto, imagem, promessa, nome de concorrente…", campo: "restrictions" },
      { id: "regras", tipo: "longo", label: "Alguma regra da profissão ou do setor?", ajuda: "Ex.: advocacia não pode prometer resultado; saúde tem regras do conselho.", campo: "rules" },
      { id: "aprovacao", tipo: "escolhas", label: "Quem aprova o conteúdo?", opcoes: ["Eu mesmo(a)", "Um sócio", "Um setor/jurídico", "Pode publicar sem aprovar"] },
    ],
  },
  {
    id: "contrato",
    titulo: "Dados para o contrato",
    intro: "A parte burocrática, de uma vez só — assim o contrato já sai pronto e a cobrança nasce certa.",
    perguntas: [
      { id: "cnpj", tipo: "cnpj", label: "CNPJ da empresa",
        ajuda: "Digite e o sistema busca o resto sozinho, na Receita Federal.", campo_cliente: "document" },
      { id: "razao_social", tipo: "texto", label: "Razão social", campo_cliente: "legal_name" },
      { id: "endereco", tipo: "longo", label: "Endereço completo", campo_cliente: "address" },
      { id: "rep_nome", tipo: "texto", label: "Quem assina pela empresa", campo_cliente: "rep_name" },
      { id: "rep_tipo_doc", tipo: "escolhas", label: "Documento de quem assina",
        opcoes: ["CPF", "OAB"], campo_cliente: "rep_doc_type" },
      { id: "rep_documento", tipo: "texto", label: "Número do documento", campo_cliente: "rep_document" },
      { id: "email_nota", tipo: "texto", label: "E-mail para nota fiscal e cobrança", campo_cliente: "email" },
      { id: "dia_pagamento", tipo: "dia", label: "Melhor dia do mês para o pagamento",
        ajuda: "É a data que vai valer no contrato e nas cobranças.", campo_cliente: "payment_day",
        dia_min: 1, dia_max: 28 },
      { id: "forma_pagamento", tipo: "escolhas", label: "Como prefere pagar",
        opcoes: ["Pix", "Boleto", "Cartão de crédito", "Transferência"] },
    ],
  },
  {
    id: "material",
    titulo: "Seu material",
    intro: "Aqui você já pode nos passar o que tiver — quanto mais, melhor sai o conteúdo.",
    perguntas: [
      { id: "envios", tipo: "arquivos",
        label: "Mande fotos, vídeos e referências",
        ajuda: "Vale foto do espaço, da equipe, dos serviços, bastidores — e também referências: "
             + "prints de posts que você gosta, mesmo de outros ramos. Tudo o que você mandar aqui "
             + "vai direto para a sua galeria com a gente." },
      { id: "links_referencia", tipo: "longo", label: "Links de referência",
        ajuda: "Pinterest, perfis do Instagram, sites — cole os links que te inspiram." },
    ],
  },
  {
    id: "final",
    titulo: "Para fechar",
    intro: "Quase lá.",
    perguntas: [
      { id: "materiais", tipo: "longo", label: "Quem manda fotos e vídeos, e com que frequência?" },
      { id: "marca", tipo: "escolhas", label: "Vocês têm logo e manual de marca?", opcoes: ["Sim, os dois", "Só a logo", "Não temos"] },
      { id: "extra", tipo: "longo", label: "Mais alguma coisa que a gente precisa saber?", ajuda: "Escreva com suas palavras. Nada é bobagem aqui.", campo: "extra" },
    ],
  },
];

/** Todas as perguntas de um conjunto de seções, em lista. */
export function perguntasDe(secoes = BRIEFING) {
  return (secoes || []).flatMap((s) => (s.perguntas || []).map((p) => ({ ...p, secao: s.id })));
}

/** As perguntas do briefing PADRÃO (o de fábrica). */
export const PERGUNTAS = perguntasDe(BRIEFING);

/** Quantas perguntas obrigatórias ainda estão em branco. */
export function faltando(secoes, respostas = {}) {
  return perguntasDe(secoes).filter((p) => p.obrigatoria && !String(respostas[p.id] ?? "").trim()).map((p) => p.id);
}

/** Progresso 0-100 (todas as perguntas, não só as obrigatórias). */
export function progresso(secoes, respostas = {}) {
  const todas = perguntasDe(secoes);
  if (!todas.length) return 0;
  const feitas = todas.filter((p) => String(respostas[p.id] ?? "").trim()).length;
  return Math.round((feitas / todas.length) * 100);
}

/**
 * Traduz as respostas do briefing para os campos que a IA usa.
 * Quando duas perguntas caem no mesmo campo (ex.: "o que fazem" e "serviços"),
 * as respostas são juntadas em vez de uma apagar a outra.
 */
export function respostasParaPersona(secoes, respostas = {}) {
  const persona = {};
  for (const p of perguntasDe(secoes)) {
    if (!p.campo) continue;
    const v = String(respostas[p.id] ?? "").trim();
    if (!v) continue;
    persona[p.campo] = persona[p.campo] ? `${persona[p.campo]}. ${v}` : v;
  }
  return persona;
}

// ---------------------------------------------------------------------------
// Os dados do CADASTRO que o briefing preenche (razão social, CNPJ, endereço,
// quem assina, dia do pagamento). São eles que fazem o contrato sair pronto,
// então só estas colunas podem ser gravadas — nada de o briefing escrever em
// qualquer campo do cliente.
// ---------------------------------------------------------------------------
export const CAMPOS_CLIENTE = {
  // O nome pelo qual você chama o cliente no sistema. Trocar isso muda o rótulo
  // dele em todas as telas, então nunca aceita vazio.
  name: { rotulo: "Nome do cliente", exigeValor: true },
  company: { rotulo: "Nome fantasia / empresa" },
  document: { rotulo: "CNPJ/CPF" },
  legal_name: { rotulo: "Razão social" },
  address: { rotulo: "Endereço" },
  rep_name: { rotulo: "Quem assina" },
  rep_document: { rotulo: "Documento de quem assina" },
  // A coluna nasce com 'cpf' por padrão. Sem esta marca, o valor de fábrica
  // passaria por "já preenchido" e uma resposta OAB seria ignorada — o contrato
  // sairia dizendo CPF no lugar de OAB.
  rep_doc_type: {
    rotulo: "Tipo do documento",
    trata: (v) => (/oab/i.test(v) ? "oab" : "cpf"),
    contaComoVazio: (atual) => !atual || atual === "cpf",
  },
  email: { rotulo: "E-mail" },
  phone: { rotulo: "Telefone" },
  payment_day: { rotulo: "Dia do pagamento", trata: (v) => {
    const n = Number(String(v).replace(/\D/g, ""));
    return Number.isFinite(n) && n >= 1 && n <= 31 ? n : null;
  } },
  segment: { rotulo: "Segmento" },
};

// ---------------------------------------------------------------------------
// Respostas que vão para a CENTRAL (o quadro de informações do cliente).
// Senha de rede social não pode ficar solta no texto do briefing: vai para lá
// como credencial, onde é guardada criptografada.
// ---------------------------------------------------------------------------
export const DESTINOS_CENTRAL = {
  credential: { rotulo: "Central — acesso/senha (guardado criptografado)", kind: "credential" },
  note: { rotulo: "Central — anotação", kind: "note" },
};

/** O que vai para a Central: [{ kind, title, valor }]. */
export function respostasParaCentral(secoes, respostas = {}) {
  const itens = [];
  for (const p of perguntasDe(secoes)) {
    const destino = DESTINOS_CENTRAL[p.destino_central];
    if (!destino) continue;
    const v = String(respostas[p.id] ?? "").trim();
    if (!v) continue;
    itens.push({ pergunta: p.id, kind: destino.kind, title: p.label, valor: v });
  }
  return itens;
}

/** As respostas viradas para os campos do CADASTRO do cliente. */
export function respostasParaCliente(secoes, respostas = {}) {
  const saida = {};
  for (const p of perguntasDe(secoes)) {
    const col = p.campo_cliente;
    if (!col || !CAMPOS_CLIENTE[col]) continue;
    const bruto = String(respostas[p.id] ?? "").trim();
    if (!bruto) continue;
    const regra = CAMPOS_CLIENTE[col];
    let v = regra.trata ? regra.trata(bruto) : bruto;
    // Campo que identifica o cliente não pode virar vazio.
    if (regra.exigeValor && !String(v).trim()) continue;
    // Dia de pagamento fora da faixa oferecida não vira cobrança (só chegaria
    // aqui por resposta adulterada, mas cobrança errada é caro).
    if (p.tipo === "dia" && v !== null) {
      const min = p.dia_min || 1, max = p.dia_max || 31;
      if (v < min || v > max) v = null;
    }
    if (v !== null && v !== "") saida[col] = v;
  }
  return saida;
}

// ---------------------------------------------------------------------------
// O modelo do escritório: o de fábrica até alguém editar.
// ---------------------------------------------------------------------------
import { db } from "./db.js";

function leJson(txt, padrao) {
  try { const v = JSON.parse(txt); return v ?? padrao; } catch { return padrao; }
}

export function getTemplate(orgId) {
  const linha = db.prepare("SELECT welcome, sections, updated_at FROM briefing_templates WHERE org_id = ?").get(orgId);
  const secoes = linha ? leJson(linha.sections, BRIEFING) : BRIEFING;
  return {
    welcome: linha ? leJson(linha.welcome, BEM_VINDO) : BEM_VINDO,
    secoes: Array.isArray(secoes) && secoes.length ? secoes : BRIEFING,
    personalizado: Boolean(linha),
    updated_at: linha?.updated_at || null,
  };
}

/** Deixa as seções em forma segura: sem pergunta sem id, sem id repetido. */
export function saneiaSecoes(entrada) {
  const vistos = new Set();
  const limpaId = (v, reserva) => {
    const base = String(v || reserva).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || reserva;
    let id = base, n = 2;
    while (vistos.has(id)) id = `${base}_${n++}`;   // id repetido apagaria a outra resposta
    vistos.add(id);
    return id;
  };
  return (Array.isArray(entrada) ? entrada : []).map((s, i) => ({
    id: limpaId(s.id, `secao_${i + 1}`),
    titulo: String(s.titulo || `Etapa ${i + 1}`).slice(0, 120),
    intro: String(s.intro || "").slice(0, 400),
    perguntas: (Array.isArray(s.perguntas) ? s.perguntas : []).map((p, j) => {
      const tipo = ["texto", "longo", "escolhas", "cnpj", "dia", "arquivos"].includes(p.tipo) ? p.tipo : "texto";
      const q = {
        id: limpaId(p.id, `p_${i + 1}_${j + 1}`),
        tipo,
        label: String(p.label || "Pergunta").slice(0, 200),
        ajuda: String(p.ajuda || "").slice(0, 300),
        obrigatoria: Boolean(p.obrigatoria),
      };
      if (tipo === "dia") {
        // A faixa de dias que o escritório oferece (ex.: do 10 ao 15). Fora de
        // 1–31 não existe; invertida, desinverte. O padrão vai até 28 porque é
        // o único dia que TODO mês tem — acima disso fevereiro fica de fora.
        const limite = (v, reserva) => {
          const n = Math.round(Number(v));
          return Number.isFinite(n) && n >= 1 && n <= 31 ? n : reserva;
        };
        let min = limite(p.dia_min, 1);
        let max = limite(p.dia_max, 28);
        if (min > max) [min, max] = [max, min];
        q.dia_min = min;
        q.dia_max = max;
      }
      if (tipo === "escolhas") {
        q.opcoes = (Array.isArray(p.opcoes) ? p.opcoes : []).map((o) => String(o).slice(0, 80)).filter(Boolean).slice(0, 12);
        if (p.multipla) q.multipla = true;
      }
      if (p.campo) q.campo = String(p.campo);
      if (p.campo_cliente && CAMPOS_CLIENTE[p.campo_cliente]) q.campo_cliente = p.campo_cliente;
      if (DESTINOS_CENTRAL[p.destino_central]) q.destino_central = p.destino_central;
      return q;
    }).filter((p) => p.label),
  })).filter((s) => s.perguntas.length);
}

export function saveTemplate(orgId, { welcome, secoes }) {
  const limpo = saneiaSecoes(secoes);
  if (!limpo.length) { const e = new Error("O briefing precisa de pelo menos uma pergunta."); e.code = "VAZIO"; throw e; }
  const bv = {
    titulo: String(welcome?.titulo || BEM_VINDO.titulo).slice(0, 200),
    paragrafos: (Array.isArray(welcome?.paragrafos) ? welcome.paragrafos : BEM_VINDO.paragrafos)
      .map((t) => String(t).slice(0, 1200)).filter(Boolean).slice(0, 6),
    botao: String(welcome?.botao || BEM_VINDO.botao).slice(0, 60),
  };
  db.prepare(
    `INSERT INTO briefing_templates (org_id, welcome, sections, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(org_id) DO UPDATE SET
       welcome = excluded.welcome, sections = excluded.sections, updated_at = datetime('now')`
  ).run(orgId, JSON.stringify(bv), JSON.stringify(limpo));
  return getTemplate(orgId);
}

/** Volta ao modelo de fábrica. */
export function resetTemplate(orgId) {
  db.prepare("DELETE FROM briefing_templates WHERE org_id = ?").run(orgId);
  return getTemplate(orgId);
}
