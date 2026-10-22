// Browser demo only: never rewrite ELMFIRE inputs or its saved perimeter datasets.
import type { Fire, Weather, Progression } from './data'
export function configurePenhaDemo(fire: Fire, weather: Weather, forecast: Weather, progression: Progression): boolean {
  if (fire.id !== 'Penha_Guimaraes_hipotetico') return false
  fire.ignition = { lat: 41 + 25/60 + 42.4/3600, lon: -(8 + 16/60 + 29.4/3600) }
  fire.ignitions = fire.ignitions.map(p => ({...p, ...fire.ignition}))
  // East wind drives the initial front west; the north wind then turns growth south.
  const start = Math.max(0, weather.time.indexOf(fire.start.slice(0,16)))
  for (let i=0; i<weather.time.length; i++) {
    forecast.windFromDeg[i] = 90
    forecast.windKmh[i] = 14
    forecast.gustKmh[i] = 20
    weather.windFromDeg[i] = i >= start+2 ? 0 : 90
    weather.windKmh[i] = i >= start+2 ? 20 : 14
    weather.gustKmh[i] = i >= start+2 ? 28 : 20
  }
  if (fire.windShift) Object.assign(fire.windShift, {
    minutes: 90, fromDeg: [90,0], kmh: [14,20], gustKmh: [20,28], headTowardDeg: [270,180],
    note: 'Vento sintético da demo: E 14 km/h até T+90 min; N 20 km/h depois.',
    alert: 'O vento muda de E para N. A nova expansão segue para sul.',
  })
  for (const period of fire.periods) period.spreadTowardDeg = 270
  // Saved ELMFIRE perimeters belong to the old ignition; wait for an explicit run.
  progression.perimeters = progression.perimeters.map(() => [])
  progression.increments = progression.increments.map(() => [])
  progression.untimed = []
  return true
}
