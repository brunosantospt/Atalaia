# O ELMFIRE em nove incêndios

Gerado por `hindcast/multifire_report.py` a partir de `multifire_runs.sh` (corridas livres e passo a passo).

## 0. Os incêndios (PT-FireSprd v2, 2015–2021)

| Incêndio | Início | Passos observados | Horas | Área no último passo (ha) | Combustível ardido (COS): herbáceo · mato · eucalipto · pinhal e folhosas · não combustível | Vento médio (km/h) · rajada máx. |
|---|---|---|---|---|---|---|
| Cabeceiras de Basto | 2016-09-06 04:00 | 4 | 32.5 | 1333 | 8% · 53% · 3% · 30% · 7% | 6 · 46 |
| Castro Marim | 2021-08-16 01:00 | 20 | 35.0 | 5938 | 21% · 55% · 2% · 19% · 3% | 20 · 44 |
| Guarda | 2017-08-23 14:00 | 6 | 36.0 | 3145 | 12% · 64% · 0% · 20% · 4% | 9 · 37 |
| Monchique | 2018-08-03 13:30 | 14 | 128.5 | 24454 | 4% · 36% · 35% · 24% · 1% | 15 · 55 |
| Oleiros | 2020-07-25 15:30 | 12 | 33.5 | 5287 | 4% · 23% · 20% · 53% · 0% | 11 · 51 |
| Sever do Vouga | 2016-08-10 01:00 | 7 | 65.0 | 1746 | 1% · 1% · 63% · 32% · 3% | 14 · 50 |
| Vieira do Minho | 2016-08-10 10:00 | 4 | 22.5 | 1621 | 11% · 49% · 16% · 23% · 1% | 16 · 60 |
| Vila Nova de Cerveira | 2015-08-08 12:00 | 6 | 31.0 | 2612 | 0% · 75% · 10% · 15% · 0% | 18 · 52 |
| Vila de Rei | 2019-07-20 14:30 | 24 | 54.0 | 9194 | 4% · 19% · 16% · 58% · 3% | 13 · 49 |

## 1. Corridas livres (do passo 0 ao último passo observado)

Sørensen no último passo (e, entre parênteses, a margem sobre a elipse a favor do vento que sabe a área, `b_vento`).

| Incêndio | b_vento | K0 | K3 | K3m | K4 | K5 | K5b | K5mm | K5m | K3g | K5g | K3s | K6 | K6m | K6d |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CabeceirasdeBasto | 0.47 | 0.63 (+0.16) | 0.73 (+0.26) | 0.74 (+0.27) | 0.67 (+0.20) | 0.63 (+0.16) | 0.67 (+0.20) | 0.70 (+0.23) | 0.61 (+0.14) | 0.77 (+0.30) | 0.53 (+0.06) | 0.73 (+0.26) | 0.63 (+0.16) | 0.61 (+0.14) | 0.63 (+0.16) |
| CastroMarim | 0.65 | 0.71 (+0.06) | 0.71 (+0.06) | 0.71 (+0.06) | 0.70 (+0.05) | 0.61 (-0.04) | 0.66 (+0.01) | 0.66 (+0.01) | 0.61 (-0.04) | 0.74 (+0.09) | 0.66 (+0.01) | 0.71 (+0.06) | 0.61 (-0.04) | 0.60 (-0.04) | 0.60 (-0.04) |
| Guarda | 0.73 | 0.73 (-0.01) | 0.73 (-0.00) | 0.73 (-0.01) | 0.80 (+0.07) | 0.73 (-0.01) | 0.79 (+0.06) | 0.82 (+0.09) | 0.73 (-0.01) | 0.77 (+0.03) | 0.70 (-0.03) | 0.74 (+0.01) | 0.72 (-0.02) | 0.73 (-0.01) | 0.73 (-0.01) |
| Monchique | 0.56 | 0.49 (-0.06) | 0.49 (-0.07) | 0.50 (-0.05) | 0.33 (-0.23) | 0.27 (-0.29) |  |  | 0.28 (-0.27) |  |  | 0.49 (-0.07) | 0.26 (-0.29) | 0.27 (-0.28) | 0.26 (-0.29) |
| Oleiros | 0.69 | 0.59 (-0.10) | 0.39 (-0.30) | 0.31 (-0.38) | 0.66 (-0.02) | 0.68 (-0.01) | 0.65 (-0.04) | 0.64 (-0.05) | 0.61 (-0.07) | 0.50 (-0.19) | 0.58 (-0.10) | 0.39 (-0.30) | 0.66 (-0.02) | 0.62 (-0.06) | 0.68 (-0.01) |
| SeverdoVouga | 0.32 | 0.50 (+0.18) | 0.51 (+0.18) | 0.51 (+0.18) | 0.39 (+0.07) | 0.34 (+0.02) | 0.35 (+0.03) | 0.35 (+0.03) | 0.36 (+0.04) | 0.50 (+0.18) | 0.38 (+0.06) | 0.51 (+0.18) | 0.34 (+0.02) | 0.31 (-0.01) | 0.34 (+0.02) |
| VieiradoMinho | 0.69 | 0.73 (+0.04) | 0.74 (+0.05) | 0.77 (+0.07) | 0.78 (+0.09) | 0.76 (+0.06) | 0.77 (+0.08) | 0.78 (+0.09) | 0.76 (+0.07) | 0.77 (+0.08) | 0.81 (+0.12) | 0.75 (+0.06) | 0.76 (+0.07) | 0.76 (+0.06) | 0.76 (+0.07) |
| VilaNovadeCerveira | 0.61 | 0.51 (-0.10) | 0.60 (-0.01) | 0.69 (+0.08) | 0.44 (-0.17) | 0.37 (-0.24) | 0.55 (-0.06) | 0.55 (-0.06) | 0.44 (-0.17) | 0.48 (-0.13) | 0.35 (-0.26) | 0.60 (-0.01) | 0.37 (-0.24) | 0.42 (-0.19) | 0.37 (-0.24) |
| ViladeRei | 0.32 | 0.51 (+0.19) | 0.28 (-0.04) | 0.28 (-0.04) | 0.55 (+0.23) | 0.48 (+0.16) | 0.54 (+0.22) | 0.57 (+0.25) | 0.55 (+0.23) | 0.31 (-0.01) | 0.47 (+0.15) | 0.28 (-0.04) | 0.47 (+0.15) | 0.54 (+0.22) | 0.48 (+0.16) |
| **Mediana** | 0.61 | **0.59** (+0.04) | **0.60** (-0.00) | **0.69** (+0.06) | **0.66** (+0.07) | **0.61** (-0.01) | **0.66** (+0.04) | **0.65** (+0.06) | **0.61** (-0.01) | **0.62** (+0.06) | **0.55** (+0.03) | **0.60** (+0.01) | **0.61** (-0.02) | **0.60** (-0.01) | **0.60** (-0.01) |
| Incêndios em que é a melhor | | 0 | 1 | 3 | 0 | 1 | 0 | 2 | 0 | 2 | 1 | 1 | 0 | 0 | 0 |

Área no fim (corrida / observada) e área ardida fora do perímetro oficial:

| Incêndio | Observado (ha) | K0 | K3 | K3m | K4 | K5 | K5b | K5mm | K5m | K3g | K5g | K3s | K6 | K6m | K6d |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CabeceirasdeBasto | 1334 | 1.62× · 990 ha | 0.95× · 259 ha | 1.03× · 313 ha | 1.29× · 626 ha | 1.67× · 1033 ha | 0.90× · 297 ha | 1.10× · 430 ha | 1.88× · 1262 ha | 1.10× · 328 ha | 2.51× · 2048 ha | 0.97× · 278 ha | 1.70× · 1067 ha | 1.88× · 1260 ha | 1.74× · 1103 ha |
| CastroMarim | 5938 | 1.50× · 3042 ha | 1.43× · 2798 ha | 1.43× · 2811 ha | 1.71× · 3854 ha | 2.17× · 6492 ha | 1.90× · 4950 ha | 1.92× · 5033 ha | 2.17× · 6502 ha | 1.27× · 1991 ha | 1.94× · 5114 ha | 1.44× · 2819 ha | 2.18× · 6526 ha | 2.19× · 6615 ha | 2.20× · 6648 ha |
| Guarda | 3145 | 1.48× · 1842 ha | 1.14× · 1147 ha | 1.10× · 1043 ha | 1.30× · 1226 ha | 1.61× · 2108 ha | 1.00× · 610 ha | 1.11× · 772 ha | 1.60× · 2090 ha | 1.27× · 1277 ha | 1.69× · 2367 ha | 1.16× · 1150 ha | 1.64× · 2210 ha | 1.61× · 2119 ha | 1.61× · 2112 ha |
| Monchique | 2528 | 1.40× · 1618 ha | 1.48× · 1757 ha | 1.35× · 1499 ha | 5.07× · 7145 ha | 6.41× · 9224 ha |  |  | 6.01× · 8658 ha |  |  | 1.48× · 1760 ha | 6.60× · 9440 ha | 6.30× · 9212 ha | 6.60× · 9440 ha |
| Oleiros | 5288 | 0.62× · 612 ha | 0.28× · 55 ha | 0.21× · 62 ha | 0.86× · 1128 ha | 1.26× · 2428 ha | 0.87× · 1241 ha | 0.86× · 1219 ha | 0.80× · 1143 ha | 0.40× · 143 ha | 1.78× · 4928 ha | 0.28× · 55 ha | 1.31× · 2690 ha | 0.93× · 1560 ha | 1.27× · 2456 ha |
| SeverdoVouga | 1746 | 0.48× · — | 0.48× · — | 0.42× · — | 2.73× · — | 3.57× · — | 3.47× · — | 3.50× · — | 3.50× · — | 0.57× · — | 3.23× · — | 0.48× · — | 3.57× · — | 4.28× · — | 3.57× · — |
| VieiradoMinho | 1621 | 1.11× · 442 ha | 0.87× · 120 ha | 0.88× · 142 ha | 1.02× · 196 ha | 1.28× · 476 ha | 0.93× · 120 ha | 1.03× · 202 ha | 1.56× · 758 ha | 0.85× · 98 ha | 1.42× · 558 ha | 0.88× · 128 ha | 1.31× · 497 ha | 1.62× · 838 ha | 1.31× · 497 ha |
| VilaNovadeCerveira | 2612 | 2.93× · 4632 ha | 1.71× · 1947 ha | 1.29× · 924 ha | 3.50× · 6108 ha | 4.36× · 8360 ha | 2.61× · 3797 ha | 2.44× · 3485 ha | 3.53× · 6185 ha | 2.42× · 3747 ha | 4.74× · 9363 ha | 1.72× · 1958 ha | 4.41× · 8492 ha | 3.70× · 6631 ha | 4.37× · 8397 ha |
| ViladeRei | 9195 | 0.60× · 1739 ha | 0.25× · 604 ha | 0.24× · 547 ha | 1.94× · 10190 ha | 2.67× · 16384 ha | 2.14× · 11700 ha | 1.95× · 10013 ha | 2.12× · 11493 ha | 0.31× · 893 ha | 2.92× · 18137 ha | 0.25× · 612 ha | 2.73× · 16916 ha | 2.21× · 12222 ha | 2.69× · 16491 ha |

### Projeções (corridas livres): Sørensen no último passo e área final / observada

As sementes como intervalo (mediana, mínimo–máximo). K6x e K3x: projeções fortes (distância × 5, até 3 faúlhas, probabilidade de ignição de Schroeder). Sem Monchique.

| Incêndio | K5 (sem projeções) | K6, 5 sementes | K6d | K6x | K3 (sem projeções) | K3x, 3 sementes |
|---|---|---|---|---|---|---|
| CabeceirasdeBasto | 0.63 · 1.67× | 0.62 (0.58–0.63) · 1.73× (1.69–2.03) | 0.63 · 1.74× | 0.32 · 4.61× | 0.73 · 0.95× | 0.61 (0.56–0.67) · 1.51× (1.25–1.63) |
| CastroMarim | 0.61 · 2.17× | 0.61 (0.61–0.61) · 2.18× (2.17–2.18) | 0.60 · 2.20× | 0.59 · 2.30× | 0.71 · 1.43× | 0.71 (0.70–0.72) · 1.48× (1.48–1.51) |
| Guarda | 0.73 · 1.61× | 0.71 (0.70–0.72) · 1.68× (1.63–1.71) | 0.73 · 1.61× | 0.66 · 1.86× | 0.73 · 1.14× | 0.77 (0.76–0.78) · 1.24× (1.23–1.28) |
| Oleiros | 0.68 · 1.26× | 0.67 (0.66–0.68) · 1.30× (1.28–1.32) | 0.68 · 1.27× | 0.61 · 1.52× | 0.39 · 0.28× | 0.40 (0.38–0.45) · 0.29× (0.28–0.36) |
| SeverdoVouga | 0.34 · 3.57× | 0.34 (0.28–0.34) · 3.59× (3.57–4.52) | 0.34 · 3.57× | 0.29 · 4.54× | 0.51 · 0.48× | 0.51 (0.37–0.51) · 0.56× (0.48–1.01) |
| VieiradoMinho | 0.76 · 1.28× | 0.78 (0.76–0.79) · 1.35× (1.31–1.45) | 0.76 · 1.31× | 0.68 · 1.91× | 0.74 · 0.87× | 0.76 (0.75–0.80) · 0.95× (0.94–0.98) |
| VilaNovadeCerveira | 0.37 · 4.36× | 0.36 (0.36–0.37) · 4.48× (4.41–4.56) | 0.37 · 4.37× | 0.32 · 5.17× | 0.60 · 1.71× | 0.52 (0.45–0.54) · 2.16× (2.04–2.58) |
| ViladeRei | 0.48 · 2.67× | 0.47 (0.47–0.48) · 2.72× (2.69–2.73) | 0.48 · 2.69× | 0.46 · 2.87× | 0.28 · 0.25× | 0.23 (0.23–0.28) · 0.23× (0.21–0.25) |

## 2. Passo a passo (recomeça em cada perímetro observado e prevê o seguinte)

Só conta o crescimento entre os dois perímetros. Uma janela acerta "no fator 2" se a área nova da corrida fica entre metade e o dobro da observada. A regra dos 10 % (sem combustível nem relevo) é a referência.

| Configuração | Janelas | Área: mediana corrida/obs. | No fator 2 | Sørensen do crescimento (mediana) | ROS: mediana corrida/obs. |
|---|---|---|---|---|---|
| K3 | 87 (9 incêndios) | 1.73 | 28% | 0.13 | 0.39 |
| K3m | 87 (9 incêndios) | 1.61 | 31% | 0.14 | 0.39 |
| K3m_w08 | 75 (8 incêndios) | 1.43 | 36% | 0.12 | 0.27 |
| K3m_w125 | 75 (8 incêndios) | 1.62 | 31% | 0.12 | 0.40 |
| K3x | 75 (8 incêndios) | 1.65 | 28% | 0.12 | 0.46 |
| K5 | 87 (9 incêndios) | 3.89 | 28% | 0.19 | 0.75 |
| K5a | 75 (8 incêndios) | 1.65 | 40% | 0.18 | 0.60 |
| K5as | 52 (7 incêndios) | 2.26 | 37% | 0.26 | 0.66 |
| K5c | 33 (6 incêndios) | 2.83 | 27% | 0.33 | 0.99 |
| K5m | 87 (9 incêndios) | 3.08 | 28% | 0.18 | 0.74 |
| K5m_w08 | 75 (8 incêndios) | 2.58 | 33% | 0.17 | 0.51 |
| K5m_w125 | 75 (8 incêndios) | 3.16 | 24% | 0.19 | 0.76 |
| K5o | 75 (8 incêndios) | 0.68 | 35% | 0.41 | 0.65 |
| ref_area | 11 (3 incêndios) | 1.00 | 100% | 0.32 | 0.26 |
| ref_area_hotspots | 87 (9 incêndios) | 1.00 | 98% | 0.16 | 0.25 |
| ref_area_oracle | 87 (9 incêndios) | 1.00 | 100% | 0.58 | 0.63 |
| ref_persist | 8 (3 incêndios) | 1.92 | 25% | 0.21 | 0.43 |
| ref_persist_hotspots | 78 (9 incêndios) | 1.05 | 36% | 0.08 | 0.29 |
| ref_persist_oracle | 78 (9 incêndios) | 1.05 | 36% | 0.32 | 0.63 |
| regra dos 10 % | 87 | 14.54 | 8% | 0.12 | 2.25 |

Por incêndio (mediana das janelas): área corrida/obs. · Sørensen do crescimento

| Incêndio | Janelas | K3 | K3m | K5 | K5m | regra dos 10 % |
|---|---|---|---|---|---|---|
| CabeceirasdeBasto | 3 | 0.89 · 0.45 | 0.94 · 0.47 | 1.54 · 0.51 | 1.66 · 0.54 | 15.36 · 0.12 |
| CastroMarim | 19 | 2.54 · 0.22 | 2.54 · 0.22 | 4.68 · 0.26 | 4.67 · 0.26 | 13.85 · 0.13 |
| Guarda | 5 | 1.06 · 0.34 | 1.04 · 0.34 | 1.86 · 0.35 | 1.85 · 0.36 | 12.09 · 0.15 |
| Monchique | 12 | 3.07 · 0.15 | 2.97 · 0.15 | 6.39 · 0.18 | 6.36 · 0.18 | 20.95 · 0.09 |
| Oleiros | 11 | 1.60 · 0.09 | 1.48 · 0.06 | 2.83 · 0.19 | 2.74 · 0.15 | 9.33 · 0.12 |
| SeverdoVouga | 6 | 1.52 · 0.17 | 1.25 · 0.19 | 5.47 · 0.19 | 5.04 · 0.20 | 24.80 · 0.09 |
| VieiradoMinho | 3 | 1.02 · 0.30 | 1.09 · 0.34 | 1.55 · 0.57 | 1.99 · 0.63 | 12.54 · 0.15 |
| VilaNovadeCerveira | 5 | 1.73 · 0.38 | 1.56 · 0.36 | 2.45 · 0.44 | 2.07 · 0.43 | 8.80 · 0.19 |
| ViladeRei | 23 | 2.10 · 0.04 | 1.97 · 0.04 | 4.37 · 0.09 | 4.04 · 0.09 | 13.01 · 0.10 |

Lado a lado: cada referência contra o modelo **nas mesmas janelas** (as que as duas têm). Em cada célula: Sørensen do crescimento da referência · do modelo nessas janelas (n; parte das janelas em que o modelo ganha). A persistência é o crescimento da janela anterior à mesma taxa, numa elipse a favor do vento; a elipse com a área certa sabe a área observada (batota). Nas configurações com borda ativa (`--active-edge`) as referências crescem da mesma borda ativa (`references.py --active-edge`). **Forma**: o modelo e a elipse cortados à mesma área (`references.py --shape-of`), só conta para onde o fogo vai.

| Configuração | Janelas | Regra 10 % | Persistência | Elipse com a área certa | Forma: modelo · elipse |
|---|---|---|---|---|---|
| K3 | 87 | 0.12 · 0.13 (n=87; 56%) | 0.21 · 0.30 (n=8; 62%) | 0.32 · 0.34 (n=11; 55%) | 0.29 · 0.31 (n=11; 64%) |
| K3m | 87 | 0.12 · 0.14 (n=87; 57%) | 0.21 · 0.31 (n=8; 62%) | 0.32 · 0.34 (n=11; 64%) |  |
| K5 | 87 | 0.12 · 0.19 (n=87; 67%) | 0.21 · 0.33 (n=8; 50%) | 0.32 · 0.38 (n=11; 82%) | 0.34 · 0.32 (n=11; 73%) |
| K5m | 87 | 0.12 · 0.18 (n=87; 67%) | 0.21 · 0.34 (n=8; 62%) | 0.32 · 0.38 (n=11; 91%) |  |
| K5o | 75 | 0.32 · 0.41 (n=75; 64%) | 0.35 · 0.40 (n=67; 61%) | 0.56 · 0.41 (n=75; 21%) |  |
| K5a | 75 | 0.14 · 0.18 (n=75; 61%) | 0.09 · 0.17 (n=67; 63%) | 0.15 · 0.18 (n=75; 64%) |  |
| K5as | 52 | 0.12 · 0.26 (n=52; 73%) | 0.21 · 0.32 (n=8; 50%) | 0.32 · 0.38 (n=11; 73%) |  |
| K5c | 33 | 0.12 · 0.33 (n=33; 85%) | 0.21 · 0.33 (n=8; 50%) | 0.32 · 0.38 (n=11; 82%) |  |
| K3x | 75 | 0.12 · 0.12 (n=75; 52%) | 0.21 · 0.29 (n=8; 62%) | 0.32 · 0.33 (n=11; 55%) |  |

## 3. Porque falha: o erro do ROS de cabeça contra as condições

log2(ROS corrida / ROS observado) por janela: 0 é certo, −1 é metade, +1 o dobro. Correlação de Spearman (ρ) com cada condição, e a mediana do erro por classe. Janelas com crescimento observado de pelo menos 5 ha.

### K3 (86 janelas, mediana do erro -1.35, ou seja ×0.39)

| Condição | ρ | p | mediana do erro: metade de baixo → metade de cima |
|---|---|---|---|
| vento médio (km/h) | -0.10 | 0.368 | -1.03 → -1.47 |
| rajada (km/h) | -0.17 | 0.114 | -0.91 → -1.64 |
| temperatura (°C) | -0.05 | 0.640 | -0.99 → -1.85 |
| humidade (%) | -0.20 | 0.064 | -1.11 → -1.51 |
| dia (10-19 h) | -0.18 | 0.106 | -0.88 → -1.89 |
| declive (°) | +0.34 | 0.001 | -1.92 → -0.86 |
| fração de mato | +0.28 | 0.008 | -1.96 → -0.99 |
| fração de eucalipto | -0.06 | 0.566 | -1.10 → -1.85 |
| fração de pinhal e folhosas | -0.46 | 0.000 | -0.87 → -2.22 |
| fração herbácea | +0.00 | 0.970 | -1.40 → -1.13 |
| ROS observado (m/h) | -0.79 | 0.000 | -0.43 → -2.40 |
| duração da janela (h) | +0.59 | 0.000 | -2.10 → -0.83 |

### K3m (86 janelas, mediana do erro -1.43, ou seja ×0.37)

| Condição | ρ | p | mediana do erro: metade de baixo → metade de cima |
|---|---|---|---|
| vento médio (km/h) | -0.09 | 0.424 | -1.14 → -1.64 |
| rajada (km/h) | -0.17 | 0.107 | -1.14 → -1.71 |
| temperatura (°C) | -0.05 | 0.617 | -0.96 → -1.90 |
| humidade (%) | -0.19 | 0.076 | -1.24 → -1.62 |
| dia (10-19 h) | -0.18 | 0.100 | -0.96 → -1.90 |
| declive (°) | +0.33 | 0.002 | -2.06 → -0.83 |
| fração de mato | +0.32 | 0.003 | -2.21 → -0.96 |
| fração de eucalipto | -0.11 | 0.328 | -1.14 → -2.01 |
| fração de pinhal e folhosas | -0.46 | 0.000 | -0.88 → -2.34 |
| fração herbácea | +0.04 | 0.741 | -1.74 → -1.16 |
| ROS observado (m/h) | -0.77 | 0.000 | -0.50 → -2.53 |
| duração da janela (h) | +0.56 | 0.000 | -2.22 → -0.76 |

### K5 (86 janelas, mediana do erro -0.44, ou seja ×0.74)

| Condição | ρ | p | mediana do erro: metade de baixo → metade de cima |
|---|---|---|---|
| vento médio (km/h) | -0.09 | 0.435 | -0.35 → -0.60 |
| rajada (km/h) | -0.16 | 0.149 | -0.22 → -0.71 |
| temperatura (°C) | -0.15 | 0.182 | -0.34 → -0.73 |
| humidade (%) | -0.07 | 0.542 | -0.65 → -0.39 |
| dia (10-19 h) | -0.23 | 0.034 | -0.22 → -1.00 |
| declive (°) | +0.42 | 0.000 | -1.15 → -0.09 |
| fração de mato | +0.10 | 0.351 | -0.71 → -0.35 |
| fração de eucalipto | +0.12 | 0.256 | -0.39 → -0.60 |
| fração de pinhal e folhosas | -0.32 | 0.003 | -0.21 → -1.00 |
| fração herbácea | -0.17 | 0.124 | -0.35 → -0.71 |
| ROS observado (m/h) | -0.87 | 0.000 | +0.59 → -1.61 |
| duração da janela (h) | +0.69 | 0.000 | -1.40 → +0.43 |

### K5m (86 janelas, mediana do erro -0.47, ou seja ×0.72)

| Condição | ρ | p | mediana do erro: metade de baixo → metade de cima |
|---|---|---|---|
| vento médio (km/h) | -0.09 | 0.386 | -0.40 → -0.70 |
| rajada (km/h) | -0.16 | 0.132 | -0.23 → -0.76 |
| temperatura (°C) | -0.15 | 0.166 | -0.23 → -0.94 |
| humidade (%) | -0.09 | 0.417 | -0.54 → -0.42 |
| dia (10-19 h) | -0.25 | 0.022 | -0.23 → -1.01 |
| declive (°) | +0.38 | 0.000 | -1.24 → -0.04 |
| fração de mato | +0.12 | 0.264 | -0.94 → -0.40 |
| fração de eucalipto | +0.11 | 0.333 | -0.42 → -0.60 |
| fração de pinhal e folhosas | -0.35 | 0.001 | -0.10 → -1.24 |
| fração herbácea | -0.15 | 0.171 | -0.41 → -0.70 |
| ROS observado (m/h) | -0.88 | 0.000 | +0.43 → -1.68 |
| duração da janela (h) | +0.70 | 0.000 | -1.54 → +0.40 |

### K5o (74 janelas, mediana do erro -0.62, ou seja ×0.65)

| Condição | ρ | p | mediana do erro: metade de baixo → metade de cima |
|---|---|---|---|
| vento médio (km/h) | -0.01 | 0.933 | -0.61 → -0.62 |
| rajada (km/h) | -0.10 | 0.390 | -0.47 → -0.78 |
| temperatura (°C) | -0.19 | 0.108 | -0.32 → -0.85 |
| humidade (%) | -0.12 | 0.296 | -0.60 → -0.99 |
| dia (10-19 h) | -0.21 | 0.079 | -0.29 → -0.99 |
| declive (°) | +0.30 | 0.009 | -1.13 → -0.29 |
| fração de mato | +0.25 | 0.029 | -1.04 → -0.36 |
| fração de eucalipto | -0.11 | 0.339 | -0.44 → -0.99 |
| fração de pinhal e folhosas | -0.42 | 0.000 | -0.17 → -1.31 |
| fração herbácea | -0.03 | 0.794 | -0.64 → -0.61 |
| ROS observado (m/h) | -0.79 | 0.000 | +0.12 → -1.63 |
| duração da janela (h) | +0.65 | 0.000 | -1.37 → +0.14 |

### K3x (74 janelas, mediana do erro -1.19, ou seja ×0.44)

| Condição | ρ | p | mediana do erro: metade de baixo → metade de cima |
|---|---|---|---|
| vento médio (km/h) | -0.05 | 0.648 | -1.11 → -1.40 |
| rajada (km/h) | -0.11 | 0.365 | -0.93 → -1.42 |
| temperatura (°C) | -0.01 | 0.923 | -0.79 → -1.86 |
| humidade (%) | -0.33 | 0.004 | -0.93 → -1.90 |
| dia (10-19 h) | -0.07 | 0.545 | -0.92 → -1.89 |
| declive (°) | +0.28 | 0.015 | -1.95 → -0.74 |
| fração de mato | +0.32 | 0.005 | -2.04 → -0.79 |
| fração de eucalipto | -0.23 | 0.053 | -0.81 → -1.92 |
| fração de pinhal e folhosas | -0.50 | 0.000 | -0.69 → -2.36 |
| fração herbácea | +0.10 | 0.385 | -1.58 → -0.88 |
| ROS observado (m/h) | -0.71 | 0.000 | -0.32 → -2.40 |
| duração da janela (h) | +0.55 | 0.000 | -2.07 → -0.27 |

## 4. Calibração por classe de combustível (deixando um incêndio de fora)

Fator de ajuste do ROS por classe, ajustado ao erro do ROS de cabeça nas janelas dos outros incêndios (`calibrate.py`). Intervalo = o menor e o maior fator entre as dobras.

| Sobre | Janelas | Todos os incêndios | Intervalo entre dobras | |ln erro| antes → depois (na amostra) |
|---|---|---|---|---|
| K3 | 86 | herb=0.88,shrub=1.42,euc=1.30,forest=2.20 | herb 0.74–1.12, shrub 1.00–1.84, euc 1.12–1.51, forest 2.20–2.20 | 1.127 → 0.511 |
| K5 | 86 | herb=0.71,shrub=1.12,euc=0.66,forest=2.20 | herb 0.59–1.22, shrub 0.71–1.45, euc 0.59–0.90, forest 1.32–2.20 | 0.72 → 0.602 |

