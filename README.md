# Atalaia

Gêmeo digital de decisão para incêndios rurais. Hack4Guimarães 2035, desafio 2: "Resposta a emergências e incêndios rurais" (vencedor do desafio).

O Atalaia simula o mesmo incêndio sob duas decisões, A e B, com os mesmos dados, o mesmo perímetro inicial e o mesmo motor de propagação, e compara área ardida, casas e pessoas ameaçadas, tempos de chegada e estradas cortadas. Tudo num só mapa CesiumJS, com vistas por papel (Câmara, GNR, INEM) e um resumo para o comandante. A pesquisa ILS pode propor a decisão B.

[![Vídeo da demo do Atalaia](https://img.youtube.com/vi/O3tZOxCxVdI/maxresdefault.jpg)](https://www.youtube.com/watch?v=O3tZOxCxVdI)

[Deteção por drone](pitch/video/drone-deteccao.mp4) · [Pitch (PDF)](pitch/Atalaia-pitch.pdf)

## Arrancar

Precisa de Node 20+, Python 3.11+ e Docker (só para os motores).

```bash
# 1. Front-end (http://127.0.0.1:5173)
cd web && npm install && npm run dev

# 2. API (http://127.0.0.1:5181; o Vite reencaminha /api para aqui)
api/setup.sh && api/serve.sh

# 3. Motores (imagens Docker; uma vez)
engines/elmfire/setup.sh
engines/simfire/setup.sh
```

A demo de Penha (incêndio hipotético) corre no browser com o modelo rápido, num Web Worker, sem API. A API e o ELMFIRE só são precisos para correr os incêndios reais.

## Estrutura

| Pasta | O quê |
|---|---|
| [`web/`](web) | Front-end CesiumJS (Vite + TypeScript): mapa, HUD, editor de decisões, modelo rápido, otimização ILS, meios de combate. Os incêndios servidos estão em `web/public/fires/<id>/` |
| [`api/`](api) | FastAPI: `GET /api/fires`, `GET /api/engines`, `POST /api/run` e `/api/jobs` (corridas assíncronas). Traduz o cenário num pedido de motor e guarda os resultados em cache |
| [`engines/`](engines) | Adaptadores dos motores atrás de um só contrato ([CONTRACT.md](engines/CONTRACT.md)): ELMFIRE (principal) e SimFire (alternativa), cada um em Docker |
| [`hindcast/`](hindcast) | Reconstituição de incêndios reais com os registos oficiais (SGIF, perímetros GNR, cicatrizes, focos FIRMS), combustíveis portugueses e linhas de ataque inferidas. Projeto à parte; ver [README](hindcast/README.md) e o teste em nove incêndios ([NOVE_INCENDIOS.md](hindcast/NOVE_INCENDIOS.md)) |
| [`scripts/`](scripts) | `fetch_*` descarregam dados brutos para `data/`; `build_*` constroem as grades de cada incêndio (terreno, combustível, meteo, OSM, cicatrizes, meios) |
| [`data/`](data) | Dados brutos e cache, fora do git ([data/README.md](data/README.md) lista fontes e licenças) |
| [`pitch/`](pitch) | Slides reveal.js, guião, fontes e vídeos ([README](pitch/README.md)) |
| [`docs/`](docs) | Documentação técnica (abaixo) |

## Documentação

- [docs/contracts.md](docs/contracts.md): o cenário que a web pede à API.
- [engines/CONTRACT.md](engines/CONTRACT.md): o pedido e a resposta de cada motor.
- [docs/ils.md](docs/ils.md): otimização das decisões (ILS).
- [docs/fwi-coupling-ipma.md](docs/fwi-coupling-ipma.md) e [resumo](docs/importancia-fwi-resumo.md): o índice FWI acoplado à propagação.
- [docs/braga-firefighting-resources.md](docs/braga-firefighting-resources.md): meios de combate do distrito de Braga.
- [docs/multi-agency-reporting.md](docs/multi-agency-reporting.md): reporte e despacho multi-agência por papel.
- [docs/resumo-tese-uminho-matos-2025.md](docs/resumo-tese-uminho-matos-2025.md): pressupostos operacionais da tese de Matos (UMinho, 2025).
- [docs/RELATORIO_TECNICO_ATALAIA.md](docs/RELATORIO_TECNICO_ATALAIA.md): relatório dos refinamentos táticos.

## Testes

```bash
api/test.sh                     # API nos incêndios reais (corre os motores prontos)
engines/elmfire/test.sh         # cada motor sozinho
cd web && npm run build         # tipos + build
cd web && npm run demo:check    # e os restantes *:check em package.json
```

## Convenções

- CRS: ETRS89 / PT-TM06 (EPSG:3763) internamente; WGS84 só no Cesium.
- Camadas de cada incêndio numa grade comum (`web/public/fires/<id>/grid.json`), uma célula por byte ou número; vetores em GeoJSON.
- As simulações partem de um perímetro observado. Um ponto de ignição só serve para incêndios hipotéticos.

## Equipa

Equipa de cinco no Hack4Guimarães 2035 (ver `git shortlog -sn`), com a orientação do Prof. Filipe Alvelos e da Prof.ª Elsa Silva (UMinho DPS).
