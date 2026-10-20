// How numbers, times and distances are written on screen (pt-PT; the HUD upper-cases them).

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const one = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const upToOne = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 })
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The fire's wall clock `hours` after `start` ("YYYY-MM-DDTHH:MM", local time as published).
 * Kept as a UTC Date so the arithmetic never meets a daylight-saving jump; read it with getUTC*.
 */
export function wallClock(start: string, hours: number): Date {
  const [y, mo, d, h, mi] = start.split(/[-T:]/).map(Number)
  return new Date(Date.UTC(y, mo - 1, d, h, mi) + Math.round(hours * 60) * 60_000)
}

export const fmtDate = (t: Date) => `${pad(t.getUTCDate())} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`
export const fmtTime = (t: Date) => `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`

/** "T+05:30" */
export function fmtElapsed(hours: number): string {
  const minutes = Math.max(0, Math.round(hours * 60))
  return `T+${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

export const fmtHa = (ha: number) => `${one.format(ha)} ha`
export const fmtHours = (hours: number) => `${upToOne.format(hours)} h`
export const fmtNumber = (n: number, digits = 0) => (digits ? one : whole).format(n)

/** Straight-line distances: one decimal under 10 km, whole kilometres above. */
export const fmtKm = (km: number) => `${(km < 10 ? upToOne : whole).format(km)} km`

/** Camera range: metres up close, kilometres further out. */
/** A probability as a percentage; under half a percent it reads "< 1 %", never a flat zero. */
export const fmtPct = (p: number) => (p < 0.005 ? '< 1 %' : `${Math.round(p * 100)} %`)
export const fmtRange = (m: number) => (m < 1000 ? `${whole.format(m)} m` : `${upToOne.format(m / 1000)} km`)
