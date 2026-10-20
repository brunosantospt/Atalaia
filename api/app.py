"""Atalaia's API (docs/contracts.md): the fires, the engines and their state, and scenario runs with a
cache in data/cache/, so a run done once comes back offline.

    api/serve.sh   (http://127.0.0.1:5181; the web dev server sends /api here)
"""

import threading
from collections import defaultdict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

import engines
import fires
import runs

app = FastAPI(title='Atalaia API')
app.add_middleware(GZipMiddleware, minimum_size=1024)  # arrival times compress about tenfold

# One run at a time per key: asking twice for the same scenario waits for the first and reads its cache.
LOCKS = defaultdict(threading.Lock)
NOT_READY = {
    'not_installed': '{name} não está instalado: corre engines/{id}/setup.sh',
    'no_docker': 'o Docker não está a correr, e o {name} corre num contentor',
}


@app.get('/api/fires')
def list_fires():
    found = []
    for entry in fires.index():
        fire = fires.Fire(entry['id'])
        found.append({
            'id': fire.id,
            'name': entry['name'],
            'start': entry['start'],
            'steps': [{k: s[k] for k in ('step', 'time', 'hours', 'areaHa')} for s in fire.steps],
            'ignitions': fire.meta['ignitions'],
        })
    return found


@app.get('/api/engines')
def list_engines():
    docker = engines.docker_running()
    return [engine.describe(docker) for engine in engines.all_engines().values()]


@app.post('/api/run')
def run(scenario: runs.Scenario):
    try:
        fire, scenario = runs.plan(scenario)
    except runs.ScenarioError as e:
        raise HTTPException(422, str(e)) from None
    engine = engines.all_engines().get(scenario.engine)
    if engine is None:
        raise HTTPException(422, f'engine: não há o motor {scenario.engine}')

    key = runs.cache_key(fire, scenario, engine)
    with LOCKS[key]:
        result = runs.read_cache(key)
        if result is not None:
            return JSONResponse({'key': key, 'cached': True, **result})
        state = engine.state()
        if state != 'ready':
            raise HTTPException(503, NOT_READY[state].format(name=engine.name, id=engine.id))
        try:
            result = runs.simulate(fire, scenario, engine)
        except engines.EngineError as e:
            raise HTTPException(502, str(e)) from None
        runs.write_cache(key, result)
    return JSONResponse({'key': key, 'cached': False, **result})
