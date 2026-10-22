// When the fire is seen: the drone's alert and the satellite's pass on one short timeline, the clock on it;
// a click opens the times, the area the satellite would find and what the drone gains. The same detection
// as the ledger's Deteção and Satélite (public/detection.json); no model.

import type { Fire } from './data'
import type { Detection } from './detection'
import { Floating } from './floating'
import { fmtHa, fmtMinutes, fmtTime, wallClock } from './format'
import { Detail } from './widgetDetail'
import './knownWidgets.css'

export interface DetectionInput { fire: Fire; detection: Detection; satHa: number }

/** A movable screen widget, stacked where its home puts it until it is moved. */
export class DetectionGauge {
  readonly el = document.createElement('section')
  private readonly head: HTMLElement
  private readonly state: HTMLElement
  private readonly drone: HTMLElement
  private readonly sat: HTMLElement
  private readonly detail: Detail
  private readonly floating: Floating
  private readonly spanMin: number
  private key = ''

  constructor(parent: HTMLElement, private readonly input: DetectionInput, home: () => { x: number; y: number }, moved?: () => void) {
    const { droneMin, satelliteMin } = input.detection
    this.spanMin = Math.max(satelliteMin, droneMin) * 1.15 || 60
    const at = (m: number) => `${(100 * m / this.spanMin).toFixed(1)}%`
    this.el.className = 'float-card detection-card'
    this.el.setAttribute('aria-label', 'Deteção')
    this.el.title = 'Clique para ver o detalhe · arraste para mover só este card'
    this.el.innerHTML = `
      <div class="float-title">Deteção</div>
      <button type="button" class="float-drag" aria-label="Mover deteção. Use as setas para deslocar, Home para repor ou Enter para ver o detalhe." title="Arraste para mover o bloco · duplo clique para repor"><span aria-hidden="true">⠿</span></button>
      <div class="detection-line" aria-hidden="true">
        <i class="detection-drone" style="left: ${at(droneMin)}"></i>
        <i class="detection-sat" style="left: ${at(satelliteMin)}"></i>
        <i class="detection-head"></i>
      </div>
      <div class="known-sub">&nbsp;</div>`
    this.drone = this.el.querySelector('.detection-drone')!
    this.sat = this.el.querySelector('.detection-sat')!
    this.head = this.el.querySelector('.detection-head')!
    this.state = this.el.querySelector('.known-sub')!
    this.detail = new Detail(parent, 'Deteção')
    parent.append(this.el)
    this.floating = new Floating(this.el, this.el.querySelector('.float-drag')!, parent, {
      storageKey: 'atalaia.detection-position',
      home,
      moved,
      open: () => this.detail.show(this.el.querySelector<HTMLElement>('.float-drag')!),
    })
  }

  update(minute: number) {
    const m = Math.round(minute)
    const { fire, detection, satHa } = this.input
    const { droneMin, satelliteMin } = detection
    const seenByDrone = m >= droneMin, seenBySat = m >= satelliteMin
    const key = `${Math.min(m, Math.ceil(this.spanMin))}`
    if (key === this.key) return
    this.key = key
    const clock = (min: number) => fmtTime(wallClock(fire.start, min / 60))
    this.head.style.left = `${(100 * Math.min(m, this.spanMin) / this.spanMin).toFixed(1)}%`
    this.drone.classList.toggle('on', seenByDrone)
    this.sat.classList.toggle('on', seenBySat)
    const state = seenBySat ? `Satélite ${clock(satelliteMin)}` : seenByDrone ? `Drone ${clock(droneMin)}` : 'A aguardar'
    this.state.textContent = state
    const gain = satelliteMin - droneMin
    this.detail.set([
      { heading: 'Linha do tempo', rows: [
        ['Ignição', clock(0)],
        ['Drone', `alerta às ${clock(droneMin)} · T+${fmtMinutes(droneMin)}`, seenByDrone ? 'good' : 'forecast'],
        ['Satélite', `passagem às ${clock(satelliteMin)} · T+${fmtMinutes(satelliteMin)}`, seenBySat ? 'good' : 'forecast'],
        ['Agora', seenBySat ? 'Detetado pelos dois' : seenByDrone ? `Detetado pelo drone; satélite daqui a ${fmtMinutes(satelliteMin - m)}` : `Drone daqui a ${fmtMinutes(droneMin - m)}`],
      ] },
      { heading: 'O que o drone ganha', rows: [
        ['Antecipação', gain > 0 ? `${fmtMinutes(gain)} antes do satélite` : 'nenhuma'],
        ['Área à passagem', `${fmtHa(satHa)} ardidos quando o satélite o veria`],
        ['Relógio dos meios', `começa no alerta do drone (T+${fmtMinutes(droneMin)})`],
      ] },
    ], [detection.notes, ...Object.entries(detection.sources).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join('\n'))
    this.el.setAttribute('aria-label', `Deteção: ${state}; drone T+${droneMin} min, satélite T+${satelliteMin} min`)
  }

  destroy() { this.floating.destroy(); this.detail.destroy(); this.el.remove() }
}
