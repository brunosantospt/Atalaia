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

## Ficheiros

| Ficheiro | O quê |
|---|---|
| `evidence.py` | Registos de um incêndio → `fires/<id>/evidence.json`, `evidence.geojson`, `evidence.png` |
| `attack.py` | Linhas de ataque inferidas → `fires/<id>/attack_lines.json`, `attack_lines.png` |
| `run.py` | Uma corrida do ELMFIRE com opções → `fires/<id>/runs/<nome>/result.json`, `preview.png` (a grade de chegada vai para `data/hindcast/<id>/<nome>.npy`) |
| `table.py` | As corridas de um incêndio numa tabela Markdown |
| `common.py` | Pacote do incêndio (via `api/fires.py`), chegada observada interpolada, pontuação |
| `fuels.py` | Modelos de combustível portugueses e a tradução da COS 2015 |
| `engine/run.sh`, `engine/adapter.py` | O ELMFIRE de `engines/elmfire` (mesma imagem Docker, mesmo contrato) com quatro campos opcionais a mais no pedido |
| `fires/<id>/canopy.npz` | Camadas de copa para o modelo de fogo de copas (só Vieira do Minho; ver `canopy.json`) |
| `setup.sh`, `requirements.txt`, `test.sh` | Ambiente e teste |

Os descarregamentos (SGIF, KML, FIRMS) ficam em `data/hindcast/`, fora do git, como os outros dados.

## Como correr

```bash
hindcast/setup.sh                                   # uma vez: hindcast/.venv
engines/elmfire/setup.sh                            # uma vez: a imagem Docker do ELMFIRE
hindcast/.venv/bin/python -I hindcast/evidence.py VieiradoMinho_10082016
hindcast/.venv/bin/python -I hindcast/attack.py VieiradoMinho_10082016
hindcast/.venv/bin/python -I hindcast/run.py VieiradoMinho_10082016 --name 6_linhas \
    --fuels pt --scars --live-herb 30 --live-woody 70 --spotting \
    --barriers hindcast/fires/VieiradoMinho_10082016/attack_lines.json
hindcast/.venv/bin/python -I hindcast/table.py VieiradoMinho_10082016
hindcast/test.sh                                    # ponta a ponta em Vieira, ~20 s
```

- **Tempo:** uma corrida de 22,5 h demora 10 a 40 s (mais quando as linhas a partem em troços).
- **O que se escolhe:**
  - `--fuels sb|pt`, `--shrub`: os combustíveis;
  - `--scars`: as cicatrizes;
  - `--dead emc|fixed`, `--live-herb`, `--live-woody`: as humidades;
  - `--no-canopy`: sem copas;
  - `--spotting --seed n`: as projeções;
  - `--adj`, `--wind-mult`: os fatores de calibração;
  - `--barriers`: as linhas;
  - `--start-step`, `--duration-min`: o início e a duração.
- **A corrida igual à da API:** `--fuels sb --dead fixed --no-canopy` dá os mesmos dados de entrada que o `POST /api/run`.

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
- **Cicatriz ao lado:** 254 ha em Rio Douro, a 2/09.

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
- **Vieira:** 33 linhas, 13,6 km, ao longo de 11,5 dos 34 km do perímetro. Outros 3 km do perímetro correm junto a cicatrizes, e ficam de fora 30 estradas atravessadas.
  - Os flancos sul e leste seguram a partir das 2–3 h.
  - O flanco norte segura sobretudo a partir das 11 h (21:00).
- **Cabeceiras:** 46 linhas, 15,0 km.
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
  - **Lê-se sempre com "Fora do oficial".** Só conta focos alcançados, por isso queimar de mais não custa nada: em Cabeceiras a corrida como a API tem 0,81 queimando 990 ha fora do perímetro oficial, e as corridas com velocidade × 1,5 chegam a 1,00.

## Resultados

### Vieira do Minho, 22,5 h a partir das 10:00 (perímetro do passo 0)

Cada linha acrescenta uma coisa à anterior, e as corridas com projeções têm três sementes.

| Corrida | 15:00 (5 h) | 03:30 (17,5 h) | 08:30 (22,5 h) | Sørensen último passo | Sørensen oficial | Fora do oficial | Satélite |
|---|---|---|---|---|---|---|---|
| Observado (PT-FireSprd) | 707 ha | 1573 ha | 1621 ha | | | | |
| 0. Como a API (S&B, humidades fixas, sem copas) | 155 | 1355 | 1798 | 0,73 | 0,75 | 442 ha | 0,38 |
| 1. Humidades mortas da meteo, copas do LiDAR | 144 | 1182 | 1497 | 0,72 | 0,77 | 212 | 0,35 |
| 2. + cicatrizes | 144 | 1136 | 1405 | 0,74 | 0,79 | 121 | 0,35 |
| 3. + combustíveis portugueses | 219 | 1321 | 1646 | 0,78 | 0,83 | 196 | 0,46 |
| 4. + vivas de seca (30 % e 70 %) | 348 | 1639 | 2077 | 0,76 | 0,82 | 476 | 0,59 |
| 5. + projeções (3 sementes) | 380–456 | 1660–1858 | 2128–2353 | 0,76–0,79 | 0,82–0,84 | 497–595 | 0,65–0,74 |
| **6. + linhas de ataque inferidas (3 sementes)** | **407–489** | **1577–1658** | **1918–1976** | **0,81–0,84** | **0,87–0,89** | **258–316** | **0,66–0,73** |

- **As cicatrizes** cortam para metade a área ardida fora do perímetro oficial (212 → 121 ha). O fogo passa a dividir-se à volta de Sobradelo da Goma, como o real.
- **Só com dados** (linhas 0 a 5, sem linhas de ataque), o Sørensen do último passo vai de 0,73 a 0,76–0,79. As linhas de ataque levam-no a 0,81–0,84, mas estão traçadas ao longo do perímetro final: essa parte do ganho é por construção.
- **Os combustíveis portugueses** sobem o Sørensen do último passo de 0,74 para 0,78. Com as vivas de seca, a corrida principal fica com mais do dobro da da API (155 → 348 ha às 15:00).
- **As linhas,** nas três sementes:
  - cortam cerca de metade da área fora do perímetro oficial (≈ 530 → ≈ 280 ha);
  - sobem o Sørensen em cerca de 0,05;
  - **não baixam o satélite.**
- **Ainda lento na corrida principal:** às 15:00 tem 380–490 ha, contra 707. Há três razões prováveis:
  - os ventos locais (as rajadas de 80 km/h);
  - as projeções a longa distância no eucalipto;
  - o fogo da noite anterior.
- **Calibrar** não resolve:
  - **Velocidade × 1,5** (`--adj`): acerta nas 15:00 mas alarga também os flancos, e o fogo chega a 3600 ha de manhã.
  - **Vento × 2** (`--wind-mult`): dá uma forma mais estreita, mas também queima de mais.
  - **CERRA** (reanálise de 5,5 km): tem menos vento à tarde do que o ERA5, e fica ainda mais lento.

  Estes três ensaios foram feitos no FireRenderer, com a mesma cadeia.
- **Limite do ELMFIRE:** com vento × 2,5 ou velocidade × 2,5 falha sem erro: queima 0 ha. O `run.py` avisa quando o fogo não sai do ponto de partida.

### Cabeceiras de Basto, 32,5 h a partir das 04:00 (sem copas: não há LiDAR desta zona)

| Corrida | 13:30 (9,5 h) | 00:30 (20,5 h) | 12:30 (32,5 h) | Sørensen último passo | Sørensen oficial | Fora do oficial | Satélite |
|---|---|---|---|---|---|---|---|
| Observado (PT-FireSprd) | 594 ha | 1243 ha | 1334 ha | | | | |
| 0. Como a API | 298 | 1153 | 2157 | 0,63 | 0,66 | 990 ha | 0,81 |
| 5. Configuração de Vieira, sem linhas | 439 | 1897 | 3214 | 0,53 | 0,56 | 1935 | 0,86 |
| 6. Configuração de Vieira, com linhas | 373 | 1752 | 2902 | 0,55 | 0,57 | 1671 | 0,85 |

- **A configuração de Vieira não transfere sem copas:** queima de mais. Em Vieira, sem copas, a mesma configuração também chegava a 3000 ha. A proteção do vento debaixo das árvores é o que trava o ELMFIRE na floresta.
- **Falta o LiDAR:** com as copas do LiDAR da DGT (precisa de login) este teste fica justo.
- **As linhas ajudam também aqui:** −312 ha.

## Coisas a saber

- **Cortar a corrida acrescenta área.** Cada troço recomeça a partir das células já ardidas, e a frente salta para as arestas delas. Em Vieira, partir 5 h em 3 troços acrescenta 1,2 % de área, com ou sem linhas; o `POST /api/run` faz o mesmo. O `test.sh` compara as linhas com a mesma corrida partida, sem linhas.
- **As copas são as de hoje.** O `canopy.npz` vem do LiDAR da DGT de 2024–25, agregado às células de 30 m pelo FireRenderer. Dentro da cicatriz de 2016 o pinhal tem hoje cerca de 10 m, contra 18 m à volta. A altura da base e a densidade da copa são valores típicos por classe COS: são assumidas, não medidas (`canopy.json`).
- **Ponto de partida:** as corridas partem do perímetro do passo 0, como a API. O FireRenderer parte do ponto de ignição; os números diferem um pouco por isso, e porque a grade de lá tem 20 m.
- **Sementes:** as projeções são aleatórias. Comparem-se sempre várias sementes antes de dizer que uma mudança ajuda.

## Fontes e créditos

- **ICNF, SGIF** (Sistema de Gestão de Informação de Incêndios Florestais), com os perímetros da GNR/GTF ligados às fichas.
- **NASA FIRMS:** VIIRS S-NPP 375 m e MODIS C6.1. "We acknowledge the use of data and imagery from LANCE FIRMS operated by NASA's Earth Science Data and Information System (ESDIS)".
- **Modelos de combustível:**
  - Fernandes, P., Gonçalves, H., Loureiro, C., Fernandes, M., Costa, T., Cruz, M.G., Botelho, H. (2009). *Modelos de combustível florestal para Portugal*. 6.º Congresso Florestal Nacional, SPCF.
  - Parâmetros tabelados por Paixão, L. (2017), tese de mestrado, NOVA Lisboa.
- **Copas:** LiDAR nacional da DGT (MDS e MDT a 2 m, 2024–25).
- **Imprensa:** JN/Lusa (11/08/2016) e RTP (10/08/2016), ligações em `evidence.py`. Relatório provisório RIF05/2016 do ICNF.
- **Outros:** ELMFIRE, de Chris Lautenberger (EPL 2.0). OpenStreetMap (ODbL), via `osm.json`.
