/**
 * Building characteristics — whole-building metrics about the model itself
 * (not the bill of materials): floor area, conditioned volume, envelope
 * area, glazing, the jurisdiction's wall insulation, and a schematic
 * envelope UA → design heat loss / cooling tonnage to help dimension the
 * HVAC. Pure function:
 * (WallSlice[], RoomSlice[], SlabSlice[], FramingSpec, stateCode) →
 * BuildingCharacteristics | null.
 *
 * Everything approximate is SAID so: each derived number carries its
 * citation or assumption in `notes`. This is a drafting aid, not a
 * Manual J — the UA row counts wall + window conduction only. The COOLING
 * row is the Manual-J-lite SENSIBLE load when it computes (src/engines/
 * manual-j.ts — the same figure the HVAC engine sizes equipment from, IRC
 * M1401.3), else the legacy rule of thumb with the trigger stated.
 */

import assemblies from '../../data/wall-assemblies.json'
import { DEFAULT_SPEC, type FramingSpec } from '../core/spec'
import type { RoomSlice, SlabSlice, WallSlice } from '../core/types'
import { toInches } from '../core/units'
import { LUMBER_CROSS_SECTIONS } from '../lumber'
import {
  R_IMPERIAL_TO_RSI,
  U_IMPERIAL_TO_SI,
  WINDOW_U_IMPERIAL,
  manualJLite,
  parseZone,
} from './manual-j'

type Pt = readonly [number, number]

type ZoneInsulation = {
  value: string
  battThicknessIn?: number
  studDepthIn?: number
  citation: string
}
type AssembliesData = {
  exterior: {
    stateClimateZone?: Record<string, string>
    stateClimateZoneCitation?: string
    insulationByClimateZone?: Record<string, ZoneInsulation>
  }
}
const DATA = assemblies as unknown as AssembliesData

// ---- conversion + rule-of-thumb constants (all cited in `notes`) ----
// The UA conversion constants single-source in src/engines/manual-j.ts
// (the load module) — re-exported here so this module's public API holds.
export { R_IMPERIAL_TO_RSI, U_IMPERIAL_TO_SI, WINDOW_U_IMPERIAL }
/** Winter design temperature difference (indoor 20°C − design −2°C ≈ 22 K). */
export const DESIGN_DELTA_T_K = 22
/** Cooling RULE OF THUMB: 1 ton per 55 m² of conditioned floor. */
export const COOLING_M2_PER_TON = 55
/** UA density (W/K per m² floor) at which the tonnage adjustment is 1.0. */
export const REFERENCE_UA_DENSITY = 0.6

export type BuildingCharacteristics = {
  /** Conditioned floor area, m² (rooms; slabs minus holes as fallback). */
  floorAreaM2: number
  /** Conditioned volume, m³ (per-room area × ceiling height). */
  volumeM3: number
  /** Exterior wall envelope net of openings, m². */
  envelopeAreaM2: number
  windowCount: number
  windowAreaM2: number
  doorCount: number
  insulation: {
    /** Primary IECC climate zone for the state, e.g. "2A". */
    climateZone: string
    /** Prescriptive wall cavity R-value (imperial), e.g. 13. */
    wallR: number
    citation: string
  }
  /** Envelope conductance Σ(A·U) for walls + windows, W/K. */
  uaWPerK: number
  /** uaWPerK × ΔT 22 K — schematic winter design heat loss, W. */
  designHeatLossW: number
  /** Cooling load/estimate, tons (12,000 BTU/h each): the Manual-J-lite
   * SENSIBLE load when it computes (`coolingBasis` 'manual-j-lite' — the
   * same figure the HVAC engine sizes equipment from, IRC M1401.3), else
   * the legacy rule of thumb with the trigger stated in the notes. */
  coolingTonsEstimate: number
  /** Basis of `coolingTonsEstimate` — absent reads 'rule-of-thumb'
   * (hand-built fixtures predating the Manual-J-lite batch). */
  coolingBasis?: 'manual-j-lite' | 'rule-of-thumb'
  /** Manual-J-lite composition (skeptic F1 — sensible + allowance + total
   * must all reach the reader): the four-term SENSIBLE tons and the
   * moisture-regime latent factor whose product is `coolingTonsEstimate`.
   * Absent on the fallback / hand-built fixtures. */
  coolingSensibleTons?: number
  coolingLatentFactor?: number
  coolingMoistureRegime?: 'A' | 'B' | 'C' | null
  /** Citations + assumptions for every derived number above. */
  notes: string[]
  /** Set when floorAreaM2 is 0 BECAUSE every drawn zone is outdoor (round-4
   * F1) — the display layers must say 'no conditioned space', not 'no floor
   * slabs': a roof terrace WITH its floor slab printed the no-slab n/a next
   * to the slab-on-grade flag on the same sheet (a stale reason turned lie
   * once the all-outdoor branch stopped booking the patio slab). */
  allZonesOutdoor?: boolean
}

/** Shoelace ring area, m² (same pattern as the takeoff areas block). */
function ringArea(polygon: readonly Pt[]): number {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i] as Pt
    const [x2, z2] = polygon[(i + 1) % polygon.length] as Pt
    sum += x1 * z2 - x2 * z1
  }
  return Math.abs(sum) / 2
}

// parseZone ("2A (1A Miami/Keys)" → { label, key }) now single-sources in
// manual-j.ts — one zone parse for the load AND the insulation lookup.

export function computeCharacteristics(
  walls: WallSlice[],
  rooms: RoomSlice[],
  slabs: SlabSlice[] = [],
  spec: FramingSpec = DEFAULT_SPEC,
  /** Resolved state code (drives the climate-zone insulation lookup). */
  stateCode = 'NY',
  opts?: {
    /** The level carries steel-frame (LGS) walls — the wood-frame IECC
     * cavity figure does not hold for them (2021 IECC R402.2.6 / IRC
     * N1102.2.6 give steel walls their OWN requirement) and the UA/load
     * arithmetic ignores steel-stud thermal bridging; the notes say so
     * instead of letting the wood claim ride (LGS Phase 1, round-1 F2). */
    steelWalls?: boolean
  },
): BuildingCharacteristics | null {
  if (walls.length === 0 && rooms.length === 0 && slabs.length === 0) return null
  const notes: string[] = []

  // ---- floor area: rooms are the truth; slab outlines are the fallback ----
  // CONDITIONED basis (examiner round-1): outdoor zones (garden/patio/yard)
  // are open air — their area must not inflate the figure the schedules
  // sheet prints beside a condenser sized from indoor area (starter
  // template: 'Floor area 168.0 m²' on the same page as a 2-ton unit from
  // 96 m² conditioned). Excluded from area AND volume — the type already
  // declares both CONDITIONED — with the basis stated in the notes.
  const indoorRooms = rooms.filter((r) => r.category !== 'outdoor')
  const outdoorAreaM2 = rooms
    .filter((r) => r.category === 'outdoor')
    .reduce((sum, r) => sum + ringArea(r.polygon), 0)
  let floorAreaM2 = 0
  const allZonesOutdoor = indoorRooms.length === 0 && rooms.length > 0
  if (indoorRooms.length > 0) {
    for (const room of indoorRooms) floorAreaM2 += ringArea(room.polygon)
    if (outdoorAreaM2 > 0) {
      notes.push(
        `Floor area & volume are CONDITIONED space — ${outdoorAreaM2.toFixed(1)} m² of outdoor zones (garden/patio/yard) excluded`,
      )
    }
  } else if (allZonesOutdoor) {
    // EVERY drawn zone is outdoor (a garden level, a roof terrace with its
    // floor slab): there is NO conditioned space — the slab under open air
    // is paving, not conditioned floor. Booking it (skeptic round-2 corner:
    // 24 m² patio slab printed as 'Floor area 24.0 m²' next to a FALSE
    // 'no rooms/zones drawn' note AND a false exclusion note) lied twice.
    // The figure stays 0 and ONE truthful note says why.
    notes.push(
      'No conditioned space on this level — every zone is outdoor (garden/patio/terrace)',
    )
  } else {
    for (const slab of slabs) {
      let area = ringArea(slab.polygon)
      for (const hole of slab.holes) area -= ringArea(hole)
      floorAreaM2 += Math.max(0, area)
    }
    if (slabs.length > 0) {
      notes.push('Floor area from slab outlines (minus holes) — no rooms/zones drawn')
    }
  }

  // ---- volume: per-room area × its ceiling height ----
  let volumeM3 = 0
  if (indoorRooms.length > 0) {
    for (const room of indoorRooms) volumeM3 += ringArea(room.polygon) * room.ceilingHeight
  } else {
    const heights = walls.filter((w) => w.exterior).map((w) => w.height)
    const avgH =
      heights.length > 0 ? heights.reduce((a, b) => a + b, 0) / heights.length : 2.4
    volumeM3 = floorAreaM2 * avgH
    if (floorAreaM2 > 0) {
      notes.push(
        `Volume estimated as floor area × mean exterior wall height (${avgH.toFixed(2)} m) — no rooms drawn`,
      )
    }
  }

  // ---- envelope: exterior wall faces net of openings; glazing census ----
  let envelopeAreaM2 = 0
  let windowCount = 0
  let windowAreaM2 = 0
  let doorCount = 0
  let curvedSkipped = 0
  for (const wall of walls) {
    for (const o of wall.openings) {
      if (o.kind === 'window') {
        windowCount++
        windowAreaM2 += o.width * o.height
      } else doorCount++
    }
    if (!wall.exterior) continue
    if (wall.curved) {
      curvedSkipped++
      continue
    }
    let area = wall.length * wall.height
    for (const o of wall.openings) area -= o.width * o.height
    envelopeAreaM2 += Math.max(0, area)
  }
  if (curvedSkipped > 0) notes.push(`${curvedSkipped} curved wall(s) excluded from the envelope`)
  notes.push('Opening areas use nominal door/window sizes, not rough openings')

  // ---- insulation: state → IECC climate zone → prescriptive wall R ----
  const zoneRaw = DATA.exterior.stateClimateZone?.[stateCode]
  const zone = zoneRaw ? parseZone(zoneRaw) : null
  const zoneTable = DATA.exterior.insulationByClimateZone ?? {}
  const entry = zone ? zoneTable[zone.key] : undefined
  const fallbackEntry = zoneTable['4']
  const picked =
    entry && typeof entry.value === 'string'
      ? entry
      : fallbackEntry && typeof fallbackEntry.value === 'string'
        ? fallbackEntry
        : { value: 'R13', citation: '2021 IECC Table R402.1.3 / IRC N1102.1.3' }
  const wallR = Number.parseInt(picked.value.replace(/^R/i, ''), 10) || 13
  // Steel-frame qualifier rides the CITATION STRING ITSELF (round-2 D):
  // the R402 energy cite prints at EVERY LOD (paper's characteristics
  // block, the notes line, the CSV) while the warning channel is 300+-
  // gated — a steel set at 200 printed 'Wall cavity R-30 … Table
  // R402.1.3' with zero qualifier. Qualifying the one source string
  // means no surface can print the cite without the caveat. (The
  // zero-R603-at-200 ladder rule is about STRUCTURAL claims; this cite
  // already prints at 200, so honesty must accompany it there too.)
  const citation = opts?.steelWalls
    ? `${picked.citation} — wood-frame prescriptive; steel-frame walls take R402.2.6/N1102.2.6, not evaluated`
    : picked.citation
  const climateZone = zone?.label ?? '4 (assumed)'
  if (!zone) {
    notes.push(
      `Climate zone unknown for '${stateCode}' — zone 4 assumed; set the jurisdiction for a real lookup`,
    )
  } else {
    notes.push(
      `Climate zone ${zone.label} — 2021 IECC Figure R301.1 dominant zone for ${stateCode}` +
        (/[(/-]/.test(zoneRaw ?? '') ? ' (zone varies within the state — confirm with AHJ)' : ''),
    )
  }
  notes.push(`Wall cavity ${picked.value} — ${citation}`)
  if (opts?.steelWalls) {
    // Steel-frame honesty (LGS Phase 1): the cavity R above is the
    // WOOD-frame prescriptive cell, and every UA/Manual-J figure below
    // treats the cavity R at face value — steel studs short-circuit a
    // cavity-only assembly and the code prices that (R402.2.6's
    // cavity + continuous-insulation combos / effective-U path).
    notes.push(
      'Steel-frame (LGS) walls present — cavity R shown is the wood-frame prescriptive ' +
        'value; steel-frame walls take 2021 IECC R402.2.6 / IRC N1102.2.6 (cavity + ' +
        'continuous insulation, or U-factor path) — not evaluated, and steel-stud thermal ' +
        'bridging is not modeled in the UA/load figures',
    )
  }
  // Does the prescriptive batt even fit the spec'd stud bay?
  if (picked.battThicknessIn) {
    const bayIn = toInches(LUMBER_CROSS_SECTIONS[spec.exteriorStudSize][1])
    if (picked.battThicknessIn > bayIn + 0.01) {
      notes.push(
        `${picked.value} batt wants a ${picked.battThicknessIn}" bay — spec exterior studs (${spec.exteriorStudSize}) give ${bayIn.toFixed(1)}"; use continuous insulation or deeper studs`,
      )
    }
  }

  // ---- UA: wall + window conduction, W/K ----
  const wallRsi = wallR * R_IMPERIAL_TO_RSI
  const wallU = wallRsi > 0 ? 1 / wallRsi : 0
  const windowU = WINDOW_U_IMPERIAL * U_IMPERIAL_TO_SI
  const uaWPerK = envelopeAreaM2 * wallU + windowAreaM2 * windowU
  notes.push(
    `Window U-${WINDOW_U_IMPERIAL} BTU/h·ft²·°F assumed — 2021 IECC Table R402.1.2 climate-typical fenestration U-factor`,
  )
  notes.push(
    `UA counts wall + window conduction only (RSI = R × ${R_IMPERIAL_TO_RSI}); roof, floor, doors and infiltration excluded — schematic`,
  )

  // ---- design loads ----
  const designHeatLossW = uaWPerK * DESIGN_DELTA_T_K
  notes.push(`Design heat loss at ΔT = ${DESIGN_DELTA_T_K} K (winter design assumption)`)
  // COOLING: the Manual-J-lite SENSIBLE load when it can compute — the SAME
  // figure the HVAC engine sizes the air handler + condenser row from (IRC
  // M1401.3, ACCA Manual J/S govern; src/engines/manual-j.ts states every
  // term). When it cannot (unknown zone / no envelope / no conditioned
  // volume) the legacy rule of thumb estimates, with the trigger stated —
  // never a silent basis swap.
  const mj = manualJLite(walls, rooms, stateCode)
  let coolingTonsEstimate: number
  let coolingBasis: 'manual-j-lite' | 'rule-of-thumb'
  let coolingComposition: {
    coolingSensibleTons: number
    coolingLatentFactor: number
    coolingMoistureRegime: 'A' | 'B' | 'C' | null
  } | null = null
  if (mj.ok) {
    coolingBasis = 'manual-j-lite'
    coolingTonsEstimate = mj.loadTons
    coolingComposition = {
      coolingSensibleTons: mj.sensibleTons,
      coolingLatentFactor: mj.latentFactor,
      coolingMoistureRegime: mj.moistureRegime,
    }
    notes.push(...mj.notes)
  } else {
    coolingBasis = 'rule-of-thumb'
    const baseTons = floorAreaM2 / COOLING_M2_PER_TON
    const uaDensity = floorAreaM2 > 0 ? uaWPerK / floorAreaM2 : 0
    const factor = Math.min(1.2, Math.max(0.8, uaDensity / REFERENCE_UA_DENSITY))
    coolingTonsEstimate = baseTons * factor
    notes.push(
      `Cooling RULE OF THUMB: 1 ton per ${COOLING_M2_PER_TON} m² floor, ±20% by envelope UA density — not a Manual J load calculation (Manual J-lite unavailable: ${mj.reason})`,
    )
  }
  notes.push('Metrics cover the X-rayed level only')

  return {
    floorAreaM2,
    volumeM3,
    envelopeAreaM2,
    windowCount,
    windowAreaM2,
    doorCount,
    insulation: { climateZone, wallR, citation },
    uaWPerK,
    designHeatLossW,
    coolingTonsEstimate,
    coolingBasis,
    ...(coolingComposition ?? {}),
    notes,
    ...(allZonesOutdoor ? { allZonesOutdoor: true } : {}),
  }
}

/** One display row per metric — the panel and the CSV share this shape.
 * Area-derived metrics on a slab-less model print 'n/a — no floor slabs'
 * instead of absurd zeros (round-3 scorecard C5: 'Floor area 0.0 m² …
 * Cooling ~0.0 ton' printed as fact). Exported: the plan-set schedules
 * block prints the SAME strings (round-4 F1 — its inline twin drifted into
 * a lie the moment the zero-area REASON stopped being 'no slabs'). */
export const NO_SLAB_NA = 'n/a — no floor slabs (see flags)'
/** The all-outdoor level: the figure is 0 because nothing is conditioned,
 * not because flooring is missing — a roof terrace WITH its floor slab must
 * never print 'no floor slabs' beside the slab-on-grade flag (round-4 F1). */
export const NO_CONDITIONED_NA = 'n/a — no conditioned space on this level (all zones outdoor)'

/** The truthful zero-area string for `c`: WHY the figure is 0. */
export function zeroAreaNa(c: BuildingCharacteristics): string {
  return c.allZonesOutdoor ? NO_CONDITIONED_NA : NO_SLAB_NA
}

export function characteristicsRows(
  c: BuildingCharacteristics,
): { metric: string; value: string; unit: string }[] {
  const noSlab = c.floorAreaM2 <= 0
  const na = zeroAreaNa(c)
  // The cooling row NAMES its basis (M4/B11 convention): the Manual-J-lite
  // LOAD when that's what the figure is, the rule of thumb otherwise —
  // absent basis (hand-built fixtures) reads rule-of-thumb.
  const coolingMetric =
    c.coolingBasis === 'manual-j-lite'
      ? 'Cooling load (Manual J-lite)'
      : 'Cooling estimate (rule of thumb)'
  return [
    noSlab
      ? { metric: 'Floor area', value: na, unit: '' }
      : { metric: 'Floor area', value: c.floorAreaM2.toFixed(1), unit: 'm2' },
    noSlab
      ? { metric: 'Volume', value: na, unit: '' }
      : { metric: 'Volume', value: c.volumeM3.toFixed(1), unit: 'm3' },
    { metric: 'Envelope area (net)', value: c.envelopeAreaM2.toFixed(1), unit: 'm2' },
    { metric: 'Windows', value: String(c.windowCount), unit: 'count' },
    { metric: 'Window area', value: c.windowAreaM2.toFixed(1), unit: 'm2' },
    { metric: 'Doors', value: String(c.doorCount), unit: 'count' },
    { metric: 'Climate zone', value: c.insulation.climateZone, unit: 'IECC' },
    { metric: 'Wall insulation', value: `R-${c.insulation.wallR}`, unit: 'ft2·F·h/BTU' },
    { metric: 'Envelope UA', value: c.uaWPerK.toFixed(1), unit: 'W/K' },
    {
      metric: `Design heat loss (dT ${DESIGN_DELTA_T_K}K)`,
      value: c.designHeatLossW.toFixed(0),
      unit: 'W',
    },
    noSlab
      ? { metric: coolingMetric, value: na, unit: '' }
      : {
          metric: coolingMetric,
          // sensible + allowance + total all show (skeptic F1): a humid-
          // zone figure is NOT the four-term sum, and the reader must see
          // the composition, not just the product.
          value:
            c.coolingBasis === 'manual-j-lite' &&
            c.coolingSensibleTons !== undefined &&
            (c.coolingLatentFactor ?? 1) > 1
              ? `${c.coolingTonsEstimate.toFixed(2)} (${c.coolingSensibleTons.toFixed(2)} sensible × ${c.coolingLatentFactor} latent ${c.coolingMoistureRegime})`
              : c.coolingTonsEstimate.toFixed(1),
          unit: 'tons',
        },
  ]
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** metric,value,unit rows + one `Note,…` row per citation/assumption. */
export function characteristicsCsv(c: BuildingCharacteristics): string {
  return [
    'metric,value,unit',
    ...characteristicsRows(c).map((r) =>
      [csvField(r.metric), csvField(r.value), csvField(r.unit)].join(','),
    ),
    ...c.notes.map((n) => `Note,${csvField(n)},`),
  ].join('\n')
}
