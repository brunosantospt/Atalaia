// The ILS of optimize.ts off the main thread: a request in, its progress and decision B out.
// The editor ends it with terminate() when A or the fire changes under it.

import type { Scenario } from './fastModel'
import { optimize, type Ground, type Progress, type Result } from './optimize'
import { optimizeRelocationsParallel, type SimulateMany } from './optimizeRelocations'
import type { SimRequest } from './sim.worker'
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

// Plans of the demo's replanning run on a pool of helpers, one per spare core (up to 8).
const POOL = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))
let helpers: Worker[] = []
let initFor: object | undefined
let next = 0
const waiting = new Map<number, (arrival: Float32Array) => void>()
const simulateMany: SimulateMany = (scenario, plans) => {
  if (!helpers.length) helpers = Array.from({ length: POOL }, () => {
    const w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = ({ data }: MessageEvent<{ id: number; arrival: Float32Array }>) => { waiting.get(data.id)?.(data.arrival); waiting.delete(data.id) }
    return w
  })
  if (initFor !== scenario) { initFor = scenario; for (const w of helpers) w.postMessage({ type: 'init', scenario } satisfies SimRequest) }
  return Promise.all(plans.map((plan, k) => new Promise<Float32Array>((resolve) => {
    const id = next++
    waiting.set(id, resolve)
    helpers[k % POOL].postMessage({ type: 'run', id, plan } satisfies SimRequest)
  })))
}

self.onmessage = async ({ data }: MessageEvent<IlsRequest>) => {
  try {
    const { scenario, ground, a, budgetMs, seed, replanMin } = data
    const onProgress = (progress: Progress) => post({ type: 'progress', progress })
    const result = scenario.demo && replanMin !== undefined
      ? await optimizeRelocationsParallel(scenario, ground, a, { budgetMs, seed, replanMin, onProgress }, simulateMany)
      : optimize(scenario, ground, a, { budgetMs, seed, replanMin, onProgress })
    post({ type: 'done', result })
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
