// The camera always orbits a target on the ground. A pose is that target plus where the camera
// looks from; moving between poses follows a Catmull-Rom curve, with the range in log scale so
// a 40 km → 3 km zoom feels even all the way down.

import { Cartesian2, Cartesian3, Cartographic, HeadingPitchRange, Matrix4, type Scene } from 'cesium'
import type { LonLat } from './geo'

export interface Pose extends LonLat {
  h: number // terrain height at the target, m
  heading: number // where the camera faces, degrees clockwise from north
  pitch: number // degrees, negative looks down
  range: number // camera to target, m
}

const CLEARANCE_M = 150 // keep the camera at least this far above the ground under it
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

export function applyPose(scene: Scene, pose: Pose): Pose {
  const { camera, globe } = scene
  const target = Cartesian3.fromDegrees(pose.lon, pose.lat, pose.h)
  let pitch = pose.pitch
  camera.lookAt(target, new HeadingPitchRange(rad(pose.heading), rad(pitch), pose.range))
  // A low pass over the Cabreira or the Barroso can put the camera inside a ridge: look down more steeply.
  const ground = globe.getHeight(camera.positionCartographic)
  if (ground !== undefined && camera.positionCartographic.height < ground + CLEARANCE_M) {
    const need = (ground + CLEARANCE_M - pose.h) / pose.range
    pitch = -deg(Math.asin(Math.min(0.99, Math.max(Math.sin(rad(-pitch)), need))))
    camera.lookAt(target, new HeadingPitchRange(rad(pose.heading), rad(pitch), pose.range))
  }
  camera.lookAtTransform(Matrix4.IDENTITY) // hand the camera back to the mouse controls
  return pitch === pose.pitch ? pose : { ...pose, pitch }
}

const centre = new Cartesian2()

/** The pose the camera has now, around the ground point at the centre of the screen. */
export function readPose(scene: Scene): Pose | undefined {
  const { camera, canvas } = scene
  centre.x = canvas.clientWidth / 2
  centre.y = canvas.clientHeight / 2
  const ray = camera.getPickRay(centre)
  const hit = ray && scene.globe.pick(ray, scene)
  if (!hit) return undefined
  const c = Cartographic.fromCartesian(hit)
  return {
    lon: deg(c.longitude),
    lat: deg(c.latitude),
    h: c.height,
    heading: deg(camera.heading),
    pitch: deg(camera.pitch),
    range: Cartesian3.distance(camera.positionWC, hit),
  }
}

export const ease = (t: number) => t * t * (3 - 2 * t)

type Vec = number[]
const toVec = (p: Pose): Vec => [p.lon, p.lat, p.h, p.heading, p.pitch, Math.log(p.range)]
const toPose = (v: Vec): Pose => ({ lon: v[0], lat: v[1], h: v[2], heading: v[3], pitch: v[4], range: Math.exp(v[5]) })

/** Headings made continuous (350° then 10° becomes 350° then 370°) so turns take the short way. */
function unwrap(poses: Pose[]): Vec[] {
  const out = poses.map(toVec)
  for (let i = 1; i < out.length; i++) {
    const turn = ((((out[i][3] - out[i - 1][3]) % 360) + 540) % 360) - 180
    out[i][3] = out[i - 1][3] + turn
  }
  return out
}

function catmullRom(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const t2 = t * t
  const t3 = t2 * t
  return p1.map(
    (_, i) =>
      0.5 *
      (2 * p1[i] +
        (p2[i] - p0[i]) * t +
        (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
        (3 * p1[i] - p0[i] - 3 * p2[i] + p3[i]) * t3),
  )
}

/** The pose a fraction `t` (0..1) along a list of poses, each segment taking an equal share. */
export function along(poses: Pose[], t: number): Pose {
  if (poses.length === 1) return poses[0]
  const v = unwrap(poses)
  const n = v.length - 1
  const x = Math.min(Math.max(t, 0), 1) * n
  const i = Math.min(Math.floor(x), n - 1)
  return toPose(catmullRom(v[Math.max(i - 1, 0)], v[i], v[i + 1], v[Math.min(i + 2, n)], x - i))
}
