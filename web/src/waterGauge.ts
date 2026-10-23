// Water on the ground: the litres left in the tanks of the fire engines and tankers on scene against what they
// brought on the card; a click opens how fast the lines draw it, when the first engine runs dry and what is
// still on its way. The same display-only accounting
// as the unit cards and rings (combatResources); the spread model never reads it.

import { fmtMinutes, fmtNumber } from './format'
import { Floating } from './floating'
import type { Scenario } from './scenario'
import type { Decision } from './suppression'
import { Detail, type Row } from './widgetDetail'
import { cachedCombatResources, resourceAt } from './combatResources'
import './waterWidget.css'

const LOW = 0.25 // a quarter of the water brought, as the alerts' low tank

/** A movable screen widget, stacked under the intensity card until it is moved. */
export class WaterGauge {
  readonly el = document.createElement('section')
  private readonly total: HTMLElement
  private readonly fill: HTMLElement
  private readonly detail: Detail
  private readonly floating: Floating
  private shown = ''

  constructor(parent: HTMLElement, home: () => { x: number; y: number }, moved?: () => void) {
    this.el.className = 'float-card water-card'
    this.el.setAttribute('aria-label', 'Água em campo')
    this.el.title = 'Clique para ver o detalhe · arraste para mover só este card'
    this.el.innerHTML = `
      <div class="float-title">Água</div>
      <button type="button" class="float-drag" aria-label="Mover água em campo. Use as setas para deslocar, Home para repor ou Enter para ver o detalhe." title="Arraste para mover o bloco · duplo clique para repor"><span aria-hidden="true">⠿</span></button>
      <div class="water-total"><strong>—</strong> L</div>
      <div class="water-bar" style="--low: ${LOW * 100}%"><i></i></div>`
    this.total = this.el.querySelector('.water-total strong')!
    this.fill = this.el.querySelector('.water-bar i')!
    this.detail = new Detail(parent, 'Água em campo')
    parent.append(this.el)
    this.floating = new Floating(this.el, this.el.querySelector('.float-drag')!, parent, {
      home,
      moved,
      open: () => this.detail.show(this.el.querySelector<HTMLElement>('.float-drag')!),
    })
  }

  /** The units of the decision on the screen at `minute`. Cheap: the screen changes only when the text does. */
  update(scenario: Scenario, decision: Decision | undefined, minute: number) {
    const sup = scenario.suppression
    // The same accounting as the unit cards and their rings (combatResources): contact draws water, a held
    // front pauses it, tankers refill engines within reach, relocations carry what is left.
    const combat = decision ? cachedCombatResources(scenario, decision) : undefined
    const water = (decision?.assignments ?? []).flatMap((a, k) => {
      if (!combat || !['vfci', 'vttu', 'crew'].includes(a.unit)) return []
      const f = resourceAt(combat, k, minute), tank = combat.capacities[k] * a.count
      return [{ a, k, f, tankL: tank, litres: Math.max(0, f.waterPct / 100 * tank), onScene: minute >= f.arrival }]
    })
    const here = water.filter((w) => w.onScene)
    const sum = (list: typeof water, f: (w: (typeof water)[number]) => number) => list.reduce((n, w) => n + f(w), 0)
    const litres = sum(here, (w) => w.litres)
    const tankL = sum(here, (w) => w.tankL)
    const engines = here.filter((w) => w.a.unit === 'vfci')
    const wet = engines.filter((w) => w.f.waterPct > 0)
    const flowLPerMin = sum(wet.filter((w) => w.f.active && !w.f.contained), (w) => (sup.units.vfci.flowLPerMin ?? 200) / 2 * w.a.count)
    const dryUnits = sum(engines, (w) => (w.f.waterPct > 0 ? 0 : w.a.count))
    // Minutes until the first engine on scene runs dry, read ahead in the same frames.
    const dryAt = wet.map((w) => combat!.frames[w.k].findIndex((f, m) => m > minute && f.waterPct <= 0)).filter((m) => m > 0)
    const firstDry = dryAt.length ? Math.ceil(Math.min(...dryAt) - minute) : undefined
    const firstEta = water.length > here.length ? Math.ceil(Math.min(...water.filter((w) => !w.onScene).map((w) => w.f.arrival)) - minute) : undefined
    const share = tankL ? litres / tankL : 0
    const low = !!here.length && share < LOW
    const key = [here.length, Math.round(litres), Math.round(tankL), flowLPerMin, dryUnits, firstDry, firstEta, water.length].join('|')
    if (key === this.shown) return
    this.shown = key

    const count = (unit: string) => sum(here.filter((w) => w.a.unit === unit), (w) => w.a.count)
    this.total.textContent = here.length ? fmtNumber(litres) : '—'
    this.fill.style.width = `${Math.round(100 * share)}%`
    this.el.classList.toggle('low', low)
    this.el.classList.toggle('dry', dryUnits > 0)
    const state = !water.length ? 'Sem viaturas de água na decisão' : !here.length ? `A caminho; a 1.ª chega em ${fmtMinutes(firstEta!)}`
      : dryUnits ? `${dryUnits} VFCI sem água` : firstDry !== undefined ? `1.º VFCI vazio em ${fmtMinutes(firstDry)}` : 'Só cisternas no local'
    const level = !here.length ? undefined : dryUnits ? 'critical' : low ? 'warning' : 'good'
    const rows: Row[] = here.length ? [
      ['Nos tanques', `${fmtNumber(litres)} de ${fmtNumber(tankL)} L (${Math.round(100 * share)} %)`, level],
      ['Caudal', flowLPerMin ? `${fmtNumber(flowLPerMin)} L/min em combate` : 'em pausa (frente contida)'],
      ['Brigadas no local', `${count('crew')}`],
      ['VFCI no local', `${count('vfci')}${dryUnits ? ` · ${dryUnits} sem água` : ''}`],
      ['VTTU no local', `${count('vttu')}${count('vttu') ? ` · abastecem até ${sup.units.vttu.reachM ?? 300} m` : ''}`],
      ...(firstDry !== undefined ? [['1.º vazio', `daqui a ${fmtMinutes(firstDry)}, já com as cisternas`, low ? 'warning' : undefined] as Row] : []),
    ] : [['Estado', state]]
    if (firstEta !== undefined && here.length) rows.push(['A caminho', `${water.length - here.length} grupo(s); o 1.º chega em ${fmtMinutes(firstEta)}`])
    const tanks = `VFCI ${fmtNumber(2 * (sup.units.vfci.waterL ?? 3000))} L, brigada 600 L, VTTU ${fmtNumber(sup.units.vttu.waterL ?? 12000)} L`
    this.detail.set([{ heading: 'Viaturas de água da decisão no ecrã', rows }], [
      `Tanques: ${tanks} (Despacho n.º 3974/2013). A barra marca ${LOW * 100} % do que trouxeram.`,
      `Estimativa visual da demo, a mesma dos detalhes dos meios${sup.unlimitedWater ? '; o modelo de propagação conta com água ilimitada' : ''}.`,
    ].join('\n'))
    this.el.setAttribute('aria-label', `Água em campo: ${here.length ? `${fmtNumber(litres)} litros, ${Math.round(100 * share)} %; ` : ''}${state}`)
  }

  destroy() { this.floating.destroy(); this.detail.destroy(); this.el.remove() }
}
