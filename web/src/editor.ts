import { placements, placementAt, relocationPosition, addPlacement, editPlacement } from './placementTimeline'
import { cachedCombatResources, resourceAt } from './combatResources'
// The decision editor: a drawer on the left where A and B are composed on the map. A unit's
// button arms the map, then each click puts it on the nearest road (a point of attack, where it
// lays its wet line), or, with a line task, clicks draw a crew line or an aerial water line.
// Each assignment shows when it gets there and what it lays: the barriers the engines get.
// A and B are independent plans, simulated by an explicit button press. Every fire opens with
// nothing on the ground; the 6 h report compares Livre, A and B.

import {
  Cartesian2,
  Cartesian3,
  CallbackPositionProperty,
  CallbackProperty,
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
import { burnedHa, forecastArrival, type Run, type Scenario } from './scenario'
import { cellOf, type Grid } from './grid'
import { fmtElapsed, fmtHa, fmtKm, fmtNumber, fmtTime, wallClock } from './format'
import { cleanLonLat, cleanPath, distanceM, bearingDeg, compass, destination, type LonLat } from './geo'
import { snapToRoad, type Context } from './osm'
import { stockSource, type Inventory } from './inventory'
import { lateAt, SAFETY_MIN } from './deployment'
import { computeFWISeries } from './fwi'
import { diffDecisions, diffLines, groundOf, ILS_NAME, type Change, type LineChange, type Progress, type Result, type Score } from './optimize'
import type { IlsReply, IlsRequest } from './optimize.worker'
import { describeEnd, describeVerdict, fireEnd, makeReport, recommend, type Report } from './report'
import { deploymentBoundary, type DeploymentSelection } from './stationRings'
import { findSafeRoute } from './routing'
import { mapHover } from './mapHover'
import { ensureAssignmentIds, originColor, originLetter, fieldIds } from './unitIdentity'
import { demoLines, demoLineLength } from './demoLines'
import { tankerReach } from './tankerSupport'
import { unitJourney } from './unitMotion'
import { unitIconUrl } from './unitIcons'
import { UnitMarkers, type UnitMarker } from './unitMarkers'
import { findAirBase, airBasesForUnit } from './airBases'
import {
  DEFAULT_HOSPITAL,
  buildMultiAgencyDispatch,
  OTHER_SIDE_M,
  detectFirefighterRoads,
  evaluateMedicalPointSafety,
  type AgencyRole,
  type MedicalPointItem,
  type MultiAgencyDispatch,
  type RoadCutItem,
} from './reporting'
import { DispatchModal } from './dispatchModal'
import {
  ICON_CLIPBOARD,
  ICON_PMA,
} from './icons'
import { arrivals, wetLines, type Barrier, type WetLine } from './wetLine'
import {
  arrivalMin,
  flameLengthM,
  isAerial,
  isRoadVehicle,
  type Assignment,
  type Decision,
  type Suppression,
  type Task,
  type UnitId,
  type UnitSpec,
} from './suppression'
import './editor.css'

type Tool = 'point' | 'line' | 'drops' | 'pma'
export type Runs = Record<'free' | 'A' | 'B', Run>
export type Reports = Record<'free' | 'A' | 'B', Report>

/** Where the shown runs stand with the engine (main.ts): running, shown, or not there. */
export type EngineStatus =
  | { state: 'running'; name: string }
  | { state: 'done'; name: string; seconds: number; note?: string } // 0: all from the API's cache; the note is a small caveat
  | { state: 'down'; name: string; reason: string }

/** The "Simular modelo rápido" button: lit only when the means differ from what the last simulation ran. */
export interface SimulateState {
  label: string
  enabled: boolean
  note: string
}

export interface EditorActions {
  /** The decisions changed (nothing runs by itself: main.ts only updates the simulate button). */
  changed(): void
  /** The simulate button was pressed. */
  simulate(): void
  /** The drawer opened or closed. */
  editing(open: boolean): void
  reporting(open: boolean): void
}

const SNAP_M = 400 // a click further than this from any road stays where it is
const ACCESS_SHOWN_M = 2500 // access dots are shown this far from the ignition while a point tool is on
const TASK_NAME: Record<Task, string> = {
  direct: 'ataque direto',
  line: 'linha apeada',
  drops: 'linha aérea',
  protect: 'proteção',
  shuttle: 'abastecimento',
}
/** How "Meios no terreno" is grouped, in this order. */
const GROUPS = [
  { kind: 'air', name: 'Meios aéreos' },
  { kind: 'vehicle', name: 'Veículos terrestres' },
  { kind: 'foot', name: 'Equipas apeadas' },
] as const
type Kind = (typeof GROUPS)[number]['kind']
const kindOf = (unit: UnitSpec): Kind => (isAerial(unit) ? 'air' : unit.waterL ? 'vehicle' : 'foot')
const ILS_BUDGET_MS = 10_000 // the search for B (optimize.ts): ~2000 plans
const ILS_SHOW_MS = 1500 // while it runs, B on the map follows its best plan at most this often
const ILS_HORIZON_MIN = 360 // the ILS judges its plans at 6 h of the fast model: ~5 ms a plan, where 24 h costs several times that
const AMBER = Color.fromCssColorString('#f0a33a')
const INK = Color.fromCssColorString('#d9dcdf')
const WET = Color.fromCssColorString('#7dd3fc') // the barriers the engines get: wet lines and dug lines, light blue
const ROUTE = Color.fromCssColorString('#1e3a8a') // means' road routes: dark blue
const ROUTE_HALO = Color.fromCssColorString('#e2e8f0').withAlpha(0.45)

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
  <section class="simulate">
    <button type="button" data-ref="simulate" class="primary-btn simulate-btn" title="Corre o modelo rápido para Livre, A e B. ELMFIRE em pausa para a demo."></button>
    <p class="note" data-ref="simulateNote"></p>
  </section>
  <section class="ils top-ils">
    <h3>Proposta Decisão B</h3>
    <button type="button" data-ref="ils" class="primary-btn ils-btn" title="Procura uma proposta B com os meios de A durante até 10 s. Substitui o plano B apenas ao carregar neste botão; depois carregue em Simular modelo rápido."></button>
    <p class="note" data-ref="ilsNote"></p>
    <ul class="assignments changes" data-ref="ilsChanges"></ul>
  </section>
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
    <div class="units" data-ref="units" role="group" aria-label="Meio a colocar no mapa"></div>
    <div class="palette">
      <div class="field"><label data-ref="fromLabel">Quartel</label><select data-ref="from" title="Origem do meio"></select></div>
      <div class="field"><label>Tarefa</label><select data-ref="task" title="Tarefa"></select></div>
      <div class="field"><label>Quantos</label><div class="count">
        <button type="button" data-ref="less" title="Menos">−</button>
        <span data-ref="count">1</span>
        <button type="button" data-ref="more" title="Mais">+</button>
      </div></div>
    </div>
    <p class="note stock" data-ref="stock"></p>
    <div class="line-actions" data-ref="lineActions" hidden>
      <button type="button" class="finish-line-btn" data-ref="finishLine" disabled title="Concluir e registar esta linha nos meios no terreno">✓ Concluir Linha</button>
      <button type="button" class="cancel-line-btn" data-ref="cancelLine" title="Cancelar traçado da linha">✕ Cancelar</button>
    </div>
    <p class="note hint" data-ref="hint"></p>
  </section>
  <section class="deployment-guidance" data-ref="arrivalGuidance" aria-label="Chegada do fogo e cores dos quartéis"></section>
  <section class="pma-section">
    <h3>Posto de Socorro (INEM)</h3>
    <button type="button" data-ref="addPma" class="primary-btn pma-btn" style="background:#059669;border-color:#10b981;color:#fff;width:100%;padding:8px 10px;display:flex;align-items:center;justify-content:center;gap:6px;" title="Colocar Posto Médico Avançado (PMA)">${ICON_PMA} Posto de Socorro (INEM / PMA)</button>
    <p class="note" data-ref="pmaNote">Defina o Posto Médico Avançado e corredor de evacuação seguro para o hospital.</p>
  </section>
  <section class="end">
    <h3>Fim do incêndio <span data-ref="engine"></span></h3>
    <table class="report ends" data-ref="ends"></table>
    <p class="note" data-ref="engineNote"></p>
  </section>
  <section>
    <h3>Relatório <span data-ref="reportAt"></span></h3>
    <table class="report" data-ref="report"></table>
    <p class="note verdict" data-ref="verdict"></p>
    <p class="note" data-ref="detail"></p>
    <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(220,224,228,0.15);display:flex;flex-direction:column;gap:6px;">
      <button type="button" data-ref="openDispatch" class="primary-btn" style="background:#2563eb;border-color:#3b82f6;width:100%;" title="Gerar e enviar despachos às forças no terreno">${ICON_CLIPBOARD} Reportar às Entidades (PSP / INEM)</button>
    </div>
  </section>
  <footer>
    <button type="button" data-ref="clear">Limpar esta decisão</button>
    <button type="button" data-ref="reset" title="Repõe o exemplo na decisão selecionada">Repor exemplo</button>
  </footer>
`

interface Loaded {
  fireId: string
  fire: Fire
  stations: NearStation[]
  context: Context | undefined
  scenario: Scenario
  example: Decision // A as it starts
}

/** Clips road coordinates to only the contiguous segments engulfed by the active fire perimeter. */
function clipRoadToFire(
  pts: [number, number][],
  grid: Grid,
  arrival: Float32Array,
  currentMin: number,
): [number, number][][] {
  const segments: [number, number][][] = []
  let current: [number, number][] = []

  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i]
    const cell = cellOf(grid, { lon: pt[0], lat: pt[1] })
    const isBurned = cell >= 0 && arrival[cell] <= currentMin

    if (isBurned) {
      if (current.length === 0 && i > 0) {
        current.push(pts[i - 1])
      }
      current.push(pt)
    } else {
      if (current.length > 0) {
        current.push(pt)
        if (current.length >= 2) {
          segments.push(current)
        }
        current = []
      }
    }
  }

  if (current.length >= 2) {
    segments.push(current)
  }

  return segments
}

const NO_ENTRY_CANVASES = new Map<string, HTMLCanvasElement>()

/** `veiculo`: the block a working vehicle puts on its road, in a softer red than the fire's cuts. */
function getNoEntrySignCanvas(urgency: RoadCutItem['urgency'] | 'veiculo' = 'cortado'): HTMLCanvasElement {
  const cached = NO_ENTRY_CANVASES.get(urgency)
  if (cached) return cached

  // High-DPI canvas (48x48) rendered sharp and discreet at 18x18 on the 3D map
  const canvas = document.createElement('canvas')
  canvas.width = 48
  canvas.height = 48
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const color =
    urgency === 'cortado'
      ? '#dc2626'
      : urgency === 'veiculo'
        ? '#e57373'
      : urgency === 'urgente'
        ? '#ea580c'
        : '#d97706'

  const cx = 24
  const cy = 24
  const r = 20

  // Drop shadow for contrast on any 3D terrain
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetY = 1.5

  // Dark outline ring
  ctx.beginPath()
  ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2)
  ctx.fillStyle = '#0f172a'
  ctx.fill()

  // White border
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  // Inner colored circle (Red or Amber)
  ctx.beginPath()
  ctx.arc(cx, cy, r - 2.5, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()

  // White horizontal prohibition bar (No Entry ⛔)
  ctx.fillStyle = '#ffffff'
  const barW = 24
  const barH = 6
  const barR = 2
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(cx - barW / 2, cy - barH / 2, barW, barH, barR)
  } else {
    ctx.rect(cx - barW / 2, cy - barH / 2, barW, barH)
  }
  ctx.fill()

  NO_ENTRY_CANVASES.set(urgency, canvas)
  return canvas
}

export class Editor {
  readonly el: HTMLElement
  decisions: [Decision, Decision] = [empty('A'), empty('B')]
  private active = 0
  private playbackMinute = 0
  private tool: Tool | null = null
  private drawing: LonLat[] = []
  private unit: UnitId = 'vfci'
  private count = 1
  private task: Task = 'direct'
  private fromId = 'none' // station id of the next assignment ('air' for aerial units)
  /** Minute of the simulation the drawer shows: the split and the report follow it. */
  private minutes = 360
  private loaded: Loaded | undefined
  private runs: Runs | undefined // the last explicit simulation of A and B (with Livre); none before the first
  private free: Run | undefined // Livre, the cached ELMFIRE run: all there is before the first simulation
  private wetCache = new WeakMap<Decision, { scenario: Scenario; arrival: Float32Array; key: string; lines: WetLine[] }>()
  private maxMin = 360 // the clock and the slider stop here: the cut of the runs, or when the fires are out
  private reports: Reports | undefined
  private judged: Reports | undefined
  private engine: EngineStatus | undefined
  private readonly source = new CustomDataSource('decisions')
  private readonly access = new CustomDataSource('access')
  private readonly routes = new CustomDataSource('routes')
  private readonly hazards = new CustomDataSource('hazards')
  private readonly agency = new CustomDataSource('agency')
  private dangerTimer?: number
  /** The assignments of a decision last shown late, so that only a new one warns. */
  private lateShown: { id: string; keys: Set<string> } = { id: '', keys: new Set() }
  /** The search for B while it runs: what it says, its last word, its best plan on the map and the better one not yet there. */
  private ils: { worker: Worker; byHand: boolean; shownAt: number; note: string; last?: Progress; shown?: Progress; pending?: Progress } | undefined
  /** The last search's B and how it differs from A, while B is still that plan; stopped when ended by hand. */
  private ilsDone: { result: Result; changes: Change[]; stopped?: boolean } | undefined
  /** The A that B was searched for, and B as the search left it (planKey): B changed by hand differs. */
  private ilsFor = ''
  private ilsB = ''
  private readonly dispatchModal = new DispatchModal()
  pmaList: MedicalPointItem[] = []
  role: AgencyRole = 'cmd'
  private cutTooltip: HTMLElement | null = null
  private hoverPosition = new Cartesian2()
  private hoveredItem: unknown
  private hoveredMinute = -1
  private dispatchCache: { loaded: Loaded; run: Run; minutes: number; pma: MedicalPointItem[]; decision?: Decision; assignmentsLen?: number; value: MultiAgencyDispatch } | undefined
  private readonly tip: HTMLElement
  private readonly unitMarkers: UnitMarkers
  private readonly handler: ScreenSpaceEventHandler
  private readonly refs: Record<string, HTMLElement>
  readonly reportPanel: HTMLElement
  private currentFlameM = 0

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
    // On the body: the drawer's blur would make it the box of a fixed child, and its scroll would clip it.
    this.tip = document.createElement('div')
    this.tip.className = 'editor-tip'
    this.tip.id = 'means-hint'
    this.tip.setAttribute('role', 'tooltip')
    this.tip.hidden = true
    document.body.append(this.tip)
    this.el.addEventListener('scroll', () => this.hideTip(), { passive: true })
    this.refs = Object.fromEntries(
      [...this.el.querySelectorAll<HTMLElement>('[data-ref]')].map((el) => [el.dataset.ref, el]),
    )
    this.reportPanel = document.createElement('aside')
    this.reportPanel.className = 'editor reports-panel'
    this.reportPanel.hidden = true
    this.reportPanel.setAttribute('aria-label', 'Relatórios')
    this.reportPanel.innerHTML = '<header><span>Relatórios · impacto das decisões</span><button type="button" aria-label="Fechar relatórios">×</button></header>'
    this.reportPanel.querySelector('button')!.addEventListener('click', () => this.toggleReports(false))
    this.reportPanel.append(this.refs.ends.closest('section')!, this.refs.report.closest('section')!)
    this.root.append(this.reportPanel)
    void viewer.dataSources.add(this.source)
    void viewer.dataSources.add(this.access)
    void viewer.dataSources.add(this.routes)
    void viewer.dataSources.add(this.hazards)
    void viewer.dataSources.add(this.agency)
    this.unitMarkers = new UnitMarkers(viewer, document.getElementById('overlay') ?? root)
    this.handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    this.handler.setInputAction((e: { position: Cartesian2 }) => this.click(e.position), ScreenSpaceEventType.LEFT_CLICK)
    mapHover(viewer.scene.canvas, viewer.camera, (position) => this.hover(position), () => {
      this.hideCutTooltip()
      viewer.scene.canvas.style.cursor = 'default'
    }, () => !!(this.source.entities.values.length || this.agency.entities.values.length || (this.open && this.tool && this.loaded)))
    this.handler.setInputAction(() => {
      if (this.open && (this.tool === 'line' || this.tool === 'drops') && this.drawing.length >= 2) {
        this.finishLine()
      }
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

    // One button per kind of means: it arms the map, and each click there places it (a line task draws).
    for (const [id, spec] of Object.entries(sup.units)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.unit = id
      button.setAttribute('aria-label', `${spec.name}: escolher e colocar no mapa`)
      button.setAttribute('aria-pressed', 'false')
      button.setAttribute('aria-describedby', 'means-hint')
      const icon = document.createElement('img')
      icon.alt = ''
      icon.src = unitIconUrl(id as UnitId)
      const label = document.createElement('span')
      label.textContent = id === 'crew' ? 'Brigada' : spec.short
      button.append(icon, label)
      const hint = id === 'vttu' ? `Cisterna · ${spec.waterL?.toLocaleString('pt-PT')} L. Apoia VFCI num raio de 300 m e repõe água nas equipas próximas.`
        : id === 'vfci' ? `VFCI · ${spec.people} operacionais. Proteção cresce de 53 até 300 m após a chegada; reforços alargam a cobertura. Coloque num acesso seguro; uma cisterna próxima prolonga o apoio.`
        : id === 'crew' ? `Brigada · ${spec.people} operacionais. Proteção cresce de 28 até 160 m após a chegada; reforços alargam a cobertura. Pode atuar fora das estradas.`
        : `${spec.name} · apoio aéreo. Escolha a base e o ponto de intervenção; a chegada depende da distância e da mobilização.`
      button.addEventListener('mouseenter', () => this.showTip(button, hint))
      button.addEventListener('focus', () => this.showTip(button, hint))
      button.addEventListener('mouseleave', () => this.hideTip())
      button.addEventListener('blur', () => this.hideTip())
      button.addEventListener('click', () => { this.hideTip(); this.arm(id as UnitId) })
      this.refs.units.append(button)
    }
    this.renderUnits()
    const from = this.refs.from as HTMLSelectElement
    from.addEventListener('change', () => {
      this.fromId = from.value
      this.setCount(this.count)
    })
    const hour = this.refs.hour as HTMLInputElement
    hour.addEventListener('input', () => this.setMinutes(Number(hour.value)))
    const task = this.refs.task as HTMLSelectElement
    task.addEventListener('change', () => {
      this.task = task.value as Task
      if (this.tool && this.tool !== 'pma') this.setTool(this.toolFor())
    })
    this.updateTaskDropdown()
    this.refs.less.addEventListener('click', () => this.setCount(this.count - 1))
    this.refs.more.addEventListener('click', () => this.setCount(this.count + 1))
    this.refs.simulate.addEventListener('click', () => this.actions.simulate())
    this.refs.ils.addEventListener('click', () => {
      if (!this.ils) return this.runIls(true)
      this.stopIls(true)
    })
    this.refs.close.addEventListener('click', () => this.toggle(false))
    this.refs.openDispatch?.addEventListener('click', () => this.openDispatchDialog())
    this.refs.addPma?.addEventListener('click', () => { this.toggle(true); this.togglePmaTool() })
    this.refs.clear.addEventListener('click', () => {
      const d = this.decisions[this.active]
      this.decisions[this.active] = { ...empty(d.id), name: d.name, nextAssignmentId: d.nextAssignmentId }
      this.commit()
    })
    this.refs.reset.addEventListener('click', () => {
      if (!this.loaded) return
      const { id, nextAssignmentId } = this.decisions[this.active]
      this.decisions[this.active] = { ...clone(this.loaded.example), id, name: `Decisão ${id}`, nextAssignmentId }
      for (const a of this.decisions[this.active].assignments) { a.dispatchMin = this.dispatchMinute(); a.orderedMin = this.minutes }
      this.commit()
    })
    const name = this.refs.name as HTMLInputElement
    name.addEventListener('change', () => {
      this.decisions[this.active].name = name.value.trim() || this.decisions[this.active].id
      this.commit()
    })
    this.refs.finishLine?.addEventListener('click', () => this.finishLine())
    this.refs.cancelLine?.addEventListener('click', () => this.setTool(null))
    for (const tab of this.refs.tabs.querySelectorAll<HTMLElement>('[data-tab]'))
      tab.addEventListener('click', () => {
        this.active = Number(tab.dataset.tab)
        this.cancel()
        this.render()
      })
    this.renderPalette()
    this.toggle(false)
  }

  get open(): boolean {
    return this.el.classList.contains('open')
  }

  get decisionIndex(): number { return this.active }

  /** The director shows decision `i` on the ground: it becomes the drawer's tab too. */
  showDecision(i: number) {
    if (i === this.active) return
    this.active = i
    this.cancel()
    this.render()
  }

  /** Decision `i`'s barriers, as the scenario's `decision.barriers` sends them to the engines (docs/contracts.md). */
  barriers(i: number): Barrier[] {
    return this.wetLinesOf(this.decisions[i]).map((w) => w.barrier)
  }

  /** A decision's barriers with what laid each one (wetLine.ts), the same the ELMFIRE API receives. */
  private wetLinesOf(d: Decision): WetLine[] {
    if (!this.loaded) return []
    const { scenario } = this.loaded
    const key = JSON.stringify([d.points, d.lines, d.assignments])
    const arrival = forecastArrival(scenario)
    const cached = this.wetCache.get(d)
    if (cached?.scenario === scenario && cached.arrival === arrival && cached.key === key) return cached.lines
    const lines = scenario.demo ? demoLines(scenario, d) : wetLines(scenario, d, arrival)
    this.wetCache.set(d, { scenario, arrival, key, lines })
    return lines
  }

  /** Hours after the ignition the drawer stands at. */
  get hours(): number {
    return this.minutes / 60
  }

  setHours(hours: number) {
    this.setMinutes(Math.round((Math.min(Math.max(hours, 0), this.maxMin / 60) * 60) / 5) * 5)
  }

  /** Synchronizes simulation hour with active playback or timeline, updating road cuts and tactical perimeters dynamically. */
  syncTime(hours: number, force = false) {
    this.playbackMinute = hours * 60
    const targetMin = Math.round(Math.max(0, hours) * 60)
    if (this.minutes !== targetMin || force) {
      this.minutes = targetMin
      const hour = this.refs.hour as HTMLInputElement
      if (hour) hour.value = String(targetMin) // focused too: the clock follows a moved slider, nothing fights the drag
      const start = this.loaded?.fire.start
      if (this.refs.hourText) {
        this.refs.hourText.textContent = `${fmtElapsed(this.hours)}${start ? ` · ${fmtTime(wallClock(start, this.hours))}` : ''}`
      }
      this.updateEtas()
      this.renderReport()
      this.draw()
      const hovered = this.hoveredItem as { assignment?: Assignment; point?: LonLat; allUnits?: Assignment[]; displayId?: string } | undefined
      if (hovered?.assignment && hovered.point && hovered.allUnits && this.cutTooltip && !this.cutTooltip.hidden)
        this.showUnitTooltip(new Cartesian2(this.hoverPosition.x, this.hoverPosition.y), hovered as Parameters<Editor['showUnitTooltip']>[1])
    }
  }

  private setMinutes(minutes: number) {
    this.minutes = minutes
    this.playbackMinute = minutes
    const hour = this.refs.hour as HTMLInputElement
    hour.value = String(minutes)
    const start = this.loaded?.fire.start
    this.refs.hourText.textContent = `${fmtElapsed(this.hours)}${start ? ` · ${fmtTime(wallClock(start, this.hours))}` : ''}`
    this.updateEtas()
    this.renderReport()
    this.draw()
  }

  get reportsOpen() { return !this.reportPanel.hidden }

  toggleReports(open = !this.reportsOpen) {
    if (open) this.toggle(false)
    this.reportPanel.hidden = !open
    this.reportPanel.classList.toggle('open', open)
    if (open) { this.renderEnds(); this.renderReport() }
    this.actions.reporting(open)
  }

  toggle(open = !this.open) {
    if (this.role !== 'cmd' && open) return
    if (open) this.toggleReports(false)
    if (open === this.open) return
    this.el.classList.toggle('open', open)
    if (!open) {
      this.setTool(null)
      this.hideCutTooltip()
      this.hideTip()
    }
    this.actions.editing(open)
  }

  /** A fire opened: A starts empty, with nothing on the ground ("Repor exemplo" brings the example
   *  back, on the roads), and B with it. Decisions are not kept across visits. */
  setFire(
    fireId: string,
    fire: Fire,
    stations: NearStation[],
    context: Context | undefined,
    scenario: Scenario,
    example: Decision,
    intensityKWPerM?: number,
  ) {
    const points = Object.fromEntries(
      Object.entries(example.points).map(([id, p]) => [id, context && example.assignments.some((a) => a.target === id && isRoadVehicle(this.sup.units[a.unit]))
        ? (snapToRoad(context, p, SNAP_M) ?? p) : p]),
    )
    const snapped = { ...clone(example), points: Object.fromEntries(Object.entries(points).map(([id, p]) => [id, { lon: p.lon, lat: p.lat }])) }
    this.stopIls()
    this.ilsDone = undefined
    this.loaded = { fireId, fire, stations, context, scenario, example: this.fit(snapped, scenario, stations) }
    this.decisions = [empty('A'), empty('B')]
    this.ilsFor = this.ilsB = ''
    this.runs = this.reports = this.judged = this.engine = this.free = undefined
    this.dispatchCache = undefined
    this.active = 0
    this.fromId = stations[0]?.id ?? 'none'
    this.updateStationDropdown()
    this.setRange(scenario.durationMin)
    this.setMinutes(0)
    this.cancel()
    this.setCount(this.count)

    const intensity = intensityKWPerM ?? fire.periods[0]?.intensityKWPerM ?? 2000
    this.currentFlameM = flameLengthM(this.sup, intensity)

    this.render()
  }

  /** Opens the editor, selects the appropriate aerial unit (HEBL/AVBP) and the closest CMA base with stock. */
  mobilizeAerial(flameM?: number) {
    this.toggle(true)
    const flame = flameM ?? this.currentFlameM
    const chosenUnit: UnitId = flame >= 3.4 ? 'avbp' : 'hebl'
    this.setUnit(chosenUnit)
    const bases = airBasesForUnit(chosenUnit)
    const ignition = this.loaded?.scenario.ignition
    if (ignition) {
      const sorted = [...bases].sort((a, b) => distanceM(a, ignition) - distanceM(b, ignition))
      const available = sorted.find((b) => this.available(chosenUnit, b.id) > 0) ?? sorted[0]
      if (available) {
        this.fromId = available.id
        const fromSelect = this.refs.from as HTMLSelectElement
        if (fromSelect) fromSelect.value = this.fromId
        this.setCount(1)
      }
    }
    this.task = 'drops'
    ;(this.refs.task as HTMLSelectElement).value = 'drops'
    this.setTool('drops')
    const baseObj = findAirBase(this.fromId)
    this.refs.hint.classList.remove('danger', 'late')
    this.refs.hint.textContent = `✓ ${this.sup.units[chosenUnit].name} (${chosenUnit.toUpperCase()}) da base ${baseObj?.short ?? 'mais próxima'} pronto! Clica no mapa para os vértices da linha aérea de descargas (duplo clique ou Enter conclui).`
  }

  /** The clock and the hour slider end at this minute (main.ts: the cut of the runs, or when they are out). */
  setRange(minutes: number) {
    this.maxMin = Math.max(5, Math.ceil(minutes / 5) * 5)
    const hour = this.refs.hour as HTMLInputElement
    hour.max = String(this.maxMin)
    if (this.minutes > this.maxMin) this.setMinutes(this.maxMin)
  }

  /** Livre, the cached ELMFIRE run, before A and B have been simulated. */
  setFree(free: Run | undefined) {
    this.free = free
    this.renderEnds()
  }

  /** The state of the simulate button (main.ts compares the means with the last simulation's). */
  setSimulate({ label, enabled, note }: SimulateState) {
    const button = this.refs.simulate as HTMLButtonElement
    button.textContent = label
    button.disabled = !enabled
    this.refs.simulateNote.textContent = note
  }

  /** The runs of Livre, A and B of the last ELMFIRE simulation, their reports when the fire has OSM context, and those the verdict compares. */
  setRuns(runs: Runs | undefined, reports: Reports | undefined, judged = reports) {
    this.runs = runs
    this.reports = reports
    this.judged = judged
    this.render()
  }

  /** What the engine is doing with the runs on the screen. */
  setEngine(status: EngineStatus) {
    this.engine = status
    this.renderEnds()
  }

  /** Whether B is being searched (or about to be): it changes every 1.5 s until the search ends. */
  get searching(): boolean {
    return this.ils !== undefined
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

  /** What the station or CMA has of a unit (inventory.json or airBases.ts). */
  private stock(unit: UnitId, from: string): number | undefined {
    if (isAerial(this.sup.units[unit])) {
      const base = findAirBase(from)
      return base?.units[unit]
    }
    const stock = this.inventory?.[from]
    if (!stock) return undefined
    if (unit === 'crew') return stock.decir.ecin + stock.decir.eip
    return stock.units[unit]
  }

  /** How many of a unit the station still has for the active decision. */
  private available(unit: UnitId, from: string): number {
    const stock = this.stock(unit, from)
    if (stock === undefined) return 6
    const used = this.decisions[this.active].assignments.reduce((n, a) => (a.unit === unit && a.from === from ? n + a.count : n), 0)
    return Math.max(0, stock - used)
  }

  /** How many of the palette's unit go out now: the count, cut to what the station has left. */
  private placeable(): number {
    const from = this.from(this.loaded?.stations ?? [])
    const left = this.available(this.unit, from)
    if (left > 0) return Math.min(this.count, left)
    const unit = this.sup.units[this.unit]
    const base = isAerial(unit) ? findAirBase(from) : undefined
    const station = !base ? this.loaded?.stations.find((s) => s.id === from) : undefined
    const name = base?.short ?? station?.short ?? from
    this.setTool(null)
    this.refs.hint.classList.add('danger')
    this.refs.hint.textContent = `${name} já não tem ${unit.short} disponíveis nesta decisão: retira um do terreno ou escolhe outr${base ? 'a base aérea' : 'o quartel'}.`
    return 0
  }

  /** A decision within what the stations have (stored before the limit, or an example near a small
   *  station): counts are cut to the stock in order, and an assignment left with none goes. */
  private fit(d: Decision, _scenario: Scenario, stations: NearStation[]): Decision {
    const used = new Map<string, number>()
    const assignments: Assignment[] = []
    const dropped = new Set<string>()
    for (const a of d.assignments) {
      // Only the stations in play, and ground means from those stations (aircraft are exempt).
      const ground = !isAerial(this.sup.units[a.unit])
      if (ground && !stations.some((s) => s.id === a.from)) {
        dropped.add(a.target)
        continue
      }
      const key = `${a.unit}|${a.from}`
      const stock = this.stock(a.unit, a.from)
      const count = stock === undefined ? a.count : Math.min(a.count, stock - (used.get(key) ?? 0))
      if (count < 1) {
        dropped.add(a.target)
        continue
      }
      used.set(key, (used.get(key) ?? 0) + count)
      assignments.push({ ...a, count })
    }
    for (const a of assignments) dropped.delete(a.target)
    const keep = <T>(targets: Record<string, T>) => Object.fromEntries(Object.entries(targets).filter(([id]) => !dropped.has(id)))
    return { ...d, assignments, points: keep(d.points), lines: keep(d.lines) }
  }

  private setTool(tool: Tool | null) {
    const unit = this.sup.units[this.unit]
    if (tool === 'line' && !unit.lineMPerH) tool = null
    if (tool === 'drops' && !isAerial(unit)) tool = null
    this.tool = tool
    if (!tool) { this.relocating = undefined; this.editingPlacement = undefined }
    this.drawing = []
    this.viewer.scene.canvas.style.cursor = tool ? 'crosshair' : ''
    this.renderUnits()
    this.refs.hint.classList.remove('danger', 'late')
    this.updateLineActionsUI()
    if (tool !== 'pma') {
      this.refs.addPma?.classList.remove('active')
    }
    if (!tool) {
      this.refs.hint.textContent = ''
    } else if (tool === 'point') {
      this.refs.hint.textContent = isAerial(unit)
        ? `Clica no mapa onde o ${unit.short} descarrega. Escolhe outra vez o meio para parar.`
        : isRoadVehicle(unit)
          ? `Clica no mapa: o ${unit.short} fica no ponto de acesso mais próximo protege uma área circular. Escolhe outra vez o meio para parar.`
          : `Clica em qualquer ponto do terreno para colocar a equipa apeada, sem alinhar à estrada. Escolhe outra vez o meio para parar.`
    }
    this.drawAccess()
    this.draw()
  }

  /** A unit's button: the first press arms the map with it, the next one (or Escape) stops. */
  private arm(unit: UnitId) {
    if (this.tool && this.tool !== 'pma' && this.unit === unit) {
      if ((this.tool === 'line' || this.tool === 'drops') && this.drawing.length >= 2) return this.finishLine()
      return this.setTool(null)
    }
    this.setUnit(unit)
    this.setTool(this.toolFor())
  }

  /** What a click on the map does with the palette's task: a point, or the next vertex of a line. */
  private toolFor(): Tool {
    return this.task === 'line' ? 'line' : this.task === 'drops' ? 'drops' : 'point'
  }

  /** The unit buttons: the palette's unit, pressed while it is armed on the map. */
  private renderUnits() {
    for (const button of this.refs.units.querySelectorAll<HTMLButtonElement>('[data-unit]')) {
      const mine = button.dataset.unit === this.unit
      const armed = mine && this.tool !== null && this.tool !== 'pma'
      button.classList.toggle('sel', mine)
      button.classList.toggle('on', armed)
      button.setAttribute('aria-pressed', String(armed))
    }
  }

  private updateLineActionsUI() {
    if (!this.refs.lineActions) return
    const isLine = this.tool === 'line' || this.tool === 'drops'
    this.refs.lineActions.hidden = !isLine
    if (!isLine) return

    const finishBtn = this.refs.finishLine as HTMLButtonElement
    if (!finishBtn) return

    const len = this.drawing.length
    if (len < 2) {
      finishBtn.disabled = true
      finishBtn.textContent = '✓ Concluir Linha'
      finishBtn.title = 'Uma linha precisa de pelo menos 2 pontos desenhados no mapa'
      this.refs.hint.classList.remove('danger', 'late')
      this.refs.hint.textContent =
        len === 1
          ? '📍 1º vértice colocado no mapa. Clica para colocar o próximo vértice da linha.'
          : this.tool === 'line'
            ? '📍 Primeiro clique: posição da equipa. Segundo clique: direção da sua linha de 100 m.'
            : '📍 Clica no mapa para colocar os vértices da linha aérea de descargas.'
    } else {
      const lenM = this.tool === 'line' ? demoLineLength({ unit: 'crew' }) : lineLengthM(this.drawing)
      finishBtn.disabled = false
      finishBtn.textContent = '✓ Concluir Linha'
      finishBtn.title = 'Concluir traçado e registar linha nos meios no terreno'

      this.refs.hint.classList.remove('danger', 'late')
      this.refs.hint.textContent = `📍 ${len} vértices · ${fmtNumber(lenM)} m por meio. Clica em "✓ Concluir Linha", duplo clique no mapa, ou Enter.`
    }
  }

  private cancel() {
    this.setTool(null)
    this.hazards.entities.removeAll()
    if (this.dangerTimer !== undefined) {
      window.clearTimeout(this.dangerTimer)
      this.dangerTimer = undefined
    }
    this.refs.hint.classList.remove('danger', 'late')
  }

  /** Interactive cursor feedback and tooltips for road cuts, PMA, and active fire perimeter */
  private hover(position: Cartesian2) {
    // 1. Check if hovering over any road cut, PMA, or deployed firefighting unit
    const hasItems = this.source.entities.values.length || this.agency.entities.values.length
    const picked = hasItems ? this.viewer.scene.pick(position) : undefined
    const cut: RoadCutItem | undefined = (picked?.id as any)?._roadCut
    const pma: MedicalPointItem | undefined = (picked?.id as any)?._pma
    const unitInfo = (picked?.id as any)?._unitInfo

    const item = cut ?? pma ?? unitInfo
    this.hoverPosition = Cartesian2.clone(position, this.hoverPosition)
    if (item && item === this.hoveredItem && this.minutes === this.hoveredMinute && this.cutTooltip && !this.cutTooltip.hidden) {
      this.positionTooltip(position)
      return
    }
    this.hoveredItem = item
    this.hoveredMinute = this.minutes

    if (cut) {
      this.showCutTooltip(position, cut)
      this.viewer.scene.canvas.style.cursor = 'pointer'
      return
    } else if (pma) {
      this.showPmaTooltip(position, pma)
      this.viewer.scene.canvas.style.cursor = 'pointer'
      return
    } else if (unitInfo) {
      this.showUnitTooltip(position, unitInfo)
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
    const aerial = isAerial(this.sup.units[this.unit])
    const forbidden = !aerial && (isFire || this.fireFirst(p) !== undefined)
    this.viewer.scene.canvas.style.cursor = forbidden ? 'not-allowed' : 'crosshair'
  }

  private positionTooltip(position: Cartesian2) {
    const tip = this.cutTooltip
    if (!tip) return
    this.hoverPosition = Cartesian2.clone(position, this.hoverPosition)
    const rect = tip.getBoundingClientRect?.()
    const width = this.viewer.scene.canvas.clientWidth ?? 10000
    const height = this.viewer.scene.canvas.clientHeight ?? 10000
    const x = Math.min(Math.max(12, position.x + 14), Math.max(12, width - (rect?.width ?? 280) - 12))
    const above = position.y - (rect?.height ?? 180) - 14
    const y = Math.min(Math.max(12, above >= 12 ? above : position.y + 14), Math.max(12, height - (rect?.height ?? 180) - 12))
    tip.style.left = `${x}px`
    tip.style.top = `${y}px`
  }

  private showHover(position: Cartesian2, heading: string, body: string, type = '') {
    if (!this.cutTooltip) {
      this.cutTooltip = document.createElement('div')
      this.root.append(this.cutTooltip)
    }
    this.cutTooltip.className = `road-cut-tooltip ${type}`
    this.cutTooltip.innerHTML = `<header class="hover-title">${heading}</header>${body}`
    this.cutTooltip.hidden = false
    this.positionTooltip(position)
  }

  private showCutTooltip(position: Cartesian2, cut: RoadCutItem) {
    if (cut.kind === 'firefighters') {
      this.showHover(
        position,
        `Estrada · ${escapeText(cut.label)}`,
        `<ul class="hover-facts">
          <li><span>Estado</span><b>Atuação de Bombeiros (${escapeText(cut.firefighterUnit ?? 'Bombeiros')})</b></li>
          <li><span>Via</span><b>${cut.isPaved ? 'Pavimentada' : 'Rural / florestal'}</b></li>
          <li><span>Ação PSP / GNR</span><b>Corte de trânsito do fogo até ${cut.barrier ? `${OTHER_SIDE_M / 1000} km para lá do veículo` : 'ao veículo'} · Reforços autorizados</b></li></ul>`,
        'road',
      )
      return
    }
    const state = cut.urgency === 'cortado' ? 'Interditada (Zona de Fogo)' : `Impacto em ${cut.minutesToImpact} min`
    this.showHover(
      position,
      `Estrada · ${escapeText(cut.label)}`,
      `<ul class="hover-facts">
        <li><span>Estado</span><b>${state}</b></li>
        <li><span>Via</span><b>${cut.isPaved ? 'Pavimentada' : 'Rural / florestal'}</b></li>
        <li><span>Ação PSP / GNR</span><b>Interditar e desviar tráfego</b></li></ul>`,
      'road',
    )
  }

  private showPmaTooltip(position: Cartesian2, pma: MedicalPointItem) {
    this.showHover(position, `Socorro · ${escapeText(pma.name)}`, `<ul class="hover-facts">
      <li><span>Margem segura</span><b>${Math.round(pma.safeBufferMin)} min</b></li>
      <li><span>Destino</span><b>${escapeText(pma.hospitalDestination ?? DEFAULT_HOSPITAL.name)}</b></li>
      <li><span>Evacuação</span><b>${pma.routeKm ? `${pma.routeKm.toFixed(1)} km · ${Math.round(pma.etaMin ?? 0)} min` : 'Rota ativa'}</b></li></ul>`, 'inem')
  }

  private showUnitTooltip(position: Cartesian2, info: {
    assignment: Assignment; point: LonLat; allUnits: Assignment[]; lines?: WetLine[]; displayId?: string
  }) {
    if (!this.loaded) return
    const a = info.assignment
    const d = this.decisions[this.active]
    const slot = d.assignments.indexOf(a)
    if (slot < 0) return this.hideCutTooltip()
    const spec = this.sup.units[a.unit]
    const combat = resourceAt(cachedCombatResources(this.loaded.scenario,d),slot,this.playbackMinute)
    const status = {onScene:this.playbackMinute>=combat.arrival,elapsed:Math.max(0,this.playbackMinute-combat.arrival),eta:Math.max(0,combat.arrival-this.playbackMinute),waterPct:Math.round(combat.waterPct),capacity:90,remaining:90*combat.autonomyPct/100}
    const station = this.loaded.stations.find(s => s.id === a.from)
    const base = findAirBase(a.from)
    const code = info.displayId ?? fieldIds(d, this.loaded.stations)[slot].join(' · ')
    const origin = `${originLetter(a.from, this.loaded.stations)} · ${station?.short ?? base?.short ?? 'Base'}`
    const timeText = status.onScene ? `${timeMinutes(status.elapsed)} no local` : `Chega em ${timeMinutes(Math.ceil(status.eta))}`
    this.showHover(position, `<strong>${escapeText(code)}</strong><span>${escapeText(spec.short)}</span>`, `
      <div class="hover-state"><i class="${status.onScene ? 'arrived' : 'travelling'}"></i>${timeText}</div>
      <ul class="hover-facts">
        <li><span>Origem</span><b>${escapeText(origin)}</b></li>
        <li><span>Tarefa</span><b>${a.unit === 'vttu' ? 'abastecimento' : TASK_NAME[a.task]}</b></li>
        ${a.unit === 'vttu' ? `<li><span>Apoio · ${tankerReach(this.loaded.scenario)} m</span><b>Abastecimento próximo</b></li>` : ''}
      </ul>
      <div class="hover-water hover-autonomy"><span>Autonomia</span><b>${timeMinutes(status.remaining)}</b>
        <meter min="0" max="100" value="${Number.isFinite(status.capacity) ? Math.round(status.remaining/status.capacity*100) : 100}" aria-label="Autonomia restante"></meter></div>
      <div class="hover-water"><span>Água</span><b>${status.waterPct}%</b>
        <meter min="0" max="100" low="25" optimum="100" value="${status.waterPct}" aria-label="Água estimada">${status.waterPct}%</meter></div>
      <p class="hover-note">Consumo só durante contacto com fogo; pausa após 15 min sem novo contacto.</p>`, 'unit')
    this.cutTooltip!.style.setProperty('--unit-color', originColor(a.from, this.loaded.stations))
  }

  private hideCutTooltip() {
    this.hoveredItem = undefined
    if (this.cutTooltip && !this.cutTooltip.hidden) {
      this.cutTooltip.hidden = true
    }
  }

  /** The map guidance follows the selected station, means and current planning clock. */
  get deploymentSelection(): DeploymentSelection | undefined {
    if (!this.loaded || isAerial(this.sup.units[this.unit])) return undefined
    const from = this.from(this.loaded.stations)
    return { from, unit: this.unit, dispatchMin: this.dispatchMinute(),
      ecin: !this.decisions[this.active].assignments.some((a) => a.from === from && !isAerial(this.sup.units[a.unit])) }
  }

  /** New orders leave at the current fire clock, never before detection. */
  private dispatchMinute(): number {
    return Math.max(this.loaded?.scenario.dispatchMin ?? 0, this.minutes)
  }

  private boundary?: { key: string; arrival: Float32Array; blocked: Uint8Array }

  /** When the fire and the selected ground means reach `p`, if the fire gets there first: inside the
   *  dashed deployment boundary (StationRingsLayer), from the same cells. Undefined outside it. */
  private fireFirst(p: LonLat): { fireMin: number; meansMin: number } | undefined {
    const selection = this.deploymentSelection
    const scenario = this.loaded?.scenario
    const arrival = scenario?.fireArrival
    const station = this.loaded?.stations.find((s) => s.id === selection?.from)
    if (!selection || !scenario || !arrival || !station) return undefined
    const unit = this.sup.units[selection.unit]
    const key = `${selection.from}|${selection.unit}|${selection.dispatchMin}|${selection.ecin}`
    if (this.boundary?.key !== key || this.boundary.arrival !== arrival) {
      const { blocked } = deploymentBoundary(scenario.grid, arrival, { ...station, km: 0 }, this.sup, unit, selection.dispatchMin, selection.ecin)
      this.boundary = { key, arrival, blocked }
    }
    const cell = cellOf(scenario.grid, p)
    if (cell < 0 || !this.boundary.blocked[cell]) return undefined
    return { fireMin: arrival[cell], meansMin: selection.dispatchMin + arrivalMin(this.sup, unit, distanceM(station, p) / 1000, selection.ecin) }
  }

  /** Ground units must reach their point before the fire: no destination inside the dashed boundary. */
  private checkRing(p: LonLat): boolean {
    if (!this.loaded) return true
    const meeting = this.fireFirst(p)
    if (!meeting) return true
    const from = this.from(this.loaded.stations)
    const station = this.loaded.stations.find((s) => s.id === from)
    const text = `O fogo interceta os meios de ${station?.short ?? from}: chega a este ponto às T+${Math.round(meeting.fireMin)} min e os meios só às T+${Math.round(meeting.meansMin)} min. Escolhe um ponto fora do tracejado.`
    if (this.dangerTimer !== undefined) window.clearTimeout(this.dangerTimer)
    this.refs.hint.classList.add('danger')
    this.refs.hint.textContent = text
    this.hazards.entities.removeAll()
    this.hazards.entities.add({
      position: Cartesian3.fromDegrees(p.lon, p.lat),
      label: {
        text,
        font: 'bold 12px ui-monospace, Menlo, monospace',
        fillColor: Color.RED,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: 2,
        pixelOffset: new Cartesian2(0, -14),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Infinity,
      },
    })
    this.dangerTimer = window.setTimeout(() => {
      this.refs.hint.classList.remove('danger')
      this.hazards.entities.removeAll()
      this.dangerTimer = undefined
      this.refs.hint.textContent = '' // the line being drawn stays
    }, 3000)
    return false
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
      this.refs.hint.classList.remove('danger', 'late')
      this.hazards.entities.removeAll()
      this.dangerTimer = undefined
      this.setTool(this.tool)
    }, 4500)
  }

  private relocating?: number
  private editingPlacement?: { slot:number; index:number }

  private click(position: Cartesian2) {
    if (!this.open || !this.tool || !this.loaded) return
    const p = this.pick(position)
    if (!p) return

    const { context, stations, scenario } = this.loaded
    const aerial = isAerial(this.sup.units[this.unit])

    // Ground vehicles snap to road. Aerial vehicles (planes/helis) have 100% free spatial allocation!
    const access = (isRoadVehicle(this.sup.units[this.unit]) && context) ? snapToRoad(context, p, SNAP_M) : undefined
    const point = access ? { lon: access.lon, lat: access.lat } : p

    // Active fire safety check: reject placing ground crews inside active fire perimeter.
    // Aircraft drop water directly from above into active flames, so exempt them.
    const cell = cellOf(scenario.grid, point)
    const activeRun = this.runs ? (this.runs[this.decisions[this.active].id as 'A' | 'B'] ?? this.runs.free) : undefined
    const orderMinute = this.editingPlacement ? placements(scenario,this.decisions[this.active],this.editingPlacement.slot)[this.editingPlacement.index].orderedMin : this.minutes
    if (!aerial && cell >= 0 && activeRun && activeRun.arrival[cell] <= orderMinute) {
      this.showDangerWarning(point, activeRun.arrival[cell])
      return
    }

    if (this.tool === 'pma') {
      this.setPmaLocation(point)
      this.setTool(null)
      return
    }
    if (this.editingPlacement) {
      const {slot,index}=this.editingPlacement,d=this.decisions[this.active]
      try {
        editPlacement(scenario,d,slot,index,point,(from,to,minute)=>
          context&&isRoadVehicle(this.sup.units[d.assignments[slot].unit])
            ? findSafeRoute(scenario.grid,context.osm.roads,activeRun?.arrival,minute,from,to)?.path : undefined)
      } catch(e) { this.refs.hint.textContent=e instanceof Error?e.message:String(e);return }
      this.setTool(null);this.commit();return
    }
    if (this.relocating !== undefined) {
      const slot=this.relocating,d=this.decisions[this.active]
      const previous=placements(scenario,d,slot).at(-1)!.point
      const route=context&&isRoadVehicle(this.sup.units[d.assignments[slot].unit])?findSafeRoute(scenario.grid,context.osm.roads,activeRun?.arrival,this.minutes,previous,point)?.path:undefined
      try { addPlacement(scenario,d,slot,point,this.minutes,route) }
      catch(e){this.refs.hint.textContent=String(e instanceof Error?e.message:e);return}
      this.relocating=undefined;this.setTool(null);this.commit();return
    }
    const count = this.placeable()
    if (!count) return
    if (!aerial && !this.checkRing(point)) return
    if (this.tool !== 'point') {
      if (this.drawing.length > 0) {
        const last = this.drawing[this.drawing.length - 1]
        if (distanceM(last, point) < 8) return
      }
      this.drawing.push(point)
      this.updateLineActionsUI()
      this.draw()
      return
    }

    const d = this.decisions[this.active]
    const id = nextId(d.points, 'p')
    const fromId = this.from(stations)
    const base = aerial ? findAirBase(fromId) : undefined
    d.points[id] = point
    d.assignments.push({
      unit: this.unit,
      count,
      from: fromId,
      target: id,
      task: aerial ? 'direct' : this.task,
      dispatchMin: this.dispatchMinute(), orderedMin: this.minutes,
    })
    this.refs.hint.classList.remove('danger', 'late')
    this.refs.hint.textContent = aerial
      ? `✈️ Meio aéreo (${this.sup.units[this.unit].short}) de ${base?.short ?? 'Base Aérea'} (${fmtKm(distanceM(base ?? point, point) / 1000)}) alocado nas coordenadas (${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}).`
      : access
        ? `Ponto no acesso mais próximo (${roadName(context!, access.road)}), a ${fmtNumber(distanceM(p, point))} m do clique.`
        : this.unit === 'crew' ? 'Equipa apeada no ponto escolhido, fora ou dentro da rede de acessos.'
          : `Sem estrada a menos de ${SNAP_M} m: o ponto ficou onde clicaste.`
    this.commit()
  }

  private finishLine() {
    if (!this.loaded || (this.tool !== 'line' && this.tool !== 'drops')) return
    if (this.drawing.length < 2) {
      this.refs.hint.classList.remove('danger', 'late')
      this.refs.hint.textContent = 'Uma linha precisa de pelo menos dois cliques.'
      return
    }
    const count = this.placeable()
    if (!count) return
    if (!isAerial(this.sup.units[this.unit])) {
      const bad = this.drawing.find((p) => !this.checkRing(p))
      if (bad) return void (this.drawing = this.drawing.slice(0, this.drawing.indexOf(bad)), this.updateLineActionsUI(), this.draw())
    }
    const d = this.decisions[this.active]
    const id = nextId(d.lines, 'l')
    d.lines[id] = this.drawing
    const task = this.tool
    d.assignments.push({ unit: this.unit, count, from: this.from(this.loaded.stations), target: id, task, dispatchMin: this.dispatchMinute(), orderedMin: this.minutes })
    const lenM = task === 'line' ? demoLineLength({ unit: 'crew' }) : lineLengthM(this.drawing)
    this.drawing = []
    this.setTool(null)
    this.refs.hint.classList.remove('danger', 'late')
    this.refs.hint.textContent = `✓ ${task === 'line' ? 'Linha apeada' : 'Linha aérea'} de ${fmtNumber(lenM)} m registada! Adicionada aos Meios no terreno.`
    this.commit()
  }

  private from(stations: NearStation[]): string {
    if (isAerial(this.sup.units[this.unit])) {
      const bases = airBasesForUnit(this.unit)
      return bases.some((b) => b.id === this.fromId) ? this.fromId : (bases[0]?.id ?? 'cma-braga')
    }
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

  /** Editing cancels an outdated proposal but never starts model work or replaces the other plan. */
  private commit(byIls = false) {
    if(this.loaded) {
      const d=this.decisions[this.active],eta=arrivals(this.loaded.scenario,d)
      d.assignments=d.assignments.flatMap((a,slot)=>a.count<=1?[a]:Array.from({length:a.count},(_,i)=>({...structuredClone(a),id:i===0?a.id:undefined,count:1,arrivalMin:eta[slot]})))
    }
    ensureAssignmentIds(this.decisions[this.active])
    this.hideCutTooltip()
    const late = byIls ? -1 : this.newlyLate()
    if (!byIls && (planKey(this.decisions[0]) !== this.ilsFor || planKey(this.decisions[1]) !== this.ilsB)) {
      this.stopIls()
      this.ilsDone = undefined
    }
    this.render()
    if (late >= 0) this.warnLate(late)
    this.actions.changed()
  }

  /** Per assignment of d, the minute the free run gets to it when its units are not there in time, as B's are judged. */
  private late(d: Decision): (number | undefined)[] {
    const free = this.runs?.free ?? this.free
    return free && this.loaded ? lateAt(this.loaded.scenario, free.arrival, d) : []
  }

  /** The first assignment of the active decision late that was not shown late, or -1. */
  private newlyLate(): number {
    const d = this.decisions[this.active]
    const late = this.late(d)
    const seen = this.lateShown.id === d.id ? this.lateShown.keys : new Set<string>()
    return d.assignments.findIndex((a, i) => late[i] !== undefined && !seen.has(lateKey(a)))
  }

  /** A change by hand left assignment k late: say so, without undoing it. */
  private warnLate(k: number) {
    const d = this.decisions[this.active]
    const fireMin = this.late(d)[k]
    if (fireMin === undefined) return
    const a = d.assignments[k]
    const unit = this.sup.units[a.unit]
    const where = a.task === 'line' || a.task === 'drops' ? 'ao início da linha' : 'a este ponto'
    const when = isAerial(unit) ? 'não chega antes dele' : `não está lá ${SAFETY_MIN} min antes`
    if (this.dangerTimer !== undefined) {
      window.clearTimeout(this.dangerTimer)
      this.dangerTimer = undefined
      this.hazards.entities.removeAll()
    }
    this.refs.hint.classList.remove('danger')
    this.refs.hint.classList.add('late')
    this.refs.hint.innerHTML = `<span class="late-badge">chega tarde</span> O fogo livre chega ${where} aos <b>T+${Math.round(fireMin)} min</b> e o ${unit.short} ${when}. Fica no plano: é só um aviso.`
  }

  /** B as the search starts it: A's own plan. */
  private setB(d: Decision) {
    this.decisions[1] = d
    this.ilsB = planKey(d)
  }

  /** Search B with A's means (optimize.ts) in a worker: B follows its best plan, and shows what moved.
   *  By the button, B starts again from A and its tab opens at the end. */
  private runIls(byHand = false) {
    const loaded = this.loaded
    if (!loaded?.context || this.ils) return
    const worker = new Worker(new URL('./optimize.worker.ts', import.meta.url), { type: 'module' })
    this.ils = { worker, byHand, shownAt: -Infinity, note: 'A preparar os pontos de acesso…' }
    this.ilsDone = undefined
    this.ilsFor = planKey(this.decisions[0])
    if (byHand) {
      this.setB(named(this.decisions[0]))
      this.commit(true)
    }
    worker.onmessage = ({ data }: MessageEvent<IlsReply>) => {
      const ils = this.ils
      if (ils?.worker !== worker) return
      if (data.type === 'error') {
        this.stopIls()
        this.refs.ilsNote.textContent = `A procura falhou: ${data.message}`
        return
      }
      if (data.type === 'done') {
        this.stopIls()
        const { result } = data
        this.ilsDone = { result, changes: diffDecisions(this.decisions[0], result.decision) }
        this.setB(result.decision)
        if (ils.byHand) {
          this.active = 1
          this.cancel()
        }
        this.commit(true)
        return
      }
      const { progress } = data
      ils.note = `${fmtNumber(progress.plans)} planos · ${fmtNumber(progress.elapsedMs / 1000, 1)} s · melhor ${scoreText(progress.best)} (A: ${scoreText(progress.a)})`
      ils.last = progress
      if (progress.decision) ils.pending = progress
      if (ils.pending?.decision && performance.now() - ils.shownAt >= ILS_SHOW_MS) {
        ils.shownAt = performance.now()
        this.setB(ils.pending.decision)
        ils.shown = ils.pending
        ils.pending = undefined
        this.commit(true)
      } else this.renderIls()
    }
    worker.onerror = (e) => {
      this.stopIls()
      this.refs.ilsNote.textContent = `A procura falhou: ${e.message}`
    }
    const weather = loaded.scenario.demo && this.minutes < (loaded.fire.windShift?.minutes ?? Infinity)
      ? loaded.scenario.forecastWeather ?? loaded.scenario.weather : loaded.scenario.weather
    const scenario = { ...loaded.scenario, weather, windShiftMin: this.minutes >= (loaded.fire.windShift?.minutes ?? Infinity) ? loaded.scenario.windShiftMin : undefined, durationMin: Math.min(loaded.scenario.durationMin, ILS_HORIZON_MIN), fwiSeries: computeFWISeries(weather) }
    const request: IlsRequest = { scenario, ground: groundOf(loaded.context), a: clone(this.decisions[0]), replanMin: loaded.scenario.demo ? this.minutes : undefined, budgetMs: ILS_BUDGET_MS, seed: 1 }
    worker.postMessage(request)
    this.renderIls()
  }

  /** Ends the search, or the one due; by the button, B keeps the best plan it had shown, and says what it saves. */
  private stopIls(byHand = false) {
    const ils = this.ils
    this.ils = undefined
    ils?.worker.terminate()
    const last = byHand ? ils?.last : undefined
    if (last) {
      const shown = ils?.shown
      const result = shown?.decision
        ? { decision: shown.decision, improved: true, best: shown.best, a: shown.a, plans: last.plans, elapsedMs: last.elapsedMs }
        : { decision: this.decisions[1], improved: false, best: last.a, a: last.a, plans: last.plans, elapsedMs: last.elapsedMs }
      this.ilsDone = { result, changes: diffDecisions(this.decisions[0], result.decision), stopped: true }
    }
    this.renderIls()
  }

  /** The search's button, its progress, and once done what B saves and where each of A's means went. */
  private renderIls() {
    const button = this.refs.ils as HTMLButtonElement
    const canMove = movable(this.decisions[0])
    const busy = this.ils !== undefined
    button.textContent = busy ? 'Parar procura' : 'Propor B'
    const forecastReady = !this.loaded?.scenario.demo || (this.runs?.free ?? this.free)?.engine?.includes('Modelo rápido')
    button.disabled = !busy && (!this.loaded?.context || !canMove || !forecastReady)
    const note = this.refs.ilsNote
    const list = this.refs.ilsChanges
    list.replaceChildren()
    if (busy) {
      note.textContent = this.ils?.note ?? 'A procurar uma proposta B…'
      return
    }
    const done = this.ilsDone
    if (!done) {
      note.textContent = !this.loaded?.context
        ? 'Sem dados OSM para procurar uma proposta.'
        : !forecastReady ? 'Simule o modelo rápido antes de pedir uma proposta B.'
        : canMove ? 'Propõe novas colocações a partir da hora selecionada, mantendo o passado e os recursos. Substitui B.'
        : 'Adicione meios a A para poder pedir uma proposta B.'
      return
    }
    const { result, changes } = done
    const hours = fmtNumber(Math.min(this.loaded?.scenario.durationMin ?? ILS_HORIZON_MIN, ILS_HORIZON_MIN) / 60)
    const tested = `${fmtNumber(result.plans)} planos em ${fmtNumber(result.elapsedMs / 1000, 1)} s`
    if (!result.improved) {
      note.textContent = `${done.stopped ? 'Procura parada. ' : ''}Nenhum dos ${tested} bate o A neste modelo: B fica igual ao A.`
      return
    }
    const saved = [
      result.a.places > result.best.places ? `${result.a.places - result.best.places} ${result.a.places - result.best.places === 1 ? 'lugar' : 'lugares'}` : '',
      result.a.ha - result.best.ha >= 0.5 ? fmtHa(result.a.ha - result.best.ha) : '',
    ].filter(Boolean)
    const home = result.a.units - result.best.units
    note.textContent =
      (done.stopped ? 'Procura parada. ' : '') +
      `Com os mesmos meios, B poupa ${saved.join(' e ') || 'pouco'} às ${hours} h` +
      (home > 0 ? `, e deixa ${home} ${home === 1 ? 'meio' : 'meios'} no quartel` : '') +
      ` · ${tested}.`
    const lines = diffLines(this.decisions[0], result.decision)
    list.replaceChildren(...lines.map((c) => this.lineRow(c)), ...changes.map((c) => this.changeRow(c)))
  }

  /** What B did with one of A's lines: moved, cut, built from the other end, or left with no one on it. */
  private lineRow(c: LineChange): HTMLElement {
    const li = document.createElement('li')
    li.className = `line ${c.kind}`
    li.innerHTML = `
      <div class="who"><b></b><span class="task"></span></div>
      <div class="meta"><em></em></div>`
    li.querySelector('b')!.textContent = `linha ${c.id}`
    li.querySelector('.task')!.textContent = TASK_NAME[c.task]
    const cut = [c.startM ? `${fmtNumber(c.startM)} m no início` : '', c.endM ? `${fmtNumber(c.endM)} m no fim` : ''].filter(Boolean)
    const what =
      c.kind === 'removed'
        ? ['sem meios no B']
        : c.kind === 'redrawn'
          ? ['redesenhada']
          : [
              c.shiftM ? `${fmtNumber(c.shiftM)} m para ${compass(c.awayDeg)}` : '',
              cut.length ? `encurtada ${cut.join(' e ')}` : '',
              c.reverse ? `${c.task === 'drops' ? 'descargas' : 'construída'} a partir do outro extremo` : '',
            ]
    li.querySelector('em')!.textContent = what.filter(Boolean).join(' · ')
    return li
  }

  /** One line of what changed from A to B: which means, from where, and where it went. */
  private changeRow(c: Change): HTMLElement {
    const li = document.createElement('li')
    li.className = c.kind
    li.innerHTML = `
      <div class="who"><b></b><span class="n"></span></div>
      <div class="meta"><span class="from"></span><em></em></div>`
    const unit = this.sup.units[c.unit]
    li.querySelector('b')!.textContent = unit.short
    li.querySelector('.n')!.textContent = `×${c.count}`
    li.querySelector('.from')!.textContent = isAerial(unit) ? 'Base aérea' : (this.loaded?.stations.find((s) => s.id === c.from)?.short ?? c.from)
    const access = c.b && isRoadVehicle(unit) && this.loaded?.context ? snapToRoad(this.loaded.context, c.b, 60) : undefined
    const road = access && this.loaded?.context ? ` · ${roadName(this.loaded.context, access.road)}` : ''
    let where = ''
    if (c.kind === 'same') where = c.line ? 'na mesma linha' : 'no mesmo sítio'
    else if (c.kind === 'removed') where = 'fica no quartel'
    else if (c.kind === 'added') where = 'novo'
    else if (c.kind === 'retasked') {
      // da linha apeada l1 para ataque direto, do ataque direto para a linha aérea l2
      const article = c.task === 'direct' || c.task === 'shuttle' ? 'o' : 'a'
      const was = `d${article} ${TASK_NAME[c.task]}${c.line ? ` ${c.line}` : ''}`
      const now = c.lineB ? `a ${TASK_NAME[c.taskB!]} ${c.lineB}` : TASK_NAME[c.taskB!]
      where = `${was} para ${now}${road}`
    } else if (c.a && c.b) where = `${fmtNumber(distanceM(c.a, c.b))} m para ${compass(bearingDeg(c.a, c.b))}${road}`
    if(c.orderedMin!==undefined&&c.arrivalMin!==undefined&&this.loaded) where += ` · ordem ${fmtTime(wallClock(this.loaded.fire.start,c.orderedMin/60))} → chegada ${fmtTime(wallClock(this.loaded.fire.start,c.arrivalMin/60))}`
    li.querySelector('em')!.textContent = where
    return li
  }

  private updateStationDropdown() {
    const from = this.refs.from as HTMLSelectElement
    if (!this.loaded) return
    const stations = this.loaded.stations
    const unit = this.sup.units[this.unit]
    const aerial = isAerial(unit)

    if (this.refs.fromLabel) {
      this.refs.fromLabel.textContent = aerial ? 'Base Aérea / CMA' : 'Quartel'
    }

    if (aerial) {
      const bases = airBasesForUnit(this.unit)
      const ignition = this.loaded.scenario.ignition
      const sortedBases = [...bases].sort((a, b) => distanceM(a, ignition) - distanceM(b, ignition))

      const current = sortedBases.some((b) => b.id === this.fromId) ? this.fromId : (sortedBases[0]?.id ?? '')
      this.fromId = current

      from.replaceChildren(
        ...sortedBases.map((b) => {
          const option = document.createElement('option')
          option.value = b.id
          const km = distanceM(b, ignition) / 1000
          const stock = this.stock(this.unit, b.id)
          const left = this.available(this.unit, b.id)
          const badge = stock !== undefined ? ` (${left}/${stock} disp.)` : ''
          option.textContent = `${originLetter(b.id, stations)} · ${b.short} · ${fmtKm(km)}${badge}`
          return option
        }),
      )
      from.value = this.fromId
      return
    }

    const current = from.value || this.fromId

    from.replaceChildren(
      ...stations.map((s) => {
        const option = document.createElement('option')
        option.value = s.id
        const stock = this.stock(this.unit, s.id)
        const left = this.available(this.unit, s.id)
        const badge =
          stock !== undefined
            ? this.unit === 'crew'
              ? ` (${left}/${stock} eq. · ${left * 5} op.)`
              : ` (${left}/${stock} disp.)`
            : ''
        option.textContent = `${originLetter(s.id, stations)} · ${s.short} · ${fmtKm(s.km)}${badge}`
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

  private updateTaskDropdown() {
    const task = this.refs.task as HTMLSelectElement
    if (!task) return
    task.innerHTML = ''

    if (isAerial(this.sup.units[this.unit])) {
      task.innerHTML = `
        <option value="direct">descargas num ponto</option>
        <option value="drops">linha aérea (desenha no mapa)</option>
      `
    } else if (this.unit === 'vttu') {
      task.innerHTML = '<option value="shuttle">abastecimento · raio de 300 m</option>'
    } else if (this.unit === 'crew') {
      task.innerHTML = `
        <option value="direct">ataque direto (ferramentas)</option>
        <option value="protect">proteção de aldeia/estruturas</option>
        <option value="line">linha apeada (desenha no mapa)</option>
      `
    } else if (this.unit === 'vfci') {
      task.innerHTML = `
        <option value="direct">proteção circular</option>
        <option value="protect">proteção de aldeia/estruturas</option>
      `
    } else {
      task.innerHTML = `
        <option value="direct">ataque direto</option>
      `
    }

    if (![...task.options].some((o) => o.value === this.task)) {
      this.task = (task.options[0]?.value as Task) ?? 'direct'
    }
    task.value = this.task
  }

  private render() {
    this.updateStationDropdown()
    this.updateTaskDropdown()
    const d = this.decisions[this.active]
    this.refs.tabs.querySelectorAll<HTMLElement>('[data-tab]').forEach((tab, i) => {
      tab.classList.toggle('on', i === this.active)
      tab.querySelector('span')!.textContent = this.decisions[i].name
    })
    ;(this.refs.name as HTMLInputElement).value = d.name
    this.renderList(d)
    this.setCount(this.count)
    this.renderIls()
    this.renderEnds()
    this.renderReport()
    this.draw()
  }

  /** How each run ends (when the fire stops, and what it burned), and which engine ran them. */
  private renderEnds() {
    if (this.reportPanel.hidden) return
    const table = this.refs.ends
    const runs = this.runs
    const status = this.engine
    this.refs.engine.textContent = !status
      ? ''
      : status.state === 'running'
        ? `${status.name} a correr…`
        : status.state === 'done'
          ? `${status.name} · ${status.seconds ? `${fmtNumber(status.seconds)} s` : 'cache'}`
          : `${status.name} indisponível`
    this.refs.engine.title = status?.state === 'down' ? status.reason : ''
    this.refs.engineNote.textContent = !runs
      ? ''
      : `Corrido com ${runs.A.engine ?? 'Modelo rápido'}. Linhas fixas; água/autonomia apenas visuais. ELMFIRE em pausa.${status?.state === 'done' && status.note ? ` ${status.note}` : ''}`
    if (!runs && this.free && this.loaded) {
      // Before the first simulation: Livre is the cached run, A and B have not run.
      const free = this.free
      table.replaceChildren(
        ...(['free', 'A', 'B'] as const).map((id) => {
          const tr = document.createElement('tr')
          tr.innerHTML = '<th></th><td class="end"></td><td></td>'
          tr.children[0].textContent = id === 'free' ? 'Livre' : id
          tr.children[1].textContent = id === 'free' ? describeEnd(fireEnd(this.loaded!.scenario.grid, free), this.loaded!.fire.start, free.durationMin) : 'ainda não simulado'
          tr.children[2].textContent = id === 'free' ? `6 h: ${fmtHa(burnedHa(this.loaded!.scenario.grid, free, 360))}` : ''
          return tr
        }),
      )
      return
    }
    if (!runs || !this.loaded) {
      table.innerHTML = '<tr><td class="none">Sem simulação ainda.</td></tr>'
      return
    }
    const { grid } = this.loaded.scenario
    const start = this.loaded.fire.start
    table.replaceChildren(
      ...(['free', 'A', 'B'] as const).map((id) => {
        const run = runs[id]
        const tr = document.createElement('tr')
        tr.innerHTML = '<th></th><td class="end"></td><td></td>'
        tr.classList.toggle('on', id === this.decisions[this.active].id)
        const cells = tr.children
        cells[0].textContent = id === 'free' ? 'Livre' : id
        cells[1].textContent = describeEnd(fireEnd(grid, run), start, run.durationMin)
        cells[2].textContent = `6 h: ${fmtHa(burnedHa(grid, run, 360))}`
        return tr
      }),
    )
  }

  /** The palette's unit changed. */
  private setUnit(unit: UnitId) {
    this.unit = unit
    this.renderUnits()
    this.updateStationDropdown()
    this.updateTaskDropdown()
    this.setCount(this.count)
  }

  /** "Meios no terreno", by kind of means: aerial, ground vehicles, crews on foot. */
  private renderList(d: Decision) {
    ensureAssignmentIds(d)
    this.hideTip()
    const late = this.late(d)
    this.lateShown = { id: d.id, keys: new Set(d.assignments.filter((_, k) => late[k] !== undefined).map(lateKey)) }
    const rows = d.assignments.map((a, k) => ({ a, k, kind: kindOf(this.sup.units[a.unit]) }))
    const isFuture = (a: Assignment) => this.playbackMinute < (a.orderedMin ?? a.dispatchMin ?? this.loaded?.scenario.dispatchMin ?? 0)
    this.refs.list.dataset.future = rows.filter(r => isFuture(r.a)).map(r => r.a.id).join('|')
    this.refs.list.replaceChildren(
      ...GROUPS.flatMap(({ kind, name }) => {
        const mine = rows.filter((r) => r.kind === kind && !isFuture(r.a))
        if (!mine.length) return []
        const head = document.createElement('li')
        head.className = 'group'
        head.innerHTML = '<span></span><b></b>'
        head.querySelector('span')!.textContent = name
        head.querySelector('b')!.textContent = String(mine.reduce((n, r) => n + r.a.count, 0))
        return [head, ...mine.map(({ a, k }) => this.row(a, k, late[k]))]
      }),
    )
    const future = rows.filter(r => isFuture(r.a))
    if (future.length) {
      const item = document.createElement('li'), details = document.createElement('details'), summary = document.createElement('summary')
      summary.textContent = `Ordens futuras (${future.reduce((n,r)=>n+r.a.count,0)})`
      details.append(summary)
      const list = document.createElement('ul')
      for (const {a,k} of future) {
        const row = this.row(a,k,late[k])
        const when = document.createElement('div')
        when.textContent = `Ordem às ${fmtTime(wallClock(this.loaded!.fire.start,(a.orderedMin ?? a.dispatchMin ?? 0)/60))}`
        row.prepend(when); list.append(row)
      }
      details.append(list); item.append(details); this.refs.list.append(item)
    }
    if (!d.assignments.length) this.refs.list.innerHTML = '<li class="none">Nada no terreno: o fogo corre livre.</li>'
  }

  private row(a: Assignment, k: number, lateMin?: number): HTMLElement {
    const li = document.createElement('li')
    li.className = 'assignment'
    li.dataset.unitId = a.id
    li.style.setProperty('--origin-color', originColor(a.from, this.loaded?.stations ?? []))
    const unit = this.sup.units[a.unit]
    const d = this.decisions[this.active]
    const target = d.points[a.target] ?? d.lines[a.target]?.[0]
    // The minute the model has it at work, the one its barrier holds from (wetLine.ts arrivals).
    const eta = target && this.loaded ? arrivals(this.loaded.scenario, d)[k] : undefined
    const isGround = !isAerial(unit)
    const base = isAerial(unit) ? findAirBase(a.from) : undefined
    const station = !base ? this.loaded?.stations.find((s) => s.id === a.from) : undefined

    let routeBadge = ''
    if (isRoadVehicle(unit) && target && station && this.loaded?.context) {
      const activeRun = this.runs ? (this.runs[d.id as 'A' | 'B'] ?? this.runs.free) : undefined
      const route = findSafeRoute(this.loaded.scenario.grid, this.loaded.context.osm.roads, activeRun?.arrival, this.minutes, station, target)
      if (route?.isDetour) {
        routeBadge = `<span class="route-badge" title="Desvio seguro: ${route.distanceKm.toFixed(1)} km contornando estradas cortadas pelo fogo">Desvio seguro</span>`
      }
    }

    let fromText = ''
    if (isAerial(unit)) {
      const airKm = base && target ? distanceM(base, target) / 1000 : this.sup.dispatch.airBaseKm
      fromText = base ? `${base.short} · ${fmtKm(airKm)}` : `Base aérea · ${this.sup.dispatch.airBaseKm} km`
    } else {
      fromText = station?.short ?? ''
    }

    li.innerHTML = `
      <div class="who"><span class="unit-id"></span><b></b><span class="n"></span>
        <div class="ctl"><button type="button" class="x unit-action" title="Retirar meio" aria-label="Retirar meio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></div>
      </div>
      <div class="meta"><span class="from"></span>${routeBadge}${lateMin === undefined ? '' : '<span class="late-badge">chega tarde</span>'}<em></em></div>`
    li.querySelector('.unit-id')!.textContent = fieldIds(d, this.loaded?.stations ?? [])[k].join(' · ')
    li.querySelector('b')!.textContent = unit.short
    li.querySelector('.n')!.textContent = `×${a.count}`
    li.querySelector('.from')!.textContent = fromText
    const etaLabel = li.querySelector('em')!
    if (eta !== undefined) {
      etaLabel.dataset.eta = String(eta)
      etaLabel.textContent = this.etaText(eta)
    }
    const lateBadge = li.querySelector<HTMLElement>('.late-badge')
    if (lateBadge)
      lateBadge.title = `O fogo livre chega ${a.task === 'line' || a.task === 'drops' ? 'ao início da linha' : 'aqui'} aos T+${Math.round(lateMin!)} min: ${isGround ? `este meio não está lá ${SAFETY_MIN} min antes` : 'este meio não chega antes dele'}`
    if(this.loaded) {
      const list=placements(this.loaded.scenario,d,k),history=document.createElement('ol')
      history.className='placement-history'
      list.forEach((p,index)=>{const item=document.createElement('li');item.textContent=`${index+1}. Ordem ${fmtTime(wallClock(this.loaded!.fire.start,p.orderedMin/60))} → chegada ${fmtTime(wallClock(this.loaded!.fire.start,p.arrivalMin/60))}`;const edit=document.createElement('button');edit.type='button';edit.className='unit-action edit-placement';edit.title=`Editar colocação ${index+1}`;edit.setAttribute('aria-label',edit.title);edit.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/></svg>';edit.dataset.editPlacement=String(index);edit.dataset.editSlot=String(k)
        edit.addEventListener('click',()=>{this.setTool(null);this.unit=a.unit;this.editingPlacement={slot:k,index};this.setTool('point');this.refs.hint.textContent='Escolha o destino corrigido no mapa. Esc para cancelar.'})
        if(index===list.length-1) li.querySelector('.ctl')!.append(edit)
        else item.append(edit)
        history.append(item)})
      const move=document.createElement('button');move.type='button';move.textContent=a.count>1?`Nova colocação (×${a.count})`:'Nova colocação'
      move.disabled=this.minutes<list.at(-1)!.arrivalMin || resourceAt(cachedCombatResources(this.loaded.scenario,d),k,this.playbackMinute).exhausted
      move.addEventListener('click',()=>{this.unit=a.unit;this.relocating=k;this.setTool('point');this.refs.hint.textContent='Escolha no mapa o novo destino deste meio.'})
      const resources=document.createElement('div');resources.className='card-resources';resources.dataset.resourceSlot=String(k)
      move.dataset.moveSlot=String(k)
      const disclosure=document.createElement('details'),summary=document.createElement('summary')
      summary.textContent='Recursos · água e autonomia'
      disclosure.className='resource-disclosure';disclosure.append(summary,resources)
      li.append(history,disclosure,move)
      this.fillResources(resources,k)
    }
    li.querySelector('.x')!.addEventListener('click', () => this.remove(k))
    return li
  }

  private etaText(eta: number): string {
    const remaining = Math.ceil(eta - this.playbackMinute - 1e-6)
    if (remaining <= 0) return ''
    return `${remaining > 0 ? 'chega' : ''} ${this.loaded ? fmtTime(wallClock(this.loaded.fire.start, eta/60)) : `T+${Math.round(eta)} min`}${remaining > 0 ? ` · faltam ${remaining} min` : ''}`
  }

  private fillResources(el:HTMLElement,slot:number) {
    if(!this.loaded)return
    const state=resourceAt(cachedCombatResources(this.loaded.scenario,this.decisions[this.active]),slot,this.playbackMinute)
    const label=state.exhausted?'Autonomia esgotada':state.waterPct<=0?'Sem água · adicionar cisterna':state.contained?'Contido · consumo em pausa':state.active?'Em combate':'Em deslocação'
    el.innerHTML=`<span>${label}</span><label>Água <meter min="0" max="100" value="${state.waterPct}"></meter> ${Math.round(state.waterPct)}%</label><label>Autonomia <meter min="0" max="100" value="${state.autonomyPct}"></meter> ${Math.round(state.autonomyPct)}%</label>`
  }

  private updateEtas() {
    const d = this.decisions[this.active]
    const future = d.assignments.filter(a => this.playbackMinute < (a.orderedMin ?? a.dispatchMin ?? this.loaded?.scenario.dispatchMin ?? 0)).map(a => a.id).join('|')
    if (this.refs.list.dataset.future !== future) this.renderList(d)
    this.refs.list.querySelectorAll<HTMLButtonElement>('[data-move-slot]').forEach(el=>{const k=Number(el.dataset.moveSlot);if(this.loaded)el.disabled=this.playbackMinute<placements(this.loaded.scenario,d,k).at(-1)!.arrivalMin||resourceAt(cachedCombatResources(this.loaded.scenario,d),k,this.playbackMinute).exhausted})
    this.refs.list.querySelectorAll<HTMLElement>('[data-resource-slot]').forEach(el=>this.fillResources(el,Number(el.dataset.resourceSlot)))
    this.refs.list.querySelectorAll<HTMLElement>('[data-eta]').forEach((el) => {
      el.textContent = this.etaText(Number(el.dataset.eta))
    })
  }

  /** The balloon just outside the drawer, level with an (i): what the assignment can do, kept out of
   *  the list so it reads clean. */
  private showTip(anchor: HTMLElement, text: string) {
    this.tip.textContent = text
    this.tip.hidden = false
    const r = anchor.getBoundingClientRect()
    const { height, width } = this.tip.getBoundingClientRect()
    this.tip.style.left = `${Math.max(12, Math.min(this.el.getBoundingClientRect().right + 10, innerWidth - width - 12))}px`
    this.tip.style.top = `${Math.min(Math.max(r.top + r.height / 2 - height / 2, 8), innerHeight - height - 8)}px`
    this.tip.style.setProperty('--arrow', `${r.top + r.height / 2 - parseFloat(this.tip.style.top)}px`)
  }

  private hideTip() {
    this.tip.hidden = true
  }

  private renderPalette() {
    const unit = this.sup.units[this.unit]
    this.refs.from.closest<HTMLElement>('.field')!.hidden = false
    // What the station or CMA still has of this unit for the active decision.
    const from = this.from(this.loaded?.stations ?? [])
    const stock = this.stock(this.unit, from)
    const left = this.available(this.unit, from)
    const station = !isAerial(unit) ? this.loaded?.stations.find((s) => s.id === from) : undefined
    if (isAerial(unit)) {
      const base = findAirBase(from)
      const km = base && this.loaded ? distanceM(base, this.loaded.scenario.ignition) / 1000 : this.sup.dispatch.airBaseKm
      const deployed = (stock ?? 0) - left
      this.refs.stock.textContent = base
        ? `${base.short}: ${left} de ${stock} ${unit.short} disponíveis${deployed > 0 ? ` (${deployed} em uso)` : ''} · ${base.operator} · ${base.aircraftModel}`
        : `Base aérea a ${fmtKm(km)} · ${left} de ${stock ?? 1} disponíveis`
      this.refs.stock.classList.toggle('out', left === 0)
    } else if (stock === undefined) {
      this.refs.stock.textContent = station ? `${station.short}: sem estimativa de meios` : 'sem quartel selecionado'
      this.refs.stock.classList.remove('out')
    } else {
      const deployed = stock - left
      const source = this.inventory?.[from] ? stockSource(this.inventory[from]) : ''
      const unitDesc = this.unit === 'crew' ? `equipas ECIN (${left * 5} operacionais)` : unit.short
      this.refs.stock.textContent =
        `${station?.short ?? from}: ${left} de ${stock} ${unitDesc} disponíveis` +
        (deployed > 0 ? `, ${deployed} já nesta decisão` : '') +
        (left === 0 ? ' · ESGOTADO' : '') +
        ` · ${source}`
      this.refs.stock.classList.toggle('out', left === 0)
    }
    if (left === 0 && this.tool && this.tool !== 'pma') this.setTool(null)
    if (this.tool && (this.tool === 'line' ? !unit.lineMPerH : this.tool === 'drops' ? !isAerial(unit) : false)) this.setTool(null)
  }

  private renderReport() {
    if (this.reportPanel.hidden) return
    const table = this.refs.report
    const r = this.reports
    if (!r) {
      table.innerHTML = `<tr><td class="none">${this.loaded?.context ? 'A e B ainda não simulados.' : 'Sem dados OSM para este incêndio.'}</td></tr>`
      this.refs.detail.textContent = ''
      this.refs.verdict.textContent = ''
      return
    }
    const cols = ['free', 'A', 'B'] as const
    const at = this.reportsAt(this.minutes) ?? r
    this.refs.reportAt.textContent = at === r ? `no fim (${fmtNumber(Math.max(r.free.minutes, r.A.minutes, r.B.minutes) / 60, 1)} h)` : `a ${fmtElapsed(this.minutes / 60)}`
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
    const j = this.judged ?? r
    this.refs.verdict.textContent = describeVerdict(recommend(j.A, j.B), j.A, j.B)
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
    if (!runs || !context || !this.reports || minutes >= Math.max(this.reports.free.minutes, this.reports.A.minutes, this.reports.B.minutes)) return undefined
    const { grid } = this.loaded!.scenario
    return { free: makeReport(grid, context, runs.free, minutes), A: makeReport(grid, context, runs.A, minutes), B: makeReport(grid, context, runs.B, minutes) }
  }

  /** The active decision on the ground: points, lines (built in time solid, late dashed), safe road routes, the line being drawn. */
  private draw() {
    this.viewer.scene.requestRender()
    const { entities } = this.source
    entities.removeAll()
    this.routes.entities.removeAll()
    const d = this.decisions[this.active]
    ensureAssignmentIds(d)
    const { context, scenario, stations } = this.loaded ?? {}
    const ordered = (a: Assignment) => this.playbackMinute >= (a.orderedMin ?? a.dispatchMin ?? scenario?.dispatchMin ?? 0)
    const activeRun = this.runs ? (this.runs[d.id as 'A' | 'B'] ?? this.runs.free) : undefined

    // Travel routes follow the selected placement, including later moves.
    if(context&&scenario&&stations) for(const [slot,a] of d.assignments.entries()) {
      if(!ordered(a)||!isRoadVehicle(this.sup.units[a.unit]))continue
      const history=placements(scenario,d,slot),p=placementAt(history,this.playbackMinute)
      if(!p||this.playbackMinute>=p.arrivalMin)continue
      const index=history.indexOf(p),origin=index>0?history[index-1].point:stations.find(st=>st.id===a.from)
      if(!origin)continue
      const path=p.path??findSafeRoute(scenario.grid,context.osm.roads,activeRun?.arrival,this.minutes,origin,p.point)?.path
      if(!path?.length)continue
      const positions=cleanLonLat(path).map(pt=>Cartesian3.fromDegrees(pt.lon,pt.lat))
      this.routes.entities.add({polyline:{positions,width:7,clampToGround:true,material:ROUTE_HALO}})
      this.routes.entities.add({polyline:{positions,width:4,clampToGround:true,material:ROUTE}})
    }

    // 2. The barriers of the decision, exactly as the engines get them: light-blue strips, true width up
    // close and a few pixels far off; dim and dashed until they hold.
    const lines = this.wetLinesOf(d)
    const unitInfo = (a: Assignment, point: LonLat, allUnits: Assignment[]) => ({
      assignment: a,
      point,
      allUnits,
      lines: lines.filter((w) => allUnits.includes(d.assignments[w.slot])),
    })
    const combat = scenario ? cachedCombatResources(scenario,d) : undefined
    if(scenario&&combat) for(const [slot,a] of d.assignments.entries()) {
      if(!['crew','vfci'].includes(a.unit))continue
      const state=resourceAt(combat,slot,this.playbackMinute),p=placementAt(combat.lists[slot],this.playbackMinute)
      if(!p||!ordered(a)||state.exhausted||state.waterPct<=0)continue
      const waiting=this.playbackMinute<p.arrivalMin
      const radius=waiting?(a.unit==='crew'?28:52.5)*Math.sqrt(a.count):state.radius
      const positions=Array.from({length:65},(_,i)=>destination(p.point,i*360/64,radius)).map(p=>Cartesian3.fromDegrees(p.lon,p.lat))
      const coverage=entities.add({polyline:{positions,width:2,clampToGround:true,material:waiting?new PolylineDashMaterialProperty({color:WET,dashLength:12}):WET}})
      ;(coverage as any)._unitInfo=unitInfo(a,p.point,[a])
    }

    // Every physical means gets only its current source-letter + count ID.
    const deployed: UnitMarker[] = []
    const ids = fieldIds(d, stations ?? [])
    const eta = scenario ? arrivals(scenario, d) : []
    const ecinUsed = new Set<string>()
    for (const [slot, a] of d.assignments.entries()) {
      const at = d.points[a.target] ?? d.lines[a.target]?.[0]
      if (!at) continue
      const spec = this.sup.units[a.unit]
      const aerial = isAerial(spec)
      const origin = aerial ? findAirBase(a.from) : stations?.find(s => s.id === a.from)
      const first = !ecinUsed.has(a.from)
      if (!aerial) ecinUsed.add(a.from)
      const dispatch = a.dispatchMin ?? scenario?.dispatchMin ?? 0
      const departure = dispatch + (spec.turnoutMin ?? (first ? this.sup.dispatch.ecinTurnoutMin : this.sup.dispatch.volunteerTurnoutMin))
      const route = origin && context && scenario && isRoadVehicle(spec)
        ? findSafeRoute(scenario.grid, context.osm.roads, activeRun?.arrival, dispatch, origin, at)?.path : undefined
      const path = origin ? [origin, ...(route ?? []), at] : [at]
      const journey = unitJourney(path, departure, eta[slot] ?? departure)
      const history = scenario ? placements(scenario,d,slot) : []
      const current = () => placementAt(history,this.playbackMinute)
      const visible = () => ordered(a) && (!combat || !resourceAt(combat,slot,this.playbackMinute).exhausted)
      for (let number = 0; number < a.count; number++) {
        const color = originColor(a.from, stations ?? [])
        const arrival = eta[slot] ?? departure
        const marker: UnitMarker = { ...at, id: `${a.id}:${number}`, code: ids[slot][number], unit: a.unit,
          color, offsetX: 0, offsetY: 0, label: spec.short,
          visible, position: () => relocationPosition(history,this.playbackMinute) ?? journey(this.playbackMinute) }
        const destination: UnitMarker = { ...marker, id: `${marker.id}:destination`, pending: true,
          position: () => current()?.point ?? at, visible: () => visible() && this.playbackMinute < (current()?.arrivalMin ?? arrival),
          eta: () => (current()?.arrivalMin ?? arrival) - this.playbackMinute }
        for (const item of [marker, destination]) {
          deployed.push(item)
          const entity = entities.add({
            position: new CallbackPositionProperty(() => { const p = item.position!(); return Cartesian3.fromDegrees(p.lon, p.lat) }, false),
            billboard: {
              show: new CallbackProperty(() => item.visible!(), false),
              // DOM supplies crisp visible icons; the near-transparent billboard is the hover target.
              image: unitIconUrl(a.unit, color), color: Color.WHITE.withAlpha(.01), width: 36, height: 36,
              pixelOffset: new CallbackProperty(() => new Cartesian2(item.offsetX, item.offsetY), false),
              verticalOrigin: VerticalOrigin.CENTER, heightReference: HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Infinity,
            },
          })
          ;(entity as any)._unitInfo = { ...unitInfo(a, at, [a]), displayId: marker.code }
        }
      }
    }
    this.unitMarkers.set(deployed)

    // 5. Line being drawn
    if (this.drawing.length) {
      const first = this.drawing[0]
      const axis = this.drawing.length > 1 ? bearingDeg(first, this.drawing.at(-1)!) : 0
      const preview = this.tool === 'line' && this.drawing.length > 1 ? [destination(first, axis, demoLineLength({ unit: 'crew' })/2), destination(first, axis+180, demoLineLength({ unit: 'crew' })/2)] : this.drawing
      this.polyline(preview, this.tool === 'drops' ? INK : AMBER, true)
      for (let i = 0; i < this.drawing.length; i++) {
        const pt = this.drawing[i]
        entities.add({
          position: Cartesian3.fromDegrees(pt.lon, pt.lat),
          point: {
            pixelSize: i === 0 ? 8 : 6,
            color: i === 0 ? Color.WHITE : AMBER,
            outlineColor: Color.BLACK,
            outlineWidth: 1.5,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Infinity,
          },
          label: {
            text: String(i + 1),
            font: 'bold 9px ui-monospace, Menlo, monospace',
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            style: 2,
            pixelOffset: new Cartesian2(0, -12),
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Infinity,
          },
        })
      }
    }

    // 6. Draw multi-agency overlays (PSP road cuts and INEM Medical Point)
    this.agency.entities.removeAll()
    if (context && scenario && activeRun) {
      // Draw cut roads strictly inside the fire perimeter as the fire advances
      if (this.role === 'psp' || this.role === 'cmd') {
        for (const { road, cells } of context.roadCells) {
          let hasBurned = false
          let minArrival = Infinity
          for (let k = 0; k < cells.length; k++) {
            const t = activeRun.arrival[cells[k]]
            if (t <= this.minutes) {
              hasBurned = true
              if (t < minArrival) minArrival = t
            }
          }
          if (!hasBurned) continue

          const r = context.osm.roads[road]
          if (!r || !r.pts || r.pts.length < 2) continue

          const burnedSegments = clipRoadToFire(r.pts, scenario.grid, activeRun.arrival, this.minutes)
          for (const raw of burnedSegments) {
            const seg = cleanPath(raw, (p) => p)
            if (!seg.length) continue
            const lineEntity = this.agency.entities.add({
              polyline: {
                positions: seg.map((pt) => Cartesian3.fromDegrees(pt[0], pt[1])),
                width: 4,
                clampToGround: true,
                material: new PolylineDashMaterialProperty({
                  color: Color.fromCssColorString('#e63946'),
                  dashLength: 10,
                }),
              },
            })
            const roadItem: RoadCutItem = {
              id: road,
              label: r.name || r.ref || (r.cls === 'paved' ? 'Estrada Secundária' : 'Caminho Rural'),
              cls: r.cls,
              firstArrivalMin: minArrival,
              minutesToImpact: 0,
              urgency: 'cortado',
              coord: { lon: seg[0][0], lat: seg[0][1] },
              pts: r.pts,
              isPaved: r.cls === 'paved' || !!r.name || !!r.ref,
              kind: 'fire',
            }
            ;(lineEntity as any)._roadCut = roadItem

            // Small discreet No-Entry circular sign (⛔) billboard icon
            const cutIconEntity = this.agency.entities.add({
              position: Cartesian3.fromDegrees(roadItem.coord.lon, roadItem.coord.lat),
              billboard: {
                image: getNoEntrySignCanvas('cortado'),
                width: 18,
                height: 18,
                verticalOrigin: VerticalOrigin.CENTER,
                heightReference: HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Infinity,
              },
            })
            ;(cutIconEntity as any)._roadCut = roadItem
          }
        }

        // Roads where combat and supply vehicles (VFCI / VTTU) are at work: the GNR closes the road from the
        // fire to the vehicle and on past it the other way (dashed red), with a softer red sign at the vehicle
        // and at the far barrier. Crews on foot do not.
        const roadItems = detectFirefighterRoads(context, this.decisions[this.active], this.minutes, scenario.grid, activeRun.arrival)
        for (const roadItem of roadItems) {
          const seg = cleanPath(roadItem.pts, (p) => p)
          if (seg.length >= 2) {
            const lineEntity = this.agency.entities.add({
              polyline: {
                positions: seg.map((p) => Cartesian3.fromDegrees(p[0], p[1])),
                width: 4,
                clampToGround: true,
                material: new PolylineDashMaterialProperty({
                  color: Color.fromCssColorString('#e63946'),
                  dashLength: 10,
                }),
              },
            })
            ;(lineEntity as any)._roadCut = roadItem
          }

          for (const at of roadItem.barrier ? [roadItem.coord, roadItem.barrier] : [roadItem.coord]) {
            const cutIconEntity = this.agency.entities.add({
              position: Cartesian3.fromDegrees(at.lon, at.lat),
              billboard: {
                image: getNoEntrySignCanvas('veiculo'),
                width: 18,
                height: 18,
                verticalOrigin: VerticalOrigin.CENTER,
                heightReference: HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Infinity,
              },
            })
            ;(cutIconEntity as any)._roadCut = roadItem
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

          const ambRoute = pma.ambulanceRoute ? cleanLonLat(pma.ambulanceRoute) : []
          if (ambRoute.length) {
            const routeEntity = this.agency.entities.add({
              polyline: {
                positions: ambRoute.map((pt) => Cartesian3.fromDegrees(pt.lon, pt.lat)),
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

  private polyline(raw: LonLat[], color: Color, dashed: boolean, dashLength = 12) {
    const line = cleanLonLat(raw)
    if (!line.length) return
    this.source.entities.add({
      polyline: {
        positions: line.map((p) => Cartesian3.fromDegrees(p.lon, p.lat)),
        width: dashed ? 2.5 : 4,
        clampToGround: true,
        material: dashed ? new PolylineDashMaterialProperty({ color, dashLength }) : color,
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
      this.refs.addPma?.classList.remove('active')
    } else {
      this.setTool('pma')
      this.refs.hint.classList.remove('danger', 'late')
      this.refs.hint.textContent = 'Clica no mapa onde queres instalar o Posto Médico Avançado (PMA).'
      this.refs.addPma?.classList.add('active')
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

    this.refs.addPma?.classList.remove('active')
    if (this.refs.pmaNote) {
      this.refs.pmaNote.textContent = `PMA estabelecido com sucesso! Margem de segurança: ${safeBufferMin > 180 ? '> 3 horas' : `${safeBufferMin} min`}.`
    }
    this.refs.hint.classList.remove('danger', 'late')
    this.refs.hint.textContent = `PMA estabelecido com sucesso! Margem de segurança: ${safeBufferMin > 180 ? '> 3 horas' : `${safeBufferMin} min`}.`
    this.draw()
    this.actions.changed()
  }

  getMultiAgencyDispatch(): MultiAgencyDispatch | undefined {
    if (!this.loaded) return undefined
    const d = this.decisions[this.active]
    const activeRun = this.runs ? (this.runs[d.id as 'A' | 'B'] ?? this.runs.free) : undefined
    if (!activeRun) return undefined
    const cached = this.dispatchCache
    if (
      cached &&
      cached.loaded === this.loaded &&
      cached.run === activeRun &&
      cached.minutes === this.minutes &&
      cached.pma === this.pmaList &&
      cached.decision === d &&
      cached.assignmentsLen === (d?.assignments?.length ?? 0)
    ) {
      return cached.value
    }
    const value = buildMultiAgencyDispatch(
      this.loaded.fire.name,
      this.loaded.fire.start,
      this.minutes,
      this.loaded.scenario.grid,
      this.loaded.context,
      activeRun,
      this.pmaList,
      d,
    )
    this.dispatchCache = {
      loaded: this.loaded,
      run: activeRun,
      minutes: this.minutes,
      pma: this.pmaList,
      decision: d,
      assignmentsLen: d?.assignments?.length ?? 0,
      value,
    }
    return value
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
    if (this.tool !== 'point' || !this.loaded?.context || !isRoadVehicle(this.sup.units[this.unit])) return
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
/** B before the search has moved anything: A's own plan. */
const named = (a: Decision): Decision => ({ ...clone(a), id: 'B', name: ILS_NAME })
/** A plan without its name or its group IDs (unitIdentity.ts): what the search reads from A, and what it leaves in B. */
const planKey = (d: Decision) => JSON.stringify([d.points, d.lines, d.assignments.map(({ id: _, ...a }) => a)])
const lateKey = (a: Assignment) => a.id ?? `${a.unit}|${a.from}|${a.target}|${a.task}`
/** Whether the search has anything of A to move: units at a point. */
const movable = (a: Decision) => a.assignments.some((x) => x.target in a.points || x.target in a.lines)

function nextId(existing: Record<string, unknown>, prefix: string): string {
  let n = 1
  while (existing[`${prefix}${n}`]) n++
  return `${prefix}${n}`
}

/** A plan's score in the search's note: places reached, then hectares. */
const scoreText = (s: Score) => `${s.places} ${s.places === 1 ? 'lugar' : 'lugares'}, ${fmtHa(s.ha)}`

function roadName(context: Context, road: number): string {
  const r = context.osm.roads[road]
  return r.name ? `estrada ${r.name}` : r.ref ? `${r.ref}` : r.cls === 'paved' ? 'estrada' : r.cls === 'track' ? 'caminho de terra' : 'trilho'
}

function lineLengthM(line: LonLat[]): number {
  let m = 0
  for (let i = 1; i < line.length; i++) m += distanceM(line[i - 1], line[i])
  return m
}



const escapeText = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const timeMinutes = (m: number) => {
  if (!Number.isFinite(m)) return 'Em espera'
  const whole = Math.max(0, Math.round(m))
  return whole < 60 ? `${whole} min` : `${Math.floor(whole / 60)} h ${whole % 60} min`
}
