/**
 * The roller — a seeded L1/L2 document from options, in the spirit of
 * PlanCrafters' `design1story` (gen.js): a bedroom cluster on the left with
 * a hall behind it, the public rooms on the right (foyer + great room across
 * the front, dining + kitchen behind), the primary suite at the back-left,
 * an attached garage on the kitchen side. Every omitted option is rolled;
 * every dimension is jittered from the program and snapped to the 6" grid;
 * the same seed reproduces the same document.
 *
 * Bands (feet, u across the front, v into the lot):
 *
 *   BED 2 | BED 3 [| BED 4 / OFFICE]      FOYER | GREAT ROOM       [GARAGE]
 *   HALL ───────────────────────          DINING · KITCHEN  (open to the great room)
 *   BATH 2 · POWDER · LINEN | HALL | WIC · PRIMARY BATH      MUD ROOM | LAUNDRY
 *   PRIMARY BEDROOM ─────────────────────────────
 *
 * The footprint is a rectangle (plus the garage bump), so the roof is one
 * segment and every later pass sees a closed loop.
 */
import type { PlanDocument, PlanEdge } from './document'
import { mulberry32, pick, type Rng } from './rng'
import { STYLE_KEYS, styleFor } from './styles'

export type RollOptions = {
  style?: string
  beds?: 2 | 3 | 4
  baths?: 1 | 2 | 3
  garage?: boolean
  /** Buildable frontage, feet (the setback envelope's street edge). */
  maxWidthFt?: number
  /** Buildable depth, feet. */
  maxDepthFt?: number
  mode?: '1story' | 'adu'
}

export type RolledPlan = {
  seed: number
  options: Required<Pick<RollOptions, 'style' | 'beds' | 'baths' | 'garage'>> & RollOptions
  document: PlanDocument
  warnings: string[]
}

const HALL_W = 3.5
const snap = (ft: number): number => Math.round(ft * 2) / 2

export function rollDocument(seed: number, options: RollOptions = {}): RolledPlan {
  const rng: Rng = mulberry32(seed)
  const warnings: string[] = []
  const mode = options.mode ?? '1story'
  const style = styleFor(options.style ?? pick(rng, STYLE_KEYS))
  const beds = options.beds ?? (mode === 'adu' ? pick(rng, [2, 2, 3] as const) : pick(rng, [2, 3, 3, 4] as const))
  const baths =
    options.baths ?? (mode === 'adu' ? 1 : beds >= 4 ? pick(rng, [2, 3] as const) : pick(rng, [1, 2, 2] as const))
  let garage = options.garage ?? (mode === 'adu' ? false : rng() < 0.6)

  // ── program, jittered ────────────────────────────────────────────────
  const wide = style.longLow
  let bedW = snap(10.5 + rng() * 1.5)
  let bedD = snap((wide ? 11 : 11.5) + rng() * 1)
  let officeW = snap(9.5 + rng() * 1)
  let foyW = snap(6 + rng() * 1)
  let greatW = snap(14 + rng() * 2)
  let gd = snap((wide ? 15.5 : 16.5) + rng() * 1)
  let kw = snap(12.5 + rng() * 1)
  let dw = snap(9 + rng() * 1)
  let kd = snap((wide ? 13 : 14.5) + rng() * 1)
  const bathW = 8
  const bath2D = 8
  const powderD = 5
  const garageW = beds >= 3 ? 22 : 20
  const garageD = 22

  const clusterW = (): number => (beds === 2 ? bedW + officeW : beds === 3 ? 2 * bedW : 3 * bedW)
  const rightW = (): number => Math.max(foyW + greatW, dw + kw)
  const totalW = (): number => clusterW() + rightW() + (garage ? garageW : 0)

  // Shrink ladder against the lot frontage — the great room gives first,
  // then dining, kitchen, bedrooms and the foyer, never below their floors.
  const maxW = options.maxWidthFt ?? Number.POSITIVE_INFINITY
  const nominal = { greatW, dw, kw, bedW, officeW, foyW }
  const shrink = () => {
    let guard = 200
    while (totalW() > maxW && guard-- > 0) {
      if (greatW > 13) greatW -= 0.5
      else if (dw > 8.5) dw -= 0.5
      else if (kw > 12) kw -= 0.5
      else if (bedW > 10) bedW -= 0.5
      else if (officeW > 8) officeW -= 0.5
      else if (foyW > 5.5) foyW -= 0.5
      else break
    }
  }
  shrink()
  // A narrow frontage cannot take a garage beside the house (the two-column
  // parti's floor is ~38' without one, ~58' with): a garage the seed rolled
  // goes before a room is squeezed to its floor; one the user asked for
  // stays and the warning below says what it costs.
  if (totalW() > maxW && garage && options.garage === undefined) {
    garage = false
    greatW = nominal.greatW
    dw = nominal.dw
    kw = nominal.kw
    bedW = nominal.bedW
    officeW = nominal.officeW
    foyW = nominal.foyW
    shrink()
    warnings.push(
      `the buildable frontage (${maxW.toFixed(1)}') cannot take an attached garage beside the house — rolled without one; set Garage to "attached" to force it.`,
    )
  }
  if (totalW() > maxW) {
    warnings.push(
      `the plan is ${totalW().toFixed(1)}' wide but the buildable frontage is ${maxW.toFixed(1)}' — it will cross a side setback.`,
    )
  }
  // Wide-lot bias: spend slack on the great room and bedrooms.
  if (wide && Number.isFinite(maxW)) {
    let g = 200
    const target = Math.min(maxW - 2, snap((gd + kd) * (1.6 + rng() * 0.15)) + (garage ? garageW : 0))
    while (totalW() < target && g-- > 0) {
      if (greatW < snap(gd * 1.5)) greatW += 0.5
      else if (bedW < 13.5) bedW += 0.5
      else if (kw < 17) kw += 0.5
      else if (dw < 14) dw += 0.5
      else if (foyW < 9) foyW += 0.5
      else break
    }
  }
  const CW = clusterW()
  const RW = rightW()
  // The two columns are the same total width: stretch the great room and the kitchen.
  greatW = RW - foyW
  kw = RW - dw

  // ── depth: both columns end on the same back wall ────────────────────
  // Left column behind the hall: a service column (bath 2, powder, linen)
  // and the suite's closet + bath either side of the hall leg, then the
  // primary bedroom across the whole back. Right column: the laundry / mud
  // room behind the kitchen.
  const wicD = snap(6 + rng() * 1)
  let pbD = snap(13 + rng() * 1.5)
  const laundryBandD = 7
  let legLen = snap(Math.max(bath2D + (baths >= 3 ? powderD : 0) + 5, baths >= 2 ? 8 + wicD : wicD))
  const leftD = () => bedD + HALL_W + legLen + pbD
  const rightD = () => gd + kd + laundryBandD
  let D = snap(Math.max(leftD(), rightD(), garage ? garageD : 0))
  const maxD = options.maxDepthFt ?? Number.POSITIVE_INFINITY
  if (D > maxD) {
    warnings.push(`the plan is ${D.toFixed(1)}' deep but the buildable depth is ${maxD.toFixed(1)}' — it will cross the rear setback.`)
  }
  if (gd < bedD + HALL_W) gd = snap(bedD + HALL_W) // the foyer must reach the hall
  // Stretch the shallower column to the back wall: the primary bedroom first
  // (to 16'), then the leg (linen / closet absorb it); the kitchen on the right.
  if (leftD() < D) {
    pbD = Math.min(16, pbD + (D - leftD()))
    legLen += D - leftD()
  }
  kd = D - gd - laundryBandD

  // ── rooms ────────────────────────────────────────────────────────────
  const rooms: PlanDocument['rooms'] = []
  const attach: NonNullable<PlanDocument['attach']> = []
  // Bedroom band across the front of the left column.
  let u = 0
  const bedNames = beds === 2 ? ['BEDROOM 2'] : beds === 3 ? ['BEDROOM 2', 'BEDROOM 3'] : ['BEDROOM 2', 'BEDROOM 3', 'BEDROOM 4']
  for (const name of bedNames) {
    rooms.push({ name, kind: 'bed', x: u, y: 0, w: bedW, d: bedD, floor: 'LVP' })
    attach.push(['HALL', name, 'door'])
    u += bedW
  }
  if (beds === 2) {
    rooms.push({ name: 'OFFICE', kind: 'office', x: u, y: 0, w: officeW, d: bedD, floor: 'LVP' })
    attach.push(['HALL', 'OFFICE', 'door'])
  }
  // The hall: a band behind the bedrooms plus a leg down between the service column and the suite.
  const hallTop = bedD
  rooms.push({ name: 'HALL', kind: 'hall', x: 0, y: hallTop, w: CW, d: HALL_W, floor: 'LVP' })
  const legTop = hallTop + HALL_W
  const legBottom = legTop + legLen
  rooms.push({ name: 'HALL 2', kind: 'hall', x: bathW, y: legTop, w: HALL_W, d: legLen, floor: 'LVP' })
  attach.push(['HALL', 'HALL 2', 'zone'])
  // Service column left of the hall leg.
  let v = legTop
  const bath2Name = baths === 1 ? 'BATH' : 'BATH 2'
  rooms.push({ name: bath2Name, kind: 'bath', x: 0, y: v, w: bathW, d: bath2D, floor: 'TILE' })
  attach.push(['HALL 2', bath2Name, 'door'])
  v += bath2D
  if (baths >= 3) {
    rooms.push({ name: 'POWDER', kind: 'bath', x: 0, y: v, w: bathW, d: powderD, floor: 'TILE' })
    attach.push(['HALL 2', 'POWDER', 'door'])
    v += powderD
  }
  rooms.push({ name: 'LINEN', kind: 'closet', x: 0, y: v, w: bathW, d: legBottom - v, floor: 'LVP' })
  attach.push(['HALL 2', 'LINEN', 'door'])
  // Suite column right of the hall leg: closet, then the bath against the bedroom.
  const suiteX = bathW + HALL_W
  const suiteW = CW - suiteX
  if (baths >= 2) {
    rooms.push({ name: 'WIC', kind: 'closet', x: suiteX, y: legTop, w: suiteW, d: legLen - 8, floor: 'LVP' })
    rooms.push({ name: 'PRIMARY BATH', kind: 'bath', x: suiteX, y: legBottom - 8, w: suiteW, d: 8, floor: 'TILE' })
    attach.push(['PRIMARY BATH', 'WIC', 'door'])
    attach.push(['PRIMARY BEDROOM', 'PRIMARY BATH', 'door'])
  } else {
    rooms.push({ name: 'WIC', kind: 'closet', x: suiteX, y: legTop, w: suiteW, d: legLen, floor: 'LVP' })
    attach.push(['PRIMARY BEDROOM', 'WIC', 'door'])
  }
  // The primary bedroom across the back of the left column.
  rooms.push({ name: 'PRIMARY BEDROOM', kind: 'bed', x: 0, y: legBottom, w: CW, d: D - legBottom, primary: true, floor: 'LVP' })
  attach.push(['HALL 2', 'PRIMARY BEDROOM', 'door'])
  // Public rooms on the right: foyer + great room across the front, dining and kitchen behind, laundry behind the kitchen.
  rooms.push({ name: 'FOYER', kind: 'entry', x: CW, y: 0, w: foyW, d: gd, floor: 'TILE' })
  rooms.push({ name: 'GREAT ROOM', kind: 'living', x: CW + foyW, y: 0, w: greatW, d: gd, floor: 'LVP' })
  rooms.push({ name: 'DINING', kind: 'dining', x: CW, y: gd, w: dw, d: kd, floor: 'LVP' })
  rooms.push({ name: 'KITCHEN', kind: 'kitchen', x: CW + dw, y: gd, w: kw, d: kd, floor: 'TILE' })
  rooms.push({ name: 'MUD ROOM', kind: 'entry', x: CW, y: gd + kd, w: dw, d: laundryBandD, floor: 'TILE' })
  rooms.push({ name: 'LAUNDRY', kind: 'laundry', x: CW + dw, y: gd + kd, w: kw, d: laundryBandD, floor: 'TILE' })
  attach.push(['LAUNDRY', 'MUD ROOM', 'door'])
  attach.push(['FOYER', 'GREAT ROOM', 'open'])
  attach.push(['HALL', 'FOYER', 'open'])
  attach.push(['GREAT ROOM', 'DINING', 'zone'])
  attach.push(['GREAT ROOM', 'KITCHEN', 'zone'])
  attach.push(['DINING', 'KITCHEN', 'zone'])
  attach.push(['KITCHEN', 'LAUNDRY', 'door'])
  if (garage) {
    rooms.push({ name: 'GARAGE', kind: 'garage', x: CW + RW, y: 0, w: garageW, d: garageD, floor: 'CONC' })
    attach.push(['GARAGE', 'KITCHEN', 'door'])
  }

  // ── roof intent from the style ───────────────────────────────────────
  const W = CW + RW
  const gables: PlanEdge[] = style.roofForm === 'gable' ? (D > W ? ['front', 'back'] : ['left', 'right']) : []
  const document: PlanDocument = {
    roomcode: 1,
    name: `${style.label} ${beds} bd / ${baths} ba (seed ${seed})`,
    units: 'ft',
    mode,
    style: style.key,
    ceiling: 9,
    roof: { form: style.roofForm, pitch: style.pitch, overhang: style.overhangIn / 12, gables },
    rooms,
    attach,
    frontDoor: 'FOYER',
    finishes: { siding: style.siding, roofMat: style.roofMat },
  }
  return {
    seed,
    options: { ...options, style: style.key, beds, baths, garage },
    document,
    warnings,
  }
}
