# Contrato dos motores

Cada motor vive em `engines/<motor>/` e corre um incêndio com `run.sh`: o pedido entra em JSON pelo stdin e o resultado sai em JSON pelo stdout. Erros saem pelo stderr, com código de saída diferente de 0. Este é o nível do motor: uma grade, a meteo ao longo do tempo, o que já ardeu e as ignições. O cenário (incêndio, passo de partida, decisões A e B) está em `docs/contracts.md`, e a API traduz cada cenário num pedido destes.

## Pedido

```json
{
  "grid": {"cols": 201, "rows": 201, "cellsize": 30, "xmin": -3015, "ymin": -3015, "srs": "EPSG:3763"},
  "duration_min": 60,
  "ignitions": [{"x": 0, "y": 0, "t_min": 0}],
  "burned": 0,
  "weather": [
    {"t_min": 0, "wind_kmh": 20, "wind_from_deg": 270,
     "dead_1h_pct": 6, "dead_10h_pct": 8, "dead_100h_pct": 10,
     "live_herb_pct": 60, "live_woody_pct": 90},
    {"t_min": 30, "wind_kmh": 25, "wind_from_deg": 290,
     "dead_1h_pct": 5, "dead_10h_pct": 7, "dead_100h_pct": 10,
     "live_herb_pct": 60, "live_woody_pct": 90}
  ],
  "layers": {"fuel": 102}
}
```

- **`grid`:** células quadradas de `cellsize` metros. `xmin` e `ymin` são o canto sudoeste, no SRS da grade.
- **`ignitions`:** pontos no SRS da grade, em metros. `t_min` é opcional (0 por omissão). A lista pode estar vazia, ou faltar, se o fogo partir de `burned`.
- **`burned`:** opcional. Células que já arderam no início (1) ou não (0), por exemplo o perímetro observado de onde a simulação parte. Saem no resultado com chegada 0, seja qual for o combustível, e o fogo espalha-se a partir delas.
- **`weather`:** um objeto, constante durante a simulação, ou uma lista de momentos com `t_min`.
  - Os `t_min` começam em 0 e vão de igual em igual (por exemplo de 30 em 30 minutos).
  - Entre dois momentos, cada valor muda em linha reta. O vento roda pelo lado mais curto: de 170° a 190° passa por sul, não por norte. Depois do último momento, a meteo fica como está.
  - `wind_kmh` é o vento a 10 m, em km/h;
  - `wind_from_deg` é a direção de onde o vento vem (convenção meteorológica: 270 = de oeste, empurra o fogo para leste);
  - as humidades dos combustíveis estão em %.
- **`layers`:**
  - `fuel` é obrigatório: código Scott & Burgan (102 = GR2, 165 = TU5, 91 = não combustível);
  - os restantes valem 0 se faltarem: `elevation_m`, `slope_deg`, `aspect_deg`, `canopy_cover_pct`, `canopy_height_m`, `canopy_base_m`, `canopy_bulk_kgm3`.
  - `slope_deg` é o declive em graus a partir da horizontal; `aspect_deg` é para onde a encosta está virada, a descer, em graus a partir do norte (0 = norte, 90 = este), como no LANDFIRE. Cada incêndio traz os três na sua pasta, descritos em `web/public/fires/<id>/terrain.json`.

Cada valor de `burned`, de `layers` e de cada momento de `weather` pode ser um número para a grade toda ou uma matriz `rows` × `cols`, com a linha 0 no bordo norte.

### Campos só do ELMFIRE

Quatro campos opcionais que só o ELMFIRE lê (o SimFire ignora-os). Sem eles, o pedido corre como antes de existirem, célula a célula.
- **`fuel_models`:** modelos de combustível a juntar à tabela do ELMFIRE, para a camada `fuel` os poder usar (por exemplo os modelos portugueses, `hindcast/fuels.py`).
  - Cada modelo é uma lista de 14 valores, nas colunas e unidades do `fuel_models.csv` do ELMFIRE: código, nome, dinâmico (`true`/`false`), as cargas 1 h, 10 h, 100 h, herbáceas vivas e lenhosas vivas (lb/ft²), as razões superfície/volume 1 h, herbáceas vivas e lenhosas vivas (1/ft), a altura do leito (ft), a humidade de extinção das mortas (%) e o calor (BTU/lb).
  - Os códigos vão de 1 a 303 e não podem estar já na tabela padrão (que tem os 13 de Anderson e os 40 de Scott & Burgan); 211 a 237 estão livres.
  - A tabela padrão vem de `vendor/` (`setup.sh`). Sem ela, um pedido com `fuel_models` dá erro.
- **`layers.adj`:** o fator de ajuste da velocidade de propagação do ELMFIRE, um número ou uma matriz (1 por omissão, sem ajuste).
- **`spotting`:** as opções do grupo `&SPOTTING` do ELMFIRE (nome → valor), que ligam as projeções, por exemplo `{"ENABLE_SPOTTING": true, "PIGN_MIN": 55.0, ...}`. Os nomes e os valores vão tal como estão para o `elmfire.data`.
- **`seed`:** a semente das projeções (`&MONTE_CARLO SEED`). A mesma semente dá o mesmo resultado na mesma máquina; entre máquinas (arm64 e x86) o Sørensen varia cerca de ±0,015.

## Resultado

```json
{
  "engine": "elmfire",
  "version": "2025.0717",
  "grid": {"cols": 201, "rows": 201, "cellsize": 30, "xmin": -3015, "ymin": -3015, "srs": "EPSG:3763"},
  "arrival_min": [[null, null, 12.5, ...], ...],
  "burned_ha": 11.34,
  "runtime_s": 0.97
}
```

- **`arrival_min`:** minuto em que o fogo chega a cada célula, desde o início da simulação. Usa a mesma grade e a mesma orientação do pedido (linha 0 a norte). `null` onde o fogo não chegou até `duration_min`, 0 nas células de `burned`.
- **`burned_ha`:** área das células que arderam, incluindo as de `burned`.
- **`runtime_s`:** tempo de relógio do adapter e do motor, sem o arranque do contentor.

## Motores

| Motor | Estado | Notas |
|---|---|---|
| `elmfire/` | P5 | ELMFIRE 2025.0717 num contentor Docker. `./setup.sh` uma vez por máquina, `./test.sh` para validar. A meteo entra como rasters com uma banda por momento, e as humidades vivas também, por isso podem variar por célula e no tempo. Lê também os quatro campos acima |
| `simfire/` | P5 | SimFire 2.0.1 (MITRE) num contentor Docker. `./setup.sh` uma vez por máquina, `./test.sh` para validar. Converte os códigos Scott & Burgan para os 13 modelos originais (Anderson), por isso 102 = GR2 corre como o modelo 2. Só usa `dead_1h_pct`, não tem fogo de copas e tira o declive de `elevation_m` (ignora `slope_deg` e `aspect_deg`). Espalha o fogo célula a célula para os 8 vizinhos, por isso os perímetros são octógonos. O SimFire só aceita uma meteo para a simulação toda; o adapter muda-a a cada passo. `SIMFIRE_STOCK=1` corre o ciclo do próprio SimFire, só com meteo constante |
