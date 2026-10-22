import { Math as CesiumMath, type Viewer } from 'cesium'
import type { Weather } from './data'
import { compass } from './geo'
import { fmtNumber } from './format'
import './windCompass.css'

/** Meteorological direction is where wind comes FROM; the needle points where it blows TO. */
export function windAt(weather: Weather, startIndex: number, minutes: number) {
  const h = Math.max(0, startIndex+minutes/60), i = Math.min(Math.floor(h), weather.time.length-1), j = Math.min(i+1, weather.time.length-1)
  const k = h-Math.floor(h), turn = ((weather.windFromDeg[j]-weather.windFromDeg[i]+540)%360)-180
  return { from: (weather.windFromDeg[i]+turn*k+360)%360, kmh: weather.windKmh[i]+(weather.windKmh[j]-weather.windKmh[i])*k,
    gust: weather.gustKmh[i]+(weather.gustKmh[j]-weather.gustKmh[i])*k }
}

const STORAGE_KEY = 'atalaia.wind-position'
/** A movable screen widget. Dragging never touches the globe or changes model weather. */
export class WindLayer {
  readonly el = document.createElement('section')
  private readonly rose: SVGElement
  private readonly needle: SVGElement
  private readonly speed: HTMLElement
  private readonly detail: HTMLElement
  private readonly handle: HTMLButtonElement
  private readonly resize: ResizeObserver
  private readonly remove: () => void
  private key = ''
  private weather?: Weather
  private to = 0
  private heading = NaN
  private position?: { x: number; y: number }
  private drag?: { pointer: number; x: number; y: number; left: number; top: number }

  constructor(private readonly viewer: Viewer, private readonly parent: HTMLElement) {
    this.el.className = 'wind-compass'
    this.el.setAttribute('aria-label', 'Bússola do vento')
    this.el.innerHTML = `
      <button type="button" class="wind-drag" aria-label="Mover bússola do vento. Use as setas para deslocar ou Home para repor." title="Arraste para mover · duplo clique para repor"><span>Vento</span><span aria-hidden="true">⠿</span></button>
      <svg class="wind-dial" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="52" class="wind-bezel"/>
        <g class="wind-rose">
          <path class="wind-ticks" d="M60 11v7M60 102v7M11 60h7M102 60h7M25 25l4 4M91 91l4 4M25 95l4-4M91 29l4-4"/>
          <text x="60" y="31">N</text><text x="60" y="99">S</text><text x="95" y="64">E</text><text x="25" y="64">O</text>
        </g>
        <g class="wind-needle"><path d="M60 36 71 55 64 52V87H56V52L49 55Z"/><circle cx="60" cy="60" r="4"/></g>
        <circle cx="60" cy="60" r="2" class="wind-centre"/>
      </svg>
      <div class="wind-speed"><strong>—</strong><span>km/h</span></div>
      <p class="wind-detail"></p><p class="wind-caption">Seta: para onde sopra</p>`
    this.rose = this.el.querySelector('.wind-rose')!
    this.needle = this.el.querySelector('.wind-needle')!
    this.speed = this.el.querySelector('.wind-speed strong')!
    this.detail = this.el.querySelector('.wind-detail')!
    this.handle = this.el.querySelector('.wind-drag')!
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) this.position = { x: Math.max(0,Math.min(1,saved.x)), y: Math.max(0,Math.min(1,saved.y)) }
    } catch { /* A malformed saved position simply uses the default. */ }
    parent.append(this.el)
    this.handle.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.drag) return
      e.preventDefault(); e.stopPropagation()
      this.handle.focus({preventScroll:true})
      this.drag = { pointer:e.pointerId, x:e.clientX, y:e.clientY, left:this.el.offsetLeft, top:this.el.offsetTop }
      this.handle.setPointerCapture(e.pointerId)
      this.el.classList.add('dragging')
    })
    this.handle.addEventListener('pointermove', e => {
      if (this.drag?.pointer !== e.pointerId) return
      e.preventDefault(); e.stopPropagation()
      this.move(this.drag.left+e.clientX-this.drag.x, this.drag.top+e.clientY-this.drag.y)
    })
    const endDrag = (e: PointerEvent) => {
      if (this.drag?.pointer !== e.pointerId) return
      this.drag = undefined
      this.el.classList.remove('dragging')
      if (this.handle.hasPointerCapture(e.pointerId)) this.handle.releasePointerCapture(e.pointerId)
      this.save()
    }
    this.handle.addEventListener('pointerup', endDrag)
    this.handle.addEventListener('pointercancel', endDrag)
    this.handle.addEventListener('lostpointercapture', endDrag)
    this.handle.addEventListener('dblclick', () => { this.position=undefined; this.place(); this.save() })
    this.handle.addEventListener('keydown', e => {
      const directions: Record<string, [number,number]> = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] }
      if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); this.position=undefined; this.place(); this.save(); return }
      const direction = directions[e.key]
      if (!direction) return
      e.preventDefault(); e.stopPropagation()
      const step=e.shiftKey ? 30 : 10
      this.move(this.el.offsetLeft+direction[0]*step,this.el.offsetTop+direction[1]*step)
      this.save()
    })
    this.resize = new ResizeObserver(() => this.place())
    this.resize.observe(parent)
    this.place()
    this.remove = viewer.scene.postRender.addEventListener(() => this.orient())
    this.orient()
  }

  private bounds() {
    return { x: Math.max(0,this.parent.clientWidth-this.el.offsetWidth-12), y:Math.max(0,this.parent.clientHeight-this.el.offsetHeight-12) }
  }
  private place() {
    const bounds=this.bounds()
    const x=this.position ? 12+this.position.x*Math.max(0,bounds.x-12) : this.parent.clientWidth-(this.parent.clientWidth<900 ? 190 : 385)
    const y=this.position ? 12+this.position.y*Math.max(0,bounds.y-12) : 190
    this.move(x,y)
  }
  private move(x: number,y: number) {
    const bounds=this.bounds(), left=Math.max(Math.min(12,bounds.x),Math.min(bounds.x,x)), top=Math.max(Math.min(12,bounds.y),Math.min(bounds.y,y))
    this.el.style.left=`${Math.round(left)}px`;this.el.style.top=`${Math.round(top)}px`
    this.position={x:bounds.x>12 ? (left-12)/(bounds.x-12) : 0,y:bounds.y>12 ? (top-12)/(bounds.y-12) : 0}
  }
  private save() {
    try { localStorage.setItem(STORAGE_KEY,JSON.stringify(this.position)) } catch { /* Moving still works without storage. */ }
    this.viewer.scene.requestRender() // Reflow map labels around the compass after a move.
  }
  private orient() {
    const heading=CesiumMath.toDegrees(this.viewer.camera.heading)
    if (Math.abs(this.heading-heading)<.1) return
    this.heading=heading
    this.rose.setAttribute('transform',`rotate(${-heading} 60 60)`)
    this.needle.setAttribute('transform',`rotate(${this.to-heading} 60 60)`)
  }
  update(weather: Weather,start: number,minute: number) {
    const key=`${start}:${Math.round(minute)}`
    if (this.weather===weather && this.key===key) return
    this.weather=weather;this.key=key
    const wind=windAt(weather,start,Math.round(minute))
    this.to=(wind.from+180)%360
    this.el.dataset.from=String(wind.from);this.el.dataset.to=String(this.to)
    this.speed.textContent=fmtNumber(wind.kmh)
    this.detail.textContent=`De ${compass(wind.from)} · rajadas ${fmtNumber(wind.gust)} km/h`
    this.el.setAttribute('aria-label',`Vento ${fmtNumber(wind.kmh)} km/h de ${compass(wind.from)}; rajadas ${fmtNumber(wind.gust)} km/h`)
    this.heading=NaN;this.orient()
  }
  destroy() { this.remove();this.resize.disconnect();this.el.remove() }
}
