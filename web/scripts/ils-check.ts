// Regression check of decision B (optimize.ts) on the demo fires: each fire is loaded as the app
// loads it (main.ts), A is the editor's example (decisions.ts on the roads, cut to the stock), and
// the ILS searches B with seed 1, as the editor's worker does. It fails when B is worse than A, or
// when A or B moved further than DRIFT from the reference in ils-reference.json.
//
// The search stops at PLANS distinct plans instead of at 10 s: with a fixed seed the plans come in
// the same order on any machine, so B is the same everywhere (Chrome tested ~2000–2400 plans in its
// 10 s on 21 Oct). With --time it runs the editor's 10 s instead, to see what this machine finds in
// the demo's budget; a slower one finds less.
// The fast model is still changing and each change moves A and B: when one was on purpose, --update
// takes this run's figures as the new reference.
// The data comes from public/ on disk: fetch() of the app's own loaders reads the files here.
//
// npm run ils:check              (from web/; ~30 s)
// npm run ils:check -- --time
// npm run ils:check -- --update

import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAirBase } from '../src/airBases'
import { loadFire, loadStations, loadWeather } from '../src/data'
import { loadDetection } from '../src/detection'
import { demoDecision } from '../src/decisions'
import { computeFWISeries, freeArrival, type Scenario } from '../src/fastModel'
import { loadGrid } from '../src/grid'
import { loadInventory, type Inventory } from '../src/inventory'
import { better, groundOf, optimize, type Options, type Score } from '../src/optimize'
import { buildContext, loadOsm, snapToRoad, type Context } from '../src/osm'
import { computeRings, outsideRing, radiiOf, stationsInPlay } from '../src/stationRings'
import { isAerial, loadSuppression, type Assignment, type Decision, type Suppression, type UnitId } from '../src/suppression'

const DECISION_MIN = 360 // main.ts: the 6 h of the report
const BUDGET_MS = 10_000 // editor.ts ILS_BUDGET_MS
const SEED = 1 // editor.ts
const SNAP_M = 400 // editor.ts: the example's points go to the nearest road within this
const PLANS = 2000 // per fire, unless --time
// How far A or B may move from the reference before the check fails: any change in the places
// reached, since the demo is told in places, or a quarter of the hectares.
const DRIFT = { places: 0, ha: 0.25 }
const SAME_HA = 0.05 // the reference's rounding

type Figures = Pick<Score, 'places' | 'ha'>

/** ils-reference.json: what this check found when the reference was last taken. */
interface Reference {
  measured: string // date, stop, seed and the last commit that changed src/ or public/
  fires: {
    id: string
    name: string
    a: Figures
    b: Figures
    foundAt: number // the plan at which the search first had this B: what a machine must test in 10 s to show it
  }[]
}

const WEB = fileURLToPath(new URL('..', import.meta.url))
const REFERENCE = fileURLToPath(new URL('./ils-reference.json', import.meta.url))

// The loaders fetch('/fires/…') from the dev server; in node the same paths are read from public/.
const PUBLIC = join(WEB, 'public')
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname
  try {
    return new Response(new Uint8Array(await readFile(join(PUBLIC, path))))
  } catch {
    return new Response(null, { status: 404 })
  }
}) as typeof fetch

/** A as the editor first holds it (Editor.setFire): the example's points on the nearest road, and
 *  its counts cut in order to what each station or air base has (Editor.fit). */
function editorA(example: Decision, context: Context, inventory: Inventory | null, sup: Suppression, scenario: Scenario): Decision {
  const points = Object.fromEntries(
    Object.entries(example.points).map(([id, p]) => {
      const { lon, lat } = snapToRoad(context, p, SNAP_M) ?? p
      return [id, { lon, lat }]
    }),
  )
  const stock = (unit: UnitId, from: string): number | undefined => {
    if (isAerial(sup.units[unit])) return findAirBase(from)?.units[unit]
    const s = inventory?.[from]
    if (!s) return undefined
    return unit === 'crew' ? s.decir.ecin + s.decir.eip : s.units[unit]
  }
  const used = new Map<string, number>()
  const assignments: Assignment[] = []
  const dropped = new Set<string>()
  for (const x of example.assignments) {
    // Editor.fit: only the stations in play, each one's ground means inside its ring.
    if (!isAerial(sup.units[x.unit]) && (!scenario.stations.some((s) => s.id === x.from) || outsideRing(scenario.rings, scenario.ignition, sup, { ...example, points }, x.unit, x.from, x.target))) {
      dropped.add(x.target)
      continue
    }
    const key = `${x.unit}|${x.from}`
    const have = stock(x.unit, x.from)
    const count = have === undefined ? x.count : Math.min(x.count, have - (used.get(key) ?? 0))
    if (count < 1) {
      dropped.add(x.target)
      continue
    }
    used.set(key, (used.get(key) ?? 0) + count)
    assignments.push({ ...x, count })
  }
  for (const x of assignments) dropped.delete(x.target)
  const keep = <T>(targets: Record<string, T>) => Object.fromEntries(Object.entries(targets).filter(([id]) => !dropped.has(id)))
  return { ...example, points: keep(points), lines: keep(example.lines), assignments }
}

/** The last commit that changed the code or the data the figures come from. */
function commit(): string {
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: WEB, encoding: 'utf8' }).trim()
    const dirty = git('status', '--porcelain', '--', 'src', 'public') ? ' + uncommitted changes' : ''
    return `commit ${git('log', '-1', '--format=%h', '--', 'src', 'public')}${dirty}`
  } catch {
    return 'no git'
  }
}

const plural = (n: number, word: string) => `${n} ${Math.abs(n) === 1 ? word : `${word}s`}`
const text = (s: Figures) => `${plural(s.places, 'place')} · ${s.ha.toFixed(1)} ha`
const signed = (x: number, digits = 0) => `${x > 0 ? '+' : ''}${x.toFixed(digits)}`
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`
const rounded = (s: Figures): Figures => ({ places: s.places, ha: Math.round(s.ha * 10) / 10 })
const same = (s: Figures, ref: Figures) => s.places === ref.places && Math.abs(s.ha - ref.ha) <= SAME_HA
const tooFar = (s: Figures, ref: Figures) =>
  Math.abs(s.places - ref.places) > DRIFT.places || Math.abs(s.ha - ref.ha) > DRIFT.ha * ref.ha

function change(s: Figures, ref: Figures): string {
  if (same(s, ref)) return 'same'
  const dp = s.places - ref.places
  const dha = s.ha - ref.ha
  const pct = ref.ha ? ` (${signed((100 * dha) / ref.ha)} %)` : ''
  return `${dp ? `${signed(dp)} ${Math.abs(dp) === 1 ? 'place' : 'places'} · ` : ''}${signed(dha, 1)} ha${pct}${tooFar(s, ref) ? ', more than the drift' : ''}`
}

const byTime = process.argv.includes('--time')
const update = process.argv.includes('--update')
if (byTime && update) throw new Error('--update takes the figures of the plan run: leave out --time')
const stop: Options = byTime ? { budgetMs: BUDGET_MS } : { budgetMs: Infinity, maxPlans: PLANS }
const reference = JSON.parse(await readFile(REFERENCE, 'utf8')) as Reference
const [stations, suppression, inventory, detection] = await Promise.all([loadStations(), loadSuppression(), loadInventory(), loadDetection()])
const next: Reference = { measured: `${new Date().toISOString().slice(0, 10)} · ${PLANS} plans · seed ${SEED} · ${commit()}`, fires: [] }
const broken: string[] = [] // B worse than A
const moved: string[] = [] // A or B further than DRIFT from the reference
console.log(`ILS check · ${byTime ? `${seconds(BUDGET_MS)} per fire` : `${PLANS} plans per fire`} · seed ${SEED} · node ${process.version}`)
console.log(`reference: ${reference.measured}`)
for (const ref of reference.fires) {
  const [fire, grid, weather, osm] = await Promise.all([loadFire(ref.id), loadGrid(ref.id), loadWeather(ref.id), loadOsm(ref.id)])
  if (!osm) throw new Error(`${ref.id}: no osm.json, so no access points for B`)
  const near = stationsInPlay(stations, fire.ignition, suppression)
  const regional = near
  const startIndex = Math.max(0, weather.time.indexOf(fire.start.slice(0, 16)))
  const scenario: Scenario = {
    grid,
    weather,
    startIndex,
    ignition: fire.ignition,
    stations: regional,
    suppression,
    durationMin: DECISION_MIN,
    fwiSeries: computeFWISeries(weather),
  }
  // The rings from the fast model's free run (the app uses the ELMFIRE one).
  const rings = computeRings(grid, freeArrival(scenario), fire.ignition, near, suppression, detection, inventory)
  scenario.rings = radiiOf(rings)
  console.log(`  rings: ${rings.map((r) => `${r.station.short} T+${Math.round(r.arriveMin)} ${Math.round(r.radiusM)} m`).join(' · ')}`)
  const context = buildContext(grid, osm)
  const a = editorA(demoDecision(fire, near), context, inventory, suppression, scenario)
  let found = { plans: 0, elapsedMs: 0 }
  const result = optimize(scenario, groundOf(context), a, {
    ...stop,
    seed: SEED,
    onProgress: (p) => {
      if (p.decision && p.phase !== 'done') found = { plans: p.plans, elapsedMs: p.elapsedMs }
    },
  })
  const { a: sa, best: sb, plans, elapsedMs, improved } = result
  next.fires.push({ ...ref, a: rounded(sa), b: rounded(sb), foundAt: improved ? found.plans : 0 })

  console.log(`\n${ref.name} (${ref.id})`)
  console.log(`  A  ${text(sa).padEnd(21)} ref ${text(ref.a)} · ${change(sa, ref.a)}`)
  console.log(`  B  ${text(sb).padEnd(21)} ref ${text(ref.b)} · ${change(sb, ref.b)}`)
  console.log(
    `     ${plural(sb.units, 'unit')} · ${plans} plans · ${seconds(elapsedMs)} · ` +
      (improved ? `found at plan ${found.plans} (${seconds(found.elapsedMs)}), ref ${ref.foundAt}` : 'no plan beat A'),
  )
  const problems: string[] = []
  if (better(sa, sb)) problems.push('B is worse than A, which the search never returns: optimize.ts is broken')
  if (tooFar(sa, ref.a)) problems.push('A moved more than the drift: the fire model or the means changed')
  if (tooFar(sb, ref.b))
    problems.push(
      byTime
        ? `B moved more than the drift: ${plans} plans in ${seconds(BUDGET_MS)} here, the reference B needs ${ref.foundAt}`
        : same(sa, ref.a)
          ? 'B moved more than the drift with the same A: the search changed'
          : 'B moved more than the drift',
    )
  else if (!byTime && same(sa, ref.a) && !same(sb, ref.b)) console.log('  ! same A, other B: the search changed')
  if (better(sa, sb)) broken.push(ref.name)
  else if (problems.length) moved.push(ref.name)
  console.log(problems.length ? problems.map((p) => `  ${update && !better(sa, sb) ? '~' : 'FAIL'} ${p}`).join('\n') : '  ok')
}

if (update && !broken.length) {
  await writeFile(REFERENCE, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`\nreference updated: ${next.measured}\nupdate the figures in docs/ils.md §5.1 too`)
} else if (broken.length || moved.length) {
  console.log(`\nFAIL ${[...broken, ...moved].join(', ')}${update ? ': reference not updated' : ''}`)
  if (moved.length && byTime)
    console.log(
      'With --time, B depends on how many plans this machine tests in 10 s. Without --time the plans\n' +
        "are the reference's, so a move there is the code's, not the machine's.",
    )
  else if (moved.length)
    console.log(
      `The figures moved from the reference (${reference.measured}).\n` +
        'If fastModel.ts, the means or the search changed on purpose and B still beats A, take this run as the reference:\n' +
        '  npm run ils:check -- --update    (rewrites scripts/ils-reference.json; then the figures in docs/ils.md §5.1)',
    )
} else console.log('\nall ok')
process.exitCode = broken.length || (moved.length && !update) ? 1 : 0
