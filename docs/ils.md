# ILS · otimização das decisões

Formulação do artigo premiado de um dos nossos orientadores, para gerar e ordenar decisões no Atalaia em vez de só comparar A e B desenhadas à mão.

- **Artigo:** Mendes, A. B. & Alvelos, F. P. (2023). *Iterated local search for the placement of wildland fire suppression resources*. European Journal of Operational Research 304(3), 887–900. [doi:10.1016/j.ejor.2022.04.037](https://doi.org/10.1016/j.ejor.2022.04.037). Versão aberta no RepositóriUM: [hdl 1822/89804](https://hdl.handle.net/1822/89804).
- Projeto O3F (FCT PCIF/GRF/0141/2019, PI Filipe Alvelos). Prémio Isabel Themido 2025 da APDIO.
- **Sugestão dos orientadores (Elsa Silva, Filipe Alvelos):** "definir meta-heurística → adicionar meios → ver vizinhança com pesquisa local → avaliar com algoritmo (construir solução → melhorar [o verdadeiro apoio à decisão])". É o esqueleto da secção 2.

| Sugestão | Artigo |
|---|---|
| definir meta-heurística | ILS (Algoritmo 1) |
| adicionar meios / construir solução | heurística construtiva aleatória multi-arranque (Alg. 2–3) |
| ver vizinhança com pesquisa local | pesquisa local de melhor melhoria (Alg. 4) |
| avaliar com algoritmo | Dijkstra (tempo mínimo de chegada) → células ardidas no instante `h` |
| melhorar | perturbação + pesquisa local em ciclo (Alg. 5) |

---

## 1. Problema

- Paisagem em grelha, como grafo `(N, A)`: os nós são células e os arcos ligam células vizinhas.
- `c_ij` é o tempo de propagação do fogo de `i` para `j`. É direcional, porque depende de vento, declive e combustível, e vem de um modelo de comportamento do fogo.
- A propagação segue o **tempo mínimo de chegada** (MTT, Finney 2002). O instante em que o fogo chega a cada célula é o caminho mais curto desde a ignição `ign`, calculado com Dijkstra.
- Os meios ficam disponíveis em instantes `b_1 < … < b_h`: no instante `b_k` chegam `a_k` meios.
- **Pôr um meio na célula `i`** tem dois efeitos: `i` fica protegida (não arde) e todos os arcos que saem de `i` ficam `Δ` mais lentos.
  - Com `Δ` pequeno, o meio funciona como retardante.
  - Com `Δ ≥ h − b_1 + 1` (cerca de 20 no artigo), funciona como barreira.
- O meio só pode ir para uma célula aonde o fogo ainda não chegou quando o meio fica disponível: `t_i ≥ b_k`.
- **Objetivo lexicográfico:**
  1. minimizar as células ardidas no instante-alvo `h`;
  2. depois, minimizar o número de meios usados.

  Os dois juntam-se num só objetivo, com peso `ε = 1/|R|`.

## 2. ILS (o que vamos implementar)

```
s  ← melhor de NCH construções aleatórias          # construir: adicionar meios
s  ← pesquisaLocal(s)                               # melhorar
repetir até MAXPERT perturbações ou 50 seguidas sem melhoria:
    s' ← pesquisaLocal(perturbar(s))
    se f(s') < f(s): s ← s'                         # só aceita melhorias
devolver s
```

**Avaliação.** `f(s) = (células com t_i ≤ h e sem meio) + ε · (nº de meios)`.

- Exige um Dijkstra com os atrasos `Δ` dos meios colocados.
- Uma solução é **viável** se, depois de recalcular os tempos de chegada, nenhuma célula com meio tiver `t_i` menor do que o instante em que o meio lá foi posto. Mover um meio altera os caminhos do fogo e pode tornar inviável outro meio.

### 2.1 Construção aleatória (repetida NCH vezes, fica a melhor)

```
enquanto houver meios livres e células que ardem antes de h:
    b   ← menor instante de disponibilidade dos meios livres
    t   ← Dijkstra
    ardidas ← {i : t_i < b}                         # já não dá para proteger
    RCL ← as L primeiras células não ardidas, por ordem crescente de t_i (as próximas a arder)
    i   ← sorteada da RCL; pôr o meio em i; somar Δ aos arcos de i para vizinhos não ardidos
```

### 2.2 Pesquisa local (melhor melhoria)

```
repetir:
    para cada célula i0 com meio:
        tirar o meio de i0 (tirar Δ); Dijkstra
        V ← vizinhança reduzida (ver abaixo)
        para cada i1 em V:
            pôr o meio em i1; Dijkstra
            se viável e melhor que o melhor movimento até aqui: guardar (i0 → i1)
            tirar o meio de i1
        repor o meio em i0
    se houve melhoria: aplicar o melhor movimento
até não haver melhoria
```

- **Vizinhança:**
  - Junta as células adjacentes ou diagonais a células que já têm meio. A ideia é formar barreiras contínuas, e pode haver mais de uma.
  - Tiram-se as ardidas, ordena-se por `t_i` crescente e ficam as primeiras `LN`.
- A pesquisa local nunca muda o número de meios. Isso só acontece na construção e na perturbação.

### 2.3 Perturbação

- **Com probabilidade `p1 = 7,5%`:** tirar o meio colocado mais tarde. Serve o 2.º objetivo, quando sobram meios.
- **Com probabilidade `p2 = 2,5%`:** acrescentar um meio, como num passo da construção. Só se houver meios livres; senão `p2 = 0`.
- **No resto (90%):** mover `U(3,5)` meios, um de cada vez:
  1. tirar um meio sorteado e correr Dijkstra;
  2. gerar uma vizinhança **alargada**: qualquer célula não ardida, sem a exigência de ser adjacente a um meio, ordenada por `t_i`, com as primeiras `LN`;
  3. sortear uma célula, colocar o meio e correr Dijkstra;
  4. se ficar inviável, desfazer e contar uma falha (máximo 100 falhas).
- No fim, corre-se Dijkstra uma vez e avalia-se.

### 2.4 Parâmetros do artigo

| | 6×6 | 10×10 | 20×20 | 30×30 |
|---|---|---|---|---|
| máx. perturbações (ILS) | 75 | 100 | 200 | 250 |
| máx. iterações sem melhoria | 50 | 50 | 50 | 50 |
| repetições da construção (NCH) | 500 | 500 | 1000 | 1000 |
| tamanho da RCL (L) | 5 | 5 | 6 | 6 |
| tamanho máx. da vizinhança (LN) | 6 | 10 | 20 | 30 |

Os restantes valores são iguais em todos os tamanhos: `p1 = 7,5%`, `p2 = 2,5%`, modificações `U(3,5)`, 100 falhas. Nos testes do artigo, `Δ = 50`, `h = 28` e os meios chegam em dois lotes, aos instantes 10 e 15.

## 3. Modelo MIP (referência; serve para validar o ILS em grelhas pequenas)

O modelo é do Alvelos (2018). Junta uma árvore de caminhos mais curtos, para os tempos de chegada do fogo, com a colocação de meios.

**Variáveis:**
- `x_ij`: fluxo na árvore;
- `q_ij ∈ {0,1}`: arco na árvore;
- `t_i`: instante de chegada do fogo;
- `s_ij ≥ 0`: folga;
- `y_i^k ∈ {0,1}`: `i` ardida em `b_k`;
- `z_i^{kr} ∈ {0,1}`: meio `r` posto em `i` em `b_k`;
- `o_k`: meios guardados para `k+1`.

`M = (n−1)·c_max + (|R|−1)·Δ`.

$$\min \sum_{i} y_i^{h} + \varepsilon \sum_{i,k,r} z_i^{kr}$$

- **Árvore de caminhos a partir da ignição:**
  - `Σ_j x_{ign,j} = n−1`;
  - entrada − saída = 1 em cada `i ≠ ign`;
  - `x_ij ≤ (n−1) q_ij`;
  - `t_ign = 0`.
- **Tempos de chegada com atraso:**
  - $t_j − t_i + s_{ij} = c_{ij} + Δ\sum_{k,r} z_i^{kr}$;
  - $s_{ij} ≤ M(1 − q_{ij})$.

  Com estas duas restrições, nos arcos da árvore vale a igualdade e nos outros `t_j ≤ t_i + c_ij + Δ·[meio em i]`. Isso dá exatamente os caminhos mais curtos.
- **Meios:**
  - cada meio vai a no máximo uma célula, e cada célula recebe no máximo um meio;
  - balanço por instante: $\sum_{i,r} z_i^{kr} + o_k = a_k + o_{k−1}$, com `o_0 = 0`;
  - colocar um meio só se o fogo ainda não chegou: $z_i^{kr} ≤ 1 + (t_i − b_k)/b_k$.
- **Ardida em `b_k`:** quando `t_i ≤ b_k` e `i` não tem meio até `k`. Escreve-se com dois limites, um inferior e um superior:
  - $y_i^k ≥ (b_k − t_i + 1)/b_k − \sum_r\sum_{l≤k} z_i^{lr}$;
  - $y_i^k ≤ 1 + (b_k(1 − \sum_r\sum_{l≤k} z_i^{lr}) − t_i)/M$.

## 4. Resultados (para o pitch)

- **Testes:** 64 problemas, isto é, 32 grelhas de 6×6 a 30×30, cada uma com 5 ou 6 meios. Ignição ao centro e vento de SE ou S.
- **Qualidade:**
  - o ILS chegou ao ótimo em **40 de 41** casos com ótimo conhecido; no único que falhou, ficou a 1,0%;
  - contando também os limites inferiores não ótimos, o desvio médio é de 2,8%.
- **Tempo e escala:**
  - **52,5 s** em média no ILS, contra **802 s** no Gurobi;
  - a partir de 20×20 o Gurobi esgota a memória, e em 30×30 nem arranca.
- **Estabilidade:** o coeficiente de variação entre corridas é ≤ 0,8%. O ILS melhora a construção em 3,5–10,2%, e mais nas grelhas maiores.
- O código era Python 3.8 com NetworkX (Dijkstra).
- **Trabalho futuro apontado pelos autores:**
  - tipos de meios diferentes;
  - proteção de bens;
  - movimento dos meios (o fogo corta caminhos);
  - outro simulador além do MTT;
  - incerteza (seguiu para a versão robusta, SSRN 4385923).

## 5. No Atalaia

| Artigo | Atalaia |
|---|---|
| grelha `(N, A)`, `c_ij` | grelha de 30 m, 16 vizinhos, ROS de Rothermel simplificado com vento, declive e humidade (`web/src/fastModel.ts`) |
| Dijkstra MTT | `simulate(scenario, decision)`, que já é Dijkstra com heap; `burnedHa(grid, run, t)` |
| meio `r` disponível em `b_k` | `Assignment` de uma unidade de um quartel; o instante sai de `arrivalMin` (saída + estrada ou voo) |
| pôr o meio na célula `i` | ponto de acesso em `Decision.points` (tarefa `direct`) |
| `Δ` retardante | `rosFactor` da unidade na zona que segura, se a chama ≤ `holdFlameM` (Byram) |
| `Δ` barreira | linha (`lineAt`): o fogo não entra se a linha já está feita |
| viabilidade `t_i ≥ b_k` | janelas de trabalho em `held()`: a unidade só segura depois de chegar |
| `f` = ardidas(h) + ε·meios | métrica do P9: aldeias atingidas → área ardida → ε·unidades (lexicográfico, como no artigo) |

O Atalaia já cobre três extensões que os autores deixam como trabalho futuro:
- tipos de meios: `crew`, `vfci`, `vttu`, `hebl`, cada um com limite de chama e fator de ROS;
- proteção de bens: aldeias e casas do OSM;
- um MTT mais rico, confirmado pelo motor físico (ELMFIRE ou SimFire).

**Decisões (20 out):**
- **Saída:** o ILS dá a **decisão B** do P9.
  - O A é o plano do comandante; o B é o plano otimizado com os mesmos meios.
  - Fica a comparação de duas decisões que a app já tem (`recommend(a, b)` e a vista dividida).
  - O A entra como solução inicial, por isso o B nunca é pior que o A no modelo rápido.
- **Onde corre:** em TypeScript, num Web Worker, por cima do `simulate()`. Assim não se duplica o modelo em Python (lição do protótipo: cada coisa num só lugar).
- **Candidatos:** os pontos de acesso na estrada que o editor já usa (`context.access`, um a cada 80 m).
  - Uma unidade segura uma zona de centenas de metros, não uma célula de 30 m.
  - Só contam pontos aonde o meio chega antes do fogo.
  - A vizinhança da pesquisa local são os pontos a ≤ ~300 m do ponto atual.
- **Orçamento:** uma avaliação (`simulate()` + `makeReport()`, 6 h) custa 3–4 ms em Vieira e ~2 ms em Cabeceiras. São medianas de 200 corridas, neste Mac, a 20 out.
  - Em 10 s cabem ~2–5 mil planos, contra as dezenas de milhares do artigo.
  - Escalam-se em conformidade o número de construções (NCH), o tamanho da vizinhança (LN) e o número de perturbações. Por exemplo: NCH ≈ 100, LN ≈ 8, perturbações até esgotar o tempo.
  - Se a máquina da demo for mais lenta, baixa-se o orçamento, não o modelo.
