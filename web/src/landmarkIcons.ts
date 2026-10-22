export type LandmarkSymbol = 'helmet' | 'cross' | 'flame' | 'helipad' | 'airplane'
export const landmarkColor = (symbol: LandmarkSymbol) => ({ helmet: '#dc4046', cross: '#16875c', flame: '#e87916', helipad: '#087fae', airplane: '#087fae' })[symbol]
const paths: Record<LandmarkSymbol, string> = {
  helmet: '<path d="M4 15v-3a8 8 0 0 1 16 0v3M3 15h18v3H3zM10 4v8M14 4v8M7 18v3h10v-3"/>',
  cross: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  flame: '<path d="M13 2c1 6-4 7-2 11 2-1 3-3 3-5 4 3 7 6 5 11-2 5-12 4-14-1C2 11 10 9 13 2Z"/>',
  helipad: '<circle cx="12" cy="12" r="10"/><path d="M8 6v12M16 6v12M8 12h8"/>',
  airplane: '<path d="m12 2 2 7 7 5v2l-7-2v5l3 2v1l-5-1-5 1v-1l3-2v-5l-7 2v-2l7-5 2-7Z"/>',
}
export const landmarkGlyph = (symbol: LandmarkSymbol) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[symbol]}</svg>`
export function landmarkIconUrl(symbol: LandmarkSymbol, color: string) {
  const glyph = landmarkGlyph(symbol).replace('<svg ', `<svg x="9" y="9" width="22" height="22" style="color:${color}" `)
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="#f8fafc" stroke="${color}" stroke-width="3"/>${glyph}</svg>`)}`
}
