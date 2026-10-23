// The window a floating card opens in the middle of the screen: what the card reads, in full, and where it
// comes from. One window at a time per screen; Esc, the close button or a click outside closes it. The card
// keeps writing its detail while the window is open, so it runs with the clock.

import './widgetDetail.css'

/** A line of the detail: what, its value and, for a state, the status dot (good/warning/serious/critical). */
export type Row = [label: string, value: string, level?: string]
export interface Group { heading?: string; rows: Row[] }

interface Dialog { root: HTMLElement; title: HTMLElement; slot: HTMLElement; close: HTMLButtonElement; owner?: Detail }
const dialogs = new WeakMap<HTMLElement, Dialog>()

function dialogOf(parent: HTMLElement): Dialog {
  let d = dialogs.get(parent)
  if (d) return d
  const root = document.createElement('div')
  root.className = 'detail-backdrop'
  root.hidden = true
  root.innerHTML = `
    <section class="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <header class="detail-head"><h2 id="detail-title"></h2><button type="button" class="detail-close" aria-label="Fechar">×</button></header>
      <div class="detail-slot"></div>
    </section>`
  parent.append(root)
  d = { root, title: root.querySelector('h2')!, slot: root.querySelector('.detail-slot')!, close: root.querySelector('.detail-close')! }
  const dialog = d
  dialog.close.addEventListener('click', () => dialog.owner?.hide())
  root.addEventListener('pointerdown', (e) => { if (e.target === root) dialog.owner?.hide() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dialog.owner) { e.preventDefault(); dialog.owner.hide() } })
  dialogs.set(parent, d)
  return d
}

/** The detail of one card: groups of rows, anything the card adds under them, and a note on the sources. */
export class Detail {
  readonly el = document.createElement('div')
  readonly extra = document.createElement('div') // the card's own controls, under the rows
  private readonly groups = document.createElement('div')
  private readonly note = document.createElement('p')
  private back?: HTMLElement

  constructor(private readonly parent: HTMLElement, private readonly title: string) {
    this.el.className = 'detail-body'
    this.extra.className = 'detail-extra'
    this.note.className = 'detail-note'
    this.el.append(this.groups, this.extra, this.note)
  }

  get isOpen() { return dialogs.get(this.parent)?.owner === this }

  show(back?: HTMLElement) {
    const d = dialogOf(this.parent)
    if (d.owner && d.owner !== this) d.owner.hide(false)
    d.owner = this
    this.back = back
    d.title.textContent = this.title
    d.slot.replaceChildren(this.el)
    d.root.hidden = false
    d.close.focus({ preventScroll: true })
  }

  hide(restore = true) {
    const d = dialogs.get(this.parent)
    if (d?.owner !== this) return
    d.owner = undefined
    d.root.hidden = true
    this.el.remove()
    if (restore) this.back?.focus({ preventScroll: true })
  }

  set(groups: Group[], note = '') {
    this.groups.replaceChildren(...groups.map((g) => {
      const section = document.createElement('section')
      section.className = 'detail-group'
      if (g.heading) section.append(Object.assign(document.createElement('h3'), { textContent: g.heading }))
      const dl = document.createElement('dl')
      for (const [label, value, level] of g.rows) {
        const dd = document.createElement('dd')
        if (level) dd.append(Object.assign(document.createElement('i'), { className: level }))
        dd.append(value)
        dl.append(Object.assign(document.createElement('dt'), { textContent: label }), dd)
      }
      section.append(dl)
      return section
    }))
    this.note.textContent = note
    this.note.hidden = !note
  }

  destroy() { this.hide(false) }
}
