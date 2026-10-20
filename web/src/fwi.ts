// The Canadian Forest Fire Weather Index (FWI) System (Van Wagner 1987, Lawson & Armitage 2008),
// adapted for continuous hourly operational spread forecasting and compliant with IPMA / ANEPC
// fire danger rating standards in Portugal.
//
// Components:
//   - FFMC: Fine Fuel Moisture Code (litter and fine dead fuels, 0..101)
//   - m: Fine dead fuel moisture content in %: m = 147.2 × (101 - FFMC) / (59.5 + FFMC)
//   - DMC: Duff Moisture Code (organic layer decomposition, 5..10 cm)
//   - DC: Drought Code (deep seasonal drought index)
//   - ISI: Initial Spread Index (f(wind) × f(FFMC), direct driver of head fire spread rate)
//   - BUI: Build-Up Index (total fuel available for combustion from DMC & DC)
//   - FWI: Fire Weather Index (overall fire intensity rating)
//   - IPMA Danger Class: Reduzido, Moderado, Elevado, Muito Elevado, Máximo

import type { Weather } from './data'

export type DangerClass = 'Reduzido' | 'Moderado' | 'Elevado' | 'Muito Elevado' | 'Máximo'

export interface FWIHourly {
  time: string
  tempC: number
  rhPct: number
  windKmh: number
  precipMm: number
  fuelMoisturePct: number // fine dead fuel moisture m (%)
  ffmc: number // Fine Fuel Moisture Code (0..101)
  dmc: number // Duff Moisture Code
  dc: number // Drought Code
  isi: number // Initial Spread Index
  bui: number // Build-Up Index
  fwi: number // Fire Weather Index
  dangerClass: DangerClass
  dangerLevel: 1 | 2 | 3 | 4 | 5
  dangerColor: string
}

/** Official IPMA / ANEPC danger rating classification from FWI. */
export function ipmaDanger(fwi: number): {
  dangerClass: DangerClass
  dangerLevel: 1 | 2 | 3 | 4 | 5
  dangerColor: string
} {
  if (fwi >= 38.3) return { dangerClass: 'Máximo', dangerLevel: 5, dangerColor: '#e63946' }
  if (fwi >= 24.6) return { dangerClass: 'Muito Elevado', dangerLevel: 4, dangerColor: '#f77f00' }
  if (fwi >= 17.2) return { dangerClass: 'Elevado', dangerLevel: 3, dangerColor: '#f3c010' }
  if (fwi >= 8.5) return { dangerClass: 'Moderado', dangerLevel: 2, dangerColor: '#3a86ff' }
  return { dangerClass: 'Reduzido', dangerLevel: 1, dangerColor: '#45b058' }
}

/** Converts FFMC to fine fuel moisture content m (%). */
export function ffmcToMoisture(ffmc: number): number {
  return (147.2 * (101.0 - Math.min(100.9, Math.max(0, ffmc)))) / (59.5 + Math.min(100.9, Math.max(0, ffmc)))
}

/** Converts fine fuel moisture content m (%) back to FFMC. */
export function moistureToFFMC(m: number): number {
  const code = (59.5 * (250.0 - m)) / (147.2 + m)
  return Math.max(0, Math.min(101.0, code))
}

/** Computes the continuous hourly FWI system codes across an entire Weather series. */
export function computeFWISeries(weather: Weather): FWIHourly[] {
  const { time, tempC, rhPct, windKmh, precipMm } = weather
  const n = time.length

  // Typical summer Mediterranean antecedent conditions for spin-up
  let ffmc = 85.0
  let dmc = 40.0
  let dc = 350.0

  const series: FWIHourly[] = new Array(n)

  for (let i = 0; i < n; i++) {
    const T = tempC[i] ?? 20.0
    const H = Math.max(1.0, Math.min(100.0, rhPct[i] ?? 50.0))
    const W = Math.max(0.0, windKmh[i] ?? 10.0)
    const P = precipMm && precipMm[i] ? Math.max(0.0, precipMm[i]) : 0.0

    // 1. Hourly Fine Fuel Moisture (Van Wagner 1977, Lawson & Armitage 2008)
    let m = ffmcToMoisture(ffmc)

    // Rain wetting
    if (P > 0.1) {
      if (m <= 150.0) {
        m = m + 42.5 * P * Math.exp(-100.0 / (251.0 - m)) * (1.0 - Math.exp(-6.93 / P))
      } else {
        m =
          m +
          42.5 * P * Math.exp(-100.0 / (251.0 - m)) * (1.0 - Math.exp(-6.93 / P)) +
          0.0015 * Math.pow(m - 150.0, 2) * Math.sqrt(P)
      }
      if (m > 250.0) m = 250.0
    }

    // Equilibrium Moisture Content (EMC)
    const ed =
      0.942 * Math.pow(H, 0.679) +
      11.0 * Math.exp((H - 100.0) / 10.0) +
      0.18 * (21.1 - T) * (1.0 - Math.exp(-0.115 * H))
    const ew =
      0.618 * Math.pow(H, 0.753) +
      10.0 * Math.exp((H - 100.0) / 10.0) +
      0.18 * (21.1 - T) * (1.0 - Math.exp(-0.115 * H))

    // Drying or wetting exchange
    if (m > ed) {
      const ka =
        0.424 * (1.0 - Math.pow(H / 100.0, 1.7)) + 0.0694 * Math.sqrt(W) * (1.0 - Math.pow(H / 100.0, 8))
      const kd = ka * 0.0579 * Math.exp(0.0365 * T)
      m = ed + (m - ed) * Math.pow(10.0, -kd)
    } else if (m < ew) {
      const kb =
        0.424 * (1.0 - Math.pow((100.0 - H) / 100.0, 1.7)) +
        0.0694 * Math.sqrt(W) * (1.0 - Math.pow((100.0 - H) / 100.0, 8))
      const kw = kb * 0.0579 * Math.exp(0.0365 * T)
      m = ew - (ew - m) * Math.pow(10.0, -kw)
    }

    ffmc = moistureToFFMC(m)

    // 2. Initial Spread Index (ISI)
    const fw = Math.exp(0.05039 * W)
    const ff = 91.9 * Math.exp(-0.1386 * m) * (1.0 + Math.pow(m, 5.31) / 4.93e7)
    const isi = 0.208 * fw * ff

    // 3. Daily DMC & DC updates (at solar noon 12:00)
    const hour = parseInt(time[i]?.slice(11, 13) ?? '12', 10)
    if (hour === 12) {
      // DMC
      const re = P > 1.5 ? 0.92 * P - 1.27 : 0
      const mo = 20.0 + Math.exp(5.6348 - dmc / 43.43)
      if (re > 0) {
        const mr = mo + (1000.0 * re) / (48.77 + 0.9 * re)
        dmc = Math.max(0, 244.72 - 43.43 * Math.log(mr - 20.0))
      }
      const kDmc = 1.894 * (T + 1.1) * (100 - H) * 1e-4 * 1.39
      dmc += Math.max(0, kDmc)

      // DC
      const rd = P > 2.8 ? 0.83 * P - 1.27 : 0
      const qo = 800.0 * Math.exp(-dc / 400.0)
      if (rd > 0) {
        const qr = qo + 3.937 * rd
        dc = Math.max(0, 400.0 * Math.log(800.0 / qr))
      }
      const v = 0.5 * 1.6 + 2.0
      dc += Math.max(0, 0.36 * (T + 2.8) + v)
    }

    // 4. Build-Up Index (BUI)
    let bui = 0
    if (dmc <= 0.4 * dc) {
      bui = (0.8 * dmc * dc) / (dmc + 0.4 * dc + 1e-6)
    } else {
      bui = dmc - (1.0 - (0.8 * dc) / (dmc + 0.4 * dc + 1e-6)) * (0.92 + Math.pow(0.0114 * dmc, 1.7))
    }
    if (bui < 0) bui = 0

    // 5. Fire Weather Index (FWI)
    let b = 0
    if (bui <= 80.0) {
      b = 0.1 * isi * (0.626 * Math.pow(bui, 0.809) + 2.0)
    } else {
      b = 0.1 * isi * (1000.0 / (25.0 + 108.64 * Math.exp(-0.023 * bui)))
    }
    const fwi = b > 1.0 ? Math.exp(2.72 * Math.pow(0.434 * Math.log(b), 0.647)) : b

    const danger = ipmaDanger(fwi)

    series[i] = {
      time: time[i],
      tempC: T,
      rhPct: H,
      windKmh: W,
      precipMm: P,
      fuelMoisturePct: Math.round(m * 10) / 10,
      ffmc: Math.round(ffmc * 10) / 10,
      dmc: Math.round(dmc * 10) / 10,
      dc: Math.round(dc * 10) / 10,
      isi: Math.round(isi * 10) / 10,
      bui: Math.round(bui * 10) / 10,
      fwi: Math.round(fwi * 10) / 10,
      ...danger,
    }
  }

  return series
}

/** Interpolates the FWI values at minute `m` from the start of the fire scenario. */
export function fwiAt(series: FWIHourly[], startIndex: number, minute: number): FWIHourly {
  if (!series || series.length === 0) {
    return {
      time: '',
      tempC: 25,
      rhPct: 30,
      windKmh: 15,
      precipMm: 0,
      fuelMoisturePct: 8.5,
      ffmc: 90.0,
      dmc: 45.0,
      dc: 350.0,
      isi: 12.0,
      bui: 60.0,
      fwi: 28.0,
      dangerClass: 'Muito Elevado',
      dangerLevel: 4,
      dangerColor: '#f77f00',
    }
  }
  const h = startIndex + minute / 60
  const i = Math.min(Math.max(0, Math.floor(h)), series.length - 1)
  const j = Math.min(i + 1, series.length - 1)
  const f = h - Math.floor(h)
  const s0 = series[i]
  const s1 = series[j]

  const isi = s0.isi + (s1.isi - s0.isi) * f
  const fwi = s0.fwi + (s1.fwi - s0.fwi) * f
  const ffmc = s0.ffmc + (s1.ffmc - s0.ffmc) * f
  const m = s0.fuelMoisturePct + (s1.fuelMoisturePct - s0.fuelMoisturePct) * f

  const danger = ipmaDanger(fwi)

  return {
    time: f < 0.5 ? s0.time : s1.time,
    tempC: s0.tempC + (s1.tempC - s0.tempC) * f,
    rhPct: s0.rhPct + (s1.rhPct - s0.rhPct) * f,
    windKmh: s0.windKmh + (s1.windKmh - s0.windKmh) * f,
    precipMm: s0.precipMm + (s1.precipMm - s0.precipMm) * f,
    fuelMoisturePct: Math.round(m * 10) / 10,
    ffmc: Math.round(ffmc * 10) / 10,
    dmc: s0.dmc,
    dc: s0.dc,
    isi: Math.round(isi * 10) / 10,
    bui: s0.bui,
    fwi: Math.round(fwi * 10) / 10,
    ...danger,
  }
}
