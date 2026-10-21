export interface AirBase {
  id: string
  name: string
  short: string
  operator: string
  type: 'cma' | 'aerodrome' | 'military'
  lon: number
  lat: number
  units: Record<string, number>
  aircraftModel: string
}

/**
 * Centros de Meios Aéreos (CMA), Aeródromos e Bases Aéreas com meios de combate a incêndios
 * afetos ao DECIR / Força Aérea Portuguesa / ANEPC com cobertura à região Norte e Centro de Portugal.
 */
export const AIR_BASES: AirBase[] = [
  // --- Helicópteros Bombardeiros Ligeiros / Médios (CMA) ---
  {
    id: 'cma-braga',
    name: 'CMA Braga (Aeródromo de Palmeira)',
    short: 'CMA Braga (Palmeira)',
    operator: 'ANEPC / Operador Privado',
    type: 'cma',
    lat: 41.5869,
    lon: -8.4447,
    units: { hebl: 1 },
    aircraftModel: 'AS350 Écureuil (Balde 900 L)',
  },
  {
    id: 'cma-fafe',
    name: 'CMA Fafe',
    short: 'CMA Fafe',
    operator: 'ANEPC / Operador Privado',
    type: 'cma',
    lat: 41.45,
    lon: -8.17,
    units: { hebl: 1 },
    aircraftModel: 'Bell 407 (Balde 900 L)',
  },
  {
    id: 'cma-baltar',
    name: 'CMA Baltar (Paredes)',
    short: 'CMA Baltar',
    operator: 'ANEPC / Operador Privado',
    type: 'cma',
    lat: 41.1969,
    lon: -8.3881,
    units: { hebl: 1 },
    aircraftModel: 'AS350 Écureuil (Balde 900 L)',
  },
  {
    id: 'cma-arcos',
    name: 'CMA Arcos de Valdevez',
    short: 'CMA Arcos Valdevez',
    operator: 'ANEPC / Operador Privado',
    type: 'cma',
    lat: 41.8469,
    lon: -8.4181,
    units: { hebl: 1 },
    aircraftModel: 'AS350 Écureuil (Balde 900 L)',
  },
  {
    id: 'ba8-ovar',
    name: 'Base Aérea N.º 8 (Ovar - Maceda)',
    short: 'BA8 Ovar (FAP)',
    operator: 'Força Aérea Portuguesa (Esquadra 551)',
    type: 'military',
    lat: 40.9158,
    lon: -8.6472,
    units: { hebl: 2 },
    aircraftModel: 'UH-60 Black Hawk (Balde 2600 L)',
  },

  // --- Aviões Bombardeiros Anfíbios Médios / Pesados ---
  {
    id: 'aero-vilareal',
    name: 'Aeródromo Municipal de Vila Real',
    short: 'Aeródromo Vila Real',
    operator: 'ANEPC / Operador Privado',
    type: 'aerodrome',
    lat: 41.2742,
    lon: -7.7208,
    units: { avbp: 2 },
    aircraftModel: 'AT-802 Fireboss Anfíbio (3100 L)',
  },
  {
    id: 'aero-viseu',
    name: 'Aeródromo de Viseu (Gonçalves Lobato)',
    short: 'Aeródromo Viseu',
    operator: 'ANEPC / Operador Privado',
    type: 'aerodrome',
    lat: 40.7256,
    lon: -7.8894,
    units: { avbp: 2 },
    aircraftModel: 'AT-802 Fireboss Anfíbio (3100 L)',
  },
  {
    id: 'aero-castelobranco',
    name: 'Aeródromo de Castelo Branco',
    short: 'Aeródromo Castelo Branco',
    operator: 'ANEPC / Proteção Civil',
    type: 'aerodrome',
    lat: 39.8519,
    lon: -7.4328,
    units: { avbp: 2 },
    aircraftModel: 'Canadair CL-215/415 Anfíbio (5500 L)',
  },
  {
    id: 'aero-pontesor',
    name: 'Aeródromo Municipal de Ponte de Sor',
    short: 'Aeródromo Ponte de Sor',
    operator: 'ANEPC / Operador Privado',
    type: 'aerodrome',
    lat: 39.2125,
    lon: -8.0531,
    units: { avbp: 2 },
    aircraftModel: 'AT-802 Fireboss Anfíbio (3100 L)',
  },
]

export function findAirBase(id: string | undefined): AirBase | undefined {
  if (!id) return undefined
  return AIR_BASES.find((b) => b.id === id)
}

export function airBasesForUnit(unitId: string): AirBase[] {
  return AIR_BASES.filter((b) => (b.units[unitId] ?? 0) > 0)
}
