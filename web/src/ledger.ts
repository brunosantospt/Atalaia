// The ledger of the instant: what is known at the fire clock's T, each layer with its source and
// its hour, and what is only known in hindsight. Lines light up as the clock passes the moment
// the data would arrive; the satellite stays dim until it would detect the fire. A click on the
// title folds the table away (key L too); the choice is kept in this browser.

import type { Fire, NearStation, Weather } from './data'
import { windAt } from './windLayer'
import type { Detection } from './detection'
import { computeFWISeries, fwiAt, type FWIHourly } from './fwi'
import { fmtHa, fmtKm, fmtNumber, fmtPct, fmtTime, wallClock } from './format'
import { compass } from './geo'
import { fleet, type Inventory } from './inventory'

export interface Known {
  fire: Fire
  weather: Weather
  forecastWeather?: Weather
  windShiftMin?: number
  startIndex: number // entry of weather.time at the ignition
  stations: NearStation[]
  inventory: Inventory | null
  detection: Detection
  satHa: number // burned when the satellite would detect the fire
  fwiSeries?: FWIHourly[]
  metrics?: { areaHa(hours: number): number; poc(areaHa: number): number; intensityKWPerM: number }
}

type State = 'on' | 'off' | 'wait' | 'retro'

interface Row {
  layer: string
  source: string
  at(hours: number): [State, string]
}

const STORAGE_KEY = 'atalaia.ledger'

export class Ledger {
  readonly el: HTMLElement
  private rows: { row: Row; state: HTMLElement; text: HTMLElement; source: HTMLElement; shown: string }[] = []

  constructor(parent: HTMLElement) {
    this.el = document.createElement('section')
    this.el.className = 'panel ledger'
    this.el.innerHTML =
      '<button type="button" class="eyebrow" title="Mostra ou esconde os dados (L)"><i></i>Dados conhecidos</button><table></table>'
    parent.append(this.el)
    this.el.querySelector('button')!.addEventListener('click', () => this.toggle())
    this.fold(localStorage.getItem(STORAGE_KEY) === 'folded')
    const title = parent.querySelector<HTMLElement>('.title')
    if (title) new ResizeObserver(() => { const top = `${title.offsetTop + title.offsetHeight + 12}px`; this.el.style.top = top; this.el.style.setProperty('--ledger-top',top) }).observe(title)
  }

  /** Folds the table away under the title, or opens it again. */
  toggle() {
    this.fold(!this.el.classList.contains('folded'))
  }

  private fold(folded: boolean) {
    this.el.classList.toggle('folded', folded)
    this.el.querySelector('button')!.setAttribute('aria-expanded', String(!folded))
    localStorage.setItem(STORAGE_KEY, folded ? 'folded' : 'open')
  }

  set(known: Known) {
    const { fire, weather, startIndex, stations, inventory, detection, satHa } = known
    const metrics = known.metrics
    const fwiList = known.fwiSeries ?? computeFWISeries(weather)
    const forecastFwi = known.forecastWeather ? computeFWISeries(known.forecastWeather) : fwiList
    const weatherAt = (h: number) => h*60 < (known.windShiftMin ?? Infinity) ? known.forecastWeather ?? weather : weather
    const meteoSource = fire.simulated ? 'IFS' : 'ERA5'
    const clock = (minutes: number) => fmtTime(wallClock(fire.start, minutes / 60))
    const nearest = stations[0]
    const stock = nearest ? inventory?.[nearest.id] : undefined
    const hourIndex = (h: number) => Math.min(Math.max(startIndex + Math.floor(h), 0), weather.time.length-1)
    const rows: Row[] = [
      { layer: 'Deteção', source: 'Drone · cenário', at: h => h*60 < detection.droneMin ? ['wait', 'A aguardar alerta'] : ['on', `Alerta às ${clock(detection.droneMin)} · T+${detection.droneMin} min`] },
      { layer: 'Vento', source: `${meteoSource}${fire.simulated ? ' + cenário' : ''}`, at: h => { const w=windAt(weatherAt(h),startIndex,Math.round(h*60)); return ['on', `${fmtNumber(w.kmh)} km/h de ${compass(w.from)} · rajadas ${fmtNumber(w.gust)}`] } },
      { layer: 'Atmosfera', source: meteoSource, at: h => { const i=hourIndex(h); return ['on', `${fmtNumber(weather.tempC[i])} °C · humidade ${fmtNumber(weather.rhPct[i])}%`] } },
      { layer: 'Perigo', source: 'FWI calculado', at: h => { const f=fwiAt(weatherAt(h) === weather ? fwiList : forecastFwi,startIndex,h*60); return ['on', `${f.dangerClass} · FWI ${fmtNumber(f.fwi,1)}`] } },
      ...(metrics ? [
        { layer: 'POC', source: 'Estimativa · Livre', at: (h: number): [State, string] => ['on', `${fmtPct(metrics.poc(metrics.areaHa(h)))} · contenção`] },
        { layer: 'Intensidade', source: 'Pico estimado', at: (): [State, string] => ['on', `${fmtNumber(metrics.intensityKWPerM)} kW/m`] },
      ] : []),
      { layer: 'Resposta', source: 'Inventário estimado', at: () => ['on', nearest ? `${nearest.short} · ${fmtKm(nearest.km)}${stock ? ` · ${fleet(stock) ?? `${stock.units.vfci} VFCI`}` : ''}` : 'Sem quartel disponível'] },
      { layer: 'Satélite', source: 'Passagem · cenário', at: h => h*60<detection.satelliteMin ? ['wait', `Verificação às ${clock(detection.satelliteMin)}`] : ['on', `${clock(detection.satelliteMin)} · área estimada ${fmtHa(satHa)}`] },
    ]
    const table = this.el.querySelector('table')!
    table.innerHTML = '<caption>Situação à hora do cenário</caption><thead><tr><th>Dado</th><th>Situação</th><th>Origem</th></tr></thead><tbody></tbody>'
    const body = table.querySelector('tbody')!
    this.rows = rows.map((row) => {
      const tr = document.createElement('tr')
      tr.innerHTML = '<th scope="row"></th><td class="text"></td><td class="source"></td>'
      tr.querySelector('th')!.textContent = row.layer
      const source = tr.querySelector<HTMLElement>('.source')!
      source.textContent = row.source
      body.append(tr)
      return { row, state: tr, text: tr.querySelector<HTMLElement>('.text')!, source, shown: '' }
    })
  }

  update(hours: number) {
    for (const r of this.rows) {
      const [state, text] = r.row.at(hours)
      const key = `${state}|${text}`
      if (key === r.shown) continue
      r.shown = key
      r.state.className = state
      r.text.textContent = text
    }
  }
}
