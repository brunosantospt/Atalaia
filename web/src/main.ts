import 'cesium/Build/Cesium/Widgets/widgets.css'
import './style.css'
import { Credit, type PerspectiveFrustum } from 'cesium'
import { applyPose, readPose, type Pose } from './camera'
import { loadFire, loadFireIndex, loadProgression, loadStations, nearestStations, type Fire } from './data'
import { FireLayer } from './fireLayer'
import { Hud, type CameraReadout } from './hud'
import { MarkerLayer } from './markers'
import { Player } from './player'
import { createViewer } from './scene'
import { addHeights, buildStory } from './shots'
import { Spotlight } from './spotlight'

// Monte da Penha, Guimarães (617 m): the reference point for the whole twin.
const PENHA = { lon: -8.2683, lat: 41.4256 }
// Where the replay starts: high over Penha, looking north-east towards the Minho fires.
const START: Pose = { ...PENHA, h: 600, heading: 30, pitch: -50, range: 60_000 }
const PICK_EVERY = 4 // frames between screen-centre picks while the mouse has the camera

interface Replay {
  id: string
  credit: Credit
  fire: FireLayer
  markers: MarkerLayer
  player: Player
}

async function main() {
  const [index, stations] = await Promise.all([loadFireIndex(), loadStations()])
  const viewer = await createViewer('globe', PENHA)
  const { scene } = viewer
  applyPose(scene, START)
  // The caption card sits just above the credit line, whose height depends on what it lists.
  const credits = viewer.bottomContainer as HTMLElement
  new ResizeObserver(() =>
    document.documentElement.style.setProperty('--credits-h', `${credits.offsetHeight}px`),
  ).observe(credits)

  const spotlight = new Spotlight(scene)
  // Console handle for tuning in dev (atalaia.spotlight.strength = 0, …); absent from the build.
  if (import.meta.env.DEV) Object.assign(window, { atalaia: { viewer, spotlight } })
  let replay: Replay | undefined
  let loading: string | undefined

  const hud = new Hud(document.getElementById('hud')!, index, {
    toggle: () => replay?.player.toggle(),
    prev: () => replay?.player.prev(),
    next: () => replay?.player.next(),
    goTo: (i) => replay?.player.goTo(i),
    pickFire: (id) => (location.hash = id),
  })

  async function open(id: string) {
    if (replay?.id === id || loading === id) return
    loading = id
    const [fire, progression] = await Promise.all([loadFire(id), loadProgression(id)])
    const fovy = (scene.camera.frustum as PerspectiveFrustum).fovy!
    const story = buildStory(fire, progression, nearestStations(stations, fire.ignition), fovy)
    await addHeights(story, viewer.terrainProvider)
    if (loading !== id) return // another fire was picked meanwhile
    loading = undefined

    const from = replay ? (readPose(scene) ?? START) : START
    replay?.fire.destroy()
    replay?.markers.destroy()
    if (replay) viewer.creditDisplay.removeStaticCredit(replay.credit)
    replay = {
      id,
      credit: sourceCredit(fire),
      fire: new FireLayer(scene, progression),
      markers: new MarkerLayer(viewer, document.getElementById('overlay')!, story.markers, () => hud.safeArea()),
      player: new Player(scene, story.shots, from),
    }
    viewer.creditDisplay.addStaticCredit(replay.credit)
    hud.setFire(fire, story.shots)
    document.title = `${fire.name} · Atalaia`
  }

  // The mouse takes the camera only while the player is not driving it.
  for (const type of ['pointerdown', 'wheel'])
    scene.canvas.addEventListener(type, () => {
      if (replay && !replay.player.driving) replay.player.userMoved = true
    })

  let last = performance.now()
  let frameNo = 0
  let readout: CameraReadout = { heading: 0, pitch: 0, range: 0, centre: undefined }
  let revealed = new Set<string>()
  scene.preUpdate.addEventListener(() => {
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    if (!replay) return
    const { player, fire } = replay
    scene.screenSpaceCameraController.enableInputs = !player.driving
    const frame = player.update(dt)
    fire.set(frame.fire)
    revealed = frame.revealed

    if (frame.driving) {
      // The camera orbits the pose target, which is therefore the centre of the screen.
      readout = { ...frame.pose, centre: frame.pose }
      spotlight.set(frame.pose, frame.spot)
    } else if (frameNo++ % PICK_EVERY === 0) {
      const pose = readPose(scene)
      readout = pose ? { ...pose, centre: pose } : { ...readout, centre: undefined }
      // Free camera: the light follows the screen centre and widens as the mouse zooms out.
      if (pose) spotlight.set(pose, frame.spot * (pose.range / Math.max(frame.pose.range, 1)))
    }
    hud.update(frame, readout)
  })
  // Tags are placed after the render, when the camera has its final pose for the frame.
  scene.postRender.addEventListener(() => replay?.markers.update(revealed))

  document.addEventListener('keydown', (e) => {
    if (!replay || e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLSelectElement) return
    const { player } = replay
    const actions: Record<string, () => void> = {
      ' ': () => player.toggle(),
      ArrowLeft: () => player.prev(),
      ArrowRight: () => player.next(),
      r: () => player.restart(),
      h: () => hud.toggleHidden(),
    }
    const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key]
    if (!action) return
    e.preventDefault()
    action()
  })

  window.addEventListener('hashchange', () => open(fireFromHash(index.map((f) => f.id))))
  await open(fireFromHash(index.map((f) => f.id)))
}

/** The fire's data and station sources, shown in Cesium's credit line beside the imagery's. */
function sourceCredit(fire: Fire): Credit {
  const { data, cite } = fire.source
  const text = `${data} · ${cite} · Quartéis © contribuidores do OpenStreetMap (ODbL)`
  return new Credit(text.replaceAll('&', '&amp;').replaceAll('<', '&lt;'), true)
}

function fireFromHash(ids: string[]): string {
  const id = decodeURIComponent(location.hash.slice(1))
  return ids.includes(id) ? id : ids[0]
}

main().catch((error) => {
  console.error(error)
  document.body.dataset.error = String(error)
})
