# Plataforma Atalaia — Relatório Técnico de Implementações & Refinamentos Táticos

**Data:** 21 de Outubro de 2026  
**Repositório:** [Atalaia (GitHub)](https://github.com/brunosantospt/Atalaia)  
**Branch:** `feature/firefighting-resources-refinements`  
**Pull Request:** [Comparar & Abrir PR no GitHub](https://github.com/brunosantospt/Atalaia/pull/new/feature/firefighting-resources-refinements)  
**Volume de Alterações:** 12 ficheiros modificados (`+1.729` adições / `-273` remoções)

---

## 1. Resumo Executivo

Este documento sintetiza o conjunto de desenvolvimentos e refinamentos técnicos introduzidos no gémeo digital de combate a incêndios florestais **Atalaia**. As melhorias incidiram sobre quatro eixos fundamentais:

1. **Modelação de Supressão Fiel à Literatura:** Integração das taxas operacionais de combate da tese de doutoramento de Matos (Universidade do Minho, 2025) e projeção de perímetros de avanço dinâmicos no modelo 3D.
2. **Interseção Espaço-Temporal de Redes Viárias:** Correção do algoritmo de corte de vias para que apenas os troços estritamente intersectados pela frente ativa do fogo sejam destacados a vermelho no momento exato da queima.
3. **Navegação & Telemetria Espacial de Alta Precisão:** Correção da câmara 3D com amostragem direta da cota altimétrica do terreno (DEM), rotação de bússola síncrona a 60 FPS e cópia ágil de coordenadas geográficas para decisão operacional.
4. **Ergonomia Operacional & Identidade Visual Tática:** Arquitetura de ícones vetoriais neutros (estilo ardósia/militar), gaveta de decisão retrátil com seta dedicada, scrollbars integradas em modo escuro e gestão de alertas de chamas extremas com mobilização automática de meios aéreos.

---

## 2. Detalhe Técnico & Arquitetura de Código

### 2.1. Modelação Dinâmica de Supressão e Frentes de Combate
* **Ficheiros:** `web/src/editor.ts`, `web/src/fastModel.ts`, `web/src/suppression.ts`
* **Fundamentação Matemática:**
  * Foram introduzidas taxas de rendimento de combate ($m/h$) baseadas nos ensaios empíricos de Matos (2025):
    * **VFCI (Veículo Florestal de Combate a Incêndios):** $\approx 300\text{ m/h}$ em combate direto com água.
    * **Brigadas Apeadas (`crew`):** $\approx 80\text{ m/h}$ em ferramentas manuais e sapadores florestais em declives acentuados.
    * **VTTU (Veículo Tanque Tático Urbano):** atua como multiplicador de apoio contínuo para rotação e ciclo de água (*water shuttle*).
  * **Raio de Ação Geodésico:**
    $$\text{raio} = \max\left(25, \min\left(140, \sqrt{\frac{\text{taxa} \times \Delta t}{\pi}}\right)\right)$$
  * **Renderização 3D:** A função `drawSuppressionPerimeter` projeta no solo (`clampToGround: true`) uma elipse tática fechada de 32 vértices obtidos por interpolação esférica `destination(p, angle, radius)`.
  * **Propagação Dijkstra:** Na função `simulate()`, as células sob ação dos meios sofrem verificação de intensidade de Byram ($I = H \cdot w \cdot R$) e comprimento da chama ($L = 0.0775 \cdot I^{0.46}$). Se $L \le \text{holdFlameM}$, o modelo aplica um fator de retenção que reduz a velocidade de propagação (`ros *= factor`), desacelerando ou bloqueando a chegada do fogo (`arrival[j]`).

---

### 2.2. Algoritmo de Corte Progressivo de Vias de Acesso
* **Ficheiro:** `web/src/editor.ts` (linhas 239–275)
* **Algoritmo `clipRoadToFire`:**
  * **Problema:** Anteriormente, as estradas afetadas no final da simulação ficavam a vermelho desde o instante zero ($T=0$), confundindo os comandantes de operações.
  * **Solução:** Implementação de um filtro de interseção espaço-temporal:
    ```typescript
    function clipRoadToFire(
      pts: [number, number][],
      grid: Grid,
      arrival: Float32Array,
      currentMin: number,
    ): [number, number][][]
    ```
  * Cada nó da polilinha da rede viária (OpenStreetMap) é mapeado para a célula raster correspondente $(col, row) \rightarrow \text{cellIndex}$.
  * O corte só é ativado se $\text{arrival}[\text{cellIndex}] \le \text{currentMin}$, garantindo que apenas os segmentos contíguos submersos pelas chamas no minuto corrente $T$ aparecem cortados no mapa.
  * Foram eliminados os ícones repetitivos sobre as vias para despoluir o grafo de cena e melhorar a performance de renderização.

---

### 2.3. Cinemática de Câmara 3D com Altura Real do Terreno (DEM)
* **Ficheiro:** `web/src/main.ts` (linhas 105–160)
* **Correção da Projeção de Alvo:**
  * **Problema:** O botão de recentramento no ponto de ignição utilizava altitude nula (`Cartesian3.fromDegrees(lon, lat, 0)`). No relevo acentuado do Minho (Serra da Cabreira), o solo encontra-se entre 600m e 850m acima do elipsoide WGS84. Isto colocava o ponto focal centenas de metros **debaixo da terra**, fazendo com que a câmara do Cesium colidisse com o terreno e apontasse para direções aleatórias.
  * **Solução:** A função `flyToIgnition()` pesquisa agora o marcador visual **"I - Ignição"** (`story.markers.find(m => m.id === 'ignition:0' || m.badge === 'I')`) e consulta a cota de elevação amostrada via `sampleTerrainMostDetailed` / `globe.getHeight(carto)`:
    ```typescript
    const target = Cartesian3.fromDegrees(lon, lat, height)
    viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 0), {
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-35), 650),
      duration: 1.2,
    })
    ```
  * O leitor cinemático (`replay.player.playing = false; replay.player.userMoved = true`) é interrompido no momento do clique para que a animação da história não sobrescreva a navegação manual.

---

### 2.4. Bússola Vetorial Dinâmica 60 FPS & Telemetria
* **Ficheiros:** `web/src/hud.ts`, `web/src/hud.css`
* **Rosa dos Ventos Síncrona:** A função `updateCompass()` é ligada ao hook de renderização `scene.preRender`. A rotação angular da câmara em radianos é lida instantaneamente (`CesiumMath.toDegrees(heading)`) e aplicada por matriz de transformação CSS (`transform: rotate(-deg)`), sem perdas de frame.
* **Cópia Rápida de Coordenadas:** Clique sobre as coordenadas do painel inferior copia a latitude/longitude formatada para a área de transferência (`navigator.clipboard.writeText`), exibindo uma notificação flutuante (*toast*) com desvanecimento suave.
* **Despoluição:** Foram suprimidas as coordenadas duplicadas no cabeçalho superior.

---

### 2.5. Máquina de Estados para Alertas Críticos de Comportamento de Fogo
* **Ficheiros:** `web/src/hud.ts`, `web/src/editor.ts`
* **Prevenção de Fuga de Eventos:** O redesenho em cada frame do ciclo de animação destruía os elementos DOM do popover, impedindo o clique no alerta. Foi implementada uma cache de estado (`cachedFlameLevel: 'normal' | 'extreme'`) que previne re-renderizações desnecessárias.
* **Mobilização Rápida de Meios Aéreos:** Se o comprimento da chama exceder $3.5\text{ m}$, o ícone de aviso começa a pulsar. Ao premir "Mobilizar Meios", o sistema:
  1. Identifica a Base Aérea (CMA) mais próxima por distância geodésica;
  2. Seleciona o meio aéreo (`hebl` ou `avbp`);
  3. Restringe a tarefa estritamente a ataque direto (`direct`);
  4. Abre a gaveta de decisões e atualiza a simulação sem duplicar alertas.

---

### 2.6. Suíte de Ícones Vetoriais e Ergonomia Visual
* **Ficheiros:** `web/src/icons.ts`, `web/src/hud.css`, `web/src/editor.css`
* **Biblioteca `icons.ts`:** Eliminação de emojis e grafismos amadores, substituídos por vetores SVG técnicos e monocromáticos nos tons cinzento ardósia e aço (`--ink: #d9dcdf`, traço fino de 1.5px).
* **Seta Lateral Retrátil (`.editor-edge-toggle`):** Botão discreto na margem esquerda que recolhe e expande a gaveta de decisões sem depender do atalho de teclado (`E`), ocultando-se automaticamente nos perfis não-comando (PSP e INEM).
* **Scrollbars Dark Theme:** Estilização global e específica das barras de deslocamento (`scrollbar-width: thin; scrollbar-color: rgba(148, 163, 184, 0.35) #08090a`), eliminando calhas brancas nativas do Windows/Chrome.

---

## 3. Matriz Resumo das Implementações

| Módulo / Funcionalidade | Implementação em Código | Benefício Operacional |
|---|---|---|
| **Perímetro de Supressão** | `drawSuppressionPerimeter` em `editor.ts` e `fastModel.ts` | Visualização clara do raio de combate terrestre (m/h) conforme a tese UMinho 2025. |
| **Corte Progressivo de Estradas** | Função `clipRoadToFire` em `editor.ts` | Estradas cortadas surgem apenas quando o fogo as intersecta no tempo $T$. |
| **Foco Preciso na Ignição** | `flyToIgnition` com amostragem de DEM em `main.ts` | Elimina câmara subterrânea; centraliza a vista 3D diretamente no marcador **I**. |
| **Alinhamento a Norte** | `resetNorth` com `readPose` em `main.ts` | Reorienta a câmara para $0^\circ$ instantaneamente com transição suave. |
| **Bússola Dinâmica 60 FPS** | `updateCompass` ligado a `scene.preRender` em `hud.ts` | Rosa dos ventos intuitiva e síncrona com a rotação 3D do modelo. |
| **Alerta Crítico & Mobilização** | Cache de estados e `mobilizeAerial` em `hud.ts` e `editor.ts` | Alerta minimizado para chamas $>3.5\text{ m}$ com despacho automático da base aérea mais próxima. |
| **Ataque Direto Aéreo** | Restrição de tarefas condicionadas por `isAerial` em `editor.ts` | Bloqueia tarefas incompatíveis (como proteção de casas) para aeronaves. |
| **Ordem de Decisão Operacional** | Reordenação DOM em `editor.ts`: Meio $\rightarrow$ Quartel $\rightarrow$ Tarefa | Fluxo sequencial lógico que reflete a tomada de decisão da ANEPC. |
| **Suíte de Ícones Táticos** | Módulo `icons.ts` com SVGs limpos | Interface homogénea, profissional e sem elementos visuais ruidosos. |
| **Seta Retrátil de Gaveta** | Componente `.editor-edge-toggle` em `hud.ts` e `hud.css` | Abertura do menu de decisões via rato sem obrigar ao uso de atalhos de teclado. |
| **Scrollbars Dark Theme** | Regras W3C e WebKit em `editor.css` e `hud.css` | Elimina barras brancas deslocadas do tema escuro da aplicação. |

---

## 4. Instruções de Teste e Validação

Para validar as alterações localmente:
1. Abrir o terminal no diretório `web/`:
   ```bash
   cd web
   npm run build
   npm run dev -- --host 0.0.0.0
   ```
2. No navegador, aceder a:  
   **`http://localhost:5173`**
3. **Casos de Teste Recomendados:**
   * **Navegação:** Rodar o mapa 3D e verificar a rotação síncrona da bússola no canto inferior direito. Clicar no botão da bússola para repor o Norte e no botão da chama para centrar no marcador **I - Ignição**.
   * **Corte de Vias:** Avançar a barra temporal no leitor e confirmar que os troços vermelhos tracejados só aparecem quando o fogo cruza as estradas.
   * **Alerta Crítico:** Verificar o ícone de aviso quando o comprimento de chama for extremo e testar o botão "Mobilizar Meios".
   * **Decisões A vs B:** No menu esquerdo (aberto pela nova seta lateral), colocar um VFCI na Decisão A e ativar o ecrã dividido (*split screen*) para comparar a contenção face à Decisão B.
