// A card that floats over the globe and the commander can move. Its grip drags the block it belongs to (the
// cards that touch it, a gap apart, and the ones touching those); the rest of the card drags it alone, out
// of its block. Near another card it snaps, a magnet: a gap beside it, or edge to edge with it. Arrow keys on
// the grip nudge the card (Shift for bigger steps), Home or a double click on the grip puts it back. A click
// on the rest of it, or Enter on the grip, opens its detail. Its place is kept as fractions of the room it
// has, so it stays put when the window changes size; a new page starts every card at home. A card that was never moved stands at
// its home, which may be under another card: it follows that one when it moves. Moving a card never touches
// the globe.

import './floating.css'

const MOVED = 'floating-moved'

export interface FloatingOptions {
  home(): { x: number; y: number } // where it stands until it is moved, px from the parent's top left
  moved?(): void // after each move that is kept
  open?(): void // a click that did not move it
  watch?: Element // what the home is measured from: when it changes size, the card goes to its new home
}

const SLOP = 4 // px a press may wander and still be a click
const GAP = 10 // px between the cards of a block, as their homes stack them
const SNAP = 10 // px from a magnet's place where a dragged card jumps to it
const TOUCH = 3 // px of slack for two cards a gap apart to count as one block

interface Box { l: number; t: number; r: number; b: number }
const boxOf = (el: HTMLElement): Box => ({ l: el.offsetLeft, t: el.offsetTop, r: el.offsetLeft + el.offsetWidth, b: el.offsetTop + el.offsetHeight })
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0)
/** Side by side or one over the other, a gap apart. */
const touching = (a: Box, b: Box) =>
  (overlap(a.t, a.b, b.t, b.b) > 0 && (Math.abs(a.r + GAP - b.l) <= TOUCH || Math.abs(b.r + GAP - a.l) <= TOUCH)) ||
  (overlap(a.l, a.r, b.l, b.r) > 0 && (Math.abs(a.b + GAP - b.t) <= TOUCH || Math.abs(b.b + GAP - a.t) <= TOUCH))

/** The smallest shift (≤ SNAP) that puts the moving edges [lo, hi] on a magnet: a gap past an edge of the
 *  others, or on it. Only the others alongside on the other axis pull. */
function snap(lo: number, hi: number, others: { lo: number; hi: number; near: boolean }[]) {
  let best = SNAP + 1, shift = 0
  for (const o of others) {
    if (!o.near) continue
    for (const d of [o.hi + GAP - lo, o.lo - GAP - hi, o.lo - lo, o.hi - hi]) if (Math.abs(d) < Math.abs(best)) { best = d; shift = d }
  }
  return Math.abs(best) <= SNAP ? shift : 0
}

const cardsOf = new WeakMap<HTMLElement, Set<Floating>>() // by parent: the cards that can make a block, as made

/** Every card of the parent back at home, in the order they were made: after some were hidden or shown, the
 *  rest stack again with no holes. A hidden card (`hidden` on it) takes no room and is in no block. */
export function restack(parent: HTMLElement) {
  for (const card of cardsOf.get(parent) ?? []) card.reset()
}

export class Floating {
  private position?: { x: number; y: number }
  private drag?: { pointer: number; x: number; y: number; moved: boolean; grip: boolean; block: { card: Floating; left: number; top: number }[]; others: Box[] }
  private readonly resize: ResizeObserver
  private readonly follow = () => { if (!this.position) this.place() }

  constructor(readonly el: HTMLElement, handle: HTMLButtonElement, private readonly parent: HTMLElement, private readonly options: FloatingOptions) {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.drag || (e.target as Element).closest('label, input')) return
      e.preventDefault(); e.stopPropagation()
      handle.focus({preventScroll:true})
      this.drag = { pointer:e.pointerId, x:e.clientX, y:e.clientY, moved:false, grip:!!(e.target as Element).closest('.float-drag'), block:[], others:[] }
      handle.setPointerCapture(e.pointerId)
    })
    handle.addEventListener('pointermove', e => {
      if (this.drag?.pointer !== e.pointerId) return
      e.preventDefault(); e.stopPropagation()
      if (!this.drag.moved && Math.hypot(e.clientX-this.drag.x, e.clientY-this.drag.y) < SLOP) return
      if (!this.drag.moved) this.startMove(this.drag)
      this.moveBlock(this.drag, e.clientX-this.drag.x, e.clientY-this.drag.y)
    })
    const endDrag = (e: PointerEvent) => {
      if (this.drag?.pointer !== e.pointerId) return
      const { moved, grip } = this.drag
      this.drag = undefined
      for (const c of this.cards()) c.el.classList.remove('dragging', 'magnet')
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
      if (moved) this.cards().forEach((c) => c.save())
      else if (e.type === 'pointerup' && !grip) options.open?.()
    }
    handle.addEventListener('pointerup', endDrag)
    handle.addEventListener('pointercancel', endDrag)
    handle.addEventListener('lostpointercapture', endDrag)
    handle.addEventListener('dblclick', () => this.reset())
    handle.addEventListener('keydown', e => {
      const directions: Record<string, [number,number]> = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] }
      if ((e.key === 'Enter' || e.key === ' ') && options.open) { e.preventDefault(); e.stopPropagation(); options.open(); return }
      if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); this.reset(); return }
      const direction = directions[e.key]
      if (!direction) return
      e.preventDefault(); e.stopPropagation()
      const step=e.shiftKey ? 30 : 10
      this.move(el.offsetLeft+direction[0]*step,el.offsetTop+direction[1]*step)
      this.save()
    })
    // A card that changes size moves the cards stacked under it too.
    this.resize = new ResizeObserver(() => { this.place(); parent.dispatchEvent(new Event(MOVED)) })
    this.resize.observe(parent)
    this.resize.observe(el)
    if (options.watch) this.resize.observe(options.watch)
    parent.addEventListener(MOVED, this.follow)
    if (!cardsOf.has(parent)) cardsOf.set(parent, new Set())
    cardsOf.get(parent)!.add(this)
    this.place()
  }

  private cards() { return [...(cardsOf.get(this.parent) ?? [])].filter((c) => !c.el.hidden) }

  /** The first step of a drag: every card keeps the place it has now (none follows a home any more), and the
   *  block that moves is this card's (by the grip) or this card alone (by the body). */
  private startMove(drag: NonNullable<Floating['drag']>) {
    drag.moved = true
    const cards = this.cards()
    for (const c of cards) if (!c.position) c.move(c.el.offsetLeft, c.el.offsetTop)
    const block = new Set<Floating>([this])
    if (drag.grip) {
      for (let grew = true; grew;) {
        grew = false
        for (const c of cards) if (!block.has(c) && [...block].some((b) => touching(boxOf(b.el), boxOf(c.el)))) { block.add(c); grew = true }
      }
    }
    drag.block = [...block].map((card) => ({ card, left: card.el.offsetLeft, top: card.el.offsetTop }))
    drag.others = cards.filter((c) => !block.has(c)).map((c) => boxOf(c.el))
    for (const { card } of drag.block) card.el.classList.add('dragging')
  }

  /** The block by the pointer's shift, kept on the screen whole, snapped to the magnets of the other cards. */
  private moveBlock(drag: NonNullable<Floating['drag']>, dx: number, dy: number) {
    const at = drag.block.map((m) => ({ l: m.left, t: m.top, r: m.left + m.card.el.offsetWidth, b: m.top + m.card.el.offsetHeight }))
    const box = { l: Math.min(...at.map((a) => a.l)), t: Math.min(...at.map((a) => a.t)), r: Math.max(...at.map((a) => a.r)), b: Math.max(...at.map((a) => a.b)) }
    const w = this.parent.clientWidth, h = this.parent.clientHeight
    dx = Math.max(12 - box.l, Math.min(w - 12 - box.r, dx))
    dy = Math.max(12 - box.t, Math.min(h - 12 - box.b, dy))
    const moved = { l: box.l + dx, t: box.t + dy, r: box.r + dx, b: box.b + dy }
    const pull = (o: Box) => overlap(moved.t, moved.b, o.t, o.b) > -GAP - SNAP && overlap(moved.l, moved.r, o.l, o.r) > -GAP - SNAP
    const sx = snap(moved.l, moved.r, drag.others.map((o) => ({ lo: o.l, hi: o.r, near: pull(o) })))
    const sy = snap(moved.t, moved.b, drag.others.map((o) => ({ lo: o.t, hi: o.b, near: pull(o) })))
    dx += sx; dy += sy
    for (const m of drag.block) m.card.move(m.left + dx, m.top + dy)
    // The cards it holds on to now, lit while it is held there.
    const held = drag.block.map((m) => boxOf(m.card.el))
    const others = this.cards().filter((c) => !drag.block.some((m) => m.card === c))
    for (const c of others) c.el.classList.toggle('magnet', held.some((b) => touching(b, boxOf(c.el))))
  }

  /** Back at home, where it stood before it was moved. */
  reset() { this.position=undefined; this.place(); this.save() }
  private bounds() {
    return { x: Math.max(0,this.parent.clientWidth-this.el.offsetWidth-12), y:Math.max(0,this.parent.clientHeight-this.el.offsetHeight-12) }
  }
  /** Puts the card at its kept place, or at home; again after the parent or the card changes size. */
  place() {
    const bounds=this.bounds()
    const home=this.position ? undefined : this.options.home()
    const x=home ? home.x : 12+this.position!.x*Math.max(0,bounds.x-12)
    const y=home ? home.y : 12+this.position!.y*Math.max(0,bounds.y-12)
    this.move(x,y,!!home)
  }
  private move(x: number,y: number,home=false) {
    const bounds=this.bounds(), left=Math.max(Math.min(12,bounds.x),Math.min(bounds.x,x)), top=Math.max(Math.min(12,bounds.y),Math.min(bounds.y,y))
    const was=`${this.el.style.left},${this.el.style.top}`
    this.el.style.left=`${Math.round(left)}px`;this.el.style.top=`${Math.round(top)}px`
    // At home it stays unplaced, so it goes home again when the window changes.
    if (!home) this.position={x:bounds.x>12 ? (left-12)/(bounds.x-12) : 0,y:bounds.y>12 ? (top-12)/(bounds.y-12) : 0}
    if (`${this.el.style.left},${this.el.style.top}` !== was) this.parent.dispatchEvent(new Event(MOVED)) // the cards at home under it follow
  }
  private save() { this.options.moved?.() }
  destroy() { this.resize.disconnect(); this.parent.removeEventListener(MOVED, this.follow); cardsOf.get(this.parent)?.delete(this) }
}
