/**
 * The WATER HEATER — type, size and the standards it is drawn to.
 *
 * Steve (2026-09-07): "water heaters too with good specs and standards,
 * heat pumps in CA". The panel's choice, else the state's practice: a heat
 * pump water heater where the energy code makes it the baseline (CA 2022
 * Title 24 Part 6 §150.1(c)8; WA / OR by their electric-water-heating
 * rules — verify), a gas tank beside a gas furnace, an electric tank in
 * the all-electric South. Size by the DOE first-hour-rating practice
 * (bedrooms and baths); efficiency floors from the federal standard
 * (10 CFR 430.32(d), 2015) — the ordered unit's label governs.
 *
 * Every figure here is a drafting default with its source on the label;
 * nothing is engineering.
 */

export type WaterHeaterKind = 'electric-tank' | 'gas-tank' | 'heat-pump' | 'tankless-gas' | 'tankless-electric'

export type WaterHeaterSpec = {
  kind: WaterHeaterKind
  /** Storage volume, gallons; null for tankless. */
  gallons: number | null
  /** Minimum uniform energy factor the federal standard asks of this class (verify the label). */
  uefMin: number
  /** Cabinet, metres [width, height, depth] — a tank is a cylinder drawn as a box. */
  dims: readonly [number, number, number]
  /** The member label (what the X-ray and the schedules print). */
  label: string
  /** The branch circuit the electrical trade owes it. */
  circuit: string
  /** Venting: none (electric / heat pump), a B-vent up through the roof (atmospheric gas tank), a direct / concentric vent through the wall (tankless gas). */
  venting: 'none' | 'b-vent' | 'direct'
  /** Why this type (the default's reason, or "the panel's choice"). */
  reason: string
  /** Verify lines for the notes. */
  notes: string[]
}

/** The states whose energy code makes the heat pump water heater the baseline for new single-family (verify each edition). */
const HPWH_BASELINE_STATES: Record<string, string> = {
  CA: '2022 Title 24 Part 6 §150.1(c)8 heat-pump water-heater baseline (NEEA Tier 3, ducted or 700 ft³ of air, 240 V ready) — verify',
  WA: '2021 WSEC-R electric water-heating credits favour a heat-pump water heater — verify',
  OR: '2023 ORSC / Oregon energy code heat-pump water-heater pathway — verify',
}

/** The all-electric practice states (a heat pump keeps the house, an electric tank heats the water). */
const ELECTRIC_TANK_STATES = new Set(['FL', 'GA', 'SC', 'NC', 'AL', 'MS', 'LA', 'TN', 'TX', 'AZ', 'NV', 'OK', 'AR', 'VA'])

/** The type when the panel set none. */
export function defaultWaterHeater(stateCode: string | undefined, hvacSystem: string | null | undefined): { kind: WaterHeaterKind; reason: string } {
  const st = (stateCode ?? '').toUpperCase()
  const baseline = HPWH_BASELINE_STATES[st]
  if (baseline) return { kind: 'heat-pump', reason: baseline }
  if (hvacSystem === 'ac-gas-furnace') return { kind: 'gas-tank', reason: 'gas service already at the house for the furnace — a gas storage heater is the practice' }
  if (ELECTRIC_TANK_STATES.has(st)) return { kind: 'electric-tank', reason: 'all-electric practice in the heat-pump states' }
  return { kind: 'electric-tank', reason: 'electric storage heater — the default without a state practice' }
}

/**
 * Storage volume by the household (DOE / ACCA first-hour-rating practice,
 * the sizing tables the manufacturers publish): 40 gal to two bedrooms and
 * a bath and a half, 50 gal for three bedrooms or two baths, 65 gal past
 * that; a heat pump heater a size up (slower recovery, 50 gal minimum).
 */
export function tankGallons(kind: WaterHeaterKind, bedrooms: number, baths: number): number | null {
  if (kind === 'tankless-gas' || kind === 'tankless-electric') return null
  let gal = bedrooms <= 2 && baths <= 1.5 ? 40 : bedrooms <= 3 && baths <= 2.5 ? 50 : bedrooms <= 4 ? 65 : 80
  if (kind === 'heat-pump') gal = Math.max(50, gal === 50 ? 65 : gal)
  return gal
}

/**
 * The federal minimum UEF for the class (10 CFR 430.32(d), 2015 standard,
 * medium draw pattern) — rounded drafting figures; the label governs.
 * Electric storage over 55 gal is a heat-pump class by that standard.
 */
export function uefMinimum(kind: WaterHeaterKind, gallons: number | null): number {
  switch (kind) {
    case 'electric-tank':
      return gallons !== null && gallons > 55 ? 2.0 : 0.92
    case 'gas-tank':
      return gallons !== null && gallons > 55 ? 0.76 : 0.6
    case 'heat-pump':
      return 2.0
    case 'tankless-gas':
      return 0.81
    case 'tankless-electric':
      return 0.91
  }
}

export function waterHeaterSpec(input: {
  choice?: WaterHeaterKind | null
  stateCode?: string
  hvacSystem?: string | null
  bedrooms: number
  baths: number
  /** The heater stands in a garage (the ignition-height stand, the pan). */
  inGarage: boolean
  /** The spec's seismic strapping applies (SDC D0–D2 states). */
  seismicStraps: boolean
}): WaterHeaterSpec {
  const picked = input.choice ? { kind: input.choice, reason: "the panel's choice" } : defaultWaterHeater(input.stateCode, input.hvacSystem)
  const kind = picked.kind
  const gallons = tankGallons(kind, input.bedrooms, input.baths)
  const uefMin = uefMinimum(kind, gallons)
  const notes: string[] = []
  let dims: readonly [number, number, number]
  let circuit: string
  let venting: WaterHeaterSpec['venting']
  let head: string
  switch (kind) {
    case 'electric-tank':
      dims = [gallons !== null && gallons >= 65 ? 0.66 : 0.56, gallons !== null && gallons >= 65 ? 1.55 : 1.5, gallons !== null && gallons >= 65 ? 0.66 : 0.56]
      circuit = '240 V 30 A dedicated, 10 AWG Cu (4.5 kW elements × 125 %, NEC 422.13 / 422.10)'
      venting = 'none'
      head = `Electric storage water heater — ${gallons} gal`
      break
    case 'gas-tank':
      dims = [gallons !== null && gallons >= 65 ? 0.6 : 0.5, gallons !== null && gallons >= 65 ? 1.6 : 1.5, gallons !== null && gallons >= 65 ? 0.6 : 0.5]
      circuit = 'none (atmospheric); 120 V 15 A where power-vented'
      venting = 'b-vent'
      head = `Gas storage water heater — ${gallons} gal, FVIR, 40 kBtu/h class`
      notes.push('gas piping to the heater per the adopted fuel-gas code (G2413 sizing); combustion air per G2407 — verify')
      break
    case 'heat-pump':
      dims = [0.63, gallons !== null && gallons >= 80 ? 1.9 : 1.75, 0.63]
      circuit = '240 V 30 A dedicated, 10 AWG Cu (hybrid element; a 120 V 15 A shared-circuit model where the utility program asks — verify the ordered unit)'
      venting = 'none'
      head = `Heat-pump water heater — ${gallons} gal hybrid`
      notes.push('heat-pump heater wants ≥ 700 ft³ of air (or ducted intake/exhaust) and a ¾" condensate drain to an approved receptor; ~45 dB — the garage or a mechanical room, not a bedroom closet (mfr listing) — verify')
      break
    case 'tankless-gas':
      dims = [0.45, 0.6, 0.25]
      circuit = '120 V 15 A (controls / fan)'
      venting = 'direct'
      head = 'Tankless gas water heater — 180–199 kBtu/h condensing'
      notes.push('¾" gas line sized for 199 kBtu/h at the appliance (G2413 — often 1" from the meter); 3" concentric PVC direct vent through the wall per the listing — verify')
      break
    case 'tankless-electric':
      dims = [0.4, 0.45, 0.12]
      circuit = '3 × 240 V 40 A (27 kW whole-house) — a 200 A service and a load calculation (NEC 220) — verify'
      venting = 'none'
      head = 'Tankless electric water heater — 27 kW whole-house'
      notes.push('an electric tankless heater draws 110 A+ at full fire: confirm the service size and the utility\'s demand rules before ordering')
      break
  }
  const standards = [
    `UEF ≥ ${uefMin} (10 CFR 430.32(d) federal minimum — the label governs)`,
    'T&P relief + full-size discharge to 6" of the floor (P2803)',
    ...(gallons !== null ? ['drain pan with ¾" drain where leakage damages (P2801.6)'] : []),
    ...(gallons !== null && input.inGarage && (kind === 'gas-tank' || kind === 'electric-tank' || kind === 'heat-pump') ? ['ignition source 18" above the garage floor (M1307.3)'] : []),
    ...(gallons !== null && input.seismicStraps ? ['seismic straps upper + lower thirds (P2801.8)'] : []),
    ...(gallons !== null ? ['thermal expansion tank on the cold inlet — closed system (P2903.4.2)'] : []),
  ]
  const label = `${head} — ${standards.join('; ')}; circuit ${circuit}${picked.reason === "the panel's choice" ? '' : ` — ${picked.reason}`}`
  return { kind, gallons, uefMin, dims, label, circuit, venting, reason: picked.reason, notes }
}
