# Demo Penha — estado atual e verificação (22 out 2026)

A demo tem um incêndio simulado na Penha. **Só o ELMFIRE simula a propagação.** A e B são planos manuais independentes; não há mapa de calor, modelo rápido, procura ILS, worker ou respetivos scripts/fixtures. Os tipos e cálculos partilhados de chegada/barreiras estão em `scenario.ts` e `deployment.ts`, sem simulação no browser. O FWI do painel de meteorologia continua a ser um índice meteorológico, não um motor de propagação.

## Executar

```bash
api/setup.sh
api/serve.sh               # 5181; Docker com atalaia/elmfire:2025.0717
cd web && npm run dev      # 5173
```

Abrir a Penha, editar A e/ou B e carregar em **Simular no ELMFIRE**. Só simula quando os meios mudam. A API usa tarefas consultadas a cada 1,5 s; o véu de carregamento mostra o progresso. Os motores pedidos à API são serializados. A previsão sem meios fica em cache; sem API, usa-se a progressão ELMFIRE guardada no repositório.

## Cenário e vento

- Ignição **41°25′14.7″N 8°16′10.0″W** (41.420750, −8.269444), em 16 set 2024 às 10:00. Paisagem existente de 27 × 27 km, células de 30 m.
- Todas as velocidades e rajadas foram reduzidas a metade da versão anterior, tanto em `weather.json` como em `weather_noshift.json`. Direções, temperaturas, humidade e precipitação mantêm-se.
- IFS ×0,8, antes ×1,6. Vento sintético máximo **24 km/h**, antes 48. Secura reduzida de 2 pontos e mínimo de humidade de 3 % mantêm-se.
- Referência ELMFIRE regenerada com `scripts/.venv/bin/python -I scripts/build_hypothetical.py --keep-grid`. O gerador só aceita ELMFIRE; saíram `--model fast` e `--compare`.
- Abertura mais moderada: **37,4 → 11,3 ha à 1 h**, **65,6 → 27,2 ha às 2 h**. No novo cache sem rotação, T+10 tem 0,45 ha e ROS da cabeça de cerca de **3 m/min**, abaixo do limiar crítico existente de 50 m/min. Não foram alterados os limiares de aviso.
- Com a rotação e projeções, a referência de 6 h é **341,1 ha**, antes 322,5 ha: reduzir o vento não garante menor área em todas as horas numa corrida com spotting. O pico e a propagação inicial são menores; não se ajustou outro parâmetro para forçar o resultado.
- O incidente é anunciado às 12:30 (T+150); a rotação decorre das 12:00 às 13:00. A reprodução pausa para realocar e simular com o novo vento.
- O replay começa no avistamento do drone (T+10); o fogo foi simulado desde T+0. Abrir o editor preserva o relógio, em vez de saltar para o fim das 24 h. Satélite aos T+30.

## Meios e linhas

- Cada colocação guarda `dispatchMin`. A ETA soma despacho, saída e viagem; lista, mapa, contorno e barreiras seguem esse relógio. Planos A/B não se sobrescrevem ao editar; **Repor exemplo** atua na decisão selecionada.
- Brigadas ficam nas coordenadas clicadas, fora de estradas, incluindo linhas. Veículos aproximam-se dos acessos rodoviários. Mantêm-se as verificações de chegada e aproximação ao fogo.
- `unlimitedWater: true`: linhas terrestres permanentemente não combustíveis a partir da chegada/conclusão, sem secagem nem reabastecimento. Crescem à taxa nominal durante o turno de 12 h. VTTU fazem proteção/ataque.
- **Rodar linha** (0–179°) e **Auto** alteram a geometria real enviada à API. A orientação automática e o crescimento usam agora a previsão livre **ELMFIRE**, não uma corrida oculta do modelo rápido. Mudar a previsão invalida a cache das linhas.
- Contrato mantido: `path`, `width_m`, `from_min`, no máximo seis instantes por decisão. O adapter, testes partilhados e parâmetros de calibração ELMFIRE não foram alterados.
- Meios aéreos mantêm colocação e ETA; o contrato de barreiras deste cenário não representa descargas aéreas. O tooltip declara essa limitação.

## Interface e desempenho

- Descrições do realizador reduzidas: deteção, previsão, chegada dos meios, comparação e resultado em frases curtas. Os planos da decisão usam as mesmas ETAs do editor.
- **Onde o fogo chega primeiro que qualquer resposta**: checkbox para mostrar o contorno e dropdown fechado por omissão para a explicação. A expansão mantém-se ao trocar quartel/meio/relógio. Os detalhes identificam a resposta selecionada e explicam a comparação dos tempos.
- O contorno segue a forma do fogo e a chegada do meio selecionado; a aproximação é verificada em passos de 15 m. Não é um limite radial de colocação.
- Ícones dos cinco botões centrados, sem compressão: saiu a altura herdada de 26 px; os botões passam a 58 px mínimos para conter ícone e nome.
- Cada grupo colocado tem um ID estável (`A-01`, `A-02`, `B-01`…), repetido no mapa, lista e tooltip. Remover grupos não renumera os restantes nem reutiliza os seus IDs; o exemplo e a limpeza conservam o contador da decisão.
- Círculos dos meios têm 36 px, fundo claro, símbolo SVG e aro da origem. A mesma paleta identifica quartéis/bases aéreas, contorno de chegada e linhas de chamada. Grupos no mesmo local abrem-se em leque, ligados à posição real por uma linha da sua cor.
- Ícones e etiquetas de meios/POI são desenhados como HTML/SVG fora da pós-produção escura do globo. Texto de mapa a 13 px, também nítido no perfil Leve; sem aumentar a resolução ou o custo da renderização do terreno. O picking continua no Cesium, alinhado com os círculos, com o hover agrupado existente.
- Os helicópteros do exemplo saem agora das bases reais mais próximas, respeitando o stock, em vez da origem genérica `air`. As cores dos seus aros correspondem às bases identificadas no mapa.
- Quartéis, hospital e três bases aéreas próximas persistem desde o primeiro plano. Há ícones de tamanho fixo no terreno, mesmo quando o HUD esconde um rótulo longo. Não dependem de chegar ao plano de visão geral. A legenda não se sobrepõe às coordenadas da câmara.
- Não há texto cinzento secundário nos marcadores nem raio branco à volta dos BV. O hospital está em 41°26′31.7″N 8°18′20.0″W.
- Mantém-se a renderização a pedido, sem redraw contínuo em pausa. Hover agrupado a cada 80 ms, sem picks durante arrasto/zoom/inércia, tooltip reutilizado, relatórios multiagência e respetivo DOM em cache.
- Dijkstra usa heap e reutiliza rotas; não há procura automática de planos no background.

## Verificação

- `npm run build`, `npm run demo:check`, `npm run placement:check`, `npm run deployment:check` e `npm run interaction:check` passam.
- Testes cobrem previsão ELMFIRE obrigatória (sem fallback de simulação), igualdade das barreiras enviadas/desenhadas, contornos assimétricos, aproximação, ETAs, rotação, água ilimitada, colocação apeada, independência A/B, rotas/cache, hover e relatórios.
- Verificação de dados: todas as velocidades e rajadas correspondem à metade dos valores anteriores (tolerância de arredondamento 0,05 km/h); direções inalteradas. Cenário e meteorologia regenerados.
- Firefox/WebGL isolado: perfil antigo de calor migra para satélite; três quartéis e hospital visíveis na abertura, sete ícones persistentes; dropdown expande e mantém-se; cinco ícones centrados; exemplo em A preserva B, rotação funciona e botão ELMFIRE fica disponível; realizador mostra descrições curtas. Sem erros de consola.
- Verificação posterior em Firefox: IDs mantidos ao mudar o relógio, remover e adicionar grupos; IDs e cores iguais na lista/mapa, incluindo equipas em linhas; stock e origem real das aeronaves; picking no círculo devolve o grupo correto; etiquetas a 13 px mesmo no perfil Leve. Ícones claros e texto verificados visualmente. Sem pedidos de simulação.
- As corridas de regeneração foram sequenciais, em containers isolados limitados a 2 CPUs e 3 GB. No teste de browser os pedidos de simulação foram bloqueados. Nenhum processo da calibração de outra sessão foi interrompido; ficheiros do motor partilhado mantidos.

## Limites e integração

Uma linha aberta pode ser contornada nas extremidades ou ultrapassada por spotting. As faixas ocupam células inteiras de 30 m. A ETA usa distância × fator rodoviário, sem modelo de marcha a pé; mudar o vento não retira automaticamente os meios que ficaram numa posição insegura.

Mantêm-se os defaults de humidade, copas LiDAR e cicatrizes do hindcast step 3 integrado de `main`. O bloco `engine` da Penha mantém os combustíveis portugueses, copas típicas, spotting, semente 2 e humidades vivas 30/70. As edições de `pitch/` e `docs/tests-na-demo-README.md` da outra sessão ficam fora deste trabalho. Os commits anteriores guardam o histórico de recuperação do merge e dos modelos entretanto retirados.
