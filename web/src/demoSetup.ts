// Browser demo only: never rewrite ELMFIRE inputs or its saved perimeter datasets.
import type { Fire, Weather, Progression } from './data'
export function configurePenhaDemo(fire: Fire, weather: Weather, forecast: Weather, progression: Progression): boolean {
  if (fire.id !== 'Penha_Guimaraes_hipotetico') return false
  fire.ignition = { lat: 41 + 25/60 + 48.1/3600, lon: -(8 + 16/60 + 36.7/3600) }
  fire.ignitions = fire.ignitions.map(p => ({...p, ...fire.ignition}))
  // Southeast wind drives the initial front toward the residential rural interface; north-northeast wind then turns growth south.
  const start = Math.max(0, weather.time.indexOf(fire.start.slice(0,16)))
  for (let i=0; i<weather.time.length; i++) {
    forecast.windFromDeg[i] = 130
    forecast.windKmh[i] = 16
    forecast.gustKmh[i] = 24
    weather.windFromDeg[i] = i >= start+2 ? 20 : 130
    weather.windKmh[i] = i >= start+2 ? 22 : 16
    weather.gustKmh[i] = i >= start+2 ? 30 : 24
  }
  if (fire.windShift) Object.assign(fire.windShift, {
    minutes: 90, fromDeg: [130,20], kmh: [16,22], gustKmh: [24,30], headTowardDeg: [310,200],
    note: 'Vento sintético da demo: SE 16 km/h até T+90 min; NNE 22 km/h depois.',
    alert: 'O vento muda de SE para NNE. A nova expansão segue para o flanco sul.',
  })
  for (const period of fire.periods) period.spreadTowardDeg = 310
  // Saved ELMFIRE perimeters belong to the old ignition; wait for an explicit run.
  progression.perimeters = progression.perimeters.map(() => [])
  progression.increments = progression.increments.map(() => [])
  progression.untimed = []
  return true
}
