/**
 * Takeoff engine — quantities are counted
 * from the ACTUAL members the other engines generated, never re-estimated
 * from areas or wall lengths. If the 3D X-ray shows 14 studs, the takeoff
 * says 14 studs. Pure function:
 * `(Member[], Fixture[], areas?) → TakeoffRow[]`, plus a cut-list export and
 * CSV / Markdown serializers for the panel's copy buttons.
 *
 * Every row carries a `section` — the per-system grouping the panel renders
 * as collapsible groups and the CSV keeps as its first column:
 * Wall framing / Floor / Roof / Foundation / Sheathing / Electrical /
 * Plumbing / HVAC / Fasteners / Flags.
 *
 * Estimating conventions implemented (the way a lumber desk actually quotes):
 *  - LUMBER  — pieces per (nominal size × stock length), PER SYSTEM. Each cut
 *    is rounded UP to the shortest stock stick that yields it (8/10/12/14/16/
 *    20 ft). Board feet use NOMINAL inches (bd-ft = w × h × L_ft / 12).
 *  - SHEETS  — 4x8 sheet counts, MEMBER-derived (NET areas — booked ==
 *    built, S4) wherever the engines emitted the layers/deck: wall
 *    sheathing (WSP), subfloor T&G, drywall, roof deck. The gross-area
 *    path (openings cut from the sheet, not deducted from the buy)
 *    survives only as the LOD-200 WALL fallback (WSP/drywall faceArea
 *    sums) and says 'gross' on those rows — their built-in allowance is
 *    the openings never deducted, so no waste factor stacks on top (B21e
 *    header honesty: the old header claimed ALL sheets were gross buys
 *    while the member rows booked net). The SUBFLOOR fallback is NOT
 *    gross — compute.ts deducts slab holes — so it states its
 *    net-of-floor-openings basis and carries the stated waste factor.
 *  - WASTE   — stated ordering allowances per material class (B21e, the
 *    B6 stated-factor precedent): the row keeps its member-derived NET
 *    quantity and prints '+X% waste ≈ buy' in the detail — a waste factor
 *    NEVER silently inflates member truth, so rows == members stays
 *    provable (S4). Defaults are industry estimating conventions
 *    (NAHB-style rules of thumb — verify for your job): sheet goods
 *    (WSP/drywall/subfloor/roof deck) +10% offcut; dimensional lumber
 *    +5% cull/damage ON TOP of the stock-length drop the pcs/bd-ft rows
 *    already buy; concrete pours +5% spillage/over-excavation, with the
 *    buy figure CEILED to the 0.1 yd³ ready-mix batch (a rounded buy
 *    that collapses onto the net would state a factor adding zero).
 *    The printed percents derive from the constants themselves. Counted
 *    hardware, fixtures, supplier SKUs (engineered headers, hoses,
 *    line-sets) and rule-of-thumb rows (mortar, grout) carry none.
 *    LAP factors are NOT waste and keep the opposite convention: seam/
 *    course overlap is INSTALLED material, so the vapor-retarder (+10%
 *    seam laps) and roof-underlayment (+10% course laps) quantities DO
 *    include the lap, stated on the row (B6/B17, unchanged).
 *  - CONCRETE — cubic yards per system (1 m³ = 1.30795 yd³); CMU counted
 *    each; grout by the grouted-cell count; mortar by the block count;
 *    rebar in linear feet.
 *  - HARDWARE — counted by dedicated ROLE (anchor bolts, hold-downs, joist
 *    hangers, plate washers) or role+material+system (hurricane ties are the
 *    roof engine's steel blocking) — never by label regex.
 *  - MEP RUNS — linear feet: pipe by size and material, duct by section,
 *    NM cable by gauge; electrical circuits from the fixtures' circuit meta.
 *  - FASTENERS — nails by type in POUNDS from data/fastening-schedule.json
 *    (IRC R602.3(1)) applied to the member counts, one connection per role.
 *  - FLAGS    — every engine-raised flag surfaces as its own line.
 */

import fastening from '../../data/fastening-schedule.json'
import { profileFamily } from './lgs-profiles'
import type { Fixture, FixtureKind, Member } from '../core/types'
import { formatFtIn, toFeet } from '../core/units'
import { LUMBER_SIZES, type LumberSize } from '../lumber'
import { circuitSchedule } from './electrical'

export type TakeoffRow = {
  section: string
  item: string
  detail: string
  quantity: number
  unit: string
}

/** Gross sheet-goods areas, computed by `computeLevel` from the wall/slab geometry. */
export type TakeoffAreas = {
  wallSheathingM2?: number
  subfloorM2?: number
  drywallM2?: number
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const SECTION_OF: Record<Member['system'], string> = {
  'wall-framing': 'Wall framing',
  'floor-framing': 'Floor',
  'roof-framing': 'Roof',
  foundation: 'Foundation',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hvac: 'HVAC',
}

const SECTION_ORDER = [
  'Wall framing',
  'Floor',
  'Roof',
  'Foundation',
  'Sheathing',
  'Electrical',
  'Plumbing',
  'HVAC',
  'Fasteners',
  'Flags',
] as const

// ---------------------------------------------------------------------------
// Lumber stock
// ---------------------------------------------------------------------------

/** Stock stick lengths (ft) every yard carries — even 2-ft increments. */
const STOCK_LENGTHS_FT = [8, 10, 12, 14, 16, 20] as const
const MAX_STOCK_FT = 20

/**
 * Float guard when comparing metric cut lengths against imperial stock:
 * an 8-ft plate computed as feet(8) must land in 8-ft stock, not 10-ft.
 * 1e-4 ft ≈ 0.03 mm — far below framing tolerance.
 */
const LEN_EPS_FT = 1e-4

/** 1 m³ in cubic yards — ready-mix is ordered by the yard. */
const M3_TO_YD3 = 1.30795
/** A 4x8 sheet covers 32 ft² = 2.9729 m². */
const SHEET_M2 = 32 / 10.7639
/** ft² per m² — membranes (WRB, vapor retarder) book by the square foot. */
const SQFT = 1 / 0.09290304
/** R506.2.3 vapor retarder buys +10% over the field area: strip-seam laps
 * and stemwall turn-ups (stated on the row so the estimate is auditable).
 * LAP factor, not waste — the overlap is installed material, so it scales
 * the booked quantity (see the WASTE convention in the header). */
const VAPOR_LAP_FACTOR = 1.1
/** R905.1.1 roof underlayment buys +10% over the deck area: 2"/4" course
 * laps and eave/rake edge trim (stated on the row — B6). LAP factor like
 * the vapor retarder above, not waste. */
const UNDERLAYMENT_LAP_FACTOR = 1.1
/** Stated WASTE factors (B21e) — ordering allowances, never quantity
 * multipliers: the booked quantity stays the member-derived net and the
 * waste-inclusive order figure prints in the row detail ('+X% waste ≈ …').
 * Values are industry estimating defaults (NAHB-style rules of thumb —
 * verify for your job), deliberately coarse: no invented precision. */
/** Sheet goods (WSP/drywall/subfloor/roof deck): +10% offcut. */
const SHEET_WASTE = 0.1
/** Dimensional lumber: +5% cull/damage — the cut DROP is already bought
 * via stock-length rounding, so this covers culls/breakage only. */
const LUMBER_WASTE = 0.05
/** Concrete pours: +5% spillage/over-excavation. */
const CONCRETE_WASTE = 0.05
/** '+X%' label text derived from the factor ITSELF — the printed percent
 * can never drift from the arithmetic if a constant moves (skeptic r1
 * advisory; the lap rows below share the same self-consistency). */
const pctOf = (factor: number): string => `${Math.round(factor * 100)}%`
/** Grout per filled 8" CMU cell (~0.3 ft³ with the core deducted). */
const GROUT_M3_PER_CELL = 0.0085
/** Mortar: one 80-lb Type S bag lays ~20 blocks (supplier rule of thumb). */
const BLOCKS_PER_MORTAR_BAG = 20

/**
 * Only wood materials belong in the lumber section. Concrete lintels and
 * steel hardware are counted in their own sections even if a future engine
 * ever tags them with a nominal size.
 */
const WOOD_MATERIALS = new Set<Member['material']>(['lumber', 'pt-lumber', 'engineered'])

type StockPick = { stockFt: number; pieces: number; splice: boolean }

/**
 * Round one cut length UP to purchasable stock. Cuts longer than the longest
 * stick (20 ft) cannot be bought in one piece — they take ceil(L/20) sticks
 * and a field splice (lapped/scabbed per practice; flagged in the detail).
 */
function stockFor(cutLengthM: number): StockPick {
  const cutFt = toFeet(cutLengthM)
  for (const stockFt of STOCK_LENGTHS_FT) {
    if (cutFt <= stockFt + LEN_EPS_FT) return { stockFt, pieces: 1, splice: false }
  }
  // ASSUMPTION: over-length runs are split into 20-ft sticks; real crews
  // would optimize splice locations over supports.
  return {
    stockFt: MAX_STOCK_FT,
    pieces: Math.ceil((cutFt - LEN_EPS_FT) / MAX_STOCK_FT),
    splice: true,
  }
}

/** Nominal inches from the size key: '2x10' → [2, 10]. */
function nominalOf(size: LumberSize): [number, number] {
  const parts = size.split('x')
  return [Number(parts[0] ?? 0), Number(parts[1] ?? 0)]
}

/** Board feet per lineal foot of a nominal size: 2x4 → 2·4/12 = 2/3 bd-ft/ft. */
function boardFeetPerFoot(size: LumberSize): number {
  const [w, h] = nominalOf(size)
  return (w * h) / 12
}

const round1 = (n: number): number => Math.round(n * 10) / 10

// ---------------------------------------------------------------------------
// Fasteners (IRC R602.3(1) via data/fastening-schedule.json)
// ---------------------------------------------------------------------------

type NailType = keyof typeof fastening.nails

/**
 * Screws per 4x8 sheet on steel studs (LGS Phase 1) — DERIVED from the
 * verified IRC R603.2.5 / Table R603.3.2(1) spacings so the printed count
 * can never drift from the schedule: a 4x8 sheet stood VERTICAL on 16"
 * o.c. supports (the stated layout assumption) has two 8-ft edge studs
 * screwed at the edge spacing, two interior field studs at the field
 * spacing, and its top/bottom edges at the edge spacing (corners counted
 * once). Sheathing (6/12) ≈ 66/sheet; gypsum (12/12) ≈ 42.
 */
export function screwsPerSheet(edgeIn: number, fieldIn: number): number {
  const heightIn = 96
  const widthIn = 48
  const supportIn = 16
  const edgeStuds = 2 * (Math.floor(heightIn / edgeIn) + 1)
  const fieldStuds = Math.max(0, Math.round(widthIn / supportIn) - 1)
  const field = fieldStuds * (Math.floor(heightIn / fieldIn) + 1)
  const horizontalEdges = 2 * (Math.floor(widthIn / edgeIn) + 1 - 2) // corners shared
  return edgeStuds + field + horizontalEdges
}

/**
 * Fastening connections per member role, straight from the R602.3(1) data.
 * Roles with several real connections carry several entries — a joist is
 * end-nailed at the rim (16d) AND toe-nailed at its bearing (10d), a rafter
 * takes 16d at the ridge and 10d toe-nails at the plate — so the per-gauge
 * pounds match the schedule instead of over-weighting one nail type.
 */
type Connection = { nail: NailType; count?: number; perFt?: number }
const ROLE_CONNECTIONS: Partial<Record<Member['role'], Connection[]>> = {
  stud: [{ nail: '16d-common', count: 4 }], // 2 per end (stud-to-plate-end)
  'king-stud': [{ nail: '16d-common', count: 4 }],
  cripple: [{ nail: '16d-common', count: 4 }], // cripple-to-plate
  trimmer: [{ nail: '16d-common', perFt: 1.5 }], // trimmer-to-king
  'bottom-plate': [{ nail: '16d-common', perFt: 0.75 }],
  'top-plate': [{ nail: '16d-common', perFt: 0.75 }], // doubleTopPlate-run
  'cap-plate': [{ nail: '16d-common', perFt: 0.75 }],
  header: [{ nail: '16d-common', count: 8 }], // header-to-king, 4 per end
  sill: [{ nail: '16d-common', count: 4 }], // sill-to-trimmer
  'fire-blocking': [{ nail: '16d-common', count: 4 }],
  backing: [{ nail: '10d-common', count: 4 }],
  blocking: [{ nail: '10d-common', count: 4 }], // blocking-to-joist
  joist: [
    { nail: '16d-common', count: 3 }, // joist-to-rim end nails
    { nail: '10d-common', count: 3 }, // joist-to-plate toe-nails
  ],
  'rim-joist': [{ nail: '10d-common', count: 3 }], // joist-to-plate-toe
  rafter: [
    { nail: '16d-common', count: 3 }, // rafter-to-ridge
    { nail: '10d-common', count: 3 }, // rafter-to-plate-toe
  ],
  'jack-rafter': [
    { nail: '16d-common', count: 3 }, // cheek to hip/valley
    { nail: '10d-common', count: 3 }, // plate toe
  ],
  'collar-tie': [{ nail: '10d-common', count: 6 }], // 3 per end
  'ceiling-joist': [{ nail: '10d-common', count: 6 }], // bearing + lap
  // R602.3(1) Item 6 "Rafter or roof truss to plate — 3-10d common" (the one
  // truss row in data/framing-tables.json): a truss's SITE fastening is its
  // heel toe-nails to the plate; chord and web joints are factory metal
  // plates and book NO site nails — hence no 'truss-web' entry.
  'truss-chord': [{ nail: '10d-common', count: 3 }], // heel toe-nail to plate
  outlooker: [{ nail: '10d-common', count: 4 }],
  fascia: [{ nail: '16d-common', perFt: 0.75 }],
}

/** Hardware nail loads (json `hardware` block). */
const HANGER_NAILS = fastening.hardware['joist-hanger'].nailsPer
const TIE_NAILS = fastening.hardware['hurricane-tie'].nailsPer

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Display name + the code/practice each device count answers to. */
const FIXTURE_ROWS: Record<FixtureKind, { item: string; detail: string }> = {
  receptacle: { item: 'Receptacles', detail: 'NEC 210.52 spacing' },
  'receptacle-gfci': { item: 'GFCI receptacles', detail: 'NEC 210.8 wet locations' },
  'receptacle-wr-gfci': {
    item: 'WR GFCI receptacles (outdoor)',
    detail: 'NEC 210.52(E) + 406.9(A) weather-resistant',
  },
  switch: { item: 'Switches', detail: 'wall controls' },
  light: { item: 'Lights', detail: 'ceiling/wall luminaires' },
  'smoke-alarm': { item: 'Smoke alarms', detail: 'IRC R314' },
  'co-alarm': { item: 'CO alarms', detail: 'IRC R315.3 — garage / fuel appliance' },
  panel: { item: 'Electrical panels', detail: 'load center' },
  'stub-out': { item: 'Plumbing stub-outs', detail: 'supply/drain' },
  'vent-stack': { item: 'Vent stacks', detail: 'DWV through-roof' },
  register: { item: 'Supply registers', detail: 'conditioned air' },
  return: { item: 'Return grilles', detail: 'return air path' },
  equipment: { item: 'Mechanical equipment', detail: 'AHU / condenser' },
  'water-heater': { item: 'Water heaters', detail: 'tank/tankless' },
  'water-meter': { item: 'Water meters', detail: 'service entry (P2903.7)' },
  cleanout: { item: 'Cleanouts', detail: 'IRC P3005.2' },
  'exhaust-fan': { item: 'Exhaust fans', detail: 'bath/dryer ventilation (M1505)' },
  thermostat: { item: 'Thermostats', detail: 'zone control' },
  'electric-meter': { item: 'Electric meters', detail: 'service entrance (NEC 230.66)' },
  disconnect: { item: 'AC disconnects', detail: 'NEC 440.14 — within sight of the unit' },
}

/** Stable panel ordering for fixture rows (matches FixtureKind declaration). */
const FIXTURE_ORDER: readonly FixtureKind[] = [
  'receptacle',
  'receptacle-gfci',
  'receptacle-wr-gfci',
  'switch',
  'light',
  'smoke-alarm',
  'co-alarm',
  'panel',
  'stub-out',
  'vent-stack',
  'register',
  'return',
  'equipment',
  'water-heater',
  'water-meter',
  'cleanout',
  'thermostat',
  'exhaust-fan',
  'electric-meter',
  'disconnect',
]

// ---------------------------------------------------------------------------
// The takeoff
// ---------------------------------------------------------------------------

export function computeTakeoff(
  members: Member[],
  fixtures: Fixture[],
  areas: TakeoffAreas = {},
): TakeoffRow[] {
  const rows: TakeoffRow[] = []
  const push = (section: string, item: string, detail: string, quantity: number, unit: string) =>
    rows.push({ section, item, detail, quantity, unit })

  // Nail tallies key on type + an optional VARIANT suffix: the roof deck's
  // 8d poundage books on its OWN row (B6 — Table R602.3(1) lists roof and
  // wall sheathing as separate schedule lines; one blended 8d row would
  // hide which line the pounds answer to). No variant = the historic rows,
  // byte-equal.
  const nails = new Map<string, number>()
  const addNails = (type: NailType, count: number, variant?: string) => {
    const key = variant ? `${type}|${variant}` : type
    nails.set(key, (nails.get(key) ?? 0) + count)
  }

  // ---- LUMBER: pieces per (system × size × stock length) + board feet ----
  // Pressure-treated stock is a DIFFERENT SKU (ground/masonry contact — the
  // mixed-wall seam sill on its bond beam, mudsills): PT members book on
  // their own `<size> PT` rows instead of blending into the untreated count.
  const bySystem = new Map<string, Map<string, Member[]>>()
  // Engineered WALL headers (over prescriptive span) are supplier SKUs —
  // booking the drawn placeholder as dimensional sticks lied both ways:
  // bd-ft for lumber that must not be bought, no line for the beam that
  // must (verify night-6). Floor girders keep their dimensional rows —
  // they're drawn at full size (booked == built) with a verify note.
  const engineeredHeaders: Member[] = []
  for (const m of members) {
    if (!m.size || !WOOD_MATERIALS.has(m.material)) continue
    if (m.material === 'engineered' && m.system === 'wall-framing') {
      engineeredHeaders.push(m)
      continue
    }
    const section = SECTION_OF[m.system]
    const key = m.material === 'pt-lumber' ? `${m.size} PT` : m.size
    const sizes = bySystem.get(section) ?? new Map<string, Member[]>()
    const bucket = sizes.get(key)
    if (bucket) bucket.push(m)
    else sizes.set(key, [m])
    bySystem.set(section, sizes)
  }

  for (const section of SECTION_ORDER) {
    const bySize = bySystem.get(section)
    if (!bySize) continue
    // Iterate the catalog order so rows read 2x4 → 2x6 → … → 6x6, with a
    // size's PT variant right after its untreated rows.
    for (const size of LUMBER_SIZES) {
      for (const item of [size, `${size} PT`]) {
        const pieces = bySize.get(item)
        if (!pieces) continue
        const ptNote = item.endsWith(' PT') ? ' (pressure-treated)' : ''
        const plain = new Map<number, number>() // stockFt → sticks
        const spliced = new Map<number, number>() // stockFt → sticks (over-length)
        let boardFeet = 0
        const bfPerFt = boardFeetPerFoot(size)
        for (const member of pieces) {
          const pick = stockFor(member.length)
          const tally = pick.splice ? spliced : plain
          tally.set(pick.stockFt, (tally.get(pick.stockFt) ?? 0) + pick.pieces)
          // Board feet are billed on the PURCHASED stick — you pay for the drop.
          boardFeet += pick.pieces * pick.stockFt * bfPerFt
        }
        // Stated waste (B21e): the quantity stays the exact member-derived
        // stick count; the +5% cull/damage order figure prints beside it.
        const lumberWaste = (n: number): string =>
          ` — +${pctOf(LUMBER_WASTE)} waste ≈ ${Math.ceil(n * (1 + LUMBER_WASTE))} pcs`
        for (const stockFt of [...plain.keys()].sort((a, b) => a - b)) {
          const n = plain.get(stockFt) ?? 0
          push(section, item, `${stockFt} ft stock${ptNote}${lumberWaste(n)}`, n, 'pcs')
        }
        for (const stockFt of [...spliced.keys()].sort((a, b) => a - b)) {
          const n = spliced.get(stockFt) ?? 0
          push(
            section,
            item,
            `${stockFt} ft stock (field splice — run exceeds 20 ft)${ptNote}${lumberWaste(n)}`,
            n,
            'pcs',
          )
        }
        push(section, item, 'board feet', round1(boardFeet), 'bd-ft')
      }
    }
  }
  if (engineeredHeaders.length > 0) {
    const lf = engineeredHeaders.reduce((sum, m) => sum + toFeet(m.length), 0)
    push(
      'Wall framing',
      'Engineered header (LVL/PSL — by supplier)',
      'exceeds prescriptive header span — see flags',
      engineeredHeaders.length,
      'pcs',
    )
    push('Wall framing', 'Engineered header (LVL/PSL — by supplier)', 'linear feet', round1(lf), 'lf')
  }

  // Framing nails from the member counts (per-role connection list).
  for (const m of members) {
    if (!WOOD_MATERIALS.has(m.material)) continue
    for (const conn of ROLE_CONNECTIONS[m.role] ?? []) {
      addNails(conn.nail, conn.count ?? Math.ceil((conn.perFt ?? 0) * toFeet(m.length)))
    }
  }

  // ---- SHEATHING: 4x8 sheet counts, members first (LOD-400 audit B4) ----
  // One material, ONE buy row: when the layer engine emitted sheathing /
  // drywall MEMBERS for this level, the member-derived tally below is the
  // single booked row (members are truth) and the gross-area row is
  // SUPPRESSED — before this gate the same scene booked 'Wall sheathing |
  // 34 sheets gross' AND 'Sheathing 7/16" WSP | ~33 sheets net', so a
  // purchaser summing sections ordered ~2×. The gross path survives only
  // as the LOD-200 fallback where no layers are framed (the subfloor deck
  // fallback pattern below).
  // SYSTEM filter (B6, the B4 skeptic's advisory): these gates suppress the
  // WALL gross rows, so only WALL-framing layer members may trip them — the
  // roof deck is role 'sheathing' too, and without the filter a roofed
  // LOD-200-wall scene would lose its wall gross row entirely while the
  // roof's sqft poured into the wall member tally below.
  const hasSheathingMembers = members.some(
    (m) => m.role === 'sheathing' && m.system === 'wall-framing',
  )
  const hasDrywallMembers = members.some(
    (m) => m.role === 'drywall' && m.system === 'wall-framing',
  )
  const wspSheets = hasSheathingMembers
    ? 0
    : Math.ceil((areas.wallSheathingM2 ?? 0) / SHEET_M2)
  // Subfloor books from the DECK MEMBERS when the floor engine emitted
  // them (LOD-400 audit B3: the area path booked 33 sheets against zero
  // geometry — booked == built now); the area path stays as the LOD-200
  // fallback where no deck is framed.
  const deckAreaM2 = members
    .filter((m) => m.role === 'subfloor')
    .reduce((sum, m) => sum + m.dims[0] * m.dims[2], 0)
  const subfloorFromDeck = deckAreaM2 > 0
  const subfloorSheets = Math.ceil(
    (subfloorFromDeck ? deckAreaM2 : (areas.subfloorM2 ?? 0)) / SHEET_M2,
  )
  const drywallSheets = hasDrywallMembers ? 0 : Math.ceil((areas.drywallM2 ?? 0) / SHEET_M2)
  if (wspSheets > 0) {
    push('Sheathing', 'Wall sheathing 7/16" WSP', '4x8 sheets, gross (openings cut out)', wspSheets, 'sheets')
    addNails('8d-common', wspSheets * fastening.connections['wallSheathing-sheet'].count)
  }
  if (subfloorSheets > 0) {
    // B21e subfloor label fix: the member-derived path (B3) books NET deck
    // area (stair/chase holes carved) but the row still claimed '4x8
    // sheets, gross' — a builder read a gross allowance that wasn't there.
    // The LOD-200 area fallback is NOT gross either (skeptic r1 F2):
    // compute.ts deducts slab HOLES (stairwells) from the polygon area, so
    // the fallback is a net-of-floor-openings number — it states that
    // basis and joins the stated-waste convention like the member path.
    // Only the WALL fallbacks (WSP/drywall faceArea sums) stay 'gross'.
    push(
      'Sheathing',
      'Subfloor 3/4" T&G',
      subfloorFromDeck
        ? `4x8 sheets from deck members, net — +${pctOf(SHEET_WASTE)} waste ≈ ${Math.ceil((deckAreaM2 * (1 + SHEET_WASTE)) / SHEET_M2)} sheets`
        : `4x8 sheets from slab area, net of floor openings — +${pctOf(SHEET_WASTE)} waste ≈ ${Math.ceil(((areas.subfloorM2 ?? 0) * (1 + SHEET_WASTE)) / SHEET_M2)} sheets`,
      subfloorSheets,
      'sheets',
    )
    addNails('8d-common', subfloorSheets * fastening.connections['subfloor-sheet'].count)
  }
  if (drywallSheets > 0) {
    // B21e header honesty: this fallback area is faceArea sums (openings
    // NOT deducted, compute.ts) — it says 'gross' like its WSP/subfloor
    // fallback siblings instead of leaving the basis unstated.
    push(
      'Sheathing',
      'Drywall 1/2"',
      '4x8 sheets, gross — both faces of interior walls',
      drywallSheets,
      'sheets',
    )
  }

  // ---- CONCRETE + MASONRY per system ----
  // Foundation pours split by ELEMENT (footing / stemwall / slab field /
  // other) so each can be ordered and formed separately; other systems'
  // pours (CMU lintels, bond beams) stay pooled per section.
  // NOTE: the old 'slab-edge' → 'slab edge' mapping is GONE with its role —
  // no engine ever emitted it (the stemwall detail replaced the turned-down
  // edge, round-10), so it mapped a pour nothing built (LOD-400 audit B17).
  // The slab-on-grade FIELD books here instead, derived from the real
  // members the foundation engine now emits.
  const FOUNDATION_POUR: Partial<Record<Member['role'], string>> = {
    footing: 'footings',
    stemwall: 'stemwalls',
    slab: 'slab field (3-1/2" slab-on-grade, R506.1)',
  }
  const concretePours = new Map<string, { section: string; detail: string; m3: number }>()
  let blockCount = 0
  let groutedCells = 0
  // Condenser pads (hvac 'equipment' concrete) are counted EACH below — a 4"
  // equipment pad is placed/precast, not a formed pour (S4: the row mirrors
  // the rendered pad members, never a phantom 'lintels/beams' volume).
  let condenserPads = 0
  // Pad plan size, mirrored from the RENDERED pad member (S4 — never a
  // constant that could drift from the engine): square pads, dims[0].
  let condenserPadSide = 0
  for (const m of members) {
    if (m.material !== 'concrete') continue
    if (m.role === 'block') {
      blockCount += 1
      if (m.grouted) groutedCells += 1
      continue
    }
    if (m.system === 'hvac' && m.role === 'equipment') {
      condenserPads += 1
      condenserPadSide = Math.max(condenserPadSide, m.dims[0])
      continue
    }
    const section = SECTION_OF[m.system]
    const detail =
      section === 'Foundation'
        ? (FOUNDATION_POUR[m.role] ?? 'other pours')
        : 'lintels/beams'
    const key = `${section}|${detail}`
    const pour = concretePours.get(key) ?? { section, detail, m3: 0 }
    pour.m3 += m.dims[0] * m.dims[1] * m.dims[2]
    concretePours.set(key, pour)
  }
  for (const pour of concretePours.values()) {
    if (pour.m3 <= 0) continue
    // Ready-mix trucks batch to 0.1 yd³; never show a real pour as 0.0.
    // Stated waste (B21e): the quantity stays the member-derived pour
    // volume; the +5% spillage/over-excavation order figure prints beside
    // it. Grout/mortar keep their rule-of-thumb rows — no stacked factors.
    // The BUY figure CEILS to the 0.1 yd³ batch (skeptic r1 F1): round1
    // could round the +5% back DOWN onto the net figure — a stated factor
    // that adds zero — while every other class already ceils its buy.
    const netYd = Math.max(0.1, round1(pour.m3 * M3_TO_YD3))
    const buyYd = Math.ceil(pour.m3 * M3_TO_YD3 * (1 + CONCRETE_WASTE) * 10) / 10
    // Sub-batch display collapse (B21e r2 advisory): on small pours 5% is
    // smaller than one 0.1 yd³ display step, so the net quantity and the
    // ceiled order figure PRINT as the same number ('0.6 … ≈ 0.6 yd³') and
    // the stated factor reads as adding zero. Say why the figures meet —
    // wording only, the quantity stays the net pour volume.
    const collapseNote =
      buyYd === netYd
        ? ' (waste smaller than the 0.1 yd³ display step — net and order figures meet at display rounding)'
        : ''
    push(
      pour.section,
      'Concrete',
      `${pour.detail} — +${pctOf(CONCRETE_WASTE)} waste ≈ ${buyYd} yd³${collapseNote}`,
      netYd,
      'yd³',
    )
  }
  // ---- vapor retarder (B17): booked from the membrane MEMBERS (S4) ----
  // Plan area (dims run × width — the strips mirror the slab field 1:1) at
  // the stated lap factor. Member-derived like every other booked row:
  // no members, no row.
  const vaporM2 = members
    .filter((m) => m.role === 'vapor-retarder')
    .reduce((sum, m) => sum + m.dims[0] * m.dims[2], 0)
  if (vaporM2 > 0) {
    push(
      'Foundation',
      'Vapor retarder 6-mil poly',
      `under slab, +${pctOf(VAPOR_LAP_FACTOR - 1)} seam laps/turn-ups (R506.2.3)`,
      round1(vaporM2 * VAPOR_LAP_FACTOR * SQFT),
      'sqft',
    )
  }
  if (condenserPads > 0) {
    // Size + basis on the buy line (verify-round REC-2): the rendered pad
    // side (1.0 m = 40"-class stock, mep-rules padSideM) × the 4" thickness.
    push(
      'HVAC',
      'Condenser pads',
      `${round1(condenserPadSide)} × ${round1(condenserPadSide)} m × 4" concrete equipment pad (40"-class stock; IRC M1403)`,
      condenserPads,
      'pcs',
    )
  }
  if (blockCount > 0) {
    push('Wall framing', 'CMU block', '8x8x16 running bond', blockCount, 'pcs')
    push(
      'Wall framing',
      'Mortar (Type S)',
      `~${BLOCKS_PER_MORTAR_BAG} blocks per 80-lb bag`,
      Math.ceil(blockCount / BLOCKS_PER_MORTAR_BAG),
      'bags',
    )
    if (groutedCells > 0) {
      push(
        'Wall framing',
        'Grout',
        `${groutedCells} reinforced cells (R606.12)`,
        Math.max(0.1, round1(groutedCells * GROUT_M3_PER_CELL * M3_TO_YD3)),
        'yd³',
      )
    }
  }

  // ---- LGS steel framing (Phase 1): by DESIGNATOR + length, never weight --
  // Steel wall members carry their AISI designator in the dedicated
  // `profile` field (the role/field doctrine — no label parsing). Each
  // designator books ONE row: pieces in the detail, LINEAR FEET as the
  // quantity. WEIGHT IS NOT BOOKED: the catalog carries no verified lb/ft
  // (data/lgs-profiles.json ships dims only), and inventing pounds from a
  // section model would break the never-invent-dims rule — the row says so
  // ('weight requires vendor data').
  const steelWallIds = new Set<string>()
  {
    const byProfile = new Map<string, { pcs: number; lf: number }>()
    for (const m of members) {
      if (m.system !== 'wall-framing' || m.profile === undefined) continue
      steelWallIds.add(m.sourceId)
      const tally = byProfile.get(m.profile) ?? { pcs: 0, lf: 0 }
      tally.pcs += 1
      tally.lf += toFeet(m.length)
      byProfile.set(m.profile, tally)
    }
    for (const profile of [...byProfile.keys()].sort()) {
      const tally = byProfile.get(profile) as { pcs: number; lf: number }
      // Grade rides the row (round-1 F3b — 'Gr 50' printed nowhere on the
      // set): from the catalog row's verified yieldKsi; vendor designators
      // outside genericFamilies print bare (their grade is the vendor's).
      const fam = profileFamily(profile)
      push(
        'Wall framing',
        `LGS ${profile}${fam ? ` (Gr ${fam.yieldKsi})` : ''}`,
        `${tally.pcs} pcs, cut to length (roll-formed) — weight requires vendor data (no verified lb/ft in the catalog)`,
        round1(tally.lf),
        'lf',
      )
    }
    // R603.3.3 strap bracing books by LENGTH on its own role — B9's portal
    // 'strap' census is untouched.
    const lgsStraps = members.filter((m) => m.role === 'strap-bracing')
    if (lgsStraps.length > 0) {
      push(
        'Wall framing',
        'LGS strap bracing 1-1/2" × 33 mil',
        `horizontal stud bracing rows (R603.3.3), both faces — ${lgsStraps.length} runs; end anchorage per detail`,
        round1(lgsStraps.reduce((sum, m) => sum + toFeet(m.length), 0)),
        'lf',
      )
    }
    // Steel-to-steel screws (ASTM C1513, the VERIFIED Table R603.3.2(1)
    // line): 2 × No. 8 per stud-to-track joint — one through each flange —
    // and every vertical meets track at BOTH ends. Exact member-derived
    // count, the nails-from-members convention.
    const verticals = members.filter(
      (m) =>
        m.system === 'wall-framing' &&
        m.profile !== undefined &&
        (m.role === 'stud' || m.role === 'king-stud' || m.role === 'trimmer' || m.role === 'cripple'),
    ).length
    if (verticals > 0) {
      push(
        'Fasteners',
        'Screws No. 8 self-drilling (stud-to-track)',
        `ASTM C1513 — 2 per flange pair, both member ends (Table R603.3.2(1)); ${verticals} verticals × 4`,
        verticals * 4,
        'pcs',
      )
    }
  }
  // Steel-wall SHEET GOODS fasten with SCREWS, not nails (IRC R603.2.5 /
  // Table R603.3.2(1) — the verified schedule): the member-derived layer
  // tally below subtracts the steel walls' sheathing sheets from the 8d
  // nail basis and books No. 8 / No. 6 screw rows instead. Zero steel
  // walls = arithmetic identical to master (byte-parity). The LOD-200
  // gross fallback stays whole (its single area sum carries no per-wall
  // split and makes no code claims — stated in the Phase-1 manifest).
  let steelSheathingSqft = 0
  let steelDrywallSqft = 0
  for (const m of members) {
    if (m.system !== 'wall-framing' || !steelWallIds.has(m.sourceId)) continue
    if (m.role === 'sheathing') steelSheathingSqft += m.dims[0] * m.dims[1] * SQFT
    if (m.role === 'drywall') steelDrywallSqft += m.dims[0] * m.dims[1] * SQFT
  }

  // ---- wall assembly layers (round 14): sheet goods by AREA ----
  // Drywall/sheathing/WRB/cladding members carry [len, height, t] dims —
  // area = len × height. 4×8 sheets for board goods; sqft for membranes.
  // Insulation batts (engineering panel) book by area PER TYPE + R — the
  // label prefix ('batt R-13') is the grouping key, so two walls at
  // different R values buy on separate rows.
  const layerTallies = new Map<string, { item: string; sqft: number; detail: string }>()
  for (const m of members) {
    // WALL rows tally WALL layers only (B6 system filter): the roof deck
    // and underlayment share the sheathing/wrb roles but book on their own
    // member-derived Roof rows below — roof sqft never lands in wall rows.
    if (m.system !== 'wall-framing') continue
    if (
      m.role !== 'drywall' &&
      m.role !== 'sheathing' &&
      m.role !== 'wrb' &&
      m.role !== 'cladding' &&
      m.role !== 'insulation'
    )
      continue
    const item =
      m.role === 'drywall'
        ? 'Drywall 1/2"'
        : m.role === 'sheathing'
          ? 'Sheathing 7/16" WSP'
          : m.role === 'wrb'
            ? 'WRB (housewrap/felt)'
            : m.role === 'insulation'
              ? `Insulation — ${(m.label ?? 'batt').split(' (')[0] ?? 'batt'}`
              : `Cladding — ${(m.label ?? 'siding').split(' (')[0] ?? 'siding'}`
    const detail = m.role === 'insulation' ? 'stud bays, by area' : 'net of openings'
    const tally = layerTallies.get(item) ?? { item, sqft: 0, detail }
    tally.sqft += m.dims[0] * m.dims[1] * SQFT
    layerTallies.set(item, tally)
  }
  for (const tally of layerTallies.values()) {
    const isBoard = tally.item.startsWith('Drywall') || tally.item.startsWith('Sheathing')
    const sheetCount = isBoard ? Math.ceil(tally.sqft / 32) : 0
    // Stated waste on the BOARD goods only (B21e): quantity stays the net
    // member area; the +10% offcut order figure prints beside the sheet
    // count. Membranes (WRB) and cladding/insulation keep their own
    // conventions — no invented factors.
    const sheets = isBoard
      ? ` (~${sheetCount} 4x8 sheets) — +${pctOf(SHEET_WASTE)} waste ≈ ${Math.ceil((tally.sqft * (1 + SHEET_WASTE)) / 32)} sheets`
      : ''
    push('Wall framing', tally.item, `${tally.detail}${sheets}`, round1(tally.sqft), 'sqft')
    // Fastener basis == the booked row (B4): when the member tally is the
    // surviving sheathing row, the 8d WSP nail poundage keys off ITS sheet
    // count — never off the suppressed gross row a purchaser no longer
    // sees. STEEL walls' sheets leave the nail basis (they screw per
    // R603.2.5 — the screw rows below carry them); zero steel = the
    // identical sheetCount arithmetic.
    if (tally.item.startsWith('Sheathing')) {
      const nailSheets =
        steelSheathingSqft > 0
          ? Math.ceil(Math.max(0, tally.sqft - steelSheathingSqft) / 32)
          : sheetCount
      addNails('8d-common', nailSheets * fastening.connections['wallSheathing-sheet'].count)
    }
  }
  // Screw rows for the steel walls' sheet goods — counts DERIVED from the
  // verified spacings (R603.2.5: No. 8 @ 6" panel edges / 12" field for
  // structural sheathing; No. 6 @ 12" for gypsum) on a stated layout
  // assumption (4x8 sheet stood vertical on 16" o.c. supports), so the
  // printed figures can never drift from the schedule constants.
  if (steelSheathingSqft > 0) {
    const sheets = Math.ceil(steelSheathingSqft / 32)
    const perSheet = screwsPerSheet(6, 12)
    push(
      'Fasteners',
      'Screws No. 8 (sheathing to steel)',
      `@ 6" edges / 12" field (R603.2.5) — ${sheets} steel-wall sheets × ${perSheet} (4x8 vertical, 16" o.c. assumed)`,
      sheets * perSheet,
      'pcs',
    )
  }
  if (steelDrywallSqft > 0) {
    const sheets = Math.ceil(steelDrywallSqft / 32)
    const perSheet = screwsPerSheet(12, 12)
    push(
      'Fasteners',
      'Screws No. 6 bugle-head (gypsum to steel)',
      `@ 12" (R603.2.5) — ${sheets} steel-wall sheets × ${perSheet} (4x8 vertical, 16" o.c. assumed)`,
      sheets * perSheet,
      'pcs',
    )
  }

  // ---- roof deck + underlayment + drip edge (LOD-400 B6) ----
  // Member-derived, the B4 convention: booked == built, no gross fallback
  // (an LOD-200 roof has no deck to buy yet). Deck/membrane panels carry
  // [along, t, slope width] dims — surface area = dims[0] × dims[2].
  const roofDeckM2 = members
    .filter((m) => m.role === 'sheathing' && m.system === 'roof-framing')
    .reduce((sum, m) => sum + m.dims[0] * m.dims[2], 0)
  if (roofDeckM2 > 0) {
    const roofSheets = Math.ceil((roofDeckM2 * SQFT) / 32)
    // F2 (round-1 examiner): tapered planes tile conservatively INSIDE the
    // hip/arris lines — the buy row says so like the underlayment states
    // its lap factor, so a purchaser knows this number carries no waste.
    const underTiled = members.some(
      (m) =>
        m.role === 'sheathing' &&
        m.system === 'roof-framing' &&
        m.label?.includes('under-tile'),
    )
    // Stated waste (B21e): net member area stays the quantity; the +10%
    // offcut order figure prints beside it. The under-tile caveat is a
    // SEPARATE honesty item: the tapered-plane shortfall is exact and
    // scene-dependent (member labels state the coverage %) — the generic
    // stated waste does not cover it, and the row says so.
    push(
      'Roof',
      'Roof sheathing 7/16" WSP',
      `deck panels, from members (~${roofSheets} 4x8 sheets, R803.2) — +${pctOf(SHEET_WASTE)} waste ≈ ${Math.ceil((roofDeckM2 * SQFT * (1 + SHEET_WASTE)) / 32)} sheets${
        underTiled
          ? '; tapered planes conservatively under-tiled (see member labels) — shortfall NOT covered by the stated waste'
          : ''
      }`,
      round1(roofDeckM2 * SQFT),
      'sqft',
    )
    // Fastener basis == the booked row (B4), on the roof deck's OWN 8d
    // line — never blended into the wall-sheathing 8d row (B6 re-key).
    addNails(
      '8d-common',
      roofSheets * fastening.connections['roofSheathing-sheet'].count,
      'roof deck',
    )
  }
  const underlaymentM2 = members
    .filter((m) => m.role === 'wrb' && m.system === 'roof-framing')
    .reduce((sum, m) => sum + m.dims[0] * m.dims[2], 0)
  if (underlaymentM2 > 0) {
    push(
      'Roof',
      'Roof underlayment',
      `one layer felt/synthetic, +${pctOf(UNDERLAYMENT_LAP_FACTOR - 1)} course laps (R905.1.1) — covering by finish schedule, not booked`,
      round1(underlaymentM2 * UNDERLAYMENT_LAP_FACTOR * SQFT),
      'sqft',
    )
  }
  const dripLf = members
    .filter((m) => m.role === 'drip-edge')
    .reduce((sum, m) => sum + toFeet(m.length), 0)
  if (dripLf > 0) {
    push('Roof', 'Drip edge', 'eaves + rakes (R905.2.8.5)', round1(dripLf), 'lf')
  }

  // Rebar: linear feet per system (steel role 'rebar' — CMU cells, bond
  // beams, footings, stemwalls).
  const rebarBySection = new Map<string, { lf: number; pcs: number }>()
  for (const m of members) {
    if (m.role !== 'rebar') continue
    const section = SECTION_OF[m.system]
    const tally = rebarBySection.get(section) ?? { lf: 0, pcs: 0 }
    tally.lf += toFeet(m.length)
    tally.pcs += 1
    rebarBySection.set(section, tally)
  }
  for (const section of SECTION_ORDER) {
    const tally = rebarBySection.get(section)
    if (!tally) continue
    push(section, 'Rebar', `${tally.pcs} bars, laps not included`, round1(tally.lf), 'lf')
  }

  // ---- STEEL hardware: counted by ROLE (never label regex) ----
  const roleCount = (role: Member['role']): number =>
    members.filter((m) => m.role === role).length
  const holdDowns = roleCount('hold-down')
  const plateWashers = roleCount('plate-washer')
  const hangers = roleCount('hanger')
  // CS-PF portal straps (LOD-400 B9): counted by ROLE like every other
  // hardware line — one member per strap, one pc per member. No nail
  // poundage is invented for them: the CS-PF nail schedule is exactly what
  // the member's advisory says v1 does not model.
  const portalStraps = roleCount('strap')
  // Hurricane ties are the roof engine's steel blocking — role + material +
  // system, structural identification without parsing labels.
  const hurricaneTies = members.filter(
    (m) => m.role === 'blocking' && m.material === 'steel' && m.system === 'roof-framing',
  ).length
  // Anchor bolts book PER SYSTEM: the foundation's slab bolts and the mixed
  // wall's seam-sill bolts (PT sill on the bond beam) are separate hardware
  // lines — both answer to R403.1.6. The foundation row names the SOLE
  // PLATE: no mudsill member exists on slab-on-grade — the bolts rise
  // through the wall engine's (PT, R317.1) bottom plate and clamp it
  // (LOD-400 audit B5: the old 'mudsill anchorage' text named a member
  // that isn't there).
  const anchorBoltsBySection = new Map<string, number>()
  for (const m of members) {
    if (m.role !== 'anchor-bolt') continue
    const section = SECTION_OF[m.system]
    anchorBoltsBySection.set(section, (anchorBoltsBySection.get(section) ?? 0) + 1)
  }
  for (const section of SECTION_ORDER) {
    const bolts = anchorBoltsBySection.get(section)
    if (!bolts) continue
    push(
      section,
      'Anchor bolts',
      section === 'Wall framing'
        ? 'seam sill to bond beam (R403.1.6)'
        : 'sole plate anchorage (R403.1.6)',
      bolts,
      'pcs',
    )
  }
  if (plateWashers > 0) {
    push('Foundation', 'Plate washers 3x3', 'SDC D₀–D₂ (R602.11.1)', plateWashers, 'pcs')
  }
  if (holdDowns > 0) {
    push('Foundation', 'Hold-downs', 'braced wall ends (seismic)', holdDowns, 'pcs')
  }
  if (portalStraps > 0) {
    push(
      'Wall framing',
      'Portal straps 1000 lb',
      'header to jack, CS-PF (R602.10.6.4) — fasteners per manufacturer',
      portalStraps,
      'pcs',
    )
  }
  // High-wind wall uplift hardware (LOD-400 B10): three dedicated roles,
  // counted by role like every hardware line, member-derived (B4 — booked
  // == built). B9's convention on fasteners holds: no nail poundage is
  // invented — the WFCM/manufacturer schedule is exactly what the members'
  // advisories say v1 does not model.
  const upliftConnectors = roleCount('uplift-connector')
  const upliftStraps = roleCount('uplift-strap')
  const foundationStraps = roleCount('foundation-strap')
  if (upliftConnectors > 0) {
    push(
      'Wall framing',
      'Stud-to-plate connectors',
      'one per full-height stud (o.c. rhythm) — high-wind uplift path (R802.11/WFCM); install per schedule',
      upliftConnectors,
      'pcs',
    )
  }
  if (upliftStraps > 0) {
    push(
      'Wall framing',
      'Header uplift straps',
      'header to jack at openings — high-wind uplift (WFCM); install per schedule',
      upliftStraps,
      'pcs',
    )
  }
  if (foundationStraps > 0) {
    push(
      'Wall framing',
      'Foundation uplift straps',
      '48" o.c. along slab-bearing plates, deduped where an R403.1.6 bolt/hold-down anchors; anchorage per schedule',
      foundationStraps,
      'pcs',
    )
  }
  if (hangers > 0) {
    push('Floor', 'Joist hangers', 'LUS-series @ girders/headers', hangers, 'pcs')
    addNails('10d-common', hangers * HANGER_NAILS)
  }
  if (hurricaneTies > 0) {
    push('Roof', 'Hurricane ties', 'rafter/plate uplift (R802.11)', hurricaneTies, 'pcs')
    addNails('8d-common', hurricaneTies * TIE_NAILS)
  }

  // ---- MEP runs: linear feet by size ----
  // Pipe by (material, nominal size) within its system section.
  const pipeTallies = new Map<string, { section: string; item: string; lf: number }>()
  const ductTallies = new Map<string, { section: string; item: string; lf: number }>()
  const wireTallies = new Map<string, number>()
  // Braided supply connectors are BOUGHT hoses, not cut pipe: one pc per
  // sourceId (`conn-cold-<id>` / `conn-hot-<id>` — one id per hose), never
  // copper lineal feet and never elbow fittings (round-3 scorecard: two
  // off-wall fixtures booked phantom pipe + phantom bends).
  const connectorHoses = new Set<string>()
  // Service-entrance cable (street → meter → panel) is SE/USE conductor, not
  // NM-B — booked on its own line, never under a phantom NM gauge.
  let seCableLf = 0
  // Grounding electrode system (B12): GEC + water-pipe bond are bare/green
  // Cu conductors, never NM-B lf. Gauge read from the member labels — the
  // engine sizes them from the service rating (NEC 250.66), same precedent
  // as the NM-B conductor-count key below.
  let gecLf = 0
  let bondLf = 0
  let gesAwg: string | null = null
  // Refrigerant line-sets are soft-copper suction/liquid pairs, not cut
  // plumbing pipe — booked by SIZE on their own rows (suction ¾" + liquid
  // ⅜") plus the suction line's insulation sleeve lf, never under the
  // plumbing-style copper lf or elbow fittings (soft copper bends).
  let linesetSuctionLf = 0
  let linesetLiquidLf = 0
  const linesetRuns = new Set<string>()
  // Condenser whips are liquid-tight conduit kits (NEC 440.14), one per
  // unit — never NM-B lineal feet.
  const acWhips = new Set<string>()
  for (const m of members) {
    if (m.role === 'wire-run' && m.sourceId === 'service-entrance') {
      seCableLf += toFeet(m.length)
    } else if (m.role === 'wire-run' && m.sourceId.startsWith('ac-whip-')) {
      acWhips.add(m.sourceId)
    } else if (m.role === 'wire-run' && m.sourceId === 'GES-1') {
      gecLf += toFeet(m.length)
      gesAwg ??= m.label?.match(/GEC (\d+) AWG/)?.[1] ?? null
    } else if (m.role === 'wire-run' && m.sourceId === 'GES-2') {
      bondLf += toFeet(m.length)
      gesAwg ??= m.label?.match(/bond (\d+) AWG/)?.[1] ?? null
    } else if (m.role === 'wire-run') {
      // NM-B keys on gauge AND conductor count: 14/3 (alarm interconnect +
      // 3-way travelers, B13b) is a different SKU than 14/2 — the old
      // gauge-only key would have booked 14/3 lf as phantom 14/2.
      const cable = m.label?.match(/(\d+)\/([23])\s+w\/G/)
      const key = cable ? `${cable[1]}/${cable[2]}` : '14/2'
      wireTallies.set(key, (wireTallies.get(key) ?? 0) + toFeet(m.length))
    } else if (m.role === 'pipe-run' && m.sourceId.startsWith('conn-')) {
      connectorHoses.add(m.sourceId)
    } else if (m.role === 'pipe-run' && m.sourceId.startsWith('lineset-')) {
      if (m.sourceId.startsWith('lineset-suction-')) linesetSuctionLf += toFeet(m.length)
      else if (m.sourceId.startsWith('lineset-liquid-')) linesetLiquidLf += toFeet(m.length)
      // one RUN per unit — 'lineset-suction-2' and 'lineset-liquid-2' are
      // the same physical pair
      linesetRuns.add(m.sourceId.replace(/^lineset-(?:suction|liquid)-/, ''))
    } else if (m.role === 'pipe-run' || m.role === 'vent-stack') {
      const sizeIn = Math.round((Math.min(m.dims[1], m.dims[2]) / 0.0254) * 8) / 8
      const materialName = m.material === 'copper' ? 'Copper' : m.material === 'pvc' ? 'PVC' : 'Pipe'
      const key = `${m.system}|${materialName}|${sizeIn}`
      const tally = pipeTallies.get(key) ?? {
        section: SECTION_OF[m.system],
        item: `${materialName} ${sizeIn}"`,
        lf: 0,
      }
      tally.lf += toFeet(m.length)
      pipeTallies.set(key, tally)
    } else if (m.role === 'duct-run') {
      // TRUE section sides: VERTICAL runs (risers/boots/drops — ductDrop
      // dims [w, length, h]) carry their LENGTH in dims[1]; reading dims[1]
      // as a side booked FICTITIOUS tin ('Duct 8×71"', 'Return duct 14×79"'
      // — round-2 finding 4 / examiner C5; the supply analog is fixed here
      // as a rider). Horizontals keep their W×H (max×min) exactly as before.
      const vertical = m.dims[1] > m.dims[0]
      const sA = Math.round((vertical ? m.dims[0] : m.dims[2]) / 0.0254)
      const sB = Math.round((vertical ? m.dims[2] : m.dims[1]) / 0.0254)
      const w = Math.max(sA, sB)
      const h = Math.min(sA, sB)
      // Trunks are rectangular sheet metal by the hvac naming contract
      // ('Trunk…' label prefix) — a trunk stepped down to the square 8×8
      // minimum is still square duct, not 8" round (round-10 finding).
      // RETURN-side duct ('Return…' prefix, B19c) books on its OWN rows —
      // mirroring the supply rows, never merging into them (the return
      // trunk shares the supply's 14×8 section; one blended row would hide
      // which air path the tin serves).
      const isTrunk = m.label?.startsWith('Trunk') === true
      const isReturn = m.label?.startsWith('Return') === true
      const item = isReturn
        ? `Return duct ${w}×${h}"`
        : w === h && !isTrunk
          ? `Duct ${w}" round`
          : `Duct ${w}×${h}"`
      const key = `${m.system}|${item}`
      const tally = ductTallies.get(key) ?? { section: SECTION_OF[m.system], item, lf: 0 }
      tally.lf += toFeet(m.length)
      ductTallies.set(key, tally)
    }
  }
  for (const tally of pipeTallies.values()) {
    push(tally.section, tally.item, 'linear feet', round1(tally.lf), 'lf')
  }
  if (connectorHoses.size > 0) {
    push(
      'Plumbing',
      'Braided supply connector',
      'stub-to-fixture hoses, counted each',
      connectorHoses.size,
      'pcs',
    )
  }
  // ---- water-heater safety hardware (B20): bought pieces counted from the
  // members the plumbing engine actually placed — never assumed. The T&P
  // DISCHARGE pipe books above as ordinary ¾" copper lf; these are the
  // fixtures/fabrications around the tank. Straps: one physical strap =
  // one sourceId (wh-strap-upper / wh-strap-lower), several band segments.
  const whCount = (sid: string): number =>
    members.some((m) => m.sourceId === sid) ? 1 : 0
  const tpValves = whCount('wh-tp-valve')
  const whPans = whCount('wh-pan')
  const whStands = whCount('wh-stand')
  const whStraps = new Set(
    members.filter((m) => m.sourceId.startsWith('wh-strap-')).map((m) => m.sourceId),
  ).size
  if (tpValves > 0) {
    push('Plumbing', 'T&P relief valve', '¾" discharge to ≤6" AFF (P2803.6.1)', tpValves, 'pcs')
  }
  if (whPans > 0) {
    push('Plumbing', 'Water-heater drain pan', 'with ¾" drain (P2801.6)', whPans, 'pcs')
  }
  if (whStands > 0) {
    push('Plumbing', 'Water-heater stand', '18" ignition elevation (M1307.3)', whStands, 'pcs')
  }
  if (whStraps > 0) {
    push('Plumbing', 'Seismic straps', 'tank upper+lower thirds (P2801.8)', whStraps, 'pcs')
  }
  const linesetRunsNote = `${linesetRuns.size} run${linesetRuns.size === 1 ? '' : 's'} (M1411)`
  if (linesetSuctionLf > 0) {
    push(
      'HVAC',
      'Line-set suction ¾"',
      `soft copper, insulated — ${linesetRunsNote}`,
      round1(linesetSuctionLf),
      'lf',
    )
    push(
      'HVAC',
      'Line-set insulation',
      '¾" suction line — closed-cell pipe sleeve (M1411)',
      round1(linesetSuctionLf),
      'lf',
    )
  }
  if (linesetLiquidLf > 0) {
    push(
      'HVAC',
      'Line-set liquid ⅜"',
      `soft copper — ${linesetRunsNote}`,
      round1(linesetLiquidLf),
      'lf',
    )
  }
  if (acWhips.size > 0) {
    push('HVAC', 'Condenser whips', 'liquid-tight conduit kits (NEC 440.14)', acWhips.size, 'pcs')
  }
  for (const tally of ductTallies.values()) {
    push(tally.section, tally.item, 'linear feet', round1(tally.lf), 'lf')
  }
  for (const [cableKey, lf] of wireTallies) {
    push(
      'Electrical',
      `NM-B ${cableKey} w/G`,
      cableKey.endsWith('/3')
        ? 'alarm interconnect + 3-way travelers (IRC R314.4 / NEC 404.2)'
        : 'homeruns + branch chains',
      round1(lf),
      'lf',
    )
  }
  if (seCableLf > 0) {
    push('Electrical', 'SE cable 2 AWG Cu', 'street → meter → panel (NEC 230)', round1(seCableLf), 'lf')
  }
  // ---- grounding electrode system (B12): rows mirror the members 1:1 ----
  const groundRods = members.filter((m) => m.role === 'ground-rod').length
  if (groundRods > 0) {
    push(
      'Electrical',
      'Ground rods 5/8" × 8 ft',
      'copper-clad, driven below grade, 6 ft apart (NEC 250.52(A)(5) / 250.53)',
      groundRods,
      'pcs',
    )
  }
  // One acorn clamp per rod + the water-pipe bond clamp when the bond is
  // modeled (NEC 250.70 listed connections).
  const groundClamps = groundRods + (bondLf > 0 ? 1 : 0)
  if (groundClamps > 0) {
    push(
      'Electrical',
      'Ground clamps',
      'acorn clamp per rod + water-pipe clamp (NEC 250.70)',
      groundClamps,
      'pcs',
    )
  }
  if (gecLf > 0) {
    push(
      'Electrical',
      `GEC ${gesAwg ?? '8'} AWG bare Cu`,
      'grounding electrode conductor, meter → rods (NEC 250.66)',
      round1(gecLf),
      'lf',
    )
  }
  if (bondLf > 0) {
    push(
      'Electrical',
      `Bonding jumper ${gesAwg ?? '8'} AWG Cu`,
      'panel → metal water service entry (NEC 250.104(A))',
      round1(bondLf),
      'lf',
    )
  }
  const intersystemTerminations = members.filter((m) => m.sourceId === 'ges-ibt').length
  if (intersystemTerminations > 0) {
    push(
      'Electrical',
      'Intersystem bonding termination',
      'at the service equipment (NEC 250.94)',
      intersystemTerminations,
      'pcs',
    )
  }

  // ---- MEP fittings (LOD 400): elbows at each bend, boots, collars ----
  // Every direction change between consecutive legs of one routed chain is a
  // fitting. Chains are identified by sourceId (the engines route per room /
  // per circuit); a chain of n legs carries n−1 bends. ESTIMATE by
  // construction — couplings on straight >20ft sticks are not counted.
  const fittingChains = new Map<string, { section: string; item: string; legs: number }>()
  for (const m of members) {
    if (m.role === 'pipe-run' && m.sourceId.startsWith('conn-')) continue // hoses bend freely — no elbows
    if (m.role === 'pipe-run' && m.sourceId.startsWith('lineset-')) continue // soft copper — bent, not fitted
    if (m.role === 'pipe-run') {
      const sizeIn = Math.round((Math.min(m.dims[1], m.dims[2]) / 0.0254) * 8) / 8
      const materialName = m.material === 'copper' ? 'Copper' : m.material === 'pvc' ? 'PVC' : 'Pipe'
      const key = `${m.system}|${materialName}|${sizeIn}|${m.sourceId}`
      const chain = fittingChains.get(key) ?? {
        section: SECTION_OF[m.system],
        item: `${materialName} ${sizeIn}" fittings`,
        legs: 0,
      }
      chain.legs += 1
      fittingChains.set(key, chain)
    } else if (m.role === 'duct-run') {
      // Same true-section derivation as the lf rows (verticals carry their
      // length in dims[1]); riser/boot chains merge with their horizontal
      // runs now — the riser-to-feed and branch-to-boot elbows are real
      // fittings the old fictitious-section keys kept apart.
      const vertical = m.dims[1] > m.dims[0]
      const sA = Math.round((vertical ? m.dims[0] : m.dims[2]) / 0.0254)
      const sB = Math.round((vertical ? m.dims[2] : m.dims[1]) / 0.0254)
      const w = Math.max(sA, sB)
      const h = Math.min(sA, sB)
      // Return-side bends book under their own item (same mirror as the lf
      // rows above).
      const isReturn = m.label?.startsWith('Return') === true
      const item = isReturn
        ? `Return duct ${w}×${h}" fittings`
        : w === h
          ? `Duct ${w}" fittings`
          : `Duct ${w}×${h}" fittings`
      const key = `${m.system}|${item}|${m.sourceId}`
      const chain = fittingChains.get(key) ?? { section: SECTION_OF[m.system], item, legs: 0 }
      chain.legs += 1
      fittingChains.set(key, chain)
    }
  }
  const fittingRows = new Map<string, { section: string; item: string; count: number }>()
  for (const chain of fittingChains.values()) {
    const bends = Math.max(0, chain.legs - 1)
    if (bends === 0) continue
    const key = `${chain.section}|${chain.item}`
    const row = fittingRows.get(key) ?? { section: chain.section, item: chain.item, count: 0 }
    row.count += bends
    fittingRows.set(key, row)
  }
  for (const row of fittingRows.values()) {
    push(row.section, row.item, 'elbows at bends (est.)', row.count, 'pcs')
  }
  // Register boots (one per supply register) + takeoff collars (one per
  // branch tap) + trunk reducers. Trunk vs branch is decided by the hvac
  // engine's own member-naming contract ('Trunk…' / '…branch…' label
  // prefixes) rather than cross-section shape — a trunk stepping down to
  // the square 8" minimum is still a trunk (round-5 finding: shape-based
  // classification booked it as a branch, undercounting reducers).
  const registerCount = fixtures.filter((f) => f.kind === 'register').length
  if (registerCount > 0) {
    push('HVAC', 'Register boots', 'one per supply register', registerCount, 'pcs')
    const branchChains = new Set<string>()
    const trunkSizes = new Map<string, Set<string>>()
    for (const m of members) {
      if (m.role !== 'duct-run') continue
      const w = Math.round(m.dims[2] / 0.0254)
      const h = Math.round(m.dims[1] / 0.0254)
      if (m.label?.startsWith('Trunk')) {
        const sizes = trunkSizes.get(m.sourceId) ?? new Set<string>()
        sizes.add(`${w}x${h}`)
        trunkSizes.set(m.sourceId, sizes)
      } else if (m.label?.includes('branch')) {
        branchChains.add(m.sourceId)
      }
    }
    if (branchChains.size > 0) {
      push('HVAC', 'Takeoff collars', 'one per trunk branch tap', branchChains.size, 'pcs')
    }
    let reducers = 0
    for (const sizes of trunkSizes.values()) reducers += Math.max(0, sizes.size - 1)
    if (reducers > 0) {
      push('HVAC', 'Trunk reducers', 'one per step-down in a trunk chain', reducers, 'pcs')
    }
  }

  // ---- Electrical boxes by type (LOD 400) — derived from fixture kinds ----
  const gangBoxes = fixtures.filter(
    (f) =>
      f.kind === 'receptacle' ||
      f.kind === 'receptacle-gfci' ||
      f.kind === 'receptacle-wr-gfci' ||
      f.kind === 'switch',
  ).length
  const ceilingBoxes = fixtures.filter(
    // B13 examiner flag 2: 'co-alarm' is a ceiling device too — its box was
    // unbooked (8 boxes for 9 ceiling devices on the compose scene).
    (f) => f.kind === 'light' || f.kind === 'smoke-alarm' || f.kind === 'co-alarm',
  ).length
  const panelCans = fixtures.filter((f) => f.kind === 'panel').length
  // B14a: every outdoor WR receptacle wears an extra-duty while-in-use
  // cover [NEC 406.9(B)(1)] — a real line item, booked 1:1 with the boxes.
  const inUseCovers = fixtures.filter((f) => f.kind === 'receptacle-wr-gfci').length
  if (gangBoxes > 0) push('Electrical', 'Device boxes (1-gang)', 'receptacles + switches', gangBoxes, 'pcs')
  if (inUseCovers > 0)
    push('Electrical', 'In-use covers (extra-duty)', 'NEC 406.9(B) wet-location while-in-use', inUseCovers, 'pcs')
  if (ceilingBoxes > 0) push('Electrical', 'Ceiling boxes', 'lights + smoke/CO alarms', ceilingBoxes, 'pcs')
  if (panelCans > 0) push('Electrical', 'Panel cans', 'load center enclosures', panelCans, 'pcs')

  // ---- Electrical circuits (panel schedule) ----
  for (const circuit of circuitSchedule(fixtures)) {
    const marks = [circuit.afci ? 'AFCI' : '', circuit.gfci ? 'GFCI' : ''].filter(Boolean).join('+')
    push(
      'Electrical',
      `Circuit ${circuit.circuit}`,
      `${circuit.breakerA}A / ${circuit.gaugeAwg} AWG / ${circuit.va} VA${marks ? ` / ${marks}` : ''}`,
      circuit.devices,
      'devices',
    )
  }

  // ---- FIXTURES: devices each, one row per kind, in their system section ----
  // AC condensers (equipment fixtures tagged meta.equipment='condenser') book
  // on their OWN row with the sized tonnage — the generic 'Mechanical
  // equipment' row keeps the air handler & co.
  const condensers = fixtures.filter(
    (f) => f.kind === 'equipment' && f.meta?.equipment === 'condenser',
  )
  const kindCounts = new Map<FixtureKind, { count: number; section: string }>()
  for (const f of fixtures) {
    if (f.kind === 'equipment' && f.meta?.equipment === 'condenser') continue
    const entry = kindCounts.get(f.kind) ?? { count: 0, section: SECTION_OF[f.system] }
    entry.count += 1
    kindCounts.set(f.kind, entry)
  }
  if (condensers.length > 0) {
    const totalTons = round1(
      condensers.reduce((sum, f) => sum + (Number(f.meta?.tons) || 0), 0),
    )
    // PER-UNIT tonnage on the row (Manual-J-lite batch): '2 × 3 tons', with
    // the sizing basis the fixture labels carry — the buy line must say what
    // each cabinet IS, not only the sum. Mixed per-unit tonnage (no engine
    // emits it today) keeps the total-only wording.
    const perUnit = [...new Set(condensers.map((f) => round1(Number(f.meta?.tons) || 0)))]
    // The buy line carries the LOAD COMPOSITION (skeptic F1): sensible ×
    // latent allowance — a purchaser must see the sensible-only basis and
    // the coarse regime factor, not just 'Manual J-lite sizing'.
    const f0 = condensers[0]
    const basis = condensers.every((f) => f.meta?.sizingBasis === 'manual-j-lite')
      ? f0?.meta?.moistureRegime
        ? `Manual J-lite ${f0.meta?.sensibleTons} t sensible × ${f0.meta?.latentFactor} latent (${f0.meta?.moistureRegime})`
        : 'Manual J-lite sizing (sensible-only, no latent allowance)'
      : 'assumed sizing'
    push(
      'HVAC',
      'AC condensers',
      perUnit.length === 1
        ? `${condensers.length} × ${perUnit[0]} tons (${totalTons} tons total) — ${basis}, Manual S governs (M1401.3)`
        : `${totalTons} tons total — ${basis}, Manual S governs (M1401.3)`,
      condensers.length,
      'pcs',
    )
  }
  for (const kind of FIXTURE_ORDER) {
    const entry = kindCounts.get(kind)
    if (!entry) continue
    const { item, detail } = FIXTURE_ROWS[kind]
    push(entry.section, item, detail, entry.count, 'pcs')
  }

  // ---- FASTENERS: nails by type, in pounds ----
  // Variant-keyed tallies ('8d-common|roof deck') print as their own rows —
  // the item carries the variant so the roof deck's pounds stay a separate
  // buy line from the wall 8d row (B6).
  for (const [key, count] of nails) {
    if (count <= 0) continue
    const [type, variant] = key.split('|') as [NailType, string | undefined]
    const info = fastening.nails[type]
    push(
      'Fasteners',
      `Nails ${type.replace('-common', '')} common${variant ? ` (${variant})` : ''}`,
      `${info.lengthIn}" — R602.3(1) schedule, ${count} nails`,
      Math.max(0.5, round1(count / info.perLb)),
      'lbs',
    )
  }

  // ---- FLAGS: every engine warning becomes a visible line ----
  const flagCounts = new Map<string, number>()
  for (const m of members) {
    if (m.flag) flagCounts.set(m.flag, (flagCounts.get(m.flag) ?? 0) + 1)
  }
  for (const [flag, count] of flagCounts) {
    push('Flags', 'FLAG', flag, count, 'ea')
  }

  // Stable-sort into the canonical section order.
  const order = new Map<string, number>(SECTION_ORDER.map((s, i) => [s, i]))
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const sa = order.get(a.row.section) ?? 99
      const sb = order.get(b.row.section) ?? 99
      return sa !== sb ? sa - sb : a.index - b.index
    })
    .map(({ row }) => row)
}

// ---------------------------------------------------------------------------
// Cut list (LOD 400): every wood member, size × exact cut length × qty
// ---------------------------------------------------------------------------

export type CutRow = {
  section: string
  size: LumberSize
  role: string
  /** Exact cut length in meters (grouping key, rounded to the mm). */
  lengthM: number
  /** Human length: 7'-8 5/8" style. */
  lengthLabel: string
  qty: number
}

/** Group every wood member into (system, size, role, mm-exact length) lines. */
export function cutList(members: Member[]): CutRow[] {
  const groups = new Map<string, CutRow>()
  for (const m of members) {
    if (!m.size || !WOOD_MATERIALS.has(m.material)) continue
    const lengthM = Math.round(m.length * 1000) / 1000
    const section = SECTION_OF[m.system]
    const key = `${section}|${m.size}|${m.role}|${lengthM}`
    const row = groups.get(key)
    if (row) row.qty += 1
    else {
      groups.set(key, {
        section,
        size: m.size,
        role: m.role,
        lengthM,
        lengthLabel: formatFtIn(lengthM),
        qty: 1,
      })
    }
  }
  const order = new Map<string, number>(SECTION_ORDER.map((s, i) => [s, i]))
  return [...groups.values()].sort((a, b) => {
    const sa = order.get(a.section) ?? 99
    const sb = order.get(b.section) ?? 99
    if (sa !== sb) return sa - sb
    if (a.size !== b.size) return LUMBER_SIZES.indexOf(a.size) - LUMBER_SIZES.indexOf(b.size)
    return b.lengthM - a.lengthM
  })
}

export function cutListCsv(rows: CutRow[]): string {
  return [
    'section,size,role,length,qty',
    ...rows.map((r) =>
      [csvField(r.section), r.size, csvField(r.role), csvField(r.lengthLabel), String(r.qty)].join(
        ',',
      ),
    ),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

/** RFC 4180 field escape: quote when a comma/quote/newline appears. */
function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function takeoffCsv(rows: TakeoffRow[]): string {
  return [
    'section,item,detail,quantity,unit',
    ...rows.map((r) =>
      [csvField(r.section), csvField(r.item), csvField(r.detail), String(r.quantity), csvField(r.unit)].join(','),
    ),
  ].join('\n')
}

/** Escape the pipe so flag text can't break the table. */
const mdCell = (value: string): string => value.replace(/\|/g, '\\|')

/** GitHub-flavored pipe table — pasteable into an estimate doc or PR. */
export function takeoffMarkdown(rows: TakeoffRow[]): string {
  return [
    '| Section | Item | Detail | Quantity | Unit |',
    '| --- | --- | --- | ---: | --- |',
    ...rows.map(
      (r) =>
        `| ${mdCell(r.section)} | ${mdCell(r.item)} | ${mdCell(r.detail)} | ${r.quantity} | ${mdCell(r.unit)} |`,
    ),
  ].join('\n')
}
