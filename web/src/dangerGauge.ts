// The weather's danger at the fire clock: the Canadian FWI and its IPMA class as five steps, the class
// on the card; a click opens the codes behind it, the air (temperature, humidity, rain) and the next hours.
// The same weather and series as the ledger's Atmosfera and Perigo; no model.

import type { Fire, Weather } from './data'
import { Floating } from './floating'
import { fmtMinutes, fmtNumber } from './format'
import { computeFWISeries, fwiAt, type FWIHourly } from './fwi'
import { Detail, type Row } from './widgetDetail'
import './knownWidgets.css'

const LEVELS = ['good', 'good', 'warning', 'serious', 'critical'] // IPMA classes 1..5 on the status palette
const AHEAD_STEP_MIN = 60
const AHEAD_MIN = 180

export interface DangerInput {
  fire: Fire
  weather: Weather
  forecastWeather?: Weather
  windShiftMin?: number
  startIndex: number
  fwiSeries?: FWIHourly[]
}

/** A movable screen widget, stacked where its home puts it until it is moved. */
export class DangerGauge {
  readonly el = document.createElement('section')
  private readonly steps: HTMLElement[]
  private readonly value: HTMLElement
  private readonly klass: HTMLElement
  private readonly detail: Detail
  private readonly floating: Floating
  private readonly real: FWIHourly[]
  private readonly forecast: FWIHourly[]
  private key = ''

  constructor(parent: HTMLElement, private readonly input: DangerInput, home: () => { x: number; y: number }, moved?: () => void) {
    this.real = input.fwiSeries ?? computeFWISeries(input.weather)
    this.forecast = input.forecastWeather ? computeFWISeries(input.forecastWeather) : this.real
    this.el.className = 'float-card danger-card'
    this.el.setAttribute('aria-label', 'Perigo meteorológico')
    this.el.title = 'Clique para ver o detalhe · arraste para mover só este card'
    this.el.innerHTML = `
      <div class="float-title">Perigo</div>
      <button type="button" class="float-drag" aria-label="Mover perigo. Use as setas para deslocar, Home para repor ou Enter para ver o detalhe." title="Arraste para mover o bloco · duplo clique para repor"><span aria-hidden="true">⠿</span></button>
      <div class="danger-steps" aria-hidden="true">${LEVELS.map(() => '<i></i>').join('')}</div>
      <div class="known-value"><strong>—</strong> FWI</div>
      <div class="known-sub">&nbsp;</div>`
    this.steps = [...this.el.querySelectorAll<HTMLElement>('.danger-steps i')]
    this.value = this.el.querySelector('.known-value strong')!
    this.klass = this.el.querySelector('.known-sub')!
    this.detail = new Detail(parent, 'Perigo meteorológico')
    parent.append(this.el)
    this.floating = new Floating(this.el, this.el.querySelector('.float-drag')!, parent, {
      home,
      moved,
      open: () => this.detail.show(this.el.querySelector<HTMLElement>('.float-drag')!),
    })
  }

  /** The forecast until the wind shift, the weather that happened after it, as the ledger reads them. */
  private at(minute: number) {
    return fwiAt(minute < (this.input.windShiftMin ?? Infinity) ? this.forecast : this.real, this.input.startIndex, minute)
  }

  update(minute: number) {
    const m = Math.round(minute)
    const key = String(m)
    if (key === this.key) return
    this.key = key
    const f = this.at(m)
    const level = LEVELS[f.dangerLevel - 1]
    this.steps.forEach((s, k) => { s.className = k < f.dangerLevel ? level : '' })
    this.value.textContent = fmtNumber(f.fwi, 1)
    this.klass.textContent = f.dangerClass
    const ahead: Row[] = []
    for (let t = AHEAD_STEP_MIN; t <= AHEAD_MIN; t += AHEAD_STEP_MIN) {
      const g = this.at(m + t)
      ahead.push([`+${fmtMinutes(t)}`, `${g.dangerClass} · FWI ${fmtNumber(g.fwi, 1)}`, LEVELS[g.dangerLevel - 1]])
    }
    const source = this.input.fire.simulated ? 'IFS (ECMWF)' : 'ERA5 (ECMWF)'
    this.detail.set([
      { heading: 'Agora', rows: [
        ['Classe', `${f.dangerClass} (${f.dangerLevel} de 5)`, level],
        ['FWI', fmtNumber(f.fwi, 1)],
        ['Propagação (ISI)', fmtNumber(f.isi, 1)],
        ['Combustível (BUI)', fmtNumber(f.bui, 1)],
        ['Humidade do fino morto', `${fmtNumber(f.fuelMoisturePct, 1)} %`],
      ] },
      { heading: 'Atmosfera', rows: [
        ['Temperatura', `${fmtNumber(f.tempC)} °C`],
        ['Humidade relativa', `${fmtNumber(f.rhPct)} %`],
        ['Vento a 10 m', `${fmtNumber(f.windKmh)} km/h`],
        ['Precipitação', `${fmtNumber(f.precipMm, 1)} mm/h`],
      ] },
      { heading: 'Próximas horas', rows: ahead },
    ], [
      `Meteorologia: ${source}${this.input.fire.simulated ? ' + cenário' : ''}. Índice de Perigo de Incêndio canadiano (FWI, Van Wagner 1987), calculado hora a hora.`,
      'Classes do IPMA: Reduzido < 8,5 · Moderado < 17,2 · Elevado < 24,6 · Muito Elevado < 38,3 · Máximo.',
      ...(this.input.windShiftMin !== undefined ? [`Até à mudança de vento (T+${fmtMinutes(this.input.windShiftMin)}) lê a previsão; depois, o tempo que fez.`] : []),
    ].join('\n'))
    this.el.setAttribute('aria-label', `Perigo ${f.dangerClass}, FWI ${fmtNumber(f.fwi, 1)}; ${fmtNumber(f.tempC)} °C, humidade ${fmtNumber(f.rhPct)} %`)
  }

  destroy() { this.floating.destroy(); this.detail.destroy(); this.el.remove() }
}
