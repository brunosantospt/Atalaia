// The fire spread engines the twin can run (engines/ and engines/CONTRACT.md), as the API lists them
// (GET /api/engines, docs/contracts.md): what each one is and whether it can run on this machine.

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
