# Atalaia

Gêmeo digital de decisão para incêndios rurais. Hack4Guimarães 2035, desafio 2: "Resposta a emergências e incêndios rurais" (vencedor do desafio).

O Atalaia simula o mesmo incêndio sob duas decisões, A e B, com os mesmos dados, o mesmo perímetro inicial e o mesmo motor de propagação, e compara área ardida, casas e pessoas ameaçadas, tempos de chegada e estradas cortadas. Tudo num só mapa CesiumJS, com vistas por papel (Câmara, GNR, INEM) e um resumo para o comandante. A pesquisa ILS pode propor a decisão B.

[📄 Pitch (PDF)](pitch/Atalaia-pitch.pdf)

## Demo

A demo da Penha (Guimarães) de ponta a ponta: o alerta, as decisões A e B desenhadas no mapa, a simulação e a comparação dos resultados para cada agência. Também no [YouTube](https://www.youtube.com/watch?v=O3tZOxCxVdI).

https://github.com/user-attachments/assets/318261f4-02c7-4dfc-bca3-335db928f75d

## Renders em Unreal Engine

O mapa CesiumJS é a ferramenta de decisão. O produto final que imaginamos é um gémeo fotorrealista em Unreal Engine 5 (projeto `FireRenderer`, fora deste repositório), onde a propagação calculada pelos motores do Atalaia é posta no terreno real:

- **Terreno:** o levantamento LiDAR nacional da DGT (2024–25), com o modelo do terreno (MDT) a 2 m para os 10 × 10 km do cenário e a 50 cm numa zona de pormenor à volta da ignição. A diferença entre o modelo de superfície e o do terreno (MDS − MDT) dá a altura da vegetação, célula a célula.
- **Fogo:** os tempos de chegada da simulação (`arrival`) estão no mesmo referencial do terreno, por isso a frente e a área ardida caem nas encostas certas. O chão muda para material queimado por onde o fogo já passou.
- **Sem rede:** o mundo é construído a partir dos dados abertos, sem depender das tiles do Google.

**A frente de fogo vista do ar.** Um voo ao longo de uma frente simulada: a linha de chamas avança pela encosta, a coluna de fumo cresce e deixa o terreno queimado para trás, entre manchas de pinhal, mato e campos agrícolas.

https://github.com/user-attachments/assets/05ec0606-eefd-47bb-b364-1670b04e0c04

**Área ardida em Guimarães.** A área ardida simulada no cenário da Serra da Penha, sobre o terreno LiDAR.

https://github.com/user-attachments/assets/b89d6086-ded5-4cf2-9c50-b59ee7a63d07

**Vieira do Minho, ELMFIRE.** A propagação do incêndio real de Vieira do Minho (10 de agosto de 2016), simulada pelo ELMFIRE a partir do perímetro observado, a mesma corrida que usamos para validar o motor contra o perímetro oficial.

https://github.com/user-attachments/assets/edee5154-9092-4cb5-a75e-e4f42c4cc2f2

### Drones e aprendizagem por reforço

**Deteção por drone.** O drone sai da sua base, por baixo do santuário da Penha, sobrevoa a igreja, inclina-se para a encosta e a câmara térmica encontra o foco. É o incêndio simulado do cenário `penha_custom` (ELMFIRE, 3 h, vento de leste a 14 km/h que roda para norte a 20 km/h).

https://github.com/user-attachments/assets/d33dffd9-8e60-4a05-ad13-b43f6a2fabe8

O mesmo mundo serve para treinar drones. Com terreno, vegetação e fogo realistas, e uma propagação que segue a física dos motores, o Unreal pode ser um simulador onde agentes aprendem por reforço (RL) a patrulhar, detetar focos cedo, seguir a frente do incêndio e, mais tarde, apoiar o controlo do fogo. Treinar em simulação permite repetir milhares de incêndios diferentes, que nunca se poderiam provocar no terreno. A deteção por drone já aparece no pitch; o treino por RL é o passo seguinte.

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
