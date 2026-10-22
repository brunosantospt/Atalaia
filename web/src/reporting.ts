// Multi-Agency Reporting & Dispatch System (SIOPS / Proteção Civil, PSP/GNR, INEM).
//
// Role-based operational picture:
//  - 'cmd': Proteção Civil & Comando de Bombeiros (master tactical twin with all decision tools)
//  - 'psp': Forças de Segurança & Trânsito (cut-order list, traffic barricades, evacuation perimeters)
//  - 'inem': Emergência Médica (Advanced Medical Post / PMA, triage, safe ambulance evacuation corridors)

import type { Run } from './scenario'
import { fmtKm, fmtTime, wallClock } from './format'
import { distanceM, toPTTM06, type LonLat } from './geo'
import type { Grid } from './grid'
import type { Context, Place, Road, RoadClass } from './osm'

export type AgencyRole = 'cmd' | 'psp' | 'inem'

export interface RoadCutItem {
  id: number
  label: string
  cls: RoadClass
  firstArrivalMin: number
  minutesToImpact: number // firstArrivalMin - currentMinutes
  urgency: 'cortado' | 'urgente' | 'preventivo'
  coord: LonLat
  pts: [number, number][]
  isPaved: boolean
}

export interface MedicalPointItem {
  id: string
  name: string
  kind: 'pma' | 'zcv' | 'triagem'
  location: LonLat
  safeBufferMin: number // minutes until fire can reach within 1.5 km
  hospitalDestination: string
  ambulanceRoute?: LonLat[]
  routeKm?: number
  etaMin?: number
}

export interface MultiAgencyDispatch {
  timestamp: string
  fireName: string
  currentMin: number
  wallClock: string
  psp: {
    title: string
    roads: RoadCutItem[]
    cordonM: number
    message: string
  }
  inem: {
    title: string
    pmaList: MedicalPointItem[]
    blockedRoads: string[]
    hospital: string
    message: string
  }
  cmd: {
    summary: string
    totalThreatenedRoads: number
    pmaCount: number
    message: string
  }
}

/** Default regional hospital destination for emergency medical evacuations. */
export const DEFAULT_HOSPITAL: { name: string; location: LonLat } = {
  name: 'Hospital da Senhora da Oliveira (Guimarães)',
  location: { lon: -8.2917, lat: 41.4398 },
}

/**
 * Produces an informative, real-world label for a road:
 * - If official name & ref exist: e.g. "EN 205 (Rua Central)" or "EM 599 (Rua da Castanheira)"
 * - If only name or ref: e.g. "Rua do Cruzeiro" or "EN 304"
 * - If unnamed in OSM: contextualizes with the nearest place/village from osm.places:
 *   e.g. "Caminho Florestal (Lugar de Mós)" or "Estrada Municipal (direção Felgueiras)"
 */
export function getSmartRoadLabel(r: Road, places: Place[] = []): string {
  if (r.name && r.ref) return `${r.ref} (${r.name})`
  if (r.name) return r.name
  if (r.ref) {
    const type = r.ref.startsWith('EN')
      ? 'Estrada Nacional'
      : r.ref.startsWith('EM')
        ? 'Estrada Municipal'
        : r.ref.startsWith('CM')
          ? 'Caminho Municipal'
          : r.ref.startsWith('IC') || r.ref.startsWith('IP')
            ? 'Itinerário'
            : 'Via'
    return `${r.ref} (${type})`
  }

  // Unnamed road: resolve nearest place from pts
  if (places && places.length > 0 && r.pts.length > 0) {
    const midIdx = Math.floor(r.pts.length / 2)
    const pt: LonLat = { lon: r.pts[midIdx][0], lat: r.pts[midIdx][1] }
    let nearest: Place | null = null
    let minD = Infinity

    for (const pl of places) {
      const d = distanceM(pt, pl)
      if (d < minD) {
        minD = d
        nearest = pl
      }
    }

    const baseKind =
      r.cls === 'paved' ? 'Estrada Municipal' : r.cls === 'track' ? 'Caminho Florestal' : 'Trilho Rural'

    if (nearest) {
      if (minD < 500) return `${baseKind} (${nearest.name})`
      return `${baseKind} (direção ${nearest.name})`
    }
    return baseKind
  }

  return r.cls === 'paved' ? 'Estrada Municipal' : r.cls === 'track' ? 'Caminho Florestal' : 'Trilho Rural'
}

/**
 * Finds the exact coordinate on the road polyline closest to the fire arrival cell.
 */
function findRoadCutCoordinate(r: Road, grid: Grid, hitCell: number): LonLat {
  if (!r.pts.length) return { lon: 0, lat: 0 }
  const col = hitCell % grid.cols
  const row = (hitCell - col) / grid.cols
  const targetX = grid.xmin + (col + 0.5) * grid.cellsize
  const targetY = grid.ymin + (grid.rows - row - 0.5) * grid.cellsize

  let best = r.pts[0]
  let bestD = Infinity

  for (const pt of r.pts) {
    const { x, y } = toPTTM06({ lon: pt[0], lat: pt[1] })
    const d = Math.hypot(x - targetX, y - targetY)
    if (d < bestD) {
      bestD = d
      best = pt
    }
  }

  return { lon: best[0], lat: best[1] }
}

/**
 * Detects all road segments threatened or intersected by the active fire spread within `horizonMin`.
 * Prioritizes paved highways and roads with official names/references for police traffic orders.
 */
export function detectThreatenedRoads(
  grid: Grid,
  context: Context,
  run: Run,
  currentMin: number,
  horizonMin = 90,
): RoadCutItem[] {
  const { arrival } = run
  const byLabel = new Map<string, RoadCutItem>()
  const places = context.osm.places

  for (const { road, cells: rc } of context.roadCells) {
    let minT = Infinity
    let hitCell = -1

    for (let k = 0; k < rc.length; k++) {
      const cell = rc[k]
      const t = arrival[cell]
      if (t < minT) {
        minT = t
        hitCell = cell
      }
    }

    if (minT <= currentMin + horizonMin && hitCell >= 0) {
      const r: Road = context.osm.roads[road]
      const label = getSmartRoadLabel(r, places)
      const minutesToImpact = Math.round(minT - currentMin)

      let urgency: 'cortado' | 'urgente' | 'preventivo' = 'preventivo'
      if (minutesToImpact <= 0) urgency = 'cortado'
      else if (minutesToImpact <= 25) urgency = 'urgente'

      const coord = findRoadCutCoordinate(r, grid, hitCell)
      const isPaved = r.cls === 'paved' || !!r.name || !!r.ref

      const existing = byLabel.get(label)
      if (!existing || minT < existing.firstArrivalMin) {
        byLabel.set(label, {
          id: road,
          label,
          cls: r.cls,
          firstArrivalMin: minT,
          minutesToImpact,
          urgency,
          coord,
          pts: r.pts,
          isPaved,
        })
      }
    }
  }

  // Sort: 1) Urgency (cortado/urgente first), 2) Paved/Named roads first, 3) Arrival time
  return [...byLabel.values()].sort((a, b) => {
    // Paved/classified roads get higher priority for traffic police
    if (a.isPaved !== b.isPaved) return a.isPaved ? -1 : 1
    return a.firstArrivalMin - b.firstArrivalMin
  })
}

/** Calculates safety buffer (minutes) of a proposed Medical Point relative to fire perimeter. */
export function evaluateMedicalPointSafety(
  grid: Grid,
  arrival: Float32Array,
  point: LonLat,
  radiusM = 1200,
): number {
  const col = Math.floor((point.lon - grid.rect.west) / ((grid.rect.east - grid.rect.west) / grid.cols))
  const row = Math.floor((grid.rect.north - point.lat) / ((grid.rect.north - grid.rect.south) / grid.rows))
  const span = Math.ceil(radiusM / grid.cellsize)

  let minArrival = Infinity
  for (let r = Math.max(0, row - span); r <= Math.min(grid.rows - 1, row + span); r++) {
    for (let c = Math.max(0, col - span); c <= Math.min(grid.cols - 1, col + span); c++) {
      const idx = r * grid.cols + c
      if (arrival[idx] < minArrival) minArrival = arrival[idx]
    }
  }

  return minArrival === Infinity ? 999 : Math.round(minArrival)
}

/** Formats the copyable direct operational dispatch for PSP / GNR Traffic Division. */
export function formatPSPDispatch(
  fireName: string,
  wallClockStr: string,
  currentMin: number,
  roads: RoadCutItem[],
): string {
  const lines: string[] = []
  lines.push(`🚨 [DESPACHO OPERACIONAL - PSP / GNR TRÂNSITO]`)
  lines.push(`INCÊNDIO: ${fireName.toUpperCase()}`)
  lines.push(`HORA EMISSÃO: ${wallClockStr} (T+${currentMin} min)`)
  lines.push(`EMITIDO POR: Posto de Comando Municipal / Proteção Civil & COS`)
  lines.push(``)
  lines.push(`AÇÃO PRIORITÁRIA: CORTE IMEDIATO DE VIAS E DESVIOS DE TRÂNSITO`)
  lines.push(`Perímetro de segurança recomendado: 500m barramento geral, 1200m a sotavento.`)
  lines.push(``)

  if (!roads.length) {
    lines.push(`✅ Nenhuma via principal cortada ou ameaçada nos próximos 60 min. Manter patrulhamento preventivo.`)
  } else {
    lines.push(`VIAS PRIORITÁRIAS A INTERDITAR:`)
    roads.forEach((r, idx) => {
      let tag = '[CORTE PREVENTIVO]'
      if (r.urgency === 'cortado') tag = '⛔ [INTERDITADA - FOGO NA VIA]'
      else if (r.urgency === 'urgente') tag = '⚠️ [URGENTE - IMPACTO < 25 MIN]'

      const tempo = r.minutesToImpact <= 0 ? 'Já atingida pelo fogo' : `Impacto em ~${r.minutesToImpact} min`
      lines.push(`${idx + 1}. ${tag} ${r.label}`)
      lines.push(`   Tipo: ${r.cls.toUpperCase()} | Previsão: ${tempo} | GPS: ${r.coord.lat.toFixed(5)}, ${r.coord.lon.toFixed(5)}`)
    })
  }

  lines.push(``)
  lines.push(`Canal de Coordenação Rádio: SIRESP Sub-Grupo Proteção Civil 04.`)
  return lines.join('\n')
}

/** Formats the copyable direct operational dispatch for INEM (Medical Response & Evacuation). */
export function formatINEMDispatch(
  fireName: string,
  wallClockStr: string,
  currentMin: number,
  pmaList: MedicalPointItem[],
  blockedRoadLabels: string[],
): string {
  const lines: string[] = []
  lines.push(`🚑 [DESPACHO OPERACIONAL - INEM / SAÚDE & EVACUAÇÃO]`)
  lines.push(`INCÊNDIO: ${fireName.toUpperCase()}`)
  lines.push(`HORA EMISSÃO: ${wallClockStr} (T+${currentMin} min)`)
  lines.push(`EMITIDO POR: Posto de Comando Municipal / Proteção Civil & COS`)
  lines.push(``)
  lines.push(`AÇÃO: ESTABELECIMENTO DE POSTO MÉDICO AVANÇADO (PMA) E CORREDORES DE SOCORRO`)
  lines.push(``)

  if (!pmaList.length) {
    lines.push(`Nenhum PMA ativado no momento. Ambulâncias em prevenção na base de apoio.`)
  } else {
    lines.push(`PONTOS DE ATUAÇÃO MÉDICA / PMA ATIVOS:`)
    pmaList.forEach((p, idx) => {
      const bufferDesc = p.safeBufferMin > 180 ? '> 3 horas' : `${p.safeBufferMin} min`
      lines.push(`${idx + 1}. 🏥 ${p.name.toUpperCase()} (${p.kind.toUpperCase()})`)
      lines.push(`   Coordenadas GPS: ${p.location.lat.toFixed(5)}, ${p.location.lon.toFixed(5)}`)
      lines.push(`   Margem de segurança ao fogo: ${bufferDesc}`)
      if (p.routeKm) {
        lines.push(`   Corredor de Evacuação: ${p.hospitalDestination} (${fmtKm(p.routeKm)}, ETA ~${p.etaMin} min)`)
      }
    })
  }

  lines.push(``)
  lines.push(`⚠️ ESTRADAS VEDADAS À PASSAGEM DE AMBULÂNCIAS (Chamas / Fumo Denso):`)
  if (!blockedRoadLabels.length) {
    lines.push(`- Redes viárias principais desimpedidas.`)
  } else {
    blockedRoadLabels.slice(0, 6).forEach((lbl) => lines.push(`- ⛔ ${lbl} (Interditada)`))
  }

  lines.push(``)
  lines.push(`Hospital de Retaguarda: ${DEFAULT_HOSPITAL.name}`)
  lines.push(`Canal de Coordenação Saúde: CODU / Linha de Apoio Direto Proteção Civil.`)
  return lines.join('\n')
}

/** Generates the complete multi-agency dispatch packet. */
export function buildMultiAgencyDispatch(
  fireName: string,
  startTime: string,
  currentMin: number,
  grid: Grid,
  context: Context | undefined,
  run: Run,
  pmaList: MedicalPointItem[],
): MultiAgencyDispatch {
  const clock = fmtTime(wallClock(startTime, currentMin / 60))
  const roads = context ? detectThreatenedRoads(grid, context, run, currentMin) : []
  const blockedLabels = roads.map((r) => r.label)

  const pspMessage = formatPSPDispatch(fireName, clock, currentMin, roads)
  const inemMessage = formatINEMDispatch(fireName, clock, currentMin, pmaList, blockedLabels)

  const cmdSummary =
    `Despacho emitido às ${clock}: ${roads.length} vias sinalizadas para corte pela PSP; ` +
    `${pmaList.length} pontos de socorro / PMA sob vigilância do INEM.`

  return {
    timestamp: new Date().toISOString(),
    fireName,
    currentMin,
    wallClock: clock,
    psp: {
      title: 'Forças de Segurança (PSP / GNR) - Controlo de Vias',
      roads,
      cordonM: 500,
      message: pspMessage,
    },
    inem: {
      title: 'Emergência Médica (INEM) - Postos de Socorro & Evacuação',
      pmaList,
      blockedRoads: blockedLabels,
      hospital: DEFAULT_HOSPITAL.name,
      message: inemMessage,
    },
    cmd: {
      summary: cmdSummary,
      totalThreatenedRoads: roads.length,
      pmaCount: pmaList.length,
      message: `${pspMessage}\n\n====================\n\n${inemMessage}`,
    },
  }
}
