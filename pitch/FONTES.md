# Fontes e notas técnicas · Pitch Atalaia

Notas de verificação, sourcing e ressalvas por slide, retiradas das notas do orador
em `index.html` para as deixar limpas (só o texto a dizer + cliques). Usar isto para
preparar o Q&A, não para ler em palco.

⚠️ **Tempo (23 out):** tudo o que não é a demo (112 s) tinha de caber em
2 min. Primeiro cortaram-se ~37 s de texto no gancho, problema, ferramentas,
proposta, validação, tecnologia e "a seguir" (total sem demo: 1:59); depois
fundiram-se os slides "proposta", "validação" e "tecnologia" num só, o que
tira mais ~15 s e dois slides inteiros. Total sem demo agora: 1:44.

---

## 1 · Título

Sem notas técnicas.

---

## 2 · Gancho

- Tudo neste slide é de 2025, o último ano fechado (não 2026): a AGIF só publica os
  números definitivos de cada ano no relatório do ano seguinte.
- 270 695 ha = 2 706,95 km² ≈ 11,2 × Guimarães (241,7 km²).
- Fonte única: AGIF, Relatório de Atividades do SGIFR 2025 (dados até 19 jun 2026),
  pp. 14 e 43 (perdas), 20 e 965 (área e ocorrências).
  https://www.agif.pt/app/uploads/2026/07/Relatorio_Atividades_SGIFR_2025_v20260715.pdf
  "Prejuízos estimados superiores a 85 milhões de euros": madeira, biomassa, frutos,
  carbono e serviços de ecossistema. 270 695 ha, 8 252 incêndios, 6 mortos.
  Pinheiro-bravo 52 M€, eucalipto 11 M€.
- É um mínimo: não inclui casas, infraestruturas, saúde nem o custo do combate (a
  AGIF ainda não aplica esse método).
- Para o Q&A: o sistema gastou 600 M€ em 2025 a prevenir e combater (mesmo
  relatório, p. 19). Em 2017, ~1,5 mil M€ de danos (JRC, San-Miguel-Ayanz et al.).
- Se perguntarem por 2026: até 21 out já arderam 74 591 ha (ICNF, provisório) — bem
  abaixo de 2025. Não há valor oficial de perdas (só sai no relatório de 2027). A
  nossa estimativa, a partir dessa área e do €/ha de 2024-2025 (314-487 €/ha):
  25-35 M€, mesmo âmbito restrito. Dizer sempre que é uma extrapolação nossa, não um
  número da AGIF.
- Slide a 16 s (23 out: era 20 s). A frase das perdas ficou mais curta ("Mais
  de 85 milhões de euros em perdas — sem contar casas, estradas ou o
  combate."); os números em si não mudaram.

---

## 3 · Problema

- Fonte: AGIF, Relatório de Atividades do SGIFR 2025, pp. 34-36.
  https://www.agif.pt/app/uploads/2026/07/Relatorio_Atividades_SGIFR_2025_v20260715.pdf
- "Em 2025, cerca de 91% da área ardida ocorreu em incêndios com dimensão igual ou
  superior a 500 hectares" (p. 34) — 44 incêndios dessa dimensão (p. 35).
- O slide usa o limiar de 500 ha, não 100 ha: é o que o relatório de 2025 destaca
  como o seu dado de concentração. Não combinar com o limiar de 100 ha usado antes
  (fonte diferente, ano diferente).
- 44 de 8 252 = 0,53 %: cálculo nosso, não a frase do relatório. A AGIF escreve
  "cerca de 0,47 % das ocorrências" (p. 35), mas usa uma base de ocorrências que não
  bate com os 8 252 incêndios rurais do slide 2 (o relatório não explica a
  diferença). Preferimos o nosso 0,53 %, por ficar consistente com o slide 2, a
  citar o 0,47 % da AGIF sem o conseguirmos reconciliar.
- 246 mil ha é um cálculo nosso (91 % × 270 695 ha, o total do slide 2): o relatório
  só dá a percentagem arredondada, não o valor em hectares desta classe. Não
  apresentar como número exato do relatório.
- A concentração da área ardida não prova uma relação causal entre o primeiro
  ataque e a dimensão final.
- "Pouca ajuda de simulação" é a frase do enunciado do desafio. Não dizer que as
  entidades não têm ferramentas.
- Slide a 12 s (23 out: era 20 s). O texto não mudou; o tempo alocado é que
  estava com folga a mais para um slide de duas frases curtas.

---

## 4 · O que já existe, e porque falha

- FARSITE e FlamMap (Rothermel/Finney, USDA Forest Service): simuladores físicos
  detalhados e amplamente citados, mas exigem muito cálculo e dados de alta
  resolução, o que limita o seu uso em tempo real durante um incidente. É um ponto
  recorrente na literatura. Não usar o ELMFIRE como exemplo aqui: é o motor que a
  própria Atalaia usa para a validação e o plano B, por detrás do modelo rápido do
  browser (ver notas do slide 6 abaixo); citá-lo como "lento" sem essa distinção
  confundiria a audiência.
- FARSITE (precisão): Benali, A. et al. (2016). "Deciphering the impact of
  uncertainty on the accuracy of large wildfire spread simulations". Science of
  the Total Environment, 569-570, 73-85.
  https://www.sciencedirect.com/science/article/abs/pii/S0048969716312852. Estudo
  com oito grandes incêndios portugueses: a incerteza no vento (velocidade e
  direção), no modelo de combustível e na localização/hora da ignição tem impacto
  grande na precisão da simulação. "FARSITE" é uma das palavras-chave do próprio
  artigo.
- FARSITE e FlamMap ficam numa só linha (lento + impreciso sem correção de
  inputs): já não há duas linhas de FARSITE repetidas.
- Para o Q&A, se perguntarem porque é que a Atalaia também usa o FARSITE/ELMFIRE:
  usamos para validar e para o plano B (correm ao fundo, 10-40 s), não como o
  modelo em tempo real que a pessoa vê no mapa (esse é o modelo rápido do
  browser). A falha aqui é sobre usar um simulador físico sozinho, sem o resto do
  nosso desenho (dados calibrados a Portugal, correção e o modelo rápido para a
  decisão imediata).
- fogos.pt e IPMA/EFFIS: o fogos.pt mostra ocorrências e meios empenhados, não o
  efeito de os colocar de outra forma; o IPMA/EFFIS mostra o risco do dia.
  Tirámos o Copernicus EMS deste slide: o nome é parecido com o Copernicus DEM,
  que a Atalaia usa para o relevo, e isso confundia a audiência mesmo sendo dois
  produtos diferentes do programa Copernicus.
- incendiosportugal.pt: prevê a propagação do fogo, mas não propõe nem avalia
  ataques otimizados — é uma ferramenta de previsão, não de decisão. Se
  perguntarem no Q&A: também assume que não há combate durante a simulação.
- Fontes da síntese científica, por confirmar: acesso bloqueado ao texto completo
  no momento da pesquisa. "AI for Wildfire Management..." (MDPI, 2025) e "Forest
  Fire Prediction Models in Portugal: A Comprehensive Review". Não citar números
  ou frases exatas destes artigos sem ler o texto integral primeiro.
- Slide a 11 s (23 out: era 15 s). "lentos demais" → "lentos"; "não propõe
  ataques otimizados" → "sem ataques otimizados". Os cartões no ecrã não
  mudaram, só a fala.
- ÍCONES TROCADOS (23 out): os 4 cartões passam a usar ícones novos
  (ampulheta, olho, velocímetro, espiral) em vez dos antigos (relógio,
  gota, nuvem, alvo), todos na mesma cor #F76707 — antes cada cartão tinha
  uma cor diferente (vermelho, âmbar, azul, "cool"). A cor igual em todos
  é a mesma usada nos ícones do slide 6 (modelos) e no logótipo.

---

## 5 · O desafio da UMinho

- Pergunta literal do enunciado: "Como simular alternativas de atuação antes de
  comprometer meios no terreno, e como melhorar a coordenação nos primeiros
  minutos?" No slide fica encurtada ("...de atuação, e melhorar a coordenação
  nos primeiros minutos?", sem "antes de comprometer meios no terreno") para
  caber num relance; se perguntarem no Q&A pela redação exata do desafio, usar
  a frase completa acima. O enunciado fala também em "pouca ajuda de simulação" e
  em mostrar o efeito das decisões "de forma compreensível para quem decide" —
  usar se fizer falta no Q&A.
- "Todas as entidades envolvidas": bombeiros, proteção civil, câmara, GNR/PSP,
  INEM, as mesmas do slide 2 e do slide 6. Liga este slide ao resto do pitch.
- Slide a 8 s (23 out: era 10 s). Texto igual, só menos tempo de pausa entre
  os três cliques (rápida/precisa/prática).

---

## 5b · Logótipo

Sem notas técnicas; ver `index.html` para a descrição da animação.

---

## 6 · A proposta + validação + métodos

FUNDIDO (23 out): este slide era três slides separados — "A proposta",
"Validação" e "A tecnologia" — juntados num só para caber a apresentação em
menos tempo. Fica: roadmap da proposta → prova de validação (meio) →
modelos resumidos (ícone + nome, 4 badges numa linha, em baixo), tudo no
mesmo slide, antes da demo.

ATUALIZADO (23 out, 2.ª passagem): a linha "Dados reais. Meios reais. Um só
mapa." no meio do slide deu lugar aos 4 modelos resumidos (ELMFIRE, Motor
de vento, Otimização ILS, Tradutor de estratégia — os mesmos ícones do
antigo grid de 4 cartões, agora só ícone + nome, sem descrição). A frase
"Dados reais..." saiu do slide e da fala.

ATUALIZADO (23 out, 3.ª passagem): a imagem de validação passou para o
meio do slide (logo a seguir ao roadmap) e os 4 modelos resumidos para
baixo (antes era o inverso). A fala segue a mesma ordem: proposta → prova
de validação → modelos.

ATUALIZADO (23 out, 4.ª passagem): as secções de validação e modelos
passaram a ficar centradas (estavam encostadas à esquerda). Na validação,
o rótulo "Sobreposição com um incêndio real · Vieira do Minho, 2016"
passou para cima da sequência 0,76→0,83→0,89 (antes estava por baixo, e
incluía "· índice de Sørensen", que saiu do ecrã — o termo continua a
usar-se na fala e no Q&A). Chegaram a ter títulos próprios ("A
validação", "Os modelos"), mas saíram logo a seguir (5.ª passagem) por
pedido direto.

ATUALIZADO (23 out, 6.ª passagem): os 4 modelos passam a usar o nome
completo, igual ao do antigo grid de 4 cartões — "ELMFIRE calibrado para
Portugal", "Motor de vento próprio", "Otimização da estratégia", "Tradutor
de estratégia" (este já estava completo) — em vez de "ELMFIRE", "Motor de
vento", "Otimização ILS". Como "Tradutor de estratégia" não cabia na
mesma linha que os outros três, a fila passou de 4 em linha para grelha
2×2.

**O que se perdeu na fusão** (para decidir se volta a entrar no Q&A):
- "Dados reais. Meios reais. Um só mapa." já não aparece no slide nem na
  fala — se o júri valorizar essa frase de marca, pode voltar a entrar,
  mas não há espaço livre no slide atual sem tirar outra coisa.
- A imagem de validação fica pequena (520px de largura, ~42% do slide, em
  vez do slide inteiro): já não se leem os pormenores das três áreas
  ardidas, só a forma geral e a cor. Os três números continuam bem
  legíveis.
- As legendas por painel ("área prevista pelo modelo" / "perímetro
  observado") e os rótulos de cada seta ("+ Dados públicos" / "+ Linhas de
  ataque") saíram do slide — ficam só os números em sequência.
- O grid de 4 cartões da tecnologia perdeu a descrição de cada peça (só
  ícone + nome); a frase de fecho "cada peça a fazer o que faz melhor"
  saiu por completo. O "tradutor de estratégia" voltou a aparecer (como
  ícone + nome), mas sem a frase que explicava o que faz.
- Se o júri pedir mais detalhe em algum destes pontos, está tudo neste
  ficheiro, mais abaixo nesta secção.

**Proposta (texto original, ainda válido):**
- Verbos impessoais de propósito ("colocar", "alocar", "comunicar"), sem
  imperativo a apontar para quem vê o pitch. Manter esse registo no resto do
  slide.
- As quatro linhas do roadmap (monitorizar, alocar, prever, comunicar) são as
  quatro forças a vender: 1) prevê o incêndio (01, 03); 2) permite testar
  estratégias de ataque e ver a consequência; 3) sugere uma otimização da
  estratégia (ILS); 4) é um ponto de comunicação comum a todos os corpos de ação.
- "Alocar com inteligência" (23 out: era "com eficácia") cobre tanto a
  colocação manual como a sugestão otimizada (ILS); não especificar no
  slide qual dos dois corre na demo.
- "Tempo real" = o modelo rápido no browser (milissegundos por corrida); o
  ELMFIRE confirma em 10–40 s.
- Os dados úteis (estradas a cortar, tempo de chegada, casas em risco)
  existem em reporting.ts (cortes de via, PMA e corredor) e no relatório do
  editor (aldeias, área por hora, ETA dos meios); a lista de 3 no antigo
  slide 6 saiu da fala nesta fusão, mas continua no Q&A.
- Tirou-se da fala a frase "Nós trabalhamos com dados precisos, com os
  meios que estão disponíveis ao momento em cada quartel, e tudo isto num
  só mapa.", que duplicava o "Dados reais. Meios reais. Um só mapa." logo a
  seguir — redundante e caro em tempo.

**Validação — regras do README do hindcast, não negociáveis:**
- Mostrar SEMPRE os três números em sequência: 0,76 (modelo base) → 0,83 (só
  dados) → 0,89 (com linhas). Nunca o 0,89 sozinho, nem o 0,76 omitido.
- IMAGEM TROCADA (23 out): a imagem atual (`img/vieira_validation_scenarioB.png`)
  tem 3 painéis; os números mudaram de 0,73→0,76–0,79→0,84–0,85 (versão
  antiga) para 0,76→0,83→0,89 (versão atual) — é outra corrida/versão do
  hindcast. Confirmar com quem gerou a imagem que esta é a versão final
  antes do pitch; se não for, repor os números antigos e a imagem antiga
  (`img/vieira_validation_0830.png`, 4 painéis).
- IMAGEM CORTADA (23 out): os títulos em inglês de cada painel vinham
  gravados nos pixéis da imagem; cortámos a faixa do topo (os primeiros
  58 px da imagem original, 3040×757). Se a imagem for regenerada, repetir
  o corte ou gerar já sem o texto.
- As linhas de ataque são inferidas (attack.py) de onde o perímetro oficial
  parou ao longo das estradas: melhoram o Sørensen em parte por construção.
  Nunca dizer que vêm "dos registos".
- O satélite nunca se lê sozinho: a imagem traz "hotspots reached" por
  painel (0,21→0,54→0,54 de dia; 0,25→0,68→0,68 de noite), diferente do KPI
  antigo (71–77% dos focos, NASA FIRMS). Decidir qual dos dois citar no
  Q&A, não os dois ao mesmo tempo.
- Para o Q&A: a corrida principal (10:00–15:00) fica 1,4 a 1,9× lenta de
  mais (380–490 ha contra 707 às 15:00) — confirmar se este número ainda se
  aplica à corrida da nova imagem.
- Os resultados estão no ramo hindcast-registos, ainda não no main:
  integrar antes do lock de sexta.
- A fala tirou "aqui no distrito de Braga" e o detalhe "combustíveis
  portugueses, LiDAR, cicatrizes, projeções" (agora só no Q&A); os três
  números continuam todos ditos, como a regra acima pede.

**Métodos (antiga "A tecnologia"):**
- ELMFIRE: motor open-source (EPL 2.0) de Chris Lautenberger, listado no
  software do Fire Lab da UC Berkeley (firelab.berkeley.edu/software);
  Lautenberger é antigo aluno de Berkeley, hoje na CloudFire Inc. Dizer "do
  Fire Lab da UC Berkeley" é defensável; não dizer que a Berkeley o
  construiu de raiz como projeto institucional.
- Copas: vêm do LiDAR da DGT (MDS − MDT a 2 m, hindcast/canopy.py). Cobertura
  e altura são medidas; altura da base e densidade são estimadas por
  espécie. São de 2024-25 (docs/plan.md).
- Motor de vento (CERRA + relevo, ramo feature/cerra-wind-engine): ainda não
  é uma vitória clara. No hindcast, em Vieira do Minho fica dentro do ruído
  das sementes (relevo) e em Cabeceiras de Basto piora com CERRA
  (docs/plan.md, linha do Sørensen por passo). Dizer "a tentar captar" e
  não prometer que já funciona melhor; é trabalho em curso, não um
  resultado fechado.
- ILS: Mendes, A.B. & Alvelos, F.P. (2023), "Iterated local search for the
  placement of wildland fire suppression resources", EJOR 304(3), 887-900.
  Projeto O3F (FCT), Prémio Isabel Themido 2025 da APDIO. Filipe Alvelos é
  um dos orientadores do projeto (com Elsa Silva) — confirmar como querem
  ser creditados antes de nomear em palco.
- Tradutor de estratégia (saiu da fala e do slide nesta fusão, mas continua
  no código): corresponde ao código que passa as decisões do editor (meios,
  linhas de água) para o grafo do ELMFIRE/ILS (barreiras, retardantes, Δ).

Slide a 28 s (23 out: antes eram três slides, 13+15+15 = 43 s).

---

## 7 · Demo ao vivo

Guião a fechar na quinta, a partir da build final:
- [ ] incêndio e hora de partida
- [ ] que meios se colocam e onde (os que a demo corre de facto)
- [ ] números do efeito: [X] ha, [Y] aldeias / casas, [Z] estradas cortadas
- [ ] vistas por papel (Proteção Civil · PSP/GNR · INEM): ficam ou caem?
- [ ] resumo ao comandante (P11): fica ou cai?

Plano B: vídeo gravado da própria app em `media/demo.mp4` (gravar depois do
freeze). Qualquer pausa > 5 s → o colega de apoio arranca o vídeo no mesmo ponto
e o condutor continua a falar.

---

## 8 · A seguir

- ORDEM TROCADA (23 out): passa a ser 1) ferramenta de testes, 2) IA,
  3) drones — antes era drones, ferramenta, IA. O passo final (agora drones)
  é que fica a âmbar e tem o vídeo por baixo; o âmbar deixou de marcar "a
  visão mais distante" e passa a marcar só o último passo do roadmap, o que
  fecha o slide com o vídeo.
- Passo 1 (ferramenta de testes): o modelo permite não só tomar decisões em
  tempo real, como também ser uma ferramenta de testes para potenciais
  cenários antes de acontecerem — treino com incêndios passados como exercício
  para os bombeiros do distrito e a UMinho. Ainda é intenção, não trabalho
  feito: dizer "podemos integrar", não "já temos".
- Passo 2 (IA): ainda é visão, não trabalho feito. Dizer "a afinar", não "já
  afina".
- Passo 3 (deteção por drones): a ideia-chave é que o potencial de melhoria
  não está só em defender melhor, está em detetar mais cedo. Drones em
  patrulha reduzem o tempo até à deteção e substituem parte do reconhecimento
  aéreo hoje feito por helicóptero, mais caro. Fonte: um bombeiro,
  ex-comandante em Guimarães — confirmar o nome exato e a citação antes de a
  atribuir em palco; por agora, dizer "segundo um ex-comandante dos bombeiros
  de Guimarães com quem falámos", sem apontar números de custo que não temos
  confirmados.
- Vídeo do drone (`pitch/video/drone-deteccao.mp4`, 11,8 MB): render 3D de
  um drone numa estação de patrulha, em loop, mudo, sem controlos — arranca
  sozinho ao entrar no slide. Confirmar se é material próprio (nosso render)
  ou de terceiros antes do pitch final; se for de terceiros, falta o crédito
  nos "Créditos" (slide 10).
- O "piloto em Guimarães" saiu do roadmap a pedido; já não é preciso confirmar
  o apoio do Prof. Paulo Afonso para este slide.
- Este slide ficou só com o roadmap; o fecho ("Em 2025 arderam 11 Guimarães" +
  "Obrigado") passou para um slide à parte (9), para dar espaço às duas ideias.
- O slide ficava muito vazio só com o roadmap (muito espaço em branco por
  baixo): acrescentou-se uma frase curta por passo e uma frase de fecho ("Ver
  sempre mais cedo. Decidir sempre melhor.") a seguir ao roadmap, no mesmo
  estilo do "Dados reais..." do slide 6.
- Vídeo a 2× (23 out): sem ffmpeg disponível para reencodar, a velocidade é
  ajustada por JS (`video.playbackRate`) em vez de no ficheiro.
- Slide a 11 s (23 out: era 15 s). A frase de introdução ficou mais curta
  ("ferramenta de testes para cenários futuros" em vez de "uma ferramenta de
  testes para potenciais cenários futuros"; "drones para detetar mais cedo"
  em vez de "...não só defender melhor").

---

## 9 · Fecho + obrigado

- "11 Guimarães" em 2025: mesmo cálculo do slide 2 (270 695 ha ÷ 241,7 km² do
  concelho ≈ 11,2). O fecho repete esse número de propósito, agora com o valor
  de 2025. Segurar a pausa depois de "11 Guimarães".
- FRASE TROCADA (23 out): "Em 2025 arderam 11 Guimarães. Com a Atalaia,
  quem decide vê o que vai arder, para cada decisão, antes de enviar os
  meios." → "11 Guimarães arderam em 2025. Está na hora de ver primeiro, e
  decidir melhor." A nova frase ecoa o tagline da marca ("Ver primeiro.
  Decidir melhor.", visível no logótipo ao longo da apresentação) em vez de
  o parafrasear — fecha o pitch com a própria frase da marca.

---

## 10 · Créditos

Fora do tempo. Fica no fim para o júri e para o PDF da submissão. O marcador
`.tbd` sobre o ILS saiu: `docs/ils.md` no main já documenta a funcionalidade
como implementada (ver "Demo timeline replanning"), por isso o crédito da
otimização deixou de ser condicional.
