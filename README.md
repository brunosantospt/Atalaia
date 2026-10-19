# Atalaia

Gêmeo digital de decisão para incêndios rurais. Hack4Guimarães 2035, desafio 2: "Resposta a emergências e incêndios rurais".

O twin simula o mesmo cenário de incêndio sob duas decisões, A e B, com os mesmos dados, o mesmo perímetro inicial e o mesmo motor de propagação. Depois compara área ardida, casas e pessoas ameaçadas, tempos de chegada e estradas cortadas. O mapa CesiumJS é partilhado, com vistas por papel (Câmara, GNR, INEM) e um resumo para o comandante.

## Estrutura (planeada)

| Pasta | O quê |
|---|---|
| `web/` | Front-end CesiumJS (Vite + TypeScript) |
| `api/` | FastAPI: fetchers com cache (a demo corre offline) e `run(scenario)` |
| `engines/` | Adaptadores dos motores, atrás de um só contrato ([engines/CONTRACT.md](engines/CONTRACT.md)) e escolhidos nas settings do HUD: ELMFIRE (principal) e SimFire (alternativa). ForeFire só se o ELMFIRE falhar; Cell2Fire para a probabilidade de queima |
| `scenarios/` | Cenários em JSON: perímetro, janela meteorológica, ações |
| `scripts/` | Preparação de dados |
| `data/` | Dados brutos e cache, fora do git (ver [data/README.md](data/README.md)) |

## Convenções

- CRS: ETRS89 / PT-TM06 (EPSG:3763) internamente; WGS84 só no Cesium.
- Camadas de cada incêndio numa grade comum (`web/public/fires/<id>/grid.json`), uma célula por byte ou número; vetores em GeoJSON, saídas para o mapa em CZML.
- As simulações partem de um perímetro observado. Um ponto de ignição só serve para incêndios hipotéticos.
