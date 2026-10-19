// Plays the shots: move to a shot, hold on it, go to the next. The fire clock, the burned area
// and the fire on the ground follow the camera. While paused (and between moves) the mouse
// has the camera; resuming after the mouse moved it flies back into the shot first.

import type { Scene } from 'cesium'
import { along, applyPose, ease, readPose, type Pose } from './camera'
import type { FireState } from './fireLayer'
import type { Shot } from './shots'

export type Phase = 'move' | 'hold' | 'done'

export interface Frame {
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

export class Player {
  index = 0
  phase: Phase = 'move'
  playing = true
  /** Set by the page when the mouse moves the camera while the player is not driving it. */
  userMoved = false

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

  constructor(
    private readonly scene: Scene,
    readonly shots: Shot[],
    start: Pose,
  ) {
    this.from = this.pose = start
    this.fromSpot = this.spot = shots[0].spot * 3
  }

  get driving() {
    return this.playing || this.phase === 'move'
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
    this.playing = !this.playing
    // Back into the shot if the mouse took the camera somewhere else meanwhile.
    if (this.playing && this.userMoved) this.goTo(this.index)
  }

  update(dt: number): Frame {
    const shot = this.shots[this.index]
    let revealCurrent = this.phase !== 'move'
    let driving = false

    if (this.phase === 'move') {
      this.t += dt
      const k = Math.min(this.t / shot.moveS, 1)
      const e = ease(k)
      this.pose = applyPose(this.scene, along([this.from, shot.path[0]], e))
      driving = true
      this.hours = lerp(this.fromHours, shot.hours, e)
      this.areaHa = lerp(this.fromArea, shot.areaHa, e)
      this.spot = Math.exp(lerp(Math.log(this.fromSpot), Math.log(shot.spot), e))
      this.step = shot.step
      revealCurrent = k >= REVEAL_AT
      if (k >= 1) [this.phase, this.t] = ['hold', 0]
      return this.frame(shot, driving, revealCurrent, shot.step > this.fromStep ? e : 1, shot.untimed && e > 0.5)
    }

    if (this.phase === 'hold' && this.playing) {
      this.t += dt
      const k = Math.min(this.t / shot.holdS, 1)
      this.pose = applyPose(this.scene, holdPose(shot, k))
      driving = true
      if (k >= 1) {
        if (this.index < this.shots.length - 1) this.goTo(this.index + 1)
        else [this.phase, this.playing] = ['done', false]
      }
    }
    return this.frame(shot, driving, revealCurrent, 1, shot.untimed)
  }

  private frame(shot: Shot, driving: boolean, revealCurrent: boolean, fade: number, untimed: boolean): Frame {
    const revealed = new Set(this.shots.slice(0, this.index).flatMap((s) => s.reveal))
    if (revealCurrent) shot.reveal.forEach((id) => revealed.add(id))
    return {
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
