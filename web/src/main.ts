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
import { Basemap, MAPS, type MapId } from './basemap'
import { applyPose, readPose, type Pose } from './camera'
import {
  loadFire,
  loadFireIndex,
  loadProgression,
  loadStations,
  loadWeather,
  type Fire,
  type NearStation,
  type Weather,
} from './data'
import { demoDecision } from './decisions'
import { loadDetection } from './detection'
import { incidentShots } from './director'
import { Busy } from './busy'
import { Editor, type Reports, type Runs, type SimulateState } from './editor'
import { runScenario, type EngineRun, type ScenarioRequest } from './engines'
import { burnedHa, decisionBarriers, type Run, type Scenario } from './scenario'
import { simulate as fastSimulate } from './fastModel'
import { FireLayer } from './fireLayer'
import { loadGrid } from './grid'
import { computeFWISeries } from './fwi'
import { Hud, type CameraReadout } from './hud'
import { loadInventory } from './inventory'
import { layoutHash } from './layout'
import { MarkerLayer } from './markers'
import { buildContext, loadOsm, type Context } from './osm'
import { Player } from './player'
import { OutcomeLayer } from './outcomeLayer'
import { WindShiftWatch } from './windShift'
import { computeReach, freeAreaHa } from './reach'
import { ReachLayer } from './reachLayer'
import { arrivalFromProgression, cutSteps } from './reference'
import { CAP_HA, capRun, describeEnd, endMinute, fireEnd, makeReport, recommend } from './report'
import { createViewer, setQuality } from './scene'
import { addHeights, buildStory, type Shot, type Story } from './shots'
import { SplitLayer } from './splitLayer'
import { Spotlight } from './spotlight'
import { computeRings, stationsInPlay } from './stationRings'
import { StationRingsLayer } from './stationRingsLayer'
import { containmentProbability, loadSuppression, type Decision } from './suppression'

// Monte da Penha, Guimarães (617 m): the reference point for the whole twin.
const PENHA = { lon: -8.2683, lat: 41.4256 }
// Where the replay starts: high over Penha, looking north-east towards the Minho fires.
const START: Pose = { ...PENHA, h: 600, heading: 30, pitch: -50, range: 60_000 }
const HORIZON_MIN = 24 * 60 // the free run and the decisions A and B go on until the fire stops, or this long, or the cap
const REPORT_MIN = 360 // the 6 h of the report, kept beside the end
const FREE_WAIT_MS = 30_000 // the cached free run is waited for this long on load; then the reference's own progression stands in
const SPOT_K = 0.35 // the light's radius as a share of the camera's distance: the same size on screen at any zoom

/** Before the wind shift (plans made on the forecast without it) or after it (the incident has happened). */
type Phase = 'pre' | 'post'
/** One ELMFIRE simulation of A and B, with the means it ran. */
interface Sim {
  runs: Runs
  decisions: [Decision, Decision]
  hash: string
}

interface Replay {
  id: string
  data: Fire
  stations: NearStation[]
  credits: Credit[]
  fire: FireLayer // the observed fire
  markers: MarkerLayer
  player: Player
  scenario: Scenario // ELMFIRE inputs, forecast and deployment geometry
  free: SplitLayer // the free run (ELMFIRE, no forces), shown during the simulated shots
  freeRun: Run // the same run, cut at the cap
  reach: ReachLayer // outlines at the ETAs and at T_sat, scale rings
  rings: StationRingsLayer // station approach interception boundaries; follows the free run shown
  context: Context | undefined // roads, homes and places from OSM, when the fire has them
  story: Story // incident chapters rebuilt from the current ELMFIRE response
  split?: SplitLayer // the decisions A and B side by side (only after an ELMFIRE simulation, shown in their shots or on key A)
  outcome?: OutcomeLayer
  runs?: Runs // Livre, A and B of the simulation on the screen; none before the first
  freeNow: Run // the free run the free layer draws: the forecast's, or the shifted one after the incident
  baseHash: string // the means layout of the start (empty): what Livre alone stands for
  phase: Phase // which wind the screen and the next simulation are for
  sims: Partial<Record<Phase, Sim>> // the last simulation of each phase, both kept for going back
  showSplit: boolean // key A: manual side-by-side inspection outside the editor
  director: boolean // key D: presentation lighting and restart
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
  const busy = new Busy() // the loading screen: while an ELMFIRE run is on, nothing can be changed
  const basemap = new Basemap(viewer)
  let replay: Replay | undefined
  // Console handle for tuning in dev (atalaia.spotlight.strength = 0, …); absent from the build.
  if (import.meta.env.DEV)
    Object.assign(window, {
      atalaia: {
        viewer,
        spotlight,
        runs: {},
        get replay() {
          return replay
        },
        get editor() {
          return editor
        },
        simulate: () => void simulate(),
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
    toggle: () => playback(() => replay?.player.toggle()),
    prev: () => playback(() => replay?.player.prev()),
    next: () => playback(() => replay?.player.next()),
    goTo: (i) => playback(() => replay?.player.goTo(i)),
    pickFire: (id) => (location.hash = id),
    pickEngine: () => refreshSimulate(),
    simulate: () => void simulate(),
    pickMap: (id) => setMap(id),
    pickQuality: (id) => setQuality(viewer, id),
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
  setMap(hud.settings.map)
  setQuality(viewer, hud.settings.quality)

  /** The map under the fire (settings or key M). */
  function setMap(id: MapId) {
    basemap.set(id)
    hud.settings.setMap(id)
  }

  // The decision editor: placing means runs nothing; the simulate button (here and in the HUD) runs A and B on ELMFIRE.
  const editor = new Editor(viewer, hud.root, suppression, inventory, {
    changed: () => refreshSimulate(),
    simulate: () => void simulate(),
    editing: (open) => {
      hud.setEditing(open)
      if (!replay) return
      if (open) {
        replay.player.pause() // stop camera travel as well as the clock
        // Start planning at detection, keeping the same clock as the replay.
        if (!(replay.player.update(0).hours > 0)) replay.player.seek(detection.droneMin / 60)
        replay.showSplit = false
        replay.outcome?.show(false)
        replay.reach.update(new Set())
        replay.markers.update(new Set()) // persistent operational landmarks stay visible
        scene.requestRender()
      } else {
        void refreshDirector()
      }
    },
  })

  // The drawer's hour slider moves the fire clock (the editor has taken the new hour by now); the replay goes on from there.
  editor.el.querySelector('[data-ref="hour"]')?.addEventListener('input', () => replay?.player.seek(editor.hours))

  // The one incident, the wind shift of a simulated fire: playback stops there and the commander reallocates (windShift.ts).
  const windShift = new WindShiftWatch({
    pause: () => replay?.player.pause(),
    forecast: async () => {
      if (!replay) return false
      const current = replay
      current.phase = 'post'
      const post = current.sims.post
      if (post) { show(post.runs, post.decisions); return true }
      // Recalculate the response that was actually played, even if an unsimulated draft exists.
      const ok = await simulate(true)
      if (replay !== current) return false
      if (!ok) { current.phase = 'pre'; refreshSimulate() }
      return ok
    },
    seek: (h) => replay?.player.seek(h),
    reallocate: () => {
      if (!replay) return
      replay.phase = 'post'
      const post = replay.sims.post
      if (post && replay.runs !== post.runs) show(post.runs, post.decisions)
      windShift.setResolved(!!post)
      refreshSimulate()
      editor.toggle(true)
    },
    rearmed: () => setPhase('pre'),
  })

  /** Back before the incident: the pre-incident results are the ones on the screen (both stay cached). */
  function setPhase(phase: Phase) {
    if (!replay || replay.phase === phase) return
    replay.phase = phase
    windShift.setResolved(false)
    const pre = replay.sims.pre
    if (pre) show(pre.runs, pre.decisions)
    else showFreeOnly(replay.freeRun)
    refreshSimulate()
  }
  async function open(id: string) {
    if (replay?.id === id || loading === id) return
    loading = id
    const [fire0, progression0, grid, weather, osm] = await Promise.all([
      loadFire(id),
      loadProgression(id),
      loadGrid(id),
      loadWeather(id),
      loadOsm(id),
    ])
    const fovy = (scene.camera.frustum as PerspectiveFrustum).fovy!
    // Only the stations in play are available anywhere means come from (stationRings.ts).
    const near = stationsInPlay(stations, fire0.ignition, suppression)
    const regional = near
    // The shared ELMFIRE inputs and deployment geometry.
    const startIndex = Math.max(0, weather.time.indexOf(fire0.start.slice(0, 16)))
    const fwiSeries = computeFWISeries(weather)
    const durationMin = horizonMin(fire0.start, weather)
    const scenario: Scenario = { grid, weather, startIndex, ignition: fire0.ignition, stations: regional, suppression, durationMin, dispatchMin: detection.droneMin, fwiSeries: fwiSeries as any }
    // The free run is the first ELMFIRE prediction, no forces: the API's cached run, or the reference's own
    // progression (the same ELMFIRE run) while the API is down. It is cut at the cap so the browser stays light.
    busy.start('A obter a previsão do ELMFIRE…', ['Livre'])
    const t0 = performance.now()
    const capHa = fire0.referenceCapHa ?? CAP_HA
    let reference: Run
    let source: string
    let shiftNote = ''
    try {
      const r = await Promise.race([
        ask(engineRequest(id, scenario, null, fire0.windShift ? false : undefined), grid.rows, grid.cols),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('sem resposta do ELMFIRE')), FREE_WAIT_MS)),
      ])
      reference = engineRun(scenario, r, null)
      source = r.engine
      if (r.shiftIgnored) shiftNote = 'A API não aceita wind_shift: corre com o vento da referência.'
    } catch (e) {
      console.warn(`ELMFIRE livre: ${e instanceof Error ? e.message : e}; fica a progressão da referência`)
      reference = { decision: null, arrival: arrivalFromProgression(grid, fire0, progression0), durationMin, runtimeMs: 0, engine: fire0.simulated ? 'ELMFIRE (referência)' : 'perímetros observados' }
      source = `${reference.engine}, sem a API`
    }
    busy.hide()
    const free = capRun(grid, reference, capHa)
    const freeEnd = endMinute(grid, free)
    // The story and the observed layer stop where the run does.
    const { fire, progression } = cutSteps(fire0, progression0, fireEnd(grid, free).cutMin ?? Infinity)
    const reach = computeReach(grid, free, fire, near, suppression, detection)
    const ringList = computeRings(grid, free.arrival, fire0.ignition, near, suppression, detection)
    scenario.fireArrival = free.arrival
    console.info(`rings: ${ringList.map((r) => `${r.station.short} T+${Math.round(r.arriveMin)} min ${Math.round(r.radiusM)} m`).join(' · ')}`)
    console.info(
      `free run (${source}): ${(performance.now() - t0).toFixed(0)} ms · ${describeEnd(fireEnd(grid, free), fire.start, free.durationMin)} · ` +
        reach.etas.map((e) => `${e.unit} ${e.from} T+${e.minutes} min ${e.areaHa.toFixed(1)} ha POC ${(e.poc * 100).toFixed(0)} %`).join(' · ') +
        ` · T_sat ${reach.tsat.areaHa.toFixed(0)} ha POC ${(reach.tsat.poc * 100).toFixed(0)} %`,
    )
    const context = osm ? buildContext(grid, osm) : undefined
    if (context) console.info(`osm: ${osm!.roads.length} roads, ${osm!.buildings.length} buildings, ${context.access.length} access points`)
    const story = buildStory(fire, progression, near, fovy, reach, {
      endMin: freeEnd,
      text: `${describeEnd(fireEnd(grid, free), fire.start, free.durationMin)} (${source})`,
    })
    story.shots = incidentShots({ fire, grid, stations: near, suppression, detection, free, post: false, decision: 0, fovy })
    await addHeights(story, viewer.terrainProvider)
    if (loading !== id) return // another fire was picked meanwhile
    loading = undefined

    const switched = replay !== undefined
    const from = replay ? (readPose(scene) ?? START) : START
    replay?.fire.destroy()
    replay?.markers.destroy()
    replay?.free.destroy()
    replay?.reach.destroy()
    replay?.rings.destroy()
    replay?.split?.destroy()
    replay?.outcome?.destroy()
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
      free: new SplitLayer(viewer, overlay, grid, [{ name: 'livre', arrival: free.arrival }], freeEnd + 1),
      freeRun: free,
      freeNow: free,
      reach: new ReachLayer(viewer, fire.ignition, reach),
      rings: new StationRingsLayer(viewer, fire.ignition, overlay),
      context,
      story,
      showSplit: false,
      director: true,
      shotShown: undefined,
      baseHash: '',
      phase: 'pre',
      sims: {},
    }
    replay.rings.set(ringList)
    // Paused on the first shot: the first fire waits over Penha for play, another one is flown to.
    if (switched) replay.player.goTo(0)
    else replay.player.seek(story.shots[0].hours)
    hud.setDirector(replay.director)
    editor.setFire(id, fire, regional, context, scenario, demoDecision(fire, near, suppression.unlimitedWater), reach.intensityKWPerM)
    editor.setRange(freeEnd)
    editor.setFree(free)
    editor.setEngine({ state: 'done', name: source, seconds: 0, note: shiftNote })
    windShift.setFire(fire, grid, free)
    replay.free.show(false)
    replay.credits.forEach((c) => viewer.creditDisplay.addStaticCredit(c))
    hud.setFire(fire, story.shots, {
      known: { fire, weather, startIndex, stations: near, inventory, detection, satHa: reach.tsat.areaHa, fwiSeries },
      areaHa: (hours) => freeAreaHa(reach, hours),
      poc: (areaHa) => containmentProbability(suppression, areaHa, reach.intensityKWPerM),
      intensityKWPerM: reach.intensityKWPerM,
    })
    document.title = `${fire.name} · Atalaia`
    // Nothing is simulated yet but Livre: the means layout of the start (empty) is what the button compares against.
    replay.baseHash = layoutKey()
    alerts = prepareAlerts({ scenario, context, decisions: editor.decisions, runs: { free, A: free, B: free } }) // A and B are never read before they are simulated
    setShots()
    refreshSimulate()
  }

  /** Keep the current incident time when a forecast or active decision rebuilds the film. */
  function setShots() {
    if (!replay) return
    const { story, player } = replay
    const hours = player.update(0).hours
    const index = Math.max(0, story.shots.reduce((found, shot, i) => shot.hours <= hours + 1e-8 ? i : found, 0))
    hud.setShots(story.shots)
    player.keep(story.shots, index)
    replay.shotShown = undefined
  }

  async function refreshDirector() {
    if (!replay) return
    const current = replay
    const { story, data: fire, scenario, stations, phase } = current
    const sim = current.sims[phase]
    const fresh = incidentShots({ fire, grid: scenario.grid, stations, suppression, detection,
      free: current.freeNow, decisions: sim?.decisions, runs: sim?.runs,
      post: phase === 'post', decision: editor.decisionIndex,
      fovy: (scene.camera.frustum as PerspectiveFrustum).fovy! })
    await addHeights({ shots: fresh, markers: [] }, viewer.terrainProvider)
    if (replay !== current || current.phase !== phase || current.sims[phase] !== sim) return
    story.shots = fresh
    setShots()
    scene.requestRender()
  }

  /** Transport controls leave the planning workspace before playing its real-time consequences. */
  function playback(action: () => void) {
    if (!replay || busy.active) return
    // A film must use the means actually submitted to ELMFIRE, rather than an unsimulated draft.
    if (simulateState().enabled) {
      editor.toggle(true)
      refreshSimulate()
      return
    }
    const wasEditing = editor.open
    editor.toggle(false)
    if (wasEditing) void refreshDirector().then(action)
    else action()
  }

  // The special alerts of the three runs, prepared in rerun() and read at the clock in the loop.
  let alerts: PreparedAlerts | undefined

  /** The hour the shown runs are over, or cut: the later of Livre, A and B (the opening has only Livre). */
  function shownEndMin(): number {
    if (!replay) return REPORT_MIN
    const { grid } = replay.scenario
    const runs = replay.runs
    return Math.max(endMinute(grid, replay.freeNow), runs ? Math.max(endMinute(grid, runs.A), endMinute(grid, runs.B)) : 0)
  }

  /** Livre, A and B of an ELMFIRE simulation on the screen: A and B split, their reports and alerts, the director's shots. */
  function show(runs: Runs, [a, b]: [Decision, Decision]) {
    if (!replay) return
    const { scenario, context } = replay
    const { grid } = scenario
    replay.runs = runs
    swapFree(runs.free)
    for (const [name, run] of Object.entries(runs))
      console.info(
        `${name}: ${run.engine ?? 'ELMFIRE'} ${run.runtimeMs.toFixed(0)} ms · ` +
          [60, 360, run.durationMin].map((t) => `${t} min ${burnedHa(grid, run, t).toFixed(0)} ha`).join(' · ') +
          ` · ${describeEnd(fireEnd(grid, run), replay.data.start, run.durationMin)}`,
      )
    if (import.meta.env.DEV) Object.assign((window as unknown as { atalaia: { runs: unknown } }).atalaia, { runs })
    const overlay = document.getElementById('overlay')!
    const reports: Reports | undefined = context && {
      free: makeReport(grid, context, runs.free),
      A: makeReport(grid, context, runs.A),
      B: makeReport(grid, context, runs.B),
    }
    // The recommended decision (fewer places reached, then less burned) is named as such on its side of the split.
    // Two runs cut at the cap are compared at the earlier cut: the slower fire has burned less by then, and
    // neither has reached places the other was cut short of.
    const cutA = fireEnd(grid, runs.A).cutMin
    const cutB = fireEnd(grid, runs.B).cutMin
    const judged: Reports | undefined =
      reports && context && cutA !== undefined && cutB !== undefined
        ? { ...reports, A: makeReport(grid, context, runs.A, Math.min(cutA, cutB)), B: makeReport(grid, context, runs.B, Math.min(cutA, cutB)) }
        : reports
    const pick = judged && recommend(judged.A, judged.B).pick
    const label = (d: Decision) => (d.id === pick ? `${d.name} · recomendada` : d.name)
    const position = replay.split?.position
    replay.split?.destroy()
    replay.split = new SplitLayer(
      viewer,
      overlay,
      grid,
      [{ name: label(a), arrival: runs.A.arrival }, { name: label(b), arrival: runs.B.arrival }],
      Math.max(endMinute(grid, runs.A), endMinute(grid, runs.B)) + 1,
    )
    if (position !== undefined) replay.split.setPosition(position)
    replay.split.set(replay.player.update(0).hours)
    replay.split.show(false) // the loop shows it in the director's shots, or on key A
    editor.setRange(shownEndMin())
    editor.setRuns(runs, reports, judged)
    alerts = prepareAlerts({ scenario, context, decisions: [a, b], runs })
    replay.outcome?.destroy()
    replay.outcome = new OutcomeLayer(viewer, overlay, grid, runs)
    void refreshDirector()
  }

  /** The free layer draws this run (the forecast's, or the shifted one after the incident). */
  function swapFree(free: Run) {
    if (!replay || free === replay.freeNow) return
    replay.free.destroy()
    replay.free = new SplitLayer(viewer, document.getElementById('overlay')!, replay.scenario.grid, [{ name: 'livre', arrival: free.arrival }], endMinute(replay.scenario.grid, free) + 1)
    replay.free.set(replay.player.update(0).hours)
    replay.free.show(false) // the loop shows it in its shots
    replay.freeNow = free
    // Recompute where approaching units meet this forecast, from the incident time when replanning.
    const list = computeRings(replay.scenario.grid, free.arrival, replay.data.ignition, replay.stations, suppression, detection, replay.phase === 'post' ? Math.max(detection.droneMin, replay.data.windShift?.minutes ?? 0) : detection.droneMin)
    replay.scenario.fireArrival = free.arrival
    replay.rings.set(list)
  }

  /** Only Livre is simulated (the start, or the pre-incident results were never run): A and B are "ainda não simulado". */
  function showFreeOnly(free: Run) {
    if (!replay) return
    const { scenario, context } = replay
    replay.runs = undefined
    replay.split?.destroy()
    replay.split = undefined
    swapFree(free)
    editor.setFree(free)
    editor.setRuns(undefined, undefined)
    editor.setRange(endMinute(scenario.grid, free))
    alerts = prepareAlerts({ scenario, context, decisions: editor.decisions, runs: { free, A: free, B: free } }) // A and B are never read before they are simulated
    replay.outcome?.destroy()
    replay.outcome = undefined
    void refreshDirector()
  }

  // ELMFIRE runs through the API (docs/contracts.md). Its answers are kept by request, so a layout seen before
  // (or an empty one, which is the free run) comes back at once.
  const engineDone = new Map<string, EngineRun>()
  const enginePending = new Map<string, Promise<EngineRun>>()

  function ask(request: ScenarioRequest, rows: number, cols: number, onProgress?: (stretch?: string) => void): Promise<EngineRun> {
    const key = JSON.stringify(request)
    const done = engineDone.get(key)
    if (done) return Promise.resolve(done)
    let pending = enginePending.get(key)
    if (!pending) {
      pending = runScenario(request, rows, cols, onProgress)
      enginePending.set(key, pending)
      pending.then(
        (r) => engineDone.set(key, r),
        () => undefined,
      ).finally(() => enginePending.delete(key))
    }
    return pending
  }

  /** The scenario of a decision as the API takes it, over the runs' whole horizon (sent explicitly): the barriers
   *  from the same whole minutes the editor draws (rounding them later moves where a line catches the head). */
  function engineRequest(id: string, scenario: Scenario, d: Decision | null, windShift?: boolean): ScenarioRequest {
    const barriers = d ? decisionBarriers(scenario, d) : []
    return { fire: id, engine: hud.settings.engine, duration_min: scenario.durationMin, decision: { barriers }, wind_shift: windShift }
  }

  /** Whether a run is for the wind after the incident (true), before it (false), or the fire has no incident (undefined). */
  const windOf = (phase: Phase) => (replay?.data.windShift ? phase === 'post' : undefined)

  const engineRun = (scenario: Scenario, r: EngineRun, decision: Decision | null): Run => ({
    decision,
    arrival: r.arrival,
    durationMin: scenario.durationMin,
    runtimeMs: r.runtimeS * 1000,
    engine: r.engine,
  })

  /** The means layout as the engine would get it: each decision's points, lines, assignments and barriers. */
  function layoutKey(): string {
    if (!replay) return ''
    const { scenario } = replay
    return layoutHash({
      engine: hud.settings.engine,
      duration: scenario.durationMin,
      wind: windOf(replay.phase),
      decisions: editor.decisions.map((d) => ({ points: d.points, lines: d.lines, assignments: d.assignments, barriers: decisionBarriers(scenario, d) })),
    })
  }

  /** The simulate button, in the drawer and in the HUD: lit only when the means differ from the last simulation's,
   *  or when the incident has happened and nothing has been run with the new wind. */
  function simulateState(): SimulateState {
    if (!replay) return { label: 'Simular intervenção', enabled: false, note: '' }
    if (editor.searching) return { label: 'À espera da proposta B…', enabled: false, note: 'O B está a ser procurado (até 10 s); depois podes simular.' }
    const [a, b] = editor.decisions
    const sim = replay.sims[replay.phase]
    if (replay.phase === 'post' && !sim)
      return { label: 'Simular com o vento novo', enabled: true, note: 'O vento rodou: a simulação mostrada é do vento anterior. Realoca os meios e simula de novo.' }
    if (layoutKey() === (sim?.hash ?? replay.baseHash))
      return {
        label: sim ? 'Simulação atualizada' : 'Sem meios para simular',
        enabled: false,
        note: sim ? 'A e B simulados com os meios no mapa (Modelo Rápido).' : 'Põe meios no mapa (E) e carrega aqui para simular a intervenção.',
      }
    const post = replay.phase === 'post'
    return {
      label: post ? 'Simular com o vento novo' : 'Simular intervenção',
      enabled: true,
      note: sim
        ? 'Os meios mudaram desde a última simulação.'
        : a.assignments.length + b.assignments.length ? 'A e B ainda não simulados: o mapa mostra só a previsão sem meios.' : 'Os meios foram retirados.',
    }
  }

  let lastSimulate = ''
  function refreshSimulate() {
    scene.requestRender()
    if (!replay) return
    const state = simulateState()
    const key = `${state.label}|${state.enabled}|${state.note}`
    if (key === lastSimulate) return
    lastSimulate = key
    hud.setSimulate(state)
    editor.setSimulate(state)
  }

  /** Runs A and B on ELMFIRE as they stand now, behind the loading screen, and shows them. Before the incident the
   *  free run is the cached one; after it, Livre is run again with the new wind, so the comparison stays honest. */
  async function simulate(automaticWind = false): Promise<boolean> {
    if (!replay || busy.active || (!automaticWind && !simulateState().enabled)) return false
    const { scenario } = replay
    const { phase } = replay
    const post = phase === 'post'
    const decisions = (automaticWind ? replay.sims.pre?.decisions ?? editor.decisions : editor.decisions).map((d) => structuredClone(d)) as [Decision, Decision]
    const [a, b] = decisions
    const hash = layoutKey()
    replay.player.pause()
    const t0 = performance.now()
    try {
      const capHa = replay.data.referenceCapHa ?? CAP_HA
      const cap = (r: Run) => capRun(scenario.grid, r, capHa)
      const rFree = fastSimulate(scenario as any, null)
      rFree.engine = 'Modelo Rápido (livre)'
      const free = cap(rFree)
      const ra = fastSimulate(scenario as any, a)
      const rb = fastSimulate(scenario as any, b)
      ra.engine = 'Modelo Rápido'
      rb.engine = 'Modelo Rápido'
      const sim: Sim = { runs: { free, A: cap(ra), B: cap(rb) }, decisions, hash }
      replay.sims[phase] = sim
      if (replay.phase === phase) show(sim.runs, decisions)
      if (post) windShift.setResolved(true)
      const seconds = (performance.now() - t0) / 1000
      editor.setEngine({ state: 'done', name: 'Modelo Rápido (navegador)', seconds })
      refreshSimulate()
      return true
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      console.warn(`Modelo rápido: ${reason}`)
      editor.setEngine({ state: 'down', name: 'Modelo Rápido', reason })
    }
    refreshSimulate()
    return false
  }

  /** The decisions A and B on and off the screen through every shot (key A). */
  function toggleDecisions() {
    if (!replay) return
    replay.showSplit = !replay.showSplit
    if (!replay.showSplit) editor.toggle(false)
  }

  /** Toggle presentation lighting; enabling it restarts the incident film. */
  function toggleDirector() {
    if (!replay) return
    replay.director = !replay.director
    hud.setDirector(replay.director)
    setShots()
    if (replay.director) playback(() => replay?.player.restart())
  }

  // The mouse takes the camera only while the player is not driving it.
  for (const type of ['pointerdown', 'wheel'])
    scene.canvas.addEventListener(type, () => {
      if (replay && !replay.player.driving) replay.player.userMoved = true
    })

  let last = performance.now()
  let frameNo = 0
  let searching = false
  let renderedHours = NaN
  let readout: CameraReadout = { heading: 0, pitch: 0, range: 0, centre: undefined }
  let revealed = new Set<string>()
  scene.preUpdate.addEventListener(() => {
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    if (!replay) return
    const { player, fire, free, split } = replay
    scene.screenSpaceCameraController.enableInputs = !player.driving && !busy.active
    if (editor.open && player.driving) player.pause()
    const frame = player.update(dt)
    if (!editor.open && frame.playing && frame.phase === 'hold' && frame.shot.gate === 'decision' && !replay.runs) {
      player.pause()
      player.seek(frame.shot.hours)
      editor.toggle(true)
      return
    }
    // Cesium handles camera/tile changes itself. A paused fire needs no continuous GPU redraw;
    // playback and timeline changes still draw each new state.
    if (frame.driving || frame.hours !== renderedHours) scene.requestRender()
    renderedHours = frame.hours
    // The split shows in the director's shots, or through every shot on key A.
    const finale = !editor.open && frame.shot.kind === 'outcome'
    const splitOn = !finale && !!split
    split?.presentation(!editor.open && replay.showSplit)
    const selectedPosition = editor.decisionIndex === 0 ? 1 : 0
    if (splitOn && (!replay.showSplit || editor.open) && split?.position !== selectedPosition) split?.setPosition(selectedPosition)
    replay.outcome?.show(finale, frame.progress * frame.shot.holdS)
    // The observed fire gives way to the simulated one: the free run in its shots, A and B when split.
    // With the drawer open and nothing simulated yet, the free run is what the means are up against.
    const freeOn = !finale && !splitOn && (frame.shot.simulated || editor.open)
    fire.set(finale || freeOn || splitOn ? { step: -1, fade: 1, untimed: false } : frame.fire)
    free.show(freeOn)
    free.set(frame.hours)
    replay.rings.setEligible(editor.open)
    replay.rings.update(replay.scenario.grid, replay.freeNow.arrival, suppression, editor.deploymentSelection)
    split?.show(splitOn)
    split?.set(frame.hours)
    // The player's clock is the only one: the editor's hour slider and overlays (cut roads, perimeters) follow it.
    editor.syncTime(frame.hours)
    // Playback follows the decision selected when leaving the editor.
    if (frame.shot !== replay.shotShown) {
      replay.shotShown = frame.shot
      const { decision, kind } = frame.shot
      if (decision !== undefined && !editor.open) {
        editor.showDecision(decision)
        split?.setPosition(decision === 0 ? 1 : 0)
      } else if (kind === 'versus') split?.setPosition(0.5)
    }
    revealed = editor.open ? new Set() : frame.revealed
    spotlight.enabled = !editor.open

    // The crosshair, its coordinates and the light are on the ground at the centre of the screen, picked every
    // frame now that the camera has its pose; while the player drives, its target is there too (the camera orbits it).
    const centre = readPose(scene) ?? (frame.driving ? frame.pose : undefined)
    if (centre) {
      readout = { ...centre, centre }
      // Only the director's cut sizes the light per shot; otherwise it keeps one size on screen, whatever the zoom.
      spotlight.set(centre, replay.director && frame.driving ? frame.spot : SPOT_K * centre.range)
    } else readout = { ...readout, centre: undefined } // the sky: the light stays where the ground last was
    frameNo++
    if (editor.searching !== searching) refreshSimulate() // the ILS ended: B is final and can be simulated
    searching = editor.searching
    hud.update(frame, readout, splitOn)
    // Alerts of the run on the screen: the free run, or the side of the split that holds more of it.
    const side: AlertSide = !splitOn ? 'free' : (frame.shot.decision ?? ((split?.position ?? 0.5) >= 0.5 ? 0 : 1)) === 0 ? 'A' : 'B'
    windShift.update(frame.hours, frame.playing)
    if (alerts) hud.setAlerts(windShift.alerts(computeAlerts(alerts, frame.hours * 60, side)))
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
    if (busy.active || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Escape' && hud.settings.open) return hud.settings.toggle(false)
    if (editor.handleKey(e)) return e.preventDefault()
    // Arrows and space belong to a focused radio in the settings, letters to the editor's fields; a slider keeps only its arrows.
    const { target } = e
    const field = target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && (target.type !== 'range' || e.key.startsWith('Arrow')))
    if (!replay || field) return
    const { player } = replay
    const actions: Record<string, () => void> = {
      ' ': () => playback(() => player.toggle()),
      ArrowLeft: () => playback(() => player.prev()),
      ArrowRight: () => playback(() => player.next()),
      r: () => playback(() => player.restart()),
      s: () => hud.settings.toggle(),
      h: () => hud.toggleHidden(),
      l: () => hud.toggleLedger(),
      a: () => toggleDecisions(),
      d: () => toggleDirector(),
      e: () => editor.toggle(),
      m: () => setMap(MAPS[(MAPS.findIndex((m) => m.id === basemap.id) + 1) % MAPS.length].id),
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
