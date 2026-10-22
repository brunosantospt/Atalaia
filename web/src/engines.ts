// The fire spread engines the twin can run (engines/ and engines/CONTRACT.md), as the API lists them
// (GET /api/engines, docs/contracts.md): what each one is and whether it can run on this machine.

import type { Barrier } from './wetLine'

export type EngineState = 'ready' | 'not_installed' | 'no_docker'

export interface Engine {
  id: string
  name: string
  version: string
  method: string
  state: EngineState
}

export const DEFAULT_ENGINE = 'elmfire' // the API's default too

/** The engines and their state, or null when the API is not running (api/serve.sh). */
export async function fetchEngines(): Promise<Engine[] | null> {
  try {
    const res = await fetch('/api/engines')
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/** A scenario of POST /api/run (docs/contracts.md), as the web sends it. */
export interface ScenarioRequest {
  fire: string
  engine: string
  duration_min: number
  decision: { barriers: Barrier[] }
  wind_shift?: boolean // the fire's synthetic wind shift: false plans on the forecast without it; left out for fires with none
}

/** What the web reads of the API's result: the arrival grid in north-to-south cell order, and where it came from. */
export interface EngineRun {
  arrival: Float32Array // minute the fire reaches each cell, row 0 north, Infinity where it never does
  engine: string // "ELMFIRE 2025.0717"
  runtimeS: number // of the engine, summed over the run's stretches; 0 when cached
  cached: boolean
  shiftIgnored?: boolean // the API is an old one that does not take wind_shift: it ran with its own default
}

interface ApiResult {
  engine: string
  version: string
  cached: boolean
  runtime_s: number
  grid: { cols: number; rows: number }
  arrival_min: (number | null)[][]
}

const NAMES: Record<string, string> = { elmfire: 'ELMFIRE', simfire: 'SimFire' }
export const engineName = (id: string) => NAMES[id] ?? id

let windShiftTaken = true // false once an old API has refused the field
let jobsTaken = true // false once the API has answered 404 to /api/jobs (an old one): single POST /api/run

const POLL_MS = 1500
const POLL_RETRIES = 5 // failed polls in a row before giving up
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
const post = (url: string, r: ScenarioRequest) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) })
const failure = async (res: Response) => {
  const detail = await res.json().then((b: { detail?: unknown }) => b.detail, () => undefined)
  return new Error(`HTTP ${res.status}${typeof detail === 'string' ? `: ${detail}` : ''}`)
}

interface JobState {
  state: 'queued' | 'running' | 'done' | 'error'
  stretch?: string
  error?: string
}

class Final extends Error {} // the API's own answer: no use polling again

/** A GET that is tried again when the connection or the proxy drops it (POLL_RETRIES in a row). */
async function get(url: string): Promise<Response> {
  for (let failed = 1; ; failed++) {
    try {
      const res = await fetch(url)
      if (res.status === 404 || res.status === 409 || res.status < 500 || res.status === 502) return res
      throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      if (failed >= POLL_RETRIES) throw e
      await sleep(POLL_MS)
    }
  }
}

/** Runs it as a job (POST /api/jobs, polled so no request stays open for minutes). The response to read: the
 *  result's, or the refusal's; null when the API has no jobs (an old one). */
async function viaJob(r: ScenarioRequest, onProgress?: (stretch?: string) => void): Promise<Response | null> {
  for (let restarts = 0; restarts < 3; restarts++) {
    const start = await post('/api/jobs', r)
    if (start.status === 404 || start.status === 405) return null
    if (!start.ok) return start
    const { id, state: first } = (await start.json()) as { id: string; state: string }
    let state = first
    while (state !== 'done') {
      await sleep(POLL_MS)
      const res = await get(`/api/jobs/${id}`)
      if (res.status === 404) break // the API restarted: ask again (its cache may have it)
      if (!res.ok) throw await failure(res)
      const j = (await res.json()) as JobState
      if (j.state === 'error') throw new Final(`HTTP 502: ${j.error ?? 'falhou'}`)
      state = j.state
      onProgress?.(j.stretch)
    }
    if (state !== 'done') continue
    const res = await get(`/api/jobs/${id}/result`)
    if (res.status !== 404) return res
  }
  throw new Error('a tarefa perdeu-se')
}

/** Runs a scenario on the API. Throws with the API's reason when it cannot (down, not ready, scenario refused). */
export async function runScenario(request: ScenarioRequest, rows: number, cols: number, onProgress?: (stretch?: string) => void): Promise<EngineRun> {
  const { wind_shift: shift, ...plain } = request
  let ignored = shift !== undefined && !windShiftTaken
  const attempt = async (r: ScenarioRequest): Promise<Response> => {
    if (jobsTaken) {
      const out = await viaJob(r, onProgress)
      if (out) return out
      jobsTaken = false
    }
    return post('/api/run', r)
  }
  let res = await attempt(ignored ? plain : request)
  // An old API (extra fields forbidden) answers 422: the same scenario without the field, and the screen says so.
  if (res.status === 422 && shift !== undefined && !ignored) {
    const retry = await attempt(plain)
    if (retry.ok) [res, ignored, windShiftTaken] = [retry, true, false]
  }
  if (!res.ok) throw await failure(res)
  const r = (await res.json()) as ApiResult
  // Both are row 0 along the north edge, a row after another: the API's rows flatten straight into the web's cells.
  if (r.grid.rows !== rows || r.grid.cols !== cols || r.arrival_min.length !== rows) throw new Error(`grade ${r.grid.rows}x${r.grid.cols}, a web tem ${rows}x${cols}`)
  const arrival = new Float32Array(rows * cols).fill(Infinity)
  r.arrival_min.forEach((row, i) => row.forEach((v, j) => v !== null && (arrival[i * cols + j] = v)))
  return { arrival, engine: `${engineName(r.engine)} ${r.version}`.trim(), runtimeS: r.cached ? 0 : r.runtime_s, cached: r.cached, shiftIgnored: ignored || undefined }
}
