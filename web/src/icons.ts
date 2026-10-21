/**
 * Neutral tactical SVG icon system for command, safety, health, and hazard overlays.
 * High-contrast, clean 24x24 viewBox designed for tactical dark mode GIS interfaces.
 */

export const ICON_HAZARD = `
<svg class="tactical-icon icon-hazard" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor">
  <path d="M12 2.8L22 20.2H2L12 2.8Z" stroke-width="1.8" stroke-linejoin="round"/>
  <line x1="12" y1="8.5" x2="12" y2="13.5" stroke-width="2" stroke-linecap="round"/>
  <circle cx="12" cy="17" r="1.2" fill="currentColor" stroke="none"/>
</svg>`.trim()

export const ICON_PROTECAO_CIVIL = `
<svg class="tactical-icon icon-civil-protection" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor">
  <circle cx="12" cy="12" r="9.5" stroke-width="1.5"/>
  <polygon points="12,6.2 18,17 6,17" stroke-width="1.5" stroke-linejoin="round" fill="currentColor" fill-opacity="0.12"/>
  <circle cx="12" cy="12.5" r="1.3" fill="currentColor" stroke="none"/>
</svg>`.trim()

export const ICON_PSP = `
<svg class="tactical-icon icon-psp" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor">
  <path d="M12 2.8L4.5 5.8V11.8C4.5 16.8 7.8 20.9 12 22.2C16.2 20.9 19.5 16.8 19.5 11.8V5.8L12 2.8Z" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M12 7V17M7 12H17M8.5 8.5L15.5 15.5M8.5 15.5L15.5 8.5" stroke-width="1.3" stroke-linecap="round"/>
</svg>`.trim()

export const ICON_INEM = `
<svg class="tactical-icon icon-inem" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor">
  <circle cx="12" cy="12" r="9.5" stroke-width="1.4" stroke-dasharray="2 1.5"/>
  <path d="M9 4H15V9H20V15H15V20H9V15H4V9H9V4Z" stroke-width="1.5" stroke-linejoin="round" fill="currentColor" fill-opacity="0.2"/>
</svg>`.trim()

export const ICON_CLIPBOARD = `
<svg class="tactical-icon icon-clipboard" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
  <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
</svg>`.trim()

export const ICON_ROAD_CUT = `
<svg class="tactical-icon icon-road-cut" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor">
  <circle cx="12" cy="12" r="9.5" stroke-width="1.8"/>
  <rect x="5.5" y="10.2" width="13" height="3.6" rx="0.8" fill="currentColor" stroke="none"/>
</svg>`.trim()

export const ICON_PMA = `
<svg class="tactical-icon icon-pma" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor">
  <rect x="3" y="3" width="18" height="18" rx="3" stroke-width="1.5"/>
  <path d="M12 7V17M7 12H17" stroke-width="2.4" stroke-linecap="round"/>
</svg>`.trim()

export const ICON_CHECK = `
<svg class="tactical-icon icon-check" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="20 6 9 17 4 12"/>
</svg>`.trim()

export const ICON_SHIELD = `
<svg class="tactical-icon icon-shield" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
</svg>`.trim()

export const ICON_BOLT = `
<svg class="tactical-icon icon-bolt" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
</svg>`.trim()
