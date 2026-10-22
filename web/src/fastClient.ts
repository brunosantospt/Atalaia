import type { Runs } from './editor'
import type { Scenario } from './scenario'
import type { Decision } from './suppression'
export interface FastRequest { scenario: Scenario; decisions: [Decision, Decision] }
export type FastReply = { type: 'progress'; task: string } | { type: 'done'; runs: Runs } | { type: 'error'; error: string }
/** Created for the initial empty forecast or the simulate button; terminates after one batch. */
export function runFast(request: FastRequest, progress: (task: string) => void): Promise<Runs> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./fast.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<FastReply>) => {
      if (data.type === 'progress') return progress(data.task)
      worker.terminate()
      if (data.type === 'error') reject(new Error(data.error))
      else resolve(data.runs)
    }
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || 'O modelo rápido falhou')) }
    worker.postMessage(request)
  })
}
