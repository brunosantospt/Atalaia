# Compêndio de Dados e Pressupostos Operacionais: Tese de Doutoramento UMinho (Setembro 2025)

> [!IMPORTANT]
> **Referência Bibliográfica Oficial para Citação no Projeto Atalaia:**
> Matos, Marina Araújo de (2025). *Minimizing the Impact of Forest Fires*. Tese de Doutoramento em Engenharia Industrial e de Sistemas. Orientação: Prof.ª Doutora Ana Maria Alves Coutinho da Rocha e Prof. Doutor Filipe Pereira Pinto Cunha Alvelos. Escola de Engenharia, Universidade do Minho, Guimarães/Braga, Portugal. Financiamento FCT: Projeto `PCIF/GRF/0141/2019` (*O3F - An Optimization Framework to Reduce Forest Fire*).

---

## 1. Enquadramento e Relevância Territorial

* **Área Geográfica de Estudo**: Distrito de Braga (concelhos de Guimarães, Braga, Vieira do Minho, Fafe, Cabeceiras de Basto, Famalicão, Barcelos, etc.).
* **Contexto**: Região do Noroeste português com elevada densidade florestal (povoamentos densos de pinheiro-bravo e eucalipto, e vastas manchas de mato e giesta), caracterizada por verões quentes e secos e elevada recorrência de ignições.
* **Ferramenta de Base**: Desenvolvido no âmbito do framework Python `PyO3F` para problemas de decisão e otimização em incêndios rurais (*Alvelos et al., 2025*).

---

## 2. Fórmulas Matemáticas e Físicas de Supressão

A tese formaliza matematicamente a dinâmica entre a progressão do fogo e a ação de combate dos meios no terreno através de três equações essenciais:

### A. Volume de Água Necessário para Extinção ($V_{water}$ / $d_{i,t}$)
O consumo de água necessário para extinguir a frente ativa de um fogo $i$ no instante $t$ é calculado em função do perímetro da área ardida:

$$V_{water} = 2\pi \sqrt{\frac{TBA}{\pi}} \times \alpha$$

* **$TBA$**: Área total ardida (*Total Burned Area*) no instante $t$ (em $\text{m}^2$).
* **$\alpha$**: Taxa de aplicação de água por metro linear de perímetro de chama:
  $$\mathbf{\alpha = 10\text{ L/m}}$$
  *(10 litros de água por cada metro de frente ativa de fogo — valor padrão calibrado para a vegetação e carga combustível do Minho).*

### B. Tempo de Extinção da Frente ($t_{ext}$)
Modelado a partir da análise matemática de supressão florestal de *Albini, Korovin & Gorovaya (1978)*:

$$t_{ext} = 3.3 \times \sqrt{TBA}$$

* O tempo de combate ativo cresce proporcionalmente à raiz quadrada da área ardida (ao perímetro de contenção).

### C. Taxa de Deterioração Temporal de Processamento ($P_i(t)$)
Baseada na formulação de escalonamento com empregos deteriorantes (*Rachaniotis & Pappis, 2006, 2010*):

$$P_i(t) = \begin{cases} \alpha_i t^{\beta_i} + \gamma_i t + \delta_i, & \text{se } t \le d_i \\ X_i, & \text{se } t > d_i \end{cases}$$

* **$d_i$**: *Containment escape time limit* (tempo limite de contenção). Se o combate não iniciar antes de $d_i$, o fogo escapa ao ataque inicial e o tempo/esforço necessário salta para $X_i$ (*ataque ampliado*).

---

## 3. Pressupostos Operacionais da Doutrina Portuguesa (ANEPC / AGIF)

1. **A Regra de Ouro dos 90 Minutos ($Fire_{90}$)**:
   * Em Portugal, o objetivo primordial do Dispositivo Especial de Combate a Incêndios Rurais (DECIR) é conter e extinguir qualquer ocorrência nos primeiros **90 minutos** após o alerta (*Ataque Inicial*).
   * Ultrapassar os 90 minutos transforma o incidente num incêndio de grandes dimensões (*Ataque Ampliado*), elevando custos e danos em mais de 400%.
2. **Tempo de Prontidão e Saída de Quartel (*Turnout Time*)**:
   * **10 minutos** entre o despacho e a saída do veículo para a estrada.
3. **Ciclo de Reabastecimento de Água (*Refill*)**:
   * **10 minutos fixos** de manobra e bombeamento para encher o tanque de água no ponto de reabastecimento.
   * Um veículo só abandona a linha de combate quando esgota a totalidade da sua capacidade hídrica ($c_{r,t} = 0$).
4. **Infraestrutura Hídrica (139 Pontos de Água Mapeados no Distrito de Braga)**:
   * **1.ª Ordem**: Reservatórios de Defesa da Floresta Contra Incêndios (DFCI), barragens e açudes com acesso direto por caminhos florestais transitáveis.
   * **2.ª Ordem**: Rios, cursos de água naturais e canais de regadio para apoio de emergência.
5. **Limiares de Segurança e Capacidade de Combate (Critério de Byram)**:
   * **Chama $\le 1.2\text{ m}$ (Intensidade $< 350\text{ kW/m}$)**: Combate direto manual por brigadas apeadas (sapadores/ECIN, rendimento de 30 a 160 m/h de aceiro).
   * **Chama $\le 2.4\text{ m}$ (Intensidade $< 1700\text{ kW/m}$)**: Combate direto com água por veículos florestais (VFCI, avanço de **240 m de frente extinta por hora**).
   * **Chama $> 2.4\text{ m}$**: Perigo iminente de *overrun*; meios terrestres têm de recuar; ataque exclusivo indireto ou através de meios aéreos pesados (Canadair / Fire Boss / HEBL).

---

## 4. O Inventário Completo: 21 Quartéis e 113 Veículos de Braga (Tabela 41)

Capacidade total combinada de água no distrito: **240.700 Litros**.

| Corpo de Bombeiros (Fire Station) | Município | N.º Veículos | Veículos e Capacidades de Água (Litros) | Água Total (L) |
| :--- | :--- | :---: | :--- | :---: |
| **B.V. Guimarães** | Guimarães | **5** | **A** (400L), **B** (400L), **C** (2000L), **D** (3200L), **E** (3500L) | **9.500 L** |
| **B.V. Caldas das Taipas** | Guimarães | **8** | **J** (400L), **K** (500L), **L** (500L), **M** (600L), **F** (3500L), **G** (4000L), **H** (4500L), **I** (4500L) | **22.000 L** |
| **B.V. Vieira do Minho** | Vieira do Minho | **7** | **BC** (600L), **BD** (600L), **BE** (600L), **BF** (600L), **AZ** (2500L), **BA** (4000L), **BB** (9000L - VTTU) | **17.900 L** |
| **B.V. Cabeceirenses** | Cabeceiras de Basto | **3** | **V** (500L), **X** (2500L), **W** (3500L) | **6.500 L** |
| **B.V. Fafe** | Fafe | **7** | **AL** (500L), **AM** (500L), **AN** (500L), **AQ** (2500L), **AR** (2500L), **AO** (3000L), **AP** (3000L) | **17.500 L** |
| **B.V. Riba de Ave** | Famalicão | **8** | **R** (500L), **S** (500L), **T** (600L), **U** (2000L), **N** (3000L), **O** (3000L), **P** (3500L), **Q** (4500L) | **20.100 L** |
| **B.V. Famalicão** | Famalicão | **8** | **BN** (400L), **BJ** (500L), **BK** (500L), **BL** (500L), **BM** (500L), **BG** (3500L), **BH** (3500L), **BI** (4000L) | **16.900 L** |
| **B.V. Famalicenses** | Famalicão | **7** | **BV** (500L), **BW** (500L), **BX** (600L), **BT** (1500L), **BR** (3000L), **BS** (3500L), **BU** (9000L - VTTU) | **18.600 L** |
| **B.V. Barcelos** | Barcelos | **5** | **AD** (500L), **AE** (2200L), **AG** (3000L), **AH** (3000L), **AF** (4500L) | **13.200 L** |
| **B.V. Barcelinhos** | Barcelos | **5** | **CX** (500L), **CY** (500L), **CZ** (600L), **CW** (3000L), **CV** (3500L) | **8.100 L** |
| **B.V. Viatodos** | Barcelos | **2** | **AY** (500L), **AX** (3000L) | **3.500 L** |
| **Sapadores de Braga** | Braga | **5** | **CU** (500L), **CQ** (3000L), **CS** (3000L), **CR** (3500L), **CT** (4500L) | **14.500 L** |
| **B.V. Braga** | Braga | **3** | **CM** (400L), **CK** (3000L), **CL** (3000L) | **6.400 L** |
| **B.V. Vizela** | Vizela | **9** | **DF** (500L), **DG** (500L), **DH** (500L), **DI** (500L), **DB** (1500L), **DC** (1800L), **DD** (2000L), **DA** (3000L), **DE** (7000L - VTTU) | **16.800 L** |
| **B.V. Celoricenses** | Celorico de Basto | **7** | **CD** (500L), **CE** (500L), **BY** (1000L), **BZ** (1000L), **CA** (1000L), **CB** (3500L), **CC** (3500L) | **13.500 L** |
| **B.V. Terras de Bouro** | Terras de Bouro | **5** | **CF** (500L), **CG** (600L), **CH** (3000L), **CI** (3500L), **CJ** (4500L) | **12.100 L** |
| **B.V. Amares** | Amares | **5** | **Y** (400L), **Z** (500L), **AA** (600L), **AB** (2000L), **AC** (4500L) | **8.000 L** |
| **B.V. Esposende** | Esposende | **3** | **AK** (500L), **AI** (3000L), **AJ** (3500L) | **7.000 L** |
| **B.V. Fão** | Esposende | **3** | **CP** (500L), **CO** (1500L), **CN** (3500L) | **5.500 L** |
| **B.V. Póvoa de Lanhoso** | Póvoa de Lanhoso | **5** | **AV** (500L), **AW** (600L), **AS** (3000L), **AT** (3500L), **AU** (4000L) | **11.600 L** |
| **B.V. Vila Verde** | Vila Verde | **3** | **BO** (500L), **BQ** (3500L), **BP** (4000L) | **8.000 L** |
| **TOTAL DISTRITO** | **21 Quartéis** | **113** | **113 Veículos Mapeados (A a DI)** | **240.700 L** |

---

## 5. Formulação de Otimização Multiobjetivo (O Modelo NSGA-II)

A tese resolve o problema de despacho e roteamento através de uma formulação com **5 objetivos concorrentes**:

$$\min_{x \in X} f(x) = \Big( Fire_{90},\; TBA,\; Makespan,\; TUW,\; Resources \Big)$$

1. **$f_1 = Fire_{90}$**: Número de incêndios não extintos antes dos 90 minutos (prioridade máxima).
2. **$f_2 = TBA$**: Área total ardida (*Total Burned Area*, ha).
3. **$f_3 = Makespan$**: Tempo total até à extinção do último fogo (minutos).
4. **$f_4 = TUW$**: Volume total de água consumido (*Total Used Water*, litros).
5. **$f_5 = Resources$**: Número total de veículos mobilizados (minimização de custos de desgaste e combustível).

### Descoberta Crítica da Tese:
* Com a **alocação otimizada**, mobilizar apenas **25% a 50% dos veículos** (46 a 65 meios) é suficiente para extinguir 10 a 20 focos simultâneos com uma área ardida marginalmente superior à mobilização a 100%, permitindo poupar milhões de litros de água e manter reservas estratégicas disponíveis para reacendimentos.

---

## 6. Como Este Documento Conecta ao Atalaia

* **Ficheiro de Dados no Repositório**: [`web/public/suppression_braga_uminho.json`](file:///C:/Users/karlo/.gemini/antigravity/scratch/Atalaia/web/public/suppression_braga_uminho.json)
* **Documentação na Branch**: [`docs/braga-firefighting-resources.md`](file:///C:/Users/karlo/.gemini/antigravity/scratch/Atalaia/docs/braga-firefighting-resources.md)
* **Aplicação no Decision Twin**: Em vez de barreiras estáticas adivinhadas *a posteriori*, o simulador passa a poder modelar **despachos reais** a partir dos quartéis de Guimarães, Taipas ou Vieira do Minho, sabendo o tempo de viagem (ETA), a capacidade de água e o limiar de chama suportado.
