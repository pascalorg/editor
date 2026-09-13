/**
 * The NARROW-LOT parti — the plan a 40 or 50 ft lot takes (Steve,
 * 2026-09-09: "you need more designs for like 50 foot and 40 foot wide
 * lots that go longer and skinnier with grand entrances in many styles").
 *
 * One column, front to back, the way a narrow city lot has always been
 * built: a GRAND ENTRANCE across the front — the foyer centred between two
 * front rooms, the porch spanning them — a cross hall behind it, the great
 * room across the full width, the kitchen and dining behind that, a
 * service band (the laundry, the back hall, the second bath, the closet) and the
 * primary suite across the back. The house is 24 to 32 ft wide and grows
 * DEEP; the depth shrinks toward the buildable depth the way the two-column
 * parti's width shrinks toward the frontage. Every style dresses it: the
 * roof form, pitch, porch and trim come from the style as before; with the
 * depth past the width the gables land front and back.
 *
 * No attached garage on a narrow lot — a detached garage at the back off
 * the alley or a side drive is the norm there, and it is not rolled here.
 */
import type { PlanDocument } from './document'
import type { Rng } from './rng'

type Room = PlanDocument['rooms'][number]
type Attach = NonNullable<PlanDocument['attach']>[number]

/** Lots whose band is narrower than this take the narrow parti. */
export const NARROW_LOT_FT = 44
/** The narrow house's width range, feet. */
export const NARROW_W_MIN = 24
export const NARROW_W_MAX = 32

const HALL_W = 3.5
/** The rear porch the depth ladder keeps room for, feet (a 7 ft patio). */
const REAR_PORCH_FT = 7
const snap = (ft: number): number => Math.round(ft * 2) / 2

export type NarrowInput = {
  /** The band the house may fill, feet (finite). */
  maxWidthFt: number
  /** The buildable depth, feet (Infinity when unknown). */
  maxDepthFt: number
  beds: 2 | 3 | 4
  baths: 1 | 2 | 3
  rng: Rng
}

export type NarrowParti = {
  rooms: Room[]
  attach: Attach[]
  W: number
  D: number
  beds: 2 | 3 | 4
  baths: 1 | 2 | 3
  warnings: string[]
}

export function narrowParti(input: NarrowInput): NarrowParti {
  const { rng } = input
  const warnings: string[] = []
  let beds = input.beds
  let baths = input.baths
  // the width: a foot inside the band, 24 to 32 ft
  const W = snap(Math.max(NARROW_W_MIN, Math.min(NARROW_W_MAX, input.maxWidthFt - 1)))
  if (input.maxWidthFt - 1 < NARROW_W_MIN) {
    warnings.push(
      `the buildable band is ${input.maxWidthFt.toFixed(1)}' wide — under the ${NARROW_W_MIN}' the narrow plan needs; it will cross a side setback.`,
    )
  }
  // the service band needs its five slots for a fourth bedroom
  if (beds === 4 && W < 31.5) {
    warnings.push(
      `a fourth bedroom needs a ${31.5}' band — this ${W}' house rolls three bedrooms (a second storey is the narrow lot's answer, not rolled).`,
    )
    beds = 3
  }
  const foyW = snap(8 + rng() * 1) // the grand entrance
  const frontRoomW = snap((W - foyW) / 2)
  const foyX = frontRoomW
  const foyW2 = W - 2 * frontRoomW // absorbs the half-foot rounding

  // ── the depths, then the ladder down to the buildable depth ──────────
  let fd = snap(11.5 + rng() * 1)
  let gd = snap(16 + rng() * 2)
  let kd = snap(13 + rng() * 1.5)
  // the service band: the laundry, the back hall, the second bath, the
  // closet — 8'-6" deep so a 30 in door centred on the bath's hall wall
  // leaves the vanity across the front corner clear of its swing
  const sd = 8.5
  let pd = snap(13.5 + rng() * 1)
  const D = () => fd + HALL_W + gd + kd + sd + pd
  const maxD = input.maxDepthFt
  // ladder toward the buildable depth less a rear porch first (the porch
  // stays the house's, not a landing's) and toward the depth itself when
  // the floors bind
  for (const target of [maxD - REAR_PORCH_FT, maxD]) {
    let guard = 200
    while (D() > target && guard-- > 0) {
      if (gd > 14) gd -= 0.5
      else if (kd > 11.5) kd -= 0.5
      else if (pd > 12) pd -= 0.5
      else if (fd > 10.5) fd -= 0.5
      else break
    }
  }
  if (D() > maxD) {
    warnings.push(
      `the narrow plan is ${D().toFixed(1)}' deep but the buildable depth is ${maxD.toFixed(1)}' — it will cross the rear setback.`,
    )
  }

  const rooms: Room[] = []
  const attach: Attach[] = []
  let y = 0
  // ── the front: two rooms flanking the foyer ───────────────────────────
  const leftName = beds === 2 ? 'OFFICE' : 'BEDROOM 2'
  const rightName = beds === 2 ? 'BEDROOM 2' : 'BEDROOM 3'
  rooms.push({
    name: leftName,
    kind: beds === 2 ? 'office' : 'bed',
    x: 0,
    y,
    w: frontRoomW,
    d: fd,
    floor: 'LVP',
  })
  rooms.push({ name: 'FOYER', kind: 'entry', x: foyX, y, w: foyW2, d: fd, floor: 'TILE' })
  rooms.push({
    name: rightName,
    kind: 'bed',
    x: foyX + foyW2,
    y,
    w: frontRoomW,
    d: fd,
    floor: 'LVP',
  })
  y += fd
  // ── the cross hall ────────────────────────────────────────────────────
  rooms.push({ name: 'HALL', kind: 'hall', x: 0, y, w: W, d: HALL_W, floor: 'LVP' })
  attach.push(['HALL', leftName, 'door'])
  attach.push(['HALL', rightName, 'door'])
  attach.push(['FOYER', 'HALL', 'open'])
  y += HALL_W
  // ── the great room across the width ───────────────────────────────────
  rooms.push({ name: 'GREAT ROOM', kind: 'living', x: 0, y, w: W, d: gd, floor: 'LVP' })
  attach.push(['HALL', 'GREAT ROOM', 'open'])
  y += gd
  // ── kitchen and dining: the kitchen on the right, its run on the side
  // wall under the window and its BACK wall door-free (the service band
  // behind it is the bath and the closet — the furnisher's fridge and range
  // turn the corner onto it); the dining on the left over the back hall ──
  const kw = snap(Math.min(13, W / 2 + 1))
  rooms.push({ name: 'DINING', kind: 'dining', x: 0, y, w: W - kw, d: kd, floor: 'LVP' })
  rooms.push({ name: 'KITCHEN', kind: 'kitchen', x: W - kw, y, w: kw, d: kd, floor: 'TILE' })
  attach.push(['GREAT ROOM', 'KITCHEN', 'zone'])
  attach.push(['GREAT ROOM', 'DINING', 'zone'])
  attach.push(['DINING', 'KITCHEN', 'zone'])
  y += kd
  // ── the service band, left to right ───────────────────────────────────
  // ≤ 3 beds: LAUNDRY | HALL 2 | BATH 2 | WIC — the laundry and the bath
  //   off the back hall, the hall open to the dining, the closet off the
  //   primary bedroom; a third bath is a POWDER at the far left off the
  //   dining (the guests' bath, where a powder room goes) when the band
  //   has the width, else the roll says so and takes two.
  // 4 beds: BEDROOM 4 | HALL 2 | BATH 2 | WIC | LAUNDRY — the fourth
  //   bedroom on the side wall (its egress window) and the bath off the
  //   hall; the laundry in the back corner behind the kitchen takes its
  //   door from there, at the far end of the kitchen's back wall so the
  //   fridge and the range keep the rest (a second storey is the real
  //   answer for four bedrooms on a narrow lot, not rolled).
  // The laundry is 8 ft so the hall clears the primary bath's 8 ft and
  // reaches the primary bedroom's wall.
  const bath2Name = baths === 1 ? 'BATH' : 'BATH 2'
  const BATH_W = 9 // shower across the end, toilet and a vanity along the 9 ft wet wall
  const laundryW = beds === 4 ? 5 : 8
  let x = 0
  if (beds === 4) {
    rooms.push({ name: 'BEDROOM 4', kind: 'bed', x, y, w: 10, d: sd, floor: 'LVP' })
    attach.push(['HALL 2', 'BEDROOM 4', 'door'])
    x += 10
  } else {
    const powderFits = W - (5 + laundryW + HALL_W + BATH_W) >= 4
    if (baths >= 3 && powderFits) {
      rooms.push({ name: 'POWDER', kind: 'bath', x, y, w: 5, d: sd, floor: 'TILE' })
      attach.push(['DINING', 'POWDER', 'door'])
      x += 5
    } else if (baths >= 3) {
      warnings.push(
        'no room for a powder room in the service band of this narrow house — rolled with two baths.',
      )
      baths = 2
    }
    rooms.push({ name: 'LAUNDRY', kind: 'laundry', x, y, w: laundryW, d: sd, floor: 'TILE' })
    attach.push(['HALL 2', 'LAUNDRY', 'door'])
    x += laundryW
  }
  rooms.push({ name: 'HALL 2', kind: 'hall', x, y, w: HALL_W, d: sd, floor: 'LVP' })
  attach.push(['DINING', 'HALL 2', 'open'])
  x += HALL_W
  rooms.push({ name: bath2Name, kind: 'bath', x, y, w: BATH_W, d: sd, floor: 'TILE' })
  attach.push(['HALL 2', bath2Name, 'door'])
  x += BATH_W
  const closetW = beds === 4 ? W - x - laundryW : W - x
  const closetName = closetW >= 5 ? 'WIC' : 'CLOSET'
  rooms.push({ name: closetName, kind: 'closet', x, y, w: closetW, d: sd, floor: 'LVP' })
  x += closetW
  if (beds === 4) {
    rooms.push({ name: 'LAUNDRY', kind: 'laundry', x, y, w: laundryW, d: sd, floor: 'TILE' })
    attach.push(['KITCHEN', 'LAUNDRY', 'door'])
    x += laundryW
  }
  y += sd
  // ── the primary suite across the back ─────────────────────────────────
  if (baths >= 2) {
    rooms.push({ name: 'PRIMARY BATH', kind: 'bath', x: 0, y, w: 8, d: pd, floor: 'TILE' })
    rooms.push({
      name: 'PRIMARY BEDROOM',
      kind: 'bed',
      x: 8,
      y,
      w: W - 8,
      d: pd,
      primary: true,
      floor: 'LVP',
    })
    attach.push(['PRIMARY BEDROOM', 'PRIMARY BATH', 'door'])
  } else {
    rooms.push({
      name: 'PRIMARY BEDROOM',
      kind: 'bed',
      x: 0,
      y,
      w: W,
      d: pd,
      primary: true,
      floor: 'LVP',
    })
  }
  attach.push(['HALL 2', 'PRIMARY BEDROOM', 'door'])
  attach.push(['PRIMARY BEDROOM', closetName, 'door'])
  y += pd

  return { rooms, attach, W, D: y, beds, baths, warnings }
}
