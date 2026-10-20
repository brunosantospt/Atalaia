# Acoplamento do Sistema FWI (IPMA / Van Wagner) ao Modelo de Propagação do Atalaia

Este documento descreve a integração formal do **Canadian Forest Fire Weather Index (FWI) System** (Van Wagner 1987, Lawson & Armitage 2008) no motor de propagação rápida e no HUD operacional do **Atalaia – Fire Decision Twin** (Hack4Guimarães 2035).

---

## 1. Contexto e Motivação

Nas versões anteriores do simulador rápido (`fastModel.ts`), a taxa de propagação à cabeça (*head ROS*) era modulada por uma aproximação empírica simplificada baseada na humidade relativa:

$$\text{head} = (1 + \text{windGain} \times W) \times \exp\left(-\frac{\text{rhGain} \times (RH - RH_{\text{ref}})}{100}\right)$$

Embora funcional para o incêndio de calibração (Vieira do Minho 2016), essa formulação apresenta limitações operacionais:
1. **Sem memória física da humidade**: Apenas lia o $RH$ instantâneo da hora, ignorando a absorção/dessorção e o histórico antecedente (défice hídrico de vários dias).
2. **Incompatibilidade com o sistema oficial português**: O **IPMA** (Instituto Português do Mar e da Atmosfera) e a **ANEPC** classificam o perigo diário e horário de incêndio com base no **FWI canadiano**. Os planos municipais e as decisões operacionais dos comandantes de bombeiros são balizados pelas classes de perigo do IPMA (*Reduzido, Moderado, Elevado, Muito Elevado, Máximo*).
3. **Previsões futuras**: Para previsões a 24h/48h (com modelos meteorológicos como o IPMA AROME 2.5 km ou ECMWF), é indispensável calcular os índices oficiais para que os despachos recomendados pelo Decision Twin coincidam com os níveis de alerta da Proteção Civil.

---

## 2. Equações e Formulação Matemática

O módulo [`web/src/fwi.ts`](file:///C:/Users/karlo/.gemini/antigravity/scratch/Atalaia/web/src/fwi.ts) implementa o algoritmo contínuo horário de Van Wagner (1977) e Lawson & Armitage (2008):

### 2.1. Humidade dos Combustíveis Finos Mortos (FFMC e $m$)

A humidade dos combustíveis finos $m$ (%) relaciona-se biunivocamente com o código FFMC (0 a 101):

$$m = \frac{147.2 \times (101 - \text{FFMC})}{59.5 + \text{FFMC}}$$

$$\text{FFMC} = \frac{59.5 \times (250 - m)}{147.2 + m}$$

A cada hora $t$, em função da temperatura $T$ (°C), humidade relativa $H$ (%) e vento $W$ (km/h):
- **Equilíbrio de secagem ($E_d$)**:
  $$E_d = 0.942 H^{0.679} + 11.0 e^{\frac{H - 100}{10}} + 0.18 (21.1 - T)(1 - e^{-0.115 H})$$
- **Equilíbrio de humedecimento ($E_w$)**:
  $$E_w = 0.618 H^{0.753} + 10.0 e^{\frac{H - 100}{10}} + 0.18 (21.1 - T)(1 - e^{-0.115 H})$$
- **Taxa horária de secagem ($k_d$) ou humedecimento ($k_w$)**:
  $$k_a = 0.424 \left[1 - \left(\frac{H}{100}\right)^{1.7}\right] + 0.0694 \sqrt{W} \left[1 - \left(\frac{H}{100}\right)^8\right]$$
  $$k_d = k_a \times 0.0579 e^{0.0365 T}$$
  $$m_t = E_d + (m_{t-1} - E_d) \times 10^{-k_d}$$

### 2.2. Índice de Propagação Inicial (ISI)

O **ISI** combina a velocidade do vento $W$ com o teor de humidade $m$ dos combustíveis finos, sendo o motor físico da velocidade de avanço da frente de fogo (Canadian FBP):

$$f(W) = \exp(0.05039 \times W)$$

$$f(F) = 91.9 \times \exp(-0.1386 \times m) \times \left(1 + \frac{m^{5.31}}{4.93 \times 10^7}\right)$$

$$\text{ISI} = 0.208 \times f(W) \times f(F)$$

### 2.3. Acoplamento à Taxa de Propagação (ROS) no FastModel

No simulador [`web/src/fastModel.ts`](file:///C:/Users/karlo/.gemini/antigravity/scratch/Atalaia/web/src/fastModel.ts), a propagação à cabeça é agora governada diretamente pelo ISI:

$$\text{head} = \left(\frac{\text{ISI}}{\text{ISI}_{\text{ref}}}\right) \times \text{headBase}$$

Com $\text{ISI}_{\text{ref}} = 11.2$ e $\text{headBase} = 4.6$, a simulação livre reproduz com precisão o valor de calibração do PT-FireSprd para Vieira do Minho 2016 (**743 ha às 5 horas**, com 705 ha de referência real).

---

## 3. Classes Oficiais de Perigo IPMA

O FWI agrega o ISI com o **BUI** (Build-Up Index, combustíveis pesados disponíveis decorrentes do DMC e DC):

$$B = 0.1 \times \text{ISI} \times (0.626 \times \text{BUI}^{0.809} + 2) \quad (\text{se BUI} \le 80)$$

$$\text{FWI} = \exp(2.72 \times (0.434 \ln B)^{0.647})$$

As classes operacionais do IPMA em Portugal são atribuídas em tempo real no simulador:

| Nível | Classe IPMA | Intervalo FWI | Cor de Alerta | Comportamento do Fogo |
|:---:|:---:|:---:|:---:|:---|
| **1** | **Reduzido** | $\text{FWI} < 8.5$ | Verde (`#45b058`) | Fogo de superfície de baixa intensidade |
| **2** | **Moderado** | $8.5 \le \text{FWI} < 17.2$ | Azul (`#3a86ff`) | Propagação moderada, fácil ataque direto |
| **3** | **Elevado** | $17.2 \le \text{FWI} < 24.6$ | Amarelo (`#f3c010`) | Frentes ativas, ataque inicial com água e sapadores |
| **4** | **Muito Elevado** | $24.6 \le \text{FWI} < 38.3$ | Laranja (`#f77f00`) | Propagação rápida, projeções frequentes |
| **5** | **Máximo** | $\text{FWI} \ge 38.3$ | Vermelho (`#e63946`) | Comportamento extremo, ataque direto perigoso |

---

## 4. Visualização no HUD Operacional

No painel **"Conhecido em T"** ([`web/src/ledger.ts`](file:///C:/Users/karlo/.gemini/antigravity/scratch/Atalaia/web/src/ledger.ts)), foi adicionada a telemetria em tempo real:

- **Camada**: `Perigo FWI`
- **Fonte**: `IPMA`
- **Telemetria**: `MUITO ELEVADO (FWI 30.1) · ISI 12.5 · FFMC 91 (humidade 10.0 %)`

O utilizador e o comandante veem a transição da humidade ao longo das horas do dia (colapso da humidade para 8% à tarde e recuperação noturna), acompanhada da evolução do perigo oficial.
