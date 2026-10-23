// One of the ILS's helpers (optimize.worker.ts): the scenario once, then plans in, their arrival fields out.
import { simulateFast } from './demoModel'
import type { Scenario } from './scenario'
import type { Decision } from './suppression'

export type SimRequest = { type: 'init'; scenario: Scenario } | { type: 'run'; id: number; plan: Decision }
let scenario: Scenario | undefined

self.onmessage = ({ data }: MessageEvent<SimRequest>) => {
  if (data.type === 'init') { scenario = data.scenario; return }
  const arrival = simulateFast(scenario!, data.plan).arrival.slice() // a copy: safe to hand over
  self.postMessage({ id: data.id, arrival }, { transfer: [arrival.buffer] })
}
