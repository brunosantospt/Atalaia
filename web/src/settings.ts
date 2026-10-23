// The settings drawer, on the right of the HUD: choices that hold across shots, one section each.
// Today the map under the fire, remembered by this browser, and which screen widgets are on, all of them
// on each new page. The globe is always drawn sharp and the spread runs on the fast model.

import { DEFAULT_MAP, MAPS, type MapId } from './basemap'
import type { LonLat } from './geo'

const STORAGE_KEY = 'atalaia.settings'

export type WidgetId = 'wind' | 'intensity' | 'water' | 'danger' | 'detection' | 'means' | 'growth'

export const WIDGETS: { id: WidgetId; name: string; detail: string }[] = [
  { id: 'wind', name: 'Vento', detail: 'Rumo e velocidade, a rotação prevista' },
  { id: 'intensity', name: 'Intensidade', detail: 'A frente contra o que a segura' },
  { id: 'water', name: 'Água', detail: 'Litros nos meios em campo' },
  { id: 'danger', name: 'Perigo', detail: 'FWI e classe do IPMA' },
  { id: 'detection', name: 'Deteção', detail: 'Drone e satélite na linha do tempo' },
  { id: 'means', name: 'Meios', detail: 'No local e próxima chegada' },
  { id: 'growth', name: 'Crescimento', detail: 'Hectares por hora sem combate' },
]

interface Stored {
  map: MapId
}

export interface SettingsActions {
  pickMap(id: MapId): void
  showWidget(id: WidgetId, on: boolean): void
}

const TEMPLATE = `
  <header>
    <span>Definições</span>
    <button type="button" data-ref="close" title="Fechar (Esc)">×</button>
  </header>
  <section>
    <h3>Mapa</h3>
    <div class="map-choices" data-ref="maps"></div>
    <p class="note">A tecla M muda de mapa.</p>
  </section>
  <section>
    <h3>Widgets</h3>
    <div class="choices" data-ref="widgets"></div>
  </section>
`

// The previews: one tile of each map around the fire, from tile servers that need no key. The satellite's
// is Esri's imagery, the same kind of picture as the globe's; the contours are drawn over a darkened one.
const PREVIEW_ZOOM = 14
const SATELLITE_TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const PREVIEW_TILES: Record<MapId, string> = {
  satellite: SATELLITE_TILE,
  roads: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  topo: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
  contours: SATELLITE_TILE,
}
const CONTOUR_LINES = `<svg viewBox="0 0 60 60" aria-hidden="true">${[8, 17, 26, 35, 44, 53].map((y, k) =>
  `<path d="M-2 ${y} C 14 ${y - 9}, 26 ${y + 7}, 38 ${y - 3} S 56 ${y - 8}, 62 ${y - 1}" stroke-width="${k % 3 === 1 ? 1.4 : 0.7}"/>`).join('')}</svg>`

export class SettingsPanel {
  readonly el: HTMLElement
  private stored = load()
  private readonly shown = new Set<WidgetId>(WIDGETS.map((w) => w.id))

  constructor(parent: HTMLElement, at: LonLat, actions: SettingsActions) {
    this.el = document.createElement('aside')
    this.el.className = 'settings'
    this.el.setAttribute('aria-label', 'Definições')
    this.el.innerHTML = TEMPLATE
    parent.append(this.el)
    const ref = (name: string) => this.el.querySelector<HTMLElement>(`[data-ref="${name}"]`)!

    ref('close').addEventListener('click', () => this.toggle(false))
    const tile = tileAt(at, PREVIEW_ZOOM)
    ref('maps').append(
      ...MAPS.map((m) =>
        mapChoice(m, PREVIEW_TILES[m.id].replace('{z}', String(PREVIEW_ZOOM)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y)), () => {
          this.stored = { ...this.stored, map: m.id }
          save(this.stored)
          actions.pickMap(m.id)
        }),
      ),
    )
    this.input('map', this.map).checked = true
    ref('widgets').append(
      ...WIDGETS.map((w) =>
        widgetChoice(w, (on) => {
          if (on) this.shown.add(w.id)
          else this.shown.delete(w.id)
          actions.showWidget(w.id, on)
        }),
      ),
    )
    this.toggle(false)
  }

  /** The map picked here, remembered by this browser. */
  get map(): MapId {
    return this.stored.map
  }

  /** Whether a screen widget is on: all of them on a new page. */
  showing(id: WidgetId): boolean {
    return this.shown.has(id)
  }

  /** Marks a map picked elsewhere (key M) and remembers it. */
  setMap(id: MapId) {
    this.stored = { ...this.stored, map: id }
    save(this.stored)
    this.input('map', id).checked = true
  }

  get open(): boolean {
    return this.el.classList.contains('open')
  }

  toggle(open = !this.open) {
    this.el.classList.toggle('open', open)
  }

  private input(group: string, value: string): HTMLInputElement {
    return this.el.querySelector<HTMLInputElement>(`input[name="${group}"][value="${value}"]`)!
  }
}

/** The Web Mercator tile with the point in it. */
function tileAt({ lon, lat }: LonLat, z: number) {
  const n = 2 ** z, phi = (lat * Math.PI) / 180
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n),
  }
}

/** One map: a square of it around the fire with its name under, a radio like the other choices. */
function mapChoice(map: { id: MapId; name: string; detail: string }, src: string, onPick: () => void) {
  const label = document.createElement('label')
  label.className = `map-choice map-${map.id}`
  label.title = map.detail
  label.innerHTML = `<input type="radio" name="map"><span class="map-preview"><img alt="" loading="lazy" referrerpolicy="no-referrer">${map.id === 'contours' ? CONTOUR_LINES : ''}</span><b></b>`
  const input = label.querySelector('input')!
  input.value = map.id
  input.addEventListener('change', onPick)
  label.querySelector('img')!.src = src
  label.querySelector('b')!.textContent = map.name
  return label
}

/** One widget: a checkbox with its name and what it shows. */
function widgetChoice(widget: { id: WidgetId; name: string; detail: string }, onToggle: (on: boolean) => void) {
  const label = document.createElement('label')
  label.className = 'choice check'
  label.innerHTML = '<input type="checkbox" checked><b></b><span class="state"></span><small></small>'
  const input = label.querySelector('input')!
  input.name = 'widget'
  input.value = widget.id
  input.addEventListener('change', () => onToggle(input.checked))
  label.querySelector('b')!.textContent = widget.name
  label.querySelector('small')!.textContent = widget.detail
  return label
}

/** Storage can be missing or blocked (private windows); then the defaults hold for the visit. */
function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return { map: MAPS.some((m) => m.id === raw.map) ? raw.map : DEFAULT_MAP }
  } catch {
    return { map: DEFAULT_MAP }
  }
}

function save(stored: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Not remembered, but the choice still holds until the page reloads.
  }
}
