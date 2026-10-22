// The ILS of optimize.ts off the main thread: a request in, its progress and decision B out.
// The editor ends it with terminate() when A or the fire changes under it.

import type { Scenario } from './fastModel'
import { optimize, type Ground, type Progress, type Result } from './optimize'
import type { Decision } from './suppression'

export interface IlsRequest {
  scenario: Scenario
  ground: Ground
  a: Decision
  replanMin?: number
  budgetMs: number
  seed: number
}

export type IlsReply = { type: 'progress'; progress: Progress } | { type: 'done'; result: Result } | { type: 'error'; message: string }

const post = (reply: IlsReply) => self.postMessage(reply)

self.onmessage = ({ data }: MessageEvent<IlsRequest>) => {
  try {
    const { scenario, ground, a, budgetMs, seed, replanMin } = data
    const result = optimize(scenario, ground, a, { budgetMs, seed, replanMin, onProgress: (progress) => post({ type: 'progress', progress }) })
    post({ type: 'done', result })
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
