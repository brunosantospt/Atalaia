import { Cartesian2, Cartesian3, Cartographic, Ellipsoid, EllipsoidalOccluder, Math as CesiumMath, SceneTransforms, type Viewer } from 'cesium'
import type { Weather } from './data'
import { compass, destination, type LonLat } from './geo'
import { fmtMinutes, fmtNumber } from './format'
import { Floating } from './floating'
import { Detail, type Row } from './widgetDetail'
import './windWidget.css'

/** Meteorological direction is where wind comes FROM; the needle points where it blows TO. */
export function windAt(weather: Weather, startIndex: number, minutes: number) {
  const h = Math.max(0, startIndex+minutes/60), i = Math.min(Math.floor(h), weather.time.length-1), j = Math.min(i+1, weather.time.length-1)
  const k = h-Math.floor(h), turn = ((weather.windFromDeg[j]-weather.windFromDeg[i]+540)%360)-180
  return { from: (weather.windFromDeg[i]+turn*k+360)%360, kmh: weather.windKmh[i]+(weather.windKmh[j]-weather.windKmh[i])*k,
    gust: weather.gustKmh[i]+(weather.gustKmh[j]-weather.gustKmh[i])*k }
}

const TURN_DEG = 30 // a turn the compass announces
const TURN_HORIZON_MIN = 180

/**
 * The next turn of the wind of TURN_DEG or more within the horizon: where it comes from once it has
 * settled (under 2° in 5 min) and in how many minutes, or undefined while it holds. Only from the weather
 * it is given, so before the shift the screen's forecast never gives the surprise away.
 */
export function nextTurn(weather: Weather, startIndex: number, minute: number): { from: number; inMin: number } | undefined {
  const turn = (a: number, b: number) => ((b-a+540)%360)-180
  const now = windAt(weather, startIndex, minute).from
  let t = 5
  while (t <= TURN_HORIZON_MIN && Math.abs(turn(now, windAt(weather, startIndex, minute+t).from)) < TURN_DEG) t += 5
  if (t > TURN_HORIZON_MIN) return undefined
  let from = windAt(weather, startIndex, minute+t).from
  for (let next = windAt(weather, startIndex, minute+t+5).from; Math.abs(turn(from, next)) >= 2 && t < 2*TURN_HORIZON_MIN; next = windAt(weather, startIndex, minute+t+5).from)
    (from = next), (t += 5)
  return { from, inMin: t }
}

const ARC_R = 47
const FORECAST_STEP_MIN = 30
// The vector map: arrows on a square of ground around the ignition, one every FIELD_STEP_M, as long as the wind
// is strong; zoomed out, never shorter than FIELD_MIN_PX on the screen. The weather is one point of the model,
// so the field is the same wind everywhere in the square.
const FIELD_HALF = 5 // arrows each side of the ignition: 11 by 11, 9 km a side
const FIELD_STEP_M = 900
const FIELD_MIN_PX = 16
const fieldLengthM = (kmh: number) => Math.min(560, 160 + 12 * kmh)

/**
 * A movable screen widget: the compass, where the wind turns next and its speed; a click opens the rest
 * (gusts, the turn, the next hours, the arrow on the map). Dragging never touches the globe or model weather.
 */
export class WindLayer {
  readonly el = document.createElement('section')
  private readonly mapArrow = document.createElement('div')
  private readonly mapNeedle: SVGElement
  private readonly mapAnchor: LonLat
  private readonly world = new Cartesian3()
  private readonly pixel = new Cartesian2()
  private readonly tailWorld = new Cartesian3()
  private readonly tipWorld = new Cartesian3()
  private readonly tailPixel = new Cartesian2()
  private readonly tipPixel = new Cartesian2()
  private readonly ground: Cartographic
  private readonly occluder: EllipsoidalOccluder
  private readonly rose: SVGElement
  private readonly needle: SVGElement
  private readonly ghost: SVGElement
  private readonly turnArc: SVGPathElement
  private readonly speed: HTMLElement
  private readonly detail: Detail
  private readonly mapToggle: HTMLInputElement
  private readonly fieldToggle: HTMLInputElement
  private readonly field = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  private readonly fieldPath: SVGPathElement
  private readonly fieldPoints: { at: LonLat; ground: Cartographic }[] = []
  private kmh = 0
  private readonly floating: Floating
  readonly home: () => { x: number; y: number } // under the HUD's title, where the widgets start
  private readonly remove: () => void
  private key = ''
  private weather?: Weather
  private to = 0
  private ghostTo?: number // where the needle will point after the next turn
  private heading = NaN

  constructor(private readonly viewer: Viewer, private readonly parent: HTMLElement, ignition: LonLat) {
    this.el.className = 'float-card wind-compass'
    this.el.setAttribute('aria-label', 'Bússola do vento')
    this.el.title = 'Clicar para ver o detalhe · arrastar para mover'
    this.el.innerHTML = `
      <div class="float-title">Vento</div>
      <button type="button" class="float-drag" aria-label="Mover bússola do vento: setas deslocam, Home repõe, Enter abre o detalhe." title="Arrastar para mover · duplo clique repõe"><span aria-hidden="true">⠿</span></button>
      <svg class="wind-dial" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="52" class="wind-bezel"/>
        <g class="wind-rose">
          <path class="wind-ticks" d="M60 11v7M60 102v7M11 60h7M102 60h7M25 25l4 4M91 91l4 4M25 95l4-4M91 29l4-4"/>
          <text x="60" y="31">N</text><text x="60" y="99">S</text><text x="95" y="64">E</text><text x="25" y="64">O</text>
          <path class="wind-turn" d=""/>
        </g>
        <g class="wind-ghost"><path d="M60 36 71 55 64 52V87H56V52L49 55Z"/></g>
        <g class="wind-needle"><path d="M60 36 71 55 64 52V87H56V52L49 55Z"/><circle cx="60" cy="60" r="4"/></g>
        <circle cx="60" cy="60" r="2" class="wind-centre"/>
      </svg>
      <div class="wind-speed"><strong>—</strong> km/h</div>`
    this.rose = this.el.querySelector('.wind-rose')!
    this.needle = this.el.querySelector('.wind-needle')!
    this.ghost = this.el.querySelector('.wind-ghost')!
    this.turnArc = this.el.querySelector('.wind-turn')!
    this.speed = this.el.querySelector('.wind-speed strong')!
    this.detail = new Detail(parent, 'Vento')
    this.detail.extra.innerHTML = `
      <label class="wind-map-toggle"><input type="checkbox" data-ref="arrow" autocomplete="off">Seta do vento no mapa, junto à ignição</label>
      <label class="wind-map-toggle"><input type="checkbox" data-ref="field" autocomplete="off">Mapa de vetores do vento sobre a zona do incêndio</label>`
    this.mapToggle = this.detail.extra.querySelector('[data-ref="arrow"]')!
    this.fieldToggle = this.detail.extra.querySelector('[data-ref="field"]')!
    for (let i = -FIELD_HALF; i <= FIELD_HALF; i++) for (let j = -FIELD_HALF; j <= FIELD_HALF; j++) {
      const at = destination(destination(ignition, 90, i * FIELD_STEP_M), 0, j * FIELD_STEP_M)
      this.fieldPoints.push({ at, ground: Cartographic.fromDegrees(at.lon, at.lat) })
    }
    this.field.setAttribute('class', 'map-wind-field')
    this.field.setAttribute('aria-hidden', 'true')
    this.fieldPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    this.field.append(this.fieldPath)
    this.mapAnchor = destination(ignition,45,300)
    this.ground = Cartographic.fromDegrees(this.mapAnchor.lon, this.mapAnchor.lat)
    this.occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, viewer.camera.positionWC)
    this.mapArrow.className = 'map-wind-arrow'
    this.mapArrow.hidden = true
    this.mapArrow.innerHTML = `<svg viewBox="0 0 120 120" aria-hidden="true">${this.needle.outerHTML}</svg>`
    this.mapArrow.setAttribute('role', 'img')
    this.mapNeedle = this.mapArrow.querySelector('.wind-needle')!
    parent.prepend(this.field) // under every panel of the HUD
    parent.append(this.mapArrow)
    // Both off on every new page: not remembered, not restored by the browser.
    this.mapToggle.checked = this.fieldToggle.checked = false
    const setMap = () => {
      this.projectArrow()
      this.projectField()
      this.viewer.scene.requestRender()
    }
    this.mapToggle.addEventListener('change', setMap)
    this.fieldToggle.addEventListener('change', setMap)
    setMap()
    parent.append(this.el)
    // Home under the screen's title, its left edge on the title's; the place it had stays while the editor
    // hides the title.
    const title = parent.querySelector<HTMLElement>('.title')
    let last = { x: 34, y: 200 }
    this.home = () => title?.offsetHeight ? (last = { x: title.offsetLeft, y: title.offsetTop + title.offsetHeight + 18 }) : last
    this.floating = new Floating(this.el, this.el.querySelector('.float-drag')!, parent, {
      home: this.home,
      watch: title ?? undefined,
      moved: () => viewer.scene.requestRender(), // Reflow map labels around the compass after a move.
      open: () => this.detail.show(this.el.querySelector<HTMLElement>('.float-drag')!),
    })
    this.remove = viewer.scene.postRender.addEventListener(() => { this.orient(); this.projectArrow(); this.projectField() })
    this.orient()
  }

  private projectArrow() {
    if (!this.mapToggle.checked) { this.mapArrow.hidden = true; return }
    const h = this.viewer.scene.globe.getHeight(this.ground) ?? 0
    Cartesian3.fromDegrees(this.mapAnchor.lon, this.mapAnchor.lat, h + 8, undefined, this.world)
    this.occluder.cameraPosition = this.viewer.camera.positionWC
    const p = this.occluder.isPointVisible(this.world) ? SceneTransforms.worldToWindowCoordinates(this.viewer.scene, this.world, this.pixel) : undefined
    const visible = !!p && p.x >= 0 && p.y >= 0 && p.x <= this.parent.clientWidth && p.y <= this.parent.clientHeight
    this.mapArrow.hidden = !visible
    if (visible) {
      // The arrow occupies 300 m on the ground. Both its anchor and projected size follow
      // the globe, instead of drifting a fixed number of screen pixels away from ignition.
      const tail = destination(this.mapAnchor,this.to+180,150), tip = destination(this.mapAnchor,this.to,150)
      Cartesian3.fromDegrees(tail.lon,tail.lat,h+8,undefined,this.tailWorld)
      Cartesian3.fromDegrees(tip.lon,tip.lat,h+8,undefined,this.tipWorld)
      const a = SceneTransforms.worldToWindowCoordinates(this.viewer.scene,this.tailWorld,this.tailPixel)
      const b = SceneTransforms.worldToWindowCoordinates(this.viewer.scene,this.tipWorld,this.tipPixel)
      if (!a || !b) { this.mapArrow.hidden=true; return }
      const size = Math.max(12,Math.min(320,Math.hypot(b.x-a.x,b.y-a.y)*120/51))
      const bearing = Math.atan2(b.x-a.x,a.y-b.y)*180/Math.PI
      this.mapArrow.style.width = this.mapArrow.style.height = `${size}px`
      this.mapArrow.style.transform = `translate(${p.x-size/2}px, ${p.y-size/2}px)`
      this.mapNeedle.setAttribute('transform',`rotate(${bearing} 60 60)`)
    }
  }

  /** The vector map: each arrow laid on the ground and drawn where it falls on the screen, over the relief. */
  private projectField() {
    const on = this.fieldToggle.checked
    this.field.style.display = on ? '' : 'none'
    if (!on) return
    this.occluder.cameraPosition = this.viewer.camera.positionWC
    const half = fieldLengthM(this.kmh) / 2, scene = this.viewer.scene
    const tail = new Cartesian3(), tip = new Cartesian3(), a = new Cartesian2(), b = new Cartesian2()
    let d = ''
    for (const p of this.fieldPoints) {
      // Sampled each frame: before the fine tiles load, the coarse ones can give heights kilometres off.
      const ground = scene.globe.getHeight(p.ground)
      const h = (ground !== undefined && ground > -100 && ground < 3000 ? ground : 0) + 8
      const from = destination(p.at, this.to + 180, half), to = destination(p.at, this.to, half)
      Cartesian3.fromDegrees(from.lon, from.lat, h, undefined, tail)
      Cartesian3.fromDegrees(to.lon, to.lat, h, undefined, tip)
      if (!this.occluder.isPointVisible(tail) || !this.occluder.isPointVisible(tip)) continue
      if (!SceneTransforms.worldToWindowCoordinates(scene, tail, a) || !SceneTransforms.worldToWindowCoordinates(scene, tip, b)) continue
      let len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len < 1) continue
      if (len < FIELD_MIN_PX) {
        // Grown about its middle, still along the ground's direction on the screen.
        const k = FIELD_MIN_PX / len, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        a.x = mx + (a.x - mx) * k; a.y = my + (a.y - my) * k; b.x = mx + (b.x - mx) * k; b.y = my + (b.y - my) * k
        len = FIELD_MIN_PX
      }
      // The head, two barbs back from the tip, a third of the arrow long at most.
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, head = Math.min(9, len * 0.35)
      const bx = b.x - ux * head, by = b.y - uy * head, wx = -uy * head * 0.55, wy = ux * head * 0.55
      d += `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`
        + `M${(bx + wx).toFixed(1)} ${(by + wy).toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}L${(bx - wx).toFixed(1)} ${(by - wy).toFixed(1)}`
    }
    this.fieldPath.setAttribute('d', d)
  }

  private orient() {
    const heading=CesiumMath.toDegrees(this.viewer.camera.heading)
    if (Math.abs(this.heading-heading)<.1) return
    this.heading=heading
    this.rose.setAttribute('transform',`rotate(${-heading} 60 60)`)
    this.needle.setAttribute('transform',`rotate(${this.to-heading} 60 60)`)
    if (this.ghostTo !== undefined) this.ghost.setAttribute('transform',`rotate(${this.ghostTo-heading} 60 60)`)
  }
  update(weather: Weather,start: number,minute: number) {
    const key=`${start}:${Math.round(minute)}`
    if (this.weather===weather && this.key===key) return
    this.weather=weather;this.key=key
    const wind=windAt(weather,start,Math.round(minute))
    this.to=(wind.from+180)%360
    this.kmh=wind.kmh
    this.el.dataset.from=String(wind.from);this.el.dataset.to=String(this.to)
    this.speed.textContent=fmtNumber(wind.kmh)
    // The next turn: a ghost needle where it will point, the arc it sweeps on the bezel, and when.
    const turn=nextTurn(weather,start,Math.round(minute))
    this.ghostTo=turn ? (turn.from+180)%360 : undefined
    this.el.classList.toggle('turning',!!turn)
    this.turnArc.setAttribute('d',turn ? arc(this.to,this.ghostTo!) : '')
    const sense=turn && ((turn.from-wind.from+540)%360)-180 > 0 ? 'horário' : 'anti-horário'
    const turnText=turn ? `roda para ${compass(turn.from)} (${Math.round(turn.from)}°) em ~${fmtMinutes(turn.inMin)}` : `sem rotação de ${TURN_DEG}° ou mais nas próximas ${TURN_HORIZON_MIN/60} h`
    const ahead: Row[]=[]
    for (let t=FORECAST_STEP_MIN; t<=TURN_HORIZON_MIN; t+=FORECAST_STEP_MIN) {
      const w=windAt(weather,start,Math.round(minute)+t)
      ahead.push([`+${fmtMinutes(t)}`, `de ${compass(w.from)} · ${fmtNumber(w.kmh)} km/h · rajadas ${fmtNumber(w.gust)}`])
    }
    this.detail.set([
      { heading:'Agora', rows:[
        ['Direção', `de ${compass(wind.from)} (${Math.round(wind.from)}°), sopra para ${compass(this.to)}`],
        ['Velocidade', `${fmtNumber(wind.kmh)} km/h`],
        ['Rajadas', `${fmtNumber(wind.gust)} km/h`],
      ] },
      { heading:'Rotação', rows: turn
        ? [['Próxima', `para ${compass(turn.from)} (${Math.round(turn.from)}°) em ${fmtMinutes(turn.inMin)}`, 'forecast'], ['Sentido', sense]]
        : [['Próxima', `estável nas próximas ${TURN_HORIZON_MIN/60} h`, 'good']] },
      { heading:`Próximas ${TURN_HORIZON_MIN/60} h`, rows:ahead },
    ], `A seta da bússola aponta para onde o vento sopra; a seta laranja tracejada, para onde vai soprar depois da próxima rotação de ${TURN_DEG}° ou mais.\nA bússola roda com a câmara: o N marca o norte no ecrã.\nO mapa de vetores leva o vento do ponto do modelo a toda a zona: a mesma direção em cada seta, o comprimento pela velocidade.`)
    this.el.setAttribute('aria-label',`Vento ${fmtNumber(wind.kmh)} km/h de ${compass(wind.from)}; rajadas ${fmtNumber(wind.gust)} km/h; ${turnText}`)
    this.mapArrow.setAttribute('aria-label', this.el.getAttribute('aria-label')!)
    this.heading=NaN;this.orient()
  }
  destroy() { this.remove();this.floating.destroy();this.detail.destroy();this.el.remove();this.mapArrow.remove();this.field.remove() }
}

/** The arc on the bezel from one bearing to another, the short way round (north up, clockwise). */
function arc(from: number, to: number): string {
  const sweep=((to-from+540)%360)-180
  const at=(deg: number) => { const r=deg*Math.PI/180; return `${(60+ARC_R*Math.sin(r)).toFixed(1)} ${(60-ARC_R*Math.cos(r)).toFixed(1)}` }
  return `M${at(from)}A${ARC_R} ${ARC_R} 0 0 ${sweep>0 ? 1 : 0} ${at(to)}`
}
