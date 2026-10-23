# Guião · Pitch Atalaia (4 min)

Só o texto a dizer, para ler e ensaiar. Timings, cliques, direções de palco e
sourcing ficam em `index.html` (notas do orador) e `FONTES.md`.

---

## 1 · Título

Somos a Atalaia.

## 2 · Gancho

No ano passado arderam em Portugal mais de 270 mil hectares. Mais de 8 250
ocorrências.

11 concelhos de Guimarães.

E mais de 85 milhões de euros perdidos em floresta, agricultura e natureza,
sem contar casas, estradas nem o combate.

Mas o número que importa não é este.

## 3 · Problema

O problema decide-se nos primeiros minutos. Nesses minutos, quem decide
precisa de uma visão comum e de antecipar o efeito de cada decisão.

E se pudéssemos ver o que vai arder antes de decidir?

## 4 · O que já existe, e porque falha

Já existem ferramentas. Mas nenhuma resolve isto.

FARSITE e FlamMap: lentos demais, erram no vento e no combustível. fogos.pt:
não testa decisões. IPMA e EFFIS: não simulam o incêndio.
incendiosportugal.pt: não propõe ataques otimizados.

Por isso, o desafio da Universidade do Minho é claro.

## 5 · O desafio da UMinho

O desafio da Universidade do Minho: como simular alternativas de atuação, e
melhorar a coordenação nos primeiros minutos?

Por isso: rápida. Precisa. E prática.

A nossa resposta chama-se…

## 5b · Logótipo

…Atalaia.

## 6 · A proposta

Para quem decide o ataque, a Atalaia monitoriza o fogo em tempo real, aloca
os meios, prevê o comportamento do incêndio e comunica o comando de ação.

Nós trabalhamos com dados precisos, com os meios que estão disponíveis ao
momento em cada quartel, e tudo isto num só mapa.

Dados reais. Meios reais. Um só mapa. Que estradas cortar. Quanto tempo até
ao fogo. Que casas estão em risco. Para todos os que combatem.

Vamos ver ao vivo.

## 7 · Demo ao vivo

*(guião da demo ainda por fechar)*

E podemos confiar nisto? Testámos contra um incêndio real.

## 8 · Validação

Primeiro reconstituímos um incêndio real: Vieira do Minho, 2016, aqui no
distrito de Braga. Motor ELMFIRE.

O modelo base está a 0,76 de sobreposição com o real. Só com dados
públicos — combustíveis portugueses, LiDAR, cicatrizes, projeções — sobe
para 0,83. Com as linhas de ataque inferidas, 0,89.

E esta precisão não caiu do céu. Deixem-me mostrar o que está por baixo.

## 8b · A tecnologia

O motor é o ELMFIRE, do Fire Lab da UC Berkeley, mas afinado para Portugal:
as copas e os declives vêm do LiDAR da DGT, com grande precisão.

Construímos também um motor de vento próprio, a combinar o CERRA com o
relevo, para captar o vento local que os dados abertos não apanham.

A otimização da estratégia usa a meta-heurística premiada de um dos nossos
orientadores, Filipe Alvelos.

E um tradutor próprio passa cada decisão a inputs que o motor de propagação
entende.

No fundo: integrámos e calibrámos vários modelos, cada um a fazer o que faz
melhor.

E isto não acaba hoje.

## 9 · A seguir

A seguir: uma ferramenta de testes para potenciais cenários futuros; IA a
afinar a própria estratégia; e drones para detetar mais cedo, não só
defender melhor.

Ver sempre mais cedo. Decidir sempre melhor.

## 10 · Fecho + obrigado

Em 2025 arderam 11 Guimarães. Com a Atalaia, quem decide vê o que vai
arder, para cada decisão, antes de enviar os meios.

Obrigado.

## 11 · Créditos

*(fora do tempo, não se lê em voz alta)*
