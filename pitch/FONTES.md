# Fontes e notas técnicas · Pitch Atalaia

Notas de verificação, sourcing e ressalvas por slide, retiradas das notas do orador
em `index.html` para as deixar limpas (só o texto a dizer + cliques). Usar isto para
preparar o Q&A, não para ler em palco.

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

---

## 5 · O desafio da UMinho

- Pergunta do enunciado, tal como confirmada: "Como simular alternativas de
  atuação antes de comprometer meios no terreno, e como melhorar a coordenação
  nos primeiros minutos?" O enunciado fala também em "pouca ajuda de simulação" e
  em mostrar o efeito das decisões "de forma compreensível para quem decide" —
  usar se fizer falta no Q&A.
- "Todas as entidades envolvidas": bombeiros, proteção civil, câmara, GNR/PSP,
  INEM, as mesmas do slide 2 e do slide 6. Liga este slide ao resto do pitch.

---

## 5b · Logótipo

Sem notas técnicas; ver `index.html` para a descrição da animação.

---

## 6 · A proposta

- Verbos impessoais de propósito ("colocar", "alocar", "comunicar"), sem
  imperativo a apontar para quem vê o pitch. Manter esse registo no resto do
  slide.
- As quatro linhas do topo (monitorizar, alocar, prever, comunicar) são as
  quatro forças a vender: 1) prevê o incêndio (01, 03); 2) permite testar
  estratégias de ataque e ver a consequência; 3) sugere uma otimização da
  estratégia (ILS); 4) é um ponto de comunicação comum a todos os corpos de ação
  (04 + linha final + lista de entidades).
- As fontes de dados do incêndio (IPMA, ERA5, CERRA, Copernicus DEM, LiDAR DGT,
  COS DGT, PT-FireSprd) estão creditadas no último slide (créditos).
- CERRA e o FWI do IPMA vêm dos ramos feature/cerra-wind-engine e hindcast;
  confirmar que estão no main antes do lock.
- "Alocar com eficácia" cobre tanto a colocação manual como a sugestão
  otimizada (ILS); não especificar no slide qual dos dois corre na demo.
- "Tempo real" = o modelo rápido no browser (milissegundos por corrida); o
  ELMFIRE confirma em 10–40 s.
- Os dados úteis listados no fecho existem em reporting.ts (cortes de via, PMA
  e corredor) e no relatório do editor (aldeias, área por hora, ETA dos meios);
  a lista no slide ficou reduzida a 3 para caber num só olhar, o resto fica
  para o Q&A.

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

## 8 · Validação

Regras (do README do hindcast, não negociáveis):
- Mostrar SEMPRE os três números em sequência: 0,76 (modelo base) → 0,83 (só
  dados) → 0,89 (com linhas). Nunca o 0,89 sozinho, nem o 0,76 omitido.
- IMAGEM TROCADA (23 out): a imagem atual (`img/vieira_validation_scenarioB.png`)
  tem 3 painéis (sem o "Observado" sozinho); os números mudaram de
  0,73→0,76–0,79→0,84–0,85 (versão antiga) para 0,76→0,83→0,89 (versão atual) —
  é outra corrida/versão do hindcast. Confirmar com quem gerou a imagem que esta
  é a versão final antes do pitch; se não for, repor os números antigos e a
  imagem antiga (`img/vieira_validation_0830.png`, 4 painéis).
- A imagem atual mostra dois pontos no tempo por painel (15:00 e 08:30), não só o
  08:30 único que está no título do slide; confirmar se o título deve passar a
  mencionar os dois horários.
- As linhas de ataque são inferidas (attack.py) de onde o perímetro oficial parou
  ao longo das estradas: melhoram o Sørensen em parte por construção. Nunca dizer
  que vêm "dos registos".
- O satélite nunca se lê sozinho: a imagem traz "hotspots reached" por painel
  (0,21→0,54→0,54 de dia; 0,25→0,68→0,68 de noite), diferente do KPI antigo
  (71–77% dos focos, NASA FIRMS). Decidir qual dos dois citar no Q&A, não os
  dois ao mesmo tempo.
- Os valores S nos mosaicos usam ponto decimal (gerados pelo grid.py).
- Intervalos = 3 sementes das projeções.
- Para o Q&A: a corrida principal (10:00–15:00) fica 1,4 a 1,9× lenta de mais
  (380–490 ha contra 707 às 15:00) — confirmar se este número ainda se aplica à
  corrida da nova imagem.
- Os resultados estão no ramo hindcast-registos, ainda não no main: integrar
  antes do lock de sexta.

---

## 8b · A tecnologia

- ELMFIRE: motor open-source (EPL 2.0) de Chris Lautenberger, listado no
  software do Fire Lab da UC Berkeley (firelab.berkeley.edu/software);
  Lautenberger é antigo aluno de Berkeley, hoje na CloudFire Inc. Dizer "do Fire
  Lab da UC Berkeley" é defensável; não dizer que a Berkeley o construiu de raiz
  como projeto institucional.
- Copas: vêm do LiDAR da DGT (MDS − MDT a 2 m, hindcast/canopy.py). Cobertura e
  altura são medidas; altura da base e densidade são estimadas por espécie. São
  de 2024-25 (docs/plan.md).
- Declives: método de Horn, como nos rasters LANDFIRE que o ELMFIRE lê
  (docs/plan.md).
- Motor de vento (CERRA + relevo, ramo feature/cerra-wind-engine): ainda não é
  uma vitória clara. No hindcast, em Vieira do Minho fica dentro do ruído das
  sementes (relevo) e em Cabeceiras de Basto piora com CERRA (docs/plan.md,
  linha do Sørensen por passo). Dizer "a tentar captar" e não prometer que já
  funciona melhor; é trabalho em curso, não um resultado fechado.
- ILS: Mendes, A.B. & Alvelos, F.P. (2023), "Iterated local search for the
  placement of wildland fire suppression resources", EJOR 304(3), 887-900.
  Projeto O3F (FCT), Prémio Isabel Themido 2025 da APDIO. Filipe Alvelos é um
  dos orientadores do projeto (com Elsa Silva) — confirmar como querem ser
  creditados antes de nomear em palco.
- Tradutor de estratégia: corresponde ao código que passa as decisões do editor
  (meios, linhas de água) para o grafo do ELMFIRE/ILS (barreiras, retardantes,
  Δ).
- Este é um slide novo: acrescenta ~20 s ao total de 4 min já apertado. Rever se
  cabe, ou encurtar a demo, antes do pitch final.

---

## 9 · A seguir + fecho

- Passo 1 (deteção): a ideia-chave é que o potencial de melhoria não está só em
  defender melhor, está em detetar mais cedo. Drones em patrulha reduzem o tempo
  até à deteção e substituem parte do reconhecimento aéreo hoje feito por
  helicóptero, mais caro. Fonte: um bombeiro, ex-comandante em Guimarães —
  confirmar o nome exato e a citação antes de a atribuir em palco; por agora,
  dizer "segundo um ex-comandante dos bombeiros de Guimarães com quem falámos",
  sem apontar números de custo que não temos confirmados.
- Passo 2 (treino): incêndios passados como exercícios para os bombeiros do
  distrito e a UMinho, com a possibilidade de construirmos um modelo de treino
  próprio (simulação dedicada a formação, não só ao incidente real). Ainda é
  intenção, não trabalho feito: dizer "podemos integrar", não "já temos".
- Passo 3 (IA): ainda é visão, não trabalho feito. Dizer "a afinar", não "já
  afina". É o horizonte do roadmap, por isso fica a âmbar, como destino.
- O "piloto em Guimarães" saiu do roadmap a pedido; já não é preciso confirmar
  o apoio do Prof. Paulo Afonso para este slide.
- "11 Guimarães" em 2025: mesmo cálculo do slide 2 (270 695 ha ÷ 241,7 km² do
  concelho ≈ 11,2). O fecho repete esse número de propósito, agora com o valor
  de 2025. Segurar a pausa depois de "11 Guimarães".

---

## 10 · Créditos

Fora do tempo. Fica no fim para o júri e para o PDF da submissão.
