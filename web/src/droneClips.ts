// Drone footage beside the director's cut: one inset at the key moments, and the two endings side by side at the outcome.
import './droneClips.css'

export type Clip = 'closeup1' | 'closeup' | 'first_look' | 'finale' | undefined

const url = (name: string) => `${import.meta.env.BASE_URL}drone/${name}.mp4`

function video(className: string, label?: string) {
  const box = document.createElement('div')
  box.className = `drone-clip ${className}`
  box.hidden = true
  box.innerHTML = `<video muted loop playsinline></video><span class="drone-clip-rec"><i></i>DRONE</span>${label ? `<b>${label}</b>` : ''}
    <button type="button" class="drone-clip-close" title="Fechar">✕</button>`
  document.body.append(box)
  const el = box.querySelector('video')!
  // Closed stays closed until the next clip comes up.
  box.querySelector('button')!.addEventListener('click', () => { box.hidden = true; el.pause() })
  draggable(box)
  return { box, el }
}

/** Dragged anywhere on screen; the place is kept for the following clips. */
function draggable(box: HTMLElement) {
  box.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const r = box.getBoundingClientRect()
    const dx = e.clientX - r.left, dy = e.clientY - r.top
    box.setPointerCapture(e.pointerId)
    box.classList.add('dragging')
    const move = (m: PointerEvent) => {
      const x = Math.min(Math.max(0, m.clientX - dx), innerWidth - r.width)
      const y = Math.min(Math.max(0, m.clientY - dy), innerHeight - r.height)
      Object.assign(box.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' })
    }
    const up = () => {
      box.classList.remove('dragging')
      box.removeEventListener('pointermove', move)
      box.removeEventListener('pointerup', up)
      box.removeEventListener('pointercancel', up)
    }
    box.addEventListener('pointermove', move)
    box.addEventListener('pointerup', up)
    box.addEventListener('pointercancel', up)
  })
}

export class DroneClips {
  private inset = video('drone-inset')
  private left = video('drone-side drone-left', 'Sem meios')
  private right = video('drone-side drone-right', 'Com meios')
  private shown: Clip

  set(clip: Clip) {
    if (clip === this.shown) return
    this.shown = clip
    const play = (v: { box: HTMLDivElement; el: HTMLVideoElement }, name?: string) => {
      v.box.hidden = !name
      if (!name) return v.el.pause()
      if (!v.el.src.endsWith(`/${name}.mp4`)) v.el.src = url(name)
      v.el.currentTime = 0
      void v.el.play().catch(() => {})
    }
    play(this.inset, clip === 'finale' ? undefined : clip)
    play(this.left, clip === 'finale' ? 'no_help' : undefined)
    play(this.right, clip === 'finale' ? 'help' : undefined)
  }
}
