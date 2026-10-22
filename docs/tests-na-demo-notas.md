# Tests na demo — mudanças e verificação (22 out 2026)

Este ramo responde à lista **"Tests na demo"** do Build Week Plan. Traz também o `origin/main` até ao hindcast step 3.

A demo passa a ter **um só incêndio**, simulado na Penha. O fogo corre só no **ELMFIRE**, com um botão. Um **incidente de vento** obriga a realocar os meios.

Verificações de 22 out 2026: build TypeScript/Vite, colocação real no handler do editor sem WebGL, regressões de contornos/rotas/ETA/água ilimitada e ILS. A verificação anterior em Firefox/WebGL confirmou 0 redraws em 2 s em pausa, atualização do relógio/reprodução e o fluxo editor → API → ELMFIRE para A/B num cenário isolado de 120 min com linha rodada a 45,002°. Os novos testes de colocação não lançam browser nem ELMFIRE. O adapter e os testes do motor foram repostos sem alterações, para não interferir com a calibração de outra sessão.

## Como correr

```bash
api/setup.sh        # uma vez
api/serve.sh        # porta 5181, precisa do Docker com atalaia/elmfire:2025.0717
cd web && npm run dev
```

Na primeira vez, abrir a Penha com a API ligada. A previsão sem meios (24 h) fica em cache para os dois ventos.

## O cenário: Penha, Guimarães (simulado)

- **Ignição:** 41°25′14.7″N 8°16′10.0″W, a 16 set 2024 às 10:00.
- **Meteo:** IFS real desse dia, com o vento ×1,6 (antes ×2); redução da secura de 3 para 2 pontos e mínimo de humidade de 3 %, antes 2 %.
- **Grelha:** 27 km × 27 km, 900 × 900 células de 30 m.
- **Calibração:** à ordem de grandeza do incêndio de **Paredes, 17 set 2024** (PT-FireSprd v2, uso interno). Do v2 só se leram áreas e ROS; nenhuma geometria de 2024 está no repositório.
- **Incidente de vento às 12:30 (T+150):** de E a 36 km/h para NNO a 48 km/h. Mantém-se a rotação sintética; a intensidade é menor.
  - Às 6 h a nova referência tem 322,5 ha com a rotação, face a 553,4 ha no cenário anterior.
- **Referência cortada aos 2000 ha:** 2000,6 ha aos T+1268 min; progressão com cerca de 282 KB.
- **Deteção:** drone aos 10 min, satélite aos 30 min (`detection.json`).
- **Construção:** reproduzível com `scripts/.venv/bin/python -I scripts/build_hypothetical.py --keep-grid` (reutiliza a paisagem existente ao mover a ignição). Os outros incêndios continuam no disco, mas fora do `index.json`.

## Fluxo de decisão

- **ELMFIRE em vez do modelo rápido:** o modelo rápido já não aparece no ecrã. Fica só por dentro do ILS, para propor o B.
- **Botão "Simular no ELMFIRE":** acende-se só quando a disposição dos meios mudou.
  - Durante a corrida, um véu de ecrã inteiro bloqueia tudo. Mostra o tempo decorrido e o progresso Livre / A / B, troço k/n.
- **API assíncrona:** `POST /api/jobs` e `GET /api/jobs/{id}`, com consultas a cada 1,5 s. Isto resolve o "NetworkError" das corridas com mais de um minuto. `/api/run` continua igual.
- **Abertura e corte do diretor:**
  - fogo ao avistamento do drone (T+10);
  - fogo ao avistamento do satélite (T+30);
  - previsão ELMFIRE sem meios.
- **Incidente de vento:**
  - Antes do incidente, os planos usam a previsão sem a rotação (`wind_shift: false`).
  - Às 12:30 a reprodução pausa e aparece um só botão, "Realocar meios".
  - Não se passa do incidente sem uma nova corrida ELMFIRE com o vento real.
- **Fim do incêndio:** "Extinto às HH:MM · N ha", ou "corte aos 2000 ha".

## Meios

- **Wet lines:**
  - Cada meio terrestre põe uma faixa azul-clara que é exatamente o `decision.barriers` do ELMFIRE.
  - A faixa cresce pela frente do fogo ao ritmo de ataque do meio: VFCI ~240 m/h, brigadas pela NWCG.
  - Água ilimitada: sem dependência de tanque, reabastecimento ou secagem; a linha mantém-se não combustível. O crescimento segue a taxa nominal durante o turno de 12 h.
  - Há no máximo 6 `from_min` por decisão.
- **Só os 3 quartéis mais próximos:** BV Guimarães, Vizela e Fafe.
  - O mapa mostra apenas o quartel e o tipo de meio selecionados. O **contorno tracejado segue a forma do fogo** e delimita as células onde o fogo chega antes desse meio, contando a hora atual da ordem, a saída e a viagem até cada célula. Mudar o quartel, o meio ou o relógio atualiza o contorno. A explicação fica num cartão, sem rótulos sobrepostos na ignição.
  - Não há um limite circular de colocação: um ponto seguro num flanco pode ficar à mesma distância da ignição que outro já atingido pela cabeça. A colocação e o ILS verificam os tempos reais da previsão ao longo da aproximação ao destino. O contorno é orientação visual, não uma barreira radial adicional.
- **Colocação:** um botão por meio, e cada meio coloca-se com um clique no mapa. Saíram "+ colocar meio" e "clicar no mapa".
- **Rotas:** a azul-escuro.
- **Início vazio:** os cenários começam sem meios. "Repor exemplo" continua disponível.
- **ILS do Bruno:** as linhas de A, com mover, deslocar e encurtar, estão integradas nas wet lines. O `ils:check` foi atualizado, e B continua a bater A nos dois incêndios de referência.

## Visual e HUD

- **Fogo simulado:** liso, com o estilo do fogo observado: linha âmbar, últimos 30 min em âmbar suave e brasa escura.
  - Aparece desde T+0, com um brilho mínimo enquanto é pequeno.
  - As células batem com o minuto do relógio.
- **Linhas brancas:** substituídas por uma linha verde, "Melhor caso · X ha".
- **Anéis de 1/2/5 km e raio de ignição:** removidos.
- **"Satélite deteta o fogo · HH:MM":** substitui o T_sat.
- **Coordenadas:** são as da **mira**, no centro do ecrã.
- **Luz de foco:**
  - Segue a mira em cada frame.
  - Tem tamanho fixo no ecrã; só o corte do diretor (D) a ajusta por plano.
- **Painel de alertas:**
  - habitações em risco em menos de 1 h;
  - meios com pouca água;
  - velocidade de propagação crítica: aviso a 16,8 m/min (Scott & Burgan 2005), crítico a 50 m/min (Tedim et al. 2018);
  - o incidente de vento.
- **Reprodução:**
  - A animação começa em pausa.
  - Há um só relógio para a reprodução e para o slider da hora.
  - Remover um meio já não afasta a câmara.
  - O relógio é partilhado com o reset (R); confirmar o comportamento visual no browser.
- **Correção:** o Cesium deixava de renderizar ("normalized result is not a number"). Agora as linhas no chão descartam pontos repetidos (`cleanPath`).

## Verificação da história completa

1. Na abertura (T+10, T+30, Previsão), o fogo aparece desde T+0.
2. Escolher quartel e meio atualiza o contorno; colocar num acesso aonde se chega antes do fogo no percurso acende o botão. O véu de carregamento bloqueia tudo durante a corrida.
3. Às 12:30 aparece "Realocar meios". Não se avança sem simular, e depois o split mostra o resultado com o vento novo.
4. As wet lines crescem ao longo da frente. As rotas aparecem a azul-escuro.
5. A luz e as coordenadas ficam na mira.

## Limitações conhecidas

- **Referência vs API depois das 6 h:** o handoff relata grande variação entre as corridas de 24 h com projeções; essa comparação longa não foi repetida nesta recuperação. O teste atual confirmou apenas a tolerância às 6 h (−5,85 %).
- **Anéis e mudança de vento:** os meios já colocados não são retirados automaticamente se o vento mudar a zona de interceção.

## Merge do hindcast step 3 e recuperação do push

- Integrado `origin/main` (`c910095`), incluindo os três commits que faltavam. Mantêm-se as humidades mortas calculadas de hora a hora, as copas LiDAR e as cicatrizes nos incêndios históricos.
- A Penha não precisa de ficheiros LiDAR nem cicatrizes. O seu bloco `engine` continua a definir combustíveis portugueses, copas típicas, projeções, semente 2 e humidades vivas 30/70. As opções explícitas do pedido ganham aos valores do incêndio.
- A meteo sem rotação continua disponível e dá uma chave de cache diferente da meteo com rotação.
- `api/test.sh` verifica o índice público real e usa os incêndios históricos como fixtures isoladas; já não depende de estes aparecerem na seleção da demo. Inclui regressões dos valores da Penha após o merge.
- O gerador da Penha passa a usar diretamente `engines/elmfire/run.sh`. Foi removido o overlay duplicado, que ficou incompatível depois de o adapter principal incorporar combustíveis portugueses e projeções; a entrada antiga `scripts/elmfire_pt/run.sh` fica como encaminhamento.
- ILS: referência atualizada para água ilimitada e equipas apeadas fora de estrada, com 2000 planos e semente 1. Os valores estão em `web/scripts/ils-reference.json` e `docs/ils.md`. São do modelo rápido, não do ELMFIRE.
- SimFire não está instalado neste ambiente; as corridas reais da regressão API usaram ELMFIRE.
- As edições de `pitch/` da outra sessão ficam fora deste ramo e do PR.

## Interceção e ETA ao colocar meios

- As antigas circunferências foram substituídas por contornos célula a célula da zona onde o fogo chega primeiro. A aproximação ao ponto escolhido é verificada em passos de meia célula (15 m).
- A viagem usa a estimativa do modelo: distância quartel–destino × fator rodoviário / velocidade do meio, mais o tempo de saída. Tanto o contorno como a verificação de colocação usam o meio escolhido e o instante atual da ordem, incluindo se a primeira equipa desse quartel já foi usada.
- Cada meio colocado guarda `dispatchMin`, o minuto atual da ordem (nunca antes da deteção). A ETA é esse minuto + saída + viagem ao ponto ou ao primeiro vértice da linha. Os meios aéreos usam a base e a velocidade de voo.
- A lista mostra a hora prevista, T+ e os minutos que faltam; passa a indicar chegada prevista cumprida quando o relógio a alcança. Avançar o relógio não desloca a ETA de meios já colocados.
- As linhas enviadas ao ELMFIRE e a procura do B usam o mesmo relógio absoluto. O ILS conserva o instante de saída das unidades ao mudar os seus destinos; ordens de momentos diferentes não são agrupadas como se fossem a mesma.
- `npm run deployment:check` cobre a interceção contra uma solução analítica, colocação por fora/por dentro, destino por trás do fogo, saída mais tarde, meios terrestres/aéreos/linhas e ativação das barreiras. `npm run build` e `npm run ils:check -- --update` passam; B continua melhor que A nas duas referências.

## Orientação da linha molhada

- Em **Meios no terreno**, cada meio terrestre num ponto de ataque/proteção tem **Rodar linha**: o deslizador roda a faixa ao vivo de 0° a 179° (0° norte–sul, 90° este–oeste).
- **Auto** repõe a orientação transversal à propagação do fogo. O comprimento, a largura, a quantidade de meios e a ETA mantêm-se ao rodar.
- O ângulo fica no plano (`wetLineBearingDeg`), altera as coordenadas das barreiras enviadas ao ELMFIRE e é conservado na proposta B. A linha que vai crescendo começa nas extremidades rodadas, não nas antigas.
- A orientação não é só um efeito visual: mudar o ângulo torna o plano pendente de nova simulação.
- Antes desta alteração foi feito `git pull` e resolvido o merge de `origin/main` em `031b7f6`: perfis de mapa, mapa de calor, qualidade de renderização e avisos de chegada tardia ficaram integrados com o fluxo ELMFIRE.

## Verificação da rotação no browser (22 out)

- Firefox com WebGL carregou o editor real. Foi reposto um exemplo, rodada uma linha para 45°, usado Auto e aplicado novamente o ângulo manual.
- O cartão de orientação acompanhou o relógio em T+30 e a mudança para BV Vizela.
- O botão de simulação enviou as barreiras reais à API; o eixo da linha de 45° mediu 45,002° no pedido. A e B devolveram `ELMFIRE 2025.0717` numa corrida isolada de 120 min; o B conservou o ângulo escolhido.
- O teste detetou e corrigiu uma falha do worker do ILS (`global is not defined`): o desenho Cesium passou para `stationRingsLayer.ts`, separado dos cálculos puros usados pelo worker. A repetição completa terminou sem erros de consola.
- Build, verificações de geometria/rotação/ETA e regressão ILS passaram. O resultado de Vieira foi A 128,9 ha / B 103,4 ha (dentro da tolerância da referência); Cabeceiras ficou A 477,5 ha / B 158,3 ha.
- O frontend ficou disponível em `http://127.0.0.1:5173/` e a API ELMFIRE confirmou `ready` em `http://127.0.0.1:5181/api/engines`.


## Desempenho, água ilimitada e equipas fora de estrada

- Renderização a pedido: o mapa em pausa deixa de desenhar continuamente. Câmara, relógio, reprodução, tiles e alterações de meios pedem renderização; a qualidade visual mantém-se.
- Dijkstra rodoviário usa um heap em vez de ordenar toda a fila em cada passo; lista e mapa reutilizam a rota. Relógio e resultados novos invalidam a cache. A busca do nó mais próximo inclui o próprio bucket.
- Contornos reutilizam os tempos de viagem por célula; linhas não são recalculadas quando só avança o relógio.
- A API serializa os seus motores entre tarefas e pedidos síncronos, reduzindo a memória de comparações A/B. Isto não modifica nem interrompe os processos de hindcast de outras sessões.
- `unlimitedWater: true` em suppression.json mantém as faixas terrestres eficazes a partir da chegada/conclusão, sem secagem nem pausas de abastecimento. Crescem à taxa de ataque nominal; não há alertas de água. VTTU novos fazem ataque/proteção em vez de abastecimento.
- As faixas usam o contrato original: `path`, `width_m`, `from_min`, sem humidade localizada ou novos parâmetros ELMFIRE. O adapter partilhado mantém-se byte a byte igual ao commit anterior. Não se iniciam novas corridas ELMFIRE para verificar estas alterações.
- Equipas apeadas ficam nas coordenadas clicadas, incluindo os vértices de linhas desenhadas; não são aproximadas às estradas. O ILS também considera terreno para brigadas, mesmo sem acessos rodoviários. Veículos mantêm a aproximação a acessos; mantêm-se as verificações de chegada e de aproximação ao fogo.
- A interface explica a água ilimitada e não mostra rotas rodoviárias fictícias para brigadas. O exemplo deixa o VTTU a proteger o ponto, em vez de reabastecer.
- Uma faixa aberta continua a ter extremidades: o fogo pode contorná-las. As projeções do cenário ELMFIRE também podem saltar faixas. A simplificação mantém a linha eficaz, mas não fecha automaticamente um perímetro nem altera o modelo de projeções partilhado.

## Atraso ao mover o rato e a câmara

- Identificados no histórico do Carlos: `bc8ba676` passou a chamar `scene.pick` em cada movimento para os tooltips de cortes/PMA; `d5cba4fb` acrescentou meios; `f233130a` acrescentou outro raycast de terreno por movimento para as coordenadas. Esse segundo handler foi depois reutilizado pelo mapa de calor em `031b7f6`, mas continuava a procurar terreno mesmo com esse mapa desligado.
- `scene.pick` faz uma passagem de renderização e leitura do framebuffer. Fazê-la sem limite durante um arrasto concorre com a própria renderização da câmara. Agora os dois handlers de hover partilham a mesma política: eventos agrupados em intervalos de 80 ms, sem picking durante botões premidos, movimento/inércia da câmara ou zoom; picking de calor só no perfil de calor, picking de objetos só se existirem entidades do editor.
- Tooltips do mesmo objeto só mudam de posição; o conteúdo é reconstruído quando muda o objeto ou o minuto. Cliques de colocação continuam imediatos, com o handler Cesium existente.
- O despacho multiagência reutiliza o relatório enquanto não mudarem o incêndio, a previsão, o minuto ou os PMA; o HUD não volta a reconstruir um briefing idêntico todos os segundos.
- Os efeitos de chama mais recentes do ramo `origin/feature/flame-resolution-optimization` (`d51cdf8`) não estão neste checkout nem no Vite em execução. A qualidade Nítida com retina, de `031b7f6`, pode continuar a pesar na GPU; mantém-se disponível o perfil Leve nas definições.
- Amostra da máquina: 24 CPUs lógicas, aproximadamente 13 GB de RAM disponível e 60–65 % de CPU idle, embora com trabalhos Python/GDAL/ELMFIRE e atividade de disco em paralelo. É uma amostra, não uma garantia de carga constante; não foram interrompidos esses trabalhos.
- `npm run interaction:check` verifica 500 movimentos → 1 hover, 500 movimentos com botão premido → 0, inércia/zoom/saída do canvas, coordenadas relativas ao canvas, tooltips, invalidação da cache e reutilização do DOM do briefing. Build, colocação e deployment continuam a passar.
- Firefox/WebGL isolado: câmara realmente deslocada com ações nativas, zero picks de hover durante o arrasto e um após estabilizar. Reproduzir 20 chamadas do handler anterior custou cerca de 202 ms; 500 eventos agrupados demoraram 6 ms síncronos, seguidos de um único pick. Os tempos são desse browser de teste e não medem os FPS da sessão do utilizador. A API de simulação foi bloqueada no teste, usando a referência local; o browser foi fechado no fim.
