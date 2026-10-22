// The means of the decision on the screen: how many are on scene of all dispatched, and when the next one
// arrives; a click opens them by kind, the nearest station and its vehicles, and the containment estimate.
// The same arrivals as the unit tooltips (tankerSupport) and the station as the ledger's Resposta.

import type { NearStation } from './data'
import { Floating } from './floating'
import { fmtKm, fmtMinutes, fmtPct } from './format'
import { fleet, stockSource, type Inventory } from './inventory'
import type { Scenario } from './scenario'
import type { Decision } from './suppression'
import { supplyStatuses } from './tankerSupport'
import { Detail, type Row } from './widgetDetail'
import './knownWidgets.css'

export interface MeansInput {
  stations: NearStation[]
  inventory: Inventory | null
  poc?(minute: number): number // containment estimate at the clock (hud's Simulated)
}

/** A movable screen widget, stacked where its home puts it until it is moved. */
export class MeansGauge {
  readonly el = document.createElement('section')
  private readonly value: HTMLElement
  private readonly sub: HTMLElement
  private readonly fill: HTMLElement
  private readonly detail: Detail
  private readonly floating: Floating
  private key = ''

  constructor(parent: HTMLElement, private readonly input: MeansInput, home: () => { x: number; y: number }, moved?: () => void) {
    this.el.className = 'float-card means-card'
    this.el.setAttribute('aria-label', 'Meios')
    this.el.title = 'Clique para ver o detalhe · arraste para mover só este card'
    this.el.innerHTML = `
      <div class="float-title">Meios</div>
      <button type="button" class="float-drag" aria-label="Mover meios. Use as setas para deslocar, Home para repor ou Enter para ver o detalhe." title="Arraste para mover o bloco · duplo clique para repor"><span aria-hidden="true">⠿</span></button>
      <div class="known-value"><strong>—</strong></div>
      <div class="means-bar" aria-hidden="true"><i></i></div>
      <div class="known-sub">&nbsp;</div>`
    this.value = this.el.querySelector('.known-value')!
    this.fill = this.el.querySelector('.means-bar i')!
    this.sub = this.el.querySelector('.known-sub')!
    this.detail = new Detail(parent, 'Meios da decisão')
    parent.append(this.el)
    this.floating = new Floating(this.el, this.el.querySelector('.float-drag')!, parent, {
      storageKey: 'atalaia.means-position',
      home,
      moved,
      open: () => this.detail.show(this.el.querySelector<HTMLElement>('.float-drag')!),
    })
  }

  update(scenario: Scenario, decision: Decision | undefined, minute: number) {
    const units = scenario.suppression.units
    const list = decision?.assignments ?? []
    const statuses = decision ? supplyStatuses(scenario, decision, minute) : []
    const items = list.map((a, k) => ({ a, s: statuses[k] })).filter((x) => Number.isFinite(x.s.eta))
    const total = items.reduce((n, x) => n + x.a.count, 0)
    const here = items.filter((x) => x.s.onScene).reduce((n, x) => n + x.a.count, 0)
    const waiting = items.filter((x) => !x.s.onScene)
    const next = waiting.length ? Math.ceil(Math.min(...waiting.map((x) => x.s.eta))) : undefined
    const poc = this.input.poc?.(minute)
    const key = [decision?.id, here, total, next, poc === undefined ? '' : Math.round(poc * 100)].join('|')
    if (key === this.key) return
    this.key = key

    this.value.innerHTML = total ? `<strong>${here}</strong> de ${total}` : '<strong>—</strong>'
    this.fill.style.width = `${total ? Math.round(100 * here / total) : 0}%`
    const state = !total ? 'Sem despacho' : next !== undefined ? `próx. ${fmtMinutes(next)}` : 'todos no local'
    this.sub.textContent = state

    const kinds = new Map<string, { here: number; total: number; next?: number }>()
    for (const { a, s } of items) {
      const k = kinds.get(a.unit) ?? { here: 0, total: 0 }
      k.total += a.count
      if (s.onScene) k.here += a.count
      else k.next = Math.min(k.next ?? Infinity, Math.ceil(s.eta))
      kinds.set(a.unit, k)
    }
    const byKind: Row[] = total ? [...kinds].map(([unit, k]) => [
      units[unit as keyof typeof units]?.short ?? unit.toUpperCase(),
      `${k.here} de ${k.total} no local${k.next !== undefined ? ` · próx. ${fmtMinutes(k.next)}` : ''}`,
      k.here === k.total ? 'good' : k.here ? 'warning' : 'forecast',
    ]) : [['Estado', decision ? 'A decisão no ecrã não despacha meios' : 'Sem decisão no ecrã']]
    const nearest = this.input.stations[0]
    const stock = nearest ? this.input.inventory?.[nearest.id] : undefined
    const station: Row[] = nearest ? [
      ['Quartel', `${nearest.short} · ${fmtKm(nearest.km)}`],
      ...(stock ? [
        ['Viaturas', fleet(stock) ?? `${stock.units.vfci ?? 0} VFCI · ${stock.units.vttu ?? 0} VTTU`] as Row,
        ['De serviço', `${stock.personnel.onDuty} de ${stock.personnel.total} bombeiros`] as Row,
      ] : []),
    ] : [['Quartel', 'Sem quartel a menos de 20 km']]
    this.detail.set([
      { heading: decision ? `No local · ${decision.name}` : 'No local', rows: byKind },
      { heading: 'Quartel mais próximo', rows: station },
      ...(poc !== undefined ? [{ heading: 'Contenção', rows: [['POC', fmtPct(poc), poc >= 0.7 ? 'good' : poc >= 0.4 ? 'warning' : 'serious'] as Row] }] : []),
    ], [
      'Chegadas pelos ETA de cada grupo (estrada ou ar), a contar do alerta do drone.',
      ...(stock ? [`Inventário: ${stockSource(stock)}.`] : []),
      ...(poc !== undefined ? ['POC: probabilidade de contenção pela área ardida, estimativa da demo.'] : []),
    ].join('\n'))
    this.el.setAttribute('aria-label', `Meios: ${total ? `${here} de ${total} no local; ` : ''}${state}`)
  }

  destroy() { this.floating.destroy(); this.detail.destroy(); this.el.remove() }
}
