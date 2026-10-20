import 'cesium/Build/Cesium/Widgets/widgets.css'
import './style.css'
import { Credit, type PerspectiveFrustum } from 'cesium'
import { applyPose, readPose, type Pose } from './camera'
import {
  loadFire,
  loadFireIndex,
  loadProgression,
  loadStations,
  loadWeather,
  nearestStations,
  type Fire,
  type NearStation,
} from './data'
import { demoDecisions } from './decisions'
import { loadDetection } from './detection'
import { Editor, type Reports, type Runs } from './editor'
import { burnedHa, params, simulate, type Scenario } from './fastModel'
import { FireLayer } from './fireLayer'
import { loadGrid } from './grid'
import { Hud, type CameraReadout } from './hud'
import { loadInventory } from './inventory'
import { MarkerLayer } from './markers'
import { buildContext, loadOsm, type Context } from './osm'
import { Player } from './player'
import { computeReach, freeAreaHa } from './reach'
import { ReachLayer } from './reachLayer'
import { makeReport, recommend } from './report'
import { createViewer } from './scene'
import { addHeights, buildStory } from './shots'
import { SplitLayer } from './splitLayer'
import { Spotlight } from './spotlight'
import { containmentProbability, loadSuppression, type Decision } from './suppression'

// Monte da Penha, Guimarães (617 m): the reference point for the whole twin.
const PENHA = { lon: -8.2683, lat: 41.4256 }
// Where the replay starts: high over Penha, looking north-east towards the Minho fires.
const START: Pose = { ...PENHA, h: 600, heading: 30, pitch: -50, range: 60_000 }
const PICK_EVERY = 4 // frames between screen-centre picks while the mouse has the camera
const DECISION_MIN = 360 // how far the free run and the decisions A and B are simulated: the 6 h of the report

interface Replay {
  id: string
  data: Fire
  stations: NearStation[]
  credits: Credit[]
  fire: FireLayer // the observed fire
  markers: MarkerLayer
  player: Player
  scenario: Scenario // the fast model's inputs for this fire
  free: SplitLayer // the free run, shown during the simulated shots
  reach: ReachLayer // outlines at the ETAs and at T_sat, scale rings
  context: Context | undefined // roads, homes and places from OSM, when the fire has them
  split?: SplitLayer // the decisions A and B side by side, while they are shown
}

async function main() {
  const [index, stations, suppression, detection, inventory] = await Promise.all([
    loadFireIndex(),
    loadStations(),
    loadSuppression(),
    loadDetection(),
    loadInventory(),
  ])
  const viewer = await createViewer('globe', PENHA)
  const { scene } = viewer
  applyPose(scene, START)
  // The caption card sits just above the credit line, whose height depends on what it shows.
  const credits = viewer.bottomContainer as HTMLElement
  new ResizeObserver(() =>
    document.documentElement.style.setProperty('--credits-h', `${credits.offsetHeight}px`),
  ).observe(credits)

  const spotlight = new Spotlight(scene)
  let replay: Replay | undefined
  // Console handle for tuning in dev (atalaia.spotlight.strength = 0, …); absent from the build.
  if (import.meta.env.DEV)
    Object.assign(window, {
      atalaia: {
        viewer,
        spotlight,
        params, // of the fast model; rerun() simulates again with them
        runs: {},
        get replay() {
          return replay
        },
        rerun: () => rerun(),
      },
    })
  let loading: string | undefined

  const hud = new Hud(document.getElementById('hud')!, index, {
    toggle: () => replay?.player.toggle(),
    prev: () => replay?.player.prev(),
    next: () => replay?.player.next(),
    goTo: (i) => replay?.player.goTo(i),
    pickFire: (id) => (location.hash = id),
  })
  // The decision editor: what it draws is simulated again at once and shown split.
  const editor = new Editor(viewer, hud.root, suppression, inventory, {
    changed: () => rerun(),
    editing: (open) => {
      hud.setEditing(open)
      if (!replay) return
      if (open) {
        replay.player.playing = false // the mouse has the camera and the map takes the clicks
        // The drawer's hour starts where the replay stands; before the replay starts, at the end of the run.
        const hours = replay.player.update(0).hours
        editor.setHours(hours > 0 ? hours : DECISION_MIN / 60)
        if (!replay.split) rerun()
      }
    },
  })

  async function open(id: string) {
    if (replay?.id === id || loading === id) return
    loading = id
    const [fire, progression, grid, weather, osm] = await Promise.all([
      loadFire(id),
      loadProgression(id),
      loadGrid(id),
      loadWeather(id),
      loadOsm(id),
    ])
    const fovy = (scene.camera.frustum as PerspectiveFrustum).fovy!
    const near = nearestStations(stations, fire.ignition)
    // The free run: the fire as the fast model lets it go with nobody on it, from the ignition.
    const startIndex = Math.max(0, weather.time.indexOf(fire.start.slice(0, 16)))
    const scenario: Scenario = { grid, weather, startIndex, ignition: fire.ignition, stations: near, suppression, durationMin: DECISION_MIN }
    const free = simulate(scenario, null)
    const reach = computeReach(grid, free, fire, near, suppression, detection)
    console.info(
      `free run: ${free.runtimeMs.toFixed(0)} ms · ` +
        reach.etas.map((e) => `${e.unit} ${e.from} T+${e.minutes} min ${e.areaHa.toFixed(1)} ha POC ${(e.poc * 100).toFixed(0)} %`).join(' · ') +
        ` · T_sat ${reach.tsat.areaHa.toFixed(0)} ha POC ${(reach.tsat.poc * 100).toFixed(0)} %`,
    )
    const context = osm ? buildContext(grid, osm) : undefined
    if (context) console.info(`osm: ${osm!.roads.length} roads, ${osm!.buildings.length} buildings, ${context.access.length} access points`)
    const story = buildStory(fire, progression, near, fovy, reach)
    await addHeights(story, viewer.terrainProvider)
    if (loading !== id) return // another fire was picked meanwhile
    loading = undefined

    const from = replay ? (readPose(scene) ?? START) : START
    replay?.fire.destroy()
    replay?.markers.destroy()
    replay?.free.destroy()
    replay?.reach.destroy()
    replay?.split?.destroy()
    replay?.credits.forEach((c) => viewer.creditDisplay.removeStaticCredit(c))
    const overlay = document.getElementById('overlay')!
    replay = {
      id,
      data: fire,
      stations: near,
      credits: sourceCredits(fire),
      fire: new FireLayer(scene, progression),
      markers: new MarkerLayer(viewer, overlay, story.markers, () => hud.safeArea()),
      player: new Player(scene, story.shots, from),
      scenario,
      free: new SplitLayer(viewer, overlay, grid, [{ name: 'livre', arrival: free.arrival }], DECISION_MIN),
      reach: new ReachLayer(viewer, fire.ignition, reach),
      context,
    }
    editor.setFire(id, fire, near, context, scenario, demoDecisions(fire, near))
    editor.setRuns(undefined, undefined)
    replay.free.show(false)
    replay.credits.forEach((c) => viewer.creditDisplay.addStaticCredit(c))
    hud.setFire(fire, story.shots, {
      known: { fire, weather, startIndex, stations: near, inventory, detection, satHa: reach.tsat.areaHa },
      areaHa: (hours) => freeAreaHa(reach, hours),
      poc: (areaHa) => containmentProbability(suppression, areaHa, reach.intensityKWPerM),
      intensityKWPerM: reach.intensityKWPerM,
    })
    document.title = `${fire.name} · Atalaia`
  }

  /** Simulate Livre, A and B as the editor holds them, show A and B split, and report them at 6 h. */
  function rerun() {
    if (!replay) return
    const { scenario, context } = replay
    const { grid } = scenario
    const [a, b]: [Decision, Decision] = editor.decisions
    const runs: Runs = { free: simulate(scenario, null), A: simulate(scenario, a), B: simulate(scenario, b) }
    for (const [name, run] of Object.entries(runs))
      console.info(
        `${name}: ${run.runtimeMs.toFixed(0)} ms · ` +
          [60, 120, 300, 360].map((t) => `${t} min ${burnedHa(grid, run, t).toFixed(0)} ha`).join(' · '),
      )
    if (import.meta.env.DEV) Object.assign((window as unknown as { atalaia: { runs: unknown } }).atalaia, { runs })
    const reports: Reports | undefined = context && {
      free: makeReport(grid, context, runs.free),
      A: makeReport(grid, context, runs.A),
      B: makeReport(grid, context, runs.B),
    }
    // The recommended decision (fewer places reached, then less burned) is named as such on its side of the split.
    const pick = reports && recommend(reports.A, reports.B).pick
    const label = (d: Decision) => (d.id === pick ? `${d.name} · recomendada` : d.name)
    const position = replay.split?.position
    replay.split?.destroy()
    replay.split = new SplitLayer(
      viewer,
      document.getElementById('overlay')!,
      grid,
      [{ name: label(a), arrival: runs.A.arrival }, { name: label(b), arrival: runs.B.arrival }],
      DECISION_MIN,
    )
    if (position !== undefined) replay.split.setPosition(position)
    replay.split.set(replay.player.update(0).hours)
    editor.setRuns(runs, reports)
  }

  /** The decisions A and B on and off the screen (key A). */
  function toggleDecisions() {
    if (!replay) return
    if (!replay.split) return rerun()
    replay.split.destroy()
    replay.split = undefined
    editor.setRuns(undefined, undefined)
    editor.toggle(false)
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
    const { player, fire, free, split } = replay
    scene.screenSpaceCameraController.enableInputs = !player.driving
    const played = player.update(dt)
    // While the editor is open its hour slider holds the clock of the split, and the HUD reads that hour.
    const frame = editor.open && split ? { ...played, hours: editor.hours } : played
    // The observed fire gives way to the simulated one: the free run in its shots, A and B when split.
    const simulated = frame.shot.simulated || !!split
    fire.set(simulated ? { step: -1, fade: 1, untimed: false } : frame.fire)
    free.show(frame.shot.simulated && !split)
    free.set(frame.hours)
    split?.set(frame.hours)
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
  scene.postRender.addEventListener(() => {
    replay?.markers.update(revealed)
    replay?.reach.update(revealed)
  })

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Escape' && hud.settings.open) return hud.settings.toggle(false)
    if (editor.handleKey(e)) return e.preventDefault()
    // Arrows and space belong to a focused radio in the settings, letters to the editor's fields.
    if (!replay || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
    const { player } = replay
    const actions: Record<string, () => void> = {
      ' ': () => player.toggle(),
      ArrowLeft: () => player.prev(),
      ArrowRight: () => player.next(),
      r: () => player.restart(),
      s: () => hud.settings.toggle(),
      h: () => hud.toggleHidden(),
      a: () => toggleDecisions(),
      e: () => editor.toggle(),
    }
    const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key]
    if (!action) return
    e.preventDefault()
    action()
  })

  window.addEventListener('hashchange', () => open(fireFromHash(index.map((f) => f.id))))
  await open(fireFromHash(index.map((f) => f.id)))
}

/** The fire's data and station sources, listed in Cesium's credits panel beside the imagery's. */
function sourceCredits(fire: Fire): Credit[] {
  const { data, cite } = fire.source
  return [data, cite, 'Quartéis, estradas, casas e lugares © contribuidores do OpenStreetMap (ODbL)'].map(
    (text) => new Credit(text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')),
  )
}

function fireFromHash(ids: string[]): string {
  const id = decodeURIComponent(location.hash.slice(1))
  return ids.includes(id) ? id : ids[0]
}

main().catch((error) => {
  console.error(error)
  document.body.dataset.error = String(error)
})
