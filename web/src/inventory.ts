// What each station has (public/inventory.json, scripts/build_inventory.py): people on duty and
// vehicles by kind, from the INE personnel per municipality and a tier. In the Braga district the
// vehicles are listed one by one from Table 41 of Matos (2025), and the counts by kind follow them.

import { fmtNumber } from './format'

export interface Vehicle {
  id: string // its letter in Table 41
  capacityL: number
  kind: string // vlci, vfci or vttu, inferred from the litres
}

export interface StationStock {
  tier: string
  source: string
  municipality: string
  personnel: { total: number; onDuty: number }
  units: Record<string, number> // vfci, vttu, vlci, vrci
  decir: { ecin: number; eip: number }
  vehicles?: Vehicle[]
}

/** By station id (data.ts); `_meta` is left out. */
export type Inventory = Record<string, StationStock>

export async function loadInventory(): Promise<Inventory | null> {
  try {
    const response = await fetch('/inventory.json')
    if (!response.ok) return null
    const raw = (await response.json()) as Record<string, unknown>
    delete raw._meta
    return raw as Inventory
  } catch {
    return null
  }
}

/** Where the station's vehicles come from: the thesis where they are listed, the tier estimate elsewhere. */
export const stockSource = (stock: StationStock) => (stock.vehicles ? 'Matos 2025 · tab. 41' : 'INE 2024 · estimado')

/** "5 viaturas · 9 500 L" for listed vehicles, null for an estimate. */
export function fleet(stock: StationStock): string | null {
  if (!stock.vehicles) return null
  const litres = stock.vehicles.reduce((sum, v) => sum + v.capacityL, 0)
  return `${stock.vehicles.length} ${stock.vehicles.length === 1 ? 'viatura' : 'viaturas'} · ${fmtNumber(litres)} L`
}
