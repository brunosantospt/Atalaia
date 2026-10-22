# Tests na demo — mudanças e verificação (22 out 2026)

Este ramo responde à lista **"Tests na demo"** do Build Week Plan. Traz também o `origin/main` até ao hindcast step 3.

A demo passa a ter **um só incêndio**, simulado na Penha. O fogo corre só no **ELMFIRE**, com um botão. Um **incidente de vento** obriga a realocar os meios.

Verificações de 22 out 2026: `npm run build` (`tsc --noEmit` + Vite), `npm run ils:check`, `api/test.sh` com ELMFIRE real e o teste sintético `engines/elmfire/test.sh`. A API de tarefas da Penha foi verificada até ao resultado e à reutilização da cache: 521,01 ha às 6 h, contra 553,4 ha da referência (−5,85 %, dentro da tolerância de 10 %). **Falta a verificação visual num browser com WebGL** (ver o fim).

## Como correr

```bash
api/setup.sh        # uma vez
api/serve.sh        # porta 5181, precisa do Docker com atalaia/elmfire:2025.0717
cd web && npm run dev
```

Na primeira vez, abrir a Penha com a API ligada. A previsão sem meios (24 h) fica em cache para os dois ventos.

## O cenário: Penha, Guimarães (simulado)

- **Ignição:** 41°25′42.8″N 8°16′17.4″W, a 16 set 2024 às 10:00.
- **Meteo:** IFS real desse dia, com o vento ×2.
- **Grelha:** 27 km × 27 km, 900 × 900 células de 30 m.
- **Calibração:** à ordem de grandeza do incêndio de **Paredes, 17 set 2024** (PT-FireSprd v2, uso interno). Do v2 só se leram áreas e ROS; nenhuma geometria de 2024 está no repositório.
- **Incidente de vento às 12:30 (T+150):** de E a 45 km/h para NNO a 65 km/h, com rajadas de 91 km/h. A cabeça roda de O para SE, sobre Abação, Pinheiro, Lapinha, Calvos e Tagilde.
  - Às 6 h ardem 553 ha com a rotação e 178 ha sem ela.
- **Referência cortada aos 2000 ha:** 400 anéis e 320 KB, contra os 1105 anéis e 1,6 MB de antes. Assim o browser não fica lento.
- **Deteção:** drone aos 10 min, satélite aos 30 min (`detection.json`).
- **Construção:** reproduzível com `scripts/build_hypothetical.py`. Os outros incêndios continuam no disco, mas fora do `index.json`.

## Fluxo de decisão

- **ELMFIRE em vez do modelo rápido:** o modelo rápido já não aparece no ecrã. Fica só por dentro do ILS, para propor o B.
- **Botão "Simular no ELMFIRE":** acende-se só quando a disposição dos meios mudou.
  - Durante a corrida, um véu de ecrã inteiro bloqueia tudo. Mostra o tempo decorrido e o progresso Livre / A / B, troço k/n.
- **API assíncrona:** `POST /api/jobs` e `GET /api/jobs/{id}`, com consultas a cada 1,5 s. Isto resolve o "NetworkError" das corridas com mais de um minuto. `/api/run` continua igual.
- **Abertura e corte do diretor:**
  - fogo ao avistamento do drone (T+10);
  - fogo ao avistamento do satélite (T+30);
  - previsão ELMFIRE sem meios.
- **Incidente de vento:**
  - Antes do incidente, os planos usam a previsão sem a rotação (`wind_shift: false`).
  - Às 12:30 a reprodução pausa e aparece um só botão, "Realocar meios".
  - Não se passa do incidente sem uma nova corrida ELMFIRE com o vento real.
- **Fim do incêndio:** "Extinto às HH:MM · N ha", ou "corte aos 2000 ha".

## Meios

- **Wet lines:**
  - Cada meio terrestre põe uma faixa azul-clara que é exatamente o `decision.barriers` do ELMFIRE.
  - A faixa cresce pela frente do fogo ao ritmo de ataque do meio: VFCI ~240 m/h, brigadas pela NWCG.
  - O crescimento é limitado pela água, pelos reabastecimentos e por um turno de 12 h.
  - Há no máximo 6 `from_min` por decisão.
- **Só os 3 quartéis mais próximos:** BV Guimarães, Vizela e Fafe.
  - Cada um tem um **anel de interceção centrado na ignição**: a distância até ao primeiro encontro entre o fogo e os meios no percurso do quartel para a ignição, comparando o minuto de chegada do fogo com deteção + saída + viagem até cada ponto. Não se soma o alcance de mangueira. Os raios são atualizados com a previsão após o incidente de vento.
  - **Colocar por fora do anel**: deixou de existir um limite máximo de distância à ignição. Pontos interiores são recusados; o percurso até ao destino também é verificado para não atravessar o fogo. O ILS usa as mesmas regras de interceção.
- **Colocação:** um botão por meio, e cada meio coloca-se com um clique no mapa. Saíram "+ colocar meio" e "clicar no mapa".
- **Rotas:** a azul-escuro.
- **Início vazio:** os cenários começam sem meios. "Repor exemplo" continua disponível.
- **ILS do Bruno:** as linhas de A, com mover, deslocar e encurtar, estão integradas nas wet lines. O `ils:check` foi atualizado, e B continua a bater A nos dois incêndios de referência.

## Visual e HUD

- **Fogo simulado:** liso, com o estilo do fogo observado: linha âmbar, últimos 30 min em âmbar suave e brasa escura.
  - Aparece desde T+0, com um brilho mínimo enquanto é pequeno.
  - As células batem com o minuto do relógio.
- **Linhas brancas:** substituídas por uma linha verde, "Melhor caso · X ha".
- **Anéis de 1/2/5 km e raio de ignição:** removidos.
- **"Satélite deteta o fogo · HH:MM":** substitui o T_sat.
- **Coordenadas:** são as da **mira**, no centro do ecrã.
- **Luz de foco:**
  - Segue a mira em cada frame.
  - Tem tamanho fixo no ecrã; só o corte do diretor (D) a ajusta por plano.
- **Painel de alertas:**
  - habitações em risco em menos de 1 h;
  - meios com pouca água;
  - velocidade de propagação crítica: aviso a 16,8 m/min (Scott & Burgan 2005), crítico a 50 m/min (Tedim et al. 2018);
  - o incidente de vento.
- **Reprodução:**
  - A animação começa em pausa.
  - Há um só relógio para a reprodução e para o slider da hora.
  - Remover um meio já não afasta a câmara.
  - O relógio é partilhado com o reset (R); confirmar o comportamento visual no browser.
- **Correção:** o Cesium deixava de renderizar ("normalized result is not a number"). Agora as linhas no chão descartam pontos repetidos (`cleanPath`).

## A verificar no browser

1. Na abertura (T+10, T+30, Previsão), o fogo aparece desde T+0.
2. Colocar meios por fora dos anéis, com chegada antes do fogo no percurso, acende o botão. O véu de carregamento bloqueia tudo durante a corrida.
3. Às 12:30 aparece "Realocar meios". Não se avança sem simular, e depois o split mostra o resultado com o vento novo.
4. As wet lines crescem ao longo da frente. As rotas aparecem a azul-escuro.
5. A luz e as coordenadas ficam na mira.

## Limitações conhecidas

- **Referência vs API depois das 6 h:** o handoff relata grande variação entre as corridas de 24 h com projeções; essa comparação longa não foi repetida nesta recuperação. O teste atual confirmou apenas a tolerância às 6 h (−5,85 %).
- **Anéis e mudança de vento:** os meios já colocados não são retirados automaticamente se o vento mudar a zona de interceção.

## Merge do hindcast step 3 e recuperação do push

- Integrado `origin/main` (`c910095`), incluindo os três commits que faltavam. Mantêm-se as humidades mortas calculadas de hora a hora, as copas LiDAR e as cicatrizes nos incêndios históricos.
- A Penha não precisa de ficheiros LiDAR nem cicatrizes. O seu bloco `engine` continua a definir combustíveis portugueses, copas típicas, projeções, semente 2 e humidades vivas 30/70. As opções explícitas do pedido ganham aos valores do incêndio.
- A meteo sem rotação continua disponível e dá uma chave de cache diferente da meteo com rotação.
- `api/test.sh` verifica o índice público real e usa os incêndios históricos como fixtures isoladas; já não depende de estes aparecerem na seleção da demo. Inclui regressões dos valores da Penha após o merge.
- O gerador da Penha passa a usar diretamente `engines/elmfire/run.sh`. Foi removido o overlay duplicado, que ficou incompatível depois de o adapter principal incorporar combustíveis portugueses e projeções; a entrada antiga `scripts/elmfire_pt/run.sh` fica como encaminhamento.
- ILS, 2000 planos, semente 1: Vieira A 128,9 ha / B 105,3 ha, ambos 0 lugares; Cabeceiras A 477,5 ha / B 158,3 ha, 5 / 1 lugares. Os valores batem com `web/scripts/ils-reference.json`. São resultados do modelo rápido usado na pesquisa, não do ELMFIRE.
- SimFire não está instalado neste ambiente; as corridas reais da regressão API usaram ELMFIRE.
- As edições de `pitch/` da outra sessão ficam fora deste ramo e do PR.

## Interceção e ETA ao colocar meios

- O anel já não representa onde o fogo estará depois da viagem completa à ignição. Compara a propagação com a viagem parcial até cada ponto da aproximação e marca o primeiro encontro, com resolução de meia célula (15 m).
- A viagem usa a estimativa do modelo: distância quartel–destino × fator rodoviário / velocidade do meio, mais o tempo de saída. O anel de cada quartel toma como referência o primeiro VFCI; a verificação de colocação usa o meio escolhido e o instante da ordem.
- Cada meio colocado guarda `dispatchMin`, o minuto atual da ordem (nunca antes da deteção). A ETA é esse minuto + saída + viagem ao ponto ou ao primeiro vértice da linha. Os meios aéreos usam a base e a velocidade de voo.
- A lista mostra a hora prevista, T+ e os minutos que faltam; passa a indicar chegada prevista cumprida quando o relógio a alcança. Avançar o relógio não desloca a ETA de meios já colocados.
- As linhas enviadas ao ELMFIRE e a procura do B usam o mesmo relógio absoluto. O ILS conserva o instante de saída das unidades ao mudar os seus destinos; ordens de momentos diferentes não são agrupadas como se fossem a mesma.
- `npm run deployment:check` cobre a interceção contra uma solução analítica, colocação por fora/por dentro, destino por trás do fogo, saída mais tarde, meios terrestres/aéreos/linhas e ativação das barreiras. `npm run build` e `npm run ils:check -- --update` passam; B continua melhor que A nas duas referências.
