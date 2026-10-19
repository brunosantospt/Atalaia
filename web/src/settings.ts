// The settings drawer, on the right of the HUD: choices that hold across shots, one section each.
// Today the fire on screen and the spread engine. The fire lives in the URL hash, so a link opens
// it; the rest is remembered by this browser.

import type { FireIndexEntry } from './data'
import { DEFAULT_ENGINE, ENGINES, type EngineId } from './engines'
import { fmtDate, fmtHa, wallClock } from './format'

const STORAGE_KEY = 'atalaia.settings'

interface Stored {
  engine: EngineId
}

export interface SettingsActions {
  pickFire(id: string): void
}

const TEMPLATE = `
  <header>
    <span>Settings</span>
    <button type="button" data-ref="close" title="Fechar (Esc)">×</button>
  </header>
  <section>
    <h3>Incêndio</h3>
    <div class="choices" data-ref="fires"></div>
  </section>
  <section>
    <h3>Motor de propagação</h3>
    <div class="choices" data-ref="engines"></div>
    <p class="note">O replay mostra o incêndio observado. O motor escolhido é o que corre as simulações das decisões A e B.</p>
  </section>
`

export class SettingsPanel {
  readonly el: HTMLElement
  private stored = load()

  constructor(parent: HTMLElement, fires: FireIndexEntry[], actions: SettingsActions) {
    this.el = document.createElement('aside')
    this.el.className = 'settings'
    this.el.setAttribute('aria-label', 'Settings')
    this.el.innerHTML = TEMPLATE
    parent.append(this.el)
    const ref = (name: string) => this.el.querySelector<HTMLElement>(`[data-ref="${name}"]`)!

    ref('close').addEventListener('click', () => this.toggle(false))
    ref('fires').append(
      ...fires.map((f) =>
        choice('fire', f.id, { name: f.name, detail: `${fmtDate(wallClock(f.start, 0))} · ${fmtHa(f.areaHa)}` }, () =>
          actions.pickFire(f.id),
        ),
      ),
    )
    ref('engines').append(
      ...ENGINES.map((e) =>
        choice('engine', e.id, { name: e.name, detail: `${e.version} · ${e.method}`, ready: e.ready }, () => {
          this.stored = { ...this.stored, engine: e.id }
          save(this.stored)
        }),
      ),
    )
    this.input('engine', this.stored.engine).checked = true
    this.toggle(false)
  }

  get engine(): EngineId {
    return this.stored.engine
  }

  get open(): boolean {
    return this.el.classList.contains('open')
  }

  toggle(open = !this.open) {
    this.el.classList.toggle('open', open)
  }

  setFire(id: string) {
    this.input('fire', id).checked = true
  }

  private input(group: string, value: string): HTMLInputElement {
    return this.el.querySelector<HTMLInputElement>(`input[name="${group}"][value="${value}"]`)!
  }
}

interface Choice {
  name: string
  detail: string
  ready?: boolean // shown for engines: whether it can run yet
}

/** One option of a section: a radio with a name, its state on the right and a detail line. */
function choice(group: string, value: string, { name, detail, ready }: Choice, onPick: () => void) {
  const label = document.createElement('label')
  label.className = 'choice'
  label.innerHTML = '<input type="radio"><b></b><span class="state"></span><small></small>'
  const input = label.querySelector('input')!
  input.name = group
  input.value = value
  input.addEventListener('change', onPick)
  label.querySelector('b')!.textContent = name
  label.querySelector('small')!.textContent = detail
  if (ready !== undefined) {
    label.querySelector('.state')!.textContent = ready ? 'Pronto' : 'Em preparação'
    label.classList.toggle('pending', !ready)
  }
  return label
}

/** Storage can be missing or blocked (private windows); then the defaults hold for the visit. */
function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return { engine: ENGINES.some((e) => e.id === raw.engine) ? raw.engine : DEFAULT_ENGINE }
  } catch {
    return { engine: DEFAULT_ENGINE }
  }
}

function save(stored: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Not remembered, but the choice still holds until the page reloads.
  }
}
