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
import {
  ICON_HAZARD,
  ICON_PROTECAO_CIVIL,
  ICON_PSP,
  ICON_INEM,
  ICON_CLIPBOARD,
} from './icons'
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
  mobilizeAerial?(flameM: number): void
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
        <span class="role-svg">${ICON_PROTECAO_CIVIL}</span> <span class="role-text">Proteção Civil</span>
      </button>
      <button type="button" class="role-btn" data-role="psp" title="Visão Forças de Segurança: Cortes de Via e Trânsito">
        <span class="role-svg">${ICON_PSP}</span> <span class="role-text">PSP / GNR</span>
      </button>
      <button type="button" class="role-btn" data-role="inem" title="Visão Saúde: Posto Médico Avançado e Evacuação Segura">
        <span class="role-svg">${ICON_INEM}</span> <span class="role-text">INEM</span>
      </button>
    </div>
  </nav>
  <section class="panel agency-briefing psp-briefing" data-ref="pspBriefing" hidden>
    <header>
      <div class="agency-badge psp"><span class="badge-svg">${ICON_PSP}</span> PSP / GNR · CORTES DE TRÂNSITO</div>
      <button type="button" class="btn-mini-copy" data-ref="copyPspMini" title="Copiar despacho para WhatsApp/Rádio">${ICON_CLIPBOARD} <span>Copiar</span></button>
    </header>
    <div class="briefing-body" data-ref="pspBriefingBody"></div>
  </section>
  <section class="panel agency-briefing inem-briefing" data-ref="inemBriefing" hidden>
    <header>
      <div class="agency-badge inem"><span class="badge-svg">${ICON_INEM}</span> INEM · POSTO MÉDICO & EVACUAÇÃO</div>
      <button type="button" class="btn-mini-copy" data-ref="copyInemMini" title="Copiar despacho para o CODU">${ICON_CLIPBOARD} <span>Copiar</span></button>
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
    <div><label>Coord</label><span data-ref="coordDMS" style="font-size:8.5px;letter-spacing:0.02em;" title="Coordenadas DMS. Clica para copiar."></span></div>
    <div><label>GPS</label><span data-ref="coordDec" style="font-size:8.5px;letter-spacing:0.02em;" title="Coordenadas decimais GPS. Clica para copiar."></span></div>
  </section>
  <div class="nav-controls">
    <button type="button" class="nav-btn north-btn" data-ref="btnNorth" title="Reorientar mapa para o Norte Geográfico (visão base)">
      <span class="nav-icon" data-ref="compassNeedle">
        <svg class="nav-svg-icon" viewBox="0 0 24 24" width="18" height="18" fill="none">
          <circle cx="12" cy="12" r="10.5" stroke="rgba(148, 163, 184, 0.35)" stroke-width="1.2" fill="none"/>
          <polygon points="12,3.5 15,12 12,10" fill="#f8fafc" />
          <polygon points="12,3.5 9,12 12,10" fill="#94a3b8" />
          <polygon points="12,20.5 15,12 12,10" fill="#475569" />
          <polygon points="12,20.5 9,12 12,10" fill="#334155" />
          <circle cx="12" cy="12" r="1.5" fill="#0f172a" />
        </svg>
      </span>
      <span class="nav-label">Norte</span>
    </button>
    <button type="button" class="nav-btn ignition-btn" data-ref="btnIgnition" title="Centrar câmara no Ponto de Ignição inicial">
      <span class="nav-icon">
        <svg class="nav-svg-icon" viewBox="0 0 24 24" width="18" height="18" fill="none">
          <circle cx="12" cy="12" r="7.5" stroke="#94a3b8" stroke-width="1.3" />
          <circle cx="12" cy="12" r="2" fill="#f8fafc" />
          <line x1="12" y1="2" x2="12" y2="6.5" stroke="#94a3b8" stroke-width="1.4" stroke-linecap="round" />
          <line x1="12" y1="17.5" x2="12" y2="22" stroke="#94a3b8" stroke-width="1.4" stroke-linecap="round" />
          <line x1="2" y1="12" x2="6.5" y2="12" stroke="#94a3b8" stroke-width="1.4" stroke-linecap="round" />
          <line x1="17.5" y1="12" x2="22" y2="12" stroke="#94a3b8" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </span>
      <span class="nav-label">Ignição</span>
    </button>
  </div>

  <div class="bottom-compass" data-ref="bottomCompass" title="Bússola Tática: Aponta para o Norte Geográfico. Clica para reorientar a 0°">
    <div class="compass-dial" data-ref="compassDial">
      <svg class="compass-svg" viewBox="0 0 56 56" width="52" height="52" fill="none">
        <circle cx="28" cy="28" r="25.5" stroke="rgba(241, 245, 249, 0.4)" stroke-width="1.3" fill="none"/>
        <circle cx="28" cy="28" r="21.5" stroke="rgba(148, 163, 184, 0.25)" stroke-width="0.8" fill="none"/>
        <line x1="28" y1="3" x2="28" y2="7.5" stroke="#ffffff" stroke-width="1.8"/>
        <line x1="28" y1="48.5" x2="28" y2="53" stroke="rgba(148, 163, 184, 0.6)" stroke-width="1.2"/>
        <line x1="3" y1="28" x2="7.5" y2="28" stroke="rgba(148, 163, 184, 0.6)" stroke-width="1.2"/>
        <line x1="48.5" y1="28" x2="53" y2="28" stroke="rgba(148, 163, 184, 0.6)" stroke-width="1.2"/>
        <text x="28" y="14.5" font-size="8.5" font-weight="800" font-family="ui-monospace, monospace" fill="#ffffff" text-anchor="middle">N</text>
        <text x="28" y="47" font-size="7" font-weight="600" font-family="ui-monospace, monospace" fill="#64748b" text-anchor="middle">S</text>
        <text x="44.5" y="30.5" font-size="7" font-weight="600" font-family="ui-monospace, monospace" fill="#64748b" text-anchor="middle">E</text>
        <text x="11.5" y="30.5" font-size="7" font-weight="600" font-family="ui-monospace, monospace" fill="#64748b" text-anchor="middle">W</text>
        <polygon points="28,15.5 31.5,28 28,26" fill="#f8fafc"/>
        <polygon points="28,15.5 24.5,28 28,26" fill="#cbd5e1"/>
        <polygon points="28,40.5 31.5,28 28,26" fill="#475569"/>
        <polygon points="28,40.5 24.5,28 28,26" fill="#334155"/>
        <circle cx="28" cy="28" r="2.5" fill="#0f172a" stroke="#f8fafc" stroke-width="1"/>
      </svg>
    </div>
  </div>
  <div class="hud-alert-container" data-ref="alertContainer" hidden>
    <button type="button" class="hud-alert-badge" data-ref="alertBadge" title="Alerta Tático: Clica para ver recomendação de Meios Aéreos">
      <span class="hazard-icon" data-ref="alertIcon">${ICON_HAZARD}</span>
    </button>
    <div class="hud-alert-popover" data-ref="alertPopover" hidden>
      <header>
        <span class="popover-title" data-ref="popoverTitle"><span class="title-svg">${ICON_HAZARD}</span> RECOMENDAÇÃO TÁTICA</span>
        <button type="button" class="btn-close-popover" data-ref="closeAlertPopover" title="Fechar">✕</button>
      </header>
      <div class="popover-stat" data-ref="popoverStat">Chama: -- m · Intensidade: -- kW/m</div>
      <p class="popover-desc" data-ref="popoverDesc">Chama estimada excede a capacidade de combate frontal terrestre (>2.4 m). Recomendado empenhamento imediato de Meios Aéreos.</p>
      <button type="button" class="popover-dispatch-btn" data-ref="alertDispatchBtn">Mobilizar Meios Aéreos</button>
    </div>
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
  | 'hdg' | 'pitch' | 'rng' | 'coordDMS' | 'coordDec' | 'cardHead' | 'cardTitle' | 'cardBody'
  | 'prev' | 'play' | 'next' | 'ticks' | 'gear'
  | 'pspBriefing' | 'copyPspMini' | 'pspBriefingBody' | 'inemBriefing' | 'copyInemMini' | 'inemBriefingBody'
  | 'btnNorth' | 'compassNeedle' | 'btnIgnition' | 'bottomCompass' | 'compassDial'
  | 'alertContainer' | 'alertBadge' | 'alertIcon' | 'alertPopover'
  | 'popoverTitle' | 'closeAlertPopover' | 'popoverStat' | 'popoverDesc' | 'alertDispatchBtn',
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

  currentRole: AgencyRole = 'cmd'
  private lastDispatch?: MultiAgencyDispatch
  private currentFlameM = 0
  private isAlertPopoverOpen = false
  private lastAlertEmergency: boolean | undefined = undefined
  private lastCoordsFull = ''
  private lastCoordsDMS = ''
  private lastCoordsDec = ''
  private cursorCoords: (LonLat & { h?: number }) | undefined = undefined

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
    this.refs.bottomCompass?.addEventListener('click', () => this.actions.resetNorth?.())
    this.refs.btnIgnition?.addEventListener('click', () => this.actions.flyToIgnition?.())

    this.refs.alertBadge?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.isAlertPopoverOpen = !this.isAlertPopoverOpen
      this.refs.alertPopover.hidden = !this.isAlertPopoverOpen
    })
    this.refs.closeAlertPopover?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.isAlertPopoverOpen = false
      this.refs.alertPopover.hidden = true
    })
    this.refs.alertDispatchBtn?.addEventListener('click', () => {
      this.isAlertPopoverOpen = false
      this.refs.alertPopover.hidden = true
      this.actions.mobilizeAerial?.(this.currentFlameM)
    })

    document.addEventListener('click', (e) => {
      if (this.refs.alertPopover && !this.refs.alertPopover.hidden) {
        if (!this.refs.alertContainer?.contains(e.target as Node)) {
          this.isAlertPopoverOpen = false
          this.refs.alertPopover.hidden = true
        }
      }
    })

    const copyText = (val: string) => {
      if (!val) return
      const cleanVal = val.trim()
      const finishToast = () => this.toast(`Coordenadas ${cleanVal} copiadas!`)
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cleanVal).then(finishToast).catch(() => {
          const ta = document.createElement('textarea')
          ta.value = cleanVal
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          ta.remove()
          finishToast()
        })
      } else {
        const ta = document.createElement('textarea')
        ta.value = cleanVal
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
        finishToast()
      }
    }
    this.refs.coords?.addEventListener('click', () => copyText(this.lastCoordsFull || this.refs.coords.textContent || ''))
    this.refs.coordDMS?.addEventListener('click', () => copyText(this.lastCoordsDMS))
    this.refs.coordDec?.addEventListener('click', () => copyText(this.lastCoordsDec))
  }

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

    if (this.refs.alertPopover) this.refs.alertPopover.hidden = true
    this.updateTacticalAlert(0)
  }

  private updateTacticalAlert(hours: number) {
    if (!this.sim || !this.refs.alertContainer) return
    const peakIntensity = this.sim.intensityKWPerM
    // Ramp up from initial attack intensity (~15% at t=0) to full peak intensity as fire develops
    const scale = Math.min(1.0, 0.15 + 0.85 * Math.min(Math.max(hours, 0) / 1.5, 1.0))
    const currentIntensity = peakIntensity * scale
    const flame = 0.0775 * Math.pow(Math.max(currentIntensity, 0), 0.46)
    this.currentFlameM = flame

    if (flame >= 2.4) {
      this.refs.alertContainer.hidden = false
      const emergency = flame >= 3.4

      if (this.lastAlertEmergency !== emergency) {
        this.lastAlertEmergency = emergency
        this.refs.alertContainer.classList.toggle('emergency', emergency)
        this.refs.alertBadge.classList.toggle('emergency', emergency)
        this.refs.alertBadge.classList.add('pulsing')
        this.refs.alertBadge.title = emergency
          ? `Alerta Crítico: Chama estimada em ${flame.toFixed(1)}m (Extremo) · Clica para ver recomendação`
          : `Apoio Aéreo Recomendado: Chama frontal de ${flame.toFixed(1)}m · Clica para ver recomendação`

        this.refs.popoverTitle.innerHTML = `<span class="title-svg">${ICON_HAZARD}</span> ${
          emergency ? 'ALERTA DE EMERGÊNCIA · COMPORTAMENTO EXTREMO' : 'RECOMENDAÇÃO TÁTICA · MEIOS AÉREOS'
        }`
        this.refs.popoverDesc.textContent = emergency
          ? `Chama extrema (${flame.toFixed(1)} m) com alta intensidade (>3500 kW/m). Ataque direto frontal proibido por risco de projeções e overrun. Obrigatório empenhamento de Meios Aéreos Pesados (AVBP) e reforços massivos para proteção de aglomerados.`
          : `Chama frontal de ${flame.toFixed(1)} m excede a capacidade de ataque frontal terrestre (>2.4 m). Recomendado empenhamento imediato de Meios Aéreos (HEBL/AVBP) e consolidação nos flancos.`
        this.refs.alertDispatchBtn.textContent = emergency
          ? 'Mobilizar Avião Anfíbio Pesado (AVBP)'
          : 'Mobilizar Helicóptero Bombardeiro (HEBL)'
      }

      this.refs.popoverStat.textContent = `Chama: ${flame.toFixed(1)} m · Intensidade: ${Math.round(currentIntensity)} kW/m`
    } else {
      this.lastAlertEmergency = undefined
      this.refs.alertContainer.hidden = true
      this.refs.alertPopover.hidden = true
      this.isAlertPopoverOpen = false
    }
  }

  /** Live mouse cursor coordinates over terrain. */
  updateCursorCoords(coords: (LonLat & { h?: number }) | undefined) {
    this.cursorCoords = coords
    if (coords) {
      const dms = formatDMS(coords)
      const dec = `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`
      const alt = coords.h !== undefined ? ` · ${Math.round(coords.h)}m` : ''
      this.lastCoordsDMS = dms
      this.lastCoordsDec = dec
      this.lastCoordsFull = `${dms} (${dec})`
      this.set('coords', `📍 ${dms} (${dec}${alt})`)
      this.set('coordDMS', dms)
      this.set('coordDec', dec)
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

    if (!this.cursorCoords) {
      const pos = camera.centre ?? shot.place
      const dms = formatDMS(pos)
      const dec = `${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}`
      const alt = (pos as any).h !== undefined ? ` · ${Math.round((pos as any).h)}m` : ''
      this.lastCoordsDMS = dms
      this.lastCoordsDec = dec
      this.lastCoordsFull = `${dms} (${dec})`
      this.set('coords', `📍 ${dms} (${dec}${alt})`)
      this.set('coordDMS', dms)
      this.set('coordDec', dec)
    }

    this.set('mode', frame.phase === 'done' ? 'Fim' : frame.playing ? (this.director ? 'Realizador' : 'Replay') : 'Pausa')
    this.updateTacticalAlert(frame.hours)
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
    if (this.refs.compassDial) {
      this.refs.compassDial.style.transform = `rotate(${-camera.heading}deg)`
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
