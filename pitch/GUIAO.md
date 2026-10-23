# Guião · Pitch Atalaia (4 min)

Texto para ensaiar, tirado das notas do orador de `index.html`. Fala corrida, sem
sourcing nem ressalvas (isso fica em `FONTES.md`, para o Q&A).

⚠️ **Tempo:** a soma dos slides já passa dos 4:00 (263 s = 4:23). O slide 4 foi
dividido em dois (ferramentas que falham + desafio da UMinho) e há um slide de
tecnologia (8b) sem cortar nada a jusante. Cronometrar a fala real antes do dia e,
se for preciso, encurtar a demo (está a 112 s) ou outro slide.

---

## 1 · Título — 0:00–0:05 — Narrador

*(silêncio enquanto o slide aparece)*

> "Somos a Atalaia."

*(passar logo para o número)*

---

## 2 · Gancho — 0:05–0:25 — Narrador

*(os dois números sobem juntos ao entrar no slide, ~1 s — deixar acabar antes de falar)*

> "No ano passado arderam em Portugal mais de 270 mil hectares. Mais de 8 250
> ocorrências." *(pausa)*

**[clique]**

> "11 concelhos de Guimarães."

**[clique]**

> "E mais de 85 milhões de euros perdidos em floresta, agricultura e natureza, sem
> contar casas, estradas nem o combate."

*Passagem: "Mas o número que importa não é este."*

---

## 3 · Problema — 0:25–0:45 — Narrador

> "O problema decide-se nos primeiros minutos."

**[clique]**

> "Nesses minutos, quem decide precisa de uma visão comum e de antecipar o efeito
> de cada decisão."

*Passagem: "E se pudéssemos ver o que vai arder antes de decidir?"*

---

## 4 · O que já existe, e porque falha — 0:45–1:00 — Narrador

> "Já existem ferramentas. Mas nenhuma resolve isto."

**[clique]** *(revela a lista)*

> "FARSITE e FlamMap: lentos demais, erram no vento e no combustível. fogos.pt:
> não testa decisões. IPMA e EFFIS: não simulam o incêndio. incendiosportugal.pt:
> não propõe ataques otimizados."

*Passagem: "Por isso, o desafio da Universidade do Minho é claro."*

---

## 5 · O desafio da UMinho — 1:00–1:10 — Narrador

> "O desafio da Universidade do Minho: como simular alternativas de atuação,
> e melhorar a coordenação nos primeiros minutos?"

**[clique]** *(mostrar as três pílulas: Rápida, Precisa, Prática)*

> "Por isso: rápida, precisa, prática."

*Passagem: "A nossa resposta chama-se…" (logótipo)*

---

## 5b · Logótipo — 1:10–1:13

*(o logótipo cresce e brilha; o drone verifica a chama no «i», a chama apaga-se com
fumo, surge o ponto branco do «i», o drone regressa à torre; deixar a sequência
terminar, ~3 s, antes de avançar)*

> "…Atalaia."

---

## 6 · A proposta — 1:13–1:31 — Condutor da demo

**[clique]**

> "Para quem decide o ataque, a Atalaia monitoriza o fogo em tempo real, aloca os
> meios, prevê o comportamento do incêndio e comunica o comando de ação."

**[clique]**

> "Dados reais. Meios reais. Um só mapa."
> "Que estradas cortar. Quanto tempo até ao fogo. Que casas estão em risco. Para
> todos os que combatem."

*Passagem: "Vamos ver ao vivo."*

---

## 7 · Demo ao vivo — 1:31–3:23 (~112 s) — Condutor da demo / Técnico em espera

*(a demo corre numa janela própria do browser, não dentro dos slides; Alt+Tab para a
app, Alt+Tab de volta no fim e seta para a direita)*

**PLACEHOLDER — guião da demo ainda por fechar.** Falta decidir, a partir da build
final: o incêndio e a hora de partida, que meios se colocam e onde, os números do
efeito (ha, aldeias/casas, estradas cortadas), e se ficam as vistas por papel e o
resumo ao comandante.

*Plano B: vídeo gravado da app em `media/demo.mp4`. Qualquer pausa > 5 s, o colega de
apoio arranca o vídeo no mesmo ponto e o condutor continua a falar.*

*Passagem: "E podemos confiar nisto? Testámos contra um incêndio real."*

---

## 8 · Validação — 3:23–3:43 — Técnico

> "Primeiro reconstituímos um incêndio real: Vieira do Minho, 2016, aqui no distrito de
> Braga. Motor ELMFIRE.
> O modelo base está a 0,76 de sobreposição com o real. Só com dados públicos —
> combustíveis portugueses, LiDAR, cicatrizes, projeções — sobe para 0,83. Com as
> linhas de ataque inferidas, 0,89."

*Passagem: "E esta precisão não caiu do céu. Deixem-me mostrar o que está por baixo."*

---

## 8b · A tecnologia — 3:43–4:03 — Técnico

**[clique]**

> "O motor é o ELMFIRE, do Fire Lab da UC Berkeley, mas afinado para Portugal: as
> copas e os declives vêm do LiDAR da DGT, com grande precisão."

**[clique]**

> "Construímos também um motor de vento próprio, a combinar o CERRA com o relevo, para
> captar o vento local que os dados abertos não apanham."

**[clique]**

> "A otimização da estratégia usa a meta-heurística premiada de um dos nossos
> orientadores, Filipe Alvelos."

**[clique]**

> "E um tradutor próprio passa cada decisão a inputs que o motor de propagação
> entende."

**[clique]**

> "No fundo: integrámos e calibrámos vários modelos, cada um a fazer o que faz
> melhor."

*Passagem: "E isto não acaba hoje."*

---

## 9 · A seguir + fecho — 4:03–4:23 — Continuidade → Narrador

**[clique]** *(o roadmap desenha-se sozinho, um clique só)*

> "A seguir: drones para detetar mais cedo, não só defender melhor; treino com
> incêndios passados, com um modelo de treino próprio para os bombeiros; e, mais à
> frente, IA a afinar a própria estratégia."

**[clique]** — Narrador:

> "Em 2025 arderam 11 Guimarães." *(pausa)* "Com a Atalaia, quem decide vê o que vai
> arder, para cada decisão, antes de enviar os meios. Obrigado."

---

## 10 · Créditos (fora do tempo)

Fica no fim, só para o júri e para o PDF da submissão — não se lê em voz alta.

---

## Notas de palco

- **Quem fala cada slide:** Narrador (1, 2, 3, 4, 5, 9-fecho) · Condutor da demo
  (6, 7) · Técnico (8, 8b) · Continuidade (9-abertura).
- **Teclas da demo:** espaço, setas, R, H, D, L, S — as mesmas do reveal.js, por isso a
  app corre numa janela à parte, nunca dentro dos slides.
- **Vista do orador:** tecla **S** no reveal, mostra este texto mais as notas técnicas e
  fontes por slide, e o cronómetro de 4 min.
