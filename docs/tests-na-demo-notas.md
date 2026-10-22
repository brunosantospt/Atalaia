# Tests na demo — o que já está feito (22 out 2026)

Tudo está no `main` local do Atalaia. Ainda não foi feito push nem testado no browser. Nenhum item foi marcado como concluído.

## Mudanças

- **Só um incêndio, Guimarães, com mudança brusca de vento:**
  - Novo incêndio simulado `Penha_Guimaraes_hipotetico`, que é o único no índice. A meteo é a real do IFS de 16 set 2024, e o vento roda às 12:30 (T+150): de E a 23 km/h para NNO a 36 km/h, com rajadas de 63.
  - A reprodução pausa às 12:30 e abre "Mudança brusca de vento" com dois botões, "Rever estratégia" e "Continuar sem alterar". Há também um alerta de vento e um marco "Vento roda" na linha do tempo.
  - Em curso: recalibrar o incêndio para a ordem de grandeza de Paredes, 17 set 2024, para ficar mais dramático e atingir aldeias depois da rotação.
- **Coordenadas na mira:** a leitura mostra o ponto no centro do ecrã (rótulo "Mira"), e a mira está mais visível. O clique copia na mesma.
- **Alertas especiais:** há um painel no canto superior direito com quatro tipos de alerta:
  - habitações atingidas em menos de 1 h (crítico abaixo de 30 min);
  - meios com pouca água ou sem água;
  - velocidade de propagação: aviso a partir de 16,8 m/min (Scott & Burgan 2005), crítico acima de 50 m/min (Tedim et al. 2018);
  - vento.
  
  Clicar num alerta voa até ao local.
- **Cenários sem meios:** cada incêndio abre vazio. "Repor exemplo" continua a funcionar.
- **Início manual:** a aplicação abre em pausa; a animação começa com espaço ou play.
- **Estilo do incêndio:** o fogo simulado deixa de ser feito de píxeis. Usa agora o estilo do fogo observado: linha âmbar na frente, âmbar suave nos últimos 30 min e brasa escura atrás.
- **Linhas brancas:** saem as linhas brancas e entra uma só linha verde, "Melhor caso · X ha". É o que arde se o drone detetar o fogo e o primeiro meio chegar a tempo.
- **Wet line:**
  - Cada meio terrestre colocado desenha uma faixa azul-clara atravessada à propagação. As medidas são: VFCI 300 × 10 m, VTTU 1200 × 15 m, brigada 120 × 2 m.
  - A faixa conta a partir da hora de chegada do meio. É exatamente o `decision.barriers` que vai para o ELMFIRE.
- **Rota dos meios:** passa a azul-escuro (#1e3a8a).
- **Incêndio até ao fim:**
  - As corridas vão até 24 h. A secção "Fim do incêndio" mostra, para Livre, A e B: "Extinto às HH:MM · N ha" ou "Não extinto em 24 h".
  - Nota: em Vieira e Cabeceiras nenhuma corrida se extingue em 24 h.
- **"Satélite" mais explícito:** passa a "Satélite deteta o fogo · HH:MM", e o termo T_sat sai do ecrã.
- **Raio de ignição:** foram removidos os anéis de 1, 2 e 5 km e o anel âmbar do marcador I.
- **Integrar ELMFIRE (como no ramo hindcast-registos):**
  - O ELMFIRE substitui o modelo rápido para Livre, A e B, através da API. O modelo rápido fica como pré-visualização imediata e para o ILS.
  - Se a API estiver em baixo, a aplicação usa o modelo rápido e avisa.
  - Os combustíveis portugueses e as projeções do ramo estão disponíveis na API, mas desligados, porque sem copas queimam de mais em Vieira.
- **Botões por meio:** um botão por meio (VFCI, VTTU, Brigada, HEBL, AVBP), que se arma e depois se clica no mapa. Saíram "+ colocar meio" e "clicar no mapa".

## Bugs

- **Luz central:** a luz segue o centro do ecrã em cada frame, o mesmo ponto da mira.
- **Visual do incêndio não volta ao início:** o relógio passa a ser um só, partilhado pela reprodução e pelo editor. A causa encontrada era o slider do editor sobrepor-se à reprodução. Falta confirmar no browser.
- **Hora no menu da esquerda:** arrastar o slider move o relógio do fogo, e a reprodução continua a partir daí.
- **Zoom-out ao remover uma unidade:** depois de recalcular, o plano atual é substituído no lugar e a câmara não se mexe.

## Estado e conhecidos

- O ramo `tests-na-demo` = `main` local com todos os pontos acima + o merge do `origin/main` do Bruno (ILS das linhas, `ils:check`, hindcast). O `ils:check` passa; a referência foi atualizada porque as wet lines mudaram o modelo rápido (ver `docs/ils.md` §5.1).
- **Bug conhecido, a ser corrigido:** com o novo incêndio da Penha, o Cesium para de renderizar ("normalized result is not a number") por pontos repetidos nos perímetros do `progression.geojson`. Correção a caminho neste ramo.
- Para a demo: Docker ligado, `api/setup.sh` (uma vez), `api/serve.sh` (porta 5181), `cd web && npm run dev`.
