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
| Ter 20 | P4 Contexto | Grade, combustível e meteo para os 2 incêndios |
| | P5 Contrato + API | FastAPI com `/fires`, `/engines`, `/run`, cache offline e aba de settings para escolher o motor |
| | P6 Modelo rápido | Propagação no browser, desenhada no terreno |
| | P7 Validação | Sørensen simulado vs observado, por passo e por motor |
| Qua 21 | P8 Meios e despacho | Quartéis reais, rotas, frota animada |
| | P9 Decisões A/B | Mesmo cenário, duas decisões, métricas e recomendação |
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
O motor principal é o **ELMFIRE** (level set, Rothermel na superfície, fogo de copas e projeções). Os outros motores ficam atrás do mesmo contrato e escolhem-se na aba de settings (P5).

- `engines/elmfire/`:
  - `setup.sh`: descarrega o ELMFIRE numa versão fixa para `engines/elmfire/vendor/` (fora do git) e compila-o com gfortran e Open MPI (Homebrew), mais um venv para o adapter;
  - `adapter.py`: lê um pedido em JSON do stdin, escreve os rasters de entrada (combustível, declive, exposição, copas, vento, humidades) e o `elmfire.data`, corre o ELMFIRE e devolve os tempos de chegada lidos do raster de saída.
- Teste sintético: grade plana, combustível uniforme e vento constante → o fogo alonga a favor do vento.
- Primeiro risco a fechar: a compilação no macOS (arm64), porque o ELMFIRE é desenvolvido em Linux. Se não compilar, tentar num contentor Linux; as unidades das entradas confirmam-se no tutorial de vento constante do próprio ELMFIRE.
- Se o ELMFIRE não rodar até ao fim do dia, passar para o ForeFire (`engines/forefire/`, venv Python 3.12 com `forefire==2.5.0`).
- **Ref:** `engines/CONTRACT.md` e `engines/forefire/*` para a forma do adapter. O ELMFIRE é novo: não existe no protótipo.
- **Pronto quando:** `engines/elmfire/test.sh` passa.

## Fase 1 · Modelo com dados reais (ter 20)

### P4 · Contexto por incêndio
- **Grade única:** `web/public/fires/<id>/grid.json` (origem e `cellM` em EPSG:3763, `nx` e `ny`), lido tanto pelo Python como pelo TypeScript.
- **Combustível:** a COS2015 é rasterizada na grade e mapeada para 5 classes e para Anderson 13 / Scott-Burgan (o ELMFIRE usa os modelos de Scott & Burgan).
- **Meteo:** ERA5 horária via Open-Meteo. Vieira já está em `data/`; para Cabeceiras é preciso buscar 5–8 set 2016.
- **Ref:** `scripts/build-real-fuels.py`, `scripts/build-era5-weather.py`, `engines/fuel_map.json`.
- **Muda:** Cabeceiras passa a ter dados reais (no protótipo usava combustível aleatório). As constantes da grade ficam num só lugar.

### P5 · Contrato + API
- `docs/contracts.md` define o **cenário** (base: perímetro, meteo, combustível; decisões A e B) e o **resultado** (passos, métricas).
- `api/` em FastAPI:
  - `GET /fires`, `GET /engines`;
  - `POST /run`, que lança o adapter do motor no seu próprio venv.
- **Aba de settings** no HUD: lista os motores de `GET /engines` (modelo rápido no browser, ELMFIRE e, se passar o gate, ForeFire), com o estado de cada um (pronto, não instalado). O motor escolhido fica guardado e é o que corre na validação (P7) e nas decisões (P9).
- Cache por hash do cenário em `data/cache/`, para a demo rodar offline.
- **Ref:** o plugin `fireEngines()` em `vite.config.ts`, `engines/CONTRACT.md`.
- **Muda:** FastAPI em vez de plugin do Vite (decisão do Assessment), e a cache é nova.

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

## Fase 2 · Decisões (qua 21)

### P8 · Meios e despacho
- `scripts/build_context.py` busca no Overpass as aldeias e os pontos de água, e no OSRM as rotas dos quartéis mais próximos de cada incêndio (os quartéis já vêm do P1). Tudo fica guardado em JSON, para rodar offline.
- A distância dos quartéis no HUD passa de linha reta a estrada, com tempo de chegada.
- Bases aéreas (CMA) com HEBL; frota animada (VCI, VTT, HEBL) com modelos glTF.
- **Ref:**
  - `scripts/build-stations.py`, `scripts/build-fire-context.mjs`;
  - `src/stations.ts`, `src/director/fleet.ts`;
  - `public/data/meios-reais.md` (doutrina DECIR), `scripts/make-models.mjs`.

### P9 · Decisões A/B
- Num passo observado, correr três futuros com o mesmo cenário base: sem intervenção, **A** ataque à cabeça e **B** proteção das aldeias.
- Os meios arrastam-se para o mapa: é o editor de cenários.
- **Métricas:** área ardida, aldeias e casas atingidas (edifícios reais do OSM, `building=*`), estradas cortadas e tempo de chegada a cada aldeia.
- Recomendação: a decisão que atinge menos aldeias e, em empate, a que deixa arder menos área. O motor físico escolhido nas settings confirma a decisão escolhida.
- **Ref:** `src/director/decisions.ts`, `src/scenarios.ts`, `src/director/context.ts`, `src/units.ts`.
- **Muda:** casas reais em vez de sintéticas, e confirmação pelo motor físico.

## Fase 3 · Demo (qui 22)

### P10 · Modo realizador
- História guiada para os 90 s da demo: ignição → replay observado → ponto de decisão → A vs B → resultado.
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
- SimFire: só como último recurso do P3, se nem o ELMFIRE nem o ForeFire rodarem.

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
