// The settings drawer, on the right of the HUD: choices that hold across shots, one section each.
// Today the fire on screen and the spread engine. The fire lives in the URL hash, so a link opens
// it; the rest is remembered by this browser. The engines come from the API, asked again each time
// the drawer opens, so starting Docker or the API shows up without a reload.

import type { FireIndexEntry } from './data'
import { DEFAULT_ENGINE, type Engine, type EngineState, fetchEngines } from './engines'
import { fmtDate, fmtHa, wallClock } from './format'

const STORAGE_KEY = 'atalaia.settings'

const ENGINE_STATES: Record<EngineState, { label: string; hint: (id: string) => string }> = {
  ready: { label: 'Pronto', hint: () => '' },
  not_installed: { label: 'Não instalado', hint: (id) => `Falta a imagem: corre engines/${id}/setup.sh` },
  no_docker: { label: 'Docker desligado', hint: () => 'Os motores correm em contentores: abre o Docker' },
}

interface Stored {
  engine: string
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
    <p class="note" data-ref="no-api" hidden>A API está desligada, por isso não há motores. Corre api/serve.sh.</p>
    <p class="note">O replay mostra o incêndio de referência (observado, ou simulado no ELMFIRE). O motor escolhido é o que corre as simulações das decisões A e B.</p>
  </section>
`

export class SettingsPanel {
  readonly el: HTMLElement
  private stored = load()
  private engines: Engine[] | null = null
  private asked = 0 // engine lists asked for, so a late answer does not replace a newer one

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
    this.toggle(false)
    void this.loadEngines()
  }

  /** The engine picked here, or the default while the API has not listed it. */
  get engine(): string {
    return this.engines?.some((e) => e.id === this.stored.engine) ? this.stored.engine : DEFAULT_ENGINE
  }

  get open(): boolean {
    return this.el.classList.contains('open')
  }

  toggle(open = !this.open) {
    if (open && !this.open) void this.loadEngines()
    this.el.classList.toggle('open', open)
  }

  setFire(id: string) {
    this.input('fire', id).checked = true
  }

  private async loadEngines() {
    const asked = ++this.asked
    const engines = await fetchEngines()
    if (asked !== this.asked) return
    this.engines = engines
    this.el.querySelector<HTMLElement>('[data-ref="no-api"]')!.hidden = engines !== null
    this.el.querySelector('[data-ref="engines"]')!.replaceChildren(
      ...(engines ?? []).map((e) => {
        const { label, hint } = ENGINE_STATES[e.state]
        const state = { label, ready: e.state === 'ready', hint: hint(e.id) }
        return choice('engine', e.id, { name: e.name, detail: `${e.version} · ${e.method}`, state }, () => {
          this.stored = { ...this.stored, engine: e.id }
          save(this.stored)
        })
      }),
    )
    if (engines) this.input('engine', this.engine).checked = true
  }

  private input(group: string, value: string): HTMLInputElement {
    return this.el.querySelector<HTMLInputElement>(`input[name="${group}"][value="${value}"]`)!
  }
}

interface Choice {
  name: string
  detail: string
  state?: { label: string; ready: boolean; hint: string } // shown for engines: whether it can run here
}

/** One option of a section: a radio with a name, its state on the right and a detail line. */
function choice(group: string, value: string, { name, detail, state }: Choice, onPick: () => void) {
  const label = document.createElement('label')
  label.className = 'choice'
  label.innerHTML = '<input type="radio"><b></b><span class="state"></span><small></small>'
  const input = label.querySelector('input')!
  input.name = group
  input.value = value
  input.addEventListener('change', onPick)
  label.querySelector('b')!.textContent = name
  label.querySelector('small')!.textContent = detail
  if (state) {
    label.querySelector('.state')!.textContent = state.label
    label.classList.toggle('pending', !state.ready)
    label.title = state.hint
  }
  return label
}

/** Storage can be missing or blocked (private windows); then the defaults hold for the visit. */
function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return { engine: typeof raw.engine === 'string' ? raw.engine : DEFAULT_ENGINE }
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
