import { simulateFast } from './demoModel'
import type { FastRequest, FastReply } from './fastClient'
import type { Run } from './scenario'
const scope = self as unknown as {
  onmessage: (e: MessageEvent<FastRequest>) => void
  postMessage(reply: FastReply, transfer?: Transferable[]): void
}
scope.onmessage = ({ data: { scenario, decisions } }) => {
  try {
    const free = simulateFast(scenario, null)
    scope.postMessage({ type: 'progress', task: 'Livre' })
    scenario.fireArrival = free.arrival
    const run = (i: 0 | 1): Run => {
      const d = decisions[i]
      const result = d.assignments.length ? simulateFast(scenario, d) : { ...free, decision: d, runtimeMs: 0 }
      scope.postMessage({ type: 'progress', task: d.id })
      return result
    }
    const runs = { free, A: run(0), B: run(1) }
    scope.postMessage({ type: 'done', runs }, [...new Set(Object.values(runs).map(r => r.arrival.buffer as ArrayBuffer))])
  } catch (e) { scope.postMessage({ type: 'error', error: e instanceof Error ? e.message : String(e) }) }
}
