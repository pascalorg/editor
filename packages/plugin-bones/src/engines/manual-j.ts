/**
 * MANUAL-J-LITE v1 — schematic sensible cooling load. Pure function:
 * (WallSlice[], RoomSlice[], stateCode) → ManualJLiteLoad | fallback reason.
 *
 * CODE BASIS (IRC M1401.3): cooling equipment is sized per ACCA Manual S
 * from loads calculated per ACCA Manual J. A full Manual J is out of scope
 * for this engine — this is an honestly-labeled LITE load with four terms
 * (data/mep-rules.json hvac.manualJLite carries every constant + citation):
 *
 *   1. ENVELOPE CONDUCTION: UA × design cooling ΔT. UA counts exterior
 *      walls (net of openings, prescriptive cavity R per the state's IECC
 *      zone — the same wall-assemblies read the batt sizing does), exterior
 *      glazing (U-0.32 assumed, 2021 IECC R402.1.2), and the CEILING at the
 *      zone's prescriptive R (2021 IECC R402.1.3) over the conditioned
 *      area — the roof is the largest conduction gain under a design sun
 *      and a "load" that omits it would be a lie; the term assumes a TOP
 *      storey under an attic at outdoor ΔT (interior storeys overstate
 *      slightly — conservative, stated). ΔT = per-zone ASHRAE/ACCA-style
 *      outdoor design dry-bulb default − 24°C indoor; VERIFY LOCAL DESIGN
 *      CONDITIONS (IRC Table R301.2(1) / ACCA MJ8 Table 1A).
 *   2. GLAZING SOLAR GAIN: window area × per-orientation factor
 *      (N 75 / E 220 / S 150 / W 220 W/m² of glass — ASHRAE-style peak
 *      cooling proxies) × assumed SHGC 0.30. Orientation = the window
 *      wall's OUTWARD normal (away from the building interior) bucketed to
 *      the dominant plan axis; axes assumed world-aligned (+x = east,
 *      −z = north) — stated, not divined.
 *   3. INTERNAL GAINS: Manual J defaults — 230 Btu/h (67.4 W) sensible per
 *      occupant at occupancy = bedrooms + 1, plus a 1,200 Btu/h (351.7 W)
 *      appliance allowance.
 *   4. INFILTRATION: 0.33 Wh/(m³·K) × ACH 0.35 (assumed) × conditioned
 *      VOLUME (Σ room area × ceiling height — the same volume the building
 *      characteristics block sums) × ΔT.
 *
 * The four terms are SENSIBLE; a COARSE LATENT ALLOWANCE then scales the
 * sum by the zone's IECC moisture-regime letter (A humid ×1.25 / B dry
 * ×1.05 / C marine ×1.10; no letter → ×1.0, stated) before Manual S —
 * class factors only, a full Manual J latent calculation governs. Duct
 * gains, floors, doors and shading are NOT modeled — every consumer label
 * says "Manual J-lite" and ACCA Manual J/S govern.
 *
 * FALLBACK CONTRACT (never silent): the load computes only when the
 * climate zone resolves AND a straight exterior envelope exists AND the
 * conditioned volume is positive; otherwise callers keep the labeled
 * sqft-per-ton rule with the reason on the label. LOD never gates the
 * load — walls and rooms exist at every LOD.
 *
 * MANUAL S SELECTION (`manualSTons`): equipment total = smallest half-ton
 * multiple ≥ the sensible load tons, floored at 1.5 (smallest common
 * residential unit); common practice keeps the selection within 95–115%
 * of load (Manual S / PNNL BASC) — a selection pushed outside the band by
 * stock-size steps or the 1.5-ton floor is reported, never silent.
 */

import mepRules from '../../data/mep-rules.json'
import wallAssemblies from '../../data/wall-assemblies.json'
import type { RoomSlice, WallSlice } from '../core/types'

type Pt = readonly [number, number]

// ---- conversion constants (single source — characteristics re-exports) ----
/** RSI (m²·K/W) per imperial R (ft²·°F·h/BTU). */
export const R_IMPERIAL_TO_RSI = 0.1761
/** W/m²K per BTU/h·ft²·°F. */
export const U_IMPERIAL_TO_SI = 5.678263
/** 2021 IECC Table R402.1.2 climate-typical fenestration U-factor. */
export const WINDOW_U_IMPERIAL = 0.32
/** BTU/h per W. */
export const BTUH_PER_W = 3.412142
/** BTU/h per ton of cooling. */
export const BTUH_PER_TON = 12000

const RULES = (mepRules as Record<string, unknown>).hvac as {
  manualJLite?: {
    indoorDesignC?: number
    outdoorDesignCByZone?: Record<string, number>
    ceilingRByZone?: Record<string, number>
    solarWPerM2ByOrientation?: Record<string, number>
    shgcAssumed?: number
    occupantSensibleW?: number
    appliancesSensibleW?: number
    infiltrationAch?: number
    airSensibleWhPerM3K?: number
    latentAllowanceByMoistureRegime?: Record<string, number>
    manualSBandPctOfLoad?: { min?: number; max?: number }
  }
}
const MJ = RULES?.manualJLite

const ASSEMBLIES = wallAssemblies as {
  exterior?: {
    stateClimateZone?: Record<string, string>
    insulationByClimateZone?: Record<string, { value?: string }>
  }
}

/** Indoor cooling design temperature, °C (ACCA MJ8 convention). */
export const INDOOR_DESIGN_C = MJ?.indoorDesignC ?? 24
/** Outdoor cooling design dry-bulb DEFAULT per IECC zone digit, °C —
 * ASHRAE/ACCA-style; verify local design conditions (Table R301.2(1)). */
export const OUTDOOR_DESIGN_C_BY_ZONE: Record<string, number> = MJ?.outdoorDesignCByZone ?? {
  '1': 33, '2': 35, '3': 34, '4': 33, '5': 33, '6': 31, '7': 29, '8': 26,
}
/** 2021 IECC Table R402.1.3 prescriptive ceiling R by zone digit. */
export const CEILING_R_BY_ZONE: Record<string, number> = MJ?.ceilingRByZone ?? {
  '1': 30, '2': 49, '3': 49, '4': 60, '5': 60, '6': 60, '7': 60, '8': 60,
}
/** Peak cooling-design solar proxies per m² of glass by facade orientation. */
export const SOLAR_W_PER_M2: Record<'N' | 'E' | 'S' | 'W', number> = {
  N: MJ?.solarWPerM2ByOrientation?.N ?? 75,
  E: MJ?.solarWPerM2ByOrientation?.E ?? 220,
  S: MJ?.solarWPerM2ByOrientation?.S ?? 150,
  W: MJ?.solarWPerM2ByOrientation?.W ?? 220,
}
/** Assumed fenestration SHGC (2021 IECC R402.1.2 zones 1-3 maximum). */
export const SHGC_ASSUMED = MJ?.shgcAssumed ?? 0.3
/** Manual J sensible gain per occupant (230 Btu/h), W. */
export const OCCUPANT_SENSIBLE_W = MJ?.occupantSensibleW ?? 67.4
/** Manual J appliance allowance per dwelling (1,200 Btu/h), W. */
export const APPLIANCES_SENSIBLE_W = MJ?.appliancesSensibleW ?? 351.7
/** Assumed infiltration air changes per hour. */
export const INFILTRATION_ACH = MJ?.infiltrationAch ?? 0.35
/** Sensible heat capacity of air, Wh/(m³·K) — ρ·cp/3600. */
export const AIR_SENSIBLE_WH_PER_M3K = MJ?.airSensibleWhPerM3K ?? 0.33
/** COARSE latent allowance by IECC moisture-regime letter (A moist/humid,
 * B dry, C marine — 2021 IECC Figure R301.1), applied to the sensible sum
 * BEFORE Manual S selection. Class factors only — a full ACCA Manual J
 * latent calculation governs (skeptic F1: the sensible-only figure sized a
 * humid-zone system a half ton short with no words anywhere a selection
 * reader looks). Zones with no regime letter take ×1.0, stated. */
export const LATENT_BY_REGIME: Record<'A' | 'B' | 'C', number> = {
  A: MJ?.latentAllowanceByMoistureRegime?.A ?? 1.25,
  B: MJ?.latentAllowanceByMoistureRegime?.B ?? 1.05,
  C: MJ?.latentAllowanceByMoistureRegime?.C ?? 1.1,
}
/** Manual S selection band, fraction of load. */
export const MANUAL_S_MIN = (MJ?.manualSBandPctOfLoad?.min ?? 95) / 100
export const MANUAL_S_MAX = (MJ?.manualSBandPctOfLoad?.max ?? 115) / 100

/** "2A (1A Miami/Keys)" → { label: "2A", key: "2" }; 4C (marine) → "4M".
 * Single-sourced here — the characteristics engine imports this parse. */
export function parseZone(raw: string): { label: string; key: string } | null {
  const m = /^(\d)([ABC])?/.exec(raw.trim())
  if (!m) return null
  const digit = m[1] as string
  const letter = m[2] ?? ''
  return {
    label: `${digit}${letter}`,
    key: digit === '4' && letter === 'C' ? '4M' : digit,
  }
}

export type WindowGain = {
  orientation: 'N' | 'E' | 'S' | 'W'
  areaM2: number
  gainW: number
}

export type ManualJLiteLoad = {
  ok: true
  /** IECC zone label the state resolved to, e.g. "2A". */
  zone: string
  /** Zone digit key driving the design-temp/R lookups ('4M' → marine). */
  zoneKey: string
  outdoorDesignC: number
  indoorDesignC: number
  deltaTK: number
  /** Conditioned = indoor, non-garage rooms (matches the HVAC engine). */
  conditionedAreaM2: number
  conditionedVolumeM3: number
  bedrooms: number
  occupants: number
  /** UA components, W/K. */
  uaWallsWPerK: number
  uaWindowsWPerK: number
  uaCeilingWPerK: number
  uaWPerK: number
  /** Load terms, W (sensible only). */
  envelopeW: number
  solarW: number
  internalW: number
  infiltrationW: number
  totalW: number
  totalBtuH: number
  /** The four-term SENSIBLE sum in tons (totalBtuH / 12,000). */
  sensibleTons: number
  /** IECC moisture-regime letter of the zone (A humid / B dry / C marine),
   * null when the zone label carries none (bare digits like AK '7'). */
  moistureRegime: 'A' | 'B' | 'C' | null
  /** Latent allowance applied (LATENT_BY_REGIME; 1.0 when no regime). */
  latentFactor: number
  /** The DESIGN load Manual S selects from: sensibleTons × latentFactor. */
  loadTons: number
  /** Per-orientation glazing breakdown (exterior windows only). */
  windowGains: WindowGain[]
  wallR: number
  ceilingR: number
  /** Every assumption, stated. */
  notes: string[]
}

export type ManualJLiteFallback = {
  ok: false
  /** Stated fallback trigger — consumers put it ON THE LABEL. */
  reason: string
}

/** Vertex-average centroid of every conditioned room polygon (fallback:
 * wall endpoints) — only used to pick each wall's OUTWARD side. */
function interiorCentroid(walls: WallSlice[], rooms: RoomSlice[]): Pt {
  let x = 0
  let z = 0
  let n = 0
  for (const room of rooms) {
    for (const [px, pz] of room.polygon) {
      x += px
      z += pz
      n++
    }
  }
  if (n === 0) {
    for (const w of walls) {
      x += w.start[0] + w.end[0]
      z += w.start[1] + w.end[1]
      n += 2
    }
  }
  return n > 0 ? [x / n, z / n] : [0, 0]
}

/** Facade orientation of a wall's OUTWARD normal, bucketed to the dominant
 * plan axis. Axes assumed world-aligned: +x = east, −z = north (stated). */
export function facadeOrientation(wall: WallSlice, interior: Pt): 'N' | 'E' | 'S' | 'W' {
  // both perpendiculars; outward = the one pointing away from the interior
  let nx = -wall.dir[1]
  let nz = wall.dir[0]
  const mid: Pt = [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2]
  if ((mid[0] - interior[0]) * nx + (mid[1] - interior[1]) * nz < 0) {
    nx = -nx
    nz = -nz
  }
  if (Math.abs(nx) >= Math.abs(nz)) return nx >= 0 ? 'E' : 'W'
  return nz >= 0 ? 'S' : 'N'
}

/** Shoelace ring area, m². */
function ringArea(polygon: readonly Pt[]): number {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i] as Pt
    const [x2, z2] = polygon[(i + 1) % polygon.length] as Pt
    sum += x1 * z2 - x2 * z1
  }
  return Math.abs(sum) / 2
}

/**
 * The Manual-J-lite sensible cooling load, or the stated fallback reason.
 * `rooms` may be the raw zone list — outdoor zones and garages are filtered
 * here (conditioned space only, the HVAC engine's own definition).
 */
export function manualJLite(
  walls: WallSlice[],
  rooms: RoomSlice[],
  stateCode?: string,
): ManualJLiteLoad | ManualJLiteFallback {
  // ---- fallback trigger 1: climate zone must resolve ----
  const zoneRaw = stateCode ? ASSEMBLIES.exterior?.stateClimateZone?.[stateCode] : undefined
  const zone = zoneRaw ? parseZone(zoneRaw) : null
  if (!zone) {
    return {
      ok: false,
      reason: `climate zone unknown for '${stateCode ?? 'unset'}' — set the jurisdiction`,
    }
  }
  const digit = zone.key === '4M' ? '4' : zone.key
  const outdoorDesignC = OUTDOOR_DESIGN_C_BY_ZONE[digit] ?? 33
  const deltaTK = outdoorDesignC - INDOOR_DESIGN_C

  // ---- conditioned space: indoor, non-garage rooms ----
  const conditioned = rooms.filter((r) => r.category !== 'outdoor' && r.category !== 'garage')
  let conditionedAreaM2 = 0
  let conditionedVolumeM3 = 0
  for (const room of conditioned) {
    const a = ringArea(room.polygon)
    conditionedAreaM2 += a
    conditionedVolumeM3 += a * room.ceilingHeight
  }
  if (conditionedVolumeM3 <= 0) {
    return { ok: false, reason: 'no conditioned volume — no indoor rooms/zones drawn' }
  }

  // ---- envelope census: exterior straight walls, net of openings ----
  const interior = interiorCentroid(walls, conditioned)
  let wallNetM2 = 0
  let windowAreaM2 = 0
  const gains = new Map<'N' | 'E' | 'S' | 'W', number>()
  for (const wall of walls) {
    if (!wall.exterior || wall.curved) continue
    let area = wall.length * wall.height
    for (const o of wall.openings) {
      area -= o.width * o.height
      if (o.kind === 'window') {
        const wa = o.width * o.height
        windowAreaM2 += wa
        const orientation = facadeOrientation(wall, interior)
        gains.set(orientation, (gains.get(orientation) ?? 0) + wa)
      }
    }
    wallNetM2 += Math.max(0, area)
  }
  if (wallNetM2 + windowAreaM2 <= 0) {
    return { ok: false, reason: 'no straight exterior envelope on this level' }
  }

  // ---- term 1: envelope UA × ΔT ----
  const wallR =
    Number.parseInt(
      (ASSEMBLIES.exterior?.insulationByClimateZone?.[zone.key]?.value ?? 'R13').replace(
        /^R/i,
        '',
      ),
      10,
    ) || 13
  const ceilingR = CEILING_R_BY_ZONE[digit] ?? 49
  const uaWallsWPerK = wallNetM2 / (wallR * R_IMPERIAL_TO_RSI)
  const uaWindowsWPerK = windowAreaM2 * WINDOW_U_IMPERIAL * U_IMPERIAL_TO_SI
  const uaCeilingWPerK = conditionedAreaM2 / (ceilingR * R_IMPERIAL_TO_RSI)
  const uaWPerK = uaWallsWPerK + uaWindowsWPerK + uaCeilingWPerK
  const envelopeW = uaWPerK * deltaTK

  // ---- term 2: glazing solar gain ----
  const windowGains: WindowGain[] = []
  let solarW = 0
  for (const orientation of ['N', 'E', 'S', 'W'] as const) {
    const areaM2 = gains.get(orientation) ?? 0
    if (areaM2 <= 0) continue
    const gainW = areaM2 * SOLAR_W_PER_M2[orientation] * SHGC_ASSUMED
    windowGains.push({ orientation, areaM2, gainW })
    solarW += gainW
  }

  // ---- term 3: internal gains (bedrooms + 1 occupancy) ----
  const bedrooms = conditioned.filter((r) => r.category === 'bedroom').length
  const occupants = bedrooms + 1
  const internalW = occupants * OCCUPANT_SENSIBLE_W + APPLIANCES_SENSIBLE_W

  // ---- term 4: infiltration ----
  const infiltrationW =
    AIR_SENSIBLE_WH_PER_M3K * INFILTRATION_ACH * conditionedVolumeM3 * deltaTK

  const totalW = envelopeW + solarW + internalW + infiltrationW
  const totalBtuH = totalW * BTUH_PER_W
  const sensibleTons = totalBtuH / BTUH_PER_TON

  // ---- latent allowance (skeptic F1): the four terms are SENSIBLE only —
  // in a humid zone the missing latent share sized real systems a half ton
  // short while every label read as a finished load. Coarse class factor by
  // the zone's moisture-regime letter, applied BEFORE Manual S; stated on
  // every consumer label. Full Manual J latent governs.
  const letter = /([ABC])$/.exec(zone.label)?.[1] as 'A' | 'B' | 'C' | undefined
  const moistureRegime = letter ?? null
  const latentFactor = letter ? LATENT_BY_REGIME[letter] : 1
  const loadTons = sensibleTons * latentFactor

  const notes = [
    `Manual J-lite SENSIBLE load (IRC M1401.3 — ACCA Manual J/S govern): UA·ΔT ${Math.round(envelopeW)} W + solar ${Math.round(solarW)} W + internal ${Math.round(internalW)} W + infiltration ${Math.round(infiltrationW)} W = ${Math.round(totalW)} W (${Math.round(totalBtuH)} Btu/h ≈ ${sensibleTons.toFixed(2)} tons sensible)`,
    moistureRegime
      ? `Latent allowance ×${latentFactor} (moisture regime ${moistureRegime} — ${moistureRegime === 'A' ? 'humid' : moistureRegime === 'B' ? 'dry' : 'marine'}, 2021 IECC Figure R301.1 zone letter): ${sensibleTons.toFixed(2)} tons sensible → ${loadTons.toFixed(2)} tons design load — coarse class factor, full Manual J latent calculation governs`
      : `No moisture-regime letter on zone ${zone.label} — no latent allowance applied (×1.0); full Manual J latent calculation governs`,
    `Cooling design ΔT ${deltaTK} K: zone ${zone.label} outdoor design ${outdoorDesignC}°C (ASHRAE/ACCA-style default — verify local design conditions, Table R301.2(1)) − indoor ${INDOOR_DESIGN_C}°C`,
    `Load UA ${uaWPerK.toFixed(1)} W/K = walls ${wallNetM2.toFixed(1)} m² @ R-${wallR} + exterior glazing ${windowAreaM2.toFixed(1)} m² @ U-${WINDOW_U_IMPERIAL} + ceiling ${conditionedAreaM2.toFixed(1)} m² @ R-${ceilingR} (2021 IECC R402.1.3, top-storey attic assumption); floors/doors/latent/ducts excluded — schematic`,
    `Solar: glazing × SHGC ${SHGC_ASSUMED} × N ${SOLAR_W_PER_M2.N}/E ${SOLAR_W_PER_M2.E}/S ${SOLAR_W_PER_M2.S}/W ${SOLAR_W_PER_M2.W} W/m² by facade (+x = east, −z = north assumed)`,
    `Internal: ${occupants} occupants (bedrooms ${bedrooms} + 1, Manual J) × ${OCCUPANT_SENSIBLE_W} W + appliances ${APPLIANCES_SENSIBLE_W} W`,
    `Infiltration: ${AIR_SENSIBLE_WH_PER_M3K} Wh/(m³·K) × ACH ${INFILTRATION_ACH} (assumed) × ${conditionedVolumeM3.toFixed(1)} m³ conditioned volume × ΔT ${deltaTK} K`,
  ]

  return {
    ok: true,
    zone: zone.label,
    zoneKey: zone.key,
    outdoorDesignC,
    indoorDesignC: INDOOR_DESIGN_C,
    deltaTK,
    conditionedAreaM2,
    conditionedVolumeM3,
    bedrooms,
    occupants,
    uaWallsWPerK,
    uaWindowsWPerK,
    uaCeilingWPerK,
    uaWPerK,
    envelopeW,
    solarW,
    internalW,
    infiltrationW,
    totalW,
    totalBtuH,
    sensibleTons,
    moistureRegime,
    latentFactor,
    loadTons,
    windowGains,
    wallR,
    ceilingR,
    notes,
  }
}

/**
 * Manual S equipment selection from a load: the smallest half-ton multiple
 * ≥ the load, floored at `minTons` (1.5 — smallest common residential
 * unit). `withinBand` is false when stock-size steps or the floor push the
 * selection outside the 95–115% common-practice band — callers report it,
 * never silently.
 */
export function manualSTons(
  loadTons: number,
  minTons = 1.5,
): { tons: number; withinBand: boolean } {
  const tons = Math.max(minTons, Math.ceil(loadTons * 2) / 2)
  const withinBand =
    loadTons > 0 && tons >= MANUAL_S_MIN * loadTons && tons <= MANUAL_S_MAX * loadTons + 1e-9
  return { tons, withinBand }
}
