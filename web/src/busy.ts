// The loading screen of an ELMFIRE simulation: a dark veil over the whole app that nothing gets through
// (pointer, wheel, keys, focus), until the runs are in or have failed and the commander says OK.

import './busy.css'

export class Busy {
  private readonly el = document.createElement('div')
  private readonly title: HTMLElement
  private readonly tasks: HTMLElement
  private readonly elapsed: HTMLElement
  private readonly error: HTMLElement
  private readonly ok: HTMLButtonElement
  private timer: number | undefined
  private t0 = 0
  private covered: HTMLElement[] = []
  private failed = false
  active = false

  constructor() {
    this.el.id = 'busy'
    this.el.hidden = true
    this.el.setAttribute('role', 'alertdialog')
    this.el.setAttribute('aria-modal', 'true')
    this.el.innerHTML = `
      <div class="box">
        <i class="spin"></i>
        <h2 data-ref="title"></h2>
        <p class="elapsed" data-ref="elapsed"></p>
        <ul class="tasks" data-ref="tasks"></ul>
        <p class="error" data-ref="error" hidden></p>
        <button type="button" data-ref="ok" hidden>OK</button>
      </div>`
    const ref = <T extends HTMLElement>(name: string) => this.el.querySelector<T>(`[data-ref="${name}"]`)!
    this.title = ref('title')
    this.tasks = ref('tasks')
    this.elapsed = ref('elapsed')
    this.error = ref('error')
    this.ok = ref<HTMLButtonElement>('ok')
    this.ok.addEventListener('click', () => this.hide())
    document.body.append(this.el)
    // First on the window, in the capture phase: while the veil stands no key reaches the page. Only OK answers.
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.active) return
        e.preventDefault()
        e.stopImmediatePropagation()
        if (this.failed && (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ')) this.hide()
      },
      true,
    )
    for (const type of ['keyup', 'keypress', 'wheel', 'contextmenu'])
      window.addEventListener(type, (e) => this.active && (e.preventDefault(), e.stopImmediatePropagation()), { capture: true, passive: false })
  }

  /** The veil goes up for these runs ("A", "B"): each is marked when it arrives. */
  start(title: string, tasks: string[]) {
    this.active = true
    this.failed = false
    this.title.textContent = title
    this.tasks.replaceChildren(
      ...tasks.map((name) => {
        const li = document.createElement('li')
        li.dataset.task = name
        li.innerHTML = '<b></b><span>…</span>'
        li.querySelector('b')!.textContent = name
        return li
      }),
    )
    this.error.hidden = this.ok.hidden = true
    this.el.classList.remove('failed')
    this.el.hidden = false
    // Nothing behind it takes focus or clicks: the page is inert, and the focused control lets go of its keys.
    this.covered = [...document.body.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c !== this.el && !c.inert)
    this.covered.forEach((c) => (c.inert = true))
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    this.t0 = performance.now()
    this.tick()
    window.clearInterval(this.timer)
    this.timer = window.setInterval(() => this.tick(), 250)
  }

  /** What a run is doing now ("2/5"), next to its name. */
  detail(task: string, text?: string) {
    const li = this.tasks.querySelector<HTMLElement>(`[data-task="${task}"]:not(.done)`)
    if (li && text) li.querySelector('span')!.textContent = `troço ${text}`
  }

  /** A run is in. */
  mark(task: string) {
    const li = this.tasks.querySelector<HTMLElement>(`[data-task="${task}"]`)
    if (!li) return
    li.classList.add('done')
    li.querySelector('span')!.textContent = '✓'
  }

  /** The runs failed: the message stays until OK, and nothing has changed behind it. */
  fail(message: string) {
    window.clearInterval(this.timer)
    this.failed = true
    this.el.classList.add('failed')
    this.title.textContent = 'A simulação falhou'
    this.error.textContent = message
    this.error.hidden = this.ok.hidden = false
    this.ok.focus()
  }

  hide() {
    window.clearInterval(this.timer)
    this.active = false
    this.failed = false
    this.el.hidden = true
    this.covered.forEach((c) => (c.inert = false))
    this.covered = []
  }

  private tick() {
    this.elapsed.textContent = `${Math.floor((performance.now() - this.t0) / 1000)} s`
  }
}
