// What scripts/build_fires.py and scripts/build_stations.py write into public/, and how it is read.

import { distanceM, type BBox, type LonLat } from './geo'

export interface FireIndexEntry extends LonLat {
  id: string
  name: string
  start: string
  areaHa: number
}

export interface Step {
  step: number
  time: string // local time as published, "YYYY-MM-DDTHH:MM"
  hours: number // since the first step
  areaHa: number // burned so far
  addedHa: number // burned in this step
  period: number | null // L3 burn period, null for the ignition
  center: LonLat // centre of the new area
  bbox: BBox // of the perimeter so far
}

export interface Ignition extends LonLat {
  time: string
  hours: number
  chain: number
  areaHa: number
}

/** PT-FireSprd L3: one row per burn period; null where the dataset has no value. */
export interface Period {
  period: number
  start: string | null
  end: string | null
  durationH: number | null
  areaHa: number | null
  growthHaPerH: number | null
  rosMPerH: number | null
  maxRosMPerH: number | null
  spreadTowardDeg: number | null
  intensityKWPerM: number | null
}

export interface Fire {
  id: string
  name: string
  parish: string
  incidentId: string | null
  timeZone: string
  start: string
  end: string
  ignition: LonLat
  ignitions: Ignition[]
  bbox: BBox
  areaHa: { timed: number; untimed: number; total: number }
  steps: Step[]
  periods: Period[]
  source: Record<string, string>
}

export type Ring = [number, number][]

/** Polygons as rings of [lon, lat]: the first ring is the outline, the rest are unburned islands. */
export interface Progression {
  perimeters: Ring[][][] // per step
  increments: Ring[][][] // per step
  untimed: Ring[][]
}

export type StationKind = 'volunteer' | 'municipal' | 'professional' | 'private'

export interface Station extends LonLat {
  id: string // OSM "way/123"
  name: string
  short: string // "BV Cabeceirenses"
  kind: StationKind
  place: string | null
  section: string | null
}

export interface NearStation extends Station {
  km: number
}

async function getJSON<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return response.json() as Promise<T>
}

export const loadFireIndex = () => getJSON<FireIndexEntry[]>('/fires/index.json')
export const loadFire = (id: string) => getJSON<Fire>(`/fires/${id}/fire.json`)
export const loadStations = () => getJSON<{ stations: Station[] }>('/stations.json').then((d) => d.stations)

interface Feature {
  properties: { kind: 'perimeter' | 'increment' | 'untimed'; step?: number }
  geometry: { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }
}

export async function loadProgression(id: string): Promise<Progression> {
  const { features } = await getJSON<{ features: Feature[] }>(`/fires/${id}/progression.geojson`)
  const out: Progression = { perimeters: [], increments: [], untimed: [] }
  for (const f of features) {
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    const { kind, step } = f.properties
    if (kind === 'untimed') out.untimed = polygons
    else (kind === 'perimeter' ? out.perimeters : out.increments)[step!] = polygons
  }
  return out
}

/** The closest stations to a point, straight line, at most `count` and within `maxKm`. */
export function nearestStations(stations: Station[], from: LonLat, count = 3, maxKm = 20): NearStation[] {
  return stations
    .map((s) => ({ ...s, km: distanceM(from, s) / 1000 }))
    .filter((s) => s.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, count)
}
