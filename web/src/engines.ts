// The fire spread engines the twin can run (engines/ and engines/CONTRACT.md). Kept by hand until
// the API lists them with their state (GET /engines, P5).

export type EngineId = 'elmfire' | 'simfire'

export interface Engine {
  id: EngineId
  name: string
  version: string
  method: string
  ready: boolean // its engines/<id>/test.sh passes
}

export const ENGINES: Engine[] = [
  { id: 'elmfire', name: 'ELMFIRE', version: '2025.0717', method: 'Level set · Rothermel, copas e projeções', ready: true },
  { id: 'simfire', name: 'SimFire', version: '2.0.1', method: 'Autómato celular · Rothermel, 8 vizinhos', ready: false },
]

export const DEFAULT_ENGINE: EngineId = 'elmfire'
