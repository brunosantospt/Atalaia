# Compêndio de Dados e Pressupostos Operacionais: Tese de Doutoramento UMinho (Setembro 2025)

> [!IMPORTANT]
> **Referência Bibliográfica para Citação no Projeto Atalaia:**
> Matos, Marina Araújo de (2025). *Minimizing the Impact of Forest Fires*. Tese de Doutoramento em Engenharia Industrial e de Sistemas. Orientação: Prof.ª Doutora Ana Maria Alves Coutinho da Rocha e Prof. Doutor Filipe Pereira Pinto Cunha Alvelos. Escola de Engenharia, Universidade do Minho, Guimarães/Braga, Portugal. Financiamento FCT: Projeto `PCIF/GRF/0141/2019` (*O3F - An Optimization Framework to Reduce Forest Fire*). RepositóriUM: [hdl 1822/97938](https://hdl.handle.net/1822/97938), licença CC BY-NC-SA 4.0.

---

## 1. Enquadramento e Relevância Territorial

* **Área Geográfica de Estudo**: Distrito de Braga (concelhos de Guimarães, Braga, Vieira do Minho, Fafe, Cabeceiras de Basto, Famalicão, Barcelos, etc.).
* **Contexto**: Noroeste português, clima mediterrânico com verões quentes e secos, muita floresta de pinheiro e eucalipto, abandono agrícola e acumulação de combustível (cap. 3 da tese).
* **Ferramenta de Base**: todos os dados do caso de estudo (quartéis, meios, pontos de água, tempos de viagem, área ardida e água necessária) vêm do framework Python `PyO3F` (*F. Alvelos, pyO3F Part I e II, Lecture Notes in Operations Research, Springer, 2025, no prelo*).

---

## 2. Fórmulas Matemáticas e Físicas de Supressão

A tese usa três equações para ligar a progressão do fogo ao trabalho dos meios no terreno:

### A. Volume de Água Necessário para Extinção ($V_{water}$ / $d_{i,t}$)
A água necessária para extinguir um fogo $i$ no instante $t$ é calculada a partir do perímetro da área ardida, aproximada por um círculo:

$$V_{water} = 2\pi \sqrt{\frac{TBA}{\pi}} \times \alpha$$

* **$TBA$**: Área total ardida (*Total Burned Area*) no instante $t$ (em $\text{m}^2$).
* **$\alpha$**: litros de água por metro de perímetro. A tese usa $\alpha = 10\text{ L/m}$ sem mais justificação (*"the value 10 was considered"*, p. 72).

### B. Tempo de Extinção da Frente ($t_{ext}$)
Modelado a partir da análise matemática de supressão florestal de *Albini, Korovin & Gorovaya (1978)*:

$$t_{ext} = 3.3 \times \sqrt{TBA}$$

* O tempo de combate ativo cresce com a raiz quadrada da área ardida, ou seja, com o perímetro.

### C. Tempo de Processamento com Deterioração ($P_i(t)$)
Do problema de escalonamento do cap. 5 (um recurso, água ilimitada), baseado em *Rachaniotis & Pappis*:

$$P_i(t) = \begin{cases} \alpha_i t^{\beta_i} + \gamma_i t + \delta_i, & \text{se } t \le d_i \\ X_i, & \text{se } t > d_i \end{cases}$$

* **$d_i$**: *Containment escape time limit*. Depois de $d_i$, o tempo de processamento passa a $X_i$, um valor que depende dos meios adicionais enviados para o fogo.

---

## 3. Pressupostos do Caso de Estudo (secção 6.1, pp. 71–72)

1. **Objetivo dos 90 Minutos ($Fire_{90}$)**:
   * Citando a Euronews (2024), a tese considera eficiente o ataque inicial que extingue o fogo em menos de **90 minutos**; acima disso é preciso ataque ampliado, com mais meios.
   * $Fire_{90}$ conta os fogos extintos depois dos 90 minutos e é o primeiro objetivo a minimizar.
2. **Tempo de Resposta**:
   * **10 minutos** entre o alerta e o início da intervenção (*"In Portugal, the firefighters are expected to arrive at the scene of a fire in about 10 minutes"*). Não é o tempo de saída do quartel.
3. **Ciclo de Reabastecimento de Água (*Refill*)**:
   * **10 minutos** para encher o tanque no ponto de água.
   * Um veículo só vai reabastecer quando esgota o tanque ($c_{r,t} = 0$).
4. **139 Pontos de Água Operacionais no Distrito de Braga**:
   * **1.ª Ordem**: essenciais, com acesso por caminhos florestais.
   * **2.ª Ordem**: podem não ter acesso direto.
5. **Disponibilidade de Meios**:
   * Três cenários: **25%, 50% e 100%** dos meios de cada quartel, contra 5 a 20 fogos em simultâneo.

Os limites de chama (1,2 m / 350 kW/m a pé, 30–160 m/h de linha; 2,4 m / 1700 kW/m para VFCI, 240 m/h de frente extinta) **não estão na tese**: são pressupostos do próprio Atalaia, com fontes, em [`web/public/suppression.json`](../web/public/suppression.json).

---

## 4. O Inventário Completo: 21 Quartéis e 113 Veículos de Braga (Tabela 41)

Capacidade total combinada de água no distrito: **240.400 Litros**.

A tabela só dá letra e capacidade de cada veículo. O tipo (VLCI, VFCI, VTTU) não está na tese.

| Corpo de Bombeiros (Fire Station) | Município | N.º Veículos | Veículos e Capacidades de Água (Litros) | Água Total (L) |
| :--- | :--- | :---: | :--- | :---: |
| **B.V. Guimarães** | Guimarães | **5** | **A** (400L), **B** (400L), **C** (2000L), **D** (3200L), **E** (3500L) | **9.500 L** |
| **B.V. Caldas das Taipas** | Guimarães | **8** | **J** (400L), **K** (500L), **L** (500L), **M** (600L), **F** (3500L), **G** (4000L), **H** (4500L), **I** (4500L) | **18.500 L** |
| **B.V. Vieira do Minho** | Vieira do Minho | **7** | **BC** (600L), **BD** (600L), **BE** (600L), **BF** (600L), **AZ** (2500L), **BA** (4000L), **BB** (9000L) | **17.900 L** |
| **B.V. Cabeceirenses** | Cabeceiras de Basto | **3** | **V** (400L), **X** (2500L), **W** (3500L) | **6.400 L** |
| **B.V. Fafe** | Fafe | **7** | **AL** (500L), **AM** (500L), **AN** (500L), **AQ** (2500L), **AR** (2500L), **AO** (3000L), **AP** (3000L) | **12.500 L** |
| **B.V. Riba de Ave** | Famalicão | **8** | **R** (400L), **S** (500L), **T** (600L), **U** (2000L), **N** (3000L), **O** (3000L), **P** (3500L), **Q** (4500L) | **17.500 L** |
| **B.V. Famalicão** | Famalicão | **8** | **BN** (300L), **BJ** (500L), **BK** (500L), **BL** (500L), **BM** (500L), **BG** (3500L), **BH** (3500L), **BI** (4000L) | **13.300 L** |
| **B.V. Famalicenses** | Famalicão | **7** | **BV** (500L), **BW** (500L), **BX** (600L), **BT** (1500L), **BR** (3000L), **BS** (3500L), **BU** (9000L) | **18.600 L** |
| **B.V. Barcelos** | Barcelos | **5** | **AD** (500L), **AE** (2200L), **AG** (3000L), **AH** (3000L), **AF** (4500L) | **13.200 L** |
| **B.V. Barcelinhos** | Barcelos | **5** | **CX** (500L), **CY** (500L), **CZ** (600L), **CW** (3000L), **CV** (3500L) | **8.100 L** |
| **B.V. Viatodos** | Barcelos | **2** | **AY** (500L), **AX** (3000L) | **3.500 L** |
| **Sapadores de Braga** | Braga | **5** | **CU** (500L), **CQ** (3000L), **CS** (3000L), **CR** (3500L), **CT** (4500L) | **14.500 L** |
| **B.V. Braga** | Braga | **3** | **CM** (400L), **CK** (3000L), **CL** (3000L) | **6.400 L** |
| **B.V. Vizela** | Vizela | **9** | **DF** (500L), **DG** (500L), **DH** (500L), **DI** (500L), **DB** (1500L), **DC** (1800L), **DD** (2000L), **DA** (3000L), **DE** (7000L) | **17.300 L** |
| **B.V. Celoricenses** | Celorico de Basto | **7** | **CD** (500L), **CE** (500L), **BY** (1000L), **BZ** (1000L), **CA** (1000L), **CB** (3500L), **CC** (3500L) | **11.000 L** |
| **B.V. Terras de Bouro** | Terras de Bouro | **5** | **CF** (500L), **CG** (600L), **CH** (3000L), **CI** (3500L), **CJ** (4500L) | **12.100 L** |
| **B.V. Amares** | Amares | **5** | **Y** (400L), **Z** (500L), **AA** (600L), **AB** (2000L), **AC** (4500L) | **8.000 L** |
| **B.V. Esposende** | Esposende | **3** | **AK** (500L), **AI** (3000L), **AJ** (3500L) | **7.000 L** |
| **B.V. Fão** | Esposende | **3** | **CP** (500L), **CO** (1500L), **CN** (3500L) | **5.500 L** |
| **B.V. Póvoa de Lanhoso** | Póvoa de Lanhoso | **5** | **AV** (500L), **AW** (600L), **AS** (3000L), **AT** (3500L), **AU** (4000L) | **11.600 L** |
| **B.V. Vila Verde** | Vila Verde | **3** | **BO** (500L), **BQ** (3500L), **BP** (4000L) | **8.000 L** |
| **TOTAL DISTRITO** | **21 Quartéis** | **113** | **113 Veículos (A a DI)** | **240.400 L** |

---

## 5. Formulação de Otimização Multiobjetivo (O Modelo NSGA-II)

A tese resolve o problema de despacho e roteamento de duas formas: otimização lexicográfica com um algoritmo genético (GA) e otimização multiobjetivo com NSGA-II, ambas em `pymoo`. Os **5 objetivos** são:

$$\min_{x \in X} f(x) = \Big( Fire_{90},\; TBA,\; Makespan,\; TUW,\; Resources \Big)$$

1. **$f_1 = Fire_{90}$**: Número de fogos extintos depois dos 90 minutos (prioridade máxima na versão lexicográfica).
2. **$f_2 = TBA$**: Área total ardida (*Total Burned Area*, ha).
3. **$f_3 = Makespan$**: Tempo total até à extinção do último fogo (minutos).
4. **$f_4 = TUW$**: Volume total de água consumido (*Total Used Water*, litros).
5. **$f_5 = Resources$**: Número total de veículos usados.

### Resultados por Cenário de Disponibilidade:
* **25%** dos meios = **37 veículos**. Com 5 fogos o GA encontra planos; com **20 fogos não encontra solução viável** (só extingue 5 dos 20).
* **50%** dos meios: o GA usa **51 veículos** para 5 fogos, 53 para 6 e 65 nos restantes casos.
* **100%** = 113 veículos (Tabela 45).
* Conclusão da autora (p. 92): *"even with only 25% of the resources, it was possible to obtain robust solutions with strategic management of resource allocations"*. Os 20 fogos com 25% dos meios são a exceção.

---

## 6. Como Este Documento Conecta ao Atalaia

* **Ficheiro de Dados no Repositório**: [`web/public/suppression_braga_uminho.json`](../web/public/suppression_braga_uminho.json)
* **Documentação na Branch**: [`docs/braga-firefighting-resources.md`](braga-firefighting-resources.md)
* **Aplicação no Decision Twin**: Em vez de barreiras estáticas adivinhadas *a posteriori*, o simulador passa a poder modelar despachos a partir dos quartéis reais de Guimarães, Taipas ou Vieira do Minho, com o tempo de viagem (ETA) e a capacidade de água de cada veículo. O limiar de chama vem de `suppression.json`.
