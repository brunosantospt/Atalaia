# Sistema de Reporte e Despacho Multi-Agência (SIOPS / Proteção Civil, PSP e INEM)

Este documento descreve a arquitetura e o funcionamento do **Sistema de Despacho Multi-Agência com Visualização por Papel (Role-Based Common Operating Picture)** implementado no ramo `feature/multi-agency-reporting` do **Atalaia – Fire Decision Twin** (Hack4Guimarães 2035).

---

## 1. Enquadramento Operacional (SIOPS / PCO Guimarães)

No âmbito do **SIOPS (Sistema Integrado de Operações de Proteção e Socorro)**, as decisões operacionais estratégicas cabem à **Autoridade Municipal de Proteção Civil (CMPC)** e ao **Comandante das Operações de Socorro (COS / Bombeiros)** no Posto de Comando Operacional (PCO).

As restantes entidades de apoio técnico e segurança não necessitam de ver a complexidade de modelos matemáticos ou comparações de decisões florestais; necessitam de **ordens de missão diretas, limpas e acionáveis**:
* **Forças de Segurança (PSP / GNR):** Necessitam de saber com antecedência exata que vias cortar, onde posicionar os cortes de trânsito e qual o perímetro de evacuação.
* **Emergência Médica (INEM / Cruz Vermelha):** Necessitam de saber onde instalar o Posto Médico Avançado (PMA), qual o corredor de evacuação seguro até ao Hospital de Guimarães e que vias estão estritamente interditadas a ambulâncias.

---

## 2. Componentes e Funcionalidades Implementadas

### 2.1. Seletor de Perfil no Topo do Ecrã (`Role Selector`)
Localizado no topo central do HUD, permite alternar instantaneamente entre 3 modos operacionais:
* `🛡️ Proteção Civil` (Modo Master / Completo)
* `👮 PSP / GNR` (Modo Trânsito & Cortes de Via)
* `🚑 INEM` (Modo Saúde & Evacuação)

### 2.2. Inteligência Automática do Sistema ("O Simulador Sabe o que Reportar")
1. **Deteção Preditiva de Cortes de Via (PSP/GNR):**
   - O módulo [`web/src/reporting.ts`](file:///C:/Users/karlo/.gemini/antigravity/scratch/Atalaia/web/src/reporting.ts) cruza os segmentos de estrada OpenStreetMap (`osm.json`) com a grelha de tempos de chegada do fogo `arrival[cell]` do [`fastModel.ts`](file:///C:/Users/karlo/.gemini/antigravity/scratch/Atalaia/web/src/fastModel.ts).
   - Classifica automaticamente a urgência:
     - `⛔ Cortado`: Fogo já atingiu o pavimento.
     - `⚠️ Urgente`: Impacto iminente em menos de 25 minutos.
     - `⚠️ Preventivo`: Impacto previsto entre 25 e 90 minutos.
   - Apresenta as vias no mapa 3D com linhas tracejadas a vermelho/laranja e etiquetas `⛔ CORTE: [Nome da Rua]`.

2. **Gestão de Postos Médicos Avançados e Corredores de Socorro (INEM):**
   - A Proteção Civil pode colocar ou mudar o **PMA** com 1 clique no botão `+ Ponto Socorro (PMA)`.
   - O sistema calcula a margem de segurança do PMA em relação à frente ativa de chamas (e.g. `Margem: > 3 horas`).
   - Traça automaticamente o **Corredor de Evacuação Seguro** em verde néon até ao **Hospital da Senhora da Oliveira (Guimarães)**, garantindo que o algoritmo `routing.ts` desvia a ambulância de todas as vias ativas com fogo ou fumo tóxico.

### 2.3. Modal Interativo de Despacho Multi-Agência (`dispatchModal.ts`)
Aberto a partir do botão `📢 Reportar às Entidades (PSP/INEM)` no editor de decisões:
* **Aba PSP/GNR:** Resumo das vias ameaçadas, raio de barramento e mensagem pronta a copiar para rádio/WhatsApp.
* **Aba INEM:** Localização GPS do PMA, rota de ambulância e lista de estradas intransitáveis.
* **Aba Síntese:** Registo formal das ordens para arquivo da Proteção Civil.
* Botão `📋 Copiar Despacho Formatado` (com alerta de cópia rápida).
* Botão `✅ Emitir Ordens às Forças no Terreno`.

---

## 3. Formato dos Despachos Operacionais Gerados

### Exemplo de Despacho Gerado para a PSP:
```text
🚨 [DESPACHO OPERACIONAL - PSP / GNR TRÂNSITO]
INCÊNDIO: VIEIRA DO MINHO
HORA EMISSÃO: 11:30 (T+90 min)
EMITIDO POR: Posto de Comando Municipal / Proteção Civil & COS

AÇÃO PRIORITÁRIA: CORTE IMEDIATO DE VIAS E DESVIOS DE TRÂNSITO
Perímetro de segurança recomendado: 500m barramento geral, 1200m a sotavento.

VIAS PRIORITÁRIAS A INTERDITAR:
1. ⛔ [INTERDITADA - FOGO NA VIA] Caminho Florestal da Senhora da Fé (track)
   Previsão: Já atingida pelo fogo | Ref: 41.56210, -8.11890
2. ⚠️ [URGENTE - IMPACTO < 25 MIN] Rua da Lage (paved)
   Previsão: Impacto em ~14 min | Ref: 41.56840, -8.12150
3. [CORTE PREVENTIVO] N103 (paved)
   Previsão: Impacto em ~48 min | Ref: 41.57500, -8.12900

Canal de Coordenação Rádio: SIRESP Sub-Grupo Proteção Civil 04.
```

### Exemplo de Despacho Gerado para o INEM:
```text
🚑 [DESPACHO OPERACIONAL - INEM / SAÚDE & EVACUAÇÃO]
INCÊNDIO: VIEIRA DO MINHO
HORA EMISSÃO: 11:30 (T+90 min)
EMITIDO POR: Posto de Comando Municipal / Proteção Civil & COS

AÇÃO: ESTABELECIMENTO DE POSTO MÉDICO AVANÇADO (PMA) E CORREDORES DE SOCORRO

PONTOS DE ATUAÇÃO MÉDICA / PMA ATIVOS:
1. 🏥 PMA 1 (POSTO MÉDICO AVANÇADO) (PMA)
   Coordenadas GPS: 41.54920, -8.13450
   Margem de segurança ao fogo: > 3 horas
   Corredor de Evacuação: Hospital da Senhora da Oliveira (Guimarães) (21.4 km, ETA ~32 min)

⚠️ ESTRADAS VEDADAS À PASSAGEM DE AMBULÂNCIAS (Chamas / Fumo Denso):
- ⛔ Caminho Florestal da Senhora da Fé (Interditada)
- ⛔ Rua da Lage (Interditada)

Hospital de Retaguarda: Hospital da Senhora da Oliveira (Guimarães)
Canal de Coordenação Saúde: CODU / Linha de Apoio Direto Proteção Civil.
```
