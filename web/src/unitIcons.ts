// Vector symbols stay sharp at any display scale and do not depend on the OS emoji font.
import type { UnitId } from './suppression'

const SYMBOL: Record<UnitId, string> = {
  vfci: '<path d="M6 10h8v8H6zM14 13h4l3 3v2h-7M8 7h10M10 7v3M14 7v3"/><circle cx="9" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>',
  vttu: '<path d="M12 3C10 7 5 11 5 15a7 7 0 0 0 14 0c0-4-5-8-7-12Z"/><path d="M8 15a4 4 0 0 0 4 4"/>',
  crew: '<circle cx="9" cy="5" r="2"/><path d="M9 8v7l-4 6M9 15l5 6M5 12l4-4 5 4M18 4v13M16 17h4v4h-4z"/>',
  hebl: '<path d="M3 5h18M12 5v5M9 10h6l4 4v3H7l-3-5H2M8 20h12M10 17v3M17 17v3M15 11v4h4"/>',
  avbp: '<path d="m12 2 2 7 7 5v2l-7-2v5l3 2v1l-5-1-5 1v-1l3-2v-5l-7 2v-2l7-5 2-7Z"/>',
}
const INK: Record<UnitId, string> = { vfci: '#b91c1c', vttu: '#0369a1', crew: '#92400e', hebl: '#047857', avbp: '#4338ca' }
const urls = new Map<string, string>()

export function unitIconUrl(unit: UnitId, ring = INK[unit]): string {
  const key = `${unit}|${ring}`
  let url = urls.get(key)
  if (!url) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#f8fafc" stroke="#111827" stroke-width="2"/><circle cx="24" cy="24" r="19.5" fill="none" stroke="${ring}" stroke-width="4"/><g transform="translate(11 11) scale(1.08)" fill="none" stroke="${INK[unit]}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${SYMBOL[unit]}</g></svg>`
    url = `data:image/svg+xml,${encodeURIComponent(svg)}`
    urls.set(key, url)
  }
  return url
}
