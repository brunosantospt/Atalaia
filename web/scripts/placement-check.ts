// Exercise the editor's real click handler without creating a WebGL viewer or running ELMFIRE.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Editor } from '../src/editor'
import { destination, toPTTM06 } from '../src/geo'
import type { Suppression, UnitId } from '../src/suppression'

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
console.log('OK: actual editor click places foot crews off-road, preserves dispatch time, and still snaps vehicles to roads')
