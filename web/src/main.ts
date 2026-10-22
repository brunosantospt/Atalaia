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
import { runFast } from './fastClient'
import { burnedHa, decisionBarriers, type Run, type Scenario } from './scenario'
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
import { WindLayer } from './windLayer'
import { WindShiftWatch } from './windShift'
import { computeReach } from './reach'
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
const SPOT_K = 0.35 // the light's radius as a share of the camera's distance: the same size on screen at any zoom

/** Before the wind shift (plans made on the forecast without it) or after it (the incident has happened). */
type Phase = 'pre' | 'post'
/** One explicit simulation of A and B, with the means it ran. */
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
  wind: WindLayer
  markers: MarkerLayer
  player: Player
  scenario: Scenario // shared model inputs, forecast and deployment geometry
  free: SplitLayer // the free run (no forces), shown during the simulated shots
  freeRun: Run // the same run, cut at the cap
  reach: ReachLayer // outlines at the ETAs and at T_sat, scale rings
  rings: StationRingsLayer // station approach interception boundaries; follows the free run shown
  context: Context | undefined // roads, homes and places from OSM, when the fire has them
  story: Story // incident chapters rebuilt from the current simulated response
  split?: SplitLayer // the decisions A and B side by side (only after a button-run simulation, shown in their shots or on key A)
  arrivalPauses: Map<string, number>
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
  const busy = new Busy() // the loading screen: while a simulation is on, nothing can be changed
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
    toggleReports: () => editor.toggleReports(),
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

  // The decision editor: placing means runs nothing; the simulate button (here and in the HUD) runs the fast demo model.
  const editor = new Editor(viewer, hud.root, suppression, inventory, {
    changed: () => refreshSimulate(),
    simulate: () => void simulate(),
    reporting: (open) => {
      hud.setReports(open)
      if (open) replay?.player.pause()
      scene.requestRender()
    },
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
    const forecastWeather = fire0.windShift ? await fetch(`/fires/${id}/weather_noshift.json`).then(r => r.ok ? r.json() as Promise<Weather> : weather).catch(() => weather) : weather
    const scenario: Scenario = { demo: true, forecastWeather, grid, weather, startIndex, ignition: fire0.ignition, stations: regional, suppression, durationMin, dispatchMin: detection.droneMin }
    // Loading shows the saved reference; the demo model only runs after a button press.
    const t0 = performance.now()
    const capHa = fire0.referenceCapHa ?? CAP_HA
    const reference: Run = { decision: null, arrival: arrivalFromProgression(grid, fire0, progression0), durationMin,
      runtimeMs: 0, engine: 'Referência guardada' }
    const source = 'Referência guardada · simule o modelo rápido'
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
    replay?.wind.destroy()
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
      wind: new WindLayer(viewer, hud.root, fire.ignition),
      markers: new MarkerLayer(viewer, overlay, story.markers, () => hud.safeArea()),
      player: new Player(scene, story.shots, from),
      scenario,
      free: new SplitLayer(viewer, overlay, grid, [{ name: 'livre', arrival: free.arrival }], freeEnd + 1),
      freeRun: free,
      freeNow: free,
      reach: new ReachLayer(viewer, fire.ignition, reach),
      rings: new StationRingsLayer(viewer, fire.ignition, editor.el.querySelector('[data-ref=arrivalGuidance]')!),
      context,
      story,
      showSplit: false,
      director: true,
      shotShown: undefined,
      baseHash: '',
      phase: 'pre',
      sims: {},
      arrivalPauses: new Map(),
    }
    replay.rings.set(ringList)
    // Paused on the first shot: the first fire waits over Penha for play, another one is flown to.
    if (switched) replay.player.goTo(0)
    else replay.player.seek(story.shots[0].hours)
    hud.setDirector(replay.director)
    editor.setFire(id, fire, regional, context, scenario, demoDecision(fire, near, suppression.unlimitedWater), reach.intensityKWPerM)
    editor.setRange(freeEnd)
    editor.setFree(free)
    editor.setEngine({ state: 'done', name: source, seconds: 0, note: 'ELMFIRE em pausa para a demo.' })
    windShift.setFire(fire, grid, free)
    replay.free.show(false)
    replay.credits.forEach((c) => viewer.creditDisplay.addStaticCredit(c))
    let hudRun: Run | undefined, hudMinute = -1, hudHa = 0
    hud.setFire(fire, story.shots, {
      known: { fire, weather, forecastWeather, windShiftMin: fire.windShift?.minutes, startIndex, stations: near, inventory, detection, satHa: reach.tsat.areaHa, fwiSeries },
      areaHa: (hours) => {
        const run = replay?.freeNow ?? free, minute = Math.round(hours*60)
        if (hudRun !== run || hudMinute !== minute) {
          hudRun = run; hudMinute = minute; hudHa = burnedHa(grid, run, minute)
        }
        return hudHa
      },
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
    // A film must use the means actually submitted to the model, rather than an unsimulated draft.
    if (simulateState().enabled) {
      editor.toggle(true)
      refreshSimulate()
      return
    }
    const wasEditing = editor.open
    editor.toggleReports(false)
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

  /** Livre, A and B of the simulation on the screen: A and B split, their reports and alerts, the director's shots. */
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

  /** Forecast used for the button-run batch: before or after the incident. */
  const windOf = (phase: Phase) => replay?.data.windShift ? phase === 'post' : undefined

  /** The means layout as the engine would get it: each decision's points, lines, assignments and barriers. */
  function layoutKey(): string {
    if (!replay) return ''
    const { scenario } = replay
    return layoutHash({
      engine: 'fast',
      duration: scenario.durationMin,
      wind: windOf(replay.phase),
      decisions: editor.decisions.map((d) => ({ points: d.points, lines: d.lines, assignments: d.assignments, barriers: decisionBarriers(scenario, d) })),
    })
  }

  /** The simulate button, in the drawer and in the HUD: lit only when the means differ from the last simulation's,
   *  or when the incident has happened and nothing has been run with the new wind. */
  function simulateState(): SimulateState {
    if (!replay) return { label: 'Simular modelo rápido', enabled: false, note: '' }
    if (editor.searching) return { label: 'À espera da proposta B…', enabled: false, note: 'Termine a procura opcional de B antes de simular.' }
    const sim = replay.sims[replay.phase]
    if (sim && layoutKey() === sim.hash)
      return { label: 'Simulação atualizada', enabled: false, note: 'Modelo rápido atualizado para A e B.' }
    return { label: replay.phase === 'post' ? 'Simular com o vento novo' : 'Simular modelo rápido', enabled: true,
      note: 'Corre Livre, A e B ao carregar. ELMFIRE em pausa para a demo.' }
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

  /** Explicit button-run demo batch. No API requests, Docker jobs or background edit-time simulation. */
  async function simulate(): Promise<boolean> {
    if (!replay || busy.active || !simulateState().enabled) return false
    const current = replay
    const { scenario, phase } = current
    const decisions = editor.decisions.map(d => structuredClone(d)) as [Decision, Decision]
    current.player.pause()
    busy.start('A simular o modelo rápido…', ['Livre', 'A', 'B'])
    editor.setEngine({ state: 'running', name: 'Modelo rápido' })
    const t0 = performance.now()
    try {
      const result = await runFast({ scenario: { ...scenario, weather: phase === 'pre' ? scenario.forecastWeather ?? scenario.weather : scenario.weather }, decisions }, task => busy.mark(task))
      if (replay !== current) { busy.hide(); return false }
      const capHa = current.data.referenceCapHa ?? CAP_HA
      const runs: Runs = { free: capRun(scenario.grid, result.free, capHa), A: capRun(scenario.grid, result.A, capHa), B: capRun(scenario.grid, result.B, capHa) }
      if (phase === 'pre') current.freeRun = runs.free
      const sim: Sim = { runs, decisions, hash: '' }
      current.sims[phase] = sim
      current.arrivalPauses.clear()
      if (current.phase === phase) show(runs, decisions)
      sim.hash = layoutKey() // geometry now uses this batch's free forecast
      if (phase === 'post') windShift.setResolved(true)
      editor.setEngine({ state: 'done', name: 'Modelo rápido · demo', seconds: (performance.now()-t0)/1000,
        note: 'Água e autonomia são apenas indicadores visuais.' })
      busy.hide()
      refreshSimulate()
      return true
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      editor.setEngine({ state: 'down', name: 'Modelo rápido', reason })
      busy.fail(`O modelo rápido falhou: ${reason}`)
      return false
    }
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
    const frame = player.update(dt, replay.director ? 4 : 1)
    if (frame.hours < renderedHours - 1e-6) for (const [key, minute] of replay.arrivalPauses)
      if (minute > frame.hours * 60 + 1e-6) replay.arrivalPauses.delete(key)
    const arrivalKey = `${replay.phase}:${frame.shot.decision}:${frame.shot.hours}`
    if (!editor.open && frame.playing && frame.phase === 'hold' && frame.shot.gate === 'arrival' && !replay.arrivalPauses.has(arrivalKey)) {
      replay.arrivalPauses.set(arrivalKey, frame.shot.hours*60)
      player.pause()
      player.seek(frame.shot.hours)
      editor.syncTime(frame.shot.hours, true)
      scene.requestRender()
    }
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
    const shifted = frame.hours*60 >= (replay.data.windShift?.minutes ?? Infinity)
    replay.wind.update(shifted ? replay.scenario.weather : replay.scenario.forecastWeather ?? replay.scenario.weather, replay.scenario.startIndex, frame.hours*60)
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
    if (e.key === 'Escape' && editor.reportsOpen) return editor.toggleReports(false)
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
