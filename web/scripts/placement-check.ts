// Exercise the editor's real click handler without creating a WebGL viewer or running ELMFIRE.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Editor } from '../src/editor'
import { destination, toPTTM06 } from '../src/geo'
import type { Decision, Suppression, UnitId } from '../src/suppression'
import { ensureAssignmentIds, originColor } from '../src/unitIdentity'

const sup: Suppression = JSON.parse(await readFile(new URL('../public/suppression.json', import.meta.url), 'utf8'))
const click = { lon: -8.269444444444444, lat: 41.42075 }
const road = { ...destination(click, 90, 100), road: 0 }
const xy = toPTTM06(click)

function place(unit: UnitId) {
  // The click handler owns placement policy; Cesium picking and unrelated UI work are stubbed.
  const editor = Object.create(Editor.prototype)
  Object.assign(editor, {
    el: { classList: { contains: () => true } },
    sup, unit, active: 0, tool: 'point',
    loaded: { stations: [], scenario: { grid: { cols: 40, rows: 40, cellsize: 30, xmin: xy.x - 600, ymin: xy.y - 600 } },
      context: { access: [road], osm: { roads: [{ name: 'Test road', cls: 'paved' }] } } },
    decisions: [{ id: 'A', name: 'Test', points: {}, assignments: [], lines: {} }],
    refs: { hint: { classList: { remove: () => {} }, textContent: '' } },
    pick: () => ({ ...click }), placeable: () => 1, checkRing: () => true,
    from: () => 'quartel', dispatchMinute: () => 30, commit: () => {},
  })
  ;(editor as unknown as { click(position: unknown): void }).click({})
  return editor.decisions[0]
}

const foot = place('crew')
assert.deepEqual(Object.values(foot.points)[0], click, 'crew remains at the clicked terrain coordinate, even beside a road')
assert.equal(foot.assignments[0].dispatchMin, 30, 'off-road placement preserves current-clock dispatch')
const vehicle = place('vfci')
assert.deepEqual(Object.values(vehicle.points)[0], { lon: road.lon, lat: road.lat }, 'vehicles retain road snapping')
assert.equal(sup.unlimitedWater, true, 'demo enables unlimited ground water')
const plans = Object.create(Editor.prototype)
let proposed = 0
Object.assign(plans, { active: 0, decisions: [foot, vehicle], newlyLate: () => -1, render: () => {}, actions: { changed: () => {} }, proposeB: () => proposed++ })
plans.commit()
assert.equal(proposed, 1, 'editing A asks the ILS for a new B')
const identified: Decision = structuredClone(foot)
identified.assignments.push({ ...identified.assignments[0], id: undefined })
ensureAssignmentIds(identified)
assert.deepEqual(identified.assignments.map((a) => a.id), ['A-01', 'A-02'])
identified.assignments.shift()
ensureAssignmentIds(identified)
assert.equal(identified.assignments[0].id, 'A-02', 'removing a group never renumbers the remaining group')
identified.assignments.push({ ...identified.assignments[0], id: undefined })
ensureAssignmentIds(identified)
assert.equal(identified.assignments[1].id, 'A-03', 'a removed ID is not reused')
const copied = { ...structuredClone(identified), id: 'B' }
ensureAssignmentIds(copied)
assert.ok(copied.assignments.every((a) => a.id?.startsWith('B-')), 'copying into B creates IDs in its own namespace')
assert.deepEqual(identified.assignments.map((a) => a.id), ['A-02', 'A-03'], 'copying B preserves IDs in A')
const origins = [{ id: 'quartel-one' }, { id: 'quartel-two' }]
assert.notEqual(originColor(origins[0].id, origins), originColor(origins[1].id, origins), 'different stations have distinct origin colours')
assert.equal(originColor('cma-braga', origins), originColor('cma-braga', []), 'air-base colour is independent of the selected station')
console.log('OK: actual editor click places foot crews off-road, preserves dispatch time, and still snaps vehicles to roads')
