// The decision editor: a drawer on the left where A and B are composed on the map. A unit's
// button arms the map, then each click puts it on the nearest road (a point of attack, where it
// lays its wet line), or, with a line task, clicks draw a crew line or an aerial water line.
// Each assignment shows when it gets there and what it lays: the barriers the engines get.
// B is the ILS's plan for A's means (optimize.ts), searched again whenever A changes. Every
// fire opens with nothing on the ground; the 6 h report compares Livre, A and B.

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
import { burnedHa, freeArrival, type Run, type Scenario } from './fastModel'
import { cellOf, type Grid } from './grid'
import { fmtElapsed, fmtHa, fmtKm, fmtNumber, fmtTime, wallClock } from './format'
import { bearingDeg, cleanLonLat, cleanPath, compass, destination, distanceM, type LonLat } from './geo'
import { snapToRoad, type Context } from './osm'
import { stockSource, type Inventory } from './inventory'
import { diffDecisions, diffLines, groundOf, ILS_NAME, lateAt, SAFETY_MIN, type Change, type LineChange, type Progress, type Result, type Score } from './optimize'
import type { IlsReply, IlsRequest } from './optimize.worker'
import { describeEnd, describeVerdict, fireEnd, makeReport, recommend, type Report } from './report'
import { approachIntercept, type DeploymentSelection } from './stationRings'
import { findSafeRoute } from './routing'
import { findAirBase, airBasesForUnit } from './airBases'
import {
  DEFAULT_HOSPITAL,
  buildMultiAgencyDispatch,
  evaluateMedicalPointSafety,
  type AgencyRole,
  type MedicalPointItem,
  type MultiAgencyDispatch,
  type RoadCutItem,
} from './reporting'
import { DispatchModal } from './dispatchModal'
import {
  ICON_HAZARD,
  ICON_PROTECAO_CIVIL,
  ICON_PSP,
  ICON_INEM,
  ICON_CLIPBOARD,
  ICON_ROAD_CUT,
  ICON_PMA,
  ICON_CHECK,
  ICON_SHIELD,
  ICON_BOLT,
} from './icons'
import { wetLineBearing, arrivals, stripCells, wetLines, type Barrier, type WetLine } from './wetLine'
import {
  aerialFrontM,
  dropCycleMin,
  flameLengthM,
  isAerial,
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

/** The "Simular no ELMFIRE" button: lit only when the means differ from what the last simulation ran. */
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
const UNIT_COLOR: Record<UnitId, string> = { vfci: '#dc2626', crew: '#f59e0b', vttu: '#0284c7', hebl: '#0d9488', avbp: '#4f46e5' }
const kindOf = (unit: UnitSpec): Kind => (isAerial(unit) ? 'air' : unit.waterL ? 'vehicle' : 'foot')
const ILS_BUDGET_MS = 10_000 // the search for B (optimize.ts): ~2000 plans
const ILS_SHOW_MS = 1500 // while it runs, B on the map follows its best plan at most this often
const ILS_AFTER_MS = 800 // A has to be still this long before B is searched again
const ILS_HORIZON_MIN = 360 // the ILS judges its plans at 6 h of the fast model: ~5 ms a plan, where 24 h costs several times that
const AMBER = Color.fromCssColorString('#f0a33a')
const INK = Color.fromCssColorString('#d9dcdf')
const DIM = Color.fromCssColorString('#8b9096')
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
    <button type="button" data-ref="simulate" class="primary-btn simulate-btn" title="Corre o ELMFIRE com os meios de A e de B. Só se acende quando os meios mudaram desde a última simulação."></button>
    <p class="note" data-ref="simulateNote"></p>
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
        <button type="button" class="info" data-ref="capacityInfo" aria-label="Capacidade e rendimento deste meio" title="Ver capacidade e rendimento deste meio">i</button>
      </div></div>
    </div>
    <p class="note stock" data-ref="stock"></p>
    <div class="line-actions" data-ref="lineActions" hidden>
      <button type="button" class="finish-line-btn" data-ref="finishLine" disabled title="Concluir e registar esta linha nos meios no terreno">✓ Concluir Linha</button>
      <button type="button" class="cancel-line-btn" data-ref="cancelLine" title="Cancelar traçado da linha">✕ Cancelar</button>
    </div>
    <p class="note hint" data-ref="hint"></p>
  </section>
  <section class="ils">
    <h3>Proposta B</h3>
    <button type="button" data-ref="ils" class="primary-btn" title="O B é procurado sozinho sempre que o A muda: 10 s à procura de onde pôr os meios do A para que o fogo atinja menos lugares e arda menos (ILS, Mendes &amp; Alvelos 2023, no modelo rápido interno). Este botão repete a procura. O resultado só se vê depois de simular no ELMFIRE."></button>
    <p class="note" data-ref="ilsNote"></p>
    <ul class="assignments changes" data-ref="ilsChanges"></ul>
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
      <button type="button" data-ref="addPma" style="background:#059669;border-color:#10b981;color:#fff;width:100%;padding:6px;" title="Colocar Posto Médico Avançado (PMA)">${ICON_PMA} Ponto Socorro (PMA)</button>
    </div>
  </section>
  <footer>
    <button type="button" data-ref="clear">Limpar esta decisão</button>
    <button type="button" data-ref="reset" title="Volta o A ao exemplo e procura o B de novo">Repor exemplo</button>
  </footer>
`

const UNIT_CANVASES = new Map<string, HTMLCanvasElement>()

function getUnitTacticalCanvas(unitId: UnitId): HTMLCanvasElement {
  const cached = UNIT_CANVASES.get(unitId)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = 48
  canvas.height = 48
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const cx = 24
  const cy = 24
  const r = 20

  const config: Record<UnitId, { bg: string; border: string; emoji: string }> = {
    vfci: { bg: 'rgba(220, 38, 38, 0.95)', border: '#fca5a5', emoji: '🚒' },
    vttu: { bg: 'rgba(2, 132, 199, 0.95)', border: '#7dd3fc', emoji: '💧' },
    crew: { bg: 'rgba(217, 119, 6, 0.95)', border: '#fde047', emoji: '🥾' },
    hebl: { bg: 'rgba(13, 148, 136, 0.95)', border: '#5eead4', emoji: '🚁' },
    avbp: { bg: 'rgba(79, 70, 229, 0.95)', border: '#c7d2fe', emoji: '✈️' },
  }

  const { bg, border, emoji } = config[unitId] ?? config.vfci

  // Drop shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetY = 1.5

  // Dark outline
  ctx.beginPath()
  ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2)
  ctx.fillStyle = '#0f172a'
  ctx.fill()

  // Outer border ring
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = border
  ctx.fill()

  // Inner circular badge
  ctx.beginPath()
  ctx.arc(cx, cy, r - 2.5, 0, Math.PI * 2)
  ctx.fillStyle = bg
  ctx.fill()

  // Crisp centered tactical icon
  ctx.font = '20px "Segoe UI Emoji", "Apple Color Emoji", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, cx, cy + 1)

  UNIT_CANVASES.set(unitId, canvas)
  return canvas
}

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
  private runs: Runs | undefined // the last ELMFIRE simulation of A and B (with Livre); none before the first
  private free: Run | undefined // Livre, the cached ELMFIRE run: all there is before the first simulation
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
  /** The timer of the search that starts once A has been still for ILS_AFTER_MS. */
  private ilsDue: number | undefined
  /** The A that B was searched for, and B as the search left it (planKey): B changed by hand differs. */
  private ilsFor = ''
  private ilsB = ''
  private readonly dispatchModal = new DispatchModal()
  pmaList: MedicalPointItem[] = []
  role: AgencyRole = 'cmd'
  private cutTooltip: HTMLElement | null = null
  private readonly tip: HTMLElement
  private readonly handler: ScreenSpaceEventHandler
  private readonly refs: Record<string, HTMLElement>
  private currentCapacityText = ''
  private activeTipAnchor: HTMLElement | null = null
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
    this.tip.hidden = true
    document.body.append(this.tip)
    this.el.addEventListener('scroll', () => this.hideTip(), { passive: true })
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
      button.title = `${spec.name}: escolhe e clica no mapa`
      button.setAttribute('aria-pressed', 'false')
      const icon = document.createElement('img')
      icon.alt = ''
      icon.src = getUnitTacticalCanvas(id as UnitId).toDataURL()
      const label = document.createElement('span')
      label.textContent = id === 'crew' ? 'Brigada' : spec.short
      button.append(icon, label)
      button.addEventListener('click', () => this.arm(id as UnitId))
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
    this.refs.capacityInfo?.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this.tip.hidden || this.activeTipAnchor !== this.refs.capacityInfo) {
        this.showTip(this.refs.capacityInfo, this.currentCapacityText)
        this.activeTipAnchor = this.refs.capacityInfo
        this.refs.capacityInfo.classList.add('active')
      } else {
        this.hideTip()
      }
    })
    this.refs.capacityInfo?.addEventListener('mouseenter', () => {
      this.showTip(this.refs.capacityInfo, this.currentCapacityText)
    })
    this.refs.capacityInfo?.addEventListener('mouseleave', () => {
      if (this.activeTipAnchor !== this.refs.capacityInfo) {
        this.hideTip()
      }
    })
    document.addEventListener('click', () => {
      if (this.activeTipAnchor === this.refs.capacityInfo) {
        this.hideTip()
      }
    })
    this.refs.simulate.addEventListener('click', () => this.actions.simulate())
    this.refs.ils.addEventListener('click', () => {
      if (!this.ils && this.ilsDue === undefined) return this.runIls(true)
      this.stopIls(true)
    })
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
      this.decisions[0] = clone(this.loaded.example)
      for (const a of this.decisions[0].assignments) a.dispatchMin = this.dispatchMinute()
      this.ilsFor = '' // B is searched again even when A already was the example
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

  /** A decision's barriers with what laid each one (wetLine.ts), the same the fast model applies. */
  private wetLinesOf(d: Decision): WetLine[] {
    if (!this.loaded) return []
    const { scenario } = this.loaded
    return wetLines(scenario, d, freeArrival(scenario))
  }

  /** "10:25 (T+25 min)": the wall clock and the minute of the run a barrier holds from. */
  private holdsFrom(minute: number): string {
    const start = this.loaded?.fire.start
    return `${start ? `${fmtTime(wallClock(start, minute / 60))} ` : ''}(T+${Math.round(minute)} min)`
  }

  /** Hours after the ignition the drawer stands at. */
  get hours(): number {
    return this.minutes / 60
  }

  setHours(hours: number) {
    this.setMinutes(Math.round((Math.min(Math.max(hours, 0), this.maxMin / 60) * 60) / 5) * 5)
  }

  /** Synchronizes simulation hour with active playback or timeline, updating road cuts and tactical perimeters dynamically. */
  syncTime(hours: number) {
    const targetMin = Math.round(Math.max(0, hours) * 60)
    if (this.minutes !== targetMin) {
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
    }
  }

  private setMinutes(minutes: number) {
    this.minutes = minutes
    const hour = this.refs.hour as HTMLInputElement
    hour.value = String(minutes)
    const start = this.loaded?.fire.start
    this.refs.hourText.textContent = `${fmtElapsed(this.hours)}${start ? ` · ${fmtTime(wallClock(start, this.hours))}` : ''}`
    this.updateEtas()
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
      Object.entries(example.points).map(([id, p]) => [id, context ? (snapToRoad(context, p, SNAP_M) ?? p) : p]),
    )
    const snapped = { ...clone(example), points: Object.fromEntries(Object.entries(points).map(([id, p]) => [id, { lon: p.lon, lat: p.lat }])) }
    this.stopIls()
    this.ilsDone = undefined
    this.loaded = { fireId, fire, stations, context, scenario, example: this.fit(snapped, scenario, stations) }
    this.decisions = [empty('A'), empty('B')]
    this.proposeB()
    this.runs = this.reports = this.judged = this.engine = this.free = undefined
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
    return this.ils !== undefined || this.ilsDue !== undefined
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
    this.drawing = []
    this.viewer.scene.canvas.style.cursor = tool ? 'crosshair' : ''
    this.renderUnits()
    this.refs.hint.classList.remove('danger', 'late')
    this.updateLineActionsUI()
    if (!tool) {
      this.refs.hint.textContent = ''
    } else if (tool === 'point') {
      this.refs.hint.textContent = isAerial(unit)
        ? `Clica no mapa onde o ${unit.short} descarrega. Escolhe outra vez o meio para parar.`
        : `Clica no mapa: o ${unit.short} fica no ponto de acesso mais próximo (estrada, caminho ou trilho) e faz a sua linha molhada. Escolhe outra vez o meio para parar.`
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
            ? '📍 Clica no mapa para colocar os vértices da linha apeada de defesa.'
            : '📍 Clica no mapa para colocar os vértices da linha aérea de descargas.'
    } else {
      const lenM = lineLengthM(this.drawing)
      finishBtn.disabled = false
      finishBtn.textContent = '✓ Concluir Linha'
      finishBtn.title = 'Concluir traçado e registar linha nos meios no terreno'

      const unit = this.sup.units[this.unit]
      let rateInfo = ''
      if (this.tool === 'line' && unit.lineMPerH) {
        const rateMPerH = (unit.lineMPerH[2] || 30) * this.count
        const hours = lenM / rateMPerH
        const pax = this.count * (unit.people || 5)
        rateInfo = ` · Estimativa: ~${hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(1)} h`} (${this.count} equipa${this.count > 1 ? 's' : ''} / ${pax} operacionais)`
      }

      this.refs.hint.classList.remove('danger', 'late')
      this.refs.hint.textContent = `📍 ${len} vértices · ${fmtNumber(lenM)} m de linha${rateInfo}. Clica em "✓ Concluir Linha", duplo clique no mapa, ou Enter.`
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
    const picked = this.viewer.scene.pick(position)
    const cut: RoadCutItem | undefined = (picked?.id as any)?._roadCut
    const pma: MedicalPointItem | undefined = (picked?.id as any)?._pma
    const unitInfo = (picked?.id as any)?._unitInfo

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
    this.viewer.scene.canvas.style.cursor = isFire && !aerial ? 'not-allowed' : 'crosshair'
  }

  private showCutTooltip(position: Cartesian2, cut: RoadCutItem) {
    if (!this.cutTooltip) {
      this.cutTooltip = document.createElement('div')
      this.cutTooltip.className = 'road-cut-tooltip'
      this.root.append(this.cutTooltip)
    }

    const urgencyBadge =
      cut.urgency === 'cortado'
        ? `<span class="status-badge red"><span style="display:inline-flex;vertical-align:middle;margin-right:4px;">${ICON_HAZARD}</span> CORTE ATIVO · INTERDITADO</span>`
        : cut.urgency === 'urgente'
          ? `<span class="status-badge orange"><span style="display:inline-flex;vertical-align:middle;margin-right:4px;">${ICON_HAZARD}</span> CORTE IMINENTE · IMPACTO EM ${cut.minutesToImpact} MIN</span>`
          : `<span class="status-badge yellow"><span style="display:inline-flex;vertical-align:middle;margin-right:4px;">${ICON_HAZARD}</span> CORTE PREVENTIVO · IMPACTO EM ${cut.minutesToImpact} MIN</span>`

    this.cutTooltip.className = `road-cut-tooltip ${cut.urgency}`
    this.cutTooltip.style.left = `${position.x}px`
    this.cutTooltip.style.top = `${position.y}px`
    this.cutTooltip.innerHTML = `
      <div class="tooltip-header">
        <span class="icon">${ICON_ROAD_CUT}</span>
        <span class="title">ESTRADA CORTADA</span>
      </div>
      <div class="tooltip-road">${cut.label}</div>
      <div class="tooltip-status">${urgencyBadge}</div>
      <div class="tooltip-detail">Tipo: ${cut.isPaved ? 'Via Pavimentada / Asfaltada' : 'Acesso Rural / Florestal'}</div>
      <div class="tooltip-action"><span class="badge-svg" style="display:inline-flex;vertical-align:middle;margin-right:5px;">${ICON_PSP}</span> <b>Ação PSP / GNR:</b> Colocar barreira física e desviar tráfego</div>
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
        <span class="icon">${ICON_PMA}</span>
        <span class="title" style="color:#6ee7b7;">INEM · POSTO MÉDICO AVANÇADO</span>
      </div>
      <div class="tooltip-road">${pma.name}</div>
      <div class="tooltip-status">
        <span class="status-badge" style="background:rgba(15,23,42,0.65);color:#6ee7b7;border:1px solid rgba(52,211,153,0.35);">
          <span style="display:inline-flex;vertical-align:middle;margin-right:4px;">${ICON_SHIELD}</span> Margem Segura: ${Math.round(pma.safeBufferMin)} min
        </span>
      </div>
      <div class="tooltip-detail">Hospital Destino: ${pma.hospitalDestination ?? 'Hospital de Braga'} (${pma.routeKm ? `${pma.routeKm.toFixed(1)} km · ETA ${Math.round(pma.etaMin ?? 0)} min` : 'Rota Ativa'})</div>
      <div class="tooltip-action" style="color:#6ee7b7;"><span class="badge-svg" style="display:inline-flex;vertical-align:middle;margin-right:5px;">${ICON_INEM}</span> <b>Corredor Verde:</b> Via segura e desimpedida para evacuação médica</div>
    `
    this.cutTooltip.hidden = false
  }

  private showUnitTooltip(
    position: Cartesian2,
    unitInfo: {
      assignment: Assignment
      point: LonLat
      allUnits: Assignment[]
      lines?: WetLine[]
    },
  ) {
    if (!this.cutTooltip) {
      this.cutTooltip = document.createElement('div')
      this.cutTooltip.className = 'road-cut-tooltip'
      this.root.append(this.cutTooltip)
    }

    const { assignment: a } = unitInfo
    const spec = this.sup.units[a.unit]
    const isAerialUnit = isAerial(spec)
    const base = isAerialUnit ? findAirBase(a.from) : undefined
    const station = !base ? this.loaded?.stations.find((s) => s.id === a.from) : undefined
    const taskLabel = TASK_NAME[a.task] ?? a.task
    const isCrew = a.unit === 'crew'

    const originDetail = isAerialUnit
      ? (base ? `${base.name} (${base.operator})` : 'Centro de Meios Aéreos')
      : (station?.name ?? 'Quartel de Bombeiros')

    const resourceDetail = isAerialUnit
      ? `${spec.waterL} L de água/retardante · ${base?.aircraftModel ?? 'Apoio Aéreo'}`
      : isCrew
        ? `${spec.people * a.count} operacionais apeados (ferramentas manuais)`
        : `${a.count} veículo${a.count > 1 ? 's' : ''} (${spec.short}) · ${spec.people * a.count} bombeiros · ${(spec.waterL ?? 0) * a.count} L de água`

    // The barriers this point or line puts in the scenario: what the engines get.
    const lines = unitInfo.lines ?? []
    const wet = lines.filter((w) => w.kind === 'wet')
    const dug = lines.filter((w) => w.kind === 'line')
    // One row per unit: its first line and the pieces it has laid since along the fire edge, summed.
    const wetBySlot = new Map<number, WetLine[]>()
    for (const w of wet) wetBySlot.set(w.slot, [...(wetBySlot.get(w.slot) ?? []), w])
    const lineText = (ws: WetLine[]) => {
      const first = ws[0]
      const grown = ws.filter((w) => w.grown)
      const last = Math.max(...ws.map((w) => w.barrier.from_min))
      return `${this.sup.units[this.decisions[this.active].assignments[first.slot]?.unit ?? a.unit].short}: ${fmtNumber(ws.reduce((m, w) => m + w.lengthM, 0))} m × ${fmtNumber(first.barrier.width_m)} m, segura a partir das ${this.holdsFrom(first.barrier.from_min)}${grown.length ? `, cresce ao longo da orla até às ${this.holdsFrom(last)}` : ''}${this.minutes >= first.barrier.from_min ? '' : ' · a caminho'}`
    }
    const barrierRows = [
      ...[...wetBySlot.values()].map((ws) => `Linha molhada ${lineText(ws)}`),
      ...(dug.length
        ? [`Linha apeada: ${dug.length} troço${dug.length > 1 ? 's' : ''}, ${fmtNumber(dug.reduce((m, w) => m + w.lengthM, 0))} m × ${fmtNumber(dug[0].barrier.width_m)} m, feita até às ${this.holdsFrom(Math.max(...dug.map((w) => w.barrier.from_min)))}`]
        : []),
    ]
    const aerialRow = unitInfo.allUnits.some((u) => isAerial(this.sup.units[u.unit]))
      ? `<div class="tooltip-detail" style="color:#5eead4;"><span style="display:inline-flex;vertical-align:middle;margin-right:4px;">${ICON_BOLT}</span> Descargas: abrandam o fogo enquanto frescas (não são barreira no ELMFIRE)</div>`
      : ''

    this.cutTooltip.className = 'road-cut-tooltip unit'
    this.cutTooltip.style.left = `${position.x}px`
    this.cutTooltip.style.top = `${position.y}px`
    this.cutTooltip.innerHTML = `
      <div class="tooltip-header">
        <span class="icon">${ICON_PROTECAO_CIVIL}</span>
        <span class="title" style="color:#60a5fa;">MEIO NO TERRENO · SIOPS</span>
      </div>
      <div class="tooltip-road">${spec.short} (${a.count > 1 ? `${a.count} veículos` : spec.name})</div>
      <div class="tooltip-status">
        <span class="status-badge" style="background:rgba(59,130,246,0.25);color:#93c5fd;border:1px solid rgba(59,130,246,0.5);">
          Tarefa: ${taskLabel.toUpperCase()}
        </span>
      </div>
      <div class="tooltip-detail">Origem: ${originDetail}</div>
      <div class="tooltip-detail">Efetivo: ${resourceDetail}</div>
      ${barrierRows.map((t) => `<div class="tooltip-detail" style="color:#7dd3fc;"><span style="display:inline-flex;vertical-align:middle;margin-right:4px;">${ICON_SHIELD}</span> ${t}</div>`).join('')}
      ${aerialRow}
      <div class="tooltip-action" style="color:#93c5fd;"><span style="display:inline-flex;vertical-align:middle;margin-right:4px;">${ICON_CHECK}</span> Meio alocado e ativo no cenário</div>
    `
    this.cutTooltip.hidden = false
  }

  private hideCutTooltip() {
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

  /** Ground units must beat the fire along their approach; no circular radius bans a destination. */
  private checkRing(p: LonLat): boolean {
    if (!this.loaded) return true
    const { scenario, stations } = this.loaded
    const from = this.from(stations)
    const station = stations.find((s) => s.id === from)
    const d = this.decisions[this.active]
    const ecin = !d.assignments.some((a) => a.from === from && !isAerial(this.sup.units[a.unit]))
    const meeting = station && scenario.fireArrival
      ? approachIntercept(scenario.grid, scenario.fireArrival, station, p, this.sup, this.sup.units[this.unit], this.dispatchMinute(), ecin)
      : undefined
    if (!meeting) return true
    const text = `O fogo interceta os meios de ${station?.short ?? from} no percurso (T+${Math.round(meeting.arriveMin)} min). Escolhe um acesso antes da frente prevista.`
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

  private click(position: Cartesian2) {
    if (!this.open || !this.tool || !this.loaded) return
    const p = this.pick(position)
    if (!p) return

    const { context, stations, scenario } = this.loaded
    const aerial = isAerial(this.sup.units[this.unit])

    // Ground vehicles snap to road. Aerial vehicles (planes/helis) have 100% free spatial allocation!
    const access = (!aerial && context) ? snapToRoad(context, p, SNAP_M) : undefined
    const point = access ? { lon: access.lon, lat: access.lat } : p

    // Active fire safety check: reject placing ground crews inside active fire perimeter.
    // Aircraft drop water directly from above into active flames, so exempt them.
    const cell = cellOf(scenario.grid, point)
    const activeRun = this.runs ? (this.runs[this.decisions[this.active].id as 'A' | 'B'] ?? this.runs.free) : undefined
    if (!aerial && cell >= 0 && activeRun && activeRun.arrival[cell] <= this.minutes) {
      this.showDangerWarning(point, activeRun.arrival[cell])
      return
    }

    if (this.tool === 'pma') {
      this.setPmaLocation(point)
      this.setTool(null)
      return
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
      dispatchMin: this.dispatchMinute(),
    })
    this.refs.hint.classList.remove('danger', 'late')
    this.refs.hint.textContent = aerial
      ? `✈️ Meio aéreo (${this.sup.units[this.unit].short}) de ${base?.short ?? 'Base Aérea'} (${fmtKm(distanceM(base ?? point, point) / 1000)}) alocado nas coordenadas (${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}).`
      : access
        ? `Ponto no acesso mais próximo (${roadName(context!, access.road)}), a ${fmtNumber(distanceM(p, point))} m do clique.`
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
    d.assignments.push({ unit: this.unit, count, from: this.from(this.loaded.stations), target: id, task, dispatchMin: this.dispatchMinute() })
    const lenM = lineLengthM(this.drawing)
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

  /** The decisions changed: show them and have them simulated again. By hand, a new
   *  A has B searched again; B changed by hand ends its search, and is no longer what it proposed. */
  private commit(byIls = false) {
    const late = byIls ? -1 : this.newlyLate()
    if (!byIls) {
      if (planKey(this.decisions[0]) !== this.ilsFor) this.proposeB()
      else if (planKey(this.decisions[1]) !== this.ilsB) {
        this.stopIls()
        this.ilsDone = undefined
      }
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

  /** A is new: B starts again as A, and is searched once A has been still for a moment. */
  private proposeB() {
    this.stopIls()
    this.ilsDone = undefined
    this.ilsFor = planKey(this.decisions[0])
    this.setB(named(this.decisions[0]))
    if (this.loaded?.context && movable(this.decisions[0])) this.ilsDue = window.setTimeout(() => this.runIls(), ILS_AFTER_MS)
    this.renderIls()
  }

  /** Search B with A's means (optimize.ts) in a worker: B follows its best plan, and shows what moved.
   *  By the button, B starts again from A and its tab opens at the end. */
  private runIls(byHand = false) {
    window.clearTimeout(this.ilsDue)
    this.ilsDue = undefined
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
    const scenario = { ...loaded.scenario, durationMin: Math.min(loaded.scenario.durationMin, ILS_HORIZON_MIN) }
    const request: IlsRequest = { scenario, ground: groundOf(loaded.context), a: clone(this.decisions[0]), budgetMs: ILS_BUDGET_MS, seed: 1 }
    worker.postMessage(request)
    this.renderIls()
  }

  /** Ends the search, or the one due; by the button, B keeps the best plan it had shown, and says what it saves. */
  private stopIls(byHand = false) {
    window.clearTimeout(this.ilsDue)
    this.ilsDue = undefined
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
    const busy = this.ils !== undefined || this.ilsDue !== undefined
    button.textContent = busy ? 'Parar' : 'Procurar B de novo'
    button.disabled = !busy && (!this.loaded?.context || !canMove)
    const note = this.refs.ilsNote
    const list = this.refs.ilsChanges
    list.replaceChildren()
    if (busy) {
      note.textContent = this.ils?.note ?? 'O A mudou: o B vai ser procurado com os mesmos meios.'
      return
    }
    const done = this.ilsDone
    if (!done) {
      note.textContent = !this.loaded?.context
        ? 'Sem dados OSM para este incêndio: sem acessos onde pôr os meios, o B fica igual ao A.'
        : planKey(this.decisions[1]) !== this.ilsB
          ? 'O B foi mudado à mão e já não é a proposta do ILS: "Procurar B de novo", ou mudar o A, volta a propô-lo.'
          : canMove
            ? 'Procura parada: o B ainda é igual ao A.'
            : !this.decisions[0].assignments.length
              ? 'O A ainda não tem meios: põe meios no mapa e o B é procurado com os mesmos.'
              : 'O A não tem meios para mudar de sítio: o B fica igual ao A.'
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
      <div class="who"><b></b><span class="n"></span><span class="task"></span></div>
      <div class="meta"><span class="from"></span><em></em></div>`
    const unit = this.sup.units[c.unit]
    li.querySelector('b')!.textContent = unit.short
    li.querySelector('.n')!.textContent = `×${c.count}`
    li.querySelector('.task')!.textContent = TASK_NAME[c.task]
    li.querySelector('.from')!.textContent = isAerial(unit) ? 'Base aérea' : (this.loaded?.stations.find((s) => s.id === c.from)?.short ?? c.from)
    const access = c.b && !isAerial(unit) && this.loaded?.context ? snapToRoad(this.loaded.context, c.b, 60) : undefined
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
    li.querySelector('em')!.textContent = where
    return li
  }

  private updateStationDropdown() {
    const from = this.refs.from as HTMLSelectElement
    if (!this.loaded) return
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
          option.textContent = `${b.short} · ${fmtKm(km)}${badge}`
          return option
        }),
      )
      from.value = this.fromId
      return
    }

    const stations = this.loaded.stations
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
      task.innerHTML = `
        <option value="shuttle">abastecimento (cisterna móvel)</option>
        <option value="protect">proteção de estruturas</option>
      `
    } else if (this.unit === 'crew') {
      task.innerHTML = `
        <option value="direct">ataque direto (ferramentas)</option>
        <option value="protect">proteção de aldeia/estruturas</option>
        <option value="line">linha apeada (desenha no mapa)</option>
      `
    } else if (this.unit === 'vfci') {
      task.innerHTML = `
        <option value="direct">ataque direto (linha de 25mm)</option>
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
      : `Corrido com ${runs.A.engine ?? 'ELMFIRE'} (API). Só as linhas entram no motor; as descargas aéreas não. Cada fogo pára no corte da referência.${status?.state === 'done' && status.note ? ` ${status.note}` : ''}`
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
    this.hideTip()
    const late = this.late(d)
    this.lateShown = { id: d.id, keys: new Set(d.assignments.filter((_, k) => late[k] !== undefined).map(lateKey)) }
    const rows = d.assignments.map((a, k) => ({ a, k, kind: kindOf(this.sup.units[a.unit]) }))
    this.refs.list.replaceChildren(
      ...GROUPS.flatMap(({ kind, name }) => {
        const mine = rows.filter((r) => r.kind === kind)
        if (!mine.length) return []
        const head = document.createElement('li')
        head.className = 'group'
        head.innerHTML = '<span></span><b></b>'
        head.querySelector('span')!.textContent = name
        head.querySelector('b')!.textContent = String(mine.reduce((n, r) => n + r.a.count, 0))
        return [head, ...mine.map(({ a, k }) => this.row(a, k, late[k]))]
      }),
    )
    if (!d.assignments.length) this.refs.list.innerHTML = '<li class="none">Nada no terreno: o fogo corre livre.</li>'
  }

  private row(a: Assignment, k: number, lateMin?: number): HTMLElement {
    const li = document.createElement('li')
    li.className = 'assignment'
    const unit = this.sup.units[a.unit]
    const d = this.decisions[this.active]
    const target = d.points[a.target] ?? d.lines[a.target]?.[0]
    // The minute the model has it at work, the one its barrier holds from (wetLine.ts arrivals).
    const eta = target && this.loaded ? arrivals(this.loaded.scenario, d)[k] : undefined
    const isGround = !isAerial(unit)
    const base = isAerial(unit) ? findAirBase(a.from) : undefined
    const station = !base ? this.loaded?.stations.find((s) => s.id === a.from) : undefined

    let routeBadge = ''
    if (isGround && target && station && this.loaded?.context) {
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
      <div class="who"><b></b><span class="n"></span><span class="task"></span>
        <div class="ctl"><button type="button" class="info" aria-label="O que faz">i</button><button type="button" class="x" title="Retirar">×</button></div>
      </div>
      <div class="meta"><span class="from"></span>${routeBadge}${lateMin === undefined ? '' : '<span class="late-badge">chega tarde</span>'}<em></em></div>`
    li.querySelector('b')!.textContent = unit.short
    li.querySelector('.n')!.textContent = `×${a.count}`
    li.querySelector('.task')!.textContent = TASK_NAME[a.task]
    li.querySelector('.from')!.textContent = fromText
    const etaLabel = li.querySelector('em')!
    if (eta !== undefined) {
      etaLabel.dataset.eta = String(eta)
      etaLabel.textContent = this.etaText(eta)
    }
    const lateBadge = li.querySelector<HTMLElement>('.late-badge')
    if (lateBadge)
      lateBadge.title = `O fogo livre chega ${a.task === 'line' || a.task === 'drops' ? 'ao início da linha' : 'aqui'} aos T+${Math.round(lateMin!)} min: ${isGround ? `este meio não está lá ${SAFETY_MIN} min antes` : 'este meio não chega antes dele'}`
    const [info, x] = li.querySelectorAll('button')
    const what = this.whatText(a)
    info.addEventListener('mouseenter', () => this.showTip(info, what))
    info.addEventListener('focus', () => this.showTip(info, what))
    info.addEventListener('mouseleave', () => this.hideTip())
    info.addEventListener('blur', () => this.hideTip())
    x.addEventListener('click', () => this.remove(k))
    if (isGround && target && d.points[a.target] && unit.wetLineWidthM && (a.task === 'direct' || a.task === 'protect') && this.loaded) {
      const rotation = document.createElement('div')
      rotation.className = 'wetline-rotation'
      const label = document.createElement('label')
      label.textContent = 'Rodar linha'
      const slider = document.createElement('input')
      slider.type = 'range'; slider.min = '0'; slider.max = '179'; slider.step = '1'
      slider.setAttribute('aria-label', `Orientação da linha molhada de ${unit.short}`)
      slider.title = '0°: norte–sul · 90°: este–oeste'
      slider.value = String(Math.round(wetLineBearing(this.loaded.scenario, freeArrival(this.loaded.scenario), target, a)) % 180)
      const angle = document.createElement('output')
      angle.textContent = `${slider.value}°`
      const auto = document.createElement('button')
      auto.type = 'button'; auto.textContent = 'Auto'
      auto.title = 'Voltar à orientação transversal à propagação do fogo'
      auto.disabled = a.wetLineBearingDeg === undefined
      slider.addEventListener('input', () => {
        this.stopIls()
        a.wetLineBearingDeg = Number(slider.value)
        angle.textContent = `${slider.value}°`; auto.disabled = false
        this.draw() // Keep this slider alive while dragging; rebuild the row when released.
        this.actions.changed()
      })
      slider.addEventListener('change', () => this.commit())
      auto.addEventListener('click', () => { delete a.wetLineBearingDeg; this.commit() })
      label.append(slider)
      rotation.append(label, angle, auto)
      li.append(rotation)
    }
    return li
  }

  private etaText(eta: number): string {
    const remaining = Math.ceil(eta - this.minutes - 1e-6)
    return `${remaining > 0 ? 'chega' : 'no local desde'} ${this.holdsFrom(eta)}${remaining > 0 ? ` · faltam ${remaining} min` : ''}`
  }

  private updateEtas() {
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
    const { height } = this.tip.getBoundingClientRect()
    this.tip.style.left = `${this.el.getBoundingClientRect().right + 10}px`
    this.tip.style.top = `${Math.min(Math.max(r.top + r.height / 2 - height / 2, 8), innerHeight - height - 8)}px`
    this.tip.style.setProperty('--arrow', `${r.top + r.height / 2 - parseFloat(this.tip.style.top)}px`)
  }

  private hideTip() {
    this.tip.hidden = true
    this.activeTipAnchor = null
    this.refs.capacityInfo?.classList.remove('active')
  }

  /** What the assignment does, in one line: the barrier it lays (the engines' input), the drops, the water. */
  private whatText(a: Assignment): string {
    const unit = this.sup.units[a.unit]
    const d = this.decisions[this.active]
    const { waterPointKm } = this.sup.dispatch
    const slot = d.assignments.indexOf(a)
    const mine = this.wetLinesOf(d).filter((w) => w.slot === slot)
    if (a.task === 'line') {
      const total = lineLengthM(d.lines[a.target] ?? [])
      const run = this.runs?.[d.id as 'A' | 'B']
      if (!this.loaded || !run) return `${fmtNumber(total)} m de linha`
      const { grid } = this.loaded.scenario
      // A piece is done in time if the fire reaches none of its cells before it is finished.
      const inTime = mine.filter((w) => stripCells(grid, w.barrier).every((c) => run.arrival[c] >= w.barrier.from_min))
      return `${fmtNumber(inTime.reduce((m, w) => m + w.lengthM, 0))} de ${fmtNumber(total)} m feitos antes do fogo, em troços de 30 min de trabalho`
    }
    if (a.task === 'drops' && unit.holdMin && unit.dropM) {
      const every = dropCycleMin(unit, waterPointKm) / a.count
      const stretches = Math.max(1, Math.floor(unit.holdMin / every))
      return `${fmtNumber(lineLengthM(d.lines[a.target] ?? []))} m · descarga a cada ~${fmtNumber(every)} min onde o fogo toca · ${stretches} troços de ${unit.dropM[0]} m seguros ${unit.holdMin} min`
    }
    if (a.task === 'shuttle')
      return `abastece os veículos neste ponto: a linha molhada deles cresce ${fmtNumber((unit.wetLineLengthM ?? 0) * a.count)} m com a água do tanque`
    if (isAerial(unit)) return `${a.count} × ${unit.waterL} L a cada ~${fmtNumber(dropCycleMin(unit, waterPointKm) / a.count)} min · abranda ${fmtNumber(aerialFrontM(unit, a.count, waterPointKm))} m de frente · chama até ${unit.holdFlameM} m`
    // Ground units at a point: the wet line across the spread, from their arrival.
    const w = mine[0]
    if (!w) return 'chega depois do fim da simulação: não faz linha'
    const grown = mine.some((x) => x.grown)
    return `linha molhada de ${fmtNumber(mine.reduce((m, x) => m + x.lengthM, 0))} × ${fmtNumber(w.barrier.width_m)} m atravessada ao fogo, segura a partir das ${this.holdsFrom(w.barrier.from_min)}${grown ? ' e a crescer ao longo da orla' : ''}`
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
      parts.push(`${unit.people * this.count} pessoas`)
      if (unit.wetLineLengthM) {
        const length = Math.min(unit.wetLineLengthM * this.count, unit.reachM ? 2 * unit.reachM : Infinity)
        parts.push(`num ponto, linha molhada de ${fmtNumber(length)} × ${fmtNumber(unit.wetLineWidthM ?? 0)} m atravessada ao fogo, a partir da chegada`)
      }
      if (unit.waterL) parts.push(`${unit.waterL} L${this.unit === 'vttu' ? ' (em abastecimento, a linha dos veículos do ponto cresce com eles)' : ''}`)
      if (unit.lineMPerH) parts.push(`linha apeada: ${unit.lineMPerH[1] * this.count} m/h em erva, ${unit.lineMPerH[2] * this.count} m/h em mato`)
    }
    this.currentCapacityText = parts.join(' · ')
    if (this.activeTipAnchor === this.refs.capacityInfo && !this.tip.hidden) {
      this.showTip(this.refs.capacityInfo, this.currentCapacityText)
    }
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
    const { entities } = this.source
    entities.removeAll()
    this.routes.entities.removeAll()
    const d = this.decisions[this.active]
    const { context, scenario, stations } = this.loaded ?? {}
    const activeRun = this.runs ? (this.runs[d.id as 'A' | 'B'] ?? this.runs.free) : undefined

    // 1. Draw dark blue road routes connecting stations to ground attack points
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
          const path = route ? cleanLonLat(route.path) : []
          if (route && path.length) {
            // Dark blue safe driving route, on a pale halo so it reads on dark imagery (light blue is the wet line).
            const positions = path.map((pt) => Cartesian3.fromDegrees(pt.lon, pt.lat))
            this.routes.entities.add({ polyline: { positions, width: 7, clampToGround: true, material: ROUTE_HALO } })
            this.routes.entities.add({ polyline: { positions, width: 4, clampToGround: true, material: ROUTE } })
          }
        }
      }
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
    // Under them, each crew line as drawn, dashed grey: what is left of it is not finished within the run.
    for (const [id, line] of Object.entries(d.lines)) if (d.assignments.some((x) => x.target === id && x.task === 'line')) this.polyline(line, DIM, true)
    for (const w of lines) {
      const a = d.assignments[w.slot]
      const clean = cleanPath(w.barrier.path, (p) => p)
      if (!clean.length) continue // zero-length strip
      const positions = clean.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat))
      const holds = this.minutes >= w.barrier.from_min
      // pieces grown along the edge a bit fainter than the first line
      entities.add({ corridor: { positions, width: Math.max(w.barrier.width_m, 1), material: WET.withAlpha(holds ? (w.grown ? 0.45 : 0.6) : 0.2) } })
      const strip = entities.add({
        polyline: {
          positions,
          width: 3,
          clampToGround: true,
          material: holds ? WET : new PolylineDashMaterialProperty({ color: WET.withAlpha(0.7), dashLength: 10 }),
        },
      })
      const at = d.points[a.target] ?? d.lines[a.target]?.[0]
      if (at) (strip as any)._unitInfo = unitInfo(a, at, d.assignments.filter((x) => x.target === a.target))
    }

    // 3. Points of attack: the units' badge; aircraft over a point also show the front their drops slow
    // (a dashed ring in their colour: it slows the fire for a while, it is not a barrier).
    for (const [id, p] of Object.entries(d.points)) {
      const units = d.assignments.filter((a) => a.target === id)
      if (!units.length) continue
      const mainUnit = units[0]
      for (const a of units) {
        const spec = this.sup.units[a.unit]
        if (!isAerial(spec)) continue
        const r = aerialFrontM(spec, a.count, this.sup.dispatch.waterPointKm) / 2
        if (r <= 0) continue
        const ring = Array.from({ length: 49 }, (_, k) => destination(p, (k * 360) / 48, r))
        this.polyline(ring, Color.fromCssColorString(UNIT_COLOR[a.unit]), true)
      }
      const pointEntity = entities.add({
        position: Cartesian3.fromDegrees(p.lon, p.lat),
        billboard: {
          image: getUnitTacticalCanvas(mainUnit.unit),
          width: 22,
          height: 22,
          verticalOrigin: VerticalOrigin.CENTER,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Infinity,
        },
        label: {
          text: units.map((a) => `${this.sup.units[a.unit].short}${a.count > 1 ? `×${a.count}` : ''}`).join(' '),
          font: 'bold 10px ui-monospace, Menlo, monospace',
          fillColor: INK,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: 2, // FILL_AND_OUTLINE
          pixelOffset: new Cartesian2(0, 16),
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Infinity,
        },
      })
      ;(pointEntity as any)._unitInfo = unitInfo(mainUnit, p, units)
    }

    // 4. Drawn lines: on B, A's lines it moved or left under them, dotted; aerial drops (white, dashed),
    // crew lines (dashed grey where no piece of it is finished within the run; its pieces are the barriers above).
    if (d.id === 'B') for (const c of diffLines(this.decisions[0], d)) this.polyline(this.decisions[0].lines[c.id], DIM, true, 3)
    for (const [id, line] of Object.entries(d.lines)) {
      const a = d.assignments.find((x) => x.target === id)
      if (!a) continue
      const drops = a.task === 'drops'
      if (drops) this.polyline(line, INK, true)
      const lineEntity = entities.add({
        position: Cartesian3.fromDegrees(line[0].lon, line[0].lat),
        billboard: {
          image: getUnitTacticalCanvas(a.unit),
          width: 20,
          height: 20,
          verticalOrigin: VerticalOrigin.CENTER,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Infinity,
        },
        label: {
          text: `${this.sup.units[a.unit].short}${a.count > 1 ? `×${a.count}` : ''} (${Math.round(lineLengthM(line))} m)`,
          font: 'bold 10px ui-monospace, Menlo, monospace',
          fillColor: drops ? INK : WET,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: 2,
          pixelOffset: new Cartesian2(0, 16),
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Infinity,
        },
      })
      ;(lineEntity as any)._unitInfo = unitInfo(a, line[0], [a])
    }

    // 5. Line being drawn
    if (this.drawing.length) {
      this.polyline(this.drawing, this.tool === 'drops' ? INK : AMBER, true)
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
            }
            ;(lineEntity as any)._roadCut = roadItem
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
    } else {
      this.setTool('pma')
      this.refs.hint.classList.remove('danger', 'late')
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
/** B before the search has moved anything: A's own plan. */
const named = (a: Decision): Decision => ({ ...clone(a), id: 'B', name: ILS_NAME })
/** A plan without its name: what the search reads from A, and what it leaves in B. */
const planKey = (d: Decision) => JSON.stringify([d.points, d.lines, d.assignments])
const lateKey = (a: Assignment) => `${a.unit}|${a.from}|${a.target}|${a.task}`
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


