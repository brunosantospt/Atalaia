// Shared spread-model inputs/outputs. Demo runs use fixed coverage; engine runs retain their original geometry.
import type { Station, Weather } from './data'
import type { LonLat } from './geo'
import { cellHa, type Grid } from './grid'
import type { Decision, Suppression } from './suppression'
import { demoLines } from './demoLines'
import { barriers, type Barrier } from './wetLine'

export interface Run {
  decision: Decision | null
  arrival: Float32Array // minute the fire reaches each cell, Infinity if never within the duration
  durationMin: number
  runtimeMs: number
  engine?: string // ELMFIRE version, or reference perimeters
}

export interface Scenario {
  demo?: boolean // fixed coverage strips for the button-run demo model
  grid: Grid
  windShiftMin?: number // explicit demo incident; new wind applies at this minute
  forecastWeather?: Weather // forecast before the synthetic wind incident
  weather: Weather
  startIndex: number // entry of weather.time at the ignition
  ignition: LonLat
  stations: Station[]
  suppression: Suppression
  durationMin: number
  dispatchMin?: number // T+ when the fire is detected and the initial call can be made
  fireArrival?: Float32Array // free ELMFIRE forecast for approach checks
  fwiSeries?: import('./fwi').FWIHourly[]
}

export function burnedHa(grid: Grid, run: Run, t: number): number {
  let cells = 0
  for (let i = 0; i < run.arrival.length; i++) if (run.arrival[i] <= t) cells++
  return cells * cellHa(grid)
}

/** The free ELMFIRE forecast supplies wet-line orientation and approach checks. */
export function forecastArrival(scenario: Scenario): Float32Array {
  if (!scenario.fireArrival) throw new Error(scenario.demo ? 'A previsão ainda não está disponível' : 'A previsão ELMFIRE ainda não está disponível')
  return scenario.fireArrival
}

/** The same barriers the editor draws and the API receives. */
export function decisionBarriers(scenario: Scenario, decision: Decision): Barrier[] {
  return scenario.demo ? demoLines(scenario, decision).map(w => w.barrier) : barriers(scenario, decision, forecastArrival(scenario))
}
