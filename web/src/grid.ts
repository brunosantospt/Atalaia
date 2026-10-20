// The 30 m grid of a fire, as scripts/build_fires.py writes it: fuel, slope and aspect per cell,
// row 0 on the north edge, in PT-TM06 metres. Read once into typed arrays for the fast model
// (fastModel.ts) and drawn back on the terrain as an image (splitLayer.ts).

import { toPTTM06, type LonLat } from './geo'

interface GridMeta {
  cols: number
  rows: number
  cellsize: number
  xmin: number
  ymin: number
  srs: string
  wgs84: Record<'sw' | 'se' | 'ne' | 'nw', [number, number]>
}

interface FuelLegend {
  classes: string[]
  legend: { class: number; scottBurgan: number }[]
}

export interface Grid extends GridMeta {
  classes: string[] // names of the fuel classes
  fuelClass: Uint8Array // 0..4, per cell
  fuelCode: Uint16Array // Scott & Burgan code, per cell
  slope: Uint8Array // degrees from the horizontal
  aspect: Uint16Array // where the slope faces, downhill, degrees from north
  /** Degrees. The grid is square in PT-TM06, so this is the WGS84 rectangle through the middle of its edges (off by ≤ 30 m at the corners). */
  rect: { west: number; south: number; east: number; north: number }
}

async function getBytes(path: string): Promise<ArrayBuffer> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return response.arrayBuffer()
}

export async function loadGrid(id: string): Promise<Grid> {
  const dir = `/fires/${id}`
  const [meta, fuel, fuelBytes, slopeBytes, aspectBytes] = await Promise.all([
    fetch(`${dir}/grid.json`).then((r) => r.json() as Promise<GridMeta>),
    fetch(`${dir}/fuel.json`).then((r) => r.json() as Promise<FuelLegend>),
    getBytes(`${dir}/fuel.u8`),
    getBytes(`${dir}/slope.u8`),
    getBytes(`${dir}/aspect.u16`),
  ])
  const index = new Uint8Array(fuelBytes)
  const n = meta.cols * meta.rows
  if (index.length !== n) throw new Error(`${dir}/fuel.u8: ${index.length} cells, grid has ${n}`)
  const fuelClass = new Uint8Array(n)
  const fuelCode = new Uint16Array(n)
  for (let i = 0; i < n; i++) {
    const entry = fuel.legend[index[i]]
    fuelClass[i] = entry.class
    fuelCode[i] = entry.scottBurgan
  }
  const { sw, se, ne, nw } = meta.wgs84
  return {
    ...meta,
    classes: fuel.classes,
    fuelClass,
    fuelCode,
    slope: new Uint8Array(slopeBytes),
    aspect: new Uint16Array(aspectBytes),
    rect: {
      west: (sw[0] + nw[0]) / 2,
      south: (sw[1] + se[1]) / 2,
      east: (se[0] + ne[0]) / 2,
      north: (nw[1] + ne[1]) / 2,
    },
  }
}

/** Column and row of a PT-TM06 point; may fall outside the grid. */
export function cellOfXY(grid: Grid, x: number, y: number): { col: number; row: number } {
  return {
    col: Math.floor((x - grid.xmin) / grid.cellsize),
    row: grid.rows - 1 - Math.floor((y - grid.ymin) / grid.cellsize),
  }
}

/** Cell index of a point, or -1 outside the grid. */
export function cellOf(grid: Grid, p: LonLat): number {
  const { x, y } = toPTTM06(p)
  const { col, row } = cellOfXY(grid, x, y)
  return col < 0 || row < 0 || col >= grid.cols || row >= grid.rows ? -1 : row * grid.cols + col
}

/** Centre of a cell, PT-TM06 metres. */
export function centerXY(grid: Grid, i: number): { x: number; y: number } {
  const col = i % grid.cols
  const row = (i - col) / grid.cols
  return {
    x: grid.xmin + (col + 0.5) * grid.cellsize,
    y: grid.ymin + (grid.rows - row - 0.5) * grid.cellsize,
  }
}

export const cellHa = (grid: Grid) => (grid.cellsize * grid.cellsize) / 10_000

/**
 * WGS84 position of a point of the grid in pixel coordinates (column and row, fractional, from the
 * north-west corner), through `rect`: the same linear mapping the grid's images use on the terrain,
 * so lines drawn with it sit on the pixels they describe.
 */
export function lonLatAt(grid: Grid, col: number, row: number): LonLat {
  const { west, south, east, north } = grid.rect
  return { lon: west + (col / grid.cols) * (east - west), lat: north - (row / grid.rows) * (north - south) }
}
