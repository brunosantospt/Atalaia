// Regression check of decision B (optimize.ts) on the two demo fires: each fire is loaded as the
// app loads it (main.ts), A is the editor's example (decisions.ts on the roads, cut to the stock),
// and the ILS searches B with seed 1, as the editor's worker does. It fails when B is worse than A,
// or clearly worse than what the search found on 21 Oct (docs/ils.md §5.1).
//
// The search stops at PLANS distinct plans instead of at 10 s: with a fixed seed the plans come in
// the same order on any machine, so B is the same everywhere and the 21 Oct figures come back
// exactly (Chrome tested ~2000–2400 plans in its 10 s). With --time it runs the editor's 10 s
// instead, to see what this machine finds in the demo's budget; a slower one finds less.
// The data comes from public/ on disk: fetch() of the app's own loaders reads the files here.
//
// npm run ils:check            (from web/; ~30 s)
// npm run ils:check -- --time

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAirBase } from '../src/airBases'
import { loadFire, loadStations, loadWeather, nearestStations } from '../src/data'
import { demoDecision } from '../src/decisions'
import { computeFWISeries, type Scenario } from '../src/fastModel'
import { loadGrid } from '../src/grid'
import { loadInventory, type Inventory } from '../src/inventory'
import { better, groundOf, optimize, type Options, type Score } from '../src/optimize'
import { buildContext, loadOsm, snapToRoad, type Context } from '../src/osm'
import { isAerial, loadSuppression, type Assignment, type Decision, type Suppression, type UnitId } from '../src/suppression'

const DECISION_MIN = 360 // main.ts: the 6 h of the report
const BUDGET_MS = 10_000 // editor.ts ILS_BUDGET_MS
const SEED = 1 // editor.ts
const SNAP_M = 400 // editor.ts: the example's points go to the nearest road within this
const PLANS = 2000 // per fire, unless --time
const DRIFT_HA = 0.05 // further than this from the reference is a change of the model, the means or the search

type Figures = Pick<Score, 'places' | 'ha'>

interface Check {
  id: string
  name: string
  // Measured 21 Oct, Chrome, 10 s (docs/ils.md §5.1).
  reference: { a: Figures; b: Figures; plans: number }
  // What B may not exceed, with slack.
  limit: Figures
}

const CHECKS: Check[] = [
  {
    id: 'VieiradoMinho_10082016',
    name: 'Vieira do Minho 2016',
    reference: { a: { places: 3, ha: 871.9 }, b: { places: 0, ha: 138.4 }, plans: 1967 },
    limit: { places: 0, ha: 200 }, // no place reached, and most of A's hectares saved
  },
  {
    id: 'CabeceirasdeBasto_06092016',
    name: 'Cabeceiras de Basto 2016',
    reference: { a: { places: 5, ha: 449.0 }, b: { places: 3, ha: 428.2 }, plans: 2375 },
    limit: { places: 3, ha: 450 }, // 2 of A's 5 places saved, and no more burned than A
  },
]

// The loaders fetch('/fires/…') from the dev server; in node the same paths are read from public/.
const PUBLIC = fileURLToPath(new URL('../public', import.meta.url))
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
function editorA(example: Decision, context: Context, inventory: Inventory | null, sup: Suppression): Decision {
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

const text = (s: Figures) => `${s.places} ${s.places === 1 ? 'place' : 'places'} · ${s.ha.toFixed(1)} ha`
const differs = (s: Figures, ref: Figures) => s.places !== ref.places || Math.abs(s.ha - ref.ha) > DRIFT_HA
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

const byTime = process.argv.includes('--time')
const stop: Options = byTime ? { budgetMs: BUDGET_MS } : { budgetMs: Infinity, maxPlans: PLANS }
const [stations, suppression, inventory] = await Promise.all([loadStations(), loadSuppression(), loadInventory()])
const failures: string[] = []
console.log(`ILS check · ${byTime ? `${seconds(BUDGET_MS)} per fire` : `${PLANS} plans per fire`} · seed ${SEED} · node ${process.version}`)
for (const check of CHECKS) {
  const [fire, grid, weather, osm] = await Promise.all([loadFire(check.id), loadGrid(check.id), loadWeather(check.id), loadOsm(check.id)])
  if (!osm) throw new Error(`${check.id}: no osm.json, so no access points for B`)
  const near = nearestStations(stations, fire.ignition)
  const regional = nearestStations(stations, fire.ignition, 30, 65)
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
  const context = buildContext(grid, osm)
  const a = editorA(demoDecision(fire, near), context, inventory, suppression)
  // When the search first had its final B: how many plans a machine must test in 10 s to show it.
  let found = { plans: 0, elapsedMs: 0 }
  const result = optimize(scenario, groundOf(context), a, {
    ...stop,
    seed: SEED,
    onProgress: (p) => {
      if (p.decision && p.phase !== 'done') found = { plans: p.plans, elapsedMs: p.elapsedMs }
    },
  })
  const { a: sa, best: sb, plans, elapsedMs, improved } = result
  const { reference: ref, limit } = check

  const problems: string[] = []
  if (better(sa, sb)) problems.push('B is worse than A')
  if (sb.places > limit.places) problems.push(`B reaches ${sb.places} places, more than ${limit.places}`)
  if (sb.ha > limit.ha) problems.push(`B burns ${sb.ha.toFixed(1)} ha, more than ${limit.ha.toFixed(1)}`)

  console.log(`\n${check.name} (${check.id})`)
  console.log(`  A  ${text(sa)} · ${sa.units} units`)
  console.log(
    `  B  ${text(sb)} · ${sb.units} units · ${plans} plans · ${seconds(elapsedMs)} · ` +
      (improved ? `found at plan ${found.plans} (${seconds(found.elapsedMs)})` : 'no plan beat A'),
  )
  console.log(`  21 Oct  A ${text(ref.a)} → B ${text(ref.b)} · ${ref.plans} plans in Chrome's 10 s`)
  if (differs(sa, ref.a)) console.log('  ! A is not the reference A: the fire model or the means changed')
  else if (!byTime && differs(sb, ref.b)) console.log('  ! same A, other B: the search changed')
  console.log(`  limit  B ≤ ${limit.places} places, ≤ ${limit.ha.toFixed(1)} ha · ${problems.length ? `FAIL ${problems.join('; ')}` : 'ok'}`)
  if (problems.length && byTime && plans < ref.plans)
    console.log(`  ! ${plans} plans in ${seconds(BUDGET_MS)} against Chrome's ${ref.plans}: a slower machine or a busy CPU finds less`)
  if (problems.length) failures.push(check.name)
}

console.log(failures.length ? `\nFAIL ${failures.join(', ')}` : '\nall ok')
process.exitCode = failures.length ? 1 : 0
