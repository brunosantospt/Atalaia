// Plays the shots: move to a shot, hold on it, go to the next. The fire clock, the burned area
// and the fire on the ground follow the camera. While paused (and between moves) the mouse
// has the camera; resuming after the mouse moved it flies back into the shot first. It starts
// paused on the first shot, with the camera still outside it: play flies there.

import type { Scene } from 'cesium'
import { along, applyPose, ease, readPose, type Pose } from './camera'
import type { FireState } from './fireLayer'
import type { Shot } from './shots'

export type Phase = 'move' | 'hold' | 'done'

export interface Frame {
  progress: number // progress within the current hold, for the rapid final overlay
  index: number
  shot: Shot
  phase: Phase
  playing: boolean
  driving: boolean // the player set the camera this frame
  pose: Pose // last pose the player set
  hours: number
  areaHa: number
  fire: FireState
  spot: number // spotlight radius for `pose`
  revealed: Set<string>
}

const REVEAL_AT = 0.6 // markers of a shot appear this far into the move
const EASE_S = 1.5 // a shot built again under the moving camera is eased into over this long

export class Player {
  index = 0
  phase: Phase = 'hold'
  playing = false
  /** Set by the page when the mouse moves the camera while the player is not driving it. */
  userMoved = true

  private t = 0 // seconds into the phase
  private from: Pose
  private pose: Pose
  private fromHours = 0
  private fromArea = 0
  private fromStep = -1
  private fromSpot: number
  private hours = 0
  private areaHa = 0
  private step = -1
  private spot: number
  private seeked: [hours: number, k: number] | undefined // the clock the hour slider set, and how far into the hold
  private easeFrom: Pose | undefined // where the camera was when its shot was built again
  private easeT = 0

  constructor(
    private readonly scene: Scene,
    public shots: Shot[], // the whole story, or the director's cut (main swaps it)
    start: Pose,
  ) {
    this.from = this.pose = start
    this.fromSpot = this.spot = shots[0].spot * 3
  }

  get driving() {
    return this.playing || this.phase === 'move'
  }

  /** Stop camera travel as well as the clock when the working editor takes over. */
  pause() {
    this.playing = false
    this.phase = 'hold'
    this.t = 0
    this.easeFrom = undefined
    this.userMoved = true
    this.seek(this.hours)
  }

  /** Fly to shot `i` from wherever the camera is now. */
  goTo(i: number) {
    this.index = Math.min(Math.max(i, 0), this.shots.length - 1)
    this.phase = 'move'
    this.t = 0
    this.from = (!this.driving || this.userMoved ? readPose(this.scene) : undefined) ?? this.pose
    this.fromHours = this.hours
    this.fromArea = this.areaHa
    this.fromStep = this.step
    this.fromSpot = this.spot
    this.userMoved = false
    this.seeked = this.easeFrom = undefined
  }

  next() {
    if (this.index < this.shots.length - 1) this.goTo(this.index + 1)
  }
  prev() {
    this.goTo(this.index - 1)
  }
  restart() {
    this.playing = true
    this.goTo(0)
  }
  toggle() {
    if (this.phase === 'done') return this.restart()
    if (this.playing) return this.pause()
    this.playing = true
    // Back into the shot if the mouse took the camera somewhere else meanwhile.
    if (this.playing && this.userMoved) {
      const hours = this.hours
      this.goTo(this.index)
      this.seek(hours) // returning the camera must not rewind the incident
    }
  }

  /** The editor's hour slider sets the fire clock. It stays there until the next shot, or runs on from
   *  there in the matching incident interval; camera motion is kept only during an explicit flight. */
  seek(hours: number) {
    // A paused slider must select the matching interval, otherwise the next frame runs
    // backwards from the new hour towards the old scene's endpoint.
    if (!this.driving) {
      this.index = this.shots.reduce((found, shot, i) => shot.hours <= hours + 1e-8 ? i : found, 0)
      this.phase = 'hold'
      this.t = 0
    }
    this.hours = hours
    this.seeked = [hours, this.phase === 'hold' ? Math.min(this.t / this.shots[this.index].holdS, 1) : 0]
  }

  /** New shots in which `index` is the shot on screen, or the one built again in its place (the
   *  director's are new after every run). The camera stays: a driving player eases into the new
   *  framing, a paused one flies there when played. */
  keep(shots: Shot[], index: number) {
    const rebuilt = shots[index] !== this.shots[this.index]
    this.shots = shots
    this.index = index
    if (!rebuilt) return
    if (this.phase !== 'move') {
      this.t = 0
      this.seeked = [this.hours, 0]
    }
    if (this.driving) [this.easeFrom, this.easeT] = [this.pose, 0]
    else this.userMoved = true
  }

  update(dt: number, spreadRate = 1): Frame {
    const shot = this.shots[this.index]
    let revealCurrent = this.phase !== 'move'
    let driving = false

    if (this.phase === 'move') {
      this.t += dt
      const k = Math.min(this.t / shot.moveS, 1)
      const e = ease(k)
      this.pose = this.place(along([this.from, shot.path[0]], e), dt)
      driving = true
      if (!this.seeked) this.hours = lerp(this.fromHours, shot.hours, e)
      this.areaHa = lerp(this.fromArea, shot.areaHa, e)
      this.spot = Math.exp(lerp(Math.log(this.fromSpot), Math.log(shot.spot), e))
      this.step = shot.step
      revealCurrent = k >= REVEAL_AT
      if (k >= 1) [this.phase, this.t] = ['hold', 0]
      return this.frame(shot, driving, revealCurrent, shot.step > this.fromStep ? e : 1, shot.untimed && e > 0.5)
    }

    if (this.phase === 'hold' && this.playing) {
      // Accelerate growth playback only; camera moves, pause gates and final comparisons keep their timing.
      const growing = !shot.gate && shot.kind !== 'outcome' && (shot.hoursTo ?? shot.hours) > shot.hours
      this.t += dt * (growing ? Math.max(1, spreadRate) : 1)
      const k = Math.min(this.t / shot.holdS, 1)
      this.pose = this.place(holdPose(shot, k), dt)
      driving = true
      if (shot.hoursTo !== undefined) {
        const [from, k0] = this.seeked ?? [shot.hours, 0]
        this.hours = lerp(from, shot.hoursTo, k0 < 1 ? (ease(k) - ease(k0)) / (1 - ease(k0)) : 1)
      }
      if (k >= 1) {
        if (this.index < this.shots.length - 1) this.goTo(this.index + 1)
        else [this.phase, this.playing] = ['done', false]
      }
    }
    return this.frame(shot, driving, revealCurrent, 1, shot.untimed)
  }

  /** Puts the camera at `pose`, eased from where it was when its shot was built again. */
  private place(pose: Pose, dt: number): Pose {
    if (this.easeFrom) {
      this.easeT += dt
      const k = Math.min(this.easeT / EASE_S, 1)
      pose = along([this.easeFrom, pose], ease(k))
      if (k >= 1) this.easeFrom = undefined
    }
    return applyPose(this.scene, pose)
  }

  private frame(shot: Shot, driving: boolean, revealCurrent: boolean, fade: number, untimed: boolean): Frame {
    const revealed = new Set(this.shots.slice(0, this.index).flatMap((s) => s.reveal))
    if (revealCurrent) shot.reveal.forEach((id) => revealed.add(id))
    for (const s of this.shots.slice(0, this.index + 1)) s.conceal.forEach((id) => revealed.delete(id))
    return {
      progress: this.phase === 'hold' || this.phase === 'done' ? Math.min(this.t / shot.holdS, 1) : 0,
      index: this.index,
      shot,
      phase: this.phase,
      playing: this.playing,
      driving,
      pose: this.pose,
      hours: this.hours,
      areaHa: this.areaHa,
      fire: { step: this.step, fade, untimed },
      spot: this.spot,
      revealed,
    }
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** While holding: travel the shot's path, or orbit slowly around its single pose. */
function holdPose(shot: Shot, k: number): Pose {
  if (shot.path.length > 1) return along(shot.path, ease(k))
  const p = shot.path[0]
  return { ...p, heading: p.heading + shot.driftDeg * k }
}
