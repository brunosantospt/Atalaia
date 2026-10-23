// Drone footage beside the director's cut: one inset at the key moments, and the two endings side by side at the outcome.
import './droneClips.css'

export type Clip = 'closeup1' | 'closeup' | 'first_look' | 'finale' | undefined

const url = (name: string) => `${import.meta.env.BASE_URL}drone/${name}.mp4`

function video(className: string, label?: string) {
  const box = document.createElement('div')
  box.className = `drone-clip ${className}`
  box.hidden = true
  box.innerHTML = `<video muted loop playsinline></video><span class="drone-clip-rec"><i></i>DRONE</span>${label ? `<b>${label}</b>` : ''}`
  document.body.append(box)
  return { box, el: box.querySelector('video')! }
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
