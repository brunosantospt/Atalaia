// The gray "intel" HUD: shot word and place, fire clock, camera readout, screen-centre
// position in PT-TM06, caption card, transport bar and the settings drawer (fire and engine).
// Data credits are not here but in Cesium's credit line, so they stay on screen when the HUD is hidden.

import type { Fire, FireIndexEntry } from './data'
import { fmtDate, fmtElapsed, fmtHa, fmtNumber, fmtRange, fmtTime, wallClock } from './format'
import { compass, formatDMS, toPTTM06, type LonLat } from './geo'
import type { SafeArea } from './markers'
import type { Frame } from './player'
import { SettingsPanel } from './settings'
import type { Shot } from './shots'
import './hud.css'

export interface HudActions {
  toggle(): void
  prev(): void
  next(): void
  goTo(i: number): void
  pickFire(id: string): void
}

export interface CameraReadout {
  heading: number
  pitch: number
  range: number
  centre: LonLat | undefined
}

const TEMPLATE = `
  <div class="frame">
    <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
    <i class="third v1"></i><i class="third v2"></i><i class="third h1"></i><i class="third h2"></i>
    <i class="reticle"></i>
  </div>
  <section class="panel title">
    <div class="eyebrow">Atalaia · gémeo de decisão</div>
    <div class="word" data-ref="word"></div>
    <div class="line" data-ref="place"></div>
    <div class="line dim" data-ref="coords"></div>
  </section>
  <section class="panel clock">
    <div class="live"><i></i><span data-ref="mode">Replay</span> · observado</div>
    <div class="time" data-ref="time"></div>
    <div class="line dim" data-ref="date"></div>
    <div class="pair"><span data-ref="elapsed"></span><span data-ref="area"></span></div>
    <div class="line" data-ref="step"></div>
  </section>
  <section class="panel rail">
    <div><label>Hdg</label><span data-ref="hdg"></span></div>
    <div><label>Pitch</label><span data-ref="pitch"></span></div>
    <div><label>Rng</label><span data-ref="rng"></span></div>
  </section>
  <section class="panel position">
    <div><label>PT-TM06</label><span data-ref="tm"></span></div>
    <div><label>WGS84</label><span data-ref="dms"></span></div>
  </section>
  <section class="bottom">
    <div class="card">
      <div class="card-head" data-ref="cardHead"></div>
      <div class="card-title" data-ref="cardTitle"></div>
      <div class="card-body" data-ref="cardBody"></div>
    </div>
    <nav class="transport">
      <button type="button" data-ref="prev" title="Plano anterior (←)">◂</button>
      <button type="button" data-ref="play" title="Play / pausa (espaço)"></button>
      <button type="button" data-ref="next" title="Plano seguinte (→)">▸</button>
      <div class="ticks" data-ref="ticks"></div>
      <button type="button" class="open-settings" data-ref="gear" title="Incêndio e motor (S)">Settings</button>
    </nav>
    <div class="keys">Espaço play/pausa · ← → plano · R recomeça · S settings · H esconde o HUD</div>
  </section>
`

type Refs = Record<
  | 'word' | 'place' | 'coords' | 'mode' | 'time' | 'date' | 'elapsed' | 'area' | 'step'
  | 'hdg' | 'pitch' | 'rng' | 'tm' | 'dms' | 'cardHead' | 'cardTitle' | 'cardBody'
  | 'prev' | 'play' | 'next' | 'ticks' | 'gear',
  HTMLElement
>

export class Hud {
  readonly settings: SettingsPanel
  private readonly refs: Refs
  private fire: Fire | undefined
  private shots: Shot[] = []
  private ticks: HTMLElement[] = []
  private shown = new Map<string, string>()

  constructor(
    private readonly root: HTMLElement,
    fires: FireIndexEntry[],
    private readonly actions: HudActions,
  ) {
    root.classList.add('hud')
    root.innerHTML = TEMPLATE
    this.refs = Object.fromEntries(
      [...root.querySelectorAll<HTMLElement>('[data-ref]')].map((el) => [el.dataset.ref, el]),
    ) as unknown as Refs

    this.settings = new SettingsPanel(root, fires, { pickFire: actions.pickFire })
    this.refs.gear.addEventListener('click', () => this.settings.toggle())
    this.refs.prev.addEventListener('click', () => actions.prev())
    this.refs.next.addEventListener('click', () => actions.next())
    this.refs.play.addEventListener('click', () => actions.toggle())
  }

  setFire(fire: Fire, shots: Shot[]) {
    this.fire = fire
    this.shots = shots
    this.settings.setFire(fire.id)
    this.refs.ticks.replaceChildren()
    this.ticks = shots.map((s, i) => {
      const tick = document.createElement('button')
      tick.type = 'button'
      tick.className = 'tick'
      tick.title = `${pad2(i + 1)} · ${s.word}`
      tick.innerHTML = '<i></i>'
      tick.addEventListener('click', () => this.actions.goTo(i))
      this.refs.ticks.append(tick)
      return tick
    })
  }

  toggleHidden() {
    this.root.classList.toggle('hidden')
  }

  /** Screen left free by the title, clock, rail, caption card and open settings; all of it when the HUD is hidden. */
  safeArea(): SafeArea {
    const { width, height } = this.root.getBoundingClientRect()
    const pad = 12
    if (this.root.classList.contains('hidden')) return { top: pad, bottom: height - pad, left: pad, right: width - pad }
    const rect = (sel: string) => this.root.querySelector(sel)!.getBoundingClientRect()
    const rail = rect('.rail')
    // The rail is hidden on narrow screens and then has no size.
    let right = rail.width ? rail.left - pad : width - pad
    if (this.settings.open) right = Math.min(right, rect('.settings').left - pad)
    return {
      top: Math.max(rect('.title').bottom, rect('.clock').bottom) + pad,
      bottom: rect('.bottom').top - pad,
      left: pad + 8,
      right,
    }
  }

  update(frame: Frame, camera: CameraReadout) {
    const fire = this.fire
    if (!fire) return
    const { shot } = frame
    const n = this.shots.length
    const lastStep = fire.steps.at(-1)!.step
    const clock = wallClock(fire.start, frame.hours)

    this.set('word', shot.word)
    this.set('place', [fire.parish, fire.name].filter(Boolean).join(' · '))
    this.set('coords', formatDMS(shot.place))
    this.set('mode', frame.phase === 'done' ? 'Fim' : frame.playing ? 'Replay' : 'Pausa')
    this.root.classList.toggle('paused', !frame.playing)
    this.set('time', fmtTime(clock))
    this.set('date', `${fmtDate(clock)} · hora local`)
    this.set('elapsed', fmtElapsed(frame.hours))
    this.set('area', fmtHa(frame.areaHa))
    this.set('step', `Passo ${frame.fire.step < 0 ? '–' : frame.fire.step}/${lastStep}`)

    this.set('hdg', `${pad3(Math.round(((camera.heading % 360) + 360) % 360))}° ${compass(camera.heading)}`)
    this.set('pitch', `${Math.round(camera.pitch)}°`.replace('-', '−'))
    this.set('rng', fmtRange(camera.range))
    if (camera.centre) {
      const tm = toPTTM06(camera.centre)
      this.set('tm', `X ${fmtNumber(tm.x)} · Y ${fmtNumber(tm.y)}`.replaceAll('-', '−'))
      this.set('dms', formatDMS(camera.centre))
    }

    this.set('cardHead', `Plano ${pad2(frame.index + 1)}/${pad2(n)} · ${shot.word}`)
    this.set('cardTitle', shot.title)
    this.set('cardBody', shot.caption)
    this.set('play', frame.playing ? '❚❚' : '▶')
    this.ticks.forEach((tick, i) => {
      tick.classList.toggle('past', i < frame.index)
      tick.classList.toggle('now', i === frame.index)
    })
  }

  /** Writes text only when it changed, so the DOM is not touched every frame. */
  private set(ref: keyof Refs, text: string) {
    if (this.shown.get(ref) === text) return
    this.shown.set(ref, text)
    this.refs[ref].textContent = text
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const pad3 = (n: number) => String(n).padStart(3, '0')
