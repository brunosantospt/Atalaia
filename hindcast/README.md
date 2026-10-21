# hindcast · reconstituir incêndios reais com os registos oficiais

O ELMFIRE do Atalaia (`engines/elmfire`, `POST /api/run`) parte do perímetro observado com:
- a meteo ERA5 do pacote do incêndio;
- o combustível da COS 2015 traduzido para Scott & Burgan;
- humidades fixas.

Esta pasta junta o que os **registos oficiais** dizem de cada incêndio e corre o ELMFIRE com isso. Mede o efeito de cada mudança contra o observado e contra um sinal independente dos perímetros, os focos de satélite. Faz quatro coisas:

1. **Registos** (`evidence.py`):
   - a ficha do incêndio no SGIF do ICNF (alerta, 1.ª intervenção, extinção, área, índices de perigo);
   - o perímetro oficial (GNR/GTF);
   - os incêndios que arderam ali pouco antes (as "cicatrizes");
   - os focos de satélite (NASA FIRMS);
   - o que a imprensa relatou na altura.
2. **Combustíveis portugueses** (`fuels.py`): os 18 modelos de Fernandes et al. (2009), os que o ICNF usa com o Farsite, em vez dos modelos genéricos norte-americanos.
3. **Linhas de ataque** (`attack.py`): onde o fogo parou ao longo de estradas, como barreiras no formato da API (`decision.barriers`), com a hora a partir da qual seguram.
4. **Corrida e pontuação** (`run.py`):
   - as mesmas regras de barreiras e troços da API (`api/runs.py`, `Fire.line`);
   - um adapter por cima do do motor (`engine/`), com combustíveis próprios, projeções e um fator de ajuste;
   - a pontuação: Sørensen contra o observado e contra o perímetro oficial, e a fração dos focos de satélite que o fogo simulado já tinha alcançado à hora de cada passagem.

Nada fora desta pasta muda: a API, o contrato e o motor ficam como estão.

## Em resumo (para quem chega agora, pessoa ou agente)

- **O que é:** um banco de ensaio do ELMFIRE contra incêndios reais. Cada mudança nos dados de entrada é um passo, corrido com as mesmas regras da API e pontuado da mesma maneira. Assim vê-se o que ajuda e o que não ajuda.
- **Estado em 21/10/2026:**
  - **Vieira do Minho:** completo. São 17 configurações e 2 referências ingénuas, com 10 sementes nas que usam projeções (`ladder.sh` refaz tudo).
  - **Cabeceiras de Basto:** a escada toda, com 10 sementes, com as copas do LiDAR e, para comparar, sem elas. O melhor é o passo 3 (0,73); a configuração de Vieira não transfere (0,61).
  - **Ramo:** `hindcast-registos`, ainda não integrado no `main`.
- **Melhor configuração até agora:**
  - combustíveis portugueses, cicatrizes, vivas de seca (30/70 %) e projeções;
  - copas do LiDAR, que o `run.py` usa por si quando há `canopy.npz`;
  - linhas de ataque com a hora do fogo do modelo (passo 8).

  Em Vieira dá Sørensen 0,83 às 08:30 (mediana de 10 sementes; 0,80–0,85). A API dá 0,73 e a referência ingénua (`b_vento`, uma elipse a favor do vento que sabe a área observada) 0,69. Alcança 67 % dos focos de satélite (63–77 %). Só com dados, sem linhas, fica em 0,78 (0,76–0,80).

  Em Cabeceiras a mesma configuração dá 0,61 (0,55–0,64), abaixo da API (0,63) e do passo 3 (0,73, combustíveis S&B com humidades de hora a hora, copas e cicatrizes). É a melhor de Vieira, ainda não uma configuração geral.
- **O que ainda falha** (ver "Problemas em aberto"):
  - **Vieira:** a corrida principal (10:00–15:00) fica 1,4 a 1,9 vezes lenta de mais: 376–496 ha às 15:00 (mediana 417), contra 707. Nenhum dado nem calibração testados resolve isto sem queimar de mais depois.
  - **Cabeceiras:** os combustíveis portugueses e as vivas de seca queimam de mais (2283 ha no fim no passo 8, contra 1334), e nenhuma corrida apanha o lóbulo que o fogo real fez para norte nas primeiras horas.
- **Regras da casa:**
  - **Não se mexe no resto do repositório:** `api/`, `engines/` e os contratos ficam como estão. Tudo o que é novo vive nesta pasta.
  - **Um passo de cada vez:** uma mudança nova entra como um passo novo da tabela.
  - **Dez sementes:** com projeções, corre-se com 10 sementes e reporta-se a mediana e o intervalo (mínimo–máximo). Uma semente só não prova nada, e com 3 o intervalo dependia muito de qual calhava.
  - **Compara-se sempre com a referência:** um Sørensen só diz alguma coisa por quanto fica acima do `b_vento`, a elipse a favor do vento que sabe a área observada (ver "Pontuação").
  - **O satélite nunca se lê sozinho:** lê-se sempre com "Fora do oficial", porque queimar de mais também alcança focos.
  - **As linhas de ataque são inferidas** do perímetro final. Melhoram o Sørensen em parte por construção, por isso diz-se sempre que número é "só com dados" e qual é "com linhas".
  - **Os descarregamentos e as grades de chegada** ficam em `data/hindcast/`, que não vai para o git. No git só ficam resultados pequenos: JSON e PNG.

## Ficheiros

| Ficheiro | O quê |
|---|---|
| `evidence.py` | Registos de um incêndio → `fires/<id>/evidence.json`, `evidence.geojson`, `evidence.png` |
| `attack.py` | Linhas de ataque inferidas → `fires/<id>/attack_lines.json` (hora do fogo observado) ou `attack_lines_<corrida>.json` (hora do fogo de uma corrida, `--timing run`) |
| `run.py` | Uma corrida do ELMFIRE com opções → `fires/<id>/runs/<nome>/result.json`, `preview.png`; a grade de chegada vai para `data/hindcast/<id>/<nome>.npy` |
| `baseline.py` | As referências ingénuas (`b_uniforme`, `b_vento`): o passo 0 a crescer até à área observada, sem modelo → `fires/<id>/runs/b_*/` |
| `canopy.py` | Camadas de copa do LiDAR da DGT → `fires/<id>/canopy.npz`, `canopy.json` |
| `dgt_tiles.py` | Os tiles MDS-2m e MDT-2m do LiDAR da DGT que cobrem a grade de um incêndio, para o `canopy.py` (a lista é aberta; o download pede login) |
| `grid.py` | Grelha corridas × horas contra o observado → `fires/<id>/grid.png` |
| `table.py` | As corridas de um incêndio numa tabela Markdown |
| `ladder.sh` | Refaz todas as corridas da tabela de resultados de um incêndio (10 sementes), as grelhas e a tabela (~10 min em Vieira com `JOBS=2`, ~20 min em Cabeceiras com `JOBS=1`) |
| `test.sh` | Teste ponta a ponta em Vieira (~20 s) |
| `common.py` | Pacote do incêndio (via `api/fires.py` e `api/runs.py`), chegada observada interpolada, pontuação |
| `fuels.py` | Modelos de combustível portugueses e a tradução da COS 2015 |
| `engine/run.sh`, `engine/adapter.py` | O ELMFIRE de `engines/elmfire` (mesma imagem Docker, mesmo contrato), com quatro campos opcionais a mais no pedido |
| `setup.sh`, `requirements.txt` | O ambiente `hindcast/.venv` |
| `fires/<id>/` | O que as ferramentas escrevem por incêndio (versionado); ver "Formatos dos ficheiros" |

## Como correr

```bash
hindcast/setup.sh                                   # uma vez: hindcast/.venv
engines/elmfire/setup.sh                            # uma vez: a imagem Docker do ELMFIRE (e engines/elmfire/vendor/)
hindcast/.venv/bin/python -I hindcast/evidence.py VieiradoMinho_10082016
hindcast/.venv/bin/python -I hindcast/attack.py VieiradoMinho_10082016
hindcast/.venv/bin/python -I hindcast/run.py VieiradoMinho_10082016 --name 5_projecoes \
    --fuels pt --scars --live-herb 30 --live-woody 70 --spotting
hindcast/.venv/bin/python -I hindcast/attack.py VieiradoMinho_10082016 --timing run --run 5_projecoes
hindcast/.venv/bin/python -I hindcast/run.py VieiradoMinho_10082016 --name 7_linhas_v2 \
    --fuels pt --scars --live-herb 30 --live-woody 70 --spotting \
    --barriers hindcast/fires/VieiradoMinho_10082016/attack_lines_5_projecoes.json
hindcast/.venv/bin/python -I hindcast/baseline.py VieiradoMinho_10082016   # as referências ingénuas
hindcast/.venv/bin/python -I hindcast/table.py VieiradoMinho_10082016
SEEDS=10 JOBS=2 hindcast/ladder.sh                  # tudo de uma vez, ~10 min
SEEDS=10 JOBS=1 hindcast/ladder.sh CabeceirasdeBasto_06092016   # o mesmo em Cabeceiras, ~20 min
hindcast/test.sh                                    # ponta a ponta em Vieira, ~20 s
```

- **Tempo:** uma corrida de 22,5 h demora 10 a 40 s; leva mais quando as linhas a partem em troços.
- **O `run.py` escolhe:**
  - `--fuels sb|pt`, `--shrub`: os combustíveis;
  - `--scars`: as cicatrizes;
  - `--dead emc|fixed`, `--live-herb`, `--live-woody`: as humidades;
  - `--no-canopy`: sem copas (por omissão usa o `canopy.npz`, se houver);
  - `--canopy-fill`: as copas dentro da área ardida passam a ser as da mesma classe COS fora dela (o teste do anacronismo das copas, passos 5f, 6f, 8f);
  - `--spotting --seed n`: as projeções (semente 1 por omissão);
  - `--adj`, `--wind-mult`: os fatores de calibração;
  - `--weather cerra`, `--topowind`: o vento do CERRA e o vento do relevo a 30 m. Precisam de `web/public/fires/<id>/weather_cerra.json` e `scripts/build_wind_field.py`, do Carlos (ramo `feature/cerra-wind-engine`), que já vêm neste ramo;
  - `--barriers`: as linhas;
  - `--start-step`, `--duration-min`: o início e a duração. Por omissão, do passo 0 ao último passo observado;
  - `--no-preview`: não escreve o `preview.png` (o `ladder.sh` só o faz na semente 1).
- **A corrida igual à da API:** `--fuels sb --dead fixed --no-canopy` dá os mesmos dados de entrada que o `POST /api/run`.
- **`ladder.sh`:** `SEEDS` (10 por omissão) é o número de sementes das corridas com projeções; `JOBS` (1 por omissão) quantas correm ao mesmo tempo. Cada uma é um contentor do ELMFIRE de até ~1,7 GiB, e `JOBS` vezes isso tem de caber na memória do Docker, com o que mais lá estiver a correr. Se não couber, o Docker mata os contentores (código 137) e o `run.py` diz isso. Correr em paralelo dá exatamente o mesmo que em série (testado célula a célula).
- **Copas:** `canopy.py <id> --dgt <pasta>`, com os tiles MDS-2m e MDT-2m do LiDAR da DGT. Os tiles não vão para o repositório. O `dgt_tiles.py` descarrega-os:
  ```bash
  hindcast/.venv/bin/python -I hindcast/dgt_tiles.py <id> --list                 # quantos e quanto pesam, sem login
  hindcast/.venv/bin/python -I hindcast/dgt_tiles.py <id> --out <pasta fora do repo>
  hindcast/.venv/bin/python -I hindcast/canopy.py <id> --dgt <pasta fora do repo>
  ```
  - A lista vem da pesquisa STAC aberta do Centro de Dados (`cdd.dgterritorio.gov.pt/dgt-be/v1/search`). Os ficheiros pedem uma conta (gratuita) no portal: o script pede o email e a palavra-passe no terminal e não os guarda.
  - Os tiles são quadrados de 1 km, com ~1,2 MB cada. Vieira tem 176 + 176 (430 MB, voo de 07/2025), Cabeceiras 210 + 210 (510 MB, voos de 09/2024 e 07/2025).
  - Pode correr-se outra vez depois de uma falha: salta os que já lá estão.
- **`-I` (modo isolado do Python):** os scripts acrescentam a sua própria pasta ao `sys.path`, por isso correm assim de qualquer pasta.

## Fluxo de dados

```
web/public/fires/<id>/  (scripts/build_*.py: grid, fuel, terreno, ERA5, progression, osm.json, fire.json com incidentId)
   │
   ├── evidence.py ── SGIF do ICNF, KML da GNR/GTF, NASA FIRMS ──► fires/<id>/evidence.json + evidence.geojson
   │                                                                (perímetro oficial, cicatrizes, focos, imprensa)
   ├── canopy.py ──── LiDAR DGT (MDS−MDT, dgt_tiles.py) ─────────────► fires/<id>/canopy.npz
   │
   ├── attack.py ──── osm.json + perímetro oficial + hora (observada ou de uma corrida) ──► fires/<id>/attack_lines*.json
   │
   ├── baseline.py ── passo 0 a crescer até à área observada, sem modelo ──► fires/<id>/runs/b_*/
   │
   └── run.py ─────── pedido do motor (engines/CONTRACT.md + 4 campos) ──► engine/run.sh ──► ELMFIRE (Docker)
          │             regras da API: runs.Scenario, runs.stretches, Fire.line
          └──► common.score ──► fires/<id>/runs/<nome>/result.json + preview.png ; data/hindcast/<id>/<nome>.npy
                                         │
                                grid.py / table.py ──► fires/<id>/grid*.png, tabela Markdown
```

## Convenções

- **Grade:** a do pacote: EPSG:3763 (PT-TM06), células de 30 m. `xmin`/`ymin` são o canto sudoeste e a linha 0 é a do norte, como no `engines/CONTRACT.md`.
- **Relógios:** há vários, e confundi-los é o erro mais fácil.
  - **Hora local:** o `fire.json`, o `weather.json` e o SGIF estão em hora local (Europe/Lisbon; WEST = UTC+1 no verão). Nos JSON escritos aqui, as horas levam o fuso (`+01:00`).
  - **UTC:** as passagens dos satélites (`time_utc`).
  - **`hours_after_alert`:** as horas desde o alerta do SGIF (Vieira: 09:46).
  - **Minutos desde o início da corrida:** as grades `.npy` das corridas, os `from_min` das linhas e o `t_min` do motor. O início é o passo 0 do `fire.json` (Vieira: 10:00). Com `--start-step k` conta desde esse passo, mas a pontuação passa tudo para o relógio do passo 0.
  - **Satélite no relógio do passo 0:** `common.alert_offset_min` faz a conversão (Vieira: −14 min).
- **Nomes das corridas e passos da tabela:**

  | Corrida (`runs/<nome>`) | Passo |
  |---|---|
  | `b_uniforme`, `b_vento` | b (referências ingénuas, sem modelo) |
  | `0_api` | 0 |
  | `1a_humidade_emc` | 1 |
  | `1_emc_copas` | 2 |
  | `2_cicatrizes` | 3 |
  | `3_combustiveis_pt` | 4 |
  | `4_seca` | 5 |
  | `4f_seca_copas_antes` | 5f |
  | `5_projecoes` | 6 |
  | `5f_copas_antes` | 6f |
  | `5w_topowind` | 6w |
  | `5c_cerra` | 6c |
  | `5cw_cerra_topowind` | 6cw |
  | `x_adj1.5`, `x_vento_x2` | x1, x2 |
  | `6_linhas` | 7 |
  | `7_linhas_v2` | 8 |
  | `7f_linhas_v2_copas_antes` | 8f |

  Os nomes ficaram da ordem em que as corridas foram feitas. `_seed2` a `_seed10` são as outras sementes; sem sufixo é a semente 1. Nas linhas v2, a semente *s* usa as linhas `attack_lines_5_projecoes[_seeds].json`, cronometradas na corrida livre da mesma semente (no 8f, as de `5f_copas_antes[_seeds]`). O "f" (*fill*) é o teste do anacronismo das copas (`--canopy-fill`).
- **Sementes:** com a mesma semente, a mesma configuração e o mesmo número de troços, o ELMFIRE dá exatamente o mesmo resultado **na mesma máquina** (o `ladder.sh` refaz os `result.json` iguais, em série ou em paralelo). Muda o número de troços e mudam as tiragens das projeções.
  - **Entre máquinas não:** a mesma semente num Mac arm64 e num x86_64 dá números um pouco diferentes (cerca de ±0,015 de Sørensen com projeções, ±0,005 sem elas; em Vieira, o passo 5 passou de 2077 para 2076 ha). Por isso o `result.json` regista a máquina e a imagem (`platform`), e a tabela mostra-a.
  - **Reporta-se a mediana de 10 sementes e o intervalo** (mínimo–máximo). Com 3, o intervalo dependia muito de qual semente calhava.
- **Língua:** documentação e mensagens em português; código, comentários e chaves dos JSON em inglês, como no resto do repositório.

## Formatos dos ficheiros

- **`evidence.json`:**
  - `incident`: a ficha do SGIF.
    - Identificação: `sgif_id`, `ncco`, `municipality`, `parish`, `place`, `lon`/`lat`.
    - Horas: `alert`, `first_intervention`, `extinguished`, `duration_h`.
    - Área e causa: `area_ha {stands, shrub, farmland, total}`, `cause`.
    - Perigo no local: `weather_at_fire {temp_c, rh_pct, wind_kmh, wind_from_deg, ffmc, dmc, dc, isi, bui, fwi, dsr}`.
    - Combustível e fonte: `fuel_model_at_ignition` (código Farsite), `source`.
  - `news`: os factos da imprensa (`time`, `kind`, `fact`, `source`, `url`).
  - `scars`: o mesmo que as propriedades das cicatrizes no GeoJSON.
  - `satellite_passes`: por passagem e sensor (`time_utc`, `time_local`, `hours_after_alert`, `product`, `n`, `this_fire`, `near_fire_before_alert`).
  - `sources`: de onde vem cada coisa.
- **`evidence.geojson`:** lon/lat (WGS84), e a propriedade `kind` diz o que cada elemento é.
  - `perimeter` (o oficial): `ncco`, `area_ha`, `source` (o KML usado).
  - `scar`: `ncco`, `parish`, `municipality`, `alert`, `extinguished`, `area_ha`, `reported_ha`, `cause`, `source`.
  - `hotspot`: `product` (`viirs-snpp` ou `modis`), `satellite`, `pixel_m`, `time_utc`, `hours_after_alert`, `frp_mw`, `confidence`, `daynight`, mais três marcas:
    - `near_fire`: a menos de ~350 m do perímetro oficial;
    - `in_scar`: numa cicatriz;
    - `this_fire`: `near_fire` e depois do alerta.
- **`attack_lines*.json`:**
  - `barriers`: lista de linhas. Cada uma tem `path` (`[[lon, lat], …]`), `width_m` e `from_min`, que são os campos de `decision.barriers` da API; mais `label`, `tier` (`road` ou `connector`), `source` (como foi inferida) e `length_m`.
  - `options`: com que opções foi feito.
  - Resumo do perímetro, em km: `official_boundary_km`, `boundary_along_scars_km`, `boundary_covered_km`, `crossings_left_out_km`.
  - **Para mandar à API:** passa-se só `path`/`width_m`/`from_min` de cada linha para `POST /api/run`.
- **`runs/<nome>/result.json`:**
  - `options`: todas as opções do `run.py`, com caminhos relativos ao repositório.
  - A corrida: `start`, `duration_min`, `engine`, `barriers` (quantas), `stretches` (troços), `runtime_s`, `notes` (avisos).
  - `platform`: onde correu: `machine` (arm64, x86_64), `system`, `image` e `image_id` (a imagem Docker do ELMFIRE) e `image_platform`. As corridas anteriores a 21/10/2026 não o têm.
  - Nas referências `b_*`, `engine` diz `none: …` e `options` traz a forma da elipse (`wind_to_deg`, `mean_speed_kmh`, `length_to_breadth`).
  - `stats`:
    - `burned_ha`;
    - `by_hour` (`h`, `observed_ha`, `run_ha`);
    - `sorensen_last_step` e `sorensen_by_step`;
    - `official_ha`, `sorensen_official`, `outside_official_ha`;
    - `satellite` (`passes` com `reached`, e `mean_reached`).
- **`data/hindcast/<id>/<nome>.npy`:** float32 linhas × colunas, os minutos desde o início em que o fogo chega a cada célula, NaN onde não chega.
- **`canopy.npz`:** `cover_pct` (uint8, %), `height_dm` e `base_dm` (uint16, dm), `bulk_cg_m3` (uint8, centésimos de kg/m³). Linha 0 a norte. O método e a fonte estão no `canopy.json`.

## 1. Os registos (`evidence.py`)

- **Ficha do incêndio no SGIF do ICNF**, pelo serviço público `fogos.icnf.pt/localizador/webserviceocorrencias.asp?ANO=&MES=`. O incêndio encontra-se pelo `incidentId` do `fire.json` (o n.º ANEPC, `NCCO` no SGIF). A ficha traz:
  - as horas: alerta, 1.ª intervenção, extinção;
  - a área por ocupação e a causa;
  - os índices do sistema canadiano no local (FFMC, DMC, DC, ISI, BUI, FWI);
  - o modelo Farsite na ignição;
  - as ligações aos KML do perímetro levantado pela GNR e/ou pelo GTF.
- **Cicatrizes:** os incêndios do SGIF na grade (+1,5 km), extintos nos 40 dias antes do alerta, com perímetro. O combustível deles já tinha ardido.
- **Focos de satélite:** os ficheiros anuais por país do NASA FIRMS (VIIRS 375 m e MODIS 1 km), que não pedem registo.
- **Imprensa:** os factos estão escritos à mão em `NEWS`, cada um com a fonte.

**Vieira do Minho**, ficha DM4161072 / ANEPC 2016030060428, Chã das Tertúlias (Rossas):
- **Horas:** alerta às 09:46 (dado por populares), 1.ª intervenção às 09:50, extinto a 11/08 às 21:05 (35,3 h).
- **Área:** 1839 ha (800 de povoamentos, 1039 de mato).
- **Perigo no local:** FWI 53,6, ISI 16,6, DC 511, BUI 199, uma seca extrema. 20 °C, 37 % de humidade, vento de 22 km/h de 89°.
- **Combustível na ignição:** o modelo Farsite 227 (M-PIN).
- **Perímetro oficial (GNR):** 1840 ha. O PT-FireSprd só data 1621 ha desses (os passos do `fire.json`).
- **Cicatrizes:**
  - **Sobradelo da Goma:** 115 ha, a 9/08, extinto às 01:12 de 10/08, 8,5 h antes deste alerta. Fica mesmo no caminho do fogo para oeste, e o fogo real dividiu-se à volta dele nos dois lóbulos do oeste.
  - **Gontim:** 25 ha, a 8/08, no bordo leste.
  - **Garfe:** 449 ha, a 7/08, a oeste.
- **Satélite:**
  - **Corrida principal:** passagens às 13:02, 13:39, 14:42 e 15:20. Às 13:39 já havia focos 3,5 km a oeste da ignição, o que confirma a velocidade observada.
  - **Noite:** passagens às 00:08, 02:41, 03:37 e 04:19.
- **Um fogo na noite anterior, sem registo.** O VIIRS e o MODIS viram fogo das 23:25 de 9/08 às 03:56 de 10/08 (até 60 MW), ao longo de 2,6 km, dentro do canto sudeste do perímetro oficial.
  - Nenhuma ficha do SGIF o cobre: o de Gontim foi extinto às 01:02 de 9/08.
  - É provavelmente um reacendimento, e os 1839 ha oficiais incluem-no.
  - O `evidence.py` mostra-o sempre que acontece: os focos dentro do perímetro oficial ANTES do alerta.
- **Imprensa (Lusa no JN, RTP):**
  - evacuação preventiva de Carreiras e Cabanelas (Sobradelo da Goma) por volta das 22:00 de 10/08;
  - de manhã, a 11/08, ardeu uma casa abandonada em Agrela (Fafe), na ponta oeste;
  - rajadas até 80 km/h foram a maior dificuldade;
  - "em resolução" ao fim de 32 h (JN, 20:11 de 11/08).

**Cabeceiras de Basto**, ficha DM4161664 / ANEPC 2016030067614, Rio Douro:
- **Horas:** alerta às 06:09, mais de 2 h depois das 04:00 do PT-FireSprd; 1.ª intervenção às 06:30; extinto a 7/09 às 23:24.
- **Área:** 1555 ha no SGIF; o perímetro da GNR tem 1392 ha.
- **Perigo no local:** DC 729 e BUI 193, uma seca ainda mais funda que a de Vieira.
- **Cicatrizes:** 11 incêndios nos 40 dias antes, 870 ha no SGIF, 504 ha dentro da grade. Os maiores:
  - **Cavez:** 404 ha, a 29/08.
  - **Rio Douro:** 254 ha e 47 ha a 2/09, e 59 ha a 25/08.
  - **Abadim:** 95 ha, a 5/09, na véspera.
  - Os outros 6 têm menos de 3 ha.

## 2. Combustíveis portugueses (`fuels.py`)

- **Modelos:** os parâmetros dos 18 modelos de Fernandes et al. (2009), tal como estão tabelados em Paixão (2017). Entram como linhas a mais na tabela de combustíveis do ELMFIRE, com os códigos 211–237 (o ELMFIRE aceita 1–303).
- **Da COS 2015 para os modelos:**

  | Classe COS | Modelo |
  |---|---|
  | Pinheiro bravo e manso | M-PIN (é o que a ficha do SGIF dá na ignição de Vieira) |
  | Eucalipto | M-EUC |
  | Carvalhos, castanheiro, outras folhosas | M-CAD |
  | Sobreiro, azinheira, invasoras | M-ESC |
  | Outras resinosas | F-RAC |
  | Matos | V-MAa (mato alto com muito combustível morto: o tojo e a urze dos montes do Minho), ou outro com `--shrub` |
  | Vegetação esparsa | V-MH |
  | Pastagens | V-Hb |

  O resto (agrícola, edificado, água) fica com o código Scott & Burgan do `fuel.json`.
- **Porque muda tanto:** antes, o pinhal e o eucaliptal eram TU5, um modelo lento de sub-bosque de floresta.

## 3. Linhas de ataque inferidas (`attack.py`)

Não há nos registos abertos um mapa das linhas seguradas em 2016:
- o SGIF tem horas e áreas;
- os ficheiros da GNR/GTF só têm o perímetro final;
- a ANEPC não publica mapas de linhas.

Por isso as linhas são **inferidas**, e cada uma diz como (`tier`, `source`).

- **`road` (estrada):**
  - **O que é:** uma estrada ou caminho do `osm.json` que o perímetro oficial segue durante pelo menos 300 m, por fora da área ardida. O fogo parou ali, e é ali que as equipas seguram um flanco: a estrada dá acesso e corta o combustível.
  - **Troços curtos entre cruzamentos:** os 300 m contam para um troço de estrada ligado, não para cada pedaço entre dois cruzamentos.
  - **Estradas atravessadas ficam de fora:** uma estrada que o fogo atravessou também passa junto ao perímetro. Por isso só conta se correr ao longo dele: as pontas têm de ficar a pelo menos metade do seu comprimento uma da outra, medido ao longo do perímetro.
  - **Só o bordo exterior conta,** e não onde corre junto a uma cicatriz.
- **`connector` (ligação):** o perímetro oficial entre as pontas de duas linhas de estrada a menos de 250 m uma da outra, sem estrada no OpenStreetMap entre elas. As equipas ligam os dois flancos com uma linha manual ou de máquina. Segura a partir da mais tardia das duas.
- **Hora (`from_min`, minutos desde o passo 0):** quando o fogo observado chega a menos de 400 m da linha, menos 60 min (as equipas posicionam-se antes da frente). Arredonda-se para baixo à hora, porque cada `from_min` diferente parte a corrida.
- **Hora do fogo do modelo (`--timing run --run <corrida>`, "linhas v2"):** a mesma regra, mas sobre a chegada do fogo de uma corrida sem linhas. Os registos dizem que as linhas seguraram, não quando foram feitas, e o fogo do modelo chega às estradas a outras horas que o real. Assim uma linha só falha se o fogo do modelo for mais rápido do que equipas postas 60 min à frente dele.
- **Vieira:** 33 linhas, 13,6 km, ao longo de 11,5 dos 34 km do perímetro. Outros 3 km do perímetro correm junto a cicatrizes, e ficam de fora 30 estradas atravessadas.
  - Os flancos sul e leste seguram a partir das 2–3 h.
  - O flanco norte segura sobretudo a partir das 11 h (21:00).
- **Cabeceiras:** 44 linhas, 14,7 km, ao longo de 12,6 dos 29 km do perímetro. Outro 1 km corre junto a cicatrizes.
- **Não se infere a defesa das aldeias:** o OSM tem poucas casas nestas freguesias, e as aldeias evacuadas nem lá estão.

**Atenção: as linhas estão onde o perímetro final está.** Uma corrida com elas aproxima-se desse perímetro por construção. Por isso olha-se também para o satélite, que elas não conseguem melhorar (só podem tirar área), e para a área ao longo do tempo.

## 4. O motor (`engine/`)

`engine/run.sh` corre a mesma imagem que `engines/elmfire/run.sh`. Monta o `engines/elmfire/adapter.py` e, por cima, `engine/adapter.py`, que acrescenta quatro campos **opcionais** ao pedido do `engines/CONTRACT.md`:

| Campo | O quê |
|---|---|
| `fuel_models` | Linhas a mais para a tabela de combustíveis do ELMFIRE (`fuel_models.csv`), nas unidades dele |
| `layers.adj` | O fator de ajuste da velocidade do ELMFIRE (o adapter de origem escreve sempre 1) |
| `spotting` | O grupo `&SPOTTING` do ELMFIRE (projeções) |
| `seed` | A semente das projeções |

- **Compatível:** um pedido sem eles dá exatamente o mesmo resultado que `engines/elmfire/run.sh`. Testado com a corrida 0 de Vieira: as mesmas células ardidas e as mesmas horas de chegada.
- **Proposta:** passar estes campos para o `engines/elmfire/adapter.py` e para o contrato, e o `fuel_models`/`seed` para o cenário da API.

## 5. Pontuação (`common.score`)

- **Chegada observada:** interpolada entre os perímetros dos passos do `progression.geojson`. Dentro do anel que cada passo acrescenta, t = t_ant + (t_k − t_ant) · d_ant / (d_ant + d_seg). Os perímetros são observados; as horas entre eles não são.
- **Área por passo e Sørensen:** contra o observado, por passo e no último passo.
- **Perímetro oficial:** o Sørensen contra o perímetro oficial (GNR) e a área ardida fora dele.
- **Satélite:** em cada passagem com pelo menos 3 focos neste incêndio, fora das cicatrizes, a fração de focos cuja pegada (375 m ou 1 km) o fogo simulado já tinha alcançado até 30 min depois da passagem. Não depende dos perímetros.
  - **Lê-se sempre com "Fora do oficial".** Só conta focos alcançados, por isso queimar de mais não custa nada: em Cabeceiras a corrida como a API tem 0,80 queimando 988 ha fora do perímetro oficial, e a corrida com velocidade × 1,5 chega a 0,92 com 3233 ha fora.
- **Referências ingénuas (`baseline.py`):** quanto vale um Sørensen de 0,75? Depende do fogo: num fogo compacto, qualquer mancha com a área certa à volta da ignição já tem um Sørensen alto. Por isso cada incêndio tem duas corridas sem modelo, que fazem batota a favor delas: **sabem a área observada em cada passo**, coisa que nenhum modelo sabe. Não sabem nada de combustível, relevo ou estradas.
  - **`b_uniforme`:** o perímetro do passo 0 a crescer por igual em todas as direções (um círculo à volta dele) até ter a área observada de cada passo, e linear no tempo entre passos.
  - **`b_vento`:** o mesmo, mas a crescer numa elipse a favor do vento médio da corrida. O vento médio é a média dos vetores do `weather.json` de meia em meia hora, do passo 0 ao último. O passo 0 fica no foco de trás da elipse, e o alongamento é o de Alexander (1985) para a velocidade média a 10 m: LB = 1 + 8,729 (1 − e^(−0,030 U))^2,155, com U em km/h. A "distância" de uma célula é |v| − e·(v·u), onde v vai da borda do passo 0 até à célula, u é a direção para onde o vento sopra e e a excentricidade da elipse, √(1 − 1/LB²).
  - **Como se leem:** um passo da tabela só ganha alguma coisa se ficar acima do `b_vento`. A diferença é o que o ELMFIRE e os dados acrescentam à forma do fogo, sabendo que o `b_vento` tem a área certa de graça.

## Resultados

### Vieira do Minho, 22,5 h a partir das 10:00 (perímetro do passo 0)

Cada passo muda uma coisa nos dados de entrada do ELMFIRE. As corridas com projeções têm 10 sementes: a mediana e, entre parênteses, a mais baixa e a mais alta. As outras não têm nada aleatório e correm uma vez. Corridas num Mac arm64 com a imagem `atalaia/elmfire:2025.0717` (o `table.py` mostra a máquina de cada uma).

| # | O que muda | 15:00 (5 h) | 03:30 (17,5 h) | 08:30 (22,5 h) | Sørensen 08:30 | Sørensen oficial | Fora do oficial | Satélite |
|---|---|---|---|---|---|---|---|---|
| | **Observado** (PT-FireSprd) | 707 ha | 1573 ha | 1621 ha | | (1840 ha) | | |
| b | Referência: círculo à volta do passo 0 (sem modelo, sabe a área) | 707 | 1573 | 1621 | 0,342 | 0,460 | 824 ha | 0,35 |
| b | Referência: elipse a favor do vento (sem modelo, sabe a área) | 707 | 1573 | 1621 | 0,693 | 0,676 | 451 | 0,60 |
| 0 | Como a API: S&B, mortas fixas 6/8/10 %, sem copas | 155 | 1355 | 1798 | 0,727 | 0,745 | 442 | 0,38 |
| 1 | + humidades mortas de hora a hora (Simard 1968) | 158 | 1351 | 1701 | 0,738 | 0,752 | 369 | 0,38 |
| 2 | + copas do LiDAR | 144 | 1182 | 1497 | 0,721 | 0,770 | 212 | 0,35 |
| 3 | + cicatrizes | 144 | 1136 | 1405 | 0,743 | 0,792 | 120 | 0,35 |
| 4 | + combustíveis portugueses | 219 | 1321 | 1646 | 0,779 | 0,832 | 196 | 0,46 |
| 5 | + vivas de seca (30 % e 70 %) | 348 | 1639 | 2076 | 0,756 | 0,817 | 476 | 0,59 |
| 5f | 5 com as copas de antes do fogo (estimadas) | 153 | 1486 | 1853 | 0,743 | 0,799 | 377 | 0,39 |
| 6 | + projeções | 417 (376–496) | 1704 (1660–1858) | 2207 (2128–2347) | 0,782 (0,763–0,795) | 0,838 (0,822–0,850) | 511 (489–594) | 0,67 (0,64–0,75) |
| 6f | 6 com as copas de antes do fogo | 152 (152–468) | 1498 (1486–1741) | 1868 (1853–2235) | 0,743 (0,740–0,774) | 0,799 (0,796–0,823) | 392 (376–558) | 0,41 (0,39–0,68) |
| 6w | 6 + TopoWind sobre o ERA5 | 393 (348–490) | 1655 (1615–1723) | 2132 (2040–2200) | 0,778 (0,755–0,788) | 0,835 (0,814–0,841) | 469 (449–508) | 0,66 (0,62–0,70) |
| 6c | 6 com CERRA em vez de ERA5 | 252 (229–325) | 1638 (1579–1707) | 2111 (1989–2330) | 0,742 (0,706–0,771) | 0,793 (0,760–0,823) | 565 (481–656) | 0,49 (0,46–0,54) |
| 6cw | 6 com CERRA + TopoWind | 232 (215–358) | 1572 (1530–1737) | 1984 (1935–2220) | 0,736 (0,726–0,755) | 0,790 (0,777–0,805) | 471 (433–642) | 0,46 (0,44–0,52) |
| x1 | 6 + velocidade × 1,5 (calibração, não fica; semente 1) | 830 | 2939 | 3978 | 0,573 | 0,626 | 2157 | 0,90 |
| x2 | 6 + vento × 2 (calibração, não fica; semente 1) | 631 | 2113 | 2605 | 0,749 | 0,773 | 888 | 0,79 |
| 7 | 6 + linhas de ataque, hora do fogo observado | 424 (356–489) | 1596 (1534–1781) | 1960 (1845–2092) | 0,821 (0,809–0,835) | 0,881 (0,869–0,893) | 269 (223–355) | 0,67 (0,62–0,76) |
| **8** | **6 + linhas de ataque, hora do fogo do modelo** | **421 (356–492)** | **1577 (1537–1782)** | **1893 (1823–2048)** | **0,827 (0,801–0,851)** | **0,887 (0,863–0,903)** | **237 (224–292)** | **0,67 (0,63–0,77)** |
| 8f | 8 com as copas de antes do fogo | 158 (157–504) | 1420 (1415–1647) | 1619 (1617–1946) | 0,786 (0,784–0,854) | 0,844 (0,842–0,901) | 160 (158–240) | 0,42 (0,41–0,78) |

**Grelhas:**
- `fires/VieiradoMinho_10082016/grid.png`: a referência `b_vento` e todos os passos lado a lado, com a semente 1 nas corridas com projeções. As linhas da grelha são as 2 h, cada passo observado e o meio entre os dois primeiros passos.
- `grid_wind.png`: as quatro fontes de vento, sem linhas, nas sementes 1 a 3.

Cada célula mostra o fogo a uma hora:
- **laranja:** arderam os dois;
- **vermelho:** só o modelo;
- **azul:** só o observado.

Fazem-se com `grid.py`.

- **As referências (b)** sabem a área observada a cada passo, por isso acertam nos hectares por construção e só a forma conta.
  - O círculo faz 0,342 e a elipse a favor do vento 0,693.
  - A API fica só 0,03 acima da elipse. Só com dados (passo 6) fica 0,09 acima, e com as linhas v2 (passo 8) 0,13.
  - A elipse alcança 60 % dos focos de satélite, mais do que a API (38 %), porque tem a área certa logo às 15:00.
- **As cicatrizes** cortam para metade a área ardida fora do perímetro oficial (212 → 120 ha). O fogo passa a dividir-se à volta de Sobradelo da Goma, como o real.
- **As copas** abrandam o fogo: debaixo das árvores o ELMFIRE usa um vento abrigado.
- **Os combustíveis portugueses** sobem o Sørensen do último passo de 0,743 para 0,779. Com as vivas de seca, a corrida principal passa a mais do dobro da da API (155 → 348 ha às 15:00).
- **Só com dados** (passos 0 a 6, sem linhas), o Sørensen do último passo vai de 0,727 a 0,782 (mediana das 10 sementes; 0,763–0,795).
- **O vento** (6w, 6c, 6cw), testado sem linhas para se ver o efeito sozinho:
  - **TopoWind** (`scripts/build_wind_field.py`, ramo `feature/cerra-wind-engine`): 0,778 contra 0,782, dentro do intervalo das sementes. Redistribui o vento entre encostas, mas a média é a mesma, e debaixo das árvores o ELMFIRE corta-o para 10–15 % na mesma.
  - **CERRA:** tem menos vento à tarde do que o ERA5, e a corrida principal fica mais lenta (mediana 252 ha às 15:00, contra 417).
- **As copas de antes do fogo** (5f, 6f, 8f; `--canopy-fill`): dentro da área ardida, as florestas passam a ter as copas da mesma classe COS fora dela, mais densas (cobertura média de 70 para 86 %; o pinhal passa dos ~12 m de hoje para ~18 m). Os matos, metade da área, perdem a copa que têm hoje (16 → 3 %; ver "Coisas a saber"). O fogo fica mais lento, não mais rápido:
  - **sem projeções (5f):** 153 ha às 15:00, contra 348;
  - **com projeções, o resultado é bimodal:** na maioria das sementes as projeções não arrancam, e o fogo fica nos 152–158 ha às 15:00 (6 em 10 no 6f, 9 em 10 no 8f). Nas outras escapa, até 468–504 ha (semente 8);
  - **por isso a mediana cai:** 6f 0,743 contra 0,782, e 8f 0,786 contra 0,827. A semente 8 do 8f é a melhor corrida isolada da tabela (0,854), mas é uma em dez.
  - **Conclusão:** as copas de hoje, mais baixas na cicatriz, não explicam a corrida principal lenta.
- **As linhas de ataque** estão onde o perímetro final segue estradas, por isso parte do ganho é por construção. O satélite não sobe com elas.
  - **Linhas com a hora do fogo observado (7):** a frente do modelo chega a muitas estradas antes do fogo real, sobretudo no flanco norte, e passa antes de a linha existir. Isso conta como erro de supressão o que é erro de horas do modelo.
  - **Linhas com a hora do fogo do modelo (8):** as mesmas estradas, cada uma a segurar 60 min antes de lá chegar o fogo da corrida livre com a mesma semente (`attack.py --timing run --run <corrida>`), e nunca antes das 10:30. Os registos dizem que as linhas seguraram, não quando foram feitas.
  - **Diferença entre as duas:** com 10 sementes é menor do que parecia com 3.
    - O Sørensen quase empata: mediana 0,827 contra 0,821, e a 8 ganha em 6 das 10 sementes. O satélite empata (0,67).
    - A 8 ganha na área fora do oficial: mediana 237 contra 269 ha, e nunca passa de 292 ha (a 7 chega a 355).
    - Fica como a melhor configuração por isso, e por não contar como erro de supressão o que é erro de horas do modelo.
  - **O que sobra fora do oficial** (≈ 240 ha) fica onde o perímetro não tem estrada: o canto nordeste e o lóbulo noroeste. Ali não se inventam linhas.
- **Ainda lento na corrida principal:** às 15:00 tem 376–496 ha (mediana 417), contra 707. Há três razões prováveis:
  - os ventos locais (as rajadas de 80 km/h);
  - as projeções a longa distância no eucalipto;
  - o fogo da noite anterior.
- **Calibrar não resolve** (x1, x2): acerta nas 15:00, mas alarga os flancos e queima de mais (2600–4000 ha de manhã).
- **Limite do ELMFIRE:** com vento × 2,5 ou velocidade × 2,5 falha sem erro: queima 0 ha. O `run.py` avisa quando o fogo não sai do ponto de partida.

### Cabeceiras de Basto, 32,5 h a partir das 04:00 (perímetro do passo 0)

Os mesmos passos de Vieira, com as mesmas regras. São duas tabelas:
- **com as copas do LiDAR:** a principal, como a de Vieira;
- **sem copas:** de antes de o LiDAR estar descarregado, para comparar. As corridas dela estão no commit `376d842`; para as refazer, corre-se o `ladder.sh` com o `canopy.npz` posto de lado.

#### Com copas do LiDAR

| # | O que muda | 13:30 (9,5 h) | 00:30 (20,5 h) | 12:30 (32,5 h) | Sørensen 12:30 | Sørensen oficial | Fora do oficial | Satélite |
|---|---|---|---|---|---|---|---|---|
| | **Observado** (PT-FireSprd) | 594 ha | 1243 ha | 1334 ha | | (1392 ha) | | |
| b | Referência: círculo à volta do passo 0 (sem modelo, sabe a área) | 594 | 1243 | 1334 | 0,423 | 0,436 | 739 ha | 0,36 |
| b | Referência: elipse a favor do vento (sem modelo, sabe a área) | 594 | 1243 | 1334 | 0,469 | 0,486 | 671 | 0,47 |
| 0 | Como a API: S&B, mortas fixas 6/8/10 %, sem copas | 298 | 1152 | 2154 | 0,627 | 0,658 | 988 | 0,80 |
| 1 | + humidades mortas de hora a hora (Simard 1968) | 285 | 1105 | 1743 | 0,696 | 0,728 | 602 | 0,75 |
| 2 | + copas do LiDAR | 237 | 1026 | 1685 | 0,696 | 0,724 | 570 | 0,75 |
| **3** | **+ cicatrizes** | **237** | **855** | **1269** | **0,732** | **0,759** | **259** | **0,68** |
| 4 | + combustíveis portugueses | 303 | 1029 | 1715 | 0,672 | 0,701 | 626 | 0,70 |
| 5 | + vivas de seca (30 % e 70 %) | 373 | 1283 | 2226 | 0,628 | 0,658 | 1036 | 0,78 |
| 5f | 5 com as copas de antes do fogo (estimadas) | 368 | 1258 | 2178 | 0,617 | 0,648 | 1022 | 0,78 |
| 6 | + projeções | 383 (374–416) | 1398 (1335–1800) | 2362 (2253–2710) | 0,618 (0,554–0,630) | 0,647 (0,581–0,661) | 1153 (1054–1519) | 0,80 (0,78–0,81) |
| 6f | 6 com as copas de antes do fogo | 368 (367–422) | 1299 (1258–1681) | 2228 (2173–2629) | 0,618 (0,547–0,631) | 0,649 (0,575–0,662) | 1054 (1016–1473) | 0,78 (0,78–0,82) |
| 6w | 6 + TopoWind sobre o ERA5 | 362 (353–380) | 1284 (1194–1470) | 2184 (2103–2545) | 0,623 (0,604–0,638) | 0,651 (0,631–0,666) | 1020 (939–1282) | 0,76 (0,74–0,83) |
| 6c | 6 com CERRA em vez de ERA5 | 376 (371–387) | 1446 (1298–1680) | 2448 (2350–2816) | 0,593 (0,544–0,606) | 0,623 (0,573–0,636) | 1251 (1160–1610) | 0,78 (0,77–0,81) |
| 6cw | 6 com CERRA + TopoWind | 361 (351–374) | 1268 (1165–1698) | 2377 (2175–2848) | 0,596 (0,526–0,621) | 0,627 (0,554–0,652) | 1199 (1012–1673) | 0,74 (0,74–0,76) |
| x1 | 6 + velocidade × 1,5 (calibração, não fica; semente 1) | 506 | 2159 | 4544 | 0,423 | 0,442 | 3233 | 0,92 |
| x2 | 6 + vento × 2 (calibração, não fica; semente 1) | 390 | 2113 | 3741 | 0,486 | 0,506 | 2442 | 0,88 |
| 7 | 6 + linhas de ataque, hora do fogo observado | 353 (342–379) | 1369 (1162–1636) | 2192 (2035–2676) | 0,631 (0,557–0,649) | 0,661 (0,587–0,680) | 999 (874–1482) | 0,80 (0,78–0,83) |
| 8 | 6 + linhas de ataque, hora do fogo do modelo | 342 (336–387) | 1438 (1156–1673) | 2283 (2057–2688) | 0,614 (0,548–0,643) | 0,645 (0,576–0,674) | 1098 (894–1512) | 0,81 (0,78–0,83) |
| 8f | 8 com as copas de antes do fogo | 332 (330–401) | 1233 (1156–1778) | 2075 (2018–2798) | 0,623 (0,536–0,667) | 0,655 (0,565–0,694) | 927 (891–1614) | 0,78 (0,78–0,82) |

#### Sem copas (para comparar)

Sem `canopy.npz`, o passo 2 dá exatamente o mesmo que o 1 e fica de fora. As referências e os passos 0 e 1 são iguais aos de cima.

| # | O que muda | 13:30 (9,5 h) | 00:30 (20,5 h) | 12:30 (32,5 h) | Sørensen 12:30 | Sørensen oficial | Fora do oficial | Satélite |
|---|---|---|---|---|---|---|---|---|
| 3 | 1 + cicatrizes | 285 | 952 | 1379 | 0,738 | 0,769 | 314 | 0,72 |
| 4 | + combustíveis portugueses | 356 | 1280 | 2060 | 0,658 | 0,689 | 871 | 0,76 |
| 5 | + vivas de seca (30 % e 70 %) | 438 | 1667 | 2703 | 0,583 | 0,610 | 1454 | 0,82 |
| 6 | + projeções | 438 (437–486) | 1691 (1668–1768) | 2734 (2699–2874) | 0,580 (0,561–0,587) | 0,607 (0,588–0,614) | 1482 (1447–1620) | 0,82 (0,82–0,85) |
| 6w | 6 + TopoWind sobre o ERA5 | 370 (370–413) | 1322 (1281–1442) | 2324 (2274–2697) | 0,626 (0,575–0,632) | 0,655 (0,603–0,660) | 1105 (1067–1463) | 0,79 (0,79–0,81) |
| 6c | 6 com CERRA em vez de ERA5 | 448 (448–551) | 1784 (1767–2115) | 3066 (3042–3675) | 0,520 (0,455–0,523) | 0,546 (0,479–0,549) | 1847 (1828–2460) | 0,82 (0,81–0,83) |
| 6cw | 6 com CERRA + TopoWind | 383 (383–383) | 1471 (1441–1585) | 2718 (2696–3099) | 0,560 (0,521–0,568) | 0,588 (0,547–0,596) | 1506 (1494–1870) | 0,77 (0,76–0,79) |
| x1 | 6 + velocidade × 1,5 (semente 1) | 757 | 3362 | 6459 | 0,319 | 0,334 | 5148 | 0,93 |
| x2 | 6 + vento × 2 (semente 1) | 831 | 4073 | 6545 | 0,312 | 0,326 | 5251 | 0,89 |
| 7 | 6 + linhas de ataque, hora do fogo observado | 372 (368–520) | 1578 (1555–1982) | 2530 (2459–3126) | 0,587 (0,512–0,602) | 0,617 (0,538–0,630) | 1321 (1260–1910) | 0,82 (0,82–0,84) |
| 8 | 6 + linhas de ataque, hora do fogo do modelo | 359 (357–472) | 1600 (1586–1996) | 2675 (2646–3097) | 0,575 (0,522–0,585) | 0,605 (0,550–0,614) | 1450 (1421–1863) | 0,84 (0,84–0,85) |

**Grelhas:** `fires/CabeceirasdeBasto_06092016/grid.png` e `grid_wind.png`, como as de Vieira, com copas.

- **A régua é mais baixa aqui:**
  - **O vento é fraco e muda de direção:** o vetor médio tem 1,2 km/h, contra 6,2 km/h de velocidade média. Por isso a elipse é quase um círculo (LB 1,2), e o `b_vento` fica em 0,469, pouco acima dos 0,423 do círculo.
  - **O fogo real cresce para norte a partir do passo 0,** e uma mancha à volta dele não o apanha.
  - **A API fica 0,16 acima da elipse,** contra 0,03 em Vieira.
- **O melhor é o passo 3** (humidades de hora a hora, copas e cicatrizes, com os combustíveis S&B): 0,732 com copas e 0,738 sem.
  - As cicatrizes cortam a área final de 1685 para 1269 ha, e a de fora do oficial de 570 para 259 ha.
  - As 11 cicatrizes dos 40 dias antes têm 504 ha dentro da grade.
- **A configuração de Vieira não transfere, com ou sem copas.** Os combustíveis portugueses e as vivas de seca, que em Vieira são o que mais ajuda, aqui queimam de mais:
  - **com copas:** o passo 5 tem 2226 ha no fim, contra 1334 observados. Com projeções e linhas, os passos 6 a 8 ficam entre 0,614 e 0,631, contra 0,732 do passo 3;
  - **o que as copas fazem:** travam estes combustíveis, mas não chega. O passo 5 desce de 2703 para 2226 ha (0,583 → 0,628), e o passo 6 de 2734 para 2362 ha (0,580 → 0,618);
  - **nos passos com combustíveis S&B** as copas quase não mudam nada: no passo 3, 0,738 sem copas e 0,732 com;
  - falta perceber porquê (ver "Problemas em aberto").
- **A direção falha em todas as corridas, com ou sem copas:**
  - às 13:30 nenhuma corrida da grelha apanha o lóbulo norte (o azul em cima na grelha). Ficam à volta do passo 0, com 237 a 383 ha (medianas, com copas), contra 594;
  - às 12:30 do dia seguinte, o que queimam a mais (o vermelho) fica a oeste, a sudoeste e a sul, e continua a faltar o canto nordeste;
  - aqui o fogo do modelo não é só lento: vai também para o lado errado.
- **O vento:**
  - **TopoWind:** sem copas ajudava (0,626 contra 0,580). Com copas fica dentro do intervalo das sementes (0,623 contra 0,618), como em Vieira. Bate com a ideia de que, debaixo das árvores, o ELMFIRE corta o vento ao ponto de um vento melhor quase não contar.
  - **CERRA** piora nos dois casos: 0,593 com copas, 0,520 sem.
- **As copas de antes do fogo (5f, 6f, 8f)** quase não mudam nada aqui:
  - 5f fica em 0,617 contra 0,628; 6f em 0,618, igual ao 6; 8f em 0,623 contra 0,614, dentro do intervalo das sementes;
  - **e não é por o anacronismo ser pequeno:** o pinhal ardido em 2016 (17 % da área ardida) tem hoje 3,4 m e 7 % de cobertura. O `--canopy-fill` põe-lhe 15,1 m e 72 %;
  - **a explicação provável:** metade da área ardida são matos na COS, e o `--canopy-fill` tira-lhes copa (24 → 4 % de cobertura; ver "Coisas a saber"). Em média, dentro da área ardida, a cobertura só sobe de 25 para 31 %;
  - aqui as projeções também contam pouco (passo 5: 0,628; passo 6: 0,618). Por isso não há o efeito de Vieira, onde as copas de antes do fogo impediam as projeções de arrancar.
- **As linhas:**
  - com copas, a 7 sobe um pouco (0,631 contra 0,618 do 6), e a área fora do oficial desce de 1153 para 999 ha;
  - a 8 fica em 0,614;
  - as duas empatam semente a semente: cada uma ganha em 5 das 10.
- **Calibrar** (x1, x2) queima de mais: 3700–4500 ha no fim com copas (0,42–0,49), perto de 6500 sem (0,31–0,32).
- **O satélite** fica entre 0,68 e 0,84 (medianas) em todas as corridas do modelo, com ou sem copas, sem contar a calibração. Queimar de mais também alcança focos (ver "Pontuação").

## Histórico de decisões e erros corrigidos (20–21/10/2026)

1. **O ponto de partida:** o ELMFIRE da API fazia 155 ha às 15:00, contra 707 observados (passo 0).
2. **Juntar os registos:** primeiro a ficha do SGIF (FWI e DC mostram uma seca extrema) e o perímetro oficial.
   - **As cicatrizes:** a de Sobradelo da Goma explica a divisão do fogo a oeste.
   - **O FIRMS:** confirma a velocidade da corrida principal e revela um fogo na noite anterior que não está no SGIF.
3. **Mudar os dados de entrada, um passo de cada vez:** combustíveis portugueses (a ficha dá M-PIN na ignição), vivas de seca e projeções.
4. **Calibrar foi rejeitado.** A velocidade × 1,5 e o vento × 2 acertam nas 15:00 mas queimam de mais depois. Com × 2,5 o ELMFIRE queima 0 ha sem dar erro.
5. **Linhas de ataque v1:** inferidas das estradas que o perímetro oficial segue. Numa revisão apareceu uma falha de 160 m no flanco sul, por onde o fogo fugia. A causa eram três erros na derivação, todos corrigidos:
   - **Os 300 m mínimos aplicavam-se a cada pedaço entre cruzamentos.** Passaram a aplicar-se a cada troço ligado.
   - **Contavam estradas que o fogo atravessou.** Entrou o teste do "ao longo do perímetro".
   - **Faltavam ligações onde o OSM não tem estrada.** Entraram os `connector` até 250 m.

   Também se verificou que o perímetro não tem buracos. Com as correções, a área fora do oficial caiu cerca de 35 % (na cadeia do FireRenderer, 337 → 214 ha).
6. **O `test.sh` encontrou o artefacto dos troços:** partir a corrida acrescenta ~1 % de área. Por isso o teste compara com a mesma corrida partida.
7. **O adapter estendido** dá exatamente o mesmo que o de origem quando o pedido não usa os campos novos (testado célula a célula).
8. **O vento do Carlos** (CERRA e TopoWind) foi testado primeiro com as linhas, o que não isolava o efeito, e depois sem elas. Fica dentro do ruído das sementes (TopoWind) ou abranda a corrida principal (CERRA).
9. **Linhas v2:** as mesmas estradas, com a hora do fogo do modelo. É a melhor configuração atual (passo 8).
10. **Os meses do SGIF:** o `evidence.py` só pedia o mês do alerta e o mês 40 dias antes, e saltava os do meio. Em Cabeceiras (alerta a 6/09) faltava agosto inteiro: 6 cicatrizes em vez de 11, com Cavez (404 ha) de fora. Agora pede todos os meses. Vieira não muda; os números de Cabeceiras acima já são os corrigidos.
11. **As referências ingénuas** (`baseline.py`): faltava uma régua para dizer se um Sørensen de 0,7 é bom. Começou pelo círculo à volta do passo 0 (`b_uniforme`), fraco de mais para servir de régua. Entrou depois a elipse a favor do vento médio, com a forma de Alexander (1985) (`b_vento`).
   - Ambas sabem a área observada de cada passo, que nenhum modelo sabe, por isso são uma régua exigente.
   - **Vieira:** `b_vento` dá 0,69 no último passo, contra 0,73 da API, 0,78 só com dados (passo 6) e 0,83 com as linhas v2 (passo 8), medianas de 10 sementes.
   - **Cabeceiras:** dá 0,47 (o círculo 0,42), contra 0,63 da API.
12. **Dez sementes, e a máquina no `result.json`:** com 3 sementes o intervalo dependia de qual calhava. Verificou-se primeiro o que é ruído e o que não é:
   - a mesma semente dá exatamente o mesmo na mesma máquina, em série ou em paralelo (célula a célula);
   - entre um Mac arm64 e um x86_64 difere cerca de ±0,015 de Sørensen com projeções.

   O `result.json` passou a guardar a máquina e a imagem (`platform`). O `table.py` junta as sementes de cada corrida numa linha, com a mediana e o intervalo, e o `ladder.sh` corre-as em paralelo (`JOBS`).

   **As 3 sementes de antes tinham calhado do lado bom.** O passo 8 dava 0,84–0,85; com 10 dá mediana 0,827 (0,801–0,851). A vantagem da 8 sobre a 7 também encolheu: quase empatam no Sørensen e no satélite, e a 8 ganha fora do oficial (237 contra 269 ha).
13. **O anacronismo das copas** (`--canopy-fill`, passos 5f, 6f, 8f): o LiDAR é de 2024–25, e dentro da cicatriz de 2016 o pinhal ainda está a crescer (~12 m contra ~18 m à volta). A dúvida era se isto tornava a corrida lenta. Pôr dentro da área ardida as copas da mesma classe COS fora dela torna o fogo mais lento, não mais rápido. Sem projeções, 153 ha às 15:00 contra 348. Com projeções, estas quase nunca arrancam: mediana de 152 ha contra 417. Ficam as copas de hoje, e a suspeita volta ao abrigo do vento. Ao correr Cabeceiras viu-se que o `--canopy-fill` mexe em duas coisas: adensa as florestas e tira a copa aos matos, metade da área ardida. Em Cabeceiras quase não muda nada (ver "Coisas a saber").
14. **A escada toda em Cabeceiras:** antes tinha só 3 corridas. Agora tem todos os passos, com as referências e 10 sementes: primeiro sem copas (commit `376d842`), depois com o `canopy.npz` do LiDAR. O melhor é o passo 3 nos dois casos (0,738 sem copas, 0,732 com). Os combustíveis portugueses e as vivas de seca queimam de mais: as copas travam-nos (passo 6: 2734 → 2362 ha), mas não chega. Nenhuma corrida apanha o lóbulo norte das primeiras horas.
15. **O `dgt_tiles.py`:** procura os tiles do LiDAR que cobrem a grade na pesquisa STAC aberta da DGT e descarrega-os com a conta do utilizador. Antes era à mão no portal.
16. **A memória do Docker:** a primeira escada de 10 sementes corria os dois incêndios ao mesmo tempo e perdeu corridas: o Docker matou contentores por falta de memória (código 137). O `run.py` mostrava só "ELMFIRE falhou", sem o código. Agora mostra o código e a causa provável, e o `ladder.sh` espera pelo lote inteiro antes de parar. As escadas correm um incêndio de cada vez. Com outros contentores a ocupar parte da VM, Cabeceiras voltou a perder corridas com `JOBS=2` e correu com `JOBS=1`. O pico medido em Cabeceiras (`docker stats`, de segundo a segundo) foi 1,73 GiB por contentor.

## Ramos e projetos relacionados

- **`main` (Bruno):** a API (`api/`), os motores (`engines/`), os pacotes dos incêndios (`scripts/`, `web/public/fires/`), a web. Esta pasta usa `api/fires.py`, `api/runs.py`, `engines/elmfire/` e o `osm.json` de cada incêndio, sem os alterar.
  - **Integração:** `hindcast-registos` → `main` por pull request. Fora de `hindcast/`, este ramo só acrescenta uma linha a `README.md`, `data/README.md` e `docs/plan.md`, mais os ficheiros do vento do Carlos. Em 21/10/2026 o merge com o `main` não tinha conflitos.
- **`feature/cerra-wind-engine` (Carlos):**
  - `scripts/fetch_weather_cerra.py` e `build_weather_cerra.py` → `weather_cerra.json`;
  - `scripts/build_wind_field.py` (TopoWind: aceleração e abrigo pelo declive e exposição, desvio de até 25°, brisa de encosta de dia);
  - `scripts/build_fuel_moisture.py` (Simard) e o acoplamento do FWI.
  - O `--weather cerra` e o `--topowind` daqui leem esses ficheiros. Os três scripts do vento e os `weather_cerra.json`/`wind_summary_cerra.json` de Vieira e Cabeceiras vieram para este ramo por cherry-pick (`e9be1ca`), iguais aos do ramo dele; o `build_fuel_moisture.py` não (o `run.py` tem a sua própria humidade de Simard).
  - O `scripts/replicate_hindcast_comparison.py` desse ramo usa um modelo de propagação próprio, simples, e não o ELMFIRE. Os números dele não se comparam com os daqui.
- **`cerra-wind-hindcast-integration` (Hugo):**
  - o incêndio de Alijó, 2019 (`scripts/build_alijo_fire_package.py`, `hindcast/fires/Alijo_24072019/evidence.json` no formato do `evidence.py`);
  - imagens de comparação feitas sobre os resultados desta pasta.
- **`feature/multi-agency-reporting` (Carlos):** interface e relatórios; não toca nesta pasta.
- **FireRenderer** (pastas irmãs `../FireRenderer`, `../FireRenderer_VieiraMinho`, fora deste repositório): os mesmos métodos noutra grade, para os vídeos em Unreal Engine.
  - **As ferramentas de lá:** `tools/terrain/src/terrain/evidence.py`, `attack.py` e `elmfire.py` correm numa grade ortográfica de 20 m e partem do ponto de ignição, não do perímetro do passo 0. Por isso os números diferem um pouco.
  - **O adapter de lá:** `tools/elmfire/adapter.py` é o mesmo ficheiro que `engine/adapter.py`. Depois de integrado, o daqui é o de referência.
  - **O "cenário B" dos vídeos de Vieira:** é a configuração do passo 7 nessa cadeia (semente 1).

## Coisas a saber

- **O ELMFIRE falha sem erro com fogos muito rápidos:** com vento × 2,5 ou velocidade × 2,5 queima 0 ha. O `run.py` avisa em `notes` quando o fogo não sai do ponto de partida.
- **Cortar a corrida acrescenta área.** Cada troço recomeça a partir das células já ardidas, e a frente salta para as arestas delas. Em Vieira, partir 5 h em 3 troços acrescenta 1,2 % de área, com ou sem linhas; o `POST /api/run` faz o mesmo. O `test.sh` compara as linhas com a mesma corrida partida, sem linhas.
- **Linhas que começam depois do fim** ficam de fora da corrida, com um aviso. A API recusa-as.
- **As copas são as de hoje.** O `canopy.npz` vem do LiDAR da DGT de 2024–25, oito ou nove anos depois dos fogos. A altura da base e a densidade da copa são valores típicos por classe COS: são assumidas, não medidas (`canopy.json`).
  - **O teste do anacronismo (5f, 6f, 8f):** o `--canopy-fill` põe em cada célula dentro da área ardida (perímetro oficial e passos observados) a mediana da mesma classe COS fora dela e fora das cicatrizes. É uma estimativa das copas de antes do fogo.
  - **Mexe em duas coisas, não numa.** Médias dentro da área ardida, hoje → com `--canopy-fill`:

    | | Vieira | Cabeceiras |
    |---|---|---|
    | Florestas (COS 5.x), parte da área ardida | 39 % | 35 % |
    | Florestas, cobertura | 70 → 86 % | 33 → 79 % |
    | Pinhal, parte da área ardida | 5 % | 17 % |
    | Pinhal, altura e cobertura | 11,8 m e 57 % → 17,9 m e 80 % | 3,4 m e 7 % → 15,1 m e 72 % |
    | Matos, parte da área ardida | 50 % | 51 % |
    | Matos, cobertura | 16 → 3 % | 24 → 4 % |
    | Tudo, altura e cobertura | 9,9 m e 37 % → 10,8 m e 35 % | 5,6 m e 25 % → 8,4 m e 31 % |

    As florestas ficam mais densas e mais altas, e devem abrigar mais o vento. Os matos perdem a copa que têm hoje, porque fora da área ardida a mediana dos matos quase não tem árvores, e devem ficar mais expostos. Os dois efeitos devem puxar em sentidos contrários.
  - **Em Vieira o fogo fica mais lento,** não mais rápido: no passo 5, de 348 para 153 ha às 15:00, e com projeções estas quase nunca arrancam.
  - **Em Cabeceiras quase não muda** (passo 5: 0,617 contra 0,628; passo 8: 0,623 contra 0,614), apesar de o anacronismo ser maior: o pinhal ardido em 2016 quase não tem copa hoje.
  - **Conclusão:** as copas de hoje não explicam a corrida principal lenta de Vieira; se alguma coisa, ajudam-na. Ficam as de hoje: as de 2016 seriam um palpite, e o `--canopy-fill` mistura dois efeitos.
- **Debaixo das árvores** o ELMFIRE usa um vento abrigado de ~10–15 % do vento a 10 m. É o que mais trava o fogo na floresta, e é porque um vento melhor (CERRA, TopoWind) quase não muda nada.
- **Ponto de partida:** as corridas partem do perímetro do passo 0, como a API.
- **Sementes:** as projeções são aleatórias. Comparem-se sempre várias sementes antes de dizer que uma mudança ajuda.
- **Memória do Docker:** cada corrida é um contentor do ELMFIRE de até ~1,7 GiB (1,73 GiB medidos em Cabeceiras), e o `ladder.sh` tem `JOBS` deles ao mesmo tempo. Com as escadas dos dois incêndios em simultâneo, `JOBS=4` cada, eram 8 contentores. Numa VM do Docker de ~7,7 GB o Docker matou alguns (código 137, sem mais mensagem). Agora:
  - o `run.py` mostra o código de saída do ELMFIRE e, no 137, diz que é falta de memória;
  - o `ladder.sh` espera pelo lote inteiro de sementes e para com erro se alguma falhou;
  - `JOBS=2` chega quando a VM está livre. Com outros contentores a ocupar parte dela, `JOBS=1` é o seguro. Na dúvida, vê-se a memória total em `docker info` (`Total Memory`) e a que está ocupada em `docker stats`.
- **O `engine/run.sh` monta `engines/elmfire/vendor/elmfire/build/source/fuel_models.csv`.** O `vendor/` não está no git, mas existe sempre depois do `engines/elmfire/setup.sh`.
- **Fontes na rede:**
  - **ICNF:**
    - `fogos.icnf.pt` só responde por HTTPS; por HTTP fica pendurado.
    - As páginas `IncPrint.asp` dão erro 500. O `webserviceocorrencias.asp` funciona.
    - Se o ICNF não responder, o espelho `github.com/cityxdev/icnf_fire_data` tem os mesmos campos em CSV por ano.
  - **FIRMS:** os ficheiros anuais por país não pedem chave; a API do FIRMS pede.
  - **Imprensa:** o JN recusa (403) clientes sem cabeçalho de browser.

## Problemas em aberto e próximos passos

1. **A corrida principal continua lenta.** A suspeita é o abrigo do vento debaixo das copas, combinado com projeções de curta distância. O teste das copas de antes do fogo (5f, 6f, 8f) afastou a outra explicação, a de as copas de hoje serem mais baixas. Ensaios por fazer:
   - um fator de vento fixo debaixo dos povoamentos (por exemplo 0,3–0,4). O ELMFIRE calcula sempre o fator a partir da cobertura e da altura das copas (`CALC_WIND_ADJUSTMENT_FACTOR_EVERYWHERE`), e não o lê de nenhum raster. A única entrada é uma soma global para ensembles (`RASTER_TO_PERTURB = 'WAF'` no `&MONTE_CARLO`), que o `engine/adapter.py` teria de passar. A alternativa é um patch na imagem;
   - projeções de longa distância para o eucalipto (os parâmetros `&SPOTTING`).
2. **O fogo da noite anterior** (focos das 23:25 às 03:56 dentro do perímetro oficial): falta uma opção de partida que o inclua. O FireRenderer tem `--start night`, mas as pegadas de 1 km do MODIS fazem a área grande de mais.
3. **Cabeceiras: a configuração de Vieira não transfere.** Com as copas do LiDAR, os combustíveis portugueses e as vivas de seca ainda queimam de mais (passo 5: 2226 ha no fim, contra 1334). Nenhuma corrida apanha o lóbulo que o fogo real fez para norte até às 13:30. Ensaios por fazer:
   - **outro modelo de matos** (`--shrub`): metade da área ardida são matos, e o V-MAa foi escolhido a pensar nos montes de Vieira. É no passo 4, quando entram os combustíveis portugueses, que a área final sobe de 1269 para 1715 ha;
   - **as vivas de seca:** os 30 % e 70 % são os mesmos nos dois fogos. Falta ver se a ficha do SGIF de Cabeceiras (DC e BUI) os justifica;
   - **o vento das primeiras horas:** o vetor médio tem 1,2 km/h, e nem o ERA5, nem o CERRA, nem o TopoWind empurram o fogo para norte.
4. **Integrar no motor e na API:** passar `fuel_models`, `layers.adj`, `spotting` e `seed` para `engines/elmfire/adapter.py` e para `engines/CONTRACT.md`, e os combustíveis portugueses e as cicatrizes para o cenário da API.
5. **O artefacto dos troços na API:** recomeçar a partir das horas de chegada já calculadas (o `phi` do ELMFIRE), e não de uma máscara.
6. **Linhas melhores precisam de dados que não são abertos:**
   - para as linhas reais, os registos da ANEPC ou da GNR (pedido formal);
   - para a defesa das aldeias, casas melhores do que as do OSM (BGRI do INE).

## Como acrescentar um incêndio

1. **O pacote:** em `web/public/fires/<id>/`, feito pelos `scripts/build_*.py` do `main`. Precisa do `incidentId` no `fire.json`, que é o n.º ANEPC e o `NCCO` no SGIF, e do `osm.json`.
2. **Os registos:** `evidence.py <id>`. Confirma no `evidence.png` que o perímetro oficial bate com o PT-FireSprd.
3. **As copas, se possível:** `dgt_tiles.py <id> --out <pasta>` (pede o login do portal da DGT) e depois `canopy.py <id> --dgt <pasta>`, com uma pasta fora do repositório.
4. **As linhas:** `attack.py <id>`.
5. **As corridas:** `ladder.sh <id>`. Depois acrescenta-se a tabela do incêndio em "Resultados".

## Fontes e créditos

- **ICNF, SGIF** (Sistema de Gestão de Informação de Incêndios Florestais), com os perímetros da GNR/GTF ligados às fichas.
- **NASA FIRMS:** VIIRS S-NPP 375 m e MODIS C6.1. "We acknowledge the use of data and imagery from LANCE FIRMS operated by NASA's Earth Science Data and Information System (ESDIS)".
- **Modelos de combustível:**
  - Fernandes, P., Gonçalves, H., Loureiro, C., Fernandes, M., Costa, T., Cruz, M.G., Botelho, H. (2009). *Modelos de combustível florestal para Portugal*. 6.º Congresso Florestal Nacional, SPCF.
  - Parâmetros tabelados por Paixão, L. (2017), tese de mestrado, NOVA Lisboa.
- **Copas:** LiDAR nacional da DGT (MDS e MDT a 2 m, 2024–25).
- **Imprensa:** JN/Lusa (11/08/2016) e RTP (10/08/2016), ligações em `evidence.py`. Relatório provisório RIF05/2016 do ICNF.
- **Outros:** ELMFIRE, de Chris Lautenberger (EPL 2.0). OpenStreetMap (ODbL), via `osm.json`.
