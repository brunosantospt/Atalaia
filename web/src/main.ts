import 'cesium/Build/Cesium/Widgets/widgets.css'
import './style.css'
import {
  BoundingSphere,
  Cartesian3,
  Cartographic,
  Credit,
  HeadingPitchRange,
  Math as CesiumMath,
  type PerspectiveFrustum,
} from 'cesium'
import { sampleTerrainMostDetailed } from 'cesium'
import { computeAlerts, prepareAlerts, type AlertSide, type PreparedAlerts } from './alerts'
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
  type Weather,
} from './data'
import { demoDecision } from './decisions'
import { loadDetection } from './detection'
import { CUT, decisionShots } from './director'
import { Editor, type Reports, type Runs } from './editor'
import { engineName, runScenario, type EngineRun, type ScenarioRequest } from './engines'
import { burnedHa, computeFWISeries, decisionBarriers, freeArrival, params, simulate, type Run, type Scenario } from './fastModel'
import { FireLayer } from './fireLayer'
import { loadGrid } from './grid'
import { Hud, type CameraReadout } from './hud'
import { loadInventory } from './inventory'
import { MarkerLayer } from './markers'
import { buildContext, loadOsm, type Context } from './osm'
import { Player } from './player'
import { computeReach, freeAreaHa } from './reach'
import { ReachLayer } from './reachLayer'
import { endMinute, makeReport, recommend } from './report'
import { createViewer } from './scene'
import { addHeights, buildStory, type Shot, type ShotKind, type Story } from './shots'
import { SplitLayer } from './splitLayer'
import { Spotlight } from './spotlight'
import { containmentProbability, loadSuppression, type Decision } from './suppression'

// Monte da Penha, Guimarães (617 m): the reference point for the whole twin.
const PENHA = { lon: -8.2683, lat: 41.4256 }
// Where the replay starts: high over Penha, looking north-east towards the Minho fires.
const START: Pose = { ...PENHA, h: 600, heading: 30, pitch: -50, range: 60_000 }
const HORIZON_MIN = 24 * 60 // the free run and the decisions A and B go on until the fire stops, or this long
const REPORT_MIN = 360 // the 6 h of the report, kept beside the end
const ENGINE_WAIT_MS = 1000 // the decisions have to be still this long before the engine runs them
const DIRECTOR_KINDS = new Set<ShotKind>(['decision', 'versus', 'outcome'])

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
  story: Story // the observed replay's shots, then the director's (rebuilt with the decisions)
  split?: SplitLayer // the decisions A and B side by side (always simulated, shown in their shots or on key A)
  freeShown: Float32Array // the arrival the free layer draws: the fast model's, or the engine's once it has run
  runs?: Runs // the runs on the screen
  showSplit: boolean // key A: the split stays on through every shot
  director: boolean // key D: the director's cut plays instead of the whole story
  shotShown: Shot | undefined // the shot the split and the editor were last set for
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

  function resetNorth() {
    if (replay?.player) {
      replay.player.playing = false
      replay.player.userMoved = true
    }
    const current = readPose(scene)
    if (current) {
      const target = Cartesian3.fromDegrees(current.lon, current.lat, current.h)
      viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 0), {
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(current.pitch), current.range),
        duration: 0.8,
      })
    } else {
      viewer.camera.flyTo({
        destination: viewer.camera.position,
        orientation: {
          heading: 0,
          pitch: viewer.camera.pitch,
          roll: 0,
        },
        duration: 0.8,
      })
    }
  }

  function flyToIgnition() {
    if (!replay) return
    const { data: fire, story } = replay
    replay.player.playing = false
    replay.player.userMoved = true

    // Coordenadas exatas do marcador "I - Ignição"
    const ignMarker = story.markers.find((m) => m.id === 'ignition:0' || m.badge === 'I')
    const lon = ignMarker ? ignMarker.lon : fire.ignition.lon
    const lat = ignMarker ? ignMarker.lat : fire.ignition.lat
    let height = ignMarker && ignMarker.h > 0 ? ignMarker.h : 0
    if (!height) {
      const sampled = viewer.scene.globe.getHeight(Cartographic.fromDegrees(lon, lat))
      if (sampled !== undefined && Number.isFinite(sampled)) height = sampled
    }
    const target = Cartesian3.fromDegrees(lon, lat, height)
    viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 0), {
      offset: new HeadingPitchRange(
        0, // Norte
        CesiumMath.toRadians(-35), // inclinação de 35° para perspetiva tática do terreno
        650, // zoom próximo e centrado no ponto I de ignição
      ),
      duration: 1.2,
    })
  }

  /** An alert's place (alerts.ts), seen from 1.5 km to the south, on the terrain even where no tile is loaded yet. */
  async function flyToAlert(at: { lon: number; lat: number }) {
    if (!replay) return
    replay.player.playing = false
    replay.player.userMoved = true
    const c = Cartographic.fromDegrees(at.lon, at.lat)
    let height = viewer.scene.globe.getHeight(c)
    if (height === undefined || !Number.isFinite(height)) {
      await sampleTerrainMostDetailed(viewer.terrainProvider, [c]).catch(() => undefined)
      height = Number.isFinite(c.height) ? c.height : 0
    }
    const target = Cartesian3.fromDegrees(at.lon, at.lat, height)
    viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 0), {
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-40), 1500),
      duration: 1.2,
    })
  }

  const hud = new Hud(document.getElementById('hud')!, index, {
    toggle: () => replay?.player.toggle(),
    prev: () => replay?.player.prev(),
    next: () => replay?.player.next(),
    goTo: (i) => replay?.player.goTo(i),
    pickFire: (id) => (location.hash = id),
    pickEngine: () => rerun(),
    roleChanged: (role) => {
      editor.setRole(role)
      const dispatch = editor.getMultiAgencyDispatch()
      if (dispatch) hud.updateBriefings(dispatch)
    },
    resetNorth,
    flyToIgnition,
    toggleEditor: () => editor.toggle(),
    mobilizeAerial: (flameM) => editor.mobilizeAerial(flameM),
    flyTo: (at) => void flyToAlert(at),
  })
  // The decision editor: what it draws is simulated again at once and shown split.
  const editor = new Editor(viewer, hud.root, suppression, inventory, {
    changed: () => rerun(),
    editing: (open) => {
      hud.setEditing(open)
      if (!replay) return
      if (open) {
        replay.player.playing = false // the mouse has the camera and the map takes the clicks
        // The drawer's hour is the replay's clock; before the replay starts, the clock goes to the end of the run.
        if (!(replay.player.update(0).hours > 0)) replay.player.seek(shownEndMin() / 60)
        replay.showSplit = true
      }
    },
  })

  // The drawer's hour slider moves the fire clock (the editor has taken the new hour by now); the replay goes on from there.
  editor.el.querySelector('[data-ref="hour"]')?.addEventListener('input', () => replay?.player.seek(editor.hours))

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
    const regional = nearestStations(stations, fire.ignition, 30, 65)
    // The free run: the fire as the fast model lets it go with nobody on it, from the ignition.
    const startIndex = Math.max(0, weather.time.indexOf(fire.start.slice(0, 16)))
    const fwiSeries = computeFWISeries(weather)
    const durationMin = horizonMin(fire.start, weather)
    const scenario: Scenario = { grid, weather, startIndex, ignition: fire.ignition, stations: regional, suppression, durationMin, fwiSeries }
    const t0 = performance.now()
    // The scenario's own free run (fastModel.freeArrival): the same array the reruns show, so the free layer is drawn once.
    const free: Run = { decision: null, arrival: freeArrival(scenario), durationMin, runtimeMs: performance.now() - t0 }
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

    const switched = replay !== undefined
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
      stations: regional,
      credits: sourceCredits(fire),
      fire: new FireLayer(scene, progression),
      markers: new MarkerLayer(viewer, overlay, story.markers, () => hud.safeArea()),
      player: new Player(scene, story.shots, from),
      scenario,
      free: new SplitLayer(viewer, overlay, grid, [{ name: 'livre', arrival: free.arrival }], durationMin),
      freeShown: free.arrival,
      reach: new ReachLayer(viewer, fire.ignition, reach),
      context,
      story,
      showSplit: false,
      director: replay?.director ?? false,
      shotShown: undefined,
    }
    // Paused on the first shot: the first fire waits over Penha for play, another one is flown to.
    if (switched) replay.player.goTo(0)
    hud.setDirector(replay.director)
    editor.setFire(id, fire, regional, context, scenario, demoDecision(fire, near), reach.intensityKWPerM)
    replay.free.show(false)
    replay.credits.forEach((c) => viewer.creditDisplay.addStaticCredit(c))
    hud.setFire(fire, story.shots, {
      known: { fire, weather, startIndex, stations: near, inventory, detection, satHa: reach.tsat.areaHa, fwiSeries },
      areaHa: (hours) => freeAreaHa(reach, hours),
      poc: (areaHa) => containmentProbability(suppression, areaHa, reach.intensityKWPerM),
      intensityKWPerM: reach.intensityKWPerM,
    })
    document.title = `${fire.name} · Atalaia`
    engineDone.clear()
    rerun() // the decisions A and B are simulated at once: the director's shots need them
  }

  /** The player's shots: the whole story, or the director's cut of it. The HUD's ticks follow. */
  function setShots() {
    if (!replay) return
    const { story, player, director } = replay
    const shots = director ? story.shots.filter((s) => CUT.includes(s.kind)) : story.shots
    const current = player.shots[player.index]
    // The same shot, or the one built again in its place: the director's are new after every run, in the same order.
    const nth = player.shots.filter((s) => s.kind === current.kind).indexOf(current)
    const index = shots.includes(current) ? shots.indexOf(current) : shots.indexOf(shots.filter((s) => s.kind === current.kind)[nth])
    hud.setShots(shots)
    if (index < 0) {
      player.shots = shots
      player.goTo(Math.min(player.index, shots.length - 1))
      return
    }
    // A rerun moves neither the camera nor, as a new shot would, the editor's tab and the split.
    if (replay.shotShown === current) replay.shotShown = shots[index]
    player.keep(shots, index)
  }

  /** The director's shots follow the decisions: built again after every run, on the terrain. */
  async function refreshDirector(runs: Runs, reports: Reports | undefined) {
    if (!replay) return
    const { story, data, scenario, stations } = replay
    const fovy = (scene.camera.frustum as PerspectiveFrustum).fovy!
    const fresh = decisionShots(data, scenario.grid, stations, suppression, editor.decisions, runs, reports, fovy)
    await addHeights({ shots: fresh, markers: [] }, viewer.terrainProvider)
    if (replay?.story !== story) return // another fire meanwhile
    const kept = story.shots.filter((s) => !DIRECTOR_KINDS.has(s.kind))
    story.shots = [...kept, ...fresh]
    setShots()
  }

  // The special alerts of the three runs, prepared in rerun() and read at the clock in the loop.
  let alerts: PreparedAlerts | undefined

  /** The hour the shown runs are over: the later of A and B to stop, or the end of the runs. */
  function shownEndMin(): number {
    const runs = replay?.runs
    if (!replay || !runs) return REPORT_MIN
    return Math.max(endMinute(replay.scenario.grid, runs.A), endMinute(replay.scenario.grid, runs.B))
  }

  /** Simulate Livre, A and B as the editor holds them and show them: the fast model at once, then the engine's runs
   *  (ELMFIRE through the API) in their place when they come. Runs the engine already gave are shown straight away. */
  function rerun() {
    if (!replay) return
    const { scenario } = replay
    const [a, b]: [Decision, Decision] = editor.decisions
    const requests = { free: engineRequest(scenario, null), A: engineRequest(scenario, a), B: engineRequest(scenario, b) }
    const known = [requests.free, requests.A, requests.B].map((r) => engineDone.get(JSON.stringify(r)))
    if (known.every((r) => r)) {
      window.clearTimeout(engineTimer)
      engineGen++ // an answer still on its way is for an older plan
      const [free, A, B] = known as EngineRun[]
      show({ free: engineRun(scenario, free, null), A: engineRun(scenario, A, a), B: engineRun(scenario, B, b) })
      editor.setEngine({ state: 'done', name: free.engine, seconds: 0 })
      return
    }
    show({ free: { decision: null, arrival: freeArrival(scenario), durationMin: scenario.durationMin, runtimeMs: 0 }, A: simulate(scenario, a), B: simulate(scenario, b) })
    askEngine(scenario, [a, b], requests)
  }

  /** Livre, A and B on the screen: the free layer, A and B split, their reports and alerts, the director's shots. */
  function show(runs: Runs) {
    if (!replay) return
    const { scenario, context } = replay
    const { grid } = scenario
    const [a, b] = editor.decisions
    replay.runs = runs
    for (const [name, run] of Object.entries(runs))
      console.info(
        `${name}: ${run.engine ?? 'modelo rápido'} ${run.runtimeMs.toFixed(0)} ms · ` +
          [60, 360, run.durationMin].map((t) => `${t} min ${burnedHa(grid, run, t).toFixed(0)} ha`).join(' · ') +
          ` · fim T+${endMinute(grid, run).toFixed(0)} min`,
      )
    if (import.meta.env.DEV) Object.assign((window as unknown as { atalaia: { runs: unknown } }).atalaia, { runs })
    const overlay = document.getElementById('overlay')!
    if (runs.free.arrival !== replay.freeShown) {
      replay.free.destroy()
      replay.free = new SplitLayer(viewer, overlay, grid, [{ name: 'livre', arrival: runs.free.arrival }], runs.free.durationMin)
      replay.free.set(replay.player.update(0).hours)
      replay.free.show(false) // the loop shows it in its shots
      replay.freeShown = runs.free.arrival
    }
    const reports: Reports | undefined = context && {
      free: makeReport(grid, context, runs.free),
      A: makeReport(grid, context, runs.A),
      B: makeReport(grid, context, runs.B),
    }
    // A and B are told apart at the end of the engine's runs; the fast model's 24 h only grows to the grid's
    // border, so its preview is judged at 6 h.
    const sixHours = (run: Run) => makeReport(grid, context!, run, Math.min(REPORT_MIN, run.durationMin))
    const judged: Reports | undefined = reports && (runs.A.engine ? reports : { free: sixHours(runs.free), A: sixHours(runs.A), B: sixHours(runs.B) })
    // The recommended decision (fewer places reached, then less burned) is named as such on its side of the split.
    const pick = judged && recommend(judged.A, judged.B).pick
    const label = (d: Decision) => (d.id === pick ? `${d.name} · recomendada` : d.name)
    const position = replay.split?.position
    replay.split?.destroy()
    replay.split = new SplitLayer(
      viewer,
      overlay,
      grid,
      [{ name: label(a), arrival: runs.A.arrival }, { name: label(b), arrival: runs.B.arrival }],
      runs.A.durationMin,
    )
    if (position !== undefined) replay.split.setPosition(position)
    replay.split.set(replay.player.update(0).hours)
    replay.split.show(false) // the loop shows it in the director's shots, or on key A
    editor.setRuns(runs, reports, judged)
    alerts = prepareAlerts({ scenario, context, decisions: [a, b], runs })
    void refreshDirector(runs, judged)
  }

  // The engine (ELMFIRE by default, or the one picked in the settings) runs Livre, A and B through the API
  // (docs/contracts.md). Its answers are kept by request for this fire, so a plan seen before comes back at once.
  const engineDone = new Map<string, EngineRun>()
  const enginePending = new Map<string, Promise<EngineRun>>()
  let engineGen = 0 // the plan asked last: answers for an older one are not shown
  let engineTimer: number | undefined

  /** The scenario of a decision as the API takes it, over the runs' whole horizon: the same barriers the fast model
   *  applied, from the same whole minutes (rounding them later moves where a line catches the head). */
  function engineRequest(scenario: Scenario, d: Decision | null): ScenarioRequest {
    const barriers = d ? decisionBarriers(scenario, d) : []
    return { fire: replay!.id, engine: hud.settings.engine, duration_min: scenario.durationMin, decision: { barriers } }
  }

  const engineRun = (scenario: Scenario, r: EngineRun, decision: Decision | null): Run => ({
    decision,
    arrival: r.arrival,
    durationMin: scenario.durationMin,
    runtimeMs: r.runtimeS * 1000,
    engine: r.engine,
  })

  /** Asks the engine for the three runs once the decisions have been still for a moment, and shows them if they are
   *  still the ones on the screen. While the ILS searches B, Livre and A are asked ahead and B waits for its plan. */
  function askEngine(scenario: Scenario, [a, b]: [Decision, Decision], requests: Record<'free' | 'A' | 'B', ScenarioRequest>) {
    window.clearTimeout(engineTimer)
    const gen = ++engineGen
    const name = engineName(requests.free.engine)
    const { rows, cols } = scenario.grid
    const ask = (request: ScenarioRequest) => {
      const key = JSON.stringify(request)
      let pending = enginePending.get(key)
      if (!pending) {
        pending = runScenario(request, rows, cols)
        enginePending.set(key, pending)
        pending.then(
          (r) => replay?.scenario === scenario && engineDone.set(key, r),
          () => undefined,
        ).finally(() => enginePending.delete(key))
      }
      return pending
    }
    editor.setEngine({ state: 'running', name })
    engineTimer = window.setTimeout(async () => {
      const t0 = performance.now()
      try {
        if (editor.searching) {
          editor.setEngine({ state: 'waiting', name })
          await Promise.all([ask(requests.free), ask(requests.A)])
          // B is asked when the search is over. A search that ends with B's plan reruns by itself; one that fails or
          // is stopped may not, so the flag is watched until it is down.
          const watch = () => {
            if (gen !== engineGen) return
            if (editor.searching) engineTimer = window.setTimeout(watch, 500)
            else rerun()
          }
          watch()
          return
        }
        const [free, A, B] = await Promise.all([ask(requests.free), ask(requests.A), ask(requests.B)])
        if (gen !== engineGen || replay?.scenario !== scenario) return
        show({ free: engineRun(scenario, free, null), A: engineRun(scenario, A, a), B: engineRun(scenario, B, b) })
        editor.setEngine({ state: 'done', name: free.engine, seconds: [free, A, B].some((r) => !r.cached) ? (performance.now() - t0) / 1000 : 0 })
      } catch (e) {
        if (gen !== engineGen) return
        console.warn(`${name}: ${e instanceof Error ? e.message : e}; fica o modelo rápido`)
        editor.setEngine({ state: 'down', name, reason: e instanceof Error ? e.message : String(e) })
      }
    }, ENGINE_WAIT_MS)
  }

  /** The decisions A and B on and off the screen through every shot (key A). */
  function toggleDecisions() {
    if (!replay) return
    replay.showSplit = !replay.showSplit
    if (!replay.showSplit) editor.toggle(false)
  }

  /** The director's cut (key D): the 90 s of the demo, from the start. */
  function toggleDirector() {
    if (!replay) return
    replay.director = !replay.director
    hud.setDirector(replay.director)
    setShots()
    if (replay.director) replay.player.restart()
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
    const frame = player.update(dt)
    // The split shows in the director's shots, or through every shot on key A.
    const splitOn = !!split && (replay.showSplit || !!frame.shot.split)
    // The observed fire gives way to the simulated one: the free run in its shots, A and B when split.
    const simulated = frame.shot.simulated || splitOn
    fire.set(simulated ? { step: -1, fade: 1, untimed: false } : frame.fire)
    free.show(frame.shot.simulated && !splitOn)
    free.set(frame.hours)
    split?.show(splitOn)
    split?.set(frame.hours)
    // The player's clock is the only one: the editor's hour slider and overlays (cut roads, perimeters) follow it.
    editor.syncTime(frame.hours)
    // The director's shots put one decision's means on the ground and its side of the split alone on the screen;
    // the comparison starts with the split in the middle.
    if (frame.shot !== replay.shotShown) {
      replay.shotShown = frame.shot
      const { decision, kind } = frame.shot
      if (decision !== undefined) {
        editor.showDecision(decision)
        split?.setPosition(decision === 0 ? 1 : 0)
      } else if (kind === 'versus') split?.setPosition(0.5)
    }
    revealed = frame.revealed

    // The crosshair, its coordinates and the light are on the ground at the centre of the screen, picked every
    // frame now that the camera has its pose; while the player drives, its target is there too (the camera orbits it).
    const centre = readPose(scene) ?? (frame.driving ? frame.pose : undefined)
    if (centre) {
      readout = { ...centre, centre }
      // Free camera: the light widens as the mouse zooms out.
      spotlight.set(centre, frame.driving ? frame.spot : frame.spot * (centre.range / Math.max(frame.pose.range, 1)))
    } else readout = { ...readout, centre: undefined } // the sky: the light stays where the ground last was
    frameNo++
    hud.update(frame, readout, splitOn)
    // Alerts of the run on the screen: the free run, or the side of the split that holds more of it.
    const side: AlertSide = !splitOn ? 'free' : (frame.shot.decision ?? ((split?.position ?? 0.5) >= 0.5 ? 0 : 1)) === 0 ? 'A' : 'B'
    if (alerts) hud.setAlerts(computeAlerts(alerts, frame.hours * 60, side))
    if (frameNo % 60 === 0) {
      const dispatch = editor.getMultiAgencyDispatch()
      if (dispatch) hud.updateBriefings(dispatch)
    }
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
    // Arrows and space belong to a focused radio in the settings, letters to the editor's fields; a slider keeps only its arrows.
    const { target } = e
    const field = target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && (target.type !== 'range' || e.key.startsWith('Arrow')))
    if (!replay || field) return
    const { player } = replay
    const actions: Record<string, () => void> = {
      ' ': () => player.toggle(),
      ArrowLeft: () => player.prev(),
      ArrowRight: () => player.next(),
      r: () => player.restart(),
      s: () => hud.settings.toggle(),
      h: () => hud.toggleHidden(),
      l: () => hud.toggleLedger(),
      a: () => toggleDecisions(),
      d: () => toggleDirector(),
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

/** How long the runs go: 24 h, or less where the fire's weather ends sooner. The API takes the weather every
 *  30 min from the start up to the first time at or past the end, and all of it has to be in weather.json. */
function horizonMin(start: string, weather: Weather): number {
  const minutes = (time: string) => Date.parse(`${time.slice(0, 16)}:00Z`) / 60_000
  const left = minutes(weather.time[weather.time.length - 1]) - minutes(start) - 30
  return Math.max(60, Math.min(HORIZON_MIN, Math.floor(left / 30) * 30))
}

function fireFromHash(ids: string[]): string {
  const id = decodeURIComponent(location.hash.slice(1))
  return ids.includes(id) ? id : ids[0]
}

main().catch((error) => {
  console.error(error)
  document.body.dataset.error = String(error)
})
