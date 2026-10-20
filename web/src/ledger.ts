// The ledger of the instant: what is known at the fire clock's T, each layer with its source and
// its hour, and what is only known in hindsight. Lines light up as the clock passes the moment
// the data would arrive; the satellite stays dim until T_sat. A click on the title folds the
// table away (key L too); the choice is kept in this browser.

import type { Fire, NearStation, Weather } from './data'
import type { Detection } from './detection'
import { fmtHa, fmtKm, fmtNumber, fmtTime, wallClock } from './format'
import { compass } from './geo'
import type { Inventory } from './inventory'

export interface Known {
  fire: Fire
  weather: Weather
  startIndex: number // entry of weather.time at the ignition
  stations: NearStation[]
  inventory: Inventory | null
  detection: Detection
  satHa: number // burned when the satellite would detect the fire
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
      '<button type="button" class="eyebrow" title="Mostra ou esconde os dados (L)"><i></i>Dados conhecidos em tempo real</button><table></table>'
    parent.append(this.el)
    this.el.querySelector('button')!.addEventListener('click', () => this.toggle())
    this.fold(localStorage.getItem(STORAGE_KEY) === 'folded')
  }

  /** Folds the table away under the title, or opens it again. */
  toggle() {
    this.fold(!this.el.classList.contains('folded'))
  }

  private fold(folded: boolean) {
    this.el.classList.toggle('folded', folded)
    localStorage.setItem(STORAGE_KEY, folded ? 'folded' : 'open')
  }

  set(known: Known) {
    const { fire, weather, startIndex, stations, inventory, detection, satHa } = known
    const clock = (minutes: number) => fmtTime(wallClock(fire.start, minutes / 60))
    const nearest = stations[0]
    const stock = nearest ? inventory?.[nearest.id] : undefined
    const rows: Row[] = [
      {
        layer: 'Ignição',
        source: 'drone',
        at: (h) => (h * 60 < detection.droneMin ? ['off', 'sem deteção'] : ['on', `${clock(detection.droneMin)} · T+${detection.droneMin} min`]),
      },
      {
        layer: 'Meteo',
        source: 'ERA5',
        at: (h) => {
          const i = Math.min(Math.max(startIndex + Math.floor(h), 0), weather.time.length - 1)
          const text = `${clock(Math.floor(h) * 60)} · ${fmtNumber(weather.windKmh[i])} km/h de ${compass(weather.windFromDeg[i])} · ${fmtNumber(weather.tempC[i])} °C · ${fmtNumber(weather.rhPct[i])} %`
          return ['on', text]
        },
      },
      { layer: 'Combustível', source: 'COS 2015', at: () => ['on', 'pré-carregado'] },
      { layer: 'Relevo', source: 'Copernicus 30 m', at: () => ['on', 'pré-carregado'] },
      {
        layer: 'Quartéis',
        source: 'OSM',
        at: () => ['on', nearest ? `${stations.length} a < 20 km · ${nearest.short} ${fmtKm(nearest.km)}` : 'nenhum a < 20 km'],
      },
      {
        layer: 'Inventário',
        source: 'INE 2024 · estimado',
        at: () => (stock && nearest ? ['on', `${nearest.short} · ${stock.units.vfci} VFCI · ${stock.personnel.onDuty} de serviço`] : ['off', 'sem estimativa']),
      },
      {
        layer: 'Satélite',
        source: 'MODIS · VIIRS',
        at: (h) =>
          h * 60 < detection.satelliteMin
            ? ['wait', `sem passagem até ${clock(detection.satelliteMin)}`]
            : ['on', `deteção ${clock(detection.satelliteMin)} · ${fmtHa(satHa)}`],
      },
      { layer: 'Perímetros', source: 'PT-FireSprd', at: () => ['retro', 'só em retrospetiva'] },
    ]
    const table = this.el.querySelector('table')!
    table.replaceChildren()
    this.rows = rows.map((row) => {
      const tr = document.createElement('tr')
      tr.innerHTML = '<th></th><td class="source"></td><td class="text"></td>'
      tr.querySelector('th')!.textContent = row.layer
      const source = tr.querySelector<HTMLElement>('.source')!
      source.textContent = row.source
      table.append(tr)
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
