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
| | P1 Dados dos incêndios | Progressões dos 2 incêndios em GeoJSON + métricas L3 |
| | P2 Replay observado | Os 2 incêndios crescem passo a passo no terreno |
| | P3 Gate do motor | ForeFire roda num teste sintético (senão, SimFire) |
| Ter 20 | P4 Contexto | Grade, combustível e meteo para os 2 incêndios |
| | P5 Contrato + API | FastAPI com `/fires`, `/engines`, `/run` e cache offline |
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
- `scripts/requirements.txt` com fiona, shapely e pyproj.
- **Ref:** `scripts/build-real-fires.py`.
- **Muda:** só estes 2 incêndios; os passos já saem cumulativos; as métricas L3 entram para calibrar.
- **Pronto quando:** a área final bate com o resumo (Vieira ~1969 ha, Cabeceiras ~1825 ha).

### P2 · Replay observado
- Seletor de incêndio, perímetros de cada passo desenhados no terreno e timeline do Cesium (`clock`) com play/pause.
- **Ref:** `src/realFires.ts`, `src/director/outline.ts`.
- **Pronto quando:** dá para ver os 2 incêndios crescer passo a passo.

### P3 · Gate do motor
- `engines/forefire/`: `setup.sh` (venv Python 3.12, `forefire==2.5.0`) e um `adapter.py` que lê um pedido em JSON do stdin e devolve tempos de chegada.
- Teste sintético: grade plana com vento → o fogo alonga a favor do vento.
- Se o ForeFire não rodar até ao fim do dia, passar para o SimFire (`engines/simfire/`).
- **Ref:** `engines/CONTRACT.md`, `engines/forefire/*`, `engines/simfire/*`.
- **Pronto quando:** `engines/forefire/test.sh` passa.

## Fase 1 · Modelo com dados reais (ter 20)

### P4 · Contexto por incêndio
- **Grade única:** `web/public/fires/<id>/grid.json` (origem e `cellM` em EPSG:3763, `nx` e `ny`), lido tanto pelo Python como pelo TypeScript.
- **Combustível:** a COS2015 é rasterizada na grade e mapeada para 5 classes e para Anderson 13 / Scott-Burgan.
- **Meteo:** ERA5 horária via Open-Meteo. Vieira já está em `data/`; para Cabeceiras é preciso buscar 5–8 set 2016.
- **Ref:** `scripts/build-real-fuels.py`, `scripts/build-era5-weather.py`, `engines/fuel_map.json`.
- **Muda:** Cabeceiras passa a ter dados reais (no protótipo usava combustível aleatório). As constantes da grade ficam num só lugar.

### P5 · Contrato + API
- `docs/contracts.md` define o **cenário** (base: perímetro, meteo, combustível; decisões A e B) e o **resultado** (passos, métricas).
- `api/` em FastAPI:
  - `GET /fires`, `GET /engines`;
  - `POST /run`, que lança o adapter do motor no seu próprio venv.
- Cache por hash do cenário em `data/cache/`, para a demo rodar offline.
- **Ref:** o plugin `fireEngines()` em `vite.config.ts`, `engines/CONTRACT.md`.
- **Muda:** FastAPI em vez de plugin do Vite (decisão do Assessment), e a cache é nova.

### P6 · Modelo rápido no browser
- Tempo mínimo de chegada (Dijkstra, 16 vizinhos) com Rothermel simplificado: vento, declive e humidade. Comprimento de chama pela fórmula de Byram.
- Camada de fogo no terreno: textura de tempos de chegada e shader que avança com o relógio.
- Serve para explorar decisões em tempo real. O ForeFire confirma.
- **Ref:** `src/model.ts`, `src/grid.ts`, `src/fireLayer.ts`.
- **Muda:** calibrado com os ROS observados (tabela acima). No protótipo não estava calibrado.

### P7 · Validação
- A partir do perímetro observado num passo, simular até ao passo seguinte (modelo rápido e ForeFire) e calcular o índice de Sørensen contra o observado, para os 2 incêndios.
- Mostrar num painel lado a lado: observado vs simulado.
- **Ref:** `src/replay.ts`.
- **Muda:** os 2 incêndios e resultados calculados na hora (no protótipo eram tabelas congeladas).
- **Pronto quando:** há um Sørensen por passo e por motor. Este número vai para o pitch (técnico, 25%).

## Fase 2 · Decisões (qua 21)

### P8 · Meios e despacho
- `scripts/build_context.py` busca no Overpass os quartéis (`amenity=fire_station`, 100 km), as aldeias e os pontos de água, e no OSRM as rotas dos quartéis mais próximos de cada incêndio. Tudo fica guardado em JSON, para rodar offline.
- Bases aéreas (CMA) com HEBL; frota animada (VCI, VTT, HEBL) com modelos glTF.
- **Ref:**
  - `scripts/build-stations.py`, `scripts/build-fire-context.mjs`;
  - `src/stations.ts`, `src/director/fleet.ts`;
  - `public/data/meios-reais.md` (doutrina DECIR), `scripts/make-models.mjs`.

### P9 · Decisões A/B
- Num passo observado, correr três futuros com o mesmo cenário base: sem intervenção, **A** ataque à cabeça e **B** proteção das aldeias.
- Os meios arrastam-se para o mapa: é o editor de cenários.
- **Métricas:** área ardida, aldeias e casas atingidas (edifícios reais do OSM, `building=*`), estradas cortadas e tempo de chegada a cada aldeia.
- Recomendação: a decisão que atinge menos aldeias e, em empate, a que deixa arder menos área. O ForeFire confirma a decisão escolhida.
- **Ref:** `src/director/decisions.ts`, `src/scenarios.ts`, `src/director/context.ts`, `src/units.ts`.
- **Muda:** casas reais em vez de sintéticas, e confirmação pelo motor físico.

## Fase 3 · Demo (qui 22)

### P10 · Modo realizador
- História guiada para os 90 s da demo: ignição → replay observado → ponto de decisão → A vs B → resultado.
- Planos de câmara, HUD e legendas.
- **Ref:** `src/director/*` (não o `directorV1`).

### P11 · Resumo ao comandante
- Resumo em linguagem natural da comparação A/B, gerado pela API do Claude a partir das métricas.
- Se der tempo, vistas por papel: Câmara, GNR, INEM.
- Peça nova; não existe no protótipo.

---

## Fica de fora

- `directorV1`, `demo-fire.czml`, os cenários sintéticos C1/C2 e o fogo aleatório da sandbox.
- Cell2Fire (mapa de probabilidade de queima): só se sobrar tempo depois do freeze.
- SimFire: só como plano B do P3.

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
- **Dados sintéticos no protótipo:** aldeias, casas e frota por quartel; meteo e combustível só para Vieira.
- **Serviços externos:** Overpass, OSRM e Open-Meteo só em scripts, com o resultado guardado. O app em demo não depende de rede, exceto o terreno do Cesium.
