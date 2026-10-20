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
  type Viewer,
} from 'cesium'
import type { Fire, NearStation } from './data'
import { lineSchedule, type Run, type Scenario } from './fastModel'
import { cellOf } from './grid'
import { fmtHa, fmtKm, fmtNumber } from './format'
import { distanceM, lerpLonLat, type LonLat } from './geo'
import { snapToRoad, type Context } from './osm'
import type { Report } from './report'
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

type Tool = 'point' | 'line' | 'drops'
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
  <section>
    <h3>Meios no terreno</h3>
    <ul class="assignments" data-ref="list"></ul>
  </section>
  <section>
    <h3>Adicionar</h3>
    <div class="palette">
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
    <p class="note" data-ref="capacity"></p>
    <div class="tools">
      <button type="button" data-tool="point">Ponto de ataque</button>
      <button type="button" data-tool="line">Linha de bombeiros</button>
      <button type="button" data-tool="drops">Linha de água aérea</button>
    </div>
    <p class="note hint" data-ref="hint"></p>
  </section>
  <section>
    <h3>Relatório às 6 h</h3>
    <table class="report" data-ref="report"></table>
    <p class="note" data-ref="detail"></p>
  </section>
  <footer>
    <button type="button" data-ref="clear">Limpar esta decisão</button>
    <button type="button" data-ref="reset">Repor exemplos</button>
  </footer>
`

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
  private loaded: Loaded | undefined
  private runs: Runs | undefined
  private reports: Reports | undefined
  private readonly source = new CustomDataSource('decisions')
  private readonly access = new CustomDataSource('access')
  private readonly handler: ScreenSpaceEventHandler
  private readonly refs: Record<string, HTMLElement>

  constructor(
    private readonly viewer: Viewer,
    parent: HTMLElement,
    private readonly sup: Suppression,
    private readonly actions: EditorActions,
  ) {
    this.el = document.createElement('aside')
    this.el.className = 'editor'
    this.el.setAttribute('aria-label', 'Editor de decisões')
    this.el.innerHTML = TEMPLATE
    parent.append(this.el)
    this.refs = Object.fromEntries(
      [...this.el.querySelectorAll<HTMLElement>('[data-ref]')].map((el) => [el.dataset.ref, el]),
    )
    void viewer.dataSources.add(this.source)
    void viewer.dataSources.add(this.access)
    this.handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    this.handler.setInputAction((e: { position: Cartesian2 }) => this.click(e.position), ScreenSpaceEventType.LEFT_CLICK)

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
      this.renderPalette()
    })
    const task = this.refs.task as HTMLSelectElement
    task.addEventListener('change', () => (this.task = task.value as Task))
    this.refs.less.addEventListener('click', () => this.setCount(this.count - 1))
    this.refs.more.addEventListener('click', () => this.setCount(this.count + 1))
    this.refs.close.addEventListener('click', () => this.toggle(false))
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

  toggle(open = !this.open) {
    if (open === this.open) return
    this.el.classList.toggle('open', open)
    if (!open) this.setTool(null)
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
    this.cancel()
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
    this.count = Math.min(Math.max(count, 1), 6)
    this.refs.count.textContent = String(this.count)
    this.renderPalette()
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
  }

  private click(position: Cartesian2) {
    if (!this.open || !this.tool || !this.loaded) return
    const p = this.pick(position)
    if (!p) return
    if (this.tool !== 'point') {
      this.drawing.push(p)
      this.draw()
      return
    }
    const { context, stations } = this.loaded
    const access = context ? snapToRoad(context, p, SNAP_M) : undefined
    const point = access ? { lon: access.lon, lat: access.lat } : p
    const d = this.decisions[this.active]
    const id = nextId(d.points, 'p')
    d.points[id] = point
    d.assignments.push({ unit: this.unit, count: this.count, from: this.from(stations), target: id, task: isAerial(this.sup.units[this.unit]) ? 'direct' : this.task })
    this.refs.hint.textContent = access
      ? `Ponto no acesso mais próximo (${roadName(context!, access.road)}), a ${fmtNumber(distanceM(p, point))} m do clique.`
      : `Sem estrada a menos de ${SNAP_M} m: o ponto ficou onde clicaste.`
    this.commit()
  }

  private finishLine() {
    if (!this.loaded || !this.tool || this.tool === 'point') return
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
    return isAerial(this.sup.units[this.unit]) ? 'air' : (stations[0]?.id ?? 'none')
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
    a.count = Math.min(Math.max(a.count + by, 1), 6)
    this.commit()
  }

  /** The decisions changed: remember them, show them and have them simulated again. */
  private commit() {
    if (this.loaded) save(this.loaded.fireId, this.decisions)
    this.render()
    this.actions.changed()
  }

  private render() {
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
    li.innerHTML = `
      <div class="who"><b></b><span class="n"></span><em></em></div>
      <div class="what"></div>
      <div class="ctl"><button type="button" title="Menos">−</button><button type="button" title="Mais">+</button><button type="button" class="x" title="Retirar">×</button></div>`
    li.querySelector('b')!.textContent = unit.short
    li.querySelector('.n')!.textContent = `× ${a.count}`
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
    const km = isAerial(unit) ? this.sup.dispatch.airBaseKm : station ? distanceM(station, target) / 1000 : this.sup.dispatch.airBaseKm
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
    for (const button of this.el.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      const tool = button.dataset.tool as Tool
      button.disabled = (tool === 'line' && !unit.lineMPerH) || (tool === 'drops' && !isAerial(unit))
    }
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
      tr.querySelectorAll('td').forEach((td, i) => (td.textContent = text(r[cols[i]])))
      table.append(tr)
    }
    const mine = r[this.decisions[this.active].id as 'A' | 'B']
    const places = mine.places.slice(0, 4).map((p) => `${p.name} T+${Math.round(p.minute)} min`)
    const roads = mine.roadsCut.slice(0, 4).map((c) => `${c.label} ${fmtKm(c.km)}`)
    this.refs.detail.textContent =
      `${this.decisions[this.active].id}: ` +
      [places.length ? `lugares ${places.join(', ')}` : 'nenhum lugar atingido', roads.length ? `estradas ${roads.join(', ')}` : 'nenhuma estrada cortada'].join(' · ') +
      '. Casas do OSM rural: um mínimo.'
  }

  /** The active decision on the ground: points, lines (built in time solid, late dashed), the line being drawn. */
  private draw() {
    const { entities } = this.source
    entities.removeAll()
    const d = this.decisions[this.active]
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
    if (this.drawing.length) {
      this.polyline(this.drawing, this.tool === 'drops' ? INK : AMBER, true)
      entities.add({ position: Cartesian3.fromDegrees(this.drawing[0].lon, this.drawing[0].lat), point: { pixelSize: 6, color: INK, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Infinity } })
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
