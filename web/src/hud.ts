// The gray "intel" HUD: shot word and place, fire clock, camera readout, caption card with
// the transport bar (bottom left) and the settings drawer (fire and engine).
// Data credits are not here but in Cesium's credit line, so they stay on screen when the HUD is hidden.

import type { Fire, FireIndexEntry } from './data'
import { fmtDate, fmtElapsed, fmtHa, fmtNumber, fmtPct, fmtRange, fmtTime, wallClock } from './format'
import { compass, formatDMS, type LonLat } from './geo'
import { Ledger, type Known } from './ledger'
import type { SafeArea } from './markers'
import type { Frame } from './player'
import { SettingsPanel } from './settings'
import type { Shot } from './shots'
import type { AgencyRole, MultiAgencyDispatch } from './reporting'
import './hud.css'

export interface HudActions {
  toggle(): void
  prev(): void
  next(): void
  goTo(i: number): void
  pickFire(id: string): void
  roleChanged?(role: AgencyRole): void
  resetNorth?(): void
  flyToIgnition?(): void
  openEditor?(): void
}

/** The free run of the fast model behind the simulated shots, as the HUD reads it. */
export interface Simulated {
  known: Known
  areaHa(hours: number): number
  poc(areaHa: number): number
  intensityKWPerM: number
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
  <nav class="role-selector">
    <div class="role-pill">
      <button type="button" class="role-btn active" data-role="cmd" title="Visão de Comando Completo (Proteção Civil & Bombeiros)">
        <span>🛡️</span> <span>Proteção Civil</span>
      </button>
      <button type="button" class="role-btn" data-role="psp" title="Visão Forças de Segurança: Cortes de Via e Trânsito">
        <span>👮</span> <span>PSP / GNR</span>
      </button>
      <button type="button" class="role-btn" data-role="inem" title="Visão Saúde: Posto Médico Avançado e Evacuação Segura">
        <span>🚑</span> <span>INEM</span>
      </button>
    </div>
  </nav>
  <section class="panel agency-briefing psp-briefing" data-ref="pspBriefing" hidden>
    <header>
      <div class="agency-badge psp">👮 PSP / GNR · CORTES DE TRÂNSITO</div>
      <button type="button" class="btn-mini-copy" data-ref="copyPspMini" title="Copiar despacho para WhatsApp/Rádio">📋 Copiar</button>
    </header>
    <div class="briefing-body" data-ref="pspBriefingBody"></div>
  </section>
  <section class="panel agency-briefing inem-briefing" data-ref="inemBriefing" hidden>
    <header>
      <div class="agency-badge inem">🚑 INEM · POSTO MÉDICO & EVACUAÇÃO</div>
      <button type="button" class="btn-mini-copy" data-ref="copyInemMini" title="Copiar despacho para o CODU">📋 Copiar</button>
    </header>
    <div class="briefing-body" data-ref="inemBriefingBody"></div>
  </section>
  <section class="panel clock">
    <div class="live"><i></i><span data-ref="mode">Replay</span> · <span data-ref="source">observado</span></div>
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
  <div class="nav-controls">
    <button type="button" class="nav-btn north-btn" data-ref="btnNorth" title="Reorientar mapa para o Norte Geográfico (visão base)">
      <span class="nav-icon" data-ref="compassNeedle">▲</span>
      <span class="nav-label">Norte</span>
    </button>
    <button type="button" class="nav-btn ignition-btn" data-ref="btnIgnition" title="Centrar câmara no Ponto de Ignição inicial">
      <span class="nav-icon">📍</span>
      <span class="nav-label">Ignição</span>
    </button>
  </div>
  <div class="hud-tactical-alert" data-ref="tacticalAlert" hidden>
    <span class="alert-icon">⚠️</span>
    <span class="alert-text" data-ref="tacticalAlertText"></span>
    <button type="button" class="alert-action-btn" data-ref="tacticalAlertAction">Mobilizar Meios</button>
  </div>
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
    <div class="keys">Espaço play/pausa · ← → plano · R recomeça · D realizador · A decisões A/B · E editor · L dados · S settings · H esconde o HUD</div>
  </section>
`

type Refs = Record<
  | 'word' | 'place' | 'coords' | 'mode' | 'source' | 'time' | 'date' | 'elapsed' | 'area' | 'step'
  | 'hdg' | 'pitch' | 'rng' | 'cardHead' | 'cardTitle' | 'cardBody'
  | 'prev' | 'play' | 'next' | 'ticks' | 'gear'
  | 'pspBriefing' | 'copyPspMini' | 'pspBriefingBody' | 'inemBriefing' | 'copyInemMini' | 'inemBriefingBody'
  | 'btnNorth' | 'compassNeedle' | 'btnIgnition'
  | 'tacticalAlert' | 'tacticalAlertText' | 'tacticalAlertAction',
  HTMLElement
>

export class Hud {
  readonly settings: SettingsPanel
  private readonly refs: Refs
  private readonly ledger: Ledger
  private fire: Fire | undefined
  private sim: Simulated | undefined
  private shots: Shot[] = []
  private ticks: HTMLElement[] = []
  private shown = new Map<string, string>()
  private director = false

  constructor(
    readonly root: HTMLElement,
    fires: FireIndexEntry[],
    private readonly actions: HudActions,
  ) {
    root.classList.add('hud')
    root.innerHTML = TEMPLATE
    this.refs = Object.fromEntries(
      [...root.querySelectorAll<HTMLElement>('[data-ref]')].map((el) => [el.dataset.ref, el]),
    ) as unknown as Refs

    this.ledger = new Ledger(root)
    this.settings = new SettingsPanel(root, fires, { pickFire: actions.pickFire })
    this.refs.gear.addEventListener('click', () => this.settings.toggle())
    this.refs.prev.addEventListener('click', () => actions.prev())
    this.refs.next.addEventListener('click', () => actions.next())
    this.refs.play.addEventListener('click', () => actions.toggle())

    root.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const role = btn.dataset.role as AgencyRole
        this.setRole(role)
        this.actions.roleChanged?.(role)
      })
    })

    this.refs.copyPspMini?.addEventListener('click', () => {
      if (this.lastDispatch) {
        navigator.clipboard.writeText(this.lastDispatch.psp.message).then(() => this.toast('📋 Despacho PSP copiado!'))
      }
    })
    this.refs.copyInemMini?.addEventListener('click', () => {
      if (this.lastDispatch) {
        navigator.clipboard.writeText(this.lastDispatch.inem.message).then(() => this.toast('📋 Despacho INEM copiado!'))
      }
    })

    this.refs.btnNorth?.addEventListener('click', () => this.actions.resetNorth?.())
    this.refs.btnIgnition?.addEventListener('click', () => this.actions.flyToIgnition?.())
    this.refs.tacticalAlertAction?.addEventListener('click', () => this.actions.openEditor?.())
  }

  currentRole: AgencyRole = 'cmd'
  private lastDispatch?: MultiAgencyDispatch

  setRole(role: AgencyRole) {
    this.currentRole = role
    this.root.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.role === role)
    })
    this.root.classList.toggle('role-psp', role === 'psp')
    this.root.classList.toggle('role-inem', role === 'inem')
    this.root.classList.toggle('role-cmd', role === 'cmd')
    if (this.refs.pspBriefing) this.refs.pspBriefing.hidden = role !== 'psp'
    if (this.refs.inemBriefing) this.refs.inemBriefing.hidden = role !== 'inem'
  }

  updateBriefings(dispatch: MultiAgencyDispatch) {
    this.lastDispatch = dispatch
    if (this.refs.pspBriefingBody) {
      const roads = dispatch.psp.roads
      this.refs.pspBriefingBody.innerHTML = roads.length
        ? roads.slice(0, 4).map((r) => `
          <div class="briefing-item ${r.urgency}">
            <div style="font-weight:600;color:#fff;">⛔ Cortar: ${r.label}</div>
            <div style="color:${r.urgency === 'cortado' ? '#ff6b6b' : '#f0a33a'};font-size:9px;">
              ${r.minutesToImpact <= 0 ? 'Fogo ativo na via' : `Impacto previsto em ~${r.minutesToImpact} min`}
            </div>
          </div>
        `).join('')
        : '<div class="briefing-item">Nenhuma via ameaçada neste momento.</div>'
    }
    if (this.refs.inemBriefingBody) {
      const pma = dispatch.inem.pmaList[0]
      this.refs.inemBriefingBody.innerHTML = pma
        ? `
          <div class="briefing-item">
            <div style="font-weight:600;color:#4ade80;">🏥 ${pma.name}</div>
            <div style="font-size:9px;color:#8b9096;">Margem: ${pma.safeBufferMin > 180 ? '> 3 horas' : `${pma.safeBufferMin} min`}</div>
            ${pma.routeKm ? `<div style="font-size:9px;color:#60a5fa;">Corredor: ${pma.hospitalDestination} (${pma.routeKm.toFixed(1)} km)</div>` : ''}
          </div>
          <div class="briefing-item" style="color:#ff6b6b;font-size:9px;">
            ⚠️ ${dispatch.inem.blockedRoads.length} vias interditas a ambulâncias
          </div>
        `
        : '<div class="briefing-item">PMA não ativado. Clica em "+ Ponto Socorro" na Proteção Civil.</div>'
    }
  }

  private toast(msg: string) {
    const toast = document.createElement('div')
    toast.className = 'dispatch-toast'
    toast.textContent = msg
    document.body.appendChild(toast)
    setTimeout(() => {
      toast.style.opacity = '0'
      toast.style.transition = 'opacity 0.3s'
      setTimeout(() => toast.remove(), 300)
    }, 2000)
  }

  setFire(fire: Fire, shots: Shot[], sim: Simulated | undefined) {
    this.fire = fire
    this.sim = sim
    this.ledger.el.hidden = !sim
    if (sim) this.ledger.set(sim.known)
    this.settings.setFire(fire.id)
    this.setShots(shots)

    if (sim && this.refs.tacticalAlert && this.refs.tacticalAlertText) {
      const flame = 0.0775 * Math.pow(Math.max(sim.intensityKWPerM, 0), 0.46)
      if (flame >= 3.4) {
        this.refs.tacticalAlert.hidden = false
        this.refs.tacticalAlert.classList.add('emergency')
        this.refs.tacticalAlertText.textContent = `🚨 ALERTA CRÍTICO: Chama de ${flame.toFixed(1)}m excede combate direto. Meios Aéreos urgentes!`
      } else if (flame >= 2.4) {
        this.refs.tacticalAlert.hidden = false
        this.refs.tacticalAlert.classList.remove('emergency')
        this.refs.tacticalAlertText.textContent = `⚠️ ALERTA TÁTICO: Chama de ${flame.toFixed(1)}m frontal — Recomendado envio de Meios Aéreos (HEBL/AVBP).`
      } else {
        this.refs.tacticalAlert.hidden = true
      }
    } else if (this.refs.tacticalAlert) {
      this.refs.tacticalAlert.hidden = true
    }
  }

  /** The director's cut is on: the HUD says so instead of "Replay". */
  setDirector(on: boolean) {
    this.director = on
    this.root.classList.toggle('director', on)
  }

  /** The shots changed (the director's were built, or the cut toggled): the transport's ticks follow. */
  setShots(shots: Shot[]) {
    this.shots = shots
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

  /** Folds or opens the ledger of the instant (key L). */
  toggleLedger() {
    this.ledger.toggle()
  }

  /** The decision editor is open on the left: the title and the ledger give it the room. */
  setEditing(on: boolean) {
    this.root.classList.toggle('editing', on)
  }

  /** Screen left free by the title, clock, rail, caption card and open settings; all of it when the HUD is hidden. */
  safeArea(): SafeArea {
    const { width, height } = this.root.getBoundingClientRect()
    const pad = 12
    if (this.root.classList.contains('hidden')) return { top: pad, bottom: height - pad, left: pad, right: width - pad, avoid: [] }
    const rect = (sel: string) => this.root.querySelector(sel)!.getBoundingClientRect()
    const rail = rect('.rail')
    const ledger = rect('.ledger')
    // The rail and the ledger are hidden on narrow screens and then have no size.
    let right = rail.width ? rail.left - pad : width - pad
    if (this.settings.open) right = Math.min(right, rect('.settings').left - pad)
    const editing = this.root.classList.contains('editing')
    return {
      top: Math.max(editing ? 0 : rect('.title').bottom, rect('.clock').bottom) + pad,
      bottom: rect('.bottom').top - pad,
      avoid: ledger.height ? [ledger] : [],
      left: editing ? rect('.editor').right + pad : pad + 8,
      right,
    }
  }

  /** `split` says the decisions A and B are on the screen, in their own shots or through every shot (key A). */
  update(frame: Frame, camera: CameraReadout, split = false) {
    const fire = this.fire
    if (!fire) return
    const { shot } = frame
    const n = this.shots.length
    const lastStep = fire.steps.at(-1)!.step
    const clock = wallClock(fire.start, frame.hours)
    // Simulated shots read the free run at the clock, so the area grows with the fire and not linearly.
    const sim = shot.simulated || split ? this.sim : undefined
    const areaHa = sim ? sim.areaHa(frame.hours) : frame.areaHa

    this.set('word', shot.word)
    this.set('place', [fire.parish, fire.name].filter(Boolean).join(' · '))
    this.set('coords', formatDMS(shot.place))
    this.set('mode', frame.phase === 'done' ? 'Fim' : frame.playing ? (this.director ? 'Realizador' : 'Replay') : 'Pausa')
    this.set('source', sim ? (split ? 'decisões' : 'simulado') : 'observado')
    this.root.classList.toggle('paused', !frame.playing)
    this.root.classList.toggle('simulated', !!sim)
    this.set('time', fmtTime(clock))
    this.set('date', `${fmtDate(clock)} · hora local`)
    this.set('elapsed', fmtElapsed(frame.hours))
    this.set('area', shot.area ? shot.area(frame.hours) : fmtHa(areaHa))
    this.set(
      'step',
      sim
        ? split
          ? `Livre ${fmtHa(sim.areaHa(frame.hours))}`
          : `POC ${fmtPct(sim.poc(areaHa))} · I ${fmtNumber(sim.intensityKWPerM)} kW/m`
        : `Passo ${frame.fire.step < 0 ? '–' : frame.fire.step}/${lastStep}`,
    )
    this.ledger.update(frame.hours)

    this.set('hdg', `${pad3(Math.round(((camera.heading % 360) + 360) % 360))}° ${compass(camera.heading)}`)
    this.set('pitch', `${Math.round(camera.pitch)}°`.replace('-', '−'))
    this.set('rng', fmtRange(camera.range))

    if (this.refs.compassNeedle) {
      this.refs.compassNeedle.style.transform = `rotate(${-camera.heading}deg)`
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
