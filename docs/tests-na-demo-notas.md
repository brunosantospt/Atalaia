# Demo Penha — estado atual e verificação (22 out 2026)

A demo usa agora o **modelo rápido**, acionado pelo botão **Simular modelo rápido**. O cálculo corre num Web Worker: editar, mover o rato e abrir o editor não lançam simulações. **ELMFIRE fica em pausa na interface**; a API, o adapter, os parâmetros de calibração e os processos de outras sessões não são alterados.

## Executar

```bash
cd web
npm run dev
```

Abrir http://localhost:5173. Antes do primeiro cálculo aparece apenas a referência guardada. Compor manualmente A e B e carregar em **Simular modelo rápido**; o botão calcula Livre/A/B, incluindo planos vazios. Não é necessário iniciar API ou Docker para a demo. Alterações posteriores exigem novo clique. O realizador só reproduz planos que já foram simulados.

O modelo rápido recupera a aproximação anterior de chegada por caminhos mínimos, com combustível, vento/FWI e declive. É uma aproximação para demonstração, sem a física completa do ELMFIRE. Faixas terrestres fixas tornam-se não combustíveis na ETA; apoio aéreo abranda a zona atribuída desde a chegada. Água/autonomia da interface não entram neste cálculo.

## Meios, IDs e cartões

- As origens têm letras: A/B/C para os quartéis em jogo; letras seguintes para as bases aéreas. A letra aparece no marcador da origem, na seleção e no cartão do meio, com a cor correspondente.
- Cada viatura, equipa ou aeronave tem um círculo próprio. No mapa, a etiqueta contém **só o ID**: `A1`, `A2`, `B1`… A numeração é a contagem atual dos meios de cada origem, independente da decisão A/B. Remover meios compacta os números; os de outras origens mantêm a sua sequência. Chaves internas estáveis continuam a servir o editor e a reutilização dos elementos.
- O cartão de hover tem moldura neutra, título curto, estado de chegada e uma lista de pontos: origem, tarefa, autonomia restante e comprimento da linha. Sem a anterior moldura vermelha, descrição longa de recursos ou rodapé SIOPS.
- Mostra **tempo no local desde a ETA**, ou tempo até chegar, e **água em percentagem**, que desce com o relógio, incluindo quando o rato fica parado. Estimativas visuais da demo: VFCI 15 min, VTTU 30 min, equipa 60 min, HEBL 25 min e AVBP 60 min. Antes da chegada: 100%; nunca abaixo de 0%. Recuar o relógio repõe o estado correspondente. Não há reabastecimento automático representado nestes indicadores.
- O tanque visual pode chegar a 0% sem retirar a faixa do modelo. O cartão identifica água/autonomia como indicadores visuais; não há dependência de água na propagação.
- Símbolos claros, aro da origem e texto HTML/SVG nítido mantêm-se. Meios coincidentes abrem em leque e conservam o alvo de picking alinhado.

## Linhas e colocação

- **100 m por viatura terrestre; 50 m por equipa apeada.** Sempre segmentos retos de dois pontos, desde a ETA, sem extensão prevista ao longo da frente, troços futuros ou corredores largos de cobertura.
- Vários meios têm segmentos paralelos com o mesmo comprimento individual. Rodar linha e Auto continuam a funcionar nos pontos; o traçado apeado define a direção do seu segmento fixo.
- No editor vê-se a cobertura prevista da colocação. No realizador, a linha só aparece quando o meio chega.
- Equipas apeadas podem ficar fora de estradas; veículos aproximam-se dos acessos rodoviários. A ETA inclui despacho, saída e viagem. Mantêm-se as verificações de aproximação e o contorno de chegada do fogo; este não é um limite radial de colocação.
- A geometria ELMFIRE anterior continua disponível em `wetLine.ts` para cenários fora do modo demo. O modo demo usa `demoLines.ts`, sem modificar o contrato do adapter.

## Realizador

- Abrir o editor pára relógio e voo da câmara, esconde título/legenda/retícula/dados narrativos, spotlight e comparação final. Meios, POI, previsão operacional e relógio continuam disponíveis.
- Sequência cronológica: ignição → mobilização → chegadas → satélite → controlo → mudança de vento → nova decisão. Blocos de no máximo **5 minutos simulados**, com navegação pelas etapas principais.
- Cada meio espera na sua origem até à saída, percorre o trajeto entre saída e ETA e termina na posição atribuída. Viaturas seguem a rota rodoviária segura; equipas e aeronaves seguem o percurso direto. A animação usa as ETAs existentes, sem recalcular a velocidade a cada frame.
- A câmara enquadra origens e destinos durante o trânsito. **Pausa em cada instante de chegada** (meios que chegam juntos partilham a pausa); carregar em play continua para a chegada seguinte. Recuar/recomeçar rearma as pausas.
- Mudança de vento em T+150: pára e pede revisão. **Não corre um modelo automaticamente.** O botão **Simular com o vento novo** executa a previsão Livre/A/B na meteorologia alterada, ainda no worker. Só depois é possível continuar a reprodução.
- O final de contenção depende da chegada simulada: sem novas células na última hora do cálculo, sem saída da grelha nem corte no limite de área. O corte/horizonte não é apresentado como contenção.
- Se contido, o final sobrepõe **sem decisão / decisão A / decisão B**, da maior área para a menor, a intervalos de 0,4 s. Legenda com cor/hectares; “≥” identifica áreas cortadas pela grelha/limite. Compara o fim de cada corrida.

## Cenário e interface preservados

- Ignição **41°25′14.7″N 8°16′10.0″W** (41.420750, −8.269444), às 10:00 de 16 set 2024. Drone T+10; satélite T+30. Dados meteorológicos mantêm o vento reduzido a metade (IFS ×0,8 e pico sintético de 24 km/h).
- A referência ELMFIRE guardada continua no repositório, separada do cálculo rápido da demo. Os seus valores anteriores de 11,3 ha a 1 h e 27,2 ha a 2 h não são resultados do modelo rápido.
- Três quartéis, hospital e bases próximas persistem desde a abertura. Hospital: **41°26′31.7″N 8°18′20.0″W**. Sem detalhes cinzentos ou raio branco dos quartéis.
- **Onde o fogo chega primeiro que qualquer resposta** mantém checkbox e explicação dobrável. A previsão usada passa a ser a do modelo rápido após o clique de simulação.
- Sem mapa de calor ou otimização automática. A proposta ILS de B integrada de Bruno mantém-se opcional, apenas no botão **Propor B**; esse botão substitui B, editar A não lança pesquisa nem altera B. A procura pontua no mesmo modelo de faixas fixas da demo e depois é necessário carregar em Simular. Renderização a pedido, hover agrupado sem picks durante arrasto/zoom e cache de rotas/relatórios mantêm-se.

## Verificação

- `npm run build`, `npm run ils:check`, `npm run demo:check`, `npm run director:check`, `npm run demo-units:check`, `npm run placement:check`, `npm run deployment:check` e `npm run interaction:check`.
- Testes cobrem IDs por origem e compactação, 50/100 m por meio, água exclusivamente visual, propagação rápida e faixas temporizadas, trajetos, pausas de chegada, cronologia de 5 min, contenção honesta, ETAs, aproximação, rotação, colocação apeada e cache do hover/relatórios.
- A verificação de browser usa Firefox/WebGL isolado com todos os pedidos de API bloqueados; o worker rápido real é permitido. Verifica ausência de execução automática, o botão, IDs/remoção, picking e cartão de água, deslocações e pausas, novo clique após a rotação do vento e pesquisa ILS apenas no botão opcional, preservando A. Sem erros de consola nem pedidos de API.

As alterações de `pitch/` e `docs/tests-na-demo-README.md` da outra sessão ficam fora deste trabalho.
