# Contratos

Há dois níveis:
- **O cenário** é o que a web pede à API: um incêndio, o passo observado de onde partir, quanto tempo correr e uma decisão. Está descrito aqui.
- **O pedido do motor** é uma grade com camadas, meteo e ignições, e está em [`engines/CONTRACT.md`](../engines/CONTRACT.md). A API traduz cada cenário num ou mais destes pedidos e junta os resultados.

A API está em `api/`, em FastAPI. `api/setup.sh` cria o venv (uma vez), `api/serve.sh` corre-a em `http://127.0.0.1:5181` (a porta muda com `PORT`) e `api/test.sh` é o teste do P5.

## Cenário

`POST /api/run` com:

```json
{
  "fire": "VieiradoMinho_10082016",
  "engine": "elmfire",
  "start_step": 0,
  "duration_min": 300,
  "moisture": {"dead_1h_pct": 6, "dead_10h_pct": 8, "dead_100h_pct": 10,
               "live_herb_pct": 60, "live_woody_pct": 90},
  "decision": {
    "barriers": [
      {"path": [[-8.121, 41.551], [-8.105, 41.548]], "width_m": 60, "from_min": 60}
    ]
  }
}
```

- **`fire`:** o `id` do incêndio em `web/public/fires/index.json`. É o único campo obrigatório.
- **`engine`:** `elmfire` (por omissão) ou `simfire`, como vêm em `GET /api/engines`.
- **`start_step`:** o passo observado de onde a simulação parte (0 por omissão). O fogo começa no perímetro desse passo: ardem logo as células com o centro lá dentro.
- **`duration_min`:** quanto tempo correr, até 2880 (48 h).
  - Por omissão, até ao passo observado seguinte, para comparar com o perímetro desse passo (P7). A partir do último passo não há seguinte, e o campo é obrigatório.
  - A corrida tem de caber na meteo do incêndio (`weather.json` cobre uns dias antes e depois).
- **`moisture`:** humidades dos combustíveis em %, iguais em toda a grade e durante toda a corrida.
  - São provisórias: 6/8/10 nas mortas (1 h, 10 h, 100 h) e 60/90 nas vivas (herbáceas, lenhosas), um verão seco. Mais tarde passam a vir da meteo de cada hora.
  - As mortas vão de mais de 0 a 60, as vivas de 30 a 300.
- **`decision.barriers`:** linhas onde nada arde a partir de um minuto, por exemplo um aceiro, uma linha molhada ou uma estrada defendida.
  - `path`: a linha em `[[lon, lat], ...]` (WGS84), com pelo menos 2 pontos.
  - `width_m`: a largura, de 0 a 1000 m. Com 0 (por omissão) contam só as células que a linha toca.
  - `from_min`: o minuto, desde o início da corrida, a partir do qual a faixa segura (0 por omissão). Tem de ser antes do fim.
  - As células da faixa passam a combustível 91 (não combustível). Conta cada célula que a faixa toca, não só as que têm o centro dentro dela. Assim a faixa fica unida pelas arestas, e o SimFire, que espalha o fogo para os 8 vizinhos, não passa por uma diagonal.

Campos que não estão aqui dão erro, para que um nome mal escrito não passe sem efeito.

### O que a API junta ao cenário

Tudo sai da pasta do incêndio, `web/public/fires/<id>/` (P1 e P4):
- **Grade e camadas:** a grade de `grid.json`; o combustível em Scott & Burgan, pela legenda de `fuel.json`; elevação, declive e exposição.
- **Meteo:** o vento a 10 m de `weather.json`, que é horário. Entra de 30 em 30 minutos desde a hora do passo de partida, interpolado em linha reta, com a direção a rodar pelo lado mais curto. As humidades são as do cenário.
- **Focos:** os focos do `fire.json` que aparecem depois do início e antes do fim entram como ignições no minuto deles (em Cabeceiras de Basto, o segundo foco às 13:30). Os que já existiam no início estão dentro do perímetro de partida.
- **Faixas com `from_min` depois de 0:** a corrida parte-se nesse minuto.
  - Cada troço é um pedido ao motor que parte de tudo o que ardeu até aí (`burned`), com as faixas que já seguram no combustível.
  - Os tempos de chegada de cada troço somam o minuto em que ele começa, por isso o resultado conta sempre desde o início da corrida.

## Resultado

```json
{
  "key": "8c0f3b1d6a2e4f5c9b7a1d3e5f7a9c1b",
  "cached": false,
  "scenario": {"fire": "VieiradoMinho_10082016", "engine": "elmfire", "start_step": 0, "duration_min": 300.0, "...": "..."},
  "engine": "elmfire",
  "version": "2025.0717",
  "start": "2016-08-10T10:00",
  "end": "2016-08-10T15:00",
  "grid": {"cols": 499, "rows": 334, "cellsize": 30, "xmin": -9150, "ymin": 203790, "srs": "EPSG:3763"},
  "arrival_min": [[null, null, 212.4, ...], ...],
  "burned_ha": 154.8,
  "steps": [
    {"t_min": 0, "time": "2016-08-10T10:00", "burned_ha": 6.39},
    {"t_min": 60, "time": "2016-08-10T11:00", "burned_ha": 41.58},
    "..."
  ],
  "runtime_s": 1.67
}
```

- **`key`:** a chave da cache. **`cached`:** se o resultado veio da cache.
- **`scenario`:** o cenário com todas as omissões preenchidas, incluindo a `duration_min`. É isto que a chave cobre.
- **`start`** e **`end`:** início e fim da corrida, na hora local, como no `fire.json`.
- **`grid`:** a grade do incêndio, com a linha 0 a norte, como no contrato dos motores.
- **`arrival_min`:** o minuto, desde `start`, em que o fogo chega a cada célula. Vale 0 no perímetro de partida e `null` onde o fogo não chegou até ao fim.
- **`burned_ha`:** a área ardida no fim, incluindo o perímetro de partida.
- **`steps`:** a área ardida no início, a cada hora e no fim, para a linha do tempo.
- **`runtime_s`:** o tempo dos adapters e do motor, somado em todos os troços, sem o arranque dos contentores.

## Endpoints

| Rota | Devolve |
|---|---|
| `GET /api/fires` | Os incêndios: `id`, `name`, `start`, os passos observados (`step`, `time`, `hours`, `areaHa`) e os focos (`ignitions`) |
| `GET /api/engines` | Os motores: `id`, `name`, `version`, `method` e `state` |
| `POST /api/run` | O resultado de um cenário |

Um motor aparece na lista quando a sua pasta em `engines/` tem um `engine.json` (nome e método). A versão e a imagem Docker vêm do seu `env.sh`. O `state` é um de:
- `ready`: pronto a correr;
- `not_installed`: falta a imagem; corre `engines/<id>/setup.sh`;
- `no_docker`: o Docker não está a correr, e os motores correm em contentores.

`POST /api/run` dá estes erros, com a explicação em `detail`:
- **422** quando o cenário não é válido: um campo fora dos limites, um incêndio ou um passo que não existe, uma corrida que sai da meteo;
- **503** quando o motor não está pronto, com o que falta fazer;
- **502** quando o motor falhou, com as últimas linhas do que escreveu.

## Cache

Cada resultado fica em `data/cache/<key>.json`; a variável `ATALAIA_CACHE` muda a pasta.
- **A chave** é um hash de quatro coisas:
  - o cenário com as omissões preenchidas;
  - os ficheiros do incêndio que a corrida lê;
  - o código do motor, isto é, tudo na pasta dele menos `test.sh`, `setup.sh` e `vendor/`;
  - o código da API (`api/*.py`).

  Se qualquer uma mudar, a chave muda e o cenário corre de novo. Os ficheiros antigos ficam esquecidos e podem apagar-se.
- **Offline:** a cache é lida antes de se ver o estado do motor. Uma corrida feita uma vez volta sem o Docker, e é assim que a demo corre offline: correm-se antes os cenários dela.
- **Pedidos repetidos:** se o mesmo cenário chega duas vezes ao mesmo tempo, corre uma só vez; o segundo pedido espera e lê a cache.
- **Escrita:** cada resultado é escrito num ficheiro à parte e depois renomeado, por isso nunca fica meio escrito.
