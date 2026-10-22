"""Atalaia's API (docs/contracts.md): the fires, the engines and their state, and scenario runs with a
cache in data/cache/, so a run done once comes back offline.

    api/serve.sh   (http://127.0.0.1:5181; the web dev server sends /api here)
"""

import re
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

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
# A 900×900 ELMFIRE run already loads hundreds of MB of weather rasters. Serialize engines
# across synchronous requests and background jobs so an A/B comparison cannot exhaust RAM.
ENGINE_SLOT = threading.Semaphore(1)
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
        check_ready(engine)
        try:
            with ENGINE_SLOT:
                result = runs.simulate(fire, scenario, engine)
        except engines.EngineError as e:
            raise HTTPException(502, str(e)) from None
        runs.write_cache(key, result)
    return JSONResponse({'key': key, 'cached': False, **result})


def check_ready(engine):
    state = engine.state()
    if state != 'ready':
        raise HTTPException(503, NOT_READY[state].format(name=engine.name, id=engine.id))


# Jobs: the same run in a background thread, polled, so no request is held open for the minutes a run can take.
# They live in memory; the result is the cache's, and a job's id is its cache key.
POOL = ThreadPoolExecutor(max_workers=3, thread_name_prefix='job')
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
KEY = re.compile(r'^[0-9a-f]{8,64}$')


def work(key, fire, scenario, engine):
    job = JOBS[key]
    try:
        with LOCKS[key]:
            if runs.read_cache(key) is None:
                with ENGINE_SLOT:
                    job['state'], job['t0'] = 'running', time.monotonic()
                    result = runs.simulate(fire, scenario, engine, progress=lambda k, n: job.update(stretch=f'{k}/{n}'))
                runs.write_cache(key, result)
        job['state'] = 'done'
    except engines.EngineError as e:
        job.update(state='error', error=str(e))
    except Exception as e:  # a failed job must still answer its polls
        job.update(state='error', error=f'{type(e).__name__}: {e}')
    job['end'] = time.monotonic()


def describe(job):
    elapsed = (job.get('end') or time.monotonic()) - job['t0']
    out = {'id': job['id'], 'state': job['state'], 'elapsed_s': round(elapsed, 1)}
    for k in ('stretch', 'error'):
        if k in job:
            out[k] = job[k]
    return out


@app.post('/api/jobs')
def start_job(scenario: runs.Scenario):
    try:
        fire, scenario = runs.plan(scenario)
    except runs.ScenarioError as e:
        raise HTTPException(422, str(e)) from None
    engine = engines.all_engines().get(scenario.engine)
    if engine is None:
        raise HTTPException(422, f'engine: não há o motor {scenario.engine}')
    key = runs.cache_key(fire, scenario, engine)
    if runs.read_cache(key) is not None:
        return {'id': key, 'state': 'done', 'cached': True}
    with JOBS_LOCK:
        job = JOBS.get(key)
        if job is None or job['state'] in ('done', 'error'):  # a failed (or cache-lost) job is tried again
            check_ready(engine)
            job = JOBS[key] = {'id': key, 'state': 'queued', 't0': time.monotonic()}
            POOL.submit(work, key, fire, scenario, engine)
    return {'id': key, 'state': job['state'], 'cached': False}


@app.get('/api/jobs/{job_id}')
def job_state(job_id: str):
    job = JOBS.get(job_id)
    if job is None:
        if KEY.match(job_id) and runs.read_cache(job_id) is not None:  # done before this API started
            return {'id': job_id, 'state': 'done', 'elapsed_s': 0}
        raise HTTPException(404, 'não há essa tarefa')
    return describe(job)


@app.get('/api/jobs/{job_id}/result')
def job_result(job_id: str):
    job = JOBS.get(job_id)
    if job is not None and job['state'] in ('queued', 'running'):
        raise HTTPException(409, 'a tarefa ainda não acabou')
    if job is not None and job['state'] == 'error':
        raise HTTPException(502, job['error'])
    result = runs.read_cache(job_id) if KEY.match(job_id) else None
    if result is None:
        raise HTTPException(404, 'não há essa tarefa')
    return JSONResponse({'key': job_id, 'cached': job is None, **result})
