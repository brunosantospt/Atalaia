# Plano de construção · Atalaia

Simulador 3D em CesiumJS de dois incêndios reais do PT-FireSprd (**Vieira do Minho, 10 ago 2016** e **Cabeceiras de Basto, 6 set 2016**). Tem um modelo de propagação validado contra o observado e uma comparação de decisões A/B.

## Como reconstruímos

O protótipo `HACK4/twin-sandbox` foi feito antes do evento, por isso não entra neste repo. Cada peça abaixo indica onde olhar no protótipo para relembrar decisões e armadilhas. O código é escrito de novo, já na estrutura do Atalaia.

- Nada de copiar arquivos nem blocos de código do protótipo.
- Dados derivados (GeoJSON, meteo, combustível, rotas) são regenerados pelos scripts novos a partir dos dados brutos em `data/`.
- Cada peça fecha com o app rodando, num ou mais commits pequenos.

## Visão geral

| Dia | Peça | Entrega |
|---|---|---|
| Seg 19 | P0 Base web | Globo Cesium com relevo sobre Guimarães |
| | P1 Dados dos incêndios | Progressões dos 2 incêndios em GeoJSON + métricas L3 + quartéis de bombeiros |
| | P2 Replay observado | Os 2 incêndios contados passo a passo: câmara guiada, HUD "intel" cinza, spotlight e quartéis próximos com km |
| | P3 Gate do motor | ELMFIRE roda num teste sintético (senão, ForeFire) |
| Ter 20 | P4 Contexto | Grade, combustível, relevo e meteo para os 2 incêndios |
| | P5 Contrato + API | FastAPI com `/api/fires`, `/api/engines`, `/api/run` e cache offline; as settings leem os motores da API |
| | P6 Modelo rápido | Propagação no browser, desenhada no terreno |
| | P7 Validação | Sørensen simulado vs observado, por passo e por motor |
| Qua 21 | P8 Meios e despacho | Quartéis reais, rotas, frota animada |
| | P9 Decisões A/B | Mesmo cenário: plano do comandante (A) vs plano otimizado pelo ILS (B), métricas e recomendação |
| Qui 22 | P10 Modo realizador | Os 90 s da demo, guiados |
| | P11 Resumo ao comandante | Resumo da comparação A/B gerado por LLM |
| | **Feature freeze** | |
| Sex 23 | Fecho | Só correções, cache aquecida, ensaio. Submeter até ~13:00 (lock 17:30) |

## Dados observados (PT-FireSprd L3)

Servem para calibrar o modelo (P6) e validar (P7). Os dois incêndios são de 2016, portanto existem na v1 (ESSD 2023, publicada): citar a v1.

| Incêndio | Período | Início → fim | Área | ROS | Direção de propagação |
|---|---|---|---|---|---|
| Vieira do Minho | 1 | 10/08 10:00 → 15:00 | 705 ha | 875 m/h | 248° (WSW) |
| | 2 | 15:00 → 11/08 03:30 | 866 ha | 254 m/h | 263° (W) |
| | 3 | → 08:30 | 49 ha | sem hora de início | |
| Cabeceiras de Basto | 1 | 06/09 04:00 → 13:30 | 576 ha | 292 m/h | 331° (NNW) |
| | 2 | 13:30 → 07/09 00:30 | 665 ha | 311 m/h | 35° (NE) |
| | 3 | 00:30 → 12:30 | 91 ha | 53 m/h | 114° (ESE) |

Cabeceiras de Basto tem um segundo foco às 13:30 (`z` com `zp_link` 2) e uma viragem de vento de NNW para NE.

---

## Fase 0 · Fundação (seg 19)

### P0 · Base web
- `web/`: Vite + TypeScript + Cesium. Token do ion em `.env` (`VITE_CESIUM_ION_TOKEN`, com `.env.example`).
- Cesium World Terrain e câmara inicial sobre a Penha.
- **Ref:** `vite.config.ts` (cópia dos assets do Cesium), início de `src/main.ts` (setup do viewer).
- **Pronto quando:** `npm run dev` mostra o globo com relevo sobre Guimarães.

### P1 · Dados dos incêndios
- `scripts/build_fires.py <fire_id>` lê o L1 (polígonos) e o L3 (métricas por período) e escreve em `web/public/fires/<id>/`:
  - `progression.geojson`: perímetro **cumulativo** por passo, em WGS84;
  - `fire.json`: nome, concelho, ignição, passos, bbox e as métricas L3 da tabela acima.
- **Quartéis de bombeiros:**
  - `scripts/fetch_stations.py` pergunta ao Overpass por `amenity=fire_station` em Portugal (fronteira do OSM, para cortar a Galiza), num raio de 100 km da Penha, e guarda a resposta crua em `data/osm-fire-stations/raw.json`;
  - `scripts/build_stations.py` limpa e escreve `web/public/stations.json` (nome, nome curto, tipo, lat/lon, id OSM).
- `scripts/requirements.txt` com pyshp, shapely, pyproj e xlrd. O pyshp lê shapefiles sem GDAL, por isso instala de wheels no Python 3.14 (o fiona não tem wheel e não compila sem GDAL).
- **Ref:** `scripts/build-real-fires.py`, `scripts/build-stations.py`.
- **Muda:** só estes 2 incêndios; os passos já saem cumulativos; as métricas L3 entram para calibrar. Os quartéis chegam já no P1 (no plano anterior só vinham no P8), porque o replay do P2 os mostra.
- **Pronto quando:**
  - a área final bate com o resumo (Vieira ~1969 ha, Cabeceiras ~1825 ha);
  - `stations.json` não tem duplicados nem quartéis da Galiza.

### P2 · Replay observado, passo a passo
Cada incêndio é contado como uma sequência de planos de câmara. É a base do modo realizador (P10), que depois só acrescenta planos.

- **Câmara passo a passo** (do Director v1):
  - lista de planos derivada só do `fire.json`: visão geral a pique (com os quartéis), ignição, um plano por passo observado, voo ao longo do eixo de propagação e balanço final;
  - cada plano enquadra a área em jogo (bbox das cabeças até esse passo, com margem) a partir do eixo de propagação;
  - a câmara orbita um alvo que se move: alvo, rumo e inclinação seguem uma curva Catmull-Rom entre poses, e a distância interpola em escala log (um zoom de 40 km → 3 km fica uniforme);
  - o relógio do incêndio avança com a câmara, e cada plano revela o seu marcador numerado (ignição, passos);
  - controlo: espaço play/pausa, ←/→ plano anterior/seguinte, R recomeça, H esconde o HUD. O rato fica livre entre planos.
- **Estilo "intel" em cinza** (o visual do God's Eye do Director v1, sem o ciano):
  - texto mono em maiúsculas, cantos de mira, grelha de terços, vinheta e scanlines discretas;
  - palavra grande do plano (IGNIÇÃO, PROPAGAÇÃO, BALANÇO), local e coordenadas por baixo;
  - canto superior direito: `REPLAY` + hora do incêndio, T+ e hectares, `PASSO n/N`;
  - canto inferior esquerdo: PT-TM06 (EPSG:3763) e graus/minutos/segundos do centro do ecrã; na lateral, rumo, inclinação e distância da câmara;
  - cartão de legenda (`PLANO 02/07 · …`) e barra de transporte com um traço por plano e o seletor de incêndio;
  - paleta de cinzas neutros para o HUD; o âmbar fica reservado ao fogo, para que o fogo seja a única cor forte;
  - imagem de satélite escurecida e dessaturada, espaço preto, sem sol nem lua, e luz fixa de NW a 35° (sombreamento cartográfico).
- **Spotlight** (do Director): pós-processamento sobre o depth buffer que escurece e dessatura tudo o que fica fora de um raio à volta da área em jogo, céu incluído. Cada plano aponta o foco (centro e raio ~1,25 × meia diagonal do enquadramento), e o foco desliza junto com a câmara.
- **Quartéis próximos com km** (do Director v1): os 3 quartéis mais próximos da ignição, até 20 km, como marcadores no terreno com etiqueta `BV CABECEIRAS DE BASTO · 6 KM`. Distância em linha reta; no P8 passa a ser por estrada.
- **Marcadores:** anéis no terreno e etiquetas em HTML sobre o canvas, ligados por linha de chamada. As etiquetas ficam do lado oposto ao centro do ecrã e afastam-se na vertical para nunca se sobreporem.
- **Ref:**
  - `src/directorV1/shots.ts` (gramática dos planos), `camera.ts` (órbita), `director.ts` (leitor de planos e teclado);
  - `src/directorV1/hud.ts`, `director.css`, `markers.ts`, `pttm06.ts`; a função `nearestStations` em `story.ts`;
  - `src/director/spotlight.ts`; `src/realFires.ts`, `src/director/outline.ts`.
- **Muda:**
  - HUD em cinza em vez de ciano;
  - o spotlight do Director junta-se à câmara do Director v1 (no protótipo estavam em páginas diferentes);
  - os dados vêm do `fire.json` do P1;
  - só o modo observado; o simulado entra com o P6 e o A/B com o P9.
- **Pronto quando:** os 2 incêndios tocam do início ao fim; cada plano enquadra o seu passo com o spotlight, e os quartéis aparecem com a distância em km.

### P3 · Gate do motor
O motor principal é o **ELMFIRE** (level set, Rothermel na superfície, fogo de copas e projeções). O SimFire é a alternativa, atrás do mesmo contrato; os dois escolhem-se nas settings do HUD.

- `engines/CONTRACT.md`: pedido e resultado em JSON, comuns a todos os motores.
- `engines/elmfire/`:
  - `setup.sh`: descarrega o ELMFIRE 2025.0717 (commit fixo) para `vendor/` (fora do git) e constrói a imagem Docker `atalaia/elmfire` (Ubuntu 24.04, gfortran, Open MPI, GDAL);
  - `run.sh`: corre o `adapter.py` dentro do contentor. O adapter escreve os rasters de entrada e o `elmfire.data`, corre o ELMFIRE e devolve os tempos de chegada;
  - `test.sh`: o teste sintético.
- Teste sintético: grade plana, combustível uniforme e vento constante, de oeste e de norte → o fogo alonga a favor do vento.
- **Docker em vez de compilar no macOS:** o ELMFIRE só suporta Linux e chama o GDAL em runtime; no Mac não havia gfortran, Open MPI nem GDAL utilizáveis.
- **Patch** (`patches/level-set-null-pointer.patch`): na 2025.0717 um ponteiro é libertado sem nunca ter sido associado, e em arm64 o ELMFIRE aborta no primeiro passo. O `main` do ELMFIRE já o inicializa da mesma forma.
- **Unidades confirmadas** no tutorial de vento constante do ELMFIRE: 1563 ha pelo adapter contra 1559 ha no tutorial. Para lá chegar, o adapter fixa `WSMFEFF_LOW_MULT = 60/5280`: a razão comprimento/largura de Anderson espera o vento em mph, como no FARSITE e nos tutoriais, e o valor por omissão dá uma área ardida 2,5× maior.
- `engines/simfire/`: SimFire 2.0.1 atrás do mesmo contrato, com o mesmo teste sintético, mais um de declive e um que compara o ciclo do adapter com o do SimFire. Passa, e o SimFire está pronto nas settings. No caso sintético arde quase 3× mais do que o ELMFIRE (30 ha contra 11 ha), a rever com os incêndios reais (P7).
- Se o ELMFIRE deixar de rodar, passar para o ForeFire (`engines/forefire/`, venv Python 3.12 com `forefire==2.5.0`).
- **Ref:** `engines/forefire/*` no protótipo para a forma do adapter. O ELMFIRE é novo: não existe no protótipo.
- **Pronto quando:** `engines/elmfire/test.sh` passa. ✅

## Fase 1 · Modelo com dados reais (ter 20)

### P4 · Contexto por incêndio
Tudo em `web/public/fires/<id>/`, lido tanto pelo Python como pelo TypeScript.

- **Grade única** (`grid.json`, `scripts/build_grid.py`):
  - células de 30 m em PT-TM06 (EPSG:3763), sobre toda a área ardida mais 3 km de margem, para uma decisão poder deixar o fogo ir mais longe;
  - Vieira tem 499 × 334 células (15 × 10 km), Cabeceiras 450 × 434 (13,5 × 13 km);
  - as seis primeiras chaves são o `grid` do contrato dos motores e entram num pedido tal como estão;
  - `wgs84` traz os quatro cantos para o browser, que interpola entre eles com menos de 4 m de erro.
- **Combustível** (`fuel.u8` e `fuel.json`, `scripts/build_fuel.py`):
  - a COS2015 é rasterizada na grade pelo centro de cada célula: um byte por célula, índice na legenda;
  - cada classe COS tem duas leituras do mesmo combustível, com a razão de cada escolha: 5 classes (modelo rápido e mapa) e Scott & Burgan, o código que vai a todos os motores;
  - o SimFire só conhece os 13 modelos de Anderson e converte o código Scott & Burgan no seu adapter, com a tabela de equivalência de Scott & Burgan 2005 (RMRS-GTR-153). Antes, o `fuel.json` também trazia um Anderson 13 escolhido à mão, que o SimFire nunca recebia e que divergia da conversão em 4 classes, incluindo o pinhal-bravo: saiu, para haver uma só fonte;
  - dentro da área ardida, cerca de metade é mato.
- **Relevo** (`elevation.f32`, `slope.u8`, `aspect.u16` e `terrain.json`, `scripts/fetch_dem.py` e `scripts/build_terrain.py`):
  - Copernicus DEM GLO-30 (1″, cerca de 23 × 31 m aqui), reamostrado bilinearmente para a grade. Cabeceiras atravessa o meridiano 8° W e junta dois tiles;
  - declive e exposição pelo método de Horn, como nos rasters do LANDFIRE que o ELMFIRE lê. A exposição é para onde a encosta desce (0 = norte): no ELMFIRE, com 180°, o fogo sobe para norte;
  - a altitude da ignição bate com a do Open-Meteo a 6 m (Vieira 652 contra 656 m, Cabeceiras 719 contra 725 m);
  - em Vieira o fogo seguiu o vento, não a subida. No período 3 de Cabeceiras, de noite e sem vento, desceu devagar uma encosta de 30° (90 ha em 12 h);
  - é um modelo de superfície: em floresta fica em parte sobre as copas.
- **Meteo** (`weather.json`, `scripts/fetch_weather.py` e `scripts/build_weather.py`):
  - ERA5 horária via Open-Meteo, de 3 dias antes a 1 dia depois de cada incêndio, no ponto da ignição;
  - o vento do ERA5 bate com a direção de propagação observada em Vieira (13° e 3° de desvio) e nos períodos 2 e 3 de Cabeceiras;
  - no período 1 de Cabeceiras, com vento fraco, o fogo andou 70° ao lado do vento. O relevo também não o explica: ali a encosta sobe em média para ENE e o fogo foi para NO. Fica para os motores (P7) ver se é um vento local de vale, que o ERA5, a 25 km, não vê.
- **Ref:** `scripts/build-real-fuels.py`, `scripts/build-era5-weather.py`, `engines/fuel_map.json`.
- **Muda:**
  - Cabeceiras passa a ter dados reais (no protótipo usava combustível aleatório);
  - a grade é métrica, em PT-TM06, e as suas constantes ficam num só lugar.
- **Pronto quando:** os 2 incêndios têm grade, combustível, relevo e meteo. ✅
- **A seguir:**
  - humidades dos combustíveis, estimadas a partir da temperatura e da humidade relativa;
  - a meteo horária entra no contrato dos motores com o cenário (P5).

### P5 · Contrato + API
- `docs/contracts.md` define o **cenário** e o **resultado**:
  - o cenário é um incêndio, o passo observado de onde partir, quanto tempo correr, as humidades e uma decisão (faixas onde nada arde a partir de um minuto);
  - o resultado traz os tempos de chegada na grade do incêndio, a área ardida a cada hora e a chave da cache.
- `api/` em FastAPI, em `http://127.0.0.1:5181`:
  - `GET /api/fires`, `GET /api/engines` e `POST /api/run`;
  - `setup.sh` cria o venv uma vez, `serve.sh` corre a API e `test.sh` é o teste do P5;
  - o Vite passa `/api` para a API, por isso a web pede sempre ao mesmo sítio;
  - os motores correm no Docker pelo `run.sh` de cada um, e não num venv: é assim desde o P3;
  - a API arranca-se à mão com `api/serve.sh`, porque o launcher do preview não pode correr nada em `~/Documents` (permissões do macOS).
- **O que a API junta ao cenário:**
  - a grade, o combustível, o relevo e a meteo do P4. O vento entra de 30 em 30 minutos e roda pelo lado mais curto;
  - os focos que aparecem depois do início, como ignições no minuto deles;
  - as faixas, como combustível 91. Uma faixa com `from_min` parte a corrida nesse minuto, e o troço seguinte parte do que já ardeu.
- **Humidades:** por agora entram no cenário, iguais em toda a grade e durante toda a corrida: 6/8/10 nas mortas e 60/90 nas vivas, um verão seco. Mais tarde passam a vir da meteo de cada hora.
- **Settings:** o painel do HUD (botão Settings ou tecla S) tem o incêndio e o motor.
  - A lista de motores vem de `GET /api/engines` sempre que o painel abre, com o estado de cada um: Pronto, Não instalado (falta `setup.sh`) ou Docker desligado.
  - Com a API desligada não há motores, e uma nota diz para correr `api/serve.sh`.
  - A escolha fica guardada no browser e é a que corre na validação (P7) e nas decisões (P9). Junta-se o modelo rápido no browser (P6).
- **Cache** em `data/cache/` (fora do git). A chave cobre o cenário, os ficheiros do incêndio e o código do motor e da API. É lida antes de se ver o motor, por isso uma corrida feita uma vez volta sem o Docker, e a demo roda offline.
- **Primeiras corridas**, do perímetro observado no passo 0 até ao passo 1:

  | Incêndio | Observado | ELMFIRE | SimFire |
  |---|---|---|---|
  | Vieira do Minho, 10:00 → 15:00 | 705,6 ha | 154,8 ha (1,7 s) | 3343,0 ha (26,4 s) |
  | Cabeceiras de Basto, 04:00 → 13:30 | 592,6 ha | 298,3 ha (2,2 s) | 2968,0 ha (41,2 s) |

  - O ELMFIRE fica entre um quinto e metade do observado, e o SimFire chega a quase 5 vezes. Calibrar fica para o P7.
  - Uma faixa de 60 m num anel a 500 m do perímetro de Vieira segura nos dois motores, em 2 h: no ELMFIRE, 65,4 ha passam a 41,1 ha; no SimFire, 1426,0 ha passam a 84,2 ha. A mesma faixa só a partir das 11:00 já chega tarde: 61,6 ha no ELMFIRE e 1436,8 ha no SimFire. É este o tipo de comparação das decisões A e B (P9).
  - O SimFire escolhe o passo de tempo pelo fogo mais rápido em toda a corrida. Por isso o mesmo minuto muda uns % com a duração: em Vieira, o minuto 60 tem 669,1 ha numa corrida de 300 min e 687,9 ha numa de 120 min. No P7, cada corrida vai até ao passo seguinte.
- **Ref:** o plugin `fireEngines()` em `vite.config.ts`, `engines/CONTRACT.md`.
- **Muda:**
  - FastAPI em vez de plugin do Vite (decisão do Assessment);
  - os motores correm em contentores, não em venvs;
  - a cache e as faixas com hora são novas.
- **Pronto quando:** `api/test.sh` passa. ✅
- **A seguir:** humidades dos combustíveis por hora, estimadas a partir da temperatura e da humidade relativa (`scripts/build_moisture.py`).

### P6 · Modelo rápido no browser
- Tempo mínimo de chegada (Dijkstra, 16 vizinhos) com Rothermel simplificado: vento, declive e humidade. Comprimento de chama pela fórmula de Byram.
- Camada de fogo no terreno: textura de tempos de chegada e shader que avança com o relógio.
- Serve para explorar decisões em tempo real. O motor escolhido nas settings (ELMFIRE por omissão) confirma.
- **Ref:** `src/model.ts`, `src/grid.ts`, `src/fireLayer.ts`.
- **Muda:** calibrado com os ROS observados (tabela acima). No protótipo não estava calibrado.

### P7 · Validação
- A partir do perímetro observado num passo, simular até ao passo seguinte (modelo rápido e ELMFIRE) e calcular o índice de Sørensen contra o observado, para os 2 incêndios.
- Mostrar num painel lado a lado: observado vs simulado.
- **Ref:** `src/replay.ts`.
- **Muda:** os 2 incêndios e resultados calculados na hora (no protótipo eram tabelas congeladas).
- **Pronto quando:** há um Sørensen por passo e por motor. Este número vai para o pitch (técnico, 25%).
- **Hindcast com os registos oficiais** (`hindcast/`): o ELMFIRE com a ficha do SGIF, as cicatrizes, os combustíveis portugueses e as linhas de ataque inferidas, com Sørensen por passo, contra o perímetro oficial e contra os focos de satélite. Em Vieira o Sørensen do último passo vai de 0,73 (como a API) a 0,76–0,79 só com dados (combustíveis, cicatrizes, seca, projeções; 3 sementes), e a 0,84–0,85 com as linhas inferidas a segurar antes do fogo do modelo; as linhas estão traçadas ao longo do perímetro final, por isso parte do ganho é por construção. O vento do CERRA e do relevo (ramo `feature/cerra-wind-engine`) fica dentro do ruído das sementes. Ver `hindcast/README.md`.

## Fase 2 · Decisões (qua 21)

### P8 · Meios e despacho
- `scripts/build_context.py` busca no Overpass as aldeias e os pontos de água, e no OSRM as rotas dos quartéis mais próximos de cada incêndio (os quartéis já vêm do P1). Tudo fica guardado em JSON, para rodar offline.
- A distância dos quartéis no HUD passa de linha reta a estrada, com tempo de chegada.
- Bases aéreas (CMA) com HEBL; frota animada (VCI, VTT, HEBL) com modelos glTF.
- **Inventário por quartel:** `scripts/build_inventory.py` escreve `web/public/inventory.json`, uma entrada por id de `stations.json` com `tier`, `source`, `municipality`, `personnel {total, onDuty}`, `units {vfci, vttu, vlci, vrci}` e `decir {ecin, eip}`, mais `_meta` (data, edição da CAOP, ano do INE, tabela de tiers). O concelho de cada quartel vem da CAOP (Carta Administrativa Oficial de Portugal, DGT, CAOP2025, CC BY 4.0; `scripts/fetch_caop.py` descarrega o GeoPackage para `data/caop/`): ponto-em-polígono na camada de municípios, com a correspondência por nome só como verificação (as discordâncias saem no terminal e a geografia ganha). Efetivos do INE por concelho (dados.gov.pt "Bombeiros (N.º)", CC BY 4.0) divididos por todos os quartéis do concelho; viaturas e equipas por tier, assumidas; concelho sem valor no INE fica com `personnel.total: null` (hoje nenhum: 171 quartéis em 94 concelhos).
- Correções manuais com fonte em `scripts/data/inventory-overrides.json` (chave = id do quartel, `source` com URL obrigatório; a entrada sai como `manual:<url>`, as restantes como `estimate:ine-<ano>+tier`). O concelho não se substitui: vem sempre da CAOP.
- **Distrito de Braga com viaturas reais:**
  - Os 21 quartéis da Tabela 41 de Matos (2025), tese de doutoramento da UMinho (hdl 1822/97938, CC BY-NC-SA 4.0), entram como overrides com `vehicles` (letra → litros): 113 viaturas, 240 400 L.
  - As contagens de `units` saem dos litros: até 1000 L é vlci, até 6000 L vfci, acima vttu. A tese não dá o tipo.
  - Os efetivos continuam a ser estimativa do INE.
  - A secção de Ruivães fica sem viaturas, porque a tese conta o corpo de Vieira do Minho uma só vez.
  - Fragoso (Barcelos) não está na tabela e fica com a estimativa por tier.
  - O ledger e o stock do editor dizem "Matos 2025" onde a viatura é real.
- **Ref:**
  - `scripts/build-stations.py`, `scripts/build-fire-context.mjs`;
  - `src/stations.ts`, `src/director/fleet.ts`;
  - `public/data/meios-reais.md` (doutrina DECIR), `scripts/make-models.mjs`.

### P9 · Decisões A/B
- Num passo observado, correr três futuros com o mesmo cenário base: sem intervenção, **A** o plano do comandante e **B** o plano otimizado.
- **A · plano do comandante.** Os meios arrastam-se para o mapa: é o editor de cenários. Por omissão, o plano de doutrina (ataque à cabeça).
- **B · plano otimizado.** Proposto pelo ILS de Mendes & Alvelos (EJOR 2023), a meta-heurística sugerida pelos orientadores, com os mesmos meios disponíveis que o A. Formulação e mapeamento em `docs/ils.md`.
  - **Solução:** um ponto de acesso na estrada (`context.access`) para cada meio. Um ponto só vale se o meio lá chega antes do fogo.
  - **Construir:** cada meio vai para um ponto sorteado entre os próximos a arder, repetido muitas vezes; fica a melhor construção. O A entra também como solução inicial, com as linhas que tiver (o ILS não mexe nelas), por isso o B nunca fica pior que o A no modelo rápido.
  - **Melhorar:**
    - pesquisa local: mover um meio para um ponto vizinho e ficar com o melhor movimento, até não haver ganhos;
    - perturbação: tirar, acrescentar ou mover 3–5 meios, e voltar à pesquisa local; só se aceita se melhorar.
  - **Avaliar:** `simulate()` + `makeReport()`. Conta primeiro as aldeias atingidas, depois a área ardida e por fim o número de meios.
  - **Onde corre:** num Web Worker, `src/optimize.ts`, com um orçamento de ~10 s. O editor mostra a melhor solução até ao momento e o número de planos testados.
  - **Tempo de cálculo** (medido a 20 out, neste Mac, simulação + relatório a 6 h, mediana de 200 corridas):
    - Vieira: 3–4 ms;
    - Cabeceiras: ~2 ms.

    Cabem ~2–5 mil planos em 10 s.
  - **Fora:** o ILS não escolhe a tarefa nem desenha linhas. Os meios terrestres seguram a zona onde ficam e os aéreos fazem descargas.
- **Métricas:** área ardida, aldeias e casas atingidas (edifícios reais do OSM, `building=*`), estradas cortadas e tempo de chegada a cada aldeia.
- **Recomendação:**
  - a decisão que atinge menos aldeias e, em empate, a que deixa arder menos área;
  - o B mostra o que mudou em relação ao A (que meio foi para onde) e o que isso poupa;
  - o motor físico escolhido nas settings confirma os dois planos.
- **Ref:** `src/director/decisions.ts`, `src/scenarios.ts`, `src/director/context.ts`, `src/units.ts`.
- **Muda:**
  - casas reais em vez de sintéticas;
  - confirmação pelo motor físico;
  - o B deixa de ser desenhado à mão e passa a ser proposto pelo ILS.

## Fase 3 · Demo (qui 22)

### P10 · Modo realizador
- História guiada para os 90 s da demo: ignição → replay observado → ponto de decisão → plano do comandante (A) vs plano otimizado (B) → resultado.
- Reaproveita o leitor de planos, o HUD e o spotlight do P2; acrescenta os planos de decisão, despacho e confronto A/B.
- **Ref:** `src/director/*` (planos de decisão e frota).

### P11 · Resumo ao comandante
- Resumo em linguagem natural da comparação A/B, gerado pela API do Claude a partir das métricas.
- Se der tempo, vistas por papel: Câmara, GNR, INEM.
- Peça nova; não existe no protótipo.

---

## Fica de fora

- O `directorV1` como página à parte e o seu fumo de partículas: do v1 só entram o estilo (em cinza), a câmara passo a passo e os quartéis com km, todos no P2.
- `demo-fire.czml`, os cenários sintéticos C1/C2 e o fogo aleatório da sandbox.
- Cell2Fire (mapa de probabilidade de queima): só se sobrar tempo depois do freeze.

## Lições do protótipo

- **PT-FireSprd:** o L1 vem em EPSG:32629 (UTM 29N), não em PT-TM06. Os polígonos são incrementos disjuntos (`z` ignição, `p` passo, `a` sem hora), não perímetros cumulativos.
- **ForeFire 2.5.0:** dá segfault com vento passado diretamente. Injetar o vento por basis layers.
- **SimFire:**
  - o sinal do declive vem invertido upstream;
  - o manager original é lento (181 s); vetorizado com numpy fica em ~5 s.
- **Cell2Fire:** precisa de patch para várias ignições, e o setup assume macOS com Homebrew.
- **Duplicações:**
  - as constantes da grade e os raios das unidades estavam em TS e em Python;
  - a lista de quartéis era carregada duas vezes.
  - → um só lugar para cada uma.
- **Quartéis no OSM:**
  - a mesma corporação aparece como nó e como área, e há secções: deduplicar por nome normalizado e proximidade;
  - o raio de 100 km apanha quartéis da Galiza e entradas que não são quartéis (CMA, Cruz Vermelha, Proteção Civil): filtrar;
  - os nomes oficiais são longos ("Associação Humanitária dos Bombeiros Voluntários de …"): abreviar para `BV …` nas etiquetas.
- **Spotlight:** o depth buffer do Cesium é logarítmico; a posição de cada pixel recupera-se com `czm_windowToEyeCoordinates`.
- **Dados sintéticos no protótipo:** aldeias, casas e frota por quartel; meteo e combustível só para Vieira.
- **Serviços externos:** Overpass, OSRM e Open-Meteo só em scripts, com o resultado guardado. O app em demo não depende de rede, exceto o terreno do Cesium.
