// How fast the fire grows: hectares per hour over the last hour of the free run (no forces) on the card,
// the burned area under it; a click opens where the free run would be in the next hours and the containment
// estimate at each. The same area as the HUD's Área and the ledger's POC; no new model.

import { Floating } from './floating'
import { fmtHa, fmtMinutes, fmtNumber, fmtPct } from './format'
import { Detail, type Row } from './widgetDetail'
import './knownWidgets.css'

const RATE_WINDOW_MIN = 60 // the free run arrives in hourly steps: a shorter window reads 0 between them
const AHEAD_STEP_MIN = 60
const AHEAD_MIN = 180
const FAST_HA_PER_H = 50 // a fast fire for the region's initial attack
const SLOW_HA_PER_H = 5

export interface GrowthInput {
  areaHa(hours: number): number // the free run's burned area
  poc(areaHa: number): number
}

/** A movable screen widget, stacked where its home puts it until it is moved. */
export class GrowthGauge {
  readonly el = document.createElement('section')
  private readonly value: HTMLElement
  private readonly sub: HTMLElement
  private readonly detail: Detail
  private readonly floating: Floating
  private key = ''

  constructor(parent: HTMLElement, private readonly input: GrowthInput, home: () => { x: number; y: number }, moved?: () => void) {
    this.el.className = 'float-card growth-card'
    this.el.setAttribute('aria-label', 'Crescimento')
    this.el.title = 'Clicar para ver o detalhe · arrastar para mover'
    this.el.innerHTML = `
      <div class="float-title">Crescimento</div>
      <button type="button" class="float-drag" aria-label="Mover crescimento: setas deslocam, Home repõe, Enter abre o detalhe." title="Arrastar para mover · duplo clique repõe"><span aria-hidden="true">⠿</span></button>
      <div class="known-value"><i></i><strong>—</strong> ha/h</div>
      <div class="known-sub">&nbsp;</div>`
    this.value = this.el.querySelector('.known-value strong')!
    this.sub = this.el.querySelector('.known-sub')!
    this.detail = new Detail(parent, 'Crescimento do incêndio')
    parent.append(this.el)
    this.floating = new Floating(this.el, this.el.querySelector('.float-drag')!, parent, {
      home,
      moved,
      open: () => this.detail.show(this.el.querySelector<HTMLElement>('.float-drag')!),
    })
  }

  update(minute: number) {
    const m = Math.round(minute)
    const key = String(m)
    if (key === this.key) return
    this.key = key
    const { areaHa, poc } = this.input
    const ha = areaHa(m / 60)
    const span = Math.min(RATE_WINDOW_MIN, m)
    const rate = span > 0 ? (ha - areaHa((m - span) / 60)) * 60 / span : 0
    const level = rate >= FAST_HA_PER_H ? 'critical' : rate >= SLOW_HA_PER_H ? 'warning' : 'good'
    this.el.querySelector('.known-value i')!.className = level
    this.value.textContent = fmtNumber(rate, rate < 10 ? 1 : 0)
    this.sub.textContent = `${fmtHa(ha)} ardidos`
    const ahead: Row[] = []
    for (let t = AHEAD_STEP_MIN; t <= AHEAD_MIN; t += AHEAD_STEP_MIN) {
      const later = areaHa((m + t) / 60)
      ahead.push([`+${fmtMinutes(t)}`, `${fmtHa(later)} · POC ${fmtPct(poc(later))}`])
    }
    this.detail.set([
      { heading: 'Agora', rows: [
        ['Ritmo', `${fmtNumber(rate, 1)} ha/h nos últimos ${fmtMinutes(Math.max(1, span))}`, level],
        ['Área ardida', fmtHa(ha)],
        ['Contenção (POC)', fmtPct(poc(ha))],
      ] },
      { heading: 'Sem combate', rows: ahead },
    ], [
      'Área da corrida livre (sem meios) no relógio, a mesma da Área do ecrã.',
      `Ritmo: < ${SLOW_HA_PER_H} ha/h lento · < ${FAST_HA_PER_H} ha/h rápido · acima, fora do ataque inicial. Referência da demo, não oficial.`,
      'POC: probabilidade de contenção pela área ardida, estimativa da demo.',
    ].join('\n'))
    this.el.setAttribute('aria-label', `Crescimento ${fmtNumber(rate, 1)} hectares por hora; ${fmtHa(ha)} ardidos`)
  }

  destroy() { this.floating.destroy(); this.detail.destroy(); this.el.remove() }
}
