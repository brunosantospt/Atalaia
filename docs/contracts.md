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
  "moisture": {"live_herb_pct": 60, "live_woody_pct": 90},
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
- **`moisture`:** humidades dos combustíveis em %, iguais em toda a grade.
  - **Mortas** (`dead_1h_pct`, `dead_10h_pct`, `dead_100h_pct`): por omissão seguem a meteo de cada momento (ver "O que a API junta ao cenário"), e no `scenario` do resultado vêm `null`. Se o cenário der as três, valem a corrida toda; dar só uma ou duas é um erro. Vão de mais de 0 a 60.
  - **Vivas** (`live_herb_pct`, `live_woody_pct`): 60/90 por omissão, um verão seco, durante toda a corrida. Vão de 30 a 300. Em seca o hindcast usa 30/70 (`hindcast/README.md`).
- **`decision.barriers`:** linhas onde nada arde a partir de um minuto, por exemplo um aceiro, uma linha molhada ou uma estrada defendida.
  - `path`: a linha em `[[lon, lat], ...]` (WGS84), com pelo menos 2 pontos.
  - `width_m`: a largura, de 0 a 1000 m. Com 0 (por omissão) contam só as células que a linha toca.
  - `from_min`: o minuto, desde o início da corrida, a partir do qual a faixa segura (0 por omissão). Tem de ser antes do fim.
  - As células da faixa passam a combustível 91 (não combustível). Conta cada célula que a faixa toca, não só as que têm o centro dentro dela. Assim a faixa fica unida pelas arestas, e o SimFire, que espalha o fogo para os 8 vizinhos, não passa por uma diagonal.

- **`fuels`, `spotting`, `seed`:** opcionais, só para o ELMFIRE (no pedido ao motor são `fuel_models`, `spotting` e `seed`, ver `engines/CONTRACT.md`).
  - `fuels`: `sb` (por omissão), Scott & Burgan do `fuel.json`, ou `pt`, os 18 modelos portugueses de Fernandes et al. (2009) nas classes da COS que têm um (`api/fuels.py`). As cicatrizes continuam não combustíveis.
  - `spotting`: as projeções do ELMFIRE (`false` por omissão), com a semente `seed` (1 por omissão).
  - Ficam desligados por omissão: com os combustíveis portugueses, sem copas, queimam de mais (Vieira às 22,5 h: 2800 ha com `pt`, 3576 ha com `pt`, vivas 30/70 e projeções, contra 1621 observados e 1798 por omissão). As copas que contam são as do LiDAR (ver abaixo).
- **`wind_shift`:** `true` por omissão. Com `false`, a corrida usa a meteo do incêndio sem a rotação sintética do vento (`weather_noshift.json`, o vento do IFS multiplicado como em `weather.json`), a previsão de antes do incidente. Um incêndio sem `windShift` no `fire.json` ignora o campo. Faz parte da chave da cache.
- **`canopy`, `weather_moisture`:** só ELMFIRE.
  - `canopy`: `true` troca as copas do LiDAR por copas típicas no eucaliptal e no pinhal e folhosas (`api/fuels.py`). É para os incêndios sem LiDAR, como o hipotético da Penha; por omissão `false`, e as copas do LiDAR valem onde o incêndio as tem.
  - `weather_moisture` (`dry`, `floor_pct`, `live_herb_pct`, `live_woody_pct`): a humidade morta de 1 h é a de equilíbrio de Simard menos `dry` pontos, mínimo `floor_pct`; a de 10 h e 100 h somam-lhe 1,5 e 3; as vivas são constantes. Só vale se `moisture` não vier, e substitui as mortas da meteo por omissão.

### O bloco `engine` do `fire.json`

Um incêndio pode trazer em `fire.json` um bloco `engine` com as definições da sua referência, que a API aplica, por cima dos valores por omissão, a todos os campos que o pedido não traz (`fuels`, `spotting`, `seed`, `canopy`, `weather_moisture`; um `moisture` explícito ganha). Exemplo, o incêndio hipotético da Penha:

```json
"engine": {"fuels": "pt", "spotting": true, "seed": 2, "canopy": "typical",
           "deadMoisture": {"simardDryPoints": 3.0, "floorPct": 2.0}, "liveHerbPct": 30.0, "liveWoodyPct": 70.0}
```

Sem o bloco (ou com outro motor que não o ELMFIRE) valem os valores por omissão acima: as mortas da meteo, as copas do LiDAR e as cicatrizes onde existem. A Penha não tem LiDAR nem cicatrizes, por isso o bloco dá-lhe as copas típicas. Os valores resolvidos fazem parte da chave da cache.

Campos que não estão aqui dão erro, para que um nome mal escrito não passe sem efeito.

### O que a API junta ao cenário

Tudo sai da pasta do incêndio, `web/public/fires/<id>/` (P1 e P4):
- **Grade e camadas:**
  - a grade de `grid.json`;
  - o combustível em Scott & Burgan, pela legenda de `fuel.json`;
  - as cicatrizes (`scars.geojson`): os perímetros dos incêndios apagados nos 40 dias antes. As células combustíveis com o centro dentro de uma passam a 91 (não combustível), porque o que lá havia já ardeu;
  - elevação, declive e exposição;
  - as copas do LiDAR da DGT: cobertura, altura, altura da base e densidade aparente (`canopy_*`, descritas no `canopy.json`). O SimFire não as usa.

  As cicatrizes e as copas vêm do `hindcast/` (`evidence.geojson` e `canopy.npz`), copiadas para o pacote pelo `scripts/build_scars_canopy.py`.
- **Meteo:** o vento a 10 m, a temperatura e a humidade do ar a 2 m de `weather.json`, que é horário. Entra de 30 em 30 minutos desde a hora do passo de partida, interpolado em linha reta, com a direção do vento a rodar pelo lado mais curto.
- **Humidades:** as vivas e, se o cenário as der, as mortas são as do cenário. Se não, as mortas saem da meteo de cada momento (`runs.dead_moistures`): a de 1 h é a humidade de equilíbrio de Simard (1968) para a temperatura e a humidade do ar, pelo menos 2 %; a de 10 h soma-lhe 1,5 e a de 100 h soma-lhe 3. Em Vieira do Minho a de 1 h vai de 4,7 a 10 % nas 22,5 h observadas.
- **Porquê estas:** humidades de hora a hora, copas e cicatrizes são o passo 3 do hindcast, o único que melhora os dois incêndios. O Sørensen do último passo sobe de 0,727 para 0,743 em Vieira do Minho e de 0,627 para 0,732 em Cabeceiras de Basto (`hindcast/README.md`, "Problemas em aberto" 4).
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
| `POST /api/run` | O resultado de um cenário, numa só resposta (pode demorar minutos) |
| `POST /api/jobs` | Valida o mesmo corpo e responde logo com `{id, state, cached}` |
| `GET /api/jobs/{id}` | O estado da tarefa: `state`, `elapsed_s`, e `stretch` (`"k/n"`) ou `error` |
| `GET /api/jobs/{id}/result` | O mesmo JSON de `POST /api/run`, quando a tarefa está `done` |

Um motor aparece na lista quando a sua pasta em `engines/` tem um `engine.json` (nome e método). A versão e a imagem Docker vêm do seu `env.sh`. O `state` é um de:
- `ready`: pronto a correr;
- `not_installed`: falta a imagem; corre `engines/<id>/setup.sh`;
- `no_docker`: o Docker não está a correr, e os motores correm em contentores.

`POST /api/run` dá estes erros, com a explicação em `detail`:
- **422** quando o cenário não é válido: um campo fora dos limites, um incêndio ou um passo que não existe, uma corrida que sai da meteo;
- **503** quando o motor não está pronto, com o que falta fazer;
- **502** quando o motor falhou, com as últimas linhas do que escreveu.

## Tarefas

Uma corrida com muitos troços pode passar de um minuto, e o navegador deixa cair um pedido aberto tanto tempo. A web usa por isso tarefas: nenhum pedido fica aberto.
- **`POST /api/jobs`** recebe o corpo de `POST /api/run`, com os mesmos erros 422, 503 e o resto. Se o resultado já está na cache, responde `state: "done"` e `cached: true`. Senão lança a corrida numa thread (3 em simultâneo) e responde `queued`. O `id` é a chave da cache, e um cenário igual que já está a correr devolve a mesma tarefa.
- **`GET /api/jobs/{id}`** dá `state` (`queued`, `running`, `done`, `error`), `elapsed_s`, `stretch` (`"k/n"`, o troço a correr) e `error` (a explicação, como o `detail` do 502). 404 se a API não conhece a tarefa e a cache também não tem o resultado.
- **`GET /api/jobs/{id}/result`** devolve o resultado da cache, como `POST /api/run`. 409 se a tarefa ainda corre, 502 se falhou.
- As tarefas vivem na memória: reiniciar a API esquece-as, mas os resultados ficam na cache. Quem fez a corrida pede-a de novo e recebe `done`.
- Uma API antiga responde 404 a `/api/jobs`: a web volta ao `POST /api/run`.

## Cache

Cada resultado fica em `data/cache/<key>.json`; a variável `ATALAIA_CACHE` muda a pasta.
- **A chave** é um hash de quatro coisas:
  - o cenário com as omissões preenchidas;
  - os ficheiros do incêndio que a corrida lê (`FILES` em `api/fires.py`, com as cicatrizes e as copas);
  - o código do motor, isto é, tudo na pasta dele menos `test.sh`, `setup.sh` e `vendor/`;
  - o código da API (`api/*.py`).

  Se qualquer uma mudar, a chave muda e o cenário corre de novo. Os ficheiros antigos ficam esquecidos e podem apagar-se.
- **Offline:** a cache é lida antes de se ver o estado do motor. Uma corrida feita uma vez volta sem o Docker, e é assim que a demo corre offline: correm-se antes os cenários dela.
- **Pedidos repetidos:** se o mesmo cenário chega duas vezes ao mesmo tempo, corre uma só vez; o segundo pedido espera e lê a cache.
- **Escrita:** cada resultado é escrito num ficheiro à parte e depois renomeado, por isso nunca fica meio escrito.
