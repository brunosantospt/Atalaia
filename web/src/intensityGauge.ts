// How hot the head burns against what can still hold it: Byram's intensity of the head at the clock on a
// log dial, banded by the hold intensities of suppression.json (hand tools, vehicles, aircraft) and the
// extreme wildfire threshold, and from the run ahead the worse band it reaches within the hour (a dashed
// needle). A click opens the flame length, who can still attack it, when it gets worse and the sources.
// Reads the alerts' head; no model.

import { headAt, RULES, type AlertSide, type PreparedAlerts } from './alerts'
import { fmtMinutes, fmtNumber } from './format'
import { Floating } from './floating'
import { Detail, type Row } from './widgetDetail'
import { flameLengthM, isAerial, type Suppression, type UnitSpec } from './suppression'
import './intensityWidget.css'

type Level = 'good' | 'warning' | 'serious' | 'critical'
interface Band { upTo: number; level: Level; verdict: string }

const MIN_KW = 100 // the ends of the dial, kW/m on a log scale
const MAX_KW = 30000
const STATE_WORDS: Record<Level, string> = { good: 'ok', warning: 'atenção', serious: 'grave', critical: 'crítico' }
const AHEAD_MIN = 60
const CX = 60
const CY = 58
const R = 46
const GAP = 2 / R / Math.PI // the 2 px surface gap between bands, as a fraction of the dial
const NEEDLE = `M${CX - 2} ${CY}L${CX} ${CY - R + 9}L${CX + 2} ${CY}Z`

/** Who can still attack the head directly, by the hold intensities of the units (NWCG haul chart). */
function bandsOf(sup: Suppression): Band[] {
  const units = Object.values(sup.units)
  const hold = (pick: (u: UnitSpec) => boolean) => Math.max(0, ...units.filter(pick).map((u) => u.holdIntensityKWPerM))
  return [
    { upTo: hold((u) => !!u.lineMPerH), level: 'good', verdict: 'Todos os meios' },
    { upTo: hold((u) => !isAerial(u) && !u.lineMPerH), level: 'good', verdict: 'Viaturas e aéreos' },
    { upTo: hold(isAerial), level: 'warning', verdict: 'Só meios aéreos' },
    { upTo: RULES.intensityExtremeKWPerM, level: 'serious', verdict: 'Sem ataque direto' },
    { upTo: Infinity, level: 'critical', verdict: 'Incêndio extremo' },
  ]
}

const frac = (kw: number) => (Math.log(Math.min(MAX_KW, Math.max(MIN_KW, kw))) - Math.log(MIN_KW)) / (Math.log(MAX_KW) - Math.log(MIN_KW))
const at = (t: number, r = R) => {
  const a = Math.PI * (1 - t)
  return `${(CX + r * Math.cos(a)).toFixed(1)} ${(CY - r * Math.sin(a)).toFixed(1)}`
}
const turn = (kw: number) => `rotate(${((frac(kw) - 0.5) * 180).toFixed(1)} ${CX} ${CY})`

/** A movable screen widget, stacked under the wind compass until it is moved. */
export class IntensityGauge {
  readonly el = document.createElement('section')
  private readonly bands: Band[]
  private readonly needle: SVGPathElement
  private readonly ghost: SVGPathElement
  private readonly value: HTMLElement
  private readonly dot: HTMLElement
  private readonly detail: Detail
  private readonly floating: Floating
  private readonly holds: Row[]
  private key = ''
  private prepared?: PreparedAlerts

  constructor(parent: HTMLElement, above: HTMLElement, private readonly sup: Suppression, moved?: () => void) {
    this.bands = bandsOf(sup)
    this.el.className = 'float-card intensity-card'
    this.el.setAttribute('aria-label', 'Intensidade da frente')
    this.el.title = 'Clique para ver o detalhe · arraste para mover só este card'
    // The bands of one level are one arc; a notch marks where hand tools stop holding.
    const arcs: { from: number; to: number; level: Level }[] = []
    this.bands.forEach((b, k) => {
      const from = k ? frac(this.bands[k - 1].upTo) : 0
      const last = arcs.at(-1)
      if (last?.level === b.level) last.to = frac(b.upTo)
      else arcs.push({ from, to: frac(b.upTo), level: b.level })
    })
    const notch = frac(this.bands[0].upTo)
    this.el.innerHTML = `
      <div class="float-title">Intensidade</div>
      <button type="button" class="float-drag" aria-label="Mover intensidade. Use as setas para deslocar, Home para repor ou Enter para ver o detalhe." title="Arraste para mover o bloco · duplo clique para repor"><span aria-hidden="true">⠿</span></button>
      <svg class="intensity-dial" viewBox="8 6 104 58" aria-hidden="true">
        ${arcs.map((a, k) => `<path class="intensity-band ${a.level}" d="M${at(k ? a.from + GAP / 2 : 0)}A${R} ${R} 0 0 1 ${at(k < arcs.length - 1 ? a.to - GAP / 2 : 1)}"/>`).join('')}
        <path class="intensity-notch" d="M${at(notch, R - 5)}L${at(notch, R + 5)}"/>
        <path class="intensity-ghost" d="${NEEDLE}" style="display:none"/>
        <path class="intensity-needle" d="${NEEDLE}" style="display:none"/>
        <circle cx="${CX}" cy="${CY}" r="3.5" class="intensity-hub"/>
      </svg>
      <div class="intensity-value"><i></i><strong>—</strong> kW/m</div>`
    this.needle = this.el.querySelector('.intensity-needle')!
    this.ghost = this.el.querySelector('.intensity-ghost')!
    this.value = this.el.querySelector('.intensity-value strong')!
    this.dot = this.el.querySelector('.intensity-value i')!
    this.detail = new Detail(parent, 'Intensidade da frente')
    const byHold = new Map<number, string[]>()
    for (const u of Object.values(sup.units)) byHold.set(u.holdIntensityKWPerM, [...(byHold.get(u.holdIntensityKWPerM) ?? []), u.short])
    this.holds = [...byHold].sort((a, b) => a[0] - b[0]).map(([kw, names]) => [names.join(' / '), `até ${fmtNumber(kw)} kW/m`])
    parent.append(this.el)
    this.floating = new Floating(this.el, this.el.querySelector('.float-drag')!, parent, {
      storageKey: 'atalaia.intensity-position',
      home: () => ({ x: above.offsetLeft, y: above.offsetTop + above.offsetHeight + 10 }),
      moved,
      open: () => this.detail.show(this.el.querySelector<HTMLElement>('.float-drag')!),
    })
  }

  private bandOf(kw: number) {
    return kw >= RULES.intensityExtremeKWPerM ? this.bands.length - 1 : this.bands.findIndex((b) => kw <= b.upTo)
  }

  /** The head of the run on the screen at `minute`; nothing to read until the runs are prepared. */
  update(prepared: PreparedAlerts | undefined, minute: number, side: AlertSide) {
    const m = Math.floor(minute)
    const key = `${side}:${m}`
    if (this.prepared === prepared && this.key === key) return
    this.prepared = prepared
    this.key = key
    const head = prepared && headAt(prepared, m, side, AHEAD_MIN)
    const live = !!head?.started && head.ros > 0
    const kw = live ? head!.intensity : 0
    const band = this.bands[this.bandOf(kw)]
    this.needle.style.display = live ? '' : 'none'
    this.needle.setAttribute('transform', turn(kw))
    this.value.textContent = head?.started ? fmtNumber(kw) : '—'
    this.dot.className = live ? band.level : ''
    const state = live ? band.verdict : !prepared || (head && !head.started) ? 'A aguardar frente' : head ? 'Frente parada' : 'Fora da simulação'
    // A worse band within the hour: the dashed needle at its peak; when it gets there is in the detail.
    const peakBand = live ? this.bandOf(head!.peak) : -1
    const worse = live && peakBand > this.bandOf(kw)
    const inMin = worse ? head!.ahead.findIndex((i) => this.bandOf(i) >= peakBand) : -1
    this.ghost.style.display = worse ? '' : 'none'
    if (worse) this.ghost.setAttribute('transform', turn(head!.peak))
    const flame = live ? `${fmtNumber(flameLengthM(this.sup, kw), 1)} m` : ''
    const ahead = worse ? `passa a «${this.bands[peakBand].verdict.toLowerCase()}» em ${fmtMinutes(inMin)}` : `sem passar a uma classe pior na próxima hora`
    this.detail.set([
      { heading: `Agora${prepared ? ` · ${prepared.names[side]}` : ''}`, rows: live ? [
        ['Intensidade', `${fmtNumber(kw)} kW/m`],
        ['Ataque direto', `${band.verdict} (${STATE_WORDS[band.level]})`, band.level],
        ['Chama', flame],
        ['Velocidade', `${fmtNumber(head!.ros, 1)} m/min`],
      ] : [['Estado', state]] },
      ...(live ? [{ heading: 'Próxima hora', rows: [
        worse ? ['Piora', `${this.bands[peakBand].verdict} em ${fmtMinutes(inMin)}`, this.bands[peakBand].level] as Row
          : ['Tendência', band === this.bands.at(-1) ? 'Já na classe mais grave' : 'Sem passar a classe pior', band.level] as Row,
        ['Pico', head!.peak > kw ? `${fmtNumber(head!.peak)} kW/m daqui a ${fmtMinutes(head!.peakInMin)}` : `agora, ${fmtNumber(kw)} kW/m`, worse ? 'forecast' : undefined] as Row,
      ] }] : []),
      { heading: 'Ataque direto até', rows: [...this.holds, ['Incêndio extremo', `≥ ${fmtNumber(RULES.intensityExtremeKWPerM)} kW/m`]] },
    ], [
      `I = calor de combustão × carga fina média da cabeça nos últimos ${RULES.rosWindowMin} min × velocidade (Byram 1959), na corrida no ecrã.`,
      'Limites de ataque direto: haul chart NWCG (Andrews & Rothermel 1982). Incêndio extremo: Tedim et al. 2018.',
      ...(worse ? ['A agulha laranja tracejada marca o pico da próxima hora.'] : []),
    ].join('\n'))
    this.el.setAttribute('aria-label', live ? `Intensidade ${fmtNumber(kw)} kW/m: ${band.verdict.toLowerCase()}; ${ahead}` : `Intensidade: ${state}`)
  }

  destroy() { this.floating.destroy(); this.detail.destroy(); this.el.remove() }
}
