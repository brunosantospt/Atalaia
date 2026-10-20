// What each station is estimated to have (public/inventory.json, scripts/build_inventory.py):
// people on duty and vehicles by kind, from the INE personnel per municipality and a tier.

export interface StationStock {
  tier: string
  source: string
  municipality: string
  personnel: { total: number; onDuty: number }
  units: Record<string, number> // vfci, vttu, vlci, vrci
  decir: { ecin: number; eip: number }
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
