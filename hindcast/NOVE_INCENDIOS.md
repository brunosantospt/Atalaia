# Nove incêndios: onde o ELMFIRE falha e o que fazer (22/10/2026)

Os números são do `MULTIFIRE.md`, gerado pelo `multifire_report.py`. Este texto lê-os e diz o que fazer com eles.

> **RASCUNHO:** os resultados passo a passo ainda estão a correr. As secções marcadas *(a completar)* mudam quando acabarem.

## A pergunta

Até 21/10/2026 o ELMFIRE do Atalaia só tinha sido testado em dois incêndios do Minho (Vieira do Minho e Cabeceiras de Basto, 2016). A pergunta era:
- se é fiável noutros incêndios;
- porque falha;
- que dados de entrada, disponíveis em tempo real, o tornam melhor;
- se, não chegando, há uma alternativa, por exemplo um ensemble.

Os professores apontaram como fatores principais o combustível, o vento e o declive. As projeções também podem pesar muito.

## O que se fez

1. **Sete incêndios novos do PT-FireSprd v2** (Benali et al. 2023), um por ano de 2015 a 2021, mais os dois do Minho. O PT-FireSprd só é aberto até 2021; 2022–24 pedem autorização dos autores. Os sete foram escolhidos para variar a região (do Minho ao Algarve), o combustível (matos, eucalipto, pinhal), o tamanho (1 300 a 24 000 ha) e o número de perímetros observados (4 a 24). A tabela "0" do `MULTIFIRE.md` tem as características de cada um.
2. **Pacotes completos** (`scripts/build_*.py` do `main`, `hindcast/multifire_build.sh`): grade, combustível COS 2015, terreno, ERA5, progressão, registos do SGIF, cicatrizes e copas.
   - Em Espanha e no mar, fora da COS, as células passaram a não combustíveis (código `0`).
   - As copas do LiDAR da DGT só existem para Vieira e Cabeceiras: o download pede login, e são centenas de tiles por incêndio. Para todos, `canopy_open.py` faz as copas a partir do mapa global aberto da Meta/WRI (Tolan et al. 2024, ~1,2 m, imagens de 2018–20), com o mesmo método do `canopy.py`.
3. **Dois testes:**
   - **Corrida livre** (`run.py`, como até aqui): parte do passo 0 e corre até ao último passo observado, sem combate. Monchique fica pelas 48 h, porque as 128 h não cabem na memória.
   - **Passo a passo** (`steps.py`, novo): recomeça em cada perímetro observado e prevê o seguinte. É o que um sistema em tempo real faria, e só conta o crescimento entre os dois perímetros.
4. **Uma régua em cada janela, sem modelo:**
   - **a regra dos 10 %** (Cruz & Alexander 2019): a cabeça anda a 10 % do vento a 10 m, numa elipse a favor do vento;
   - **a persistência** (`references.py`): o fogo cresce à mesma taxa da janela anterior;
   - **a elipse que sabe a área** (`references.py`): a mesma elipse, parada na área observada. É batota: mede o que vale acertar a área com uma forma que não conhece combustível nem relevo.
5. **As configurações** (`multifire_runs.sh`). Cada uma é um conjunto de opções do `run.py`:

   | Nome | O quê |
   |---|---|
   | K0 | a API até 21/10: S&B, humidades fixas 6/8/10 %, sem copas |
   | K3 | a API desde 22/10: S&B, humidades mortas de hora a hora, cicatrizes, copas do LiDAR (só em Vieira e Cabeceiras; nos outros sete, **sem copas**) |
   | K3m | K3 com as copas da Meta em todos |
   | K4 | K3 com os combustíveis portugueses (Fernandes et al. 2009) |
   | K5 | K4 com as vivas de seca (herbáceas 30 %, lenhosas 70 %) |
   | K5m | K5 com as copas da Meta |
   | K3s, K6, K6m | K3, K5, K5m com projeções (o modelo de origem do ELMFIRE, semente 1) |
   | K6d | K6 com a probabilidade de ignição das faúlhas a seguir a humidade do combustível fino (Schroeder 1969) |
   | K6x, K3x | projeções fortes: distância × 5, até 3 faúlhas, probabilidade de Schroeder |
   | K6s2–K6s5 | K6 com as sementes 2 a 5 |
   | K3c, K5c | K3, K5 com um fator por classe de combustível, ajustado nos *outros* incêndios (`calibrate.py`) |
   | K3g, K5g | o vento efetivo 30 % do caminho da média até à rajada |
   | `*_w08`, `*_w125`, `*_rm15`, `*_rp15` | membros do ensemble: vento × 0,8 e × 1,25, rodado −15° e +15° |

## Resultados

### Corridas livres: nenhuma configuração ganha em todo o lado

O Sørensen no último passo observado, mediana dos nove incêndios: a elipse que sabe a área (`b_vento`) dá 0,61.

| | K0 | K3 | K3m | K4 | K5 | K5m | K3s | K6 | K6m | K6d |
|---|---|---|---|---|---|---|---|---|---|---|
| Mediana | 0,59 | 0,60 | **0,69** | 0,66 | 0,61 | 0,61 | 0,60 | 0,61 | 0,60 | 0,60 |
| Incêndios em que é a melhor | 0 | 2 | **4** | 3 | 1 | 0 | 2 | 0 | 0 | 0 |

- **A área final varia até ×11 entre configurações do mesmo incêndio** (Vila de Rei: 0,24× com K3m, 2,73× com K6). É o combustível que decide:
  - **Com S&B** (K3) o fogo fica muito curto onde há pinhal e eucalipto: Oleiros 0,28×, Vila de Rei 0,25×, Sever do Vouga 0,48×. Nestes três, 70–90 % da área ardida é pinhal-bravo (COS 5.1.2.1) e eucaliptal (5.1.1.5). A tradução da COS dá-lhes o TU5 (folhada com sub-bosque), que com estes ventos anda devagar, sobretudo debaixo do abrigo das copas.
  - **Com os combustíveis portugueses** (K4, K5) esses três passam a arder de mais (1,3–3,6×): pinhal M-PIN, eucaliptal M-EUC.
  - **Os incêndios de mato disparam:** Vila Nova de Cerveira 4,4× (75 % de matos), Monchique 6,4× em 48 h. Todos os matos (COS 6.1.1.1) recebem o V-MAa, o mato alto com muita carga morta, escolhido para o tojo e a urze dos montes do Minho. No S&B são SH5, e Cerveira fica em 1,7×.
- **O modelo de mato muda muito.** Com o mato médio V-MMb (K5mm) em vez do V-MAa (K5), a mediana sobe de 0,62 para 0,65:
  - Cerveira 0,37 → 0,55 (área 4,4× → 2,4×);
  - Guarda 0,73 → 0,82;
  - Cabeceiras 0,63 → 0,70;
  - Vila de Rei 0,48 → 0,57.

  O V-MAb (mato alto com menos carga, K5b) dá quase o mesmo (0,655). O modelo de mato deve ser escolhido por região e não um só para o país: o V-MAa foi escolhido para os tojais do Minho, e no Algarve os matos são de esteva. Atenção: aqui a escolha foi feita nos mesmos incêndios em que se mede, por isso é uma pista e não uma prova. Fica por confirmar com incêndios de fora deste conjunto.
- **As copas da Meta** (K3m) travam o fogo onde o S&B já queimava de mais (Cerveira 1,71× → 1,29×), mas também onde já era lento (Oleiros 0,28× → 0,21×). Nas copas o ELMFIRE abriga o vento (~10–15 % do vento a 10 m), e isso pesa mais do que o fogo de copas.
- **As vivas de seca** (K5 contra K4) aceleram tudo mais 20–30 %. Ajudam onde o K4 era curto e estragam onde já era comprido.
- **As projeções** com os parâmetros de origem quase não mudam nada: +0 a 4 % de área (K6 contra K5, K3s contra K3). O que queima de mais nas corridas com projeções são os combustíveis portugueses e as vivas de seca, não as projeções. A probabilidade de ignição de Schroeder (K6d) dá entre 24 e 60 % conforme o incêndio, contra 55 % fixos, e muda ainda menos.
- **As projeções fortes** (K6x: distância × 5, até 3 faúlhas) estragam todos os incêndios. Por exemplo, Cabeceiras passa de 0,63 para 0,32, com 4 875 ha fora do perímetro oficial (contra 1 033), e Cerveira tem 10 483 ha fora. É o que a Mara viu: projeções sem condições estragam os resultados.

A corrida livre não tem combate. Num incêndio que o combate segurou, queimar de mais não é necessariamente um erro do modelo. Por isso o teste que conta é o passo a passo.

### Passo a passo *(a completar)*

Ver `MULTIFIRE.md`, secção 2.

### Porque falha

O erro do ROS de cabeça por janela é log2(corrida / observado). O ROS de cabeça é o percentil 95 da distância que o crescimento vai além do perímetro de partida, por hora. Correlação de Spearman com as condições da janela, nas janelas com pelo menos 5 ha de crescimento observado (secção 3 do `MULTIFIRE.md`). Com o K3, 86 janelas de 9 incêndios, a mediana do erro é ×0,39. Com o K5, 74 janelas, é ×0,61.

- **As corridas rápidas é que ficam curtas** (ρ = −0,79 no K3, −0,86 no K5). Nas janelas lentas o modelo acerta ou passa; nas rápidas fica a metade ou a um quarto.
  - Parte disto é construção: o ROS observado está no denominador, e o erro de medida das horas dos perímetros puxa para aqui. O mesmo para a duração da janela (ρ = +0,59 e +0,67): as janelas curtas são as das corridas.
  - Mas é também o viés conhecido dos modelos de Rothermel em fogo de copas e eruptivo (Cruz & Alexander 2010, 2013). Nada no modelo acelera o fogo como as corridas reais: nem projeções longas, nem convecção, nem o fogo de copas a 30 m de célula.
- **O combustível é a condição que mais pesa:** quanto mais pinhal e folhosas na área nova, mais curto (ρ = −0,46 no K3, −0,30 no K5); quanto mais mato, menos (ρ = +0,28 no K3). Os modelos portugueses reduzem o viés das florestas mas não o apagam.
- **O declive:** o modelo fica mais curto nas encostas suaves (ρ = +0,34 nos dois). O que o fogo real faz em terreno suave e o modelo não é vento e projeções, não o declive; nas encostas o Rothermel já acelera.
- **O vento médio, a rajada, a temperatura e a humidade quase não explicam o erro** (|ρ| ≤ 0,20, nenhum significativo). O ERA5 é a 25 km e de hora a hora: não vê o vento local nem as rajadas, e por isso também não se vê o que o vento explicaria.
- **Mais do que tudo, o modelo queima a borda toda.** No teste passo a passo a área nova da corrida é 1,7× (K3) e 2,5× (K5) a observada, mas a cabeça é lenta (×0,39 e ×0,61). Entre dois perímetros observados, 85–99 % da borda não cresce (combate, ou o fogo apagou-se ali). O modelo reacende-a toda em cada recomeço, e a área vai para os flancos em vez de para a cabeça (secção "A borda ativa").
- **O erro da área persiste entre janelas curtas:** ρ = +0,58 nas janelas de até 2 h, +0,70 nas de até 6 h, +0,32 nas de até 24 h (K3, nove incêndios). Um primeiro olhar com cinco incêndios e o ROS de cabeça dava ρ = 0,06; com os nove e a área é outra coisa. Corrigir o fator de cada janela com o erro da anterior, reduzido a metade, baixa a mediana de |log2 área| de 1,61 para 1,15 no K5, fora de linha. A versão corrida é o K5as.

## A borda ativa

Num recomeço, o ELMFIRE põe a arder todas as células do perímetro de partida (`burned`), e o fogo sai de toda a borda. No incêndio real, entre dois perímetros observados só uma parte pequena da borda cresce: o resto foi apagado pelo combate ou parou sozinho.

**A parte da borda que não cresce até ao passo seguinte** (o oráculo: borda a mais de 2 células do crescimento observado) é **85–99 %** na maioria das janelas, e é 0 só no primeiro passo de cada incêndio. Se o modelo soubesse isto, deixaria de queimar os flancos. Em Vieira, ao recomeçar das 15:00, o Sørensen às 08:30 sobe de 0,761 para 0,833 e a área fora do oficial cai de 199 para 123 ha.

`run.py --active-edge` dá duas maneiras de o saber:
- **`hotspots`:** é o que um sistema em tempo real sabe. A borda continua a arder só perto dos focos de satélite das últimas `--active-window-h` horas (raio do píxel, pelo menos 500 m); o resto fica seguro (não combustível). Sem focos na janela, fica a borda toda.
  - Com o VIIRS e o MODIS segura-se muito menos do que o oráculo: 0–90 % da borda, em vez de 85–99 %.
  - A causa é que as passagens são poucas por dia e os píxeis do MODIS têm 1 km.
  - O MTG-FCI (10 min, 1 km), o FRP do LSA SAF e, sobretudo, a informação da ANEPC sobre os setores ativos e dominados fariam isto muito melhor.
- **`oracle`:** a borda que de facto cresceu. Não é uma previsão, é o limite do que esta informação vale.

As referências (regra dos 10 %, persistência, elipse com a área certa) crescem da mesma borda (`references.py --active-edge`), para que a comparação não seja ganha por construção.

*(resultados do K5o, K5a: a completar)*

## O ponto de ignição em tempo real

O Carlos notou, em Alijó, que as coordenadas do alerta estavam erradas. Em Portugal regista-se por vezes o centro da freguesia ou um marco cívico no momento do alerta telefónico; o primeiro foco de satélite estava a 311 m. Nos nove incêndios mediu-se a distância do ponto do alerta no SGIF a três coisas: à ignição do PT-FireSprd, ao perímetro do passo 0 e ao foco mais próximo da primeira passagem de satélite que viu o fogo.

| Incêndio | Alerta → ignição PT-FireSprd | Alerta → perímetro do passo 0 | 1.ª passagem de satélite: foco mais próximo, horas depois do alerta, píxel |
|---|---|---|---|
| Vieira do Minho | 60 m | dentro | 185 m, 3,3 h, MODIS 1 km |
| Cabeceiras de Basto | 1 412 m | 1 242 m | 534 m, 6,6 h, MODIS |
| Vila Nova de Cerveira | 1 775 m | 1 513 m | 1 021 m, 1,8 h, MODIS |
| Sever do Vouga | 76 m | 30 m | — |
| Guarda | 213 m | dentro | 19 m, 0,1 h, VIIRS 375 m |
| Oleiros | 1 778 m | 1 783 m | 1 336 m, 7,3 h, MODIS |
| Castro Marim | 230 m | 216 m | 2 253 m, 1,7 h, MODIS (1 foco) |
| Vila de Rei | 634 m | 598 m | 938 m, 9,1 h, MODIS |
| Monchique | 282 m | 190 m | 221 m, 0,8 h, VIIRS |

- **O ponto do alerta erra de 60 m a 1,8 km:** em 5 dos 9 incêndios menos de 300 m, em 3 mais de 1,4 km. Alijó, com 311 m, está no meio.
- **Os satélites de órbita polar não o corrigem a tempo:** a primeira passagem que vê o fogo chega 0,1 a 9 h depois do alerta, quase sempre com píxeis de 1 km. O MTG-FCI (10 min, 1 km) e o VIIRS (375 m) é que podem.
- **Os números deste estudo não mudam:** as corridas partem do perímetro observado do passo 0, e as ignições seguintes vêm dos polígonos de ignição do PT-FireSprd, não do SGIF. Só o relógio (a hora do alerta) vem do SGIF.
- **Na API, um incêndio novo parte de um ponto, e esse ponto vem do alerta:**
  - deslocá-lo para o primeiro foco de satélite logo que haja um (MTG-FCI, VIIRS) e, depois, para o primeiro perímetro observado;
  - até lá, tratá-lo como incerto, com membros do ensemble deslocados até ~1–2 km. Benali et al. (2016) mostram que a incerteza da ignição pesa na previsão;
  - não pôr a ignição numa célula não combustível: o centro da freguesia cai muitas vezes numa aldeia ou numa estrada.

## Linhas molhadas

No teste de Vieira, uma linha de água que fica para sempre não combustível exagera o combate. Com `--wet-lines`, a linha molha o combustível fino (humidade de 1 h até 60 % × a fração da célula coberta) e seca com τ = 60 min. Só segura se for molhada outra vez:

| Linhas | Área às 08:30 (obs. 1 621 ha) | Fora do oficial | Sørensen |
|---|---|---|---|
| Nenhuma | 2 077 | 476 | 0,757 |
| Faixa permanente (as 91 do `attack_lines`) | 1 806 | 227 | 0,804 |
| Molhada, uma vez | 2 077 | 476 | 0,757 |
| Molhada de 60 em 60 min | 1 997 | 398 | 0,772 |
| Molhada de 30 em 30 min | 1 915 | 323 | 0,786 |

Com isto, o tempo de reabastecimento passa a ser um parâmetro físico em vez de uma barreira eterna. Não parte a corrida em troços (é uma humidade por banda de tempo).

## Calibração *(a completar)*

## Ensemble *(a completar)*

## Literatura

- Alexander, M.E., Cruz, M.G. (2013). Are the applications of wildland fire behaviour models getting ahead of their evaluation again? *Environmental Modelling & Software* 41: 65–71.
- Aragoneses, E., García, M., Salis, M., Ribeiro, L.M., Chuvieco, E. (2023). Classification and mapping of European fuels using a hierarchical, multipurpose fuel classification system. *Earth System Science Data* 15: 1287–1315.
- Benali, A., Ervilha, A.R., Sá, A.C.L., Fernandes, P.M., Pinto, R.M.S., Trigo, R.M., Pereira, J.M.C. (2016). Deciphering the impact of uncertainty on the accuracy of large wildfire spread simulations. *Science of the Total Environment* 569–570: 73–85.
- Benali, A., Sá, A.C.L., Ervilha, A.R., Trigo, R.M., Fernandes, P.M., Pereira, J.M.C. (2017). Fire spread predictions: sweeping uncertainty under the rug. *Science of the Total Environment* 592: 187–196.
- Benali, A. et al. (2023). The Portuguese Large Wildfire Spread database (PT-FireSprd). *Earth System Science Data* 15: 3791–3818.
- Cruz, M.G., Alexander, M.E. (2010). Assessing crown fire potential in coniferous forests of western North America: a critique of current approaches and recent simulation studies. *International Journal of Wildland Fire* 19: 377–398.
- Cruz, M.G., Alexander, M.E. (2013). Uncertainty associated with model predictions of surface and crown fire rates of spread. *Environmental Modelling & Software* 47: 16–28.
- Cruz, M.G., Alexander, M.E. (2019). The 10 % wind speed rule of thumb for estimating a wildfire's forward rate of spread in forests and shrublands. *Annals of Forest Science* 76: 44.
- Ellis, P.F.M. (2015). The likelihood of ignition of dry-eucalypt forest litter by firebrands. *International Journal of Wildland Fire* 24: 225–235.
- Fernandes, P. et al. (2009). Modelos de combustível florestal para Portugal. 6.º Congresso Florestal Nacional.
- Finney, M.A. et al. (2011). A method for ensemble wildland fire simulation. *Environmental Modeling & Assessment* 16: 153–167.
- Forthofer, J.M., Butler, B.W., Wagenbrenner, N.S. (2014). A comparison of three approaches for simulating fine-scale surface winds in support of wildland fire management. Part I. *International Journal of Wildland Fire* 23: 969–981.
- Lautenberger, C. (2013). Wildland fire modeling with an Eulerian level set method and automated calibration. *Fire Safety Journal* 62: 289–298.
- Pinto, R.M.S., Benali, A., Sá, A.C.L., Fernandes, P.M., Soares, P.M.M., Cardoso, R.M., Trigo, R.M., Pereira, J.M.C. (2016). Probabilistic fire spread forecast as a management tool in an operational setting. *SpringerPlus* 5: 1205.
- Rothermel, R.C. (1983). How to predict the spread and intensity of forest and range fires. USDA Forest Service GTR INT-143.
- Sá, A.C.L. et al. (2017). Evaluating fire growth simulations using satellite active fire data. *Remote Sensing of Environment* 190: 302–317.
- Schroeder, M.J. (1969). Ignition probability. USDA Forest Service, Office Report 2106-1.
- Srivas, T., de Callafon, R.A., Crawl, D., Altintas, I. (2017). Data assimilation of wildfires with fuel adjustment factors in FARSITE using ensemble Kalman filtering. *Procedia Computer Science* 108: 1572–1581.
- Storey, M.A., Price, O.F., Sharples, J.J., Bradstock, R.A. (2020). Drivers of long-distance spotting during wildfires in south-eastern Australia. *International Journal of Wildland Fire* 29: 459–472.
- Tolan, J. et al. (2024). Very high resolution canopy height maps from RGB imagery using self-supervised vision transformer and convolutional decoder trained on aerial lidar. *Remote Sensing of Environment* 300: 113888.
- Van Wagner, C.E. (1987). Development and structure of the Canadian Forest Fire Weather Index System. Canadian Forestry Service, Forestry Technical Report 35.
- Yebra, M. et al. (2013). A global review of remote sensing of live fuel moisture content for fire danger assessment. *Remote Sensing of Environment* 136: 455–468.
- *Leveraging MTG-FCI fire observations for event-based fire behavior monitoring from near-real-time operation to seasonal analysis* (2026), arXiv:2606.06016.
