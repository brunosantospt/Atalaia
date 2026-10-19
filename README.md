# Atalaia

Gêmeo digital de decisão para incêndios rurais. Hack4Guimarães 2035, desafio 2: "Resposta a emergências e incêndios rurais".

O twin simula o mesmo cenário de incêndio sob duas decisões, A e B, com os mesmos dados, o mesmo perímetro inicial e o mesmo motor de propagação. Depois compara área ardida, casas e pessoas ameaçadas, tempos de chegada e estradas cortadas. O mapa CesiumJS é partilhado, com vistas por papel (Câmara, GNR, INEM) e um resumo para o comandante.

## Estrutura (planeada)

| Pasta | O quê |
|---|---|
| `web/` | Front-end CesiumJS (Vite + TypeScript) |
| `api/` | FastAPI: fetchers com cache (a demo corre offline) e `run(scenario)` |
| `engines/` | Adaptadores dos motores: ForeFire (principal), SimFire (fallback), Cell2Fire (probabilidade de queima) |
| `scenarios/` | Cenários em JSON: perímetro, janela meteorológica, ações |
| `scripts/` | Preparação de dados |
| `data/` | Dados brutos e cache, fora do git (ver [data/README.md](data/README.md)) |

## Convenções

- CRS: ETRS89 / PT-TM06 (EPSG:3763) internamente; WGS84 só no Cesium.
- Rasters em COG, vetores em GeoJSON, saídas para o mapa em CZML.
- As simulações partem de um perímetro observado. Um ponto de ignição só serve para incêndios hipotéticos.
