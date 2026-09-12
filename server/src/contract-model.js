// ---------------------------------------------------------------------------
// O contrato da casa, com os marcadores que o sistema preenche sozinho.
//
// É o contrato de gestão de redes sociais da Perspectiva, com os dados das duas
// partes trocados por marcadores (vêm do cadastro do cliente, que o briefing
// preenche, e de Configurações → Recibos, que guarda os dados da agência).
//
// As quantidades (captações, vídeos e posts por mês) e as datas de vigência
// também são marcadores: quem define é a agência, ao abrir o onboarding do
// cliente — o mesmo modelo serve para pacotes diferentes.
//
// Foram acrescentadas as cláusulas de proteção: resultado não garantido,
// aprovação tácita, material do cliente, plataformas de terceiros, limite de
// responsabilidade, acessos e senhas, confidencialidade/LGPD e não-vínculo.
//
// NÃO é parecer jurídico. Antes de usar, peça para o seu advogado ler — em
// especial o limite de responsabilidade e os juros de mora.
// ---------------------------------------------------------------------------

export const MODELO_REDES = {
  name: "Prestação de serviços — Marketing e gestão de redes sociais",
  body: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS
MARKETING E GESTÃO DE REDES SOCIAIS

CONTRATANTE: {{razao_social}}, inscrita no {{documento_rotulo}} sob o n.º {{cnpj}}, com sede em {{endereco}}, neste ato representada por {{representante}}, brasileiro(a), inscrito(a) {{documento_representante_rotulo}} sob o n.º {{documento_representante}}.

CONTRATADA: {{agencia}}, inscrita no CNPJ sob o n.º {{cnpj_agencia}}, com sede em {{endereco_agencia}}, neste ato representada por sua titular, {{representante_agencia}}, brasileira, portadora do CPF n.º {{documento_representante_agencia}}.

As partes acima qualificadas firmam o presente contrato de prestação de serviços, que será regido pelas cláusulas abaixo:

CLÁUSULA PRIMEIRA – DO OBJETO
O presente contrato tem por objeto a prestação de serviços de planejamento estratégico, branding, produção de conteúdo e gestão da rede social Instagram, compreendendo as seguintes etapas:

I – Estudo Estratégico: realização de briefing por meio de formulário para levantamento das informações da empresa, serviços, público-alvo, diferenciais, objetivos, tom de voz e posicionamento da marca, bem como desenvolvimento interno de estratégia personalizada, branding, definição de identidade visual base de acordo com a atual, paleta de cores, análise estratégica do perfil do CONTRATANTE e de seus principais concorrentes. Todo o estudo estratégico constitui metodologia própria da CONTRATADA, sendo realizado exclusivamente para embasar os serviços contratados, não havendo obrigação de entrega dos documentos internos elaborados.

II – Captação de Conteúdo: {{captacoes_verbo}} {{captacoes_frase}} ao mês, em data previamente ajustada entre as partes. O planejamento da gravação será encaminhado ao CONTRATANTE com antecedência mínima de 02 (dois) dias úteis, podendo este solicitar alterações, exclusões ou inclusão de novos temas até 01 (um) dia útil antes da data agendada.

III – Criação dos Conteúdos: produção mensal de {{videos_frase}}, bem como {{posts_frase}}, elaborados de acordo com o planejamento definido, juntamente com as respectivas legendas.

IV – Aprovação: após a edição dos conteúdos, esses serão disponibilizados em plataforma online para análise do CONTRATANTE, que poderá solicitar até 02 (duas) rodadas de alterações nas artes, vídeos e legendas, bem como realizar ajustes diretamente nas legendas, caso entenda necessário, devendo aprovar os conteúdos no prazo de 07 (sete) dias úteis, contado da disponibilização na plataforma. Alterações que impliquem nova gravação poderão ser consideradas serviço adicional.

V – Gestão: compreende a organização estratégica do feed, agendamento e publicação dos conteúdos no Feed e Reels do perfil do Instagram da empresa.

§1º. Não estão compreendidos no objeto deste contrato, salvo ajuste escrito em separado: verba de mídia paga e sua gestão, produção audiovisual por terceiros, compra de banco de imagens, criação de site, assessoria de imprensa, atendimento a comentários e mensagens diretas, e captações adicionais além da prevista no inciso II.

§2º. A captação não realizada por indisponibilidade do CONTRATANTE, ou desmarcada com menos de 24 (vinte e quatro) horas de antecedência, será considerada cumprida para os fins deste contrato, não gerando direito a remarcação sem custo nem abatimento na mensalidade.

CLÁUSULA SEGUNDA – DAS OBRIGAÇÕES DO CONTRATANTE
Compete ao CONTRATANTE fornecer informações, preencher o briefing, comparecer às captações, responder às solicitações da CONTRATADA e aprovar os conteúdos dentro dos prazos estabelecidos, sendo responsável pelos atrasos decorrentes da ausência de retorno.

Parágrafo único. O CONTRATANTE indicará uma única pessoa responsável pela interlocução e pelas aprovações, e manterá atualizados seus dados cadastrais, de contato e de pagamento.

CLÁUSULA TERCEIRA – DAS OBRIGAÇÕES DA CONTRATADA E DA AUSÊNCIA DE GARANTIA DE RESULTADO
A CONTRATADA compromete-se a executar os serviços com zelo, técnica e boa-fé, observando o planejamento estratégico elaborado.

§1º. A obrigação assumida pela CONTRATADA é de MEIO, e não de resultado. A CONTRATADA NÃO GARANTE resultados específicos de qualquer natureza, incluindo, sem limitação: crescimento do perfil, alcance, impressões, engajamento, visualizações, salvamentos, compartilhamentos, número de seguidores, mensagens, cliques, leads, agendamentos, contratações, vendas ou faturamento.

§2º. As partes reconhecem que os resultados em redes sociais são variáveis e dependem de fatores alheios ao controle da CONTRATADA, tais como: alterações nos algoritmos e nas políticas das plataformas, comportamento e sazonalidade do público, concorrência, conjuntura econômica, reputação, preço, qualidade e disponibilidade dos serviços do CONTRATANTE, bem como seu atendimento, sua operação e sua própria atuação nas redes.

§3º. Eventuais projeções, estimativas, metas, referências a casos anteriores ou resultados obtidos por outros clientes, mencionados em propostas, reuniões, mensagens ou materiais de apresentação, têm caráter meramente ilustrativo e NÃO constituem promessa, garantia ou obrigação de resultado.

§4º. A ausência dos resultados esperados pelo CONTRATANTE não caracteriza inexecução nem execução defeituosa do contrato, não ensejando devolução de valores, abatimento da mensalidade, indenização, compensação ou rescisão por justa causa.

CLÁUSULA QUARTA – DA APROVAÇÃO E DA APROVAÇÃO TÁCITA
Decorrido o prazo de 07 (sete) dias úteis previsto no inciso IV da Cláusula Primeira sem manifestação do CONTRATANTE, os conteúdos serão considerados TACITAMENTE APROVADOS, podendo ser publicados conforme o calendário editorial, não cabendo reclamação posterior quanto ao que foi veiculado.

§1º. Aprovado o conteúdo, expressa ou tacitamente, o CONTRATANTE responde pelo que foi publicado, inclusive quanto a informações técnicas, jurídicas, de preço, prazo, disponibilidade e condições de oferta.

§2º. Alterações solicitadas após a aprovação, além das 02 (duas) rodadas previstas, ou decorrentes de mudança de orientação do CONTRATANTE, poderão ser cobradas à parte.

§3º. O CONTRATANTE é o responsável pela observância das normas do seu órgão de classe quanto à publicidade de sua atividade, cabendo-lhe apontar, no momento da aprovação, qualquer conteúdo que entenda incompatível com tais normas.

CLÁUSULA QUINTA – DO MATERIAL FORNECIDO PELO CONTRATANTE
O CONTRATANTE declara ser titular ou legítimo licenciado dos direitos sobre marcas, imagens, fotografias, vídeos, textos, depoimentos, dados e demais materiais que fornecer, bem como possuir as autorizações de uso de imagem e de voz das pessoas neles retratadas.

Parágrafo único. O CONTRATANTE responderá, isolada e integralmente, por reclamações, notificações, autuações ou ações de terceiros decorrentes do material que fornecer ou aprovar, obrigando-se a manter a CONTRATADA indene, inclusive quanto a custas, honorários e eventuais condenações.

CLÁUSULA SEXTA – DO USO DOS CONTEÚDOS E DIREITO DE IMAGEM
A CONTRATADA fica autorizada a utilizar e compartilhar os conteúdos produzidos em decorrência deste contrato, bem como a marca, nome empresarial, logotipo e demais materiais públicos do CONTRATANTE, em seus perfis profissionais, redes sociais, portfólio, website, apresentações comerciais e demais materiais institucionais, exclusivamente para fins de divulgação de seus serviços e apresentação de trabalhos realizados, sem que disso decorra qualquer ônus ao CONTRATANTE.

O CONTRATANTE, por sua vez, fica autorizado a utilizar, reproduzir, publicar e compartilhar os conteúdos finais produzidos pela CONTRATADA durante a vigência deste contrato em quaisquer de suas redes sociais, websites, materiais institucionais, campanhas publicitárias e demais canais de comunicação vinculados à sua atividade, por prazo indeterminado, permanecendo, contudo, resguardados à CONTRATADA os direitos autorais sobre eles.

Parágrafo único. Permanecem com a CONTRATADA os arquivos editáveis, projetos, metodologias, modelos e processos por ela desenvolvidos, cuja entrega não integra o objeto deste contrato.

CLÁUSULA SÉTIMA – DAS PLATAFORMAS DE TERCEIROS, DOS ACESSOS E DAS SENHAS
Os serviços dependem de plataformas de terceiros, sobre as quais a CONTRATADA não tem ingerência.

§1º. A CONTRATADA não responde por indisponibilidade, instabilidade, alteração de regras, limitação de alcance, remoção de conteúdo, restrição, suspensão, bloqueio, invasão ou perda de contas e perfis, salvo se decorrente de sua culpa comprovada.

§2º. Os acessos e senhas fornecidos pelo CONTRATANTE permanecem de sua titularidade, serão utilizados exclusivamente para a execução deste contrato e guardados de forma criptografada. Ao término do contrato, poderão ser devolvidos ou revogados pelo CONTRATANTE.

§3º. A CONTRATADA não responde por conteúdo publicado por terceiros que também detenham acesso às contas, nem por alterações feitas pelo próprio CONTRATANTE.

CLÁUSULA OITAVA – DA LIMITAÇÃO DE RESPONSABILIDADE
A responsabilidade da CONTRATADA, por qualquer causa relacionada a este contrato, fica limitada ao valor efetivamente pago pelo CONTRATANTE nos 03 (três) meses anteriores ao fato gerador, excluídos, em qualquer hipótese, lucros cessantes, perda de chance e danos indiretos.

CLÁUSULA NONA – DA CONFIDENCIALIDADE E DA PROTEÇÃO DE DADOS
As partes obrigam-se a manter sigilo sobre as informações a que tiverem acesso em razão deste contrato, durante sua vigência e após o seu término.

Parágrafo único. As partes cumprirão a Lei n.º 13.709/2018 (LGPD). O CONTRATANTE, na qualidade de controlador dos dados de seus próprios clientes, responde pela base legal e pelas autorizações necessárias ao tratamento realizado por sua conta e ordem.

CLÁUSULA DÉCIMA – DO INVESTIMENTO E DA FORMA DE PAGAMENTO
Pela prestação dos serviços descritos neste contrato, o CONTRATANTE pagará à CONTRATADA o valor mensal de {{valor}} ({{valor_extenso}}).

O pagamento deverá ser realizado até o dia {{dia_pagamento}} de cada mês, por meio de PIX.

Em caso de atraso no pagamento, incidirá multa moratória de 2% (dois por cento) sobre o valor devido, acrescida de juros de mora de 1% (um por cento) ao mês, calculados proporcionalmente aos dias de atraso, além de correção monetária pelo índice legal aplicável.

Permanecendo a inadimplência por período superior a 30 (trinta) dias, a CONTRATADA poderá suspender a execução dos serviços até a regularização dos valores pendentes, sem que tal suspensão configure inadimplemento contratual, gere direito a compensação ou prorrogue o prazo de vigência.

CLÁUSULA DÉCIMA PRIMEIRA – DA VIGÊNCIA E DO INÍCIO DOS SERVIÇOS
O presente contrato terá vigência de {{prazo}}, iniciando-se em {{inicio}} e encerrando-se em {{fim}}, podendo ser renovado mediante acordo expresso entre as partes.

A execução das etapas iniciais do projeto — briefing, estudo estratégico da marca, planejamento dos conteúdos, captação de imagens e vídeos, bem como a criação e edição dos materiais que integrarão o cronograma — terá início no mês anterior ao da primeira publicação.

As publicações dos conteúdos nas redes sociais observarão o calendário editorial previamente elaborado e aprovado pelo CONTRATANTE.

Fica ajustado que a remuneração pelos serviços contratados terá início no primeiro mês de publicação, sendo o primeiro pagamento devido até o dia {{dia_pagamento}} daquele mês, conforme disposto na cláusula de investimento.

CLÁUSULA DÉCIMA SEGUNDA – DA RESCISÃO
Em caso de rescisão promovida pelo CONTRATANTE antes do término da vigência contratual, este deverá comunicar à CONTRATADA por meio de mensagem escrita enviada ao WhatsApp informado pela CONTRATADA para contato. O mês em que ocorrer a comunicação será integralmente concluído, permanecendo o presente contrato em plena execução durante o mês subsequente, cuja respectiva mensalidade será devida normalmente. Ao término desse período, o contrato será encerrado, incidindo, ainda, multa rescisória correspondente a 01 (uma) mensalidade contratual, no valor de {{valor}} ({{valor_extenso}}).

Caso a rescisão seja promovida pela CONTRATADA antes do término da vigência contratual, esta deverá comunicar o CONTRATANTE por meio de mensagem escrita enviada ao WhatsApp informado pelo CONTRATANTE para contato. O mês em que ocorrer a comunicação será integralmente concluído, permanecendo a prestação dos serviços durante o mês subsequente, cuja mensalidade será devida normalmente pelo CONTRATANTE. Encerrado esse período, a CONTRATADA prestará, a título de multa indenizatória, mais 01 (um) mês dos serviços contratados, sem qualquer custo adicional ao CONTRATANTE, findo o qual considerar-se-á rescindido o presente contrato.

Parágrafo único. A rescisão por descumprimento de obrigação essencial dispensa, para a parte inocente, o cumprimento do mês subsequente e a multa prevista nesta cláusula.

CLÁUSULA DÉCIMA TERCEIRA – DAS DISPOSIÇÕES GERAIS
Qualquer alteração no escopo dos serviços deverá ser previamente ajustada entre as partes, por escrito.

§1º. Este contrato não gera vínculo empregatício, societário, de exclusividade ou de representação entre as partes, nem entre a CONTRATANTE e as pessoas que a CONTRATADA empregar na execução dos serviços.

§2º. A tolerância quanto ao descumprimento de qualquer cláusula não implica novação, renúncia ou alteração do ajustado.

§3º. O presente contrato passa a produzir efeitos a partir de sua assinatura e permanecerá vigente pelo prazo estabelecido entre as partes, elegendo-se o {{foro}} para dirimir quaisquer controvérsias dele decorrentes.

E, por estarem justos e contratados, firmam o presente instrumento.


{{cidade}}, {{data}}.


CONTRATANTE

_______________________________________________
{{razao_social}}
{{documento_rotulo}} {{cnpj}}


CONTRATADA

_______________________________________________
{{agencia}}
CNPJ {{cnpj_agencia}}
`,
};
