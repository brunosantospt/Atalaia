// Hover picking renders an extra Cesium pass. Keep it off the camera-control path and
// coalesce fast pointer events; clicks still use the editor's immediate Cesium handler.
import { Cartesian2, type Camera } from 'cesium'

export function mapHover(
  canvas: HTMLCanvasElement,
  camera: Pick<Camera, 'moveStart' | 'moveEnd'>,
  hover: (position: Cartesian2) => void,
  leave: () => void,
  enabled: () => boolean = () => true,
): () => void {
  const position = new Cartesian2()
  let clientX = 0
  let clientY = 0
  let inside = false
  let pressed = false
  let moving = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
    leave()
  }
  const schedule = () => {
    if (!inside || pressed || moving || !enabled() || timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      if (inside && !pressed && !moving && enabled()) {
        const rect = canvas.getBoundingClientRect()
        position.x = clientX - rect.left
        position.y = clientY - rect.top
        hover(position)
      }
    }, 80)
  }
  const pointer = (event: PointerEvent) => {
    pressed = event.buttons !== 0
    inside = true
    clientX = event.clientX
    clientY = event.clientY
    if (pressed || moving || !enabled()) return cancel()
    schedule()
  }
  const exit = () => {
    inside = false
    cancel()
  }
  const start = camera.moveStart.addEventListener(() => {
    moving = true
    cancel()
  })
  const end = camera.moveEnd.addEventListener(() => {
    moving = false
    schedule()
  })
  canvas.addEventListener('pointermove', pointer, { passive: true })
  canvas.addEventListener('pointerdown', pointer, { passive: true })
  canvas.addEventListener('pointerup', pointer, { passive: true })
  canvas.addEventListener('pointerleave', exit)
  canvas.addEventListener('pointercancel', exit)
  canvas.addEventListener('wheel', cancel, { passive: true })
  return () => {
    exit()
    start()
    end()
    canvas.removeEventListener('pointermove', pointer)
    canvas.removeEventListener('pointerdown', pointer)
    canvas.removeEventListener('pointerup', pointer)
    canvas.removeEventListener('pointerleave', exit)
    canvas.removeEventListener('pointercancel', exit)
    canvas.removeEventListener('wheel', cancel)
  }
}
