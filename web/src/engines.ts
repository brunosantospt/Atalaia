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
}

/** What the web reads of the API's result: the arrival grid as the fast model keeps it, and where it came from. */
export interface EngineRun {
  arrival: Float32Array // minute the fire reaches each cell, row 0 north, Infinity where it never does
  engine: string // "ELMFIRE 2025.0717"
  runtimeS: number // of the engine, summed over the run's stretches; 0 when cached
  cached: boolean
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

/** Runs a scenario on the API. Throws with the API's reason when it cannot (down, not ready, scenario refused). */
export async function runScenario(request: ScenarioRequest, rows: number, cols: number): Promise<EngineRun> {
  const res = await fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })
  if (!res.ok) {
    const detail = await res.json().then((b: { detail?: unknown }) => b.detail, () => undefined)
    throw new Error(`HTTP ${res.status}${typeof detail === 'string' ? `: ${detail}` : ''}`)
  }
  const r = (await res.json()) as ApiResult
  // Both are row 0 along the north edge, a row after another: the API's rows flatten straight into the web's cells.
  if (r.grid.rows !== rows || r.grid.cols !== cols || r.arrival_min.length !== rows) throw new Error(`grade ${r.grid.rows}x${r.grid.cols}, a web tem ${rows}x${cols}`)
  const arrival = new Float32Array(rows * cols).fill(Infinity)
  r.arrival_min.forEach((row, i) => row.forEach((v, j) => v !== null && (arrival[i * cols + j] = v)))
  return { arrival, engine: `${engineName(r.engine)} ${r.version}`.trim(), runtimeS: r.cached ? 0 : r.runtime_s, cached: r.cached }
}
