// The browser's fast model (web/src/fastModel.ts, imported as is) run once from Node: the free run
// of a fire folder with nobody on it, the arrival minute of every cell written as float32
// (Infinity where the fire does not get within the duration). Node ≥ 22.18 runs the TypeScript itself:
//
//   node --import ./scripts/fastmodel/register.mjs scripts/fastmodel/free_run.ts <fire dir> <weather.json> <start> <lon> <lat> <minutes> <out.f32>
//
// The grid and its layers come from the folder; the start (local, as weather.time) and the ignition
// from the arguments, so the folder needs no fire.json yet.

import { readFileSync, writeFileSync } from 'node:fs'

const [dir, weatherPath, start, lon, lat, minutes, out] = process.argv.slice(2)
const web = new URL('../../web/', import.meta.url)
const { simulate } = await import(new URL('src/fastModel.ts', web).href)
const { computeFWISeries } = await import(new URL('src/fwi.ts', web).href)

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const bytes = (name: string) => {
  const b = readFileSync(`${dir}/${name}`)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
// As grid.ts loadGrid() and main.ts open() build them.
const meta = json(`${dir}/grid.json`)
const fuel = json(`${dir}/fuel.json`)
const weather = json(weatherPath)
const index = new Uint8Array(bytes('fuel.u8'))
const n = meta.cols * meta.rows
const fuelClass = new Uint8Array(n)
const fuelCode = new Uint16Array(n)
for (let i = 0; i < n; i++) (fuelClass[i] = fuel.legend[index[i]].class), (fuelCode[i] = fuel.legend[index[i]].scottBurgan)
const { sw, se, ne, nw } = meta.wgs84
const grid = {
  ...meta,
  classes: fuel.classes,
  fuelClass,
  fuelCode,
  slope: new Uint8Array(bytes('slope.u8')),
  aspect: new Uint16Array(bytes('aspect.u16')),
  rect: { west: (sw[0] + nw[0]) / 2, south: (sw[1] + se[1]) / 2, east: (se[0] + ne[0]) / 2, north: (nw[1] + ne[1]) / 2 },
}
const startIndex = Math.max(0, weather.time.indexOf(start.slice(0, 16)))
const suppression = json(new URL('public/suppression.json', web).pathname)
const scenario = { grid, weather, startIndex, ignition: { lon: +lon, lat: +lat }, stations: [], suppression, durationMin: +minutes, fwiSeries: computeFWISeries(weather) }
const run = simulate(scenario, null)
writeFileSync(out, new Uint8Array(run.arrival.buffer))
console.log(`fast model: ${minutes} min in ${run.runtimeMs.toFixed(0)} ms`)
