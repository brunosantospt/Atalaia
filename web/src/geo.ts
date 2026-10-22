// Small geodesy helpers: distances, bearings, boxes, PT-TM06 and how coordinates are written on the HUD.

export interface LonLat {
  lon: number
  lat: number
}

/** [west, south, east, north] in degrees. */
export type BBox = [number, number, number, number]

const EARTH_RADIUS_M = 6_371_000
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

export function distanceM(a: LonLat, b: LonLat): number {
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const dLon = rad(b.lon - a.lon)
  const y = Math.sin(dLon) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon)
  return (deg(Math.atan2(y, x)) + 360) % 360
}

export function lerpLonLat(a: LonLat, b: LonLat, t: number): LonLat {
  return { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t }
}

export function bboxOf(points: LonLat[], boxes: BBox[] = []): BBox {
  const box: BBox = [Infinity, Infinity, -Infinity, -Infinity]
  for (const p of points) {
    box[0] = Math.min(box[0], p.lon)
    box[1] = Math.min(box[1], p.lat)
    box[2] = Math.max(box[2], p.lon)
    box[3] = Math.max(box[3], p.lat)
  }
  for (const b of boxes) {
    box[0] = Math.min(box[0], b[0])
    box[1] = Math.min(box[1], b[1])
    box[2] = Math.max(box[2], b[2])
    box[3] = Math.max(box[3], b[3])
  }
  return box
}

export function bboxCenter(b: BBox): LonLat {
  return { lon: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 }
}

/** Half the diagonal of a box, in metres. */
export function bboxRadiusM(b: BBox): number {
  return distanceM({ lon: b[0], lat: b[1] }, { lon: b[2], lat: b[3] }) / 2
}

// ---------- PT-TM06 / ETRS89 (EPSG:3763) ----------
// Transverse Mercator on GRS80, origin at the Melriça vertex, no false easting or northing.

const A = 6_378_137
const F = 1 / 298.257222101
const E2 = F * (2 - F)
const EP2 = E2 / (1 - E2)
const LAT0 = rad(39 + 40 / 60 + 5.73 / 3600)
const LON0 = rad(-(8 + 7 / 60 + 59.19 / 3600))

/** Length of the meridian from the equator to latitude phi (Snyder 3-21). */
function meridianArc(phi: number): number {
  const e4 = E2 * E2
  const e6 = e4 * E2
  return (
    A *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi))
  )
}

const M0 = meridianArc(LAT0)

/** WGS84/ETRS89 degrees → PT-TM06 metres (x east, y north). Good to millimetres over mainland Portugal. */
export function toPTTM06(p: LonLat): { x: number; y: number } {
  const phi = rad(p.lat)
  const sin = Math.sin(phi)
  const cos = Math.cos(phi)
  const n = A / Math.sqrt(1 - E2 * sin * sin)
  const t = Math.tan(phi) ** 2
  const c = EP2 * cos * cos
  const a = cos * (rad(p.lon) - LON0)
  const x = n * (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120)
  const y =
    meridianArc(phi) -
    M0 +
    n *
      Math.tan(phi) *
      (a ** 2 / 2 + ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24 + ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720)
  return { x, y }
}

// ---------- formatting ----------

function dms(value: number, positive: string, negative: string): string {
  const abs = Math.abs(value)
  let d = Math.floor(abs)
  let m = Math.floor((abs - d) * 60)
  let s = Math.round(((abs - d) * 60 - m) * 600) / 10
  if (s >= 60) [s, m] = [0, m + 1]
  if (m >= 60) [m, d] = [0, d + 1]
  return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″${value >= 0 ? positive : negative}`
}

export function formatDMS(p: LonLat): string {
  return `${dms(p.lat, 'N', 'S')} ${dms(p.lon, 'E', 'W')}`
}

// Portuguese 16-point compass (O = oeste).
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']

export function compass(bearing: number): string {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16]
}

/** The point `distance` metres from `from` along `bearing` (great circle). */
export function destination(from: LonLat, bearing: number, distance: number): LonLat {
  const d = distance / EARTH_RADIUS_M
  const b = rad(bearing)
  const lat1 = rad(from.lat)
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b))
  const lon2 = rad(from.lon) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return { lon: deg(lon2), lat: deg(lat2) }
}

/**
 * A path safe for Cesium's ground polylines: consecutive points closer than `minM` dropped (the
 * wrap-around pair too for a loop). Empty when under 3 (loop) or 2 (line) distinct points are left.
 */
export function cleanPath<T>(pts: T[], at: (p: T) => [number, number], loop = false, minM = 0.5): T[] {
  const out: T[] = []
  const near = (a: T, b: T) => {
    const [lon1, lat1] = at(a)
    const [lon2, lat2] = at(b)
    return Math.hypot((lon2 - lon1) * 111_320 * Math.cos(rad(lat1)), (lat2 - lat1) * 110_540) < minM
  }
  for (const p of pts) if (!out.length || !near(out[out.length - 1], p)) out.push(p)
  while (loop && out.length > 1 && near(out[out.length - 1], out[0])) out.pop()
  return out.length >= (loop ? 3 : 2) ? out : []
}

export const cleanLonLat = (pts: LonLat[], loop = false) => cleanPath(pts, (p) => [p.lon, p.lat], loop)
