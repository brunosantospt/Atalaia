// The decision editor: a drawer on the left where A and B are composed on the map. A unit
// is picked in the palette, then a click puts it on the nearest road (a point of attack), or
// clicks draw a crew line or an aerial water line. Each assignment shows when it gets there
// and what it can do; the lines show how much of them is built before the fire arrives.
// Decisions are kept per fire in this browser; the 6 h report compares Livre, A and B.

import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  CustomDataSource,
  HeightReference,
  Math as CesiumMath,
  PolylineDashMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Viewer,
} from 'cesium'
import type { Fire, NearStation } from './data'
import { lineSchedule, type Run, type Scenario } from './fastModel'
import { cellOf } from './grid'
import { fmtElapsed, fmtHa, fmtKm, fmtNumber, fmtTime, wallClock } from './format'
import { distanceM, lerpLonLat, type LonLat } from './geo'
import { snapToRoad, type Context } from './osm'
import type { Inventory } from './inventory'
import { describeVerdict, makeReport, recommend, type Report } from './report'
import { findSafeRoute } from './routing'
import {
  DEFAULT_HOSPITAL,
  buildMultiAgencyDispatch,
  detectThreatenedRoads,
  evaluateMedicalPointSafety,
  type AgencyRole,
  type MedicalPointItem,
  type MultiAgencyDispatch,
  type RoadCutItem,
} from './reporting'
import { DispatchModal } from './dispatchModal'
import {
  aerialFrontM,
  arrivalMin,
  attackMPerH,
  dropCycleMin,
  dutyCycle,
  isAerial,
  refillMin,
  workMin,
  type Assignment,
  type Decision,
  type Suppression,
  type Task,
  type UnitId,
} from './suppression'
import './editor.css'

type Tool = 'point' | 'line' | 'drops' | 'pma'
export type Runs = Record<'free' | 'A' | 'B', Run>
export type Reports = Record<'free' | 'A' | 'B', Report>

export interface EditorActions {
  /** The decisions changed: simulate them again and show them. */
  changed(): void
  /** The drawer opened or closed. */
  editing(open: boolean): void
}

const STORAGE_PREFIX = 'atalaia.decisions.'
const SNAP_M = 400 // a click further than this from any road stays where it is
const ACCESS_SHOWN_M = 2500 // access dots are shown this far from the ignition while a point tool is on
const TASK_NAME: Record<Task, string> = {
  direct: 'ataque direto',
  line: 'linha',
  drops: 'descargas',
  protect: 'proteção',
  shuttle: 'abastecimento',
}
const AMBER = Color.fromCssColorString('#f0a33a')
const INK = Color.fromCssColorString('#d9dcdf')
const DIM = Color.fromCssColorString('#8b9096')

const TEMPLATE = `
  <header>
    <span>Decisões · editor</span>
    <button type="button" data-ref="close" title="Fechar (E)">×</button>
  </header>
  <div class="tabs" data-ref="tabs">
    <button type="button" data-tab="0"><b>A</b><span></span></button>
    <button type="button" data-tab="1"><b>B</b><span></span></button>
  </div>
  <input class="name" data-ref="name" maxlength="40" spellcheck="false" title="Nome da decisão">
  <section class="hour">
    <h3>Hora <span data-ref="hourText"></span></h3>
    <input type="range" data-ref="hour" min="0" max="360" step="5" value="360" title="Hora da simulação (o mapa e o relatório seguem-na)">
  </section>
  <section>
    <h3>Meios no terreno</h3>
    <ul class="assignments" data-ref="list"></ul>
  </section>
  <section>
    <h3>Adicionar</h3>
    <div class="palette">
      <select data-ref="from" title="Quartel de origem"></select>
      <select data-ref="unit" title="Meio"></select>
      <div class="count">
        <button type="button" data-ref="less" title="Menos">−</button>
        <span data-ref="count">1</span>
        <button type="button" data-ref="more" title="Mais">+</button>
      </div>
      <select data-ref="task" title="Tarefa num ponto">
        <option value="direct">ataque direto</option>
        <option value="protect">proteção</option>
        <option value="shuttle">abastecimento</option>
      </select>
    </div>
    <p class="note stock" data-ref="stock"></p>
    <p class="note" data-ref="capacity"></p>
    <div class="tools">
      <button type="button" data-ref="quickAdd" class="primary-btn" title="Posiciona este meio automaticamente no acesso seguro mais próximo da frente de fogo">+ Colocar Meio</button>
      <button type="button" data-tool="point" title="Ativa a mira para clicares manualmente no mapa 3D">Clicar no mapa</button>
      <button type="button" data-tool="line" title="Desenha uma linha apeada no mapa">Linha apeada</button>
      <button type="button" data-tool="drops" title="Desenha linha de água para descargas aéreas">Linha aérea</button>
    </div>
    <p class="note hint" data-ref="hint"></p>
  </section>
  <section>
    <h3>Relatório <span data-ref="reportAt"></span></h3>
    <table class="report" data-ref="report"></table>
    <p class="note verdict" data-ref="verdict"></p>
    <p class="note" data-ref="detail"></p>
    <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(220,224,228,0.15);display:flex;flex-direction:column;gap:6px;">
      <button type="button" data-ref="openDispatch" class="primary-btn" style="background:#2563eb;border-color:#3b82f6;width:100%;" title="Gerar e enviar despachos às forças no terreno">📢 Reportar às Entidades (PSP/INEM)</button>
      <button type="button" data-ref="addPma" style="background:#059669;border-color:#10b981;color:#fff;width:100%;padding:6px;" title="Colocar Posto Médico Avançado (PMA)">➕ Ponto Socorro (PMA)</button>
    </div>
  </section>
  <footer>
    <button type="button" data-ref="clear">Limpar esta decisão</button>
    <button type="button" data-ref="reset">Repor exemplos</button>
  </footer>
`

const BARRICADE_CANVASES = new Map<string, HTMLCanvasElement>()

function getBarricadeCanvas(urgency: 'cortado' | 'urgente' | 'preventivo'): HTMLCanvasElement {
  const cached = BARRICADE_CANVASES.get(urgency)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = 72
  canvas.height = 72
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const color =
    urgency === 'cortado'
      ? '#dc2626'
      : urgency === 'urgente'
        ? '#ea580c'
        : '#d97706'

  // Shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 3

  // Legs / A-frame (Dark metal)
  ctx.strokeStyle = '#1e293b'
  ctx.lineWidth = 4.5
  ctx.lineCap = 'round'

  // Left leg
  ctx.beginPath()
  ctx.moveTo(14, 66)
  ctx.lineTo(26, 30)
  ctx.stroke()

  // Right leg
  ctx.beginPath()
  ctx.moveTo(58, 66)
  ctx.lineTo(46, 30)
  ctx.stroke()

  // Cross brace
  ctx.lineWidth = 3
  ctx.strokeStyle = '#334155'
  ctx.beginPath()
  ctx.moveTo(17, 54)
  ctx.lineTo(55, 54)
  ctx.stroke()

  // Barricade Beam (horizontal bar with diagonal hazard stripes)
  ctx.shadowBlur = 5
  ctx.shadowOffsetY = 2
  const bx = 4, by = 28, bw = 64, bh = 20, r = 4

  ctx.save()
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(bx, by, bw, bh, r)
  } else {
    ctx.rect(bx, by, bw, bh)
  }
  ctx.clip()

  // White base
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(bx, by, bw, bh)

  // Diagonal warning stripes
  ctx.fillStyle = color
  const stripeW = 14
  for (let x = bx - 28; x < bx + bw + 28; x += stripeW * 2) {
    ctx.beginPath()
    ctx.moveTo(x, by + bh)
    ctx.lineTo(x + stripeW, by + bh)
    ctx.lineTo(x + stripeW + bh, by)
    ctx.lineTo(x + bh, by)
    ctx.closePath()
    ctx.fill()
  }

  // Beam outline
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 2
  ctx.strokeRect(bx, by, bw, bh)
  ctx.restore()

  // Top Warning Badge: Red/Amber circular "No Entry" / "Trânsito Proibido" sign ⛔
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 2
  ctx.beginPath()
  ctx.arc(36, 15, 13, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 2.5
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()

  // White horizontal minus bar inside the circle (International No Entry sign ⛔)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(26, 12.5, 20, 5, 2)
  } else {
    ctx.rect(26, 12.5, 20, 5)
  }
  ctx.fill()

  BARRICADE_CANVASES.set(urgency, canvas)
  return canvas
}

interface Loaded {
  fireId: string
  fire: Fire
  stations: NearStation[]
  context: Context | undefined
  scenario: Scenario
  examples: [Decision, Decision]
}

export class Editor {
  readonly el: HTMLElement
  decisions: [Decision, Decision] = [empty('A'), empty('B')]
  private active = 0
  private tool: Tool | null = null
  private drawing: LonLat[] = []
  private unit: UnitId = 'vfci'
  private count = 1
  private task: Task = 'direct'
  private fromId = 'none' // station id of the next assignment ('air' for aerial units)
  /** Minute of the simulation the drawer shows: the split and the report follow it. */
  private minutes = 360
  private loaded: Loaded | undefined
  private runs: Runs | undefined
  private reports: Reports | undefined
  private readonly source = new CustomDataSource('decisions')
  private readonly access = new CustomDataSource('access')
  private readonly routes = new CustomDataSource('routes')
  private readonly hazards = new CustomDataSource('hazards')
  private readonly agency = new CustomDataSource('agency')
  private dangerTimer?: number
  private readonly dispatchModal = new DispatchModal()
  pmaList: MedicalPointItem[] = []
  role: AgencyRole = 'cmd'
  private cutTooltip: HTMLElement | null = null
  private readonly handler: ScreenSpaceEventHandler
  private readonly refs: Record<string, HTMLElement>

  constructor(
    private readonly viewer: Viewer,
    private readonly root: HTMLElement,
    private readonly sup: Suppression,
    private readonly inventory: Inventory | null,
    private readonly actions: EditorActions,
  ) {
    this.el = document.createElement('aside')
    this.el.className = 'editor'
    this.el.setAttribute('aria-label', 'Editor de decisões')
    this.el.innerHTML = TEMPLATE
    this.root.append(this.el)
    this.refs = Object.fromEntries(
      [...this.el.querySelectorAll<HTMLElement>('[data-ref]')].map((el) => [el.dataset.ref, el]),
    )
    void viewer.dataSources.add(this.source)
    void viewer.dataSources.add(this.access)
    void viewer.dataSources.add(this.routes)
    void viewer.dataSources.add(this.hazards)
    void viewer.dataSources.add(this.agency)
    this.handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    this.handler.setInputAction((e: { position: Cartesian2 }) => this.click(e.position), ScreenSpaceEventType.LEFT_CLICK)
    this.handler.setInputAction((e: { endPosition: Cartesian2 }) => this.hover(e.endPosition), ScreenSpaceEventType.MOUSE_MOVE)

    const unit = this.refs.unit as HTMLSelectElement
    for (const [id, spec] of Object.entries(sup.units)) {
      const option = document.createElement('option')
      option.value = id
      option.textContent = `${spec.short} · ${spec.name}`
      unit.append(option)
    }
    unit.value = this.unit
    unit.addEventListener('change', () => {
      this.unit = unit.value as UnitId
      this.updateStationDropdown()
      this.setCount(this.count)
    })
    const from = this.refs.from as HTMLSelectElement
    from.addEventListener('change', () => {
      this.fromId = from.value
      this.setCount(this.count)
    })
    const hour = this.refs.hour as HTMLInputElement
    hour.addEventListener('input', () => this.setMinutes(Number(hour.value)))
    const task = this.refs.task as HTMLSelectElement
    task.addEventListener('change', () => (this.task = task.value as Task))
    this.refs.less.addEventListener('click', () => this.setCount(this.count - 1))
    this.refs.more.addEventListener('click', () => this.setCount(this.count + 1))
    this.refs.quickAdd?.addEventListener('click', () => this.quickAdd())
    this.refs.close.addEventListener('click', () => this.toggle(false))
    this.refs.openDispatch?.addEventListener('click', () => this.openDispatchDialog())
    this.refs.addPma?.addEventListener('click', () => this.togglePmaTool())
    this.refs.clear.addEventListener('click', () => {
      const d = this.decisions[this.active]
      this.decisions[this.active] = { ...empty(d.id), name: d.name }
      this.commit()
    })
    this.refs.reset.addEventListener('click', () => {
      if (!this.loaded) return
      this.decisions = this.loaded.examples.map(clone) as [Decision, Decision]
      this.commit()
    })
    const name = this.refs.name as HTMLInputElement
    name.addEventListener('change', () => {
      this.decisions[this.active].name = name.value.trim() || this.decisions[this.active].id
      this.commit()
    })
    for (const tab of this.refs.tabs.querySelectorAll<HTMLElement>('[data-tab]'))
      tab.addEventListener('click', () => {
        this.active = Number(tab.dataset.tab)
        this.cancel()
        this.render()
      })
    for (const button of this.el.querySelectorAll<HTMLElement>('[data-tool]'))
      button.addEventListener('click', () => this.setTool(this.tool === button.dataset.tool ? null : (button.dataset.tool as Tool)))
    this.renderPalette()
    this.toggle(false)
  }

  get open(): boolean {
    return this.el.classList.contains('open')
  }

  /** The director shows decision `i` on the ground: it becomes the drawer's tab too. */
  showDecision(i: number) {
    if (i === this.active) return
    this.active = i
    this.cancel()
    this.render()
  }

  /** Hours after the ignition the drawer stands at. */
  get hours(): number {
    return this.minutes / 60
  }

  setHours(hours: number) {
    const max = this.loaded?.scenario.durationMin ?? 360
    this.setMinutes(Math.round((Math.min(Math.max(hours, 0), max / 60) * 60) / 5) * 5)
  }

  private setMinutes(minutes: number) {
    this.minutes = minutes
    const hour = this.refs.hour as HTMLInputElement
    hour.value = String(minutes)
    const start = this.loaded?.fire.start
    this.refs.hourText.textContent = `${fmtElapsed(this.hours)}${start ? ` · ${fmtTime(wallClock(start, this.hours))}` : ''}`
    this.renderReport()
    this.draw()
  }

  toggle(open = !this.open) {
    if (this.role !== 'cmd' && open) return
    if (open === this.open) return
    this.el.classList.toggle('open', open)
    if (!open) {
      this.setTool(null)
      this.hideCutTooltip()
    }
    this.actions.editing(open)
  }

  /** A fire opened: its decisions come back from this browser, or start from the examples, on the roads. */
  setFire(fireId: string, fire: Fire, stations: NearStation[], context: Context | undefined, scenario: Scenario, examples: [Decision, Decision]) {
    const snapped = examples.map((d) => {
      const points = Object.fromEntries(
        Object.entries(d.points).map(([id, p]) => [id, context ? (snapToRoad(context, p, SNAP_M) ?? p) : p]),
      )
      return { ...clone(d), points: Object.fromEntries(Object.entries(points).map(([id, p]) => [id, { lon: p.lon, lat: p.lat }])) }
    }) as [Decision, Decision]
    this.loaded = { fireId, fire, stations, context, scenario, examples: snapped }
    this.decisions = load(fireId) ?? (snapped.map(clone) as [Decision, Decision])
    this.runs = this.reports = undefined
    this.active = 0
    this.fromId = stations[0]?.id ?? 'none'
    this.updateStationDropdown()
    ;(this.refs.hour as HTMLInputElement).max = String(scenario.durationMin)
    this.setMinutes(scenario.durationMin)
    this.cancel()
    this.setCount(this.count)
    this.render()
  }

  /** The runs of Livre, A and B, and their reports when the fire has OSM context. */
  setRuns(runs: Runs | undefined, reports: Reports | undefined) {
    this.runs = runs
    this.reports = reports
    this.render()
  }

  /** Keys while the drawer is open: Enter closes a line, Escape drops the tool or the drawer. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.open) return false
    if (e.key === 'Enter' && this.tool && this.tool !== 'point') return this.finishLine(), true
    if (e.key === 'Escape') return this.tool ? this.setTool(null) : this.toggle(false), true
    return false
  }

  private setCount(count: number) {
    const maxAvailable = this.available(this.unit, this.from(this.loaded?.stations ?? []))
    this.count = Math.min(Math.max(count, 1), Math.max(1, maxAvailable))
    this.refs.count.textContent = String(this.count)
    this.renderPalette()
  }

  /** What the station has of a unit (inventory.json), or undefined when nothing is known: aerial means, unknown stations. */
  private stock(unit: UnitId, from: string): number | undefined {
    if (isAerial(this.sup.units[unit])) return undefined
    const stock = this.inventory?.[from]
    if (!stock) return undefined
    if (unit === 'crew') return stock.decir.ecin + stock.decir.eip
    return stock.units[unit]
  }

  /** How many of a unit the station still has for the active decision, leaving out one assignment (the one being changed). */
  private available(unit: UnitId, from: string, except = -1): number {
    const stock = this.stock(unit, from)
    if (stock === undefined) return 6
    const used = this.decisions[this.active].assignments.reduce((n, a, k) => (k !== except && a.unit === unit && a.from === from ? n + a.count : n), 0)
    return Math.max(0, stock - used)
  }

  private setTool(tool: Tool | null) {
    const unit = this.sup.units[this.unit]
    if (tool === 'line' && !unit.lineMPerH) tool = null
    if (tool === 'drops' && !isAerial(unit)) tool = null
    this.tool = tool
    this.drawing = []
    this.viewer.scene.canvas.style.cursor = tool ? 'crosshair' : ''
    for (const button of this.el.querySelectorAll<HTMLElement>('[data-tool]'))
      button.classList.toggle('on', button.dataset.tool === tool)
    this.refs.hint.classList.remove('danger')
    this.refs.hint.textContent =
      tool === 'point'
        ? 'Clica no mapa: o meio fica no ponto de acesso mais próximo (estrada, caminho ou trilho).'
        : tool === 'line'
          ? 'Clica os vértices da linha; Enter termina, Esc cancela. A linha avança ao ritmo da equipa.'
          : tool === 'drops'
            ? 'Clica os vértices da linha de água; Enter termina. As descargas percorrem-na em ciclo.'
            : ''
    this.drawAccess()
    this.draw()
  }

  private cancel() {
    this.setTool(null)
    this.hazards.entities.removeAll()
    if (this.dangerTimer !== undefined) {
      window.clearTimeout(this.dangerTimer)
      this.dangerTimer = undefined
    }
    this.refs.hint.classList.remove('danger')
  }

  /** Interactive cursor feedback and tooltips for road cuts, PMA, and active fire perimeter */
  private hover(position: Cartesian2) {
    // 1. Check if hovering over any road cut or PMA entity
    const picked = this.viewer.scene.pick(position)
    const cut: RoadCutItem | undefined = (picked?.id as any)?._roadCut
    const pma: MedicalPointItem | undefined = (picked?.id as any)?._pma

    if (cut) {
      this.showCutTooltip(position, cut)
      this.viewer.scene.canvas.style.cursor = 'pointer'
      return
    } else if (pma) {
      this.showPmaTooltip(position, pma)
      this.viewer.scene.canvas.style.cursor = 'pointer'
      return
    } else {
      this.hideCutTooltip()
    }

    // 2. Active fire perimeter check if editor is open and tool is active
    if (!this.open || !this.tool || !this.loaded) {
      this.viewer.scene.canvas.style.cursor = 'default'
      return
    }

    const p = this.pick(position)
    if (!p) return

    const cell = cellOf(this.loaded.scenario.grid, p)
    const activeRun = this.runs ? (this.runs[this.decisions[this.active].id as 'A' | 'B'] ?? this.runs.free) : undefined
    const isFire = cell >= 0 && activeRun && activeRun.arrival[cell] <= this.minutes
    this.viewer.scene.canvas.style.cursor = isFire ? 'not-allowed' : 'crosshair'
  }

  private showCutTooltip(position: Cartesian2, cut: RoadCutItem) {
    if (!this.cutTooltip) {
      this.cutTooltip = document.createElement('div')
      this.cutTooltip.className = 'road-cut-tooltip'
      this.root.append(this.cutTooltip)
    }

    const urgencyBadge =
      cut.urgency === 'cortado'
        ? '<span class="status-badge red">🚨 CORTE ATIVO · INTERDITADO</span>'
        : cut.urgency === 'urgente'
          ? `<span class="status-badge orange">⚠️ CORTE IMINENTE · IMPACTO EM ${cut.minutesToImpact} MIN</span>`
          : `<span class="status-badge yellow">🚧 CORTE PREVENTIVO · IMPACTO EM ${cut.minutesToImpact} MIN</span>`

    this.cutTooltip.className = `road-cut-tooltip ${cut.urgency}`
    this.cutTooltip.style.left = `${position.x}px`
    this.cutTooltip.style.top = `${position.y}px`
    this.cutTooltip.innerHTML = `
      <div class="tooltip-header">
        <span class="icon">⛔</span>
        <span class="title">ESTRADA CORTADA</span>
      </div>
      <div class="tooltip-road">${cut.label}</div>
      <div class="tooltip-status">${urgencyBadge}</div>
      <div class="tooltip-detail">Tipo: ${cut.isPaved ? 'Via Pavimentada / Asfaltada' : 'Acesso Rural / Florestal'}</div>
      <div class="tooltip-action">👮 <b>Ação PSP/GNR:</b> Colocar barreira física e desviar tráfego</div>
    `
    this.cutTooltip.hidden = false
  }

  private showPmaTooltip(position: Cartesian2, pma: MedicalPointItem) {
    if (!this.cutTooltip) {
      this.cutTooltip = document.createElement('div')
      this.cutTooltip.className = 'road-cut-tooltip'
      this.root.append(this.cutTooltip)
    }

    this.cutTooltip.className = 'road-cut-tooltip inem'
    this.cutTooltip.style.left = `${position.x}px`
    this.cutTooltip.style.top = `${position.y}px`
    this.cutTooltip.innerHTML = `
      <div class="tooltip-header">
        <span class="icon">🚑</span>
        <span class="title" style="color:#4ade80;">INEM · POSTO MÉDICO AVANÇADO</span>
      </div>
      <div class="tooltip-road">${pma.name}</div>
      <div class="tooltip-status">
        <span class="status-badge" style="background:rgba(34,197,94,0.2);color:#86efac;border:1px solid rgba(34,197,94,0.5);">
          🛡️ Margem Segura: ${Math.round(pma.safeBufferMin)} min
        </span>
      </div>
      <div class="tooltip-detail">Hospital Destino: ${pma.hospitalDestination ?? 'Hospital de Braga'} (${pma.routeKm ? `${pma.routeKm.toFixed(1)} km · ETA ${Math.round(pma.etaMin ?? 0)} min` : 'Rota Ativa'})</div>
      <div class="tooltip-action" style="color:#86efac;">🚑 <b>Corredor Verde:</b> Via segura e desimpedida para evacuação médica</div>
    `
    this.cutTooltip.hidden = false
  }

  private hideCutTooltip() {
    if (this.cutTooltip && !this.cutTooltip.hidden) {
      this.cutTooltip.hidden = true
    }
  }

  private showDangerWarning(point: LonLat, arrivalMin: number) {
    if (this.dangerTimer !== undefined) {
      window.clearTimeout(this.dangerTimer)
      this.dangerTimer = undefined
    }

    this.refs.hint.classList.add('danger')
    this.refs.hint.innerHTML = `<span class="danger-badge">ZONA ATIVA DE FOGO</span> Impossível posicionar meios! O fogo atingiu este ponto aos <b>T+${Math.round(arrivalMin)} min</b> (hora atual: T+${Math.round(this.minutes)} min). Risco de encurralamento!`

    this.hazards.entities.removeAll()
    this.hazards.entities.add({
      position: Cartesian3.fromDegrees(point.lon, point.lat),
      point: {
        pixelSize: 15,
        color: Color.RED.withAlpha(0.9),
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Infinity,
      },
      label: {
        text: `⚠️ FOGO ATIVO (T+${Math.round(arrivalMin)}m)`,
        font: 'bold 12px ui-monospace, Menlo, monospace',
        fillColor: Color.RED,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: 2,
        pixelOffset: new Cartesian2(0, -22),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Infinity,
      },
    })

    this.dangerTimer = window.setTimeout(() => {
      this.refs.hint.classList.remove('danger')
      this.hazards.entities.removeAll()
      this.dangerTimer = undefined
      this.setTool(this.tool)
    }, 4500)
  }

  private quickAdd() {
    if (!this.loaded) return
    const { context, stations, scenario } = this.loaded
    const d = this.decisions[this.active]
    const activeRun = this.runs ? (this.runs[d.id as 'A' | 'B'] ?? this.runs.free) : undefined

    let targetPoint: LonLat | undefined

    if (context && context.access.length > 0) {
      const candidates = context.access.filter((a) => {
        const cell = cellOf(scenario.grid, a)
        return cell >= 0 && (!activeRun || activeRun.arrival[cell] > this.minutes)
      })

      if (candidates.length > 0) {
        const existing = Object.values(d.points)
        candidates.sort((a, b) => distanceM(scenario.ignition, a) - distanceM(scenario.ignition, b))
        targetPoint = candidates.find((c) => !existing.some((p) => distanceM(p, c) < 250)) ?? candidates[0]
      }
    }

    if (!targetPoint) {
      const angle = (Object.keys(d.points).length * 45) * Math.PI / 180
      targetPoint = {
        lon: scenario.ignition.lon + Math.cos(angle) * 0.012,
        lat: scenario.ignition.lat + Math.sin(angle) * 0.012,
      }
    }

    const id = nextId(d.points, 'p')
    d.points[id] = { lon: targetPoint.lon, lat: targetPoint.lat }
    d.assignments.push({
      unit: this.unit,
      count: this.count,
      from: this.from(stations),
      target: id,
      task: isAerial(this.sup.units[this.unit]) ? 'direct' : this.task,
    })

    this.refs.hint.classList.remove('danger')
    this.refs.hint.textContent = `Meio colocado com sucesso! Rota rodoviária calculada no mapa.`
    this.commit()
  }

  private click(position: Cartesian2) {
    if (!this.open || !this.tool || !this.loaded) return
    const p = this.pick(position)
    if (!p) return

    const { context, stations, scenario } = this.loaded
    const access = context ? snapToRoad(context, p, SNAP_M) : undefined
    const point = access ? { lon: access.lon, lat: access.lat } : p

    // Active fire safety check: reject placing ground crews inside active fire perimeter
    const cell = cellOf(scenario.grid, point)
    const activeRun = this.runs ? (this.runs[this.decisions[this.active].id as 'A' | 'B'] ?? this.runs.free) : undefined
    if (cell >= 0 && activeRun && activeRun.arrival[cell] <= this.minutes) {
      this.showDangerWarning(point, activeRun.arrival[cell])
      return
    }

    if (this.tool === 'pma') {
      this.setPmaLocation(point)
      this.setTool(null)
      return
    }
    if (this.tool !== 'point') {
      this.drawing.push(point)
      this.draw()
      return
    }

    const d = this.decisions[this.active]
    const id = nextId(d.points, 'p')
    d.points[id] = point
    d.assignments.push({ unit: this.unit, count: this.count, from: this.from(stations), target: id, task: isAerial(this.sup.units[this.unit]) ? 'direct' : this.task })
    this.refs.hint.classList.remove('danger')
    this.refs.hint.textContent = access
      ? `Ponto no acesso mais próximo (${roadName(context!, access.road)}), a ${fmtNumber(distanceM(p, point))} m do clique.`
      : `Sem estrada a menos de ${SNAP_M} m: o ponto ficou onde clicaste.`
    this.commit()
  }

  private finishLine() {
    if (!this.loaded || (this.tool !== 'line' && this.tool !== 'drops')) return
    if (this.drawing.length < 2) return void (this.refs.hint.textContent = 'Uma linha precisa de dois cliques pelo menos.')
    const d = this.decisions[this.active]
    const id = nextId(d.lines, 'l')
    d.lines[id] = this.drawing
    d.assignments.push({ unit: this.unit, count: this.count, from: this.from(this.loaded.stations), target: id, task: this.tool })
    this.drawing = []
    this.setTool(null)
    this.commit()
  }

  private from(stations: NearStation[]): string {
    if (isAerial(this.sup.units[this.unit])) return 'air'
    return stations.some((s) => s.id === this.fromId) ? this.fromId : (stations[0]?.id ?? 'none')
  }

  private remove(k: number) {
    const d = this.decisions[this.active]
    const [a] = d.assignments.splice(k, 1)
    // A point or a line nobody works any more goes with its last assignment.
    if (!d.assignments.some((other) => other.target === a.target)) {
      delete d.points[a.target]
      delete d.lines[a.target]
    }
    this.commit()
  }

  private recount(k: number, by: number) {
    const a = this.decisions[this.active].assignments[k]
    a.count = Math.min(Math.max(a.count + by, 1), Math.max(1, this.available(a.unit, a.from, k)))
    this.commit()
  }

  /** The decisions changed: remember them, show them and have them simulated again. */
  private commit() {
    if (this.loaded) save(this.loaded.fireId, this.decisions)
    this.render()
    this.actions.changed()
  }

  private updateStationDropdown() {
    const from = this.refs.from as HTMLSelectElement
    if (!this.loaded) return
    const stations = this.loaded.stations
    const current = from.value || this.fromId

    from.replaceChildren(
      ...stations.map((s) => {
        const option = document.createElement('option')
        option.value = s.id
        const stock = this.stock(this.unit, s.id)
        const left = this.available(this.unit, s.id)
        const badge = stock !== undefined ? ` (${left}/${stock} disp.)` : ''
        option.textContent = `${s.short} · ${fmtKm(s.km)}${badge}`
        return option
      }),
    )

    if (stations.some((s) => s.id === current)) {
      from.value = current
      this.fromId = current
    } else {
      this.fromId = stations[0]?.id ?? 'none'
      from.value = this.fromId
    }
  }

  private render() {
    this.updateStationDropdown()
    const d = this.decisions[this.active]
    this.refs.tabs.querySelectorAll<HTMLElement>('[data-tab]').forEach((tab, i) => {
      tab.classList.toggle('on', i === this.active)
      tab.querySelector('span')!.textContent = this.decisions[i].name
    })
    ;(this.refs.name as HTMLInputElement).value = d.name
    this.refs.list.replaceChildren(...d.assignments.map((a, k) => this.row(a, k)))
    if (!d.assignments.length) this.refs.list.innerHTML = '<li class="none">Nada no terreno: o fogo corre livre.</li>'
    this.renderReport()
    this.draw()
  }

  private row(a: Assignment, k: number): HTMLElement {
    const li = document.createElement('li')
    const unit = this.sup.units[a.unit]
    const d = this.decisions[this.active]
    const target = d.points[a.target] ?? d.lines[a.target]?.[0]
    const eta = target ? this.eta(a, target) : undefined
    const isGround = !isAerial(unit)
    const station = this.loaded?.stations.find((s) => s.id === a.from)

    let routeBadge = ''
    if (isGround && target && station && this.loaded?.context) {
      const activeRun = this.runs ? (this.runs[d.id as 'A' | 'B'] ?? this.runs.free) : undefined
      const route = findSafeRoute(this.loaded.scenario.grid, this.loaded.context.osm.roads, activeRun?.arrival, this.minutes, station, target)
      if (route?.isDetour) {
        routeBadge = `<span class="route-badge" title="Desvio seguro: ${route.distanceKm.toFixed(1)} km contornando estradas cortadas pelo fogo">Desvio seguro</span>`
      }
    }

    li.innerHTML = `
      <div class="who"><b></b><span class="n"></span><span class="from"></span>${routeBadge}<em></em></div>
      <div class="what"></div>
      <div class="ctl"><button type="button" title="Menos">−</button><button type="button" title="Mais">+</button><button type="button" class="x" title="Retirar">×</button></div>`
    li.querySelector('b')!.textContent = unit.short
    li.querySelector('.n')!.textContent = `× ${a.count}`
    li.querySelector('.from')!.textContent = isAerial(unit) ? 'base aérea' : (station?.short ?? '')
    li.querySelector('em')!.textContent = eta === undefined ? '' : `T+${Math.round(eta)} min`
    li.querySelector('.what')!.textContent = `${TASK_NAME[a.task]} · ${this.whatText(a)}`
    const [less, more, x] = li.querySelectorAll('button')
    less.addEventListener('click', () => this.recount(k, -1))
    more.addEventListener('click', () => this.recount(k, 1))
    x.addEventListener('click', () => this.remove(k))
    return li
  }

  /** Minutes until an assignment is at work, from its station or the air base. */
  private eta(a: Assignment, target: LonLat): number {
    const unit = this.sup.units[a.unit]
    const station = this.loaded?.stations.find((s) => s.id === a.from)
    let km = isAerial(unit) ? this.sup.dispatch.airBaseKm : station ? distanceM(station, target) / 1000 : this.sup.dispatch.airBaseKm

    // For ground units, use real safe driving route along OSM road network
    if (!isAerial(unit) && station && this.loaded?.context) {
      const d = this.decisions[this.active]
      const activeRun = this.runs ? (this.runs[d.id as 'A' | 'B'] ?? this.runs.free) : undefined
      const route = findSafeRoute(this.loaded.scenario.grid, this.loaded.context.osm.roads, activeRun?.arrival, this.minutes, station, target)
      if (route) km = route.distanceKm
    }

    return arrivalMin(this.sup, unit, km, false)
  }

  /** What the assignment can do, in one line: the front it holds and how it grows, line built, drops, water. */
  private whatText(a: Assignment): string {
    const unit = this.sup.units[a.unit]
    const d = this.decisions[this.active]
    const { waterPointKm } = this.sup.dispatch
    if (a.task === 'line' && this.loaded) {
      const schedule = lineSchedule(this.loaded.scenario, d, a)
      const run = this.runs?.[d.id as 'A' | 'B']
      if (schedule && run) {
        const built = builtCells(schedule, run)
        const m = this.loaded.scenario.grid.cellsize
        return `${fmtNumber(built * m)} de ${fmtNumber(schedule.cells.length * m)} m feitos antes do fogo`
      }
      return `${fmtNumber(lineLengthM(d.lines[a.target] ?? []))} m de linha`
    }
    if (a.task === 'drops' && unit.holdMin && unit.dropM) {
      const every = dropCycleMin(unit, waterPointKm) / a.count
      const stretches = Math.max(1, Math.floor(unit.holdMin / every))
      return `${fmtNumber(lineLengthM(d.lines[a.target] ?? []))} m · descarga a cada ~${fmtNumber(every)} min onde o fogo toca · ${stretches} troços de ${unit.dropM[0]} m seguros ${unit.holdMin} min`
    }
    if (a.task === 'shuttle') return `abastece os meios neste ponto: recarga de ${fmtNumber(refillMin(this.sup.units.vfci, 0))} min sem ir ao ponto de água a ${waterPointKm} km`
    if (isAerial(unit)) return `${a.count} × ${unit.waterL} L a cada ~${fmtNumber(dropCycleMin(unit, waterPointKm) / a.count)} min · segura ${fmtNumber(aerialFrontM(unit, a.count, waterPointKm))} m de frente · chama até ${unit.holdFlameM} m`
    // Ground units at a point: the front they hold from the access point and how fast it grows.
    const shuttled = d.assignments.some((s) => s.task === 'shuttle' && s.target === a.target)
    const waterKm = shuttled ? 0 : waterPointKm
    const fuelClass = this.fuelClassAt(d.points[a.target])
    const refill = refillMin(unit, waterKm)
    const relay = a.count > 1 || refill === 0
    const grow = attackMPerH(unit, fuelClass) * a.count * (relay ? dutyCycle(unit, waterKm) : 1)
    const front = `frente de ${fmtNumber(unit.radiusM * Math.sqrt(a.count))} m à chegada, +${fmtNumber(grow)} m/h até ${fmtNumber(unit.reachM ?? unit.radiusM)} m`
    const water = !unit.waterL ? '' : relay ? ` · ${a.count} em revezamento na recarga` : ` · ${fmtNumber(workMin(unit))} min de água, ~${fmtNumber(refill)} min a recarregar`
    return `${front}${water} · chama até ${unit.holdFlameM} m`
  }

  /** Fuel class under a point of the decision (shrubland when the grid is not loaded). */
  private fuelClassAt(p: LonLat | undefined): number {
    const grid = this.loaded?.scenario.grid
    if (!grid || !p) return 2
    const i = cellOf(grid, p)
    return i >= 0 && i < grid.fuelClass.length ? grid.fuelClass[i] : 2
  }

  private renderPalette() {
    const unit = this.sup.units[this.unit]
    const { waterPointKm } = this.sup.dispatch
    const parts: string[] = []
    if (isAerial(unit) && unit.holdMin && unit.dropM) {
      const every = dropCycleMin(unit, waterPointKm) / this.count
      parts.push(
        `${unit.waterL} L por descarga, a cada ~${fmtNumber(every)} min com ${this.count}`,
        `num ponto segura ${fmtNumber(aerialFrontM(unit, this.count, waterPointKm))} m de frente`,
        `numa linha, ${Math.max(1, Math.floor(unit.holdMin / every))} troços de ${unit.dropM[0]} m seguros ${unit.holdMin} min onde o fogo toca`,
        `descola em ${unit.turnoutMin} min`,
      )
    } else {
      const relay = this.count > 1
      const grow = attackMPerH(unit, 2) * this.count * (relay ? dutyCycle(unit, waterPointKm) : 1)
      parts.push(`${unit.people * this.count} pessoas`)
      parts.push(`frente de ${fmtNumber(unit.radiusM * Math.sqrt(this.count))} m à chegada, +${fmtNumber(grow)} m/h em mato até ${fmtNumber(unit.reachM ?? unit.radiusM)} m`)
      if (unit.waterL)
        parts.push(
          `${unit.waterL} L · ${fmtNumber(workMin(unit))} min de água, depois ~${fmtNumber(refillMin(unit, waterPointKm))} min a reabastecer a ${waterPointKm} km${relay ? ' (revezam-se)' : ''}`,
        )
      if (unit.lineMPerH) parts.push(`linha: ${unit.lineMPerH[1] * this.count} m/h em erva, ${unit.lineMPerH[2] * this.count} m/h em mato`)
      parts.push(`segura chama até ${unit.holdFlameM} m`)
    }
    this.refs.capacity.textContent = parts.join(' · ')
    ;(this.refs.task as HTMLSelectElement).hidden = isAerial(unit)
    ;(this.refs.from as HTMLSelectElement).hidden = isAerial(unit)
    // What the station still has of this unit for the active decision (inventory.json)
    const from = this.from(this.loaded?.stations ?? [])
    const stock = this.stock(this.unit, from)
    const left = this.available(this.unit, from)
    const station = this.loaded?.stations.find((s) => s.id === from)
    if (isAerial(unit)) {
      this.refs.stock.textContent = `da base aérea a ${this.sup.dispatch.airBaseKm} km · sem limite de meios nesta estimativa`
      this.refs.stock.classList.remove('out')
    } else if (stock === undefined) {
      this.refs.stock.textContent = station ? `${station.short}: sem estimativa de meios` : 'sem quartel selecionado'
      this.refs.stock.classList.remove('out')
    } else {
      const inReserve = left
      const deployed = stock - left
      const statusText = deployed > 0
        ? `${station?.short ?? from}: ${left} de ${stock} ${unit.short} disponíveis (${inReserve} em reserva, ${deployed} empenhados nesta decisão)`
        : `${station?.short ?? from}: ${left} de ${stock} ${unit.short} disponíveis (${inReserve} em reserva)`
      this.refs.stock.textContent = left === 0 ? `${statusText} · ESGOTADO` : statusText
      this.refs.stock.classList.toggle('out', left === 0)
    }
    for (const button of this.el.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      const tool = button.dataset.tool as Tool
      button.disabled = left === 0 || (tool === 'line' && !unit.lineMPerH) || (tool === 'drops' && !isAerial(unit))
    }
    if (left === 0) this.setTool(null)
    if (this.tool && (this.tool === 'line' ? !unit.lineMPerH : this.tool === 'drops' ? !isAerial(unit) : false)) this.setTool(null)
  }

  private renderReport() {
    const table = this.refs.report
    const r = this.reports
    if (!r) {
      table.innerHTML = `<tr><td class="none">${this.loaded?.context ? 'Sem simulação ainda.' : 'Sem dados OSM para este incêndio.'}</td></tr>`
      this.refs.detail.textContent = ''
      return
    }
    const cols = ['free', 'A', 'B'] as const
    const at = this.reportsAt(this.minutes) ?? r
    this.refs.reportAt.textContent = at.A.minutes >= r.A.minutes ? `às ${fmtNumber(r.A.minutes / 60, 1)} h` : `a ${fmtElapsed(at.A.minutes / 60)}`
    const rows: [string, (x: Report) => string][] = [
      ['Área ardida', (x) => fmtHa(x.burnedHa)],
      ['Casas atingidas', (x) => String(x.homes)],
      ['Edifícios', (x) => String(x.buildings)],
      ['Lugares', (x) => String(x.places.length)],
      ['Estradas cortadas', (x) => fmtKm(x.roadKm.paved + x.roadKm.track)],
      ['1.ª casa', (x) => (x.firstHomeMin === null ? '–' : `T+${Math.round(x.firstHomeMin)} min`)],
    ]
    table.innerHTML = `<tr><th></th>${cols.map((c) => `<th class="${c === this.decisions[this.active].id ? 'on' : ''}">${c === 'free' ? 'Livre' : c}</th>`).join('')}</tr>`
    for (const [label, text] of rows) {
      const tr = document.createElement('tr')
      tr.innerHTML = `<th></th>${cols.map(() => '<td></td>').join('')}`
      tr.querySelector('th')!.textContent = label
      tr.querySelectorAll('td').forEach((td, i) => (td.textContent = text(at[cols[i]])))
      table.append(tr)
    }
    this.refs.verdict.textContent = describeVerdict(recommend(r.A, r.B), r.A, r.B)
    const mine = at[this.decisions[this.active].id as 'A' | 'B']
    const places = mine.places.slice(0, 4).map((p) => `${p.name} T+${Math.round(p.minute)} min`)
    const roads = mine.roadsCut.slice(0, 4).map((c) => `${c.label} ${fmtKm(c.km)}`)
    this.refs.detail.textContent =
      `${this.decisions[this.active].id}: ` +
      [places.length ? `lugares ${places.join(', ')}` : 'nenhum lugar atingido', roads.length ? `estradas ${roads.join(', ')}` : 'nenhuma estrada cortada'].join(' · ') +
      '. Casas do OSM rural: um mínimo.'
  }

  /** The reports as they stand at a minute of the runs, or undefined at the end (the 6 h reports are given). */
  private reportsAt(minutes: number): Reports | undefined {
    const runs = this.runs
    const context = this.loaded?.context
    if (!runs || !context || !this.reports || minutes >= this.reports.A.minutes) return undefined
    const { grid } = this.loaded!.scenario
    return { free: makeReport(grid, context, runs.free, minutes), A: makeReport(grid, context, runs.A, minutes), B: makeReport(grid, context, runs.B, minutes) }
  }

  /** The active decision on the ground: points, lines (built in time solid, late dashed), safe road routes, the line being drawn. */
  private draw() {
    const { entities } = this.source
    entities.removeAll()
    this.routes.entities.removeAll()
    const d = this.decisions[this.active]
    const { context, scenario, stations } = this.loaded ?? {}
    const activeRun = this.runs ? (this.runs[d.id as 'A' | 'B'] ?? this.runs.free) : undefined

    // 1. Draw blue road routes connecting stations to ground attack points
    if (context && scenario && stations) {
      for (const [id, p] of Object.entries(d.points)) {
        const units = d.assignments.filter((a) => a.target === id)
        const groundUnits = units.filter((a) => !isAerial(this.sup.units[a.unit]))
        if (!groundUnits.length) continue

        const uniqueStations = [...new Set(groundUnits.map((a) => a.from))]
        for (const stationId of uniqueStations) {
          const station = stations.find((s) => s.id === stationId)
          if (!station) continue

          const route = findSafeRoute(scenario.grid, context.osm.roads, activeRun?.arrival, this.minutes, station, p)
          if (route && route.path.length >= 2) {
            // Vibrant neon blue safe driving route avoiding active fire front
            this.routes.entities.add({
              polyline: {
                positions: route.path.map((pt) => Cartesian3.fromDegrees(pt.lon, pt.lat)),
                width: 4,
                clampToGround: true,
                material: Color.fromCssColorString('#00d2ff'),
              },
            })
          } else if (!route) {
            // Access road cut by fire perimeter! Show dashed hazard line
            this.routes.entities.add({
              polyline: {
                positions: [Cartesian3.fromDegrees(station.lon, station.lat), Cartesian3.fromDegrees(p.lon, p.lat)],
                width: 2.5,
                clampToGround: true,
                material: new PolylineDashMaterialProperty({ color: Color.RED, dashLength: 10 }),
              },
            })
          }
        }
      }
    }

    // 2. Draw attack points
    for (const [id, p] of Object.entries(d.points)) {
      const units = d.assignments.filter((a) => a.target === id)
      const aerial = units.some((a) => isAerial(this.sup.units[a.unit]))
      entities.add({
        position: Cartesian3.fromDegrees(p.lon, p.lat),
        point: { pixelSize: 9, color: aerial ? INK : AMBER, outlineColor: Color.BLACK.withAlpha(0.6), outlineWidth: 2, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity },
        label: {
          text: units.map((a) => `${this.sup.units[a.unit].short}×${a.count}`).join(' '),
          font: '11px ui-monospace, Menlo, monospace',
          fillColor: INK,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: 2, // FILL_AND_OUTLINE
          pixelOffset: new Cartesian2(0, -16),
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Infinity,
        },
      })
    }

    // 3. Draw lines
    for (const [id, line] of Object.entries(d.lines)) {
      const a = d.assignments.find((x) => x.target === id)
      if (!a) continue
      if (a.task === 'drops') {
        this.polyline(line, INK, true)
        continue
      }
      const schedule = this.loaded && lineSchedule(this.loaded.scenario, d, a)
      const run = this.runs?.[d.id as 'A' | 'B']
      const fraction = schedule && run ? builtCells(schedule, run) / schedule.cells.length : 1
      const [built, late] = splitLine(line, fraction)
      if (built.length > 1) this.polyline(built, AMBER, false)
      if (late.length > 1) this.polyline(late, DIM, true)
    }

    // 4. Line being drawn
    if (this.drawing.length) {
      this.polyline(this.drawing, this.tool === 'drops' ? INK : AMBER, true)
      entities.add({ position: Cartesian3.fromDegrees(this.drawing[0].lon, this.drawing[0].lat), point: { pixelSize: 6, color: INK, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity } })
    }

    // 5. Draw multi-agency overlays (PSP road cuts and INEM Medical Point)
    this.agency.entities.removeAll()
    if (context && scenario && activeRun) {
      const threatened = detectThreatenedRoads(scenario.grid, context, activeRun, this.minutes)

      // Draw threatened roads for PSP & Command
      if (this.role === 'psp' || this.role === 'cmd') {
        for (const cut of threatened) {
          if (cut.pts && cut.pts.length >= 2) {
            const cutColor =
              cut.urgency === 'cortado'
                ? Color.fromCssColorString('#e63946')
                : cut.urgency === 'urgente'
                  ? Color.fromCssColorString('#ff3b30')
                  : Color.fromCssColorString('#f0a33a')

            const lineEntity = this.agency.entities.add({
              polyline: {
                positions: cut.pts.map((pt) => Cartesian3.fromDegrees(pt[0], pt[1])),
                width: this.role === 'psp' ? 5 : 3,
                clampToGround: true,
                material: new PolylineDashMaterialProperty({ color: cutColor, dashLength: 10 }),
              },
            })
            ;(lineEntity as any)._roadCut = cut

            // Cut barricade pin with distinct barrier icon (clean map: no text label, hover tooltip provides details)
            const cutEntity = this.agency.entities.add({
              position: Cartesian3.fromDegrees(cut.coord.lon, cut.coord.lat),
              billboard: {
                image: getBarricadeCanvas(cut.urgency),
                width: 44,
                height: 44,
                verticalOrigin: VerticalOrigin.BOTTOM,
                heightReference: HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Infinity,
              },
            })
            ;(cutEntity as any)._roadCut = cut
          }
        }
      }

      // Draw PMA and ambulance route for INEM & Command
      if (this.role === 'inem' || this.role === 'cmd') {
        for (const pma of this.pmaList) {
          const pmaEntity = this.agency.entities.add({
            position: Cartesian3.fromDegrees(pma.location.lon, pma.location.lat),
            point: {
              pixelSize: 13,
              color: Color.fromCssColorString('#34c759'),
              outlineColor: Color.WHITE,
              outlineWidth: 2,
              heightReference: HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Infinity,
            },
            label: {
              text: `🏥 ${pma.name}`,
              font: '11px ui-monospace, monospace',
              fillColor: Color.WHITE,
              backgroundColor: Color.fromCssColorString('rgba(20, 120, 50, 0.88)'),
              showBackground: true,
              style: 2,
              pixelOffset: new Cartesian2(0, -20),
              heightReference: HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Infinity,
            },
          })
          ;(pmaEntity as any)._pma = pma

          if (pma.ambulanceRoute && pma.ambulanceRoute.length >= 2) {
            const routeEntity = this.agency.entities.add({
              polyline: {
                positions: pma.ambulanceRoute.map((pt) => Cartesian3.fromDegrees(pt.lon, pt.lat)),
                width: 4,
                clampToGround: true,
                material: Color.fromCssColorString('#00e676'),
              },
            })
            ;(routeEntity as any)._pma = pma
          }
        }
      }
    }
  }

  private polyline(line: LonLat[], color: Color, dashed: boolean) {
    if (line.length < 2) return
    this.source.entities.add({
      polyline: {
        positions: line.map((p) => Cartesian3.fromDegrees(p.lon, p.lat)),
        width: dashed ? 2.5 : 4,
        clampToGround: true,
        material: dashed ? new PolylineDashMaterialProperty({ color, dashLength: 12 }) : color,
      },
    })
  }

  setRole(role: AgencyRole) {
    this.role = role
    if (role !== 'cmd') {
      if (this.open) {
        this.toggle(false)
      }
    }
    this.hideCutTooltip()
    this.draw()
  }

  togglePmaTool() {
    if (this.tool === 'pma') {
      this.setTool(null)
      this.refs.hint.textContent = ''
    } else {
      this.setTool('pma')
      this.refs.hint.classList.remove('danger')
      this.refs.hint.textContent = 'Clica no mapa onde queres instalar o Posto Médico Avançado (PMA).'
    }
  }

  setPmaLocation(point: LonLat) {
    if (!this.loaded) return
    const { scenario, context } = this.loaded
    const d = this.decisions[this.active]
    const activeRun = this.runs ? (this.runs[d.id as 'A' | 'B'] ?? this.runs.free) : undefined
    const safeBufferMin = activeRun ? evaluateMedicalPointSafety(scenario.grid, activeRun.arrival, point) : 180

    let ambulanceRoute: LonLat[] | undefined
    let routeKm: number | undefined
    let etaMin: number | undefined

    if (context) {
      const route = findSafeRoute(scenario.grid, context.osm.roads, activeRun?.arrival, this.minutes, DEFAULT_HOSPITAL.location, point)
      if (route) {
        ambulanceRoute = route.path
        routeKm = route.distanceKm
        etaMin = Math.round(route.distanceKm * 1.5)
      }
    }

    this.pmaList = [
      {
        id: 'pma-1',
        name: 'PMA 1 (Posto Médico Avançado)',
        kind: 'pma',
        location: point,
        safeBufferMin,
        hospitalDestination: DEFAULT_HOSPITAL.name,
        ambulanceRoute,
        routeKm,
        etaMin,
      },
    ]

    this.refs.hint.classList.remove('danger')
    this.refs.hint.textContent = `PMA estabelecido com sucesso! Margem de segurança: ${safeBufferMin > 180 ? '> 3 horas' : `${safeBufferMin} min`}.`
    this.draw()
    this.actions.changed()
  }

  getMultiAgencyDispatch(): MultiAgencyDispatch | undefined {
    if (!this.loaded) return undefined
    const d = this.decisions[this.active]
    const activeRun = this.runs ? (this.runs[d.id as 'A' | 'B'] ?? this.runs.free) : undefined
    if (!activeRun) return undefined
    return buildMultiAgencyDispatch(
      this.loaded.fire.name,
      this.loaded.fire.start,
      this.minutes,
      this.loaded.scenario.grid,
      this.loaded.context,
      activeRun,
      this.pmaList,
    )
  }

  openDispatchDialog() {
    const dispatch = this.getMultiAgencyDispatch()
    if (dispatch) {
      this.dispatchModal.show(dispatch)
    }
  }

    /** The road access points near the ignition, while a point of attack is being placed. */
  private drawAccess() {
    const { entities } = this.access
    entities.removeAll()
    if (this.tool !== 'point' || !this.loaded?.context) return
    const ign = this.loaded.fire.ignition
    let shown = 0
    for (const a of this.loaded.context.access) {
      if (distanceM(a, ign) > ACCESS_SHOWN_M || shown++ > 1500) continue
      entities.add({
        position: Cartesian3.fromDegrees(a.lon, a.lat),
        point: { pixelSize: 3, color: INK.withAlpha(0.55), heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity },
      })
    }
  }

  /** The ground under a screen position, in degrees. */
  private pick(position: Cartesian2): LonLat | undefined {
    const { scene } = this.viewer
    const ray = scene.camera.getPickRay(position)
    const cartesian = ray && scene.globe.pick(ray, scene)
    if (!cartesian) return undefined
    const c = Cartographic.fromCartesian(cartesian)
    return { lon: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude) }
  }
}

const empty = (id: string): Decision => ({ id, name: id === 'A' ? 'Decisão A' : 'Decisão B', points: {}, lines: {}, assignments: [] })
const clone = (d: Decision): Decision => JSON.parse(JSON.stringify(d)) as Decision

function nextId(existing: Record<string, unknown>, prefix: string): string {
  let n = 1
  while (existing[`${prefix}${n}`]) n++
  return `${prefix}${n}`
}

function roadName(context: Context, road: number): string {
  const r = context.osm.roads[road]
  return r.name ? `estrada ${r.name}` : r.ref ? `${r.ref}` : r.cls === 'paved' ? 'estrada' : r.cls === 'track' ? 'caminho de terra' : 'trilho'
}

function lineLengthM(line: LonLat[]): number {
  let m = 0
  for (let i = 1; i < line.length; i++) m += distanceM(line[i - 1], line[i])
  return m
}

/** How many cells of a crew line, from its start, are built before the fire gets to them. */
function builtCells(schedule: { cells: number[]; at: number[] }, run: Run): number {
  let k = 0
  while (k < schedule.cells.length && schedule.at[k] <= run.arrival[schedule.cells[k]]) k++
  return k
}

/** A polyline cut at a fraction of its length: the part before, the part after. */
function splitLine(line: LonLat[], fraction: number): [LonLat[], LonLat[]] {
  if (fraction >= 1) return [line, []]
  if (fraction <= 0) return [[], line]
  let left = lineLengthM(line) * fraction
  const before: LonLat[] = [line[0]]
  for (let i = 1; i < line.length; i++) {
    const seg = distanceM(line[i - 1], line[i])
    if (seg > left) {
      const cut = lerpLonLat(line[i - 1], line[i], left / seg)
      before.push(cut)
      return [before, [cut, ...line.slice(i)]]
    }
    left -= seg
    before.push(line[i])
  }
  return [before, []]
}

function load(fireId: string): [Decision, Decision] | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_PREFIX + fireId) ?? 'null') as { v: number; decisions: [Decision, Decision] } | null
    return raw?.v === 1 && raw.decisions?.length === 2 ? raw.decisions : undefined
  } catch {
    return undefined
  }
}

function save(fireId: string, decisions: [Decision, Decision]) {
  try {
    localStorage.setItem(STORAGE_PREFIX + fireId, JSON.stringify({ v: 1, decisions }))
  } catch {
    // Not remembered beyond this visit.
  }
}
