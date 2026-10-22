// The one incident of a simulated fire: its wind shift (fire.json windShift). Plans are made on the forecast
// without it; when the fire clock reaches it while playing, the player pauses and a modal has one action,
// "Realocar meios". Playback cannot go past it until an ELMFIRE run with the new wind has been shown
// (main.ts); play just shows the prompt again. Until then the stack carries one alert. The clock is the
// player's, in hours, as main passes it each frame.

import type { Alert } from './alerts'
import type { Fire, WindShift } from './data'
import type { Run } from './fastModel'
import { fmtNumber, fmtTime, wallClock } from './format'
import { compass, type LonLat } from './geo'
import { cellOf, lonLatAt, type Grid } from './grid'

const EPS_MIN = 1e-6

/** What main gives the controller: the player's controls and the drawer. */
export interface WindShiftHost {
  pause(): void
  seek(hours: number): void // pins the fire clock
  reallocate(): void // "Realocar meios": the drawer opens at the incident, the simulation is stale
  rearmed(): void // the clock went back before the incident: the pre-incident results are the ones to show
}

/** "E 23 km/h → NNO 36 km/h (rajadas 63)" */
export function windLine(w: WindShift): string {
  const side = (i: 0 | 1) => `${compass(w.fromDeg[i])} ${fmtNumber(w.kmh[i])} km/h`
  return `${side(0)} → ${side(1)} (rajadas ${fmtNumber(w.gustKmh[1])})`
}

const headLine = (w: WindShift) => `A cabeça do incêndio roda de ${compass(w.headTowardDeg[0])} para ${compass(w.headTowardDeg[1])}.`

/** A small compass: the arrow where the wind blows to, dim before the shift and amber after it. */
function compassSvg(fromDeg: number, after: boolean): string {
  const colour = after ? '#f0a33a' : '#8b9096'
  return (
    `<svg viewBox="-30 -30 60 60" width="64" height="64" aria-hidden="true">` +
    `<circle r="26" fill="none" stroke="rgba(220,224,228,0.28)"/>` +
    `<path d="M0-26v-4" stroke="rgba(220,224,228,0.5)"/>` +
    `<text y="-17" font-size="7" text-anchor="middle" fill="#8b9096" style="font-family:inherit">N</text>` +
    `<g transform="rotate(${(fromDeg + 180) % 360})" stroke="${colour}" fill="${colour}" stroke-width="2.4" stroke-linecap="round">` +
    `<path d="M0 17V-12"/><path d="M-6-5 0-14 6-5Z" stroke-linejoin="round"/></g></svg>`
  )
}

export class WindShiftWatch {
  private shift: WindShift | undefined
  private start = ''
  private head: LonLat | undefined
  private resolved = false // a run with the new wind is on the screen: playback may go on
  private past = false // the clock is at or after the incident
  private prev = 0 // minutes at the last frame
  private modal: HTMLElement | undefined
  private cache: { base: Alert[]; key: string; out: Alert[] } | undefined

  constructor(private readonly host: WindShiftHost) {
    // While the modal stands the page's keys (space, arrows, R) must not move the player behind it.
    document.addEventListener(
      'keydown',
      (e) => {
        if (!this.modal) return
        if (e.key !== 'Tab') e.stopImmediatePropagation()
      },
      true,
    )
  }

  /** A fire opened: its shift (if any) and where its head stands at the shift in the free run. */
  setFire(fire: Fire, grid: Grid, free: Run) {
    this.close()
    this.shift = fire.windShift
    this.start = fire.start
    this.resolved = false
    this.past = false
    this.prev = 0
    this.cache = undefined
    this.head = this.shift ? headAt(grid, fire.ignition, free, this.shift.minutes) : undefined
  }

  /** A run with the new wind is on the screen (or the clock went back to the old wind). */
  setResolved(resolved: boolean) {
    this.resolved = resolved
    this.cache = undefined
  }

  /** Once per frame, with the fire clock (hours) and whether the player is playing. */
  update(hours: number, playing: boolean) {
    const w = this.shift
    if (!w) return
    const m = hours * 60
    this.prev = m
    if (m < w.minutes - EPS_MIN) {
      // Before the incident again (restart, slider, back): it is armed again.
      if (this.past) {
        this.past = false
        this.close()
        this.host.rearmed()
      }
      return
    }
    this.past = true
    if (playing && !this.resolved && !this.modal) {
      this.host.pause()
      this.host.seek(w.minutes / 60) // a shot still moving must not carry the clock on
      this.show(w)
    }
  }

  /** The stack's alerts with the incident's: one, from the shift until a run with the new wind is shown. */
  alerts(base: Alert[]): Alert[] {
    const w = this.shift
    if (!w || this.resolved || this.prev < w.minutes - EPS_MIN) return base
    const alert = this.alert(w, 'critical', 'Incidente: mudança de vento — realocar meios')
    const key = alert.title
    if (this.cache?.base !== base || this.cache.key !== key) this.cache = { base, key, out: [...base, alert] }
    return this.cache.out
  }

  private alert(w: WindShift, level: Alert['level'], title: string): Alert {
    return {
      id: 'wind',
      kind: 'wind',
      level,
      title,
      detail: `${windLine(w)} · ${headLine(w)}`,
      source: `${w.note}\n\n${w.alert}`,
      at: this.head,
    }
  }

  private reallocate() {
    this.close()
    this.host.reallocate()
    if (this.shift) this.host.seek(this.shift.minutes / 60)
  }

  private close() {
    this.modal?.remove()
    this.modal = undefined
  }

  private show(w: WindShift) {
    this.close()
    const clock = fmtTime(wallClock(this.start, w.minutes / 60))
    const el = document.createElement('div')
    el.className = 'wind-modal-backdrop'
    el.innerHTML = `
      <div class="wind-modal" role="alertdialog" aria-modal="true" aria-labelledby="wind-title">
        <div class="wind-eyebrow"><i></i>Alerta crítico · ${clock}</div>
        <h2 id="wind-title">Mudança brusca de vento</h2>
        <div class="wind-compasses">
          <figure>${compassSvg(w.fromDeg[0], false)}<figcaption>antes</figcaption></figure>
          <span class="wind-arrow">→</span>
          <figure>${compassSvg(w.fromDeg[1], true)}<figcaption>depois</figcaption></figure>
          <p class="wind-line"></p>
        </div>
        <p class="wind-text"></p>
        <p class="wind-means"></p>
        <footer>
          <button type="button" class="wind-review">Realocar meios</button>
        </footer>
      </div>`
    el.querySelector('.wind-line')!.textContent = windLine(w)
    el.querySelector('.wind-text')!.textContent = w.alert
    el.querySelector('.wind-means')!.textContent = `${headLine(w)} A estratégia pensada para o vento anterior pode já não servir: realoque os meios; o ELMFIRE corre de novo com o vento novo.`
    el.querySelector('.wind-review')!.addEventListener('click', () => this.reallocate())
    document.body.append(el)
    this.modal = el
    el.querySelector<HTMLButtonElement>('.wind-review')!.focus()
  }
}

/** The farthest cell the free run has burned from the ignition by `minutes`: where the head is. */
function headAt(grid: Grid, ignition: LonLat, run: Run, minutes: number): LonLat | undefined {
  const start = cellOf(grid, ignition)
  if (start < 0) return undefined
  const { cols } = grid
  const c0 = start % cols
  const r0 = (start - c0) / cols
  let best = -1
  let far = -1
  const { arrival } = run
  for (let i = 0; i < arrival.length; i++) {
    if (!(arrival[i] <= minutes)) continue
    const c = i % cols
    const d = Math.hypot(c - c0, (i - c) / cols - r0)
    if (d > far) (far = d), (best = i)
  }
  if (best < 0) return undefined
  const col = best % cols
  return lonLatAt(grid, col + 0.5, (best - col) / cols + 0.5)
}
