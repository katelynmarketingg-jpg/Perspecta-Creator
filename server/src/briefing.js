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

export const BRIEFING = [
  {
    id: "empresa",
    titulo: "A empresa",
    intro: "Vamos começar pelo básico — quem é vocês.",
    perguntas: [
      { id: "nome", tipo: "texto", label: "Nome do negócio, do jeito que deve aparecer", obrigatoria: true },
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

/** Todas as perguntas em lista, para validar e mapear sem repetir laço. */
export const PERGUNTAS = BRIEFING.flatMap((s) => s.perguntas.map((p) => ({ ...p, secao: s.id })));

/** Quantas perguntas obrigatórias ainda estão em branco. */
export function faltando(respostas = {}) {
  return PERGUNTAS.filter((p) => p.obrigatoria && !String(respostas[p.id] ?? "").trim()).map((p) => p.id);
}

/** Progresso 0-100 (todas as perguntas, não só as obrigatórias). */
export function progresso(respostas = {}) {
  const feitas = PERGUNTAS.filter((p) => String(respostas[p.id] ?? "").trim()).length;
  return Math.round((feitas / PERGUNTAS.length) * 100);
}

/**
 * Traduz as respostas do briefing para os campos que a IA usa.
 * Quando duas perguntas caem no mesmo campo (ex.: "o que fazem" e "serviços"),
 * as respostas são juntadas em vez de uma apagar a outra.
 */
export function respostasParaPersona(respostas = {}) {
  const persona = {};
  for (const p of PERGUNTAS) {
    if (!p.campo) continue;
    const v = String(respostas[p.id] ?? "").trim();
    if (!v) continue;
    persona[p.campo] = persona[p.campo] ? `${persona[p.campo]}. ${v}` : v;
  }
  return persona;
}
