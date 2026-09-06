// ---------------------------------------------------------------------------
// A "inteligência" de cada cliente — UM lugar só.
//
// Estes campos ficam salvos por cliente e valem em TODA geração: legenda na
// Distribuição, planejamento do mês, ideias de post. Antes cada tela tinha a
// sua listinha de campos (5 aqui, 18 ali) e dava a impressão de que eram
// coisas diferentes — é o mesmo cadastro, e agora a lista mora aqui.
//
// `usadoEm` diz em quais gerações o campo entra. Não é enfeite: o servidor
// escolhe, por tarefa, só os campos que mudam aquela resposta — por isso
// preencher tudo NÃO deixa a geração mais cara. (server/src/ai.js)
// ---------------------------------------------------------------------------
export const PERSONA_GRUPOS = [
  {
    titulo: "O essencial",
    ajuda: "Se você só puder preencher uma parte, preencha esta.",
    campos: [
      { key: "tone", label: "Tom de voz", ph: "Ex.: próximo, bem-humorado, sem gírias", usadoEm: "legendas e planejamento" },
      { key: "audience", label: "Público", ph: "Ex.: mulheres 25-45, classe B, região sul", usadoEm: "tudo" },
      { key: "pillars", label: "Pilares de conteúdo", ph: "Ex.: bastidores, dicas, prova social, promoções", usadoEm: "ideias e planejamento" },
      { key: "avoid", label: "O que evitar", ph: "Ex.: falar de preço, tom formal", usadoEm: "tudo" },
    ],
  },
  {
    titulo: "A marca",
    ajuda: "Entra nas ideias, no planejamento e na estratégia.",
    campos: [
      { key: "segment", label: "Segmento", ph: "Ex.: advocacia, pastelaria, estética", usadoEm: "ideias e planejamento" },
      { key: "services", label: "Serviços / o que vende", ph: "Ex.: direito penal empresarial, consultoria preventiva", usadoEm: "ideias e planejamento" },
      { key: "positioning", label: "Posicionamento", ph: "Ex.: técnico, sofisticado e preventivo", usadoEm: "estratégia" },
      { key: "personality", label: "Personalidade da marca", ph: "Ex.: firme, acolhedora, direta", usadoEm: "estratégia" },
      { key: "differentials", label: "Diferenciais", ph: "Ex.: 20 anos de casa, atendimento em 24h", usadoEm: "ideias e estratégia" },
      { key: "location", label: "Onde atua", ph: "Ex.: Porto Alegre e região metropolitana", usadoEm: "tudo" },
    ],
  },
  {
    titulo: "Como falar",
    ajuda: "É o que dá o jeito da marca em cada legenda.",
    campos: [
      { key: "expressions", label: "Expressões da marca", ph: "Palavras e bordões que a marca usa", usadoEm: "legendas" },
      { key: "avoid_words", label: "Palavras proibidas", ph: "Ex.: barato, promoção, imperdível", usadoEm: "legendas" },
      { key: "cta", label: "CTA preferido", ph: "Ex.: chame no direct, link na bio", usadoEm: "legendas" },
      { key: "rules", label: "Regras de comunicação", ph: "Ex.: nunca prometer resultado, sempre citar o bairro", usadoEm: "legendas" },
      { key: "restrictions", label: "Restrições", ph: "Ex.: não falar de concorrente, nada de política", usadoEm: "legendas e estratégia" },
      { key: "goals", label: "Objetivo", ph: "Ex.: autoridade + geração de oportunidades", usadoEm: "ideias e planejamento" },
    ],
  },
  {
    titulo: "Referências e prompt livre",
    ajuda: "Onde escrever instruções com suas palavras.",
    campos: [
      { key: "examples", label: "Exemplo de conteúdo aprovado", ph: "Cole uma legenda que ficou do jeito certo", usadoEm: "legendas", multi: true },
      { key: "extra", label: "Prompt livre / observações", ph: "Escreva com suas palavras o que a IA precisa saber deste cliente.", usadoEm: "legendas e planejamento", multi: true },
    ],
  },
];

export const PERSONA_CHAVES = PERSONA_GRUPOS.flatMap((g) => g.campos.map((c) => c.key));

/** Quantos campos da inteligência já estão preenchidos (para mostrar progresso). */
export function preenchidos(persona) {
  return PERSONA_CHAVES.filter((k) => String(persona?.[k] || "").trim()).length;
}
