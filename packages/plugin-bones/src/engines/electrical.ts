/**
 * Electrical layout engine — NEC 210.52 receptacle geometry plus the
 * layout-computable slice of 210.70 (switches/lights), 210.8 (GFCI zones),
 * IRC R314 (smoke alarms) and a service panel. Pure function:
 * (WallSlice[], RoomSlice[]) → Fixture[] — no Members, no store access.
 *
 * Numeric rules come from data/electrical-rules.json (NEC 2023 basis; see
 * docs/research/electrical.md for the full derivation and edition deltas).
 *
 * Geometry follows the wall-framing convention: a wall runs +X in its local
 * frame from `start` along `dir = [dx, dz]`; the +v cross-wall axis maps to
 * level [-dz, dx] and yaw = atan2(-dz, dx). Devices are offset to a wall FACE
 * (half thickness + a device-box proud) and rotated so their local +Z — the
 * renderer's box depth axis — points away from the wall.
 */

import rules from '../../data/electrical-rules.json'
import type {
  DeviceOverrides,
  Fixture,
  Member,
  RoomSlice,
  ServiceOverrides,
  ServicePointOverride,
  WallSlice,
} from '../core/types'
import { feet, inches } from '../core/units'
import type { PlacedFixtureSlice } from '../core/wall-model'

// ---- rule constants (data/electrical-rules.json) --------------------------

/** NEC 210.52(A)(1): max 12 ft between receptacles along the floor line. */
const MAX_SPACING = feet(rules.receptacles.wallSpacingMaxFt)
/** NEC 210.52(A)(1): no floor-line point > 6 ft from a receptacle → first one within 6 ft of every break. */
const MAX_FROM_BREAK = feet(rules.receptacles.maxFromOpeningFt)
/** NEC 210.52(A)(2)(1): only wall spaces >= 2 ft wide count. */
const MIN_SEGMENT = feet(rules.receptacles.minWallWidthFt)
/** 15" AFF — convention + ANSI A117.1 min reach, not NEC (see heightAffNote). */
const RECEPTACLE_AFF = inches(rules.receptacles.heightAffIn)
/** 48" AFF — convention + ANSI A117.1 max reach, not NEC. */
const SWITCH_AFF = inches(rules.switches.heightAffIn)
/** Device box sits proud of the framing face by the finish layer (~5/8" drywall). */
const FACE_OFFSET = inches(0.75)
/** Practice: switch box centered ~8" past the door casing on the latch side. */
const SWITCH_LATCH_OFFSET = inches(8)
/** Panel center at 60" AFF — keeps the top breaker under NEC 240.24(A)'s 6'-7" handle limit. */
const PANEL_AFF = inches(60)
/** Meter socket center ~55" AFF — utilities want the dial 4–6 ft above grade. */
const METER_AFF = inches(55)
/** Meter socket sits beside the panel's wall bay (enclosure half-width + working space). */
const METER_PANEL_OFFSET = 0.6

/**
 * NEC 210.8(A) GFCI locations we can resolve from RoomSlice.category alone:
 * bathrooms (A)(1), garages (A)(2), kitchens (A)(6) — ALL kitchen receptacles
 * under NEC 2023 — and laundry areas (A)(10).
 */
const GFCI_CATEGORIES: ReadonlySet<RoomSlice['category']> = new Set([
  'kitchen',
  'bathroom',
  'garage',
  'laundry',
])

/** NEC 210.8(A)(7)/(9): receptacles within 6 ft of a sink bowl edge — or of
 * a bathtub / shower stall — are GFCI. Measured here from the placed item's
 * plan CENTER (the scene carries no bowl-edge geometry; the center is the
 * conservative deterministic proxy). */
const SINK_GFCI_RADIUS = feet(rules.gfci.sinkRuleFt)

/** Placed sanitary kinds that trigger the 6-ft GFCI radius: sinks per
 * 210.8(A)(7) (kitchen sinks + lavatories), tubs/showers per 210.8(A)(9). */
const SINK_RULE_KINDS: ReadonlySet<PlacedFixtureSlice['kind']> = new Set([
  'kitchen-sink',
  'lavatory',
  'bathtub',
  'shower',
])

// ---- counter + basin receptacles (B14c/d, NEC 210.52(C)/(D)) ---------------

/** Counter receptacle center ~44" AFF: the 36" counter convention + 8" —
 * inside 210.52(C)(3)'s 20"-above-counter cap (the data's
 * counterReceptacleMaxAboveCounterIn). The height is convention, not NEC. */
const COUNTER_RECEPTACLE_AFF = inches(44)
/** 210.52(C)(1): first counter receptacle within 24" of each run end… */
const COUNTER_FIRST_MAX = inches(
  rules.layoutAlgorithmHints.countertopPlacement.firstReceptacleMaxFromEndIn,
)
/** …then every <= 48" along the counter wall line. */
const COUNTER_SPACING = inches(
  rules.layoutAlgorithmHints.countertopPlacement.subsequentSpacingMaxIn,
)
/** 210.52(C)(1): counter spaces narrower than 12" require no receptacle. */
const COUNTER_MIN_WIDTH = inches(rules.receptacles.counterMinWidthRequiringReceptacleIn)
/** Basin receptacle center ~40" AFF: above the 34" vanity convention, inside
 * 210.52(D)'s 12"-below-countertop floor. Convention, not NEC. */
const BASIN_RECEPTACLE_AFF = inches(40)
/** 210.52(D): a receptacle within 3 ft of each basin's outside edge. */
const BASIN_RADIUS = feet(3)
/** A placed sink further than this from every wall reads as an ISLAND. */
const ISLAND_WALL_DIST = 1.2
/** F4 glazing flag — one string so a user MOVE can shed/re-add it
 * (applyDeviceOverrides recomputes obstruction at the new spot, round 3). */
const OBSTRUCTED_NOTE = ' (\u26a0 position obstructed by glazing \u2014 verify on site)'

// ---- small 2D helpers ------------------------------------------------------

type Pt = readonly [number, number]
type Polygon = readonly Pt[]

/**
 * Even-odd ray-cast point-in-polygon (ray toward +X). Good enough for room
 * zones: face points sit ~3" inside a room, never on an edge.
 */
export function pointInPolygon(p: Pt, polygon: Polygon): boolean {
  const [px, pz] = p
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i] ?? [0, 0]
    const [xj, zj] = polygon[j] ?? [0, 0]
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/**
 * Nudge a ceiling-fixture spot off the room centroid WITHOUT leaving the
 * room (B13 round 2): a narrow host (0.5 m corridor proxy) put the +12"
 * x-nudge inside the far wall band, 5.5 cm outside the polygon. Tries ±d
 * on both axes in a deterministic order (callers pass ±d to keep smoke/CO
 * apart), falls back to the exact centroid when nothing fits.
 */
export function nudgeInside(polygon: Polygon, cx: number, cz: number, d: number): Pt {
  const tries: readonly Pt[] = [
    [cx + d, cz],
    [cx - d, cz],
    [cx, cz + d],
    [cx, cz - d],
  ]
  for (const p of tries) if (pointInPolygon(p, polygon)) return p
  return [cx, cz]
}

/** Area centroid of a simple polygon; falls back to the vertex mean when degenerate. */
export function polygonCentroid(polygon: Polygon): Pt {
  let area = 0
  let cx = 0
  let cz = 0
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i] ?? [0, 0]
    const [xj, zj] = polygon[j] ?? [0, 0]
    const cross = xj * zi - xi * zj
    area += cross
    cx += (xi + xj) * cross
    cz += (zi + zj) * cross
  }
  if (Math.abs(area) < 1e-9) {
    let mx = 0
    let mz = 0
    for (const [x, z] of polygon) {
      mx += x
      mz += z
    }
    const n = Math.max(1, polygon.length)
    return [mx / n, mz / n]
  }
  return [cx / (3 * area), cz / (3 * area)]
}

// ---- room adjacency (B13a: hallway proxy for the R314.3(2) alarm) ----------

/**
 * Shared boundary length between two room polygons: edge pairs that run
 * nearly parallel within a wall-thickness tolerance (0.35 m — zones are
 * drawn to centerlines OR faces) contribute their projected overlap.
 */
export function sharedBoundaryLength(a: Polygon, b: Polygon): number {
  let total = 0
  for (let i = 0; i < a.length; i++) {
    const [ax0, az0] = a[i] ?? [0, 0]
    const [ax1, az1] = a[(i + 1) % a.length] ?? [0, 0]
    const alen = Math.hypot(ax1 - ax0, az1 - az0)
    if (alen < 1e-6) continue
    const dir: Pt = [(ax1 - ax0) / alen, (az1 - az0) / alen]
    for (let j = 0; j < b.length; j++) {
      const [bx0, bz0] = b[j] ?? [0, 0]
      const [bx1, bz1] = b[(j + 1) % b.length] ?? [0, 0]
      const blen = Math.hypot(bx1 - bx0, bz1 - bz0)
      if (blen < 1e-6) continue
      // parallel test: b's direction within ~5° of ±a's
      const cross = Math.abs(dir[0] * ((bz1 - bz0) / blen) - dir[1] * ((bx1 - bx0) / blen))
      if (cross > 0.09) continue
      // lateral separation of b's endpoints off a's line
      const off0 = Math.abs((bx0 - ax0) * -dir[1] + (bz0 - az0) * dir[0])
      const off1 = Math.abs((bx1 - ax0) * -dir[1] + (bz1 - az0) * dir[0])
      if (Math.max(off0, off1) > 0.35) continue
      // overlap of the projections onto a's axis
      const t0 = (bx0 - ax0) * dir[0] + (bz0 - az0) * dir[1]
      const t1 = (bx1 - ax0) * dir[0] + (bz1 - az0) * dir[1]
      const lo = Math.max(0, Math.min(t0, t1))
      const hi = Math.min(alen, Math.max(t0, t1))
      if (hi > lo) total += hi - lo
    }
  }
  return total
}

/**
 * The room that stands in for a missing hallway: the non-bedroom room
 * sharing the most boundary (≥ 0.5 m — at least a doorway of shared wall)
 * with any bedroom. Garages/bathrooms rank last (R314.3.3 humidity /
 * nuisance sources — hosts of last resort only). OUTDOOR zones never host:
 * R314's "outside the sleeping area" is a spot in the dwelling INTERIOR —
 * a garden sharing the bedroom's exterior wall is open air, not a proxy
 * (M4). Deterministic: shared length desc, ties by id.
 */
function bedroomAdjacentProxy(
  bedrooms: RoomSlice[],
  rooms: RoomSlice[],
): RoomSlice | undefined {
  const AVOID = new Set<RoomSlice['category']>(['garage', 'bathroom'])
  let best: { room: RoomSlice; shared: number; avoided: boolean } | undefined
  for (const room of rooms) {
    if (room.category === 'bedroom' || room.category === 'outdoor') continue
    let shared = 0
    for (const bed of bedrooms) shared += sharedBoundaryLength(room.polygon, bed.polygon)
    if (shared < 0.5) continue
    const avoided = AVOID.has(room.category)
    const wins =
      !best ||
      (best.avoided && !avoided) ||
      (best.avoided === avoided &&
        (shared > best.shared + 1e-9 ||
          (Math.abs(shared - best.shared) <= 1e-9 && room.id.localeCompare(best.room.id) < 0)))
    if (wins) best = { room, shared, avoided }
  }
  return best?.room
}

// ---- wall faces ------------------------------------------------------------

/** One mountable face of a wall: outward normal side `+1` (the +v axis, level [-dz, dx]) or `-1`. */
type WallFace = {
  side: 1 | -1
  /** Y rotation mapping a device's local +Z onto the face's outward normal. */
  rotationY: number
  /** Floor-plan point of a device on this face at distance `u` along the wall. */
  plan: (u: number) => Pt
}

function faceOf(wall: WallSlice, side: 1 | -1): WallFace {
  const [dx, dz] = wall.dir
  const [sx, sz] = wall.start
  // Outward normal: rotating local +Z by yaw = atan2(-dz, dx) gives [-dz, dx]
  // (the wall-framing +v axis); the -1 face is its negation.
  const nx = -dz * side
  const nz = dx * side
  const off = wall.thickness / 2 + FACE_OFFSET
  return {
    side,
    // Ry(θ) maps +Z → [sin θ, 0, cos θ]; we want +Z → [nx, 0, nz].
    rotationY: Math.atan2(nx, nz),
    plan: (u) => [sx + dx * u + nx * off, sz + dz * u + nz * off],
  }
}

/**
 * A wall face that opens onto an OUTDOOR zone (garden/patio/yard… — M4's
 * open-air category) with no indoor room claiming the same point. Such a
 * face is open air: it never counts as a habitable side for the 210.52(A)
 * walk, switch mounting or the spacing census. Overlapping polygons resolve
 * indoor-first (conservative — keep the receptacle when a zone seam is
 * ambiguous).
 */
function isOpenAirFace(wall: WallSlice, side: 1 | -1, rooms: RoomSlice[]): boolean {
  const p = faceOf(wall, side).plan(wall.length / 2)
  let indoor = false
  let outdoor = false
  for (const r of rooms) {
    if (!pointInPolygon(p, r.polygon)) continue
    if (r.category === 'outdoor') outdoor = true
    else indoor = true
  }
  return outdoor && !indoor
}

/**
 * Faces that get devices. Interior walls serve rooms on BOTH sides. Exterior
 * walls get devices on the interior face only — resolved by testing which
 * face's midpoint falls inside an INDOOR room polygon. Outdoor zones are
 * open air (M4): a face opening onto one is never an interior mounting face
 * (day-9 residual: gardens minted interior-style 15" receptacles), and a
 * wall whose only resolved side is an outdoor zone (garden fences,
 * freestanding garden walls — EITHER wall typing: fences classify
 * interior-typed too, both faces uncovered leaves exposedSides=2 and the
 * host's fallback marks exactly-1; round-1 F2) bounds NO habitable space —
 * the 210.52(A) walk skips it entirely; outdoor coverage is the B14a WR
 * machinery's job.
 * ASSUMPTION: face choice is made once at the wall midpoint; walls whose
 * interior side flips mid-run (rare) would need per-segment resolution.
 */
function interiorFaces(wall: WallSlice, rooms: RoomSlice[]): WallFace[] {
  const plus = faceOf(wall, 1)
  const minus = faceOf(wall, -1)
  const mid = wall.length / 2
  const indoor = rooms.filter((r) => r.category !== 'outdoor')
  const inIndoor = (f: WallFace) => indoor.some((r) => pointInPolygon(f.plan(mid), r.polygon))
  if (!wall.exterior) {
    const openPlus = isOpenAirFace(wall, 1, rooms)
    const openMinus = isOpenAirFace(wall, -1, rooms)
    // no outdoor contact: legacy both-sides service (zone-less scenes stay
    // byte-identical)
    if (!openPlus && !openMinus) return [plus, minus]
    // The wall touches open air: only a face resolving a REAL indoor room
    // survives. One open-air side + one UNCOVERED side is a freestanding
    // garden wall (interior-TYPED fences, round-1 F2 — they minted 15"
    // receptacles + a gate switch on the outer face), not a partition.
    return [plus, minus].filter((f) => !isOpenAirFace(wall, f.side, rooms) && inIndoor(f))
  }
  if (inIndoor(plus)) return [plus]
  if (inIndoor(minus)) return [minus]
  // No indoor room resolves a side. An outdoor zone on either face means the
  // wall visibly bounds open air with no habitable side — no interior faces.
  if (isOpenAirFace(wall, 1, rooms) || isOpenAirFace(wall, -1, rooms)) return []
  // No zone data at all — fall back to the +normal side (legacy).
  return [plus]
}

// ---- rough-opening geometry --------------------------------------------------

type RoSpan = { lo: number; hi: number; sillY: number; topY: number }

/**
 * Horizontal RO intervals of every opening whose vertical rough opening
 * crosses [y0, y1]. Cable, boxes and panels can't occupy ANY rough opening —
 * doors, windows, fixed glazing alike. Adjacent spans merge (a mulled window
 * pair or door+sidelite detours once, not twice).
 */
export function openingSpans(wall: WallSlice, y0: number, y1: number): RoSpan[] {
  const spans = wall.openings
    .filter((o) => o.sillHeight < y1 && o.sillHeight + o.roughHeight > y0)
    .map((o) => ({
      lo: Math.max(0, o.u - o.roughWidth / 2),
      hi: Math.min(wall.length, o.u + o.roughWidth / 2),
      sillY: o.sillHeight,
      topY: o.sillHeight + o.roughHeight,
    }))
    .filter((s) => s.hi > s.lo)
    .sort((a, b) => a.lo - b.lo)
  const merged: RoSpan[] = []
  for (const s of spans) {
    const last = merged[merged.length - 1]
    if (last && s.lo <= last.hi + inches(4)) {
      last.hi = Math.max(last.hi, s.hi)
      last.sillY = Math.min(last.sillY, s.sillY)
      last.topY = Math.max(last.topY, s.topY)
    } else merged.push({ ...s })
  }
  return merged
}

// ---- receptacle walk (NEC 210.52(A)) ----------------------------------------

type Segment = { a: number; b: number }

/**
 * Usable wall spaces along the floor line: DOORWAYS break the wall line
 * [210.52(A)(2)(1)] but windows do NOT — fixed glass counts as wall space
 * [210.52(A)(2)(2)], so receptacles land under windows. We break at the rough
 * opening (framing hole ≈ finished doorway + casing).
 * // LOD 400: NEC 2023 also breaks at stationary appliances and counterless
 * // fixed cabinets — needs furniture/casework data the scene doesn't carry yet.
 */
export function usableSegments(wall: WallSlice): Segment[] {
  const breaks: Segment[] = []
  // A box also can't mount in glass: any opening whose RO drops below the
  // top of a receptacle box (floor-to-ceiling glazing, low picture windows,
  // sliders) breaks the wall space exactly like a doorway.
  const boxTopY = RECEPTACLE_AFF + inches(4)
  for (const opening of wall.openings) {
    if (opening.kind !== 'door' && opening.sillHeight >= boxTopY) continue
    const a = Math.max(0, opening.u - opening.roughWidth / 2)
    const b = Math.min(wall.length, opening.u + opening.roughWidth / 2)
    if (b > a) breaks.push({ a, b })
  }
  breaks.sort((p, q) => p.a - q.a)

  const segments: Segment[] = []
  let cursor = 0
  for (const brk of breaks) {
    if (brk.a > cursor) segments.push({ a: cursor, b: brk.a })
    cursor = Math.max(cursor, brk.b)
  }
  if (cursor < wall.length) segments.push({ a: cursor, b: wall.length })
  // 210.52(A)(2)(1): wall spaces narrower than 2 ft don't require receptacles.
  return segments.filter((s) => s.b - s.a >= MIN_SEGMENT)
}

/**
 * Receptacle u-positions inside one wall space so no floor-line point is more
 * than 6 ft from a receptacle [210.52(A)(1)]: n = ceil(L / 12ft) devices on
 * even centers — the pitch L/n is <= 12 ft and each end overhang L/2n <= 6 ft,
 * so both the 12 ft run rule and the 6 ft from-every-break rule hold.
 */
export function receptaclePositions(segment: Segment): number[] {
  const length = segment.b - segment.a
  const count = Math.max(1, Math.ceil(length / MAX_SPACING))
  const pitch = length / count
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(segment.a + pitch * (i + 0.5))
  return out
}

// ---- engine ------------------------------------------------------------------

/**
 * Lay out the electrical fixtures for one level.
 *  - receptacles per 210.52(A) on every wall face that serves a room
 *  - GFCI marking per 210.8(A) room zones
 *  - a switch at each door's latch side (210.70(A)(1) + universal practice)
 *  - a ceiling light per room (210.70(A)(1))
 *  - smoke alarms per IRC R314.3: each bedroom, outside the sleeping area
 *    (hallway, else a bedroom-ADJACENT proxy room), one per story
 *  - CO alarm per IRC R315.3 when the level carries an attached garage
 *    (the repo's fuel-appliance assumption rides the same trigger)
 *  - one service panel (a `bones:service` panel override, when present, is
 *    the authoritative spot — homeruns re-anchor there; checklist A4)
 * `warnings`, when passed, collects level warnings (B13a: an alarm that
 * cannot be placed must never DROP silently).
 */
export function layoutElectrical(
  walls: WallSlice[],
  rooms: RoomSlice[],
  overrides?: ServiceOverrides,
  warnings?: string[],
  /** Placed sanitary items (compute's `extractPlacedFixtures` — the same
   * slice plumbing consumes): sinks/tubs drive the 210.8(A)(7)/(9) GFCI
   * radius and pin the B14c counter runs + B14d basin receptacles. */
  placed: PlacedFixtureSlice[] = [],
): Fixture[] {
  const fixtures: Fixture[] = []
  const wetRooms = rooms.filter((r) => GFCI_CATEGORIES.has(r.category))
  const sinkSpots = placed.filter((p) => SINK_RULE_KINDS.has(p.kind))
  const nearSink = (x: number, z: number): boolean =>
    sinkSpots.some((s) => Math.hypot(x - s.plan[0], z - s.plan[1]) <= SINK_GFCI_RADIUS)

  for (const wall of walls) {
    // Curved walls are flagged upstream (matches wall framing) — skip in v1.
    if (wall.curved) continue
    const faces = interiorFaces(wall, rooms)

    // ---- receptacles: the 6ft/12ft walk (NEC 210.52(A)) ----
    // ASSUMPTION: every wall is treated as bounding a habitable room
    // requiring the 6 ft rule; 210.52 technically scopes this to
    // kitchen/living/bed/etc. — over-placing is the safe drafting default.
    // LOD 400: wall spaces should WRAP inside corners (two 5 ft walls meeting
    // in a corner are one 10 ft space); walking per-wall over-counts slightly.
    // Every wall-mounted device carries a DETERMINISTIC `meta.deviceId`
    // (movable outlets, Q7): the ordinal walks this wall's u-positions in
    // derivation order, so an unchanged scene reproduces identical ids and
    // editing ANOTHER wall never shuffles this wall's. The id keys the
    // `bones:device` override nodes (device/schema.ts).
    let ordinal = 0
    for (const segment of usableSegments(wall)) {
      for (const u of receptaclePositions(segment)) {
        for (const face of faces) {
          const [x, z] = face.plan(u)
          // NEC 210.8(A): device lands in a kitchen/bath/garage/laundry zone
          // → GFCI — OR within 6 ft of a placed sink/tub/shower
          // [210.8(A)(7)/(9)]: the radius reaches receptacles in ADJACENT
          // dry rooms (a dining-room box 5 ft from the kitchen sink flips).
          // B14b closed the stale "once sink positions are extracted" gap —
          // compute has extracted placedFixtures since the plumbing rebuild.
          // F3 DECISION (round 2, stated): the radius is STRAIGHT-LINE and
          // pierces walls — NEC measures the cord path 'without piercing a
          // wall', so this over-protects (a box behind a partition 0.2 m
          // from a lav flips). Chosen deliberately: a same-room guard needs
          // zone data both sides and would silently UNDER-protect exactly
          // where scenes are weakest, and extra GFCI is always code-legal
          // while a missed one is a violation. Dry-room flips carry the
          // assumption on their LABEL; checklist E8 states it.
          const wet = wetRooms.some((r) => pointInPolygon([x, z], r.polygon))
          const sinkFlip = !wet && nearSink(x, z)
          fixtures.push({
            system: 'electrical',
            kind: wet || sinkFlip ? 'receptacle-gfci' : 'receptacle',
            position: [x, RECEPTACLE_AFF, z],
            rotationY: face.rotationY,
            sourceId: wall.id,
            ...(sinkFlip
              ? {
                  label:
                    'GFCI \u2014 within 6 ft of sink/tub (NEC 210.8(A)(7)/(9); straight-line reach, conservative)',
                }
              : {}),
            meta: { deviceId: `recep-${wall.id}-${ordinal}-${face.side === 1 ? 'p' : 'm'}` },
          })
        }
        ordinal += 1
      }
    }

    // ---- switches: one per door at the latch side (210.70(A)(1) practice) ----
    for (const opening of wall.openings) {
      if (opening.kind !== 'door') continue
      const halfRo = opening.roughWidth / 2
      // ASSUMPTION: the scene doesn't carry door swing/hinge data, so the
      // latch defaults to the +u side of the opening; flip when the box
      // would run past the wall end.
      let u = opening.u + halfRo + SWITCH_LATCH_OFFSET
      if (u > wall.length - inches(1)) u = opening.u - halfRo - SWITCH_LATCH_OFFSET
      // A window butted against the latch side would swallow the box —
      // nudge out of any RO crossing switch height (prod report: boxes
      // rendering on top of doors/windows).
      u = clearOfOpenings(wall, u, SWITCH_AFF - inches(6), SWITCH_AFF + inches(6))
      // No wall left for a box: the door consumes the whole wall, or the
      // opening data runs past the wall end (degenerate scene) — never place
      // a switch off the end of its wall.
      if (u < inches(1) || u > wall.length - inches(1)) continue
      for (const face of faces) {
        const [x, z] = face.plan(u)
        fixtures.push({
          system: 'electrical',
          kind: 'switch',
          position: [x, SWITCH_AFF, z],
          rotationY: face.rotationY,
          sourceId: opening.id,
          label: 'Switch (48" AFF, latch side)',
          // Keyed by the OPENING (not an ordinal): a door switch belongs to
          // its door — adding a second door never renumbers this one.
          meta: { deviceId: `switch-${wall.id}-${opening.id}-${face.side === 1 ? 'p' : 'm'}` },
        })
      }
    }
  }

  // ---- kitchen counter runs at 44" AFF (NEC 210.52(C), B14c) ----
  fixtures.push(...placeCounterReceptacles(walls, rooms, placed, warnings))

  // ---- basin receptacles within 3 ft of placed lavs (210.52(D), B14d) ----
  fixtures.push(...placeBasinReceptacles(walls, placed, warnings))

  // ---- lights: one switched lighting outlet per habitable room (210.70(A)(1)) ----
  // OUTDOOR zones (M4) are open air: a ceiling light at `ceilingHeight`
  // would float in the yard (day-9 residual: 'Light — Garden' at y=2.7 over
  // the grass). They get exterior ENTRANCE lights below instead — with a
  // level warning when no entrance adjoins them.
  const indoorRooms = rooms.filter((r) => r.category !== 'outdoor')
  const outdoorZones = rooms.filter((r) => r.category === 'outdoor')
  for (const room of indoorRooms) {
    const [cx, cz] = polygonCentroid(room.polygon)
    fixtures.push({
      system: 'electrical',
      kind: 'light',
      position: [cx, room.ceilingHeight, cz],
      rotationY: 0,
      sourceId: room.id,
      label: `Light — ${room.name || room.category}`,
    })
    // LOD 400: hallways and stairways (>= 6 risers) need 3-way switching with
    // a switch at each entry/floor level [210.70(A)(2)(3)] — model switch legs
    // once the stair graph is available.

    // ---- smoke alarms: one in each sleeping room (IRC R314.3) ----
    if (room.category === 'bedroom') {
      // ASSUMPTION: nudged 12" off the centroid so it doesn't z-fight the
      // room light; R314 only requires "in the room", ceiling mount typical.
      // Clamped INTO the polygon — narrow rooms flipped the nudge outside
      // (B13 round 2).
      const [ax, az] = nudgeInside(room.polygon, cx, cz, inches(12))
      fixtures.push({
        system: 'electrical',
        kind: 'smoke-alarm',
        position: [ax, room.ceilingHeight, az],
        rotationY: 0,
        sourceId: room.id,
        label: `Smoke alarm — ${room.name || 'bedroom'}`,
      })
    }
  }

  // ---- outdoor-zone lighting honesty (M4 + NEC 210.70(A)(2)(2)) ----
  // Real outdoor lighting exists, but the only spot the scene can carry
  // honestly is the code's own requirement: a wall-mounted fixture on the
  // EXTERIOR side of each entrance between the dwelling and the outdoor
  // zone (210.70(A)(2)(2) — outdoor entrances with grade-level access; the
  // door's interior latch-side switch above already controls it). Zones no
  // dwelling door opens into get a LEVEL WARNING instead of a fixture —
  // landscape/site lighting is a site-plan matter, never a floating light.
  if (outdoorZones.length > 0) {
    const litZones = new Set<string>()
    const litOpenings = new Set<string>()
    for (const wall of walls) {
      if (wall.curved) continue
      for (const opening of wall.openings) {
        if (opening.kind !== 'door' || litOpenings.has(opening.id)) continue
        for (const side of [1, -1] as const) {
          const outFace = faceOf(wall, side)
          const op = outFace.plan(opening.u)
          const zone = outdoorZones.find((z) => pointInPolygon(op, z.polygon))
          if (!zone) continue
          // INDOOR-FIRST, like isOpenAirFace (round-1 F1): the outdoor-face
          // point must be genuinely OPEN AIR — a courtyard polygon
          // double-claiming an indoor slice used to compose a phantom
          // 'Exterior light — Courtyard entrance' INSIDE the living room
          // AND swallow the courtyard's honesty warning via litZones.
          if (indoorRooms.some((r) => pointInPolygon(op, r.polygon))) continue
          // the entrance must come FROM the dwelling: the opposite face
          // stands in an indoor room (garden gates in fences don't count)
          const ip = faceOf(wall, side === 1 ? -1 : 1).plan(opening.u)
          const home = indoorRooms.find((r) => pointInPolygon(ip, r.polygon))
          if (!home) continue
          // Fixture centered above the door head; a full-height opening
          // (no headroom) mounts beside the RO at the latch band instead.
          let y = opening.sillHeight + opening.roughHeight + 0.15
          let u = opening.u
          if (y > wall.height - 0.1) {
            y = Math.min(2.0, wall.height - 0.15)
            u = clearOfOpenings(wall, u, y - 0.1, y + 0.1)
          }
          const [lx, lz] = outFace.plan(u)
          fixtures.push({
            system: 'electrical',
            kind: 'light',
            position: [lx, y, lz],
            rotationY: outFace.rotationY,
            // keyed to the INDOOR room the door serves: the fixture rides
            // that room's lighting circuit (assignCircuits home lookup)
            sourceId: home.id,
            label: `Exterior light — ${zone.name || 'outdoor'} entrance (NEC 210.70(A)(2))`,
          })
          litZones.add(zone.id)
          litOpenings.add(opening.id)
          break
        }
      }
    }
    for (const zone of outdoorZones) {
      if (litZones.has(zone.id)) continue
      warnings?.push(
        `outdoor zone “${zone.name || zone.id}”: open air — ceiling lighting not modeled; exterior fixtures by site plan (no dwelling entrance adjoins it)`,
      )
    }
  }

  // ---- smoke alarm outside the sleeping area (IRC R314.3(2)) ----
  // A drawn hallway is the natural host. Without one the alarm used to
  // silently DROP (LOD-400 audit B13a) — the fallback is any bedroom-
  // ADJACENT room via polygon adjacency (the space a bedroom door opens
  // into IS "outside the sleeping area"); when even the proxy fails, the
  // level warns loudly instead of leaving a code hole.
  const bedrooms = rooms.filter((r) => r.category === 'bedroom')
  const hallway = rooms.find((r) => r.category === 'hallway')
  let outsideHost: RoomSlice | undefined = hallway
  if (!outsideHost && bedrooms.length > 0) {
    outsideHost = bedroomAdjacentProxy(bedrooms, rooms)
    if (!outsideHost) {
      warnings?.push(
        'No hallway and no room adjoins a bedroom — smoke alarm outside the sleeping area (IRC R314.3(2)) not placed; verify layout',
      )
    }
  }
  if (outsideHost) {
    const [hx, hz] = polygonCentroid(outsideHost.polygon)
    // Proxy rooms already hold their own room light at the centroid —
    // nudge 12" like the bedroom alarms, clamped into the polygon
    // (0.5 m corridor hosts, B13 round 2). Hallways keep the legacy exact
    // centroid: their light shares it but the pre-B13 output pinned it.
    const [px, pz] = hallway ? [hx, hz] : nudgeInside(outsideHost.polygon, hx, hz, inches(12))
    fixtures.push({
      system: 'electrical',
      kind: 'smoke-alarm',
      position: [px, outsideHost.ceilingHeight, pz],
      rotationY: 0,
      sourceId: outsideHost.id,
      label: hallway
        ? 'Smoke alarm — outside sleeping area (R314)'
        : `Smoke alarm — outside sleeping area (IRC R314.3(2), hallway proxy: ${outsideHost.name || outsideHost.category})`,
    })
    // LOD 400: R314.3.3 cooking-appliance clearances (20 ft ionization / 6 ft
    // photoelectric) once appliance positions are extracted.
  }

  // ---- one smoke alarm per story (IRC R314.3(3)) ----
  // A storey with rooms but neither bedrooms nor a hallway used to compute
  // ZERO alarms (B13a: the upper den floor of a two-storey). Largest INDOOR
  // room hosts it, deterministically (area, ties by id) — R314 covers the
  // dwelling interior, so the alarm never elects an outdoor zone (day-9
  // residual: a garden-only level hung 'Smoke alarm — one per story' in the
  // yard, and a big garden outranked the living room on mixed levels). An
  // outdoor-only level warns instead — the E6 never-silent contract.
  if (rooms.length > 0 && !fixtures.some((f) => f.kind === 'smoke-alarm')) {
    if (indoorRooms.length === 0) {
      warnings?.push(
        'all zones on this level are outdoor — smoke alarm one per story (IRC R314.3(3)) not placed; alarms serve the dwelling interior (R314), verify layout',
      )
    } else {
      const host = [...indoorRooms].sort(
        (a, b) => polygonArea(b.polygon) - polygonArea(a.polygon) || a.id.localeCompare(b.id),
      )[0] as RoomSlice
      const [sx, sz] = polygonCentroid(host.polygon)
      const [ax, az] = nudgeInside(host.polygon, sx, sz, inches(12))
      fixtures.push({
        system: 'electrical',
        kind: 'smoke-alarm',
        position: [ax, host.ceilingHeight, az],
        rotationY: 0,
        sourceId: host.id,
        label: 'Smoke alarm — one per story (IRC R314.3(3))',
      })
    }
  }

  // ---- CO alarm outside the sleeping area (IRC R315.3) ----
  // R315.3 requires CO alarms outside each sleeping area when the dwelling
  // has fuel-fired appliances OR an attached garage. The trigger the scene
  // carries is the garage room category — and the repo's fuel assumption
  // rides the SAME trigger (plumbing places the fuel-fired 50-gal tank WH
  // at M1307.3's 18" ignition height exactly when a garage bounds a wall).
  // Bedroom-less levels have no sleeping area to serve → no CO alarm.
  const garage = rooms.find((r) => r.category === 'garage')
  if (garage && bedrooms.length > 0) {
    if (outsideHost) {
      const [cx2, cz2] = polygonCentroid(outsideHost.polygon)
      // −12" mirror of the smoke nudge (nudgeInside tries −d first) —
      // light / smoke / CO all read apart on the same ceiling, and the
      // spot stays inside narrow hosts (B13 round 2).
      const [ax, az] = nudgeInside(outsideHost.polygon, cx2, cz2, -inches(12))
      fixtures.push({
        system: 'electrical',
        kind: 'co-alarm',
        position: [ax, outsideHost.ceilingHeight, az],
        rotationY: 0,
        sourceId: outsideHost.id,
        label: 'CO alarm — outside sleeping area (IRC R315.3: attached garage / fuel-fired appliance)',
      })
    } else {
      warnings?.push(
        'Attached garage with bedrooms but no room to host it — CO alarm (IRC R315.3) not placed; verify layout',
      )
    }
  }

  // ---- door-less hallways still need a switched light (210.70(A)(2)) ----
  // The per-door pass above only serves rooms with doors; a hallway drawn
  // without door openings would get a light but no control.
  for (const room of rooms) {
    if (room.category !== 'hallway') continue
    const hasSwitch = fixtures.some(
      (f) => f.kind === 'switch' && pointInPolygon([f.position[0], f.position[2]], room.polygon),
    )
    if (hasSwitch) continue
    const [hx, hz] = polygonCentroid(room.polygon)
    let best: { wall: WallSlice; face: WallFace; u: number; d: number } | null = null
    for (const wall of walls) {
      if (wall.curved) continue
      for (const face of interiorFaces(wall, rooms)) {
        const [ax, az] = wall.start
        const u = Math.max(
          inches(4),
          Math.min(wall.length - inches(4), (hx - ax) * wall.dir[0] + (hz - az) * wall.dir[1]),
        )
        const [px, pz] = face.plan(u)
        if (!pointInPolygon([px, pz], room.polygon)) continue
        const d = Math.hypot(px - hx, pz - hz)
        if (!best || d < best.d) best = { wall, face, u, d }
      }
    }
    if (best) {
      const [x, z] = best.face.plan(best.u)
      fixtures.push({
        system: 'electrical',
        kind: 'switch',
        position: [x, SWITCH_AFF, z],
        rotationY: best.face.rotationY,
        sourceId: room.id,
        label: 'Switch — hallway lighting (210.70(A)(2))',
        // One control per door-less hallway — the ROOM is the stable key.
        meta: { deviceId: `switch-${best.wall.id}-hall-${room.id}` },
      })
    }
  }

  // ---- service panel ----
  const panel = placePanel(walls, rooms, overrides?.panel)
  if (panel) fixtures.push(panel)

  // ---- electric meter: street → METER → panel is the standard chain ----
  const meter = placeElectricMeter(walls, rooms, overrides?.electricMeter)
  if (meter) fixtures.push(meter)

  // ---- outdoor receptacles: front + back WR GFCI (NEC 210.52(E), B14a) ----
  fixtures.push(...placeOutdoorReceptacles(walls, rooms, meter, warnings))

  // ---- circuiting (NEC 210.11/210.12/220.12) + 3-way switching ----
  assignCircuits(fixtures, rooms)

  return fixtures
}

/**
 * Service panel: garages are the customary spot (surface-mount, unfinished
 * wall) — pick the longest wall bounding a garage; otherwise the longest
 * exterior wall. Mounted at the wall-face midpoint, center 60" AFF.
 * // LOD 400: enforce NEC 110.26 working clearance (30" wide x 36" deep) and
 * // 240.24(D)/(E) (not in bathrooms / over steps) against the room geometry.
 */
/**
 * Mount coordinate for the panel on its wall: the midpoint when clear, else
 * the center of the WIDEST opening-free segment (panels need 30in of working
 * space — NEC 110.26 — and can never live inside a rough opening; a window
 * crossing the enclosure's height counts exactly like a door).
 */
export function panelMountU(wall: WallSlice): number {
  const mid = wall.length / 2
  // Enclosure ≈ 30in tall centered at 60in AFF — and ~16in WIDE, so the
  // rough opening must clear the box EDGE, not just its centerline, plus
  // working clearance off the casing (prod report: a door overlapping the
  // wall midpoint by a sliver left the panel jammed against the jamb).
  const PANEL_HALF_W = inches(8)
  const CLEARANCE = inches(6)
  const inflate = PANEL_HALF_W + CLEARANCE
  const doors = openingSpans(wall, PANEL_AFF - inches(15), PANEL_AFF + inches(15)).map(
    (s) => [Math.max(0, s.lo - inflate), Math.min(wall.length, s.hi + inflate)] as const,
  )
  if (!doors.some(([lo, hi]) => mid > lo && mid < hi)) return mid
  let bestLo = 0
  let bestLen = -1
  let cursor = 0
  for (const [lo, hi] of doors) {
    if (lo - cursor > bestLen) {
      bestLen = lo - cursor
      bestLo = cursor
    }
    cursor = Math.max(cursor, hi)
  }
  if (wall.length - cursor > bestLen) {
    bestLen = wall.length - cursor
    bestLo = cursor
  }
  return bestLo + bestLen / 2
}

/** The garage bounding a wall — boundary list or face-midpoint containment. */
function garageBounding(wall: WallSlice, rooms: RoomSlice[]): RoomSlice | undefined {
  const garages = rooms.filter((r) => r.category === 'garage')
  return garages.find(
    (g) =>
      g.boundaryWallIds.includes(wall.id) ||
      pointInPolygon(faceOf(wall, 1).plan(wall.length / 2), g.polygon) ||
      pointInPolygon(faceOf(wall, -1).plan(wall.length / 2), g.polygon),
  )
}

/**
 * AUTO spot for the service panel — the longest garage wall, else the
 * longest exterior wall, else the longest wall, mounted at `panelMountU`.
 * Exported so the Bones panel's "Place service points" action can seed a
 * `bones:service` node exactly where the engine would auto-place.
 */
export function placePanelSpot(
  walls: WallSlice[],
  rooms: RoomSlice[],
): { wall: WallSlice; u: number; heightAff: number } | null {
  const straight = walls.filter((w) => !w.curved && w.length > 0)
  if (straight.length === 0) return null

  const longest = (candidates: WallSlice[]): WallSlice | undefined =>
    candidates.reduce<WallSlice | undefined>(
      (best, w) => (best === undefined || w.length > best.length ? w : best),
      undefined,
    )

  const garageWall = longest(straight.filter((w) => garageBounding(w, rooms) !== undefined))
  const wall = garageWall ?? longest(straight.filter((w) => w.exterior)) ?? longest(straight)
  if (!wall) return null
  // Round-12 B1: a door spanning the wall midpoint used to swallow the
  // panel — every homerun then started from inside the RO and never
  // reached its anchor. Mount in the widest door-free segment instead.
  return { wall, u: panelMountU(wall), heightAff: PANEL_AFF }
}

/**
 * A gizmo-written override position: every component finite AND off the
 * schema default [0,0,0] (within 1e-6). The default means "never moved";
 * NaN/Infinity components make the position unusable (never trust it).
 */
function movedOverridePosition(
  o: ServicePointOverride,
): readonly [number, number, number] | null {
  const p = o.position
  if (!p || p.length < 3) return null
  if (!p.every((v) => Number.isFinite(v))) return null
  return p.some((v) => Math.abs(v) > 1e-6) ? p : null
}

/** The override's usable wall: straight, non-degenerate, in this level's
 * walls list (missing/curved/foreign ids resolve to nothing). */
function overrideWall(walls: WallSlice[], o: ServicePointOverride): WallSlice | undefined {
  return o.wallId
    ? walls.find((w) => w.id === o.wallId && !w.curved && w.length >= 0.1)
    : undefined
}

const overrideT = (o: ServicePointOverride): number =>
  Math.max(0, Math.min(1, typeof o.wallT === 'number' && Number.isFinite(o.wallT) ? o.wallT : 0.5))

/**
 * Resolve a `bones:service` override to the engine's WallPoint form.
 * Precedence: a NON-default `position` (a manual inspector/MCP write —
 * editor drags of wall types commit `wallT` and reset position to the
 * default, see service/frame.ts) OUTRANKS the wall anchor and maps to the
 * nearest wall point; the default [0,0,0] means the wall anchor rules →
 * `wallId`+`wallT` verbatim (0..1 → u along the wall). An unresolvable wall
 * with a default position is NOT an override. Null = no override →
 * auto-place.
 */
export function overrideWallPoint(
  walls: WallSlice[],
  o: ServicePointOverride | undefined,
): WallPoint | null {
  if (!o) return null
  const moved = movedOverridePosition(o)
  if (moved) return nearestWallPoint(walls, [moved[0], moved[2]], Number.POSITIVE_INFINITY)
  const wall = overrideWall(walls, o)
  if (wall) return { wall, u: overrideT(o) * wall.length }
  return null
}

/**
 * Resolve a `bones:service` override to a PLAN point, with the same
 * precedence as `overrideWallPoint`: a moved `position` wins (verbatim —
 * floor consumers like the sewer exit take it as-is), else the wall lerp,
 * else null (no override → auto-place).
 */
export function overridePlanPoint(
  walls: WallSlice[],
  o: ServicePointOverride | undefined,
): readonly [number, number] | null {
  if (!o) return null
  const moved = movedOverridePosition(o)
  if (moved) return [moved[0], moved[2]]
  const wall = overrideWall(walls, o)
  if (wall) {
    const t = overrideT(o)
    return [
      wall.start[0] + wall.dir[0] * wall.length * t,
      wall.start[1] + wall.dir[1] * wall.length * t,
    ]
  }
  return null
}

function placePanel(
  walls: WallSlice[],
  rooms: RoomSlice[],
  override?: ServicePointOverride,
): Fixture | null {
  // A service node is the authoritative spot; auto-placement only when absent.
  const forced = overrideWallPoint(walls, override)
  const spot = forced
    ? { wall: forced.wall, u: forced.u, heightAff: override?.heightAff ?? PANEL_AFF }
    : placePanelSpot(walls, rooms)
  if (!spot) return null
  const { wall, u: mountU } = spot

  // Face into the garage when we have one, else the resolved interior face.
  let face = interiorFaces(wall, rooms)[0] ?? faceOf(wall, 1)
  const garage = garageBounding(wall, rooms)
  if (garage) {
    for (const side of [1, -1] as const) {
      const f = faceOf(wall, side)
      if (pointInPolygon(f.plan(wall.length / 2), garage.polygon)) face = f
    }
  }

  const [x, z] = face.plan(mountU)
  return {
    system: 'electrical',
    kind: 'panel',
    position: [x, spot.heightAff, z],
    rotationY: face.rotationY,
    sourceId: wall.id,
    label: `Service panel (${rules.circuits.minServiceAmps}A min per NEC 230.79(C))`,
    meta: { minServiceAmps: rules.circuits.minServiceAmps },
  }
}

/**
 * AUTO spot for the electric meter: the EXTERIOR face nearest the panel —
 * on the panel's own wall at `panelMountU ± 0.6 m` when that wall is
 * exterior, else the nearest exterior wall point to the panel mount (a
 * garage-divider panel still meters on the shell). RO-clear across the
 * socket height. Exported so the Bones panel's "Place service points"
 * action seeds a `bones:service` electric-meter node exactly where the
 * engine auto-places.
 */
export function placeElectricMeterSpot(
  walls: WallSlice[],
  rooms: RoomSlice[],
): { wall: WallSlice; u: number; heightAff: number } | null {
  const panelSpot = placePanelSpot(walls, rooms)
  if (!panelSpot) return null
  let wall = panelSpot.wall
  let u = panelSpot.u
  if (wall.exterior) {
    // Beside the panel bay, not on top of it — the service conductors stay
    // short and the panel's working space stays clear.
    u =
      u + METER_PANEL_OFFSET <= wall.length - 0.2
        ? u + METER_PANEL_OFFSET
        : Math.max(0.2, u - METER_PANEL_OFFSET)
  } else {
    const exterior = walls.filter((w) => w.exterior && !w.curved && w.length >= 0.1)
    if (exterior.length === 0) return null
    const p = wallPlan({ wall, u })
    const near = nearestWallPoint(exterior, p, Number.POSITIVE_INFINITY)
    if (!near) return null
    wall = near.wall
    u = near.u
  }
  u = clearOfOpenings(wall, u, METER_AFF - 0.25, METER_AFF + 0.25)
  return { wall, u, heightAff: METER_AFF }
}

/** The meter fixture on the EXTERIOR face of its wall — the override
 * (`bones:service` electric-meter node) is authoritative, auto otherwise. */
function placeElectricMeter(
  walls: WallSlice[],
  rooms: RoomSlice[],
  override?: ServicePointOverride,
): Fixture | null {
  const forced = overrideWallPoint(walls, override)
  const spot = forced
    ? { wall: forced.wall, u: forced.u, heightAff: override?.heightAff ?? METER_AFF }
    : placeElectricMeterSpot(walls, rooms)
  if (!spot) return null
  // Exterior face = the opposite of the resolved interior face; an outdoor
  // zone names the outside directly when no indoor room resolves a side.
  const face = exteriorFaceOf(spot.wall, rooms)
  const [x, z] = face.plan(spot.u)
  return {
    system: 'electrical',
    kind: 'electric-meter',
    position: [x, spot.heightAff, z],
    rotationY: face.rotationY,
    sourceId: spot.wall.id,
    label: 'Electric meter — service entrance (NEC 230.66)',
  }
}

// ---------------------------------------------------------------------------
// Outdoor receptacles (LOD-400 B14a, NEC 210.52(E))
// ---------------------------------------------------------------------------

/** 210.52(E)(1): outdoor receptacles mount no more than 6'6" above grade. */
const OUTDOOR_MAX_AFF = feet(rules.receptacles.outdoorMaxAboveGradeFt)

/** The exterior FACE of a wall — the opposite of its resolved interior face.
 * When NO indoor room resolves a side, a face standing in an OUTDOOR zone
 * (M4 open air) IS the outside — a garden behind the house used to read as
 * the interior side and flipped the meter/WR mounting INDOORS. With no zone
 * data at all: interior guess is +normal → use − (legacy). */
function exteriorFaceOf(wall: WallSlice, rooms: RoomSlice[]): WallFace {
  const inFace = interiorFaces(wall, rooms)[0]
  if (inFace) return faceOf(wall, inFace.side === 1 ? -1 : 1)
  const mid = wall.length / 2
  const outdoor = rooms.filter((r) => r.category === 'outdoor')
  for (const side of [1, -1] as const) {
    const f = faceOf(wall, side)
    if (outdoor.some((r) => pointInPolygon(f.plan(mid), r.polygon))) return f
  }
  return faceOf(wall, -1)
}

/**
 * NEC 210.52(E)(1): one receptacle at the FRONT and one at the BACK of every
 * dwelling. Never modeled before B14 — `interiorFaces()` mounts devices on
 * interior faces only, so the outdoor count was zero forever while
 * rules.json booked `outdoorFrontAndBack`. Both boxes are weather-resistant
 * GFCI behind an extra-duty in-use cover [210.8(A)(3), 406.9(A)/(B)] on
 * their own 20 A exterior circuit.
 *  - FRONT = the exterior wall whose OUTSIDE face midpoint is nearest the
 *    street point — the same bbox+margin pick the service lateral rides
 *    (`streetEdgePoint`, anchored at the meter when the scene has one), so
 *    the lateral and the front receptacle agree on "street side".
 *  - BACK = the most nearly opposite-facing exterior wall, farthest from the
 *    street (ties by id); with no opposing wall, the farthest remaining
 *    exterior wall. A single-exterior-wall scene mounts both on it, apart,
 *    and WARNS — two required outlets never silently collapse to one.
 * Boxes snap clear of rough openings box-edge-aware (`snapBoxClearOfRo`);
 * the 15" interior mounting convention sits far under the 6'6" grade cap.
 */
function placeOutdoorReceptacles(
  walls: WallSlice[],
  rooms: RoomSlice[],
  meter: Fixture | null,
  warnings?: string[],
): Fixture[] {
  const ext = walls.filter((w) => w.exterior && !w.curved && w.length >= 0.5)
  if (ext.length === 0) {
    // A scene with walls but no shell (partition-only drafts) has no
    // "outdoors" to serve — say so instead of inventing a face.
    if (walls.some((w) => !w.curved && w.length >= 0.5)) {
      warnings?.push(
        'no exterior wall — outdoor receptacles (NEC 210.52(E)) not placed; verify front/back coverage',
      )
    }
    return []
  }
  // Street anchor: the meter (the service chain's own anchor), else the
  // walls' bbox center — deterministic either way.
  let anchor: Pt
  if (meter) {
    anchor = [meter.position[0], meter.position[2]]
  } else {
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    for (const w of walls) {
      for (const p of [w.start, w.end]) {
        minX = Math.min(minX, p[0])
        maxX = Math.max(maxX, p[0])
        minZ = Math.min(minZ, p[1])
        maxZ = Math.max(maxZ, p[1])
      }
    }
    anchor = [(minX + maxX) / 2, (minZ + maxZ) / 2]
  }
  const street = streetEdgePoint(walls, anchor)

  const facing = new Map<string, WallFace>()
  for (const w of ext) facing.set(w.id, exteriorFaceOf(w, rooms))
  const distStreet = (w: WallSlice): number => {
    const [x, z] = (facing.get(w.id) as WallFace).plan(w.length / 2)
    return Math.hypot(x - street[0], z - street[1])
  }
  /** Outward plan normal of the wall's exterior face. */
  const outNormal = (w: WallSlice): Pt => {
    const side = (facing.get(w.id) as WallFace).side
    return [-w.dir[1] * side, w.dir[0] * side]
  }

  const front = [...ext].sort(
    (a, b) => distStreet(a) - distStreet(b) || a.id.localeCompare(b.id),
  )[0] as WallSlice
  const fn = outNormal(front)
  const opposing = ext.filter(
    (w) => w.id !== front.id && outNormal(w)[0] * fn[0] + outNormal(w)[1] * fn[1] < -0.5,
  )
  const backPool = opposing.length > 0 ? opposing : ext.filter((w) => w.id !== front.id)
  const back = [...backPool].sort(
    (a, b) => distStreet(b) - distStreet(a) || a.id.localeCompare(b.id),
  )[0]

  const out: Fixture[] = []
  const mount = (wall: WallSlice, role: 'front' | 'back', u0: number): void => {
    const aff = Math.min(RECEPTACLE_AFF, OUTDOOR_MAX_AFF)
    const y0 = aff - DEVICE_BOX_HALF_H
    const y1 = aff + DEVICE_BOX_HALF_H
    const u = snapBoxClearOfRo(wall, u0, y0, y1)
    // F4 (round 2): near-full-width glazing defeats snapBoxClearOfRo (4-pass
    // give-up + end clamp) — the box overlapped the RO edge SILENTLY. The
    // E1 contract: an unroutable RO is ⚠-flagged, never silent.
    const boxHalf = DEVICE_BOX_W / 2
    const obstructed = openingSpans(wall, y0, y1).some(
      (s) => u + boxHalf > s.lo && u - boxHalf < s.hi,
    )
    if (obstructed) {
      warnings?.push(
        `outdoor receptacle (${role}): mount position obstructed by glazing/rough openings — verify on site (NEC 210.52(E))`,
      )
    }
    const face = facing.get(wall.id) as WallFace
    const [x, z] = face.plan(u)
    out.push({
      system: 'electrical',
      kind: 'receptacle-wr-gfci',
      position: [x, aff, z],
      rotationY: face.rotationY,
      sourceId: wall.id,
      label: `Outdoor receptacle (${role}) — WR GFCI, in-use cover (NEC 210.52(E), 406.9(B))${
        obstructed ? OBSTRUCTED_NOTE : ''
      }`,
      meta: {
        deviceId: `recep-${wall.id}-out-${role}`,
        outdoor: role,
        wr: true,
        inUseCover: true,
        ...(obstructed ? { obstructed: true } : {}),
      },
    })
  }
  if (back && back.id !== front.id) {
    mount(front, 'front', front.length / 2)
    mount(back, 'back', back.length / 2)
  } else {
    mount(front, 'front', front.length / 3)
    mount(front, 'back', (2 * front.length) / 3)
    warnings?.push(
      'single exterior wall — front AND back outdoor receptacles (NEC 210.52(E)) share it; verify coverage',
    )
  }
  return out
}


// ---------------------------------------------------------------------------
// Kitchen counter runs (LOD-400 B14c, NEC 210.52(C))
// ---------------------------------------------------------------------------

/** Nearest straight wall to a plan point, raw projected u (NOT RO-snapped —
 * counter/basin placement snaps box-edge-aware afterwards). Ties by id. */
function nearestWallTo(
  walls: WallSlice[],
  p: Pt,
): { wall: WallSlice; u: number; d: number } | null {
  let best: { wall: WallSlice; u: number; d: number } | null = null
  for (const wall of walls) {
    if (wall.curved || wall.length < 0.1) continue
    const raw = (p[0] - wall.start[0]) * wall.dir[0] + (p[1] - wall.start[1]) * wall.dir[1]
    const u = Math.max(0, Math.min(wall.length, raw))
    const q: Pt = [wall.start[0] + wall.dir[0] * u, wall.start[1] + wall.dir[1] * u]
    const d = Math.hypot(q[0] - p[0], q[1] - p[1])
    const wins =
      !best || d < best.d - 1e-9 || (d <= best.d + 1e-9 && wall.id.localeCompare(best.wall.id) < 0)
    if (wins) best = { wall, u, d }
  }
  return best
}

/**
 * NEC 210.52(C)(1) countertop receptacles — the counter-height walk the
 * engine never had (every kitchen box sat at 15" AFF). The scene carries no
 * casework runs, so the walk is HYBRID-honest (B14c decision):
 *  - a PLACED kitchen-sink item pins its counter wall (nearest wall) — that
 *    wall's kitchen-side face gets the 44"-AFF walk, first box within 24" of
 *    each run end then every <= 48" (rules.json layoutAlgorithmHints);
 *    ASSUMPTION (stated): the counter runs the full kitchen wall space
 *    carrying the sink, clipped to the kitchen polygon and broken by door
 *    ROs; no box lands in the faucet zone directly behind the bowl.
 *  - a kitchen zone WITHOUT a placed sink has NO honest counter geometry —
 *    the level warns per kitchen instead of inventing casework.
 *  - an island sink (> ISLAND_WALL_DIST from every wall) requires no island
 *    receptacle under NEC 2023 210.52(C)(2) — labeled, never silent.
 * Counter boxes never count toward the 210.52(A) floor-line spacing census
 * (doNotCountTowardWallSpacing — meta.counter keys the exclusion).
 */
function placeCounterReceptacles(
  walls: WallSlice[],
  rooms: RoomSlice[],
  placed: PlacedFixtureSlice[],
  warnings?: string[],
): Fixture[] {
  const kitchens = rooms.filter((r) => r.category === 'kitchen')
  if (kitchens.length === 0) return []
  const straight = walls.filter((w) => !w.curved && w.length >= 0.1)
  const out: Fixture[] = []
  // Per counter FACE (`${wall.id}|${side}`): the u-spans already walked,
  // the box u-positions placed there, and the per-ZONE deviceId counts —
  // a second walk on the same face (another kitchen zone down the wall, or
  // a same-kitchen sink across a door RO) covers ITS OWN span with unique
  // ids instead of silently bailing (round-3 finding: the old global
  // `walked.has(key) → continue` was a FOURTH wordless zero-box exit).
  const walked = new Map<
    string,
    { spans: { a: number; b: number }[]; us: number[]; blocks: Map<string, number> }
  >()
  // STABLE WALK IDENTITY (night-10, E5 — the r3 skeptic's ordinal-re-base
  // advisory): the per-face ordinal offset used to be the RUNNING count of
  // boxes sibling walks placed first — deleting sink A re-based the
  // surviving walk's ids (ctr-4..7 → ctr-0..3) and orphaned the user's
  // bones:device overrides. The offset now keys on the KITCHEN ZONE:
  // each face ranks the kitchens FACING it (zone polygon contains a
  // sampled face point — SINK-independent, so removing a sink never moves
  // a sibling zone's block) in zone-id order, and a zone's walks number
  // inside their own 100-wide id block (rank × 100; a 100-box counter
  // face is >120 m of casework — unreachable). DECISION (stated): zone-id
  // keying over the suggested walk-content hash — simpler, stable under
  // sink edits, and rank 0 keeps plain 0-based ids so every
  // single-kitchen face (the baseline + master-parity class) stays
  // byte-identical; same-zone sibling walks (two sinks split by a door
  // RO) keep the legacy running ordinal WITHIN their block — that
  // residual re-base is confined to the same-zone multi-sink class, where
  // solo-scene id parity makes sibling-independent ids impossible (a pure
  // engine cannot tell "sink B after A was deleted" from "sink B alone").
  // Deleting/adding a KITCHEN ZONE re-ranks (structural edit, E5 note 3).
  const faceRank = new Map<string, number>()
  const rankOf = (w: WallSlice, face: WallFace, kitchen: RoomSlice): number => {
    const key = `${w.id}|${face.side}|${kitchen.id}`
    const hit = faceRank.get(key)
    if (hit !== undefined) return hit
    const step = 0.05
    const facesZone = (k: RoomSlice): boolean => {
      for (let u = 0; u <= w.length + 1e-9; u += step) {
        if (pointInPolygon(face.plan(Math.min(u, w.length)), k.polygon)) return true
      }
      return false
    }
    const facing = kitchens
      .filter(facesZone)
      .map((k) => k.id)
      .sort((a, b) => a.localeCompare(b))
    for (const [i, id] of facing.entries()) faceRank.set(`${w.id}|${face.side}|${id}`, i)
    return faceRank.get(key) ?? 0
  }
  for (const kitchen of kitchens) {
    const name = kitchen.name || kitchen.id
    const sinks = placed
      .filter((p) => p.kind === 'kitchen-sink' && pointInPolygon(p.plan, kitchen.polygon))
      .sort((a, b) => a.id.localeCompare(b.id))
    if (sinks.length === 0) {
      warnings?.push(
        `kitchen \u201c${name}\u201d: countertop receptacles (NEC 210.52(C)) not modeled \u2014 no placed counter/sink item pins the counter wall; verify counter runs`,
      )
      continue
    }
    for (const sink of sinks) {
      const near = nearestWallTo(straight, sink.plan)
      if (!near || near.d > ISLAND_WALL_DIST) {
        warnings?.push(
          `kitchen \u201c${name}\u201d: island sink \u2014 no island receptacle required (NEC 2023 210.52(C)(2)); future-provision outlet not modeled, verify`,
        )
        continue
      }
      const { wall, u: uSink } = near
      // the kitchen-side FACE: whichever face's point at the sink's u lies
      // inside THIS kitchen polygon
      const face = [faceOf(wall, 1), faceOf(wall, -1)].find((f) =>
        pointInPolygon(f.plan(uSink), kitchen.polygon),
      )
      if (!face) {
        // degenerate: neither face of the sink's nearest wall lies inside
        // its kitchen — a sink with a wall but no counter face (F2 round 2:
        // this bail exited SILENT, leaving a sinked kitchen with zero
        // counter boxes and zero words).
        warnings?.push(
          `kitchen \u201c${name}\u201d: counter wall does not face its kitchen \u2014 countertop receptacles (NEC 210.52(C)) not modeled; verify counter runs`,
        )
        continue
      }
      const y0 = COUNTER_RECEPTACLE_AFF - DEVICE_BOX_HALF_H
      const y1 = COUNTER_RECEPTACLE_AFF + DEVICE_BOX_HALF_H
      const doors = wall.openings
        .filter((o) => o.kind === 'door')
        .map((o) => ({
          lo: Math.max(0, o.u - o.roughWidth / 2),
          hi: Math.min(wall.length, o.u + o.roughWidth / 2),
        }))
      const usable = (u: number): boolean =>
        u >= 0 &&
        u <= wall.length &&
        !doors.some((s) => u > s.lo && u < s.hi) &&
        pointInPolygon(face.plan(u), kitchen.polygon)
      if (!usable(uSink)) {
        // the sink projects into a door RO span (or off the kitchen face) —
        // there is no counter line to walk (F2 round 2: silent zero-box
        // kitchen; the sink-less warning never covered this path).
        warnings?.push(
          `kitchen \u201c${name}\u201d: sink sits in a doorway span \u2014 countertop receptacles (NEC 210.52(C)) not modeled; verify counter runs`,
        )
        continue
      }
      // contiguous counter span around the sink (0.05 m march — drafting
      // resolution; the polygon clip is what keeps the run out of the hall)
      const step = 0.05
      let a = uSink
      while (a - step >= 0 && usable(a - step)) a -= step
      let b = uSink
      while (b + step <= wall.length && usable(b + step)) b += step
      if (b - a < COUNTER_MIN_WIDTH) {
        // code-legal exemption, but never wordless (the F2 class)
        warnings?.push(
          `kitchen \u201c${name}\u201d: counter strip narrower than 12" \u2014 no receptacle required (NEC 210.52(C)(1))`,
        )
        continue
      }
      const key = `${wall.id}|${face.side}`
      const rec = walked.get(key) ?? { spans: [], us: [], blocks: new Map<string, number>() }
      // Skip ONLY when this sink's own span already lies inside a prior
      // walk (its boxes exist there — honest silence). An uncovered span
      // gets its own walk + F1 coverage audit (round 3, scenarios A/B:
      // two kitchens on one 16 m wall; two sinks split by a door RO).
      if (rec.spans.some((s) => a >= s.a - 0.1 && b <= s.b + 0.1)) continue

      // even centers: pitch <= 48" AND end overhang (= pitch/2) <= 24"
      const count = Math.max(
        1,
        Math.ceil((b - a) / COUNTER_SPACING),
        Math.ceil((b - a) / (2 * COUNTER_FIRST_MAX)),
      )
      const pitch = (b - a) / count
      // this walk's id base: the zone's 100-wide block + the count its own
      // zone already placed on this face (sibling zones never shift it)
      const idBase = rankOf(wall, face, kitchen) * 100 + (rec.blocks.get(kitchen.id) ?? 0)
      const used: number[] = []
      for (let i = 0; i < count; i++) {
        let u = a + pitch * (i + 0.5)
        // faucet zone: never directly behind the bowl
        if (Math.abs(u - uSink) < 0.3) {
          const shifted = u <= uSink ? uSink - 0.35 : uSink + 0.35
          if (shifted > a && shifted < b) u = shifted
        }
        u = snapBoxClearOfRo(wall, u, y0, y1)
        if (!usable(u)) continue // snapped off the counter run
        // collapsed spots dedupe — across THIS walk and any prior walk on
        // the same face (overlapping kitchen zones can graze boundaries)
        if ([...rec.us, ...used].some((v) => Math.abs(v - u) < 0.15)) continue
        used.push(u)
        const [x, z] = face.plan(u)
        out.push({
          system: 'electrical',
          kind: 'receptacle-gfci', // kitchen counters are GFCI in every adopted edition
          position: [x, COUNTER_RECEPTACLE_AFF, z],
          rotationY: face.rotationY,
          sourceId: wall.id,
          label: 'Counter receptacle \u2014 44" AFF (NEC 210.52(C)(1))',
          meta: {
            // slot-based WITHIN a walk (single-walk scenes keep their ids
            // byte-identical); the zone-block base keeps a second walk's
            // ids unique AND stable when a sibling sink disappears
            // (round 3 uniqueness; night-10 E5 ordinal stability)
            deviceId: `recep-${wall.id}-ctr-${idBase + i}-${face.side === 1 ? 'p' : 'm'}`,
            counter: true,
          },
        })
      }
      // F1 (round 2): a WINDOW whose RO crosses the 44" band silently
      // GUTTED the walk — snapBoxClearOfRo pushed every box to the RO
      // edges, dedupe collapsed them, and a 4 m run kept two boxes 3.3 m
      // apart with zero words. Audit the PLACED boxes against the walk's
      // own contract on [a, b] (first box <= 24" of each end, <= 48"
      // o.c.); gaps spanning the faucet zone subtract it — the
      // behind-the-sink strip is exempt counter space
      // (counterBehindSinkOrRangeExemptIfDepthLessThanIn). Violated (or
      // empty) coverage warns — never silent.
      const faucetLo = uSink - 0.35
      const faucetHi = uSink + 0.35
      const effGap = (lo: number, hi: number): number => {
        const cut = Math.max(0, Math.min(hi, faucetHi) - Math.max(lo, faucetLo))
        return hi - lo - cut
      }
      const sorted = [...used].sort((p, q) => p - q)
      const tol = 0.11 // march resolution + box-margin slack
      let broken = sorted.length === 0
      if (!broken) {
        broken =
          effGap(a, sorted[0] as number) > COUNTER_FIRST_MAX + tol ||
          effGap(sorted[sorted.length - 1] as number, b) > COUNTER_FIRST_MAX + tol
        for (let i = 0; !broken && i + 1 < sorted.length; i++) {
          broken = effGap(sorted[i] as number, sorted[i + 1] as number) > COUNTER_SPACING + tol
        }
      }
      if (broken) {
        warnings?.push(
          `kitchen \u201c${name}\u201d: counter receptacle spacing exceeds NEC 210.52(C)'s 24"/48" walk after rough-opening snap (window over the counter) \u2014 verify`,
        )
      }
      rec.spans.push({ a, b })
      rec.us.push(...used)
      rec.blocks.set(kitchen.id, (rec.blocks.get(kitchen.id) ?? 0) + count)
      walked.set(key, rec)
    }
  }
  return out
}


// ---------------------------------------------------------------------------
// Bathroom basin receptacles (LOD-400 B14d, NEC 210.52(D))
// ---------------------------------------------------------------------------

/**
 * NEC 210.52(D): a receptacle within 3 ft of the outside edge of EACH basin
 * (one may serve two basins when within 3 ft of both). The engine never had
 * one — every bathroom box sat on the 15" floor-line walk. A PLACED lavatory
 * pins it: the box mounts on the nearest wall's basin-side face at ~40" AFF
 * (above the 34" vanity, inside the 12"-below-countertop floor), GFCI per
 * 210.8(A)(1), snapped RO-clear. Honesty paths: a freestanding basin (no
 * wall within 3 ft) WARNS instead of placing an unreachable box; an RO snap
 * that lands the box past 3 ft keeps the box AND warns — never silent.
 * Basin boxes never count toward the 210.52(A) floor-line census
 * (meta.basin keys the exclusion).
 */
function placeBasinReceptacles(
  walls: WallSlice[],
  placed: PlacedFixtureSlice[],
  warnings?: string[],
): Fixture[] {
  const lavs = placed
    .filter((p) => p.kind === 'lavatory')
    .sort((a, b) => a.id.localeCompare(b.id))
  if (lavs.length === 0) return []
  const straight = walls.filter((w) => !w.curved && w.length >= 0.1)
  const out: Fixture[] = []
  for (const lav of lavs) {
    // 210.52(D): one receptacle may serve two basins — a box already within
    // 3 ft of THIS basin satisfies it (deterministic: lavs walk id-sorted).
    const served = out.some(
      (f) => Math.hypot(f.position[0] - lav.plan[0], f.position[2] - lav.plan[1]) <= BASIN_RADIUS,
    )
    if (served) continue
    const near = nearestWallTo(straight, lav.plan)
    if (!near || near.d > BASIN_RADIUS) {
      warnings?.push(
        `basin \u201c${lav.id}\u201d: no wall within 3 ft \u2014 basin receptacle (NEC 210.52(D)) not placed; verify`,
      )
      continue
    }
    const { wall, u: uLav } = near
    // the BASIN side of the wall (geometric — works with or without zones)
    const sideRaw =
      -(lav.plan[0] - wall.start[0]) * wall.dir[1] + (lav.plan[1] - wall.start[1]) * wall.dir[0]
    const face = faceOf(wall, sideRaw >= 0 ? 1 : -1)
    const y0 = BASIN_RECEPTACLE_AFF - DEVICE_BOX_HALF_H
    const y1 = BASIN_RECEPTACLE_AFF + DEVICE_BOX_HALF_H
    const u = snapBoxClearOfRo(wall, uLav, y0, y1)
    const [x, z] = face.plan(u)
    const dist = Math.hypot(x - lav.plan[0], z - lav.plan[1])
    if (dist > BASIN_RADIUS + 1e-9) {
      warnings?.push(
        `basin \u201c${lav.id}\u201d: receptacle snapped ${dist.toFixed(2)} m away (rough opening) \u2014 exceeds 210.52(D)'s 3 ft; verify`,
      )
    }
    out.push({
      system: 'electrical',
      kind: 'receptacle-gfci',
      position: [x, BASIN_RECEPTACLE_AFF, z],
      rotationY: face.rotationY,
      sourceId: wall.id,
      label: 'Basin receptacle \u2014 within 3 ft of basin, GFCI (NEC 210.52(D))',
      meta: {
        deviceId: `recep-${wall.id}-basin-${lav.id}-${face.side === 1 ? 'p' : 'm'}`,
        basin: true,
      },
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Movable devices (Q7): `bones:device` overrides with code-aware snapping
// ---------------------------------------------------------------------------

/** Single-gang device box ≈ 3" wide × 4.5" tall — the footprint the RO and
 * stud snapping work with (matches the renderer's fixtureBox dims). */
export const DEVICE_BOX_W = inches(3)
const DEVICE_BOX_HALF_H = inches(2.25)
/** Legal mounting bands (device CENTER, m AFF). Receptacles: 15" convention /
 * ADA reach floor up to 1.7 m; switches: 0.9 m up to NEC 404.8(A)'s 6'7"
 * grip-center maximum (2.0 m). A dragged height clamps into its band. */
export const RECEPTACLE_HEIGHT_BAND: readonly [number, number] = [0.15, 1.7]
export const SWITCH_HEIGHT_BAND: readonly [number, number] = [0.9, 2.0]

/** Wall-framing verticals a device box can mount beside. */
const MOUNTABLE_VERTICALS: ReadonlySet<Member['role']> = new Set([
  'stud',
  'king-stud',
  'trimmer',
  'cripple',
])
/** Horizontal in-wall rows that already give a mid-bay box wood to mount to —
 * an off-stud box over one of these books NO extra device blocking. */
const MOUNT_ROWS: ReadonlySet<Member['role']> = new Set(['blocking', 'backing', 'fire-blocking'])

/**
 * The wall a device fixture mounts on: receptacles carry their wall id in
 * `sourceId`; door switches carry the OPENING id (resolve the wall holding
 * it); hallway switches carry the ROOM id (nearest wall axis). Exported for
 * the `bones:device` reconciler (device/derive.ts) — node seeding and the
 * engine must agree on every device's wall.
 */
export function deviceWallOf(fixture: Fixture, walls: WallSlice[]): WallSlice | null {
  const own = walls.find((w) => w.id === fixture.sourceId)
  if (own) return own
  const byOpening = walls.find((w) => w.openings.some((o) => o.id === fixture.sourceId))
  if (byOpening) return byOpening
  let best: WallSlice | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const wall of walls) {
    if (wall.curved || wall.length < 0.1) continue
    const u = wallU(wall, fixture.position)
    const q = wallPlan({ wall, u })
    const d = Math.hypot(q[0] - fixture.position[0], q[1] - fixture.position[2])
    if (d < bestDist) {
      bestDist = d
      best = wall
    }
  }
  return best
}

/** Clamped along-wall coordinate of a level-space position. */
function wallU(wall: WallSlice, p: readonly [number, number, number]): number {
  const raw = (p[0] - wall.start[0]) * wall.dir[0] + (p[2] - wall.start[1]) * wall.dir[1]
  return Math.max(0, Math.min(wall.length, raw))
}

/** Signed cross-wall offset of a position (+ = the wall's +normal face). */
function wallSideOffset(wall: WallSlice, p: readonly [number, number, number]): number {
  return -(p[0] - wall.start[0]) * wall.dir[1] + (p[2] - wall.start[1]) * wall.dir[0]
}

/** Snap `u` so the whole BOX (± width/2, + 1" trim breath) clears every rough
 * opening crossing [y0, y1] — like `clearOfOpenings`, but edge-aware: a box
 * whose CENTER sits just outside the RO still overlaps it. Iterates because
 * the snapped spot can graze a neighboring span. */
function snapBoxClearOfRo(wall: WallSlice, u: number, y0: number, y1: number): number {
  const margin = DEVICE_BOX_W / 2 + inches(1)
  let out = u
  for (let pass = 0; pass < 4; pass++) {
    const spans = openingSpans(wall, y0, y1)
    const hit = spans.find((s) => out > s.lo - margin && out < s.hi + margin)
    if (!hit) return out
    const lo = Math.max(margin, hit.lo - margin)
    const hi = Math.min(wall.length - margin, hit.hi + margin)
    out = out - hit.lo < hit.hi - out ? lo : hi
  }
  return out
}

type WallVertical = {
  u: number
  halfT: number
  w: number
  size?: Member['size']
  y0: number
  y1: number
}
type WallRow = { u0: number; u1: number; y0: number; y1: number }

/** Index the wall-framing members a box interacts with, per wall id. */
function indexWallFraming(
  members: Member[],
  walls: WallSlice[],
): { verticals: Map<string, WallVertical[]>; rows: Map<string, WallRow[]> } {
  const byId = new Map(walls.map((w) => [w.id, w]))
  const verticals = new Map<string, WallVertical[]>()
  const rows = new Map<string, WallRow[]>()
  for (const m of members) {
    if (m.system !== 'wall-framing') continue
    const wall = byId.get(m.sourceId)
    if (!wall) continue
    const u = wallU(wall, m.position)
    if (MOUNTABLE_VERTICALS.has(m.role)) {
      const list = verticals.get(wall.id) ?? []
      list.push({
        u,
        halfT: m.dims[0] / 2,
        w: m.dims[2],
        size: m.size,
        y0: m.position[1] - m.dims[1] / 2,
        y1: m.position[1] + m.dims[1] / 2,
      })
      verticals.set(wall.id, list)
    } else if (MOUNT_ROWS.has(m.role)) {
      const list = rows.get(wall.id) ?? []
      list.push({
        u0: u - m.dims[0] / 2,
        u1: u + m.dims[0] / 2,
        y0: m.position[1] - m.dims[1] / 2,
        y1: m.position[1] + m.dims[1] / 2,
      })
      rows.set(wall.id, list)
    }
  }
  for (const list of verticals.values()) list.sort((a, b) => a.u - b.u)
  return { verticals, rows }
}

/** The wall's o.c. rhythm read back from its actual verticals (median clear
 * gap — trimmer packs and doubled studs filtered). 16" when unreadable. */
function bayRhythm(verts: WallVertical[]): number {
  const gaps: number[] = []
  for (let i = 0; i + 1 < verts.length; i++) {
    const a = verts[i] as WallVertical
    const b = verts[i + 1] as WallVertical
    const gap = b.u - a.u
    if (gap > 0.09) gaps.push(gap)
  }
  if (gaps.length === 0) return inches(16)
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)] ?? inches(16)
}

export type AppliedDeviceOverrides = {
  fixtures: Fixture[]
  /** Extra wall-framing members the moves needed (device blocking). */
  members: Member[]
  warnings: string[]
}

/**
 * Apply `bones:device` overrides to the derived device fixtures — the
 * movable-outlets contract (Q7): the override WINS over the derived spot
 * (position-wins precedence like `overrideWallPoint`), but never lands
 * somewhere unbuildable. In order:
 *  (a) RO rule: the box never sits inside a door/window rough opening —
 *      snapped out with a warning (serviceOverrideRoWarning parity);
 *  (b) STUD rule: boxes mount BESIDE a stud — wallT snaps so the box edge
 *      lands against the nearest vertical's face (studs/kings/trimmers/
 *      cripples covering the box's height band); when the nearest usable
 *      face is farther than half a bay, the position is KEPT and a
 *      horizontal 2x 'device blocking' member spans the bay at box height
 *      (skipped when an existing blocking/backing/fire row already crosses
 *      there — the box mounts to that instead);
 *  (c) HEIGHT clamp: receptacles [0.15, 1.7] m, switches [0.9, 2.0] m
 *      (NEC 404.8(A)) — clamped with a note.
 * After the moves, NEC 210.52(A) receptacle spacing is re-checked on every
 * wall a moved receptacle left or joined — the derived layout is
 * spacing-correct by construction, so untouched walls never warn.
 * With no overrides the input `fixtures` array is returned UNCHANGED
 * (reference-equal — the byte-equality guarantee).
 */
export function applyDeviceOverrides(
  fixtures: Fixture[],
  walls: WallSlice[],
  rooms: RoomSlice[],
  framingMembers: Member[],
  overrides: DeviceOverrides | undefined,
  /** Colinear-dedupe context: an override committed against a DROPPED twin
   * (the drag's nearestUsableWall ties break by iteration order) resolves
   * to the kept wall with its wallT re-projected onto the kept centerline
   * (verify night-4 batch F2 — the silent fallback re-targeted the
   * derived wall with the twin's t). */
  dedupe?: { rawWalls: WallSlice[]; duplicateOf: Record<string, string> },
): AppliedDeviceOverrides {
  if (!overrides || overrides.size === 0) return { fixtures, members: [], warnings: [] }

  const out = [...fixtures]
  const members: Member[] = []
  const warnings: string[] = []
  const { verticals, rows } = indexWallFraming(framingMembers, walls)
  const spacingWalls = new Set<string>()

  // Deterministic application order (Map insertion order is the caller's):
  // sort by deviceId so duplicate work (shared blocking rows) is stable.
  const entries = [...overrides.entries()].sort(([a], [b]) => a.localeCompare(b))
  for (const [deviceId, override] of entries) {
    const idx = out.findIndex((f) => f.meta?.deviceId === deviceId)
    if (idx < 0) continue // orphan override — the id no longer derives
    const fixture = out[idx] as Fixture
    const isSwitch = fixture.kind === 'switch'
    const derivedWall = deviceWallOf(fixture, walls)

    // ---- resolve the target wall + raw u (position-wins precedence) ----
    let wall: WallSlice | null = null
    let u = 0
    const moved = movedOverridePosition(override)
    if (moved) {
      const wp = nearestWallPoint(walls, [moved[0], moved[2]])
      if (wp) {
        wall = wp.wall
        u = wp.u
      }
    } else {
      wall = overrideWall(walls, override) ?? null
      let projectedU: number | null = null
      if (!wall && override.wallId) {
        const keptId = dedupe?.duplicateOf[override.wallId]
        const kept = keptId ? walls.find((w) => w.id === keptId) : undefined
        const twin = dedupe?.rawWalls.find((w) => w.id === override.wallId)
        if (kept && twin && typeof override.wallT === 'number' && Number.isFinite(override.wallT)) {
          // project the twin-relative t through world space onto the kept run
          const t = Math.max(0, Math.min(1, override.wallT))
          const px = twin.start[0] + twin.dir[0] * t * twin.length
          const pz = twin.start[1] + twin.dir[1] * t * twin.length
          wall = kept
          projectedU = Math.max(
            0,
            Math.min(
              kept.length,
              (px - kept.start[0]) * kept.dir[0] + (pz - kept.start[1]) * kept.dir[1],
            ),
          )
        } else {
          warnings.push(
            `device “${deviceId}”: override wall ${override.wallId} is not framed — using the derived spot`,
          )
          // The warning must be TRUE: a foreign wall's t means nothing on
          // the derived wall — fall back to the derived position, never
          // override.wallT (narrow re-check: the warn branch re-targeted
          // to u = t×derivedLength, a spot the user never chose).
          wall = derivedWall
          if (wall) projectedU = wallU(wall, fixture.position)
        }
      }
      if (!wall) wall = derivedWall
      if (wall) {
        if (projectedU !== null) {
          u = projectedU
        } else {
          const t =
            typeof override.wallT === 'number' && Number.isFinite(override.wallT)
              ? Math.max(0, Math.min(1, override.wallT))
              : wallU(wall, fixture.position) / Math.max(wall.length, 1e-9)
          u = t * wall.length
        }
      }
    }
    if (!wall) continue // nothing usable to mount on — keep the derived spot

    // ---- (c) height clamp — applied first so the RO band is the real one ----
    const band = isSwitch ? SWITCH_HEIGHT_BAND : RECEPTACLE_HEIGHT_BAND
    const rawH =
      typeof override.heightAff === 'number' && Number.isFinite(override.heightAff)
        ? override.heightAff
        : fixture.position[1]
    const h = Math.max(band[0], Math.min(band[1], rawH))
    if (Math.abs(h - rawH) > 1e-9) {
      warnings.push(
        `device “${deviceId}”: mount height clamped to ${h.toFixed(2)} m — ` +
          (isSwitch
            ? `switches live in [${band[0]}, ${band[1]}] m (NEC 404.8(A) 6'7" max)`
            : `receptacles live in [${band[0]}, ${band[1]}] m`),
      )
    }
    const y0 = h - DEVICE_BOX_HALF_H
    const y1 = h + DEVICE_BOX_HALF_H

    // ---- (a) never inside a rough opening — snap out + warn ----
    const roSnapped = snapBoxClearOfRo(wall, u, y0, y1)
    if (Math.abs(roSnapped - u) > 1e-9) {
      warnings.push(
        `device “${deviceId}” sits in a door/window rough opening — snapped clear`,
      )
      u = roSnapped
    }

    // ---- (b) stud rule: the box edge mounts against a stud face ----
    const spans = openingSpans(wall, y0, y1)
    const boxHalf = DEVICE_BOX_W / 2
    const verts = (verticals.get(wall.id) ?? []).filter(
      (v) => v.y0 <= y0 + 0.02 && v.y1 >= y1 - 0.02,
    )
    if (verts.length > 0) {
      let bestC: number | null = null
      for (const v of verts) {
        for (const side of [-1, 1] as const) {
          const c = v.u + side * (v.halfT + boxHalf)
          if (c < boxHalf + 0.01 || c > wall.length - boxHalf - 0.01) continue
          // the box must clear every RO span and every other vertical
          if (spans.some((s) => c + boxHalf > s.lo && c - boxHalf < s.hi)) continue
          if (
            verts.some(
              (o) => c + boxHalf > o.u - o.halfT + 1e-6 && c - boxHalf < o.u + o.halfT - 1e-6,
            )
          ) {
            continue
          }
          if (bestC === null || Math.abs(c - u) < Math.abs(bestC - u)) bestC = c
        }
      }
      // Half a bay of the wall's o.c. rhythm — capped at a 24" bay so a
      // degenerate sparse rhythm still books blocking instead of teleporting
      // the box across a meters-wide gap.
      const halfBay = Math.min(bayRhythm(verts), inches(24)) / 2 + 1e-6
      if (bestC !== null && Math.abs(bestC - u) <= halfBay) {
        u = bestC
      } else {
        // Off-stud: keep the user's spot and make the mount PHYSICAL — a
        // flat 2x block between the bay's studs at box height (unless an
        // existing row already crosses the box there).
        const left = [...verts].reverse().find((v) => v.u < u)
        const right = verts.find((v) => v.u > u)
        const rowList = rows.get(wall.id) ?? []
        const covered = rowList.some(
          (r) => u > r.u0 - 1e-6 && u < r.u1 + 1e-6 && r.y0 < y1 && r.y1 > y0,
        )
        if (left && right && !covered) {
          const blockLen = right.u - right.halfT - (left.u + left.halfT)
          if (blockLen >= inches(3)) {
            const mid = (left.u + left.halfT + (right.u - right.halfT)) / 2
            const p = wallPlan({ wall, u: mid })
            const t = left.halfT * 2
            // A LumberSize on the flanking vertical means a lumber wall —
            // steel (LGS) verticals carry none, and their device blocking
            // is CFS strap/track hardware the takeoff does not price (the
            // label says so instead of booking phantom wood — LGS Phase 1).
            const steelWall = left.size === undefined
            const block: Member = {
              system: 'wall-framing',
              role: 'blocking',
              size: left.size,
              dims: [blockLen, t, left.w],
              length: blockLen,
              position: [p[0], h, p[1]],
              rotation: [0, Math.atan2(-wall.dir[1], wall.dir[0]), 0],
              material: steelWall ? 'steel' : 'lumber',
              sourceId: wall.id,
              label: steelWall
                ? 'device blocking — box off-stud (steel wall: CFS strap/track blocking per detail — not booked)'
                : 'device blocking — box off-stud',
            }
            members.push(block)
            // later devices in the same bay mount to THIS block
            rowList.push({ u0: left.u + left.halfT, u1: right.u - right.halfT, y0: h - t / 2, y1: h + t / 2 })
            rows.set(wall.id, rowList)
          }
        }
      }
    }

    // ---- re-mount the fixture on its (possibly new) wall face ----
    let side: 1 | -1
    if (derivedWall && wall.id === derivedWall.id) {
      side = wallSideOffset(wall, fixture.position) >= 0 ? 1 : -1
    } else {
      side = (interiorFaces(wall, rooms)[0] ?? faceOf(wall, 1)).side
    }
    const face = faceOf(wall, side)
    const [x, z] = face.plan(u)
    // Receptacles key their wall in sourceId — a cross-wall move re-keys it
    // so the device manifest (deviceWallOf) mounts the node where the box
    // stands. Switches keep their OPENING/room key: a moved switch still
    // controls the same light.
    const sourceId = !isSwitch && derivedWall && wall.id !== derivedWall.id ? wall.id : fixture.sourceId
    // F4 (round 3): the WR glazing ⚠ was computed at AUTO placement and a
    // user move never re-ran it — a box dragged to a clear wall kept the
    // stale flag (and one dragged INTO glazing gained none). Recompute at
    // the user's spot; flag + label note set or shed together.
    let flagPatch: Partial<Fixture> = {}
    if (fixture.kind === 'receptacle-wr-gfci') {
      const boxHalf = DEVICE_BOX_W / 2
      const nowObstructed = openingSpans(wall, y0, y1).some(
        (s) => u + boxHalf > s.lo && u - boxHalf < s.hi,
      )
      const base = (fixture.label ?? '').replace(OBSTRUCTED_NOTE, '')
      if (nowObstructed) {
        flagPatch = {
          label: `${base}${OBSTRUCTED_NOTE}`,
          meta: { ...fixture.meta, obstructed: true },
        }
      } else if (fixture.meta?.obstructed === true) {
        const { obstructed: _shed, ...restMeta } = fixture.meta
        flagPatch = { label: base, meta: restMeta }
      }
    }
    out[idx] = { ...fixture, ...flagPatch, position: [x, h, z], rotationY: face.rotationY, sourceId }

    if (!isSwitch) {
      if (derivedWall) spacingWalls.add(derivedWall.id)
      spacingWalls.add(wall.id)
    }
  }

  // ---- NEC 210.52(A) spacing advisory on the walls the moves touched ----
  for (const wallId of [...spacingWalls].sort()) {
    const wall = walls.find((w) => w.id === wallId)
    if (!wall || wall.curved || wall.length < 0.1) continue
    let violated = false
    for (const side of [1, -1] as const) {
      // receptacle u-positions on this wall FACE (moved arrivals included).
      // Counter + basin boxes never count toward 210.52(A) floor-line
      // spacing (doNotCountTowardWallSpacing — they serve the counter, not
      // the wall line); outdoor WR boxes are a different kind entirely.
      const us = out
        .filter((f) => f.kind === 'receptacle' || f.kind === 'receptacle-gfci')
        .filter((f) => f.meta?.counter !== true && f.meta?.basin !== true)
        .filter((f) => {
          const off = wallSideOffset(wall, f.position)
          if (Math.sign(off) !== side) return false
          if (Math.abs(off) > wall.thickness / 2 + FACE_OFFSET + 0.05) return false
          const raw =
            (f.position[0] - wall.start[0]) * wall.dir[0] +
            (f.position[2] - wall.start[1]) * wall.dir[1]
          return raw > -0.05 && raw < wall.length + 0.05
        })
        .map((f) => wallU(wall, f.position))
        .sort((a, b) => a - b)
      // Only faces that had receptacles derive receptacles — an exterior
      // wall's outside face never counts, and neither does a face opening
      // onto an OUTDOOR zone (M4 open air — the walk skips it by design).
      if (us.length === 0 && (wall.exterior || isOpenAirFace(wall, side, rooms))) continue
      for (const seg of usableSegments(wall)) {
        const inSeg = us.filter((v) => v >= seg.a - 1e-6 && v <= seg.b + 1e-6)
        let maxDist: number
        if (inSeg.length === 0) {
          maxDist = seg.b - seg.a // a usable space with NO receptacle left
        } else {
          maxDist = Math.max(
            (inSeg[0] as number) - seg.a,
            seg.b - (inSeg[inSeg.length - 1] as number),
          )
          for (let i = 0; i + 1 < inSeg.length; i++) {
            maxDist = Math.max(maxDist, ((inSeg[i + 1] as number) - (inSeg[i] as number)) / 2)
          }
        }
        if (maxDist > MAX_FROM_BREAK + 1e-9) violated = true
      }
    }
    if (violated) {
      warnings.push(
        `wall ${wall.id}: receptacle spacing exceeds NEC 210.52 (moved outlet leaves a >12ft gap)`,
      )
    }
  }

  return { fixtures: out, members, warnings }
}

// ---------------------------------------------------------------------------
// Circuiting (NEC 210.11 required circuits, 210.12 AFCI, 220.12/220.14 loads)
// ---------------------------------------------------------------------------

/** 220.14(I): 180 VA per receptacle strap. */
const RECEPTACLE_VA = 180
/** 220.12: general lighting load, 3 VA per square foot. */
const LIGHTING_VA_PER_SQFT = 3
const SQFT_PER_M2 = 10.7639
/** 15A × 120V × 80% continuous ≈ 1440 VA → 8 general receptacles per circuit. */
const MAX_GENERAL_DEVICES = 8
/** Lighting circuits sized to ~1200 VA of 220.12 floor load. */
const MAX_LIGHTING_VA = 1200
/** The ONE life-safety branch every smoke/CO alarm rides (IRC R314.4 — a
 * hardwired interconnect is a single 14/3 daisy chain, impossible across
 * two breakers). Exported for the routing + gates. */
export const ALARM_CIRCUIT = 'SD-1'

/** Unsigned area of a simple polygon (m²). */
export function polygonArea(polygon: Polygon): number {
  let area = 0
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i] ?? [0, 0]
    const [xj, zj] = polygon[j] ?? [0, 0]
    area += xj * zi - xi * zj
  }
  return Math.abs(area / 2)
}

/**
 * Assign every fixture to a branch circuit, stored flat in `fixture.meta`
 * ({circuit, breakerA, gaugeAwg, va, afci, gfci}):
 *  - kitchen receptacles alternate across the TWO 20A small-appliance
 *    circuits 210.11(C)(1) requires (SA-1/SA-2, 12 AWG);
 *  - bathroom (C)(3), laundry (C)(2) and garage (210.52(G)(1), 2023) get
 *    their dedicated 20A circuits;
 *  - remaining receptacles fill 15A general circuits 8 straps at a time;
 *  - lights ride room lighting circuits packed to ~1200 VA of the
 *    3 VA/ft² load, switches join the room they stand in;
 *  - EVERY smoke/CO alarm lands on the single `SD-1` circuit (IRC R314.4
 *    interconnect — see ALARM_CIRCUIT) and is marked `interconnected`;
 *  - AFCI marks follow 210.12(A) (kitchens/laundry/living areas — not
 *    bathrooms or garages, which carry the GFCI mark instead).
 * Then rooms holding 2+ switches get them relabeled as a 3-way group
 * (210.70(A)(2)(3) practice for multi-entry rooms and hallways).
 */
export function assignCircuits(fixtures: Fixture[], rooms: RoomSlice[]): void {
  const tag = (
    fixture: Fixture,
    circuit: string,
    breakerA: number,
    gaugeAwg: number,
    va: number,
    flags: { afci?: boolean; gfci?: boolean } = {},
  ): void => {
    fixture.meta = {
      ...fixture.meta,
      circuit,
      breakerA,
      gaugeAwg,
      va,
      ...(flags.afci ? { afci: true } : {}),
      ...(flags.gfci ? { gfci: true } : {}),
    }
  }
  const roomAt = (p: Pt): RoomSlice | undefined =>
    rooms.find((r) => pointInPolygon(p, r.polygon))

  // Lighting circuits: pack rooms in order until ~1200 VA of 220.12 load.
  // OUTDOOR zones pack no lighting load: they carry no ceiling light (M4 —
  // open air) and 220.12's 3 VA/ft² covers the dwelling's floor area, not
  // the yard (a 72 m² garden used to burn a whole LTG circuit of phantom
  // VA). Their entrance lights ride the served indoor room's circuit.
  const lightingOf = new Map<string, { circuit: string; va: number }>()
  let ltgIndex = 1
  let ltgVa = 0
  for (const room of rooms) {
    if (room.category === 'outdoor') continue
    const va = Math.max(60, Math.round(polygonArea(room.polygon) * SQFT_PER_M2 * LIGHTING_VA_PER_SQFT))
    if (ltgVa > 0 && ltgVa + va > MAX_LIGHTING_VA) {
      ltgIndex += 1
      ltgVa = 0
    }
    ltgVa += va
    lightingOf.set(room.id, { circuit: `LTG-${ltgIndex}`, va })
  }
  const lightingFallback = { circuit: 'LTG-1', va: 60 }

  let kitchenFlip = 0
  let generalIndex = 1
  let generalCount = 0
  for (const fixture of fixtures) {
    const plan: Pt = [fixture.position[0], fixture.position[2]]
    const room = roomAt(plan)
    if (fixture.kind === 'receptacle-wr-gfci') {
      // Outdoor receptacles ride ONE 20 A exterior circuit: GFCI per
      // 210.8(A)(3); NOT AFCI — 210.12(A) lists interior areas only.
      tag(fixture, 'EXT-1', 20, 12, RECEPTACLE_VA, { gfci: true })
    } else if (fixture.kind === 'receptacle' || fixture.kind === 'receptacle-gfci') {
      switch (room?.category) {
        case 'kitchen':
          // both required SABCs get used — straps alternate 210.11(C)(1)
          tag(fixture, `SA-${1 + (kitchenFlip++ % 2)}`, 20, 12, RECEPTACLE_VA, { afci: true, gfci: true })
          break
        case 'bathroom':
          tag(fixture, 'BA-1', 20, 12, RECEPTACLE_VA, { gfci: true })
          break
        case 'laundry':
          tag(fixture, 'LA-1', 20, 12, RECEPTACLE_VA, { afci: true, gfci: true })
          break
        case 'garage':
          tag(fixture, 'GA-1', 20, 12, RECEPTACLE_VA, { gfci: true })
          break
        default: {
          if (generalCount >= MAX_GENERAL_DEVICES) {
            generalIndex += 1
            generalCount = 0
          }
          generalCount += 1
          tag(fixture, `GEN-${generalIndex}`, 15, 14, RECEPTACLE_VA, { afci: true })
        }
      }
    } else if (fixture.kind === 'smoke-alarm' || fixture.kind === 'co-alarm') {
      // IRC R314.4: hardwired alarms are INTERCONNECTED — one 14/3 daisy
      // chain, which physically requires every smoke/CO alarm on ONE branch
      // circuit. They used to ride their rooms' lighting circuits and could
      // scatter across LTG-3/LTG-4 — an interconnect that cannot be pulled
      // (B13b). AFCI per NEC 210.12(A) (bedrooms/hallways are 210.12 areas).
      tag(fixture, ALARM_CIRCUIT, 15, 14, 5, { afci: true })
      fixture.meta = { ...fixture.meta, interconnected: true }
    } else if (fixture.kind === 'light') {
      const home = rooms.find((r) => r.id === fixture.sourceId)
      const lighting = (home && lightingOf.get(home.id)) ?? (room && lightingOf.get(room.id)) ?? lightingFallback
      tag(fixture, lighting.circuit, 15, 14, lighting.va, { afci: true })
    } else if (fixture.kind === 'switch') {
      const lighting = (room && lightingOf.get(room.id)) ?? lightingFallback
      tag(fixture, lighting.circuit, 15, 14, 0, { afci: true })
    }
  }

  // 3-way groups: a room whose interior holds 2+ switches (2+ doors, or a
  // hallway) needs each entry to control the light. Outdoor zones group
  // nothing — no switch mounts in open air, and a zone polygon drawn past
  // the wall centerline must not weld indoor switches into a garden group.
  for (const room of rooms) {
    if (room.category === 'outdoor') continue
    const entries = fixtures.filter(
      (f) => f.kind === 'switch' && pointInPolygon([f.position[0], f.position[2]], room.polygon),
    )
    if (entries.length < 2) continue
    for (const s of entries) {
      // threeWayRoom keys the TRAVELER group (B13b): routeWiring links the
      // group's switches with a 14/3 — grouping by circuit would wrongly
      // chain switches of different rooms sharing one LTG circuit.
      s.meta = { ...s.meta, threeWay: true, threeWayRoom: room.id }
      s.label = `Switch (3-way — ${room.name || room.category}, ${entries.length} entries)`
    }
  }

  const panel = fixtures.find((f) => f.kind === 'panel')
  if (panel) {
    const circuits = new Set<string>()
    for (const f of fixtures) {
      if (typeof f.meta?.circuit === 'string') circuits.add(f.meta.circuit)
    }
    panel.meta = { ...panel.meta, circuits: circuits.size }
  }
}

export type CircuitRow = {
  circuit: string
  breakerA: number
  gaugeAwg: number
  devices: number
  va: number
  afci: boolean
  gfci: boolean
}

/** Panel schedule: one row per circuit, dedicated circuits first. */
export function circuitSchedule(fixtures: Fixture[]): CircuitRow[] {
  const rows = new Map<string, CircuitRow>()
  for (const f of fixtures) {
    const circuit = f.meta?.circuit
    if (typeof circuit !== 'string') continue
    const row = rows.get(circuit) ?? {
      circuit,
      breakerA: Number(f.meta?.breakerA ?? 15),
      gaugeAwg: Number(f.meta?.gaugeAwg ?? 14),
      devices: 0,
      va: 0,
      afci: false,
      gfci: false,
    }
    row.devices += 1
    row.va += Number(f.meta?.va ?? 0)
    row.afci = row.afci || f.meta?.afci === true
    row.gfci =
      row.gfci ||
      f.meta?.gfci === true ||
      f.kind === 'receptacle-gfci' ||
      f.kind === 'receptacle-wr-gfci'
    rows.set(circuit, row)
  }
  const order = ['SA', 'BA', 'LA', 'GA', 'EXT', 'SD', 'GEN', 'LTG', 'AC']
  return [...rows.values()].sort((a, b) => {
    const pa = order.indexOf(a.circuit.split('-')[0] ?? '')
    const pb = order.indexOf(b.circuit.split('-')[0] ?? '')
    if (pa !== pb) return pa - pb
    return a.circuit.localeCompare(b.circuit, undefined, { numeric: true })
  })
}

// ---------------------------------------------------------------------------
// Wire routing (LOD 400): homeruns + branch chains following the WALLS
// ---------------------------------------------------------------------------

/** Horizontal runs bore through the studs at ~18" AFF (receptacle line). */
const WIRE_RUN_Y = inches(18)
/** Rendered NM sheath section — oversized so runs read at house scale. */
const WIRE_SECTION = inches(0.5)
/** Label note on every 14/3 leg of the smoke/CO interconnect chain (B13b).
 * Scoped '(this storey)': the engine routes ONE level, so the chain it can
 * truthfully claim ends at the storey line — R314.4 wants the whole
 * dwelling interconnected; compute warns on multi-storey scenes (E6 r2). */
const INTERCONNECT_NOTE = ' (alarm interconnect (this storey) — IRC R314.4)'
/** Label note on every 14/3 traveler leg of a 3-way switch group (B13b). */
const TRAVELER_NOTE = ' (3-way travelers — NEC 210.70/404.2)'
/** Traveler cables ride the 9th drill plane — above the 8 stapled circuit
 * planes (circuitIndex % 8), below the service feed's 10th. */
const TRAVELER_RUN_Y = WIRE_RUN_Y + 8 * 0.012
/** Two wall ends within this distance share a junction (corner/tee). */
const JUNCTION_TOL = 0.25

export type WallPoint = { wall: WallSlice; u: number }
/** One junction on a wall: at `u`, you can hop onto `to.wall` at `to.u`. */
type Junction = { u: number; to: WallPoint }

/** Plan point of a wall-centerline coordinate. */
export const wallPlan = (p: WallPoint): Pt => [
  p.wall.start[0] + p.wall.dir[0] * p.u,
  p.wall.start[1] + p.wall.dir[1] * p.u,
]

/** Vertical zone the drill-height planes occupy (8 circuit steps + sheath). */
const RUN_ZONE_TOP = WIRE_RUN_Y + 8 * 0.012 + inches(2)

/** Snap a wall coordinate out of any rough opening crossing [y0, y1] —
 * cable can't drop through a doorway OR a window; it lands in the first
 * stud bay past the king studs. */
export function clearOfOpenings(wall: WallSlice, u: number, y0 = 0, y1 = RUN_ZONE_TOP): number {
  // Box edge + casing clearance, not just the point: 4in keeps a device
  // visibly off the RO trim (prod report: box kissing the door edge).
  const margin = inches(4)
  for (const s of openingSpans(wall, y0, y1)) {
    if (u > s.lo && u < s.hi) {
      const snapLo = Math.max(margin, s.lo - margin)
      const snapHi = Math.min(wall.length - margin, s.hi + margin)
      return u - s.lo < s.hi - u ? snapLo : snapHi
    }
  }
  return u
}

/** Nearest wall-centerline point to a plan position (never inside a rough
 * opening that the anchor's vertical leg [0, yTop] would cross). */
export function nearestWallPoint(walls: WallSlice[], p: Pt, yTop = RUN_ZONE_TOP): WallPoint | null {
  let best: WallPoint | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const wall of walls) {
    if (wall.curved || wall.length < 0.1) continue
    const [ax, az] = wall.start
    const raw = Math.max(0, Math.min(wall.length, (p[0] - ax) * wall.dir[0] + (p[1] - az) * wall.dir[1]))
    const u = clearOfOpenings(wall, raw, 0, Math.max(yTop, RUN_ZONE_TOP))
    const q = wallPlan({ wall, u })
    const d = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (d < bestDist) {
      bestDist = d
      best = { wall, u }
    }
  }
  return best
}

/**
 * The wall graph: every wall endpoint that lands on another wall (corner or
 * tee, within JUNCTION_TOL) becomes a two-way junction. Wiring travels only
 * along wall centerlines and hops walls at junctions.
 */
export function buildWallGraph(walls: WallSlice[]): Map<string, Junction[]> {
  const graph = new Map<string, Junction[]>()
  const add = (from: WallPoint, to: WallPoint) => {
    const list = graph.get(from.wall.id) ?? []
    list.push({ u: from.u, to })
    graph.set(from.wall.id, list)
  }
  const usable = walls.filter((w) => !w.curved && w.length >= 0.1)
  for (const wall of usable) {
    for (const endU of [0, wall.length]) {
      const p = wallPlan({ wall, u: endU })
      for (const other of usable) {
        if (other.id === wall.id) continue
        const [ax, az] = other.start
        const proj = Math.max(
          0,
          Math.min(other.length, (p[0] - ax) * other.dir[0] + (p[1] - az) * other.dir[1]),
        )
        const q = wallPlan({ wall: other, u: proj })
        if (Math.hypot(q[0] - p[0], q[1] - p[1]) > JUNCTION_TOL) continue
        // A tee landing inside a rough opening would end a drill leg in the
        // doorway/window — snap the junction into the adjacent stud bay.
        const safeProj = clearOfOpenings(other, proj)
        add({ wall, u: endU }, { wall: other, u: safeProj })
        add({ wall: other, u: safeProj }, { wall, u: endU })
      }
    }
  }
  return graph
}

/**
 * BFS a leg list from one wall point to another, travelling only along
 * walls: [{wall, u0, u1}, …]. Null when the walls are disconnected.
 */
export function wallPath(
  graph: Map<string, Junction[]>,
  from: WallPoint,
  to: WallPoint,
): { wall: WallSlice; u0: number; u1: number }[] | null {
  if (from.wall.id === to.wall.id) return [{ wall: from.wall, u0: from.u, u1: to.u }]
  type Visit = { point: WallPoint; prev: Visit | null; enteredAt: number }
  const visited = new Set<string>([from.wall.id])
  let frontier: Visit[] = [{ point: from, prev: null, enteredAt: from.u }]
  for (let hop = 0; hop < 32 && frontier.length > 0; hop++) {
    const next: Visit[] = []
    for (const visit of frontier) {
      for (const junction of graph.get(visit.point.wall.id) ?? []) {
        const targetId = junction.to.wall.id
        if (visited.has(targetId)) continue
        visited.add(targetId)
        const arrival: Visit = {
          point: junction.to,
          prev: { ...visit, point: { wall: visit.point.wall, u: junction.u } },
          enteredAt: junction.to.u,
        }
        if (targetId === to.wall.id) {
          // reconstruct: walk back through the junctions
          const legs: { wall: WallSlice; u0: number; u1: number }[] = [
            { wall: to.wall, u0: arrival.enteredAt, u1: to.u },
          ]
          let cursor: Visit | null = arrival.prev
          while (cursor) {
            legs.unshift({ wall: cursor.point.wall, u0: cursor.enteredAt, u1: cursor.point.u })
            cursor = cursor.prev
          }
          return legs
        }
        next.push(arrival)
      }
    }
    frontier = next
  }
  return null
}

/** Emits one straight cable segment; `note` lands in the member label. */
type SegmentEmitter = (
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  note?: string,
) => void

/**
 * One drill-height leg along a wall — DETOURING around ANY rough opening
 * whose vertical RO crosses the drill plane (doors always; windows when
 * the sill drops below drill height — prod report: wires bored straight
 * through low windows). Route: rise inside the king-stud bay, cross above
 * the header, drop back — or duck UNDER the sill when there's no wall
 * above (full-height glazing with a stub sill). Shared by the branch
 * circuits AND the service feed (E1 applies to every cable).
 */
function emitWallLegWith(
  emit: SegmentEmitter,
  wall: WallSlice,
  u0: number,
  u1: number,
  runY: number,
): void {
  const dir = Math.sign(u1 - u0) || 1
  const legLo = Math.min(u0, u1)
  const legHi = Math.max(u0, u1)
  const crossed = openingSpans(wall, runY - 0.02, runY + 0.02)
    .filter((s) => s.lo < legHi && s.hi > legLo)
    .sort((a, b) => (a.lo - b.lo) * dir)
  const at = (u: number, y: number): [number, number, number] => {
    const p = wallPlan({ wall, u })
    return [p[0], y, p[1]]
  }
  const clamp = (u: number) => Math.max(legLo, Math.min(legHi, u))
  let cursor = u0
  for (const s of crossed) {
    const near = clamp(dir > 0 ? s.lo : s.hi)
    const far = clamp(dir > 0 ? s.hi : s.lo)
    // The crossing band itself must be clear too — a transom above a door
    // sits exactly where the over-the-header path would run.
    const blockedAt = (yy: number) =>
      openingSpans(wall, yy - 0.02, yy + 0.02).some((o) => o.lo < s.hi && o.hi > s.lo)
    let detourY: number | null = null
    for (let yy = s.topY + inches(4); yy <= wall.height - 0.05; yy += inches(4)) {
      if (!blockedAt(yy)) {
        detourY = yy
        break
      }
    }
    if (detourY === null) {
      for (let yy = s.sillY - inches(4); yy >= 0.04; yy -= inches(4)) {
        if (!blockedAt(yy)) {
          detourY = yy
          break
        }
      }
    }
    if (detourY === null) {
      // RO spans floor to ceiling — nowhere inside this wall to route.
      emit(at(cursor, runY), at(far, runY), ' (⚠ crosses full-height opening — verify)')
      cursor = far
      continue
    }
    emit(at(cursor, runY), at(near, runY))
    emit(at(near, runY), at(near, detourY))
    emit(at(near, detourY), at(far, detourY))
    emit(at(far, detourY), at(far, runY))
    cursor = far
  }
  emit(at(cursor, runY), at(u1, runY))
}

/**
 * Wall-following legs between two anchors at `runY`, bridging junction gaps
 * — false when the walls are disconnected (caller picks its fallback).
 * Round-12 B2/M1: junctions accepted within JUNCTION_TOL (or snapped out of
 * a door RO) leave the two walls' legs ending at DIFFERENT plan points;
 * every inter-leg gap is bridged explicitly — a run is continuous cable,
 * not adjacent segments.
 */
function emitWallPathWith(
  emit: SegmentEmitter,
  graph: Map<string, Junction[]>,
  from: WallPoint,
  to: WallPoint,
  runY: number,
): boolean {
  const legs = wallPath(graph, from, to)
  if (!legs) return false
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i] as { wall: WallSlice; u0: number; u1: number }
    emitWallLegWith(emit, leg.wall, leg.u0, leg.u1, runY)
    const next = legs[i + 1]
    if (next) {
      const a = wallPlan({ wall: leg.wall, u: leg.u1 })
      const b = wallPlan({ wall: next.wall, u: next.u0 })
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.02) {
        emit([a[0], runY, a[1]], [b[0], runY, b[1]], ' (junction jumper)')
      }
    }
  }
  return true
}

/**
 * Route every circuit as geometry that FOLLOWS THE WALLS: one homerun drop
 * at the panel, then a greedy nearest-neighbor chain through the circuit's
 * devices — each hop travels along wall centerlines at drill height,
 * hopping walls at corner/tee junctions, with a vertical leg at the
 * device's wall anchor. Ceiling devices (lights, smoke alarms) rise at
 * their nearest wall and cross the CEILING in two Manhattan legs (through
 * the joist bays). Disconnected islands fall back to Manhattan air legs,
 * flagged in the label. Lengths by gauge feed the takeoff's NM lines.
 * B13b: the SD (smoke/CO) circuit's chain is the hardwired INTERCONNECT —
 * every leg past the panel feed is 14/3-labeled (IRC R314.4) — and every
 * threeWay switch group gets a 14/3 traveler chain (NEC 210.70/404.2).
 */
export function routeWiring(
  fixtures: Fixture[],
  walls: WallSlice[] = [],
  context: ServiceCableContext = {},
): Member[] {
  const members: Member[] = []
  const panel = fixtures.find((f) => f.kind === 'panel')
  if (!panel) return members
  const graph = buildWallGraph(walls)

  const byCircuit = new Map<string, Fixture[]>()
  for (const f of fixtures) {
    if (f === panel) continue
    const circuit = f.meta?.circuit
    if (typeof circuit !== 'string') continue
    const list = byCircuit.get(circuit) ?? []
    list.push(f)
    byCircuit.set(circuit, list)
  }

  const emitWire = (
    circuit: string,
    gauge: number,
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    note = '',
    /** Insulated-conductor count: 2 = the default NM-B hot/neutral; 3 =
     * alarm interconnect + 3-way traveler cable (B13b). */
    conductors: 2 | 3 = 2,
  ): void => {
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const dz = to[2] - from[2]
    const len = Math.hypot(dx, dy, dz)
    if (len < 0.02) return
    const vertical = Math.abs(dy) > Math.hypot(dx, dz)
    members.push({
      system: 'electrical',
      role: 'wire-run',
      dims: vertical ? [WIRE_SECTION, len, WIRE_SECTION] : [len, WIRE_SECTION, WIRE_SECTION],
      length: len,
      position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
      rotation: [0, vertical ? 0 : Math.atan2(-dz, dx), 0],
      material: 'copper',
      sourceId: circuit,
      label: `NM-B ${gauge}/${conductors} w/G — ${circuit}${note}`,
    })
  }

  /** Wall-following legs between two anchors at drill height (shared
   * emitWallPathWith — RO detours + junction jumpers). */
  const routeHop = (
    circuit: string,
    gauge: number,
    from: WallPoint,
    to: WallPoint,
    runY: number = WIRE_RUN_Y,
    conductors: 2 | 3 = 2,
    extraNote = '',
  ): void => {
    const emit: SegmentEmitter = (a, b, note = '') =>
      emitWire(circuit, gauge, a, b, `${extraNote}${note}`, conductors)
    if (emitWallPathWith(emit, graph, from, to, runY)) return
    // Disconnected wall islands: a bed-height run through open room air is
    // a physically impossible cable path (checklist E4) — a real pull
    // crosses through the CEILING/joist space: rise up the source wall
    // through its plates, two Manhattan legs above both walls' top plates,
    // drop back down the target wall to drill height.
    const a = wallPlan(from)
    const b = wallPlan(to)
    // Clear EVERY wall in the scene: the legs may pass over rooms taller
    // than either endpoint wall (verify night-4 F1 — a 2.5m→2.5m island
    // hop crossed a 4m great room at bed height of ITS ceiling).
    let yCross = Math.max(from.wall.height, to.wall.height) + 0.05
    for (const w of walls) yCross = Math.max(yCross, w.height + 0.05)
    const note = ' (ceiling crossing — no wall path)'
    const seg = (p: readonly [number, number, number], q: readonly [number, number, number]) => {
      if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 0.01) return
      emitWire(circuit, gauge, p, q, `${extraNote}${note}`, conductors)
    }
    seg([a[0], runY, a[1]], [a[0], yCross, a[1]])
    seg([a[0], yCross, a[1]], [b[0], yCross, a[1]])
    seg([b[0], yCross, a[1]], [b[0], yCross, b[1]])
    seg([b[0], yCross, b[1]], [b[0], runY, b[1]])
  }

  const panelPlan: Pt = [panel.position[0], panel.position[2]]
  // The homerun drop spans drill height up to the panel — its anchor must
  // clear any RO in that whole vertical band.
  const panelAnchor = nearestWallPoint(walls, panelPlan, panel.position[1] + inches(15))
  let circuitIndex = 0
  for (const [circuit, devices] of byCircuit) {
    const gauge = Number(devices[0]?.meta?.gaugeAwg ?? 14)
    // Cables staple side by side, not inside each other: each circuit's
    // drill-height plane steps 12mm so the homerun spine reads as parallel
    // colored runs instead of 108 coincident segments (quality round-2).
    const runY = WIRE_RUN_Y + (circuitIndex++ % 8) * 0.012
    // homerun drop from the panel to drill height at its wall anchor
    const start = panelAnchor ?? null
    if (start) {
      const sp = wallPlan(start)
      // Round-12 B1/M8: the cable ENTERS the panel enclosure — bridge from
      // the panel's face-mounted position to the centerline anchor before
      // dropping to drill height. Without it every homerun floated
      // thickness/2 + FACE_OFFSET away from the panel.
      emitWire(
        circuit,
        gauge,
        [panel.position[0], panel.position[1], panel.position[2]],
        [sp[0], panel.position[1], sp[1]],
      )
      emitWire(circuit, gauge, [sp[0], panel.position[1], sp[1]], [sp[0], runY, sp[1]])
    }
    // The SD circuit IS the hardwired interconnect (IRC R314.4): the panel
    // feed arrives as 14/2, but from the FIRST alarm's stud bay onward the
    // cable carries the third (signal) conductor — every rise/ceiling/stub
    // leg serving an alarm and every alarm→alarm hop is 14/3-labeled, so
    // the interconnect is a continuous, walkable 14/3 chain (B13b gate).
    const isAlarmChain = circuit === ALARM_CIRCUIT
    let chained = false
    const remaining = [...devices]
    let cursor: WallPoint | null = start
    let cursorPlan: Pt = start ? wallPlan(start) : panelPlan
    while (remaining.length > 0) {
      let best = 0
      let bestDist = Number.POSITIVE_INFINITY
      for (let i = 0; i < remaining.length; i++) {
        const d = remaining[i] as Fixture
        const dist =
          Math.abs(d.position[0] - cursorPlan[0]) + Math.abs(d.position[2] - cursorPlan[1])
        if (dist < bestDist) {
          bestDist = dist
          best = i
        }
      }
      const device = remaining.splice(best, 1)[0] as Fixture
      const [x, y, z] = device.position
      const ceilingDevice =
        device.kind === 'light' || device.kind === 'smoke-alarm' || device.kind === 'co-alarm'
      // Alarm-chain conductor plan: hops after the first alarm carry the
      // interconnect; the legs INTO any alarm box are 14/3 too (the feed
      // transitions at the first alarm's bay).
      const hopCond: 2 | 3 = isAlarmChain && chained ? 3 : 2
      const hopNote = isAlarmChain && chained ? INTERCONNECT_NOTE : ''
      const legCond: 2 | 3 = isAlarmChain ? 3 : 2
      const legNote = isAlarmChain ? INTERCONNECT_NOTE : ''
      // Ceiling devices rise the full wall height inside a stud bay; wall
      // devices rise to their box — either way the bay must be RO-free for
      // the whole vertical leg (prod report: risers through windows).
      const anchor = nearestWallPoint(
        walls,
        [x, z],
        ceilingDevice ? Number.POSITIVE_INFINITY : Math.max(RUN_ZONE_TOP, y + inches(6)),
      )
      if (anchor && cursor) {
        routeHop(circuit, gauge, cursor, anchor, runY, hopCond, hopNote)
        const ap = wallPlan(anchor)
        if (ceilingDevice) {
          // rise inside the wall, then cross the ceiling through joist bays
          emitWire(circuit, gauge, [ap[0], runY, ap[1]], [ap[0], y, ap[1]], legNote, legCond)
          emitWire(circuit, gauge, [ap[0], y, ap[1]], [x, y, ap[1]], legNote, legCond)
          emitWire(circuit, gauge, [x, y, ap[1]], [x, y, z], legNote, legCond)
        } else {
          // drop/rise at the device's stud bay…
          emitWire(circuit, gauge, [ap[0], runY, ap[1]], [ap[0], y, ap[1]], legNote, legCond)
          // …then the box stub: centerline → the face-mounted box (round-12
          // M8 — no wire ever reached a box; the ~2.7in jog was implied).
          emitWire(circuit, gauge, [ap[0], y, ap[1]], [x, y, z], legNote, legCond)
        }
        cursor = anchor
        cursorPlan = ap
      } else {
        // No walls at all — degenerate scene: still no bed-height air runs
        // (E4): cross at a nominal ceiling height, drop at the device.
        const yC = 2.4
        const note = ' (ceiling crossing — no walls)'
        emitWire(circuit, gauge, [cursorPlan[0], runY, cursorPlan[1]], [cursorPlan[0], yC, cursorPlan[1]], `${legNote}${note}`, legCond)
        emitWire(circuit, gauge, [cursorPlan[0], yC, cursorPlan[1]], [x, yC, cursorPlan[1]], `${legNote}${note}`, legCond)
        emitWire(circuit, gauge, [x, yC, cursorPlan[1]], [x, yC, z], `${legNote}${note}`, legCond)
        emitWire(circuit, gauge, [x, yC, z], [x, y, z], legNote, legCond)
        cursorPlan = [x, z]
      }
      chained = true
    }
  }

  // ---- 3-way traveler legs (NEC 210.70(A)(2)(3) / 404.2) ----
  // A threeWay group's switches control ONE light from multiple entries —
  // that takes a 14/3 traveler cable BETWEEN the switch boxes in addition
  // to the switch legs above. threeWay-flagged pairs used to get no
  // traveler at all (B13b). The chain runs box → own stud bay → traveler
  // plane along the walls → partner's bay → partner box, deterministically
  // ordered by deviceId.
  // TRAVELER PREDICATE (B13 round 3, examiner flag 3): a chain links
  // switches that (1) share the threeWay room (meta.threeWayRoom),
  // (2) share the BRANCH CIRCUIT — a real 3-way pair shares its circuit by
  // definition; a duplicate overlapping zone used to weld one door's
  // opposite-face switches (LTG-1 × LTG-2) into a cross-circuit 'traveler'
  // boring 0.07 m through the wall — and (3) mount at DISTINCT openings:
  // the -p/-m face twins of one door are two different rooms' controls,
  // never a pair (one switch per wall+opening deviceId key survives).
  const travelerGroups = new Map<string, Fixture[]>()
  for (const f of fixtures) {
    if (f.kind !== 'switch' || f.meta?.threeWay !== true) continue
    if (typeof f.meta?.circuit !== 'string') continue
    const key = `${String(f.meta?.threeWayRoom ?? f.sourceId)}|${f.meta.circuit}`
    const list = travelerGroups.get(key) ?? []
    list.push(f)
    travelerGroups.set(key, list)
  }
  for (const [, group] of [...travelerGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // predicate (3): one switch per opening — the face twins dedupe
    // (lowest deviceId wins, keeping the chain order deterministic)
    const byOpening = new Map<string, Fixture>()
    for (const s of [...group].sort((a, b) =>
      String(a.meta?.deviceId ?? '').localeCompare(String(b.meta?.deviceId ?? '')),
    )) {
      const openingKey = String(s.meta?.deviceId ?? s.sourceId).replace(/-(p|m)$/, '')
      if (!byOpening.has(openingKey)) byOpening.set(openingKey, s)
    }
    const chain = [...byOpening.values()]
    if (chain.length < 2) continue
    const circuit = String(chain[0]?.meta?.circuit ?? 'LTG-1')
    const gauge = Number(chain[0]?.meta?.gaugeAwg ?? 14)
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i] as Fixture
      const b = chain[i + 1] as Fixture
      const aAnchor = nearestWallPoint(walls, [a.position[0], a.position[2]], Math.max(RUN_ZONE_TOP, a.position[1] + inches(6)))
      const bAnchor = nearestWallPoint(walls, [b.position[0], b.position[2]], Math.max(RUN_ZONE_TOP, b.position[1] + inches(6)))
      if (!aAnchor || !bAnchor) continue
      const pa = wallPlan(aAnchor)
      const pb = wallPlan(bAnchor)
      emitWire(circuit, gauge, a.position, [pa[0], a.position[1], pa[1]], TRAVELER_NOTE, 3)
      emitWire(circuit, gauge, [pa[0], a.position[1], pa[1]], [pa[0], TRAVELER_RUN_Y, pa[1]], TRAVELER_NOTE, 3)
      routeHop(circuit, gauge, aAnchor, bAnchor, TRAVELER_RUN_Y, 3, TRAVELER_NOTE)
      emitWire(circuit, gauge, [pb[0], TRAVELER_RUN_Y, pb[1]], [pb[0], b.position[1], pb[1]], TRAVELER_NOTE, 3)
      emitWire(circuit, gauge, [pb[0], b.position[1], pb[1]], b.position, TRAVELER_NOTE, 3)
    }
  }

  // ---- service entrance: street lateral → METER → panel feed ----
  members.push(...routeServiceCable(fixtures, walls, graph, context))

  return members
}

/** Underground service lateral depth (NEC 300.5 direct-buried ≈ 18–24"). */
const SERVICE_LATERAL_Y = -0.45
/** SE cable drawn heavy (2 AWG Cu look) so the service chain reads at house scale. */
const SERVICE_SECTION = 0.035
/** Map-edge proxy: the street corridor runs this far outside the walls' bbox. */
const STREET_EDGE_MARGIN = 4

/**
 * Nearest "street" point: the walls' plan bbox pushed out by the street
 * margin, then the closest point on that ring to `anchor`. ONE definition of
 * street-side for the whole electrical story: the service lateral
 * (routeServiceCable, anchored at the meter) and the B14 outdoor-receptacle
 * FRONT pick both ride it.
 */
export function streetEdgePoint(walls: WallSlice[], anchor: Pt): Pt {
  const [ax, az] = anchor
  let minX = ax
  let maxX = ax
  let minZ = az
  let maxZ = az
  for (const w of walls) {
    for (const p of [w.start, w.end]) {
      minX = Math.min(minX, p[0])
      maxX = Math.max(maxX, p[0])
      minZ = Math.min(minZ, p[1])
      maxZ = Math.max(maxZ, p[1])
    }
  }
  const edges: Pt[] = [
    [minX - STREET_EDGE_MARGIN, az],
    [maxX + STREET_EDGE_MARGIN, az],
    [ax, minZ - STREET_EDGE_MARGIN],
    [ax, maxZ + STREET_EDGE_MARGIN],
  ]
  return edges.reduce((best, e) =>
    Math.hypot(e[0] - ax, e[1] - az) < Math.hypot(best[0] - ax, best[1] - az) ? e : best,
  )
}
/** The meter→panel feed's service plane along the walls — one step above
 * the branch circuits' 8 stapled drill planes, inside the RO-cleared zone. */
const SERVICE_FEED_Y = WIRE_RUN_Y + 9 * 0.012

// ---- grounding electrode system (LOD-400 B12, NEC 250) ---------------------

/** NEC 250.52(A)(5): driven rod electrode — 8 ft, 5/8" copper-clad steel. */
const GROUND_ROD_LENGTH = feet(8)
const GROUND_ROD_DIAMETER = 0.016
/** NEC 250.53(A)(2)/(B): the supplemental rod stands ≥ 6 ft from the first. */
const GROUND_ROD_SPACING = feet(6)
/** Rod top driven below grade (250.53(G) — flush or below). */
const GROUND_ROD_TOP_Y = -0.05
/** The GEC runs along the grade line to the rods: above the stemwall top
 * (y=0 — a below-grade run at the meter's plan point would bore the
 * stemwall), below the E4 living band (≤ 0.01 reads as buried). */
const GES_GRADE_Y = 0.005
/** Rods stand off the foundation face — clear of the stemwall (8", half =
 * 0.102 m) AND the footing projection (16", half = 0.203 m). */
const GROUND_ROD_STANDOFF = 0.45
/** Bare GEC / bonding jumper drawn thinner than the SE cable. */
const GES_SECTION = 0.014
/** The water-pipe bond's wall plane. Round-3 skeptic F2: one 12 mm step
 * above the feed EMBEDDED the two conductors (half-sections sum to
 * 24.5 mm) — the plane now clears the feed by the section sum + 10 mm
 * skin, so shared wall legs run parallel, never inside each other. */
const GES_BOND_Y = SERVICE_FEED_Y + (SERVICE_SECTION + GES_SECTION) / 2 + 0.01
/** Bay-step strap-outs: the GES drops one step along the anchor wall so a
 * drop never shares a plan point with the SE riser (meter end, round 2),
 * the meter→panel feed rise (panel end, round-3 F2) or the plumbing cold
 * riser (water-entry end). */
const GES_STRAP_OUT = 0.08
/** Rod clearance of the buried SE street lateral: half sections + skin
 * (round-3 F1 — the lateral used to bore rod 1 through its full section). */
const ROD_LATERAL_CLEAR = SERVICE_SECTION / 2 + GROUND_ROD_DIAMETER / 2 + 0.02
/** Parallel buried conductors must clear the summed half-sections + skin —
 * the r3-residual mid-leg dodge target (the gate floor is the bare sum). */
const GES_EMBED_FLOOR = (SERVICE_SECTION + GES_SECTION) / 2 + 0.01
/** Rod (and buried rod-to-rod GEC leg) clearance of any wall's below-grade
 * band: footing half-width (16" → 0.203 m) + rod + skin (round-3 F3 —
 * a concave L-plan put rod 2 inside the wing footprint). */
const ROD_FOUNDATION_CLEAR = 0.25
/** Slide search along the wall axis when the default rod spot is obstructed. */
const ROD_SLIDE_STEP = 0.3
const ROD_SLIDE_MAX = 3.0

type PlanPt = readonly [number, number]

/** Plan distance point → segment (rod-spot validity scans). */
function planPointSegDist(p: PlanPt, a: PlanPt, b: PlanPt): number {
  const abx = b[0] - a[0]
  const abz = b[1] - a[1]
  const l2 = abx * abx + abz * abz
  const t =
    l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / l2))
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + abz * t))
}

/** Plan distance segment → segment (0 when they properly cross). */
function planSegSegDist(a1: PlanPt, a2: PlanPt, b1: PlanPt, b2: PlanPt): number {
  const cross = (p: PlanPt, q: PlanPt, r: PlanPt): number =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const o1 = cross(a1, a2, b1)
  const o2 = cross(a1, a2, b2)
  const o3 = cross(b1, b2, a1)
  const o4 = cross(b1, b2, a2)
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0
  return Math.min(
    planPointSegDist(b1, a1, a2),
    planPointSegDist(b2, a1, a2),
    planPointSegDist(a1, b1, b2),
    planPointSegDist(a2, b1, b2),
  )
}

/**
 * NEC 250.66 GEC size from the service rating, via the service-entrance
 * conductor the rating implies (100 A → 4 AWG Cu SE → 8 AWG GEC; 150/175 A
 * → 1/1-0 → 6; 200 A → 2/0 → 4). Rod electrodes alone would cap at 6 AWG
 * (250.66(A)) but the same conductor also bonds the water pipe (250.104
 * sizes off Table 250.102(C)(1) — same numbers here), so the full size is
 * booked. Exported for the takeoff/legend gates.
 */
export function gecSizeAwg(serviceAmps: number): number {
  if (serviceAmps <= 125) return 8
  if (serviceAmps <= 175) return 6
  if (serviceAmps <= 200) return 4
  return 2
}

/**
 * Cross-trade context for the service chain (B12): the metal water service
 * entry point the NEC 250.104 bond targets. Compute resolves it from the
 * waterEntry service override (authoritative) or the plumbing engine's own
 * auto-spot (`placeMeterSpot` — mirrored deterministically, plumbing runs
 * after electrical). Absent/null = no water entry visible — the bond is
 * skipped and the assumption is LABELED on the intersystem bonding
 * termination member, never silent.
 */
export type ServiceCableContext = {
  waterEntry?: readonly [number, number, number] | null
  /** Room footprints for the rod-spot validity scan (round-3 F3 — a rod
   * must never land inside the house). */
  rooms?: readonly RoomSlice[]
}

/**
 * True when the straight segment a→b passes through any rough opening's
 * wall-body volume (sampled every 5 cm — the E1 harness geometry). Used to
 * ⚠-flag the service legs that cannot detour (laterals, socket/enclosure
 * bridges) instead of crossing silently.
 */
export function segmentCrossesRo(
  walls: WallSlice[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): boolean {
  type Box = { min: [number, number, number]; max: [number, number, number] }
  const boxes: Box[] = []
  for (const w of walls) {
    if (w.curved) continue
    const latX = Math.abs(-w.dir[1]) * (w.thickness / 2 + 0.01)
    const latZ = Math.abs(w.dir[0]) * (w.thickness / 2 + 0.01)
    for (const o of w.openings) {
      const lo = Math.max(0, o.u - o.roughWidth / 2)
      const hi = Math.min(w.length, o.u + o.roughWidth / 2)
      if (hi <= lo) continue
      const p = wallPlan({ wall: w, u: lo })
      const q = wallPlan({ wall: w, u: hi })
      boxes.push({
        min: [Math.min(p[0], q[0]) - latX, o.sillHeight, Math.min(p[1], q[1]) - latZ],
        max: [
          Math.max(p[0], q[0]) + latX,
          o.sillHeight + o.roughHeight,
          Math.max(p[1], q[1]) + latZ,
        ],
      })
    }
  }
  if (boxes.length === 0) return false
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.05))
  for (let i = 0; i <= steps; i++) {
    const px = a[0] + ((b[0] - a[0]) * i) / steps
    const py = a[1] + ((b[1] - a[1]) * i) / steps
    const pz = a[2] + ((b[2] - a[2]) * i) / steps
    if (
      boxes.some(
        (bx) =>
          px > bx.min[0] &&
          px < bx.max[0] &&
          py > bx.min[1] &&
          py < bx.max[1] &&
          pz > bx.min[2] &&
          pz < bx.max[2],
      )
    ) {
      return true
    }
  }
  return false
}

/**
 * The standard residential chain is street → METER on the house side →
 * panel. Route it as real geometry: an underground lateral from the nearest
 * map-edge point to below the meter, a riser up the exterior face into the
 * socket, then the meter→panel feed ALONG THE WALLS at a service plane —
 * wall-graph legs with the standard RO detours, exactly like the branch
 * circuits (skeptic 2026-08-16: the old straight Manhattan feed pierced a
 * garage-door RO at socket height and flew 3.6 m through room air after a
 * panel drag). Legs that cannot detour (laterals, socket/enclosure bridges)
 * are sampled against the RO boxes and ⚠-flagged when crossing. The meter
 * fixture is the anchor — a moved `bones:service` electric-meter node
 * re-anchors the whole chain (checklist A4). Exported for the gates.
 */
export function routeServiceCable(
  fixtures: Fixture[],
  walls: WallSlice[],
  graph: Map<string, Junction[]> = buildWallGraph(walls),
  context: ServiceCableContext = {},
): Member[] {
  const members: Member[] = []
  const meter = fixtures.find((f) => f.kind === 'electric-meter')
  const panel = fixtures.find((f) => f.kind === 'panel')
  if (!meter || !panel) return members

  const heavy = (
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    note: string,
  ): void => {
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const dz = to[2] - from[2]
    const len = Math.hypot(dx, dy, dz)
    if (len < 0.02) return
    const vertical = Math.abs(dy) > Math.hypot(dx, dz)
    members.push({
      system: 'electrical',
      role: 'wire-run',
      dims: vertical
        ? [SERVICE_SECTION, len, SERVICE_SECTION]
        : [len, SERVICE_SECTION, SERVICE_SECTION],
      length: len,
      position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
      rotation: [0, vertical ? 0 : Math.atan2(-dz, dx), 0],
      material: 'copper',
      sourceId: 'service-entrance',
      label: `Service entrance 2 AWG Cu — ${note}`,
    })
  }
  /** Straight leg that can't detour: flag it when it crosses an RO box. */
  const flagged = (
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    note: string,
  ): void =>
    heavy(
      from,
      to,
      segmentCrossesRo(walls, from, to) ? `${note} (⚠ crosses rough opening — verify)` : note,
    )

  // Nearest map-edge point: the walls' plan bbox pushed out by the street
  // margin, then the closest point on that ring to the meter (shared with
  // the B14 outdoor-receptacle front pick — one definition of "street").
  const [mx, my, mz] = meter.position
  const street = streetEdgePoint(walls, [mx, mz])

  // Underground lateral (Manhattan), then the riser up into the socket —
  // sampled against the RO boxes (a meter dragged under full-height glazing
  // gets a flag, never a silent crossing).
  flagged([street[0], SERVICE_LATERAL_Y, street[1]], [mx, SERVICE_LATERAL_Y, street[1]], 'street lateral (NEC 300.5)')
  flagged([mx, SERVICE_LATERAL_Y, street[1]], [mx, SERVICE_LATERAL_Y, mz], 'street lateral (NEC 300.5)')
  flagged([mx, SERVICE_LATERAL_Y, mz], [mx, my, mz], 'riser to meter')

  // Meter → panel feed (NEC 230.66/230.70): socket → wall centerline, down
  // the stud bay to the service plane, wall-graph legs (RO detours + junction
  // jumpers), back up the panel's bay and into the enclosure.
  const [px, py, pz] = panel.position
  const meterAnchor = nearestWallPoint(walls, [mx, mz], my + 0.25)
  const panelAnchor = nearestWallPoint(walls, [px, pz], py + inches(15))
  const feedEmit: SegmentEmitter = (a, b, note = '') => heavy(a, b, `meter → panel feed${note}`)
  const routed =
    meterAnchor !== null &&
    panelAnchor !== null &&
    wallPath(graph, meterAnchor, panelAnchor) !== null
  if (routed && meterAnchor && panelAnchor) {
    const ma = wallPlan(meterAnchor)
    const pa = wallPlan(panelAnchor)
    flagged([mx, my, mz], [ma[0], my, ma[1]], 'meter → panel feed')
    heavy([ma[0], my, ma[1]], [ma[0], SERVICE_FEED_Y, ma[1]], 'meter → panel feed')
    emitWallPathWith(feedEmit, graph, meterAnchor, panelAnchor, SERVICE_FEED_Y)
    heavy([pa[0], SERVICE_FEED_Y, pa[1]], [pa[0], py, pa[1]], 'meter → panel feed')
    flagged([pa[0], py, pa[1]], [px, py, pz], 'meter → panel feed')
  } else {
    // Disconnected islands / degenerate scenes: a feeder between
    // disconnected structures is BURIED conduit (NEC 300.5), not a
    // panel-height air run (E4) — drop below grade at the meter, cross at
    // lateral depth, rise into the panel.
    const fnote = 'meter → panel feed (⚠ buried crossing — no wall path)'
    // No vertical drop here: the street riser member already runs
    // [mx, SERVICE_LATERAL_Y] → [mx, my] — re-emitting it double-booked
    // ~6ft of SE cable and z-fought the riser (verify night-4 F4).
    heavy([mx, SERVICE_LATERAL_Y, mz], [px, SERVICE_LATERAL_Y, mz], fnote)
    heavy([px, SERVICE_LATERAL_Y, mz], [px, SERVICE_LATERAL_Y, pz], fnote)
    heavy([px, SERVICE_LATERAL_Y, pz], [px, py, pz], fnote)
  }

  // ---- grounding electrode system (LOD-400 B12, NEC 250.50) ----
  // Every service orders one; none was modeled — a regex over composed
  // members for ground/rod/electrode/GEC found ZERO (wave-1 confirmed),
  // conspicuous next to the fabrication-level chain above. Emitted here so
  // the SAME meter anchor drives it: a moved electric-meter node re-anchors
  // rods + GEC with the rest of the chain (checklist A4).
  const ratedAmps =
    typeof panel.meta?.minServiceAmps === 'number' ? panel.meta.minServiceAmps : null
  const gecAwg = gecSizeAwg(ratedAmps ?? 100)
  const ampNote = ratedAmps === null ? ' (assumed 100 A service)' : ''
  const gesWire = (
    sourceId: string,
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    label: string,
  ): void => {
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const dz = to[2] - from[2]
    const len = Math.hypot(dx, dy, dz)
    if (len < 0.02) return
    const vertical = Math.abs(dy) > Math.hypot(dx, dz)
    members.push({
      system: 'electrical',
      role: 'wire-run',
      dims: vertical ? [GES_SECTION, len, GES_SECTION] : [len, GES_SECTION, GES_SECTION],
      length: len,
      position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
      rotation: [0, vertical ? 0 : Math.atan2(-dz, dx), 0],
      material: 'copper',
      sourceId,
      label,
    })
  }
  /** Straight leg that can't detour: ⚠-flag it when it crosses an RO box. */
  const gesFlagged = (
    sourceId: string,
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    label: string,
  ): void =>
    gesWire(
      sourceId,
      from,
      to,
      segmentCrossesRo(walls, from, to) ? `${label} (⚠ crosses rough opening — verify)` : label,
    )

  // Rod spots: out the meter wall's exterior normal (the vector wall
  // centerline → meter mount), standing off the foundation; the pair runs
  // along the wall axis. Degenerate scenes (no wall anchor) fall back to
  // the street direction — the rods stay at the meter either way.
  const normalized = (v: readonly [number, number]): [number, number] | null => {
    const l = Math.hypot(v[0], v[1])
    return l > 1e-6 ? [v[0] / l, v[1] / l] : null
  }
  const meterPlanAnchor = meterAnchor ? wallPlan(meterAnchor) : null
  const outN =
    (meterPlanAnchor ? normalized([mx - meterPlanAnchor[0], mz - meterPlanAnchor[1]]) : null) ??
    normalized([street[0] - mx, street[1] - mz]) ??
    ([0, -1] as [number, number])
  const rodAxis: readonly [number, number] = meterAnchor
    ? meterAnchor.wall.dir
    : [-outN[1], outN[0]]
  // The GEC drops one bay-step beside the SE riser (round 2 — a coincident
  // drop buried the conductor inside the riser volume); the rod line keys
  // off the SAME strap point so the default rod 1 already stands clear of
  // the lateral's approach line through the meter.
  const strap: readonly [number, number] = [
    mx + rodAxis[0] * GES_STRAP_OUT,
    mz + rodAxis[1] * GES_STRAP_OUT,
  ]

  // The bond's routing decision + fallback strap points are needed BEFORE
  // the rod scan (round-4 / r2 skeptic: the no-wall-path fallbacks bury
  // MORE service conductors at lateral depth — invisible to the round-3
  // scan, which hardcoded only the street lateral).
  const waterEntry = context.waterEntry ?? null
  const waterAnchor = waterEntry
    ? nearestWallPoint(walls, [waterEntry[0], waterEntry[2]], waterEntry[1] + 0.25)
    : null
  const bondRouted =
    waterEntry !== null &&
    panelAnchor !== null &&
    waterAnchor !== null &&
    wallPath(graph, panelAnchor, waterAnchor) !== null
  // Fallback strap points (bay-step along the anchor wall — the same
  // GES_STRAP_OUT the routed branch uses; deterministic +x when a wall
  // anchor is missing entirely): the fallback bond drop/rise must never
  // share a plan point with the feed fallback's byte-identical rise
  // (r2 EXHIBIT 2 — d = 0.0000 for ~1.9 m of vertical).
  //
  // r3 RESIDUAL (round 5): the single bay-step only separated the
  // ENDPOINT drops/rises — the bond fallback's buried MID-legs were
  // never scanned against the feed fallback's. A detached island wall
  // PERPENDICULAR to the approach put the bond's buried x-leg EXACTLY
  // on the feed's x-leg (pz + strap == mz, a 49 mm window; d ≈ 1.4e-17
  // over ~7.9 m), with the symmetric water-end window against the
  // street lateral. The exact leg lists are both in scope right here,
  // so each strap end now searches a DETERMINISTIC multiple ladder
  // (±1, ±2 … ±6 bay-steps) until its buried legs clear every buried
  // service element by the summed half-sections + skin — parallel
  // elements only; perpendicular crossings stay legal (cable straps
  // over cable) — and never run PARALLEL inside a wall's below-grade
  // band (a dodge must not trade embedment for a stemwall bore). An
  // undodgeable end keeps the default step and the emission CONFESSES
  // the embedment on the member labels — never silent.
  const panelStrapDir: PlanPt = panelAnchor ? panelAnchor.wall.dir : [1, 0]
  const waterStrapDir: PlanPt = waterAnchor ? waterAnchor.wall.dir : [1, 0]
  type BuriedEl = { a: PlanPt; b: PlanPt; vertical: boolean }
  const buriedServiceEls: BuriedEl[] = [
    { a: [street[0], street[1]], b: [mx, street[1]], vertical: false },
    { a: [mx, street[1]], b: [mx, mz], vertical: false },
    { a: [mx, mz], b: [mx, mz], vertical: true }, // street riser at the meter
  ]
  if (!routed) {
    buriedServiceEls.push(
      { a: [mx, mz], b: [px, mz], vertical: false },
      { a: [px, mz], b: [px, pz], vertical: false },
      { a: [px, pz], b: [px, pz], vertical: true }, // feed fallback rise
    )
  }
  const planDirEl = (e: BuriedEl): PlanPt | null => {
    const l = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1])
    return l < 1e-9 ? null : [(e.b[0] - e.a[0]) / l, (e.b[1] - e.a[1]) / l]
  }
  const elementsEmbed = (g: BuriedEl, s: BuriedEl): boolean => {
    if (g.vertical !== s.vertical) return false // a crossing, not an embedment
    if (!g.vertical) {
      const dg = planDirEl(g)
      const ds = planDirEl(s)
      if (dg && ds && Math.abs(dg[0] * ds[1] - dg[1] * ds[0]) > 0.1) return false // perpendicular
    }
    return planSegSegDist(g.a, g.b, s.a, s.b) < GES_EMBED_FLOOR
  }
  const legInWallBand = (a: PlanPt, b: PlanPt): boolean => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (l < 1e-9) return false
    const d: PlanPt = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
    return walls.some((w) => {
      if (w.curved) return false
      if (Math.abs(d[0] * w.dir[1] - d[1] * w.dir[0]) > 0.1) return false // not parallel
      return planSegSegDist(a, b, w.start, w.end) < w.thickness / 2 + GES_SECTION / 2 + 0.01
    })
  }
  /** Panel-end buried elements (drop + x-leg — the pieces the panel strap
   * scalar positions) and water-end elements (z-leg + rise) for one
   * candidate pair. Cross-dependency is EXTENT-only (the shared corner),
   * so each end's scalar can be searched on its own element set. */
  const panelEls = (ps: PlanPt, ws: PlanPt): BuriedEl[] => [
    { a: ps, b: ps, vertical: true }, // drop at the panel bay
    { a: ps, b: [ws[0], ps[1]], vertical: false },
  ]
  const waterEls = (ps: PlanPt, ws: PlanPt): BuriedEl[] => [
    { a: [ws[0], ps[1]], b: ws, vertical: false },
    { a: ws, b: ws, vertical: true }, // rise at the entry bay
  ]
  const bondElsClear = (els: BuriedEl[]): boolean =>
    els.every((g) => buriedServiceEls.every((s) => !elementsEmbed(g, s))) &&
    els.every((g) => g.vertical || !legInWallBand(g.a, g.b))
  const strapAt = (base: PlanPt, dir: PlanPt, mul: number): PlanPt => [
    base[0] + dir[0] * GES_STRAP_OUT * mul,
    base[1] + dir[1] * GES_STRAP_OUT * mul,
  ]
  /** Deterministic multiple ladder: the default single step first, then
   * the flipped side, then wider steps. */
  const STRAP_MULS = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6] as const
  let panelStrap: PlanPt = strapAt([px, pz], panelStrapDir, 1)
  let waterStrap: PlanPt | null = waterEntry
    ? strapAt([waterEntry[0], waterEntry[2]], waterStrapDir, 1)
    : null
  let bondEmbedConfessed = false
  if (waterEntry && waterStrap && !bondRouted) {
    // Two deterministic passes: the panel end searches its own elements
    // with the water end at its default, then the water end searches
    // against the chosen panel strap.
    const waterDefault = waterStrap
    const panelMul = STRAP_MULS.find((m) =>
      bondElsClear(panelEls(strapAt([px, pz], panelStrapDir, m), waterDefault)),
    )
    panelStrap = strapAt([px, pz], panelStrapDir, panelMul ?? 1)
    const waterMul = STRAP_MULS.find((m) =>
      bondElsClear(
        waterEls(panelStrap, strapAt([waterEntry[0], waterEntry[2]], waterStrapDir, m)),
      ),
    )
    waterStrap = strapAt([waterEntry[0], waterEntry[2]], waterStrapDir, waterMul ?? 1)
    bondEmbedConfessed = panelMul === undefined || waterMul === undefined
  }

  // ---- rod spots are SCENE-AWARE (round-3 skeptic F1 + F3) ----
  // The default spot — out the meter wall beside the GEC strap — must
  // clear (a) EVERY buried service conductor, (b) every wall's
  // below-grade foundation band, and (c) every room footprint (a
  // concave L-plan put rod 2 INSIDE the wing). The buried rod-to-rod GEC
  // leg is scanned against the wall bands too (it bored the wing's
  // stemwall). Obstructed = the PAIR slides along the wall axis in
  // deterministic ± steps; unplaceable = keep the default and FLAG both
  // rods — never silent.
  // The buried-conductor list (r2 EXHIBIT 1 closed): the street lateral
  // (which approaches the meter along its own normal — rod 1 used to sit
  // exactly ON that line), PLUS the no-wall-path FEED fallback's legs +
  // panel rise (a detached-island panel put the buried feed 6 mm from a
  // rod centerline while the scan looked only at the street), PLUS the
  // bond fallback's post-strap legs when IT will fire — a cable cannot
  // bore a rigid rod any more than the SE cable can. Verticals scan as
  // degenerate point-segs (rods are vertical too — parallel pairs).
  const lateralSegs: [PlanPt, PlanPt][] = [
    [[street[0], street[1]], [mx, street[1]]],
    [[mx, street[1]], [mx, mz]],
  ]
  if (!routed) {
    lateralSegs.push(
      [[mx, mz], [px, mz]],
      [[px, mz], [px, pz]],
      [[px, pz], [px, pz]], // the feed fallback rise at the panel
    )
  }
  if (waterEntry && waterStrap && !bondRouted) {
    lateralSegs.push(
      [panelStrap, panelStrap], // the bond fallback drop at the panel bay
      [panelStrap, [waterStrap[0], panelStrap[1]]],
      [[waterStrap[0], panelStrap[1]], waterStrap],
      [waterStrap, waterStrap], // the bond fallback rise at the entry bay
    )
  }
  const rooms = context.rooms ?? []
  const rodPairAt = (slide: number): [PlanPt, PlanPt] => {
    const bx = strap[0] + outN[0] * GROUND_ROD_STANDOFF + rodAxis[0] * slide
    const bz = strap[1] + outN[1] * GROUND_ROD_STANDOFF + rodAxis[1] * slide
    return [
      [bx, bz],
      [bx + rodAxis[0] * GROUND_ROD_SPACING, bz + rodAxis[1] * GROUND_ROD_SPACING],
    ]
  }
  const rodPairClear = (pair: readonly [PlanPt, PlanPt]): boolean => {
    for (const p of pair) {
      for (const [a, b] of lateralSegs) {
        if (planPointSegDist(p, a, b) < ROD_LATERAL_CLEAR) return false
      }
      for (const w of walls) {
        if (w.curved) continue
        if (planPointSegDist(p, w.start, w.end) < ROD_FOUNDATION_CLEAR) return false
      }
      for (const room of rooms) {
        if (pointInPolygon(p, room.polygon)) return false
      }
    }
    for (const w of walls) {
      if (w.curved) continue
      if (planSegSegDist(pair[0], pair[1], w.start, w.end) < ROD_FOUNDATION_CLEAR) return false
    }
    return true
  }
  let rodPair = rodPairAt(0)
  let rodFlag: string | undefined
  if (!rodPairClear(rodPair)) {
    let found = false
    for (let step = ROD_SLIDE_STEP; step <= ROD_SLIDE_MAX + 1e-9 && !found; step += ROD_SLIDE_STEP) {
      for (const slide of [step, -step]) {
        const candidate = rodPairAt(slide)
        if (rodPairClear(candidate)) {
          rodPair = candidate
          found = true
          break
        }
      }
    }
    if (!found) {
      rodFlag =
        'ground rods obstructed at the meter — verify electrode placement on site (NEC 250.53)'
    }
  }
  const [rod1, rod2] = rodPair
  // Per-storey scope (round-3 F4, the E6 honesty class): compute routes one
  // LEVEL, so every storey with a service chain mints its own GES — while
  // NEC 250.58 wants ONE electrode system per service. The labels say so;
  // multi-storey scenes get the level warning (compute).
  const storeyScope = ' — per-storey model: verify single GES per service (250.53/250.58)'
  ;[rod1, rod2].forEach(([rx, rz], i) => {
    members.push({
      system: 'electrical',
      role: 'ground-rod',
      dims: [GROUND_ROD_DIAMETER, GROUND_ROD_LENGTH, GROUND_ROD_DIAMETER],
      length: GROUND_ROD_LENGTH,
      position: [rx, GROUND_ROD_TOP_Y - GROUND_ROD_LENGTH / 2, rz],
      rotation: [0, 0, 0],
      material: 'copper',
      sourceId: `ges-rod-${i + 1}`,
      label:
        (i === 0
          ? 'Ground rod 1 — 5/8" × 8 ft copper-clad, driven, top below grade (NEC 250.52(A)(5))'
          : 'Ground rod 2 — supplemental, ≥ 6 ft from rod 1 (NEC 250.53(A)(2)/(B))') + storeyScope,
      ...(rodFlag ? { flag: rodFlag } : {}),
    })
  })

  // GEC: meter → the strap-out → down the exterior face to the grade
  // line → out to rod 1 → drop onto the rod → one CONTINUOUS run to rod 2
  // (250.53(C) — the rod-to-rod jumper is the same unbroken conductor).
  // The grade-line run sits above the stemwall top (y=0) so nothing bores
  // the foundation.
  const gecLabel = `GEC ${gecAwg} AWG Cu — grounding electrode conductor (NEC 250.66)${ampNote}${storeyScope}`
  gesFlagged('GES-1', [mx, my, mz], [strap[0], my, strap[1]], `${gecLabel} — meter strap-out`)
  gesFlagged(
    'GES-1',
    [strap[0], my, strap[1]],
    [strap[0], GES_GRADE_Y, strap[1]],
    `${gecLabel} — meter → grade`,
  )
  gesWire(
    'GES-1',
    [strap[0], GES_GRADE_Y, strap[1]],
    [rod1[0], GES_GRADE_Y, rod1[1]],
    `${gecLabel} — grade run to rod 1`,
  )
  gesWire(
    'GES-1',
    [rod1[0], GES_GRADE_Y, rod1[1]],
    [rod1[0], GROUND_ROD_TOP_Y, rod1[1]],
    `${gecLabel} — drop to rod 1`,
  )
  gesWire(
    'GES-1',
    [rod1[0], GROUND_ROD_TOP_Y, rod1[1]],
    [rod2[0], GROUND_ROD_TOP_Y, rod2[1]],
    `${gecLabel} — rod 1 → rod 2, continuous (NEC 250.53(C))`,
  )

  // Water-pipe bond (250.104(A)): panel → wall legs at the bond plane →
  // down at the water entry bay → the pipe clamp. Entry point from the
  // cross-trade context (override or the plumbing auto-spot mirror);
  // unknown = skip + LABEL the assumption on the termination below.
  // (waterEntry / waterAnchor / bondRouted hoisted above the rod scan.)
  if (waterEntry) {
    const [wx, wy, wz] = waterEntry
    const bondLabel = `Water-pipe bond ${gecAwg} AWG Cu — metal water service (NEC 250.104(A))${ampNote}`
    const bondEmit: SegmentEmitter = (a, b, note = '') =>
      gesWire('GES-2', a, b, `${bondLabel}${note}`)
    if (bondRouted && panelAnchor && waterAnchor) {
      const pb = wallPlan(panelAnchor)
      const wa = wallPlan(waterAnchor)
      // Strap-outs at BOTH bays (round-3 F2 — the panel-end drop shared
      // its exact plan point with the meter→panel feed RISE: 0.95 m of
      // 14 mm conductor fully inside the 35 mm SE cable; the same class
      // round 2 fixed at the meter). The bond drops one bay-step along
      // each anchor wall, then rejoins the wall run at the bond plane;
      // the water-end step also dodges the plumbing cold riser standing
      // on the entry's plan point.
      const pd = panelAnchor.wall.dir
      const wd = waterAnchor.wall.dir
      const pb2: PlanPt = [pb[0] + pd[0] * GES_STRAP_OUT, pb[1] + pd[1] * GES_STRAP_OUT]
      const wa2: PlanPt = [wa[0] + wd[0] * GES_STRAP_OUT, wa[1] + wd[1] * GES_STRAP_OUT]
      gesFlagged('GES-2', [px, py, pz], [pb2[0], py, pb2[1]], `${bondLabel} — panel strap-out`)
      gesWire('GES-2', [pb2[0], py, pb2[1]], [pb2[0], GES_BOND_Y, pb2[1]], bondLabel)
      gesWire(
        'GES-2',
        [pb2[0], GES_BOND_Y, pb2[1]],
        [pb[0], GES_BOND_Y, pb[1]],
        `${bondLabel} — to the wall run`,
      )
      emitWallPathWith(bondEmit, graph, panelAnchor, waterAnchor, GES_BOND_Y)
      gesWire(
        'GES-2',
        [wa[0], GES_BOND_Y, wa[1]],
        [wa2[0], GES_BOND_Y, wa2[1]],
        `${bondLabel} — to the entry bay`,
      )
      gesWire('GES-2', [wa2[0], GES_BOND_Y, wa2[1]], [wa2[0], wy, wa2[1]], bondLabel)
      gesFlagged('GES-2', [wa2[0], wy, wa2[1]], [wx, wy, wz], `${bondLabel} — pipe clamp`)
    } else {
      // Disconnected islands / degenerate scenes: buried legs (NEC 300.5
      // convention, same as the feed fallback) — never living-height air.
      // r2 skeptic EXHIBIT 2: the naive fallback drop at the panel was
      // BYTE-IDENTICAL to the feed fallback's rise — ~1.9 m of 14 mm
      // conductor coincident inside the 35 mm SE cable. Both ends now
      // take the bay-step strap-out (panelStrap/waterStrap, hoisted), so
      // the fallback drop/rise never share a plan point with the feed's;
      // the rod scan above already saw these exact legs.
      const ws = waterStrap as PlanPt
      // An undodgeable strap end (mid-leg ladder exhausted) is CONFESSED
      // on every fallback leg — E7 forbids silent embedment.
      const bnote = `${bondLabel} (⚠ buried crossing — no wall path)${
        bondEmbedConfessed
          ? ' (⚠ embeds alongside a buried service conductor — separate in the trench)'
          : ''
      }`
      gesFlagged(
        'GES-2',
        [px, py, pz],
        [panelStrap[0], py, panelStrap[1]],
        `${bnote} — panel strap-out`,
      )
      gesWire(
        'GES-2',
        [panelStrap[0], py, panelStrap[1]],
        [panelStrap[0], SERVICE_LATERAL_Y, panelStrap[1]],
        bnote,
      )
      gesWire(
        'GES-2',
        [panelStrap[0], SERVICE_LATERAL_Y, panelStrap[1]],
        [ws[0], SERVICE_LATERAL_Y, panelStrap[1]],
        bnote,
      )
      gesWire(
        'GES-2',
        [ws[0], SERVICE_LATERAL_Y, panelStrap[1]],
        [ws[0], SERVICE_LATERAL_Y, ws[1]],
        bnote,
      )
      gesWire('GES-2', [ws[0], SERVICE_LATERAL_Y, ws[1]], [ws[0], wy, ws[1]], bnote)
      gesFlagged('GES-2', [ws[0], wy, ws[1]], [wx, wy, wz], `${bnote} — pipe clamp`)
    }
  }

  // Intersystem bonding termination (250.94): the ≥3-terminal block at the
  // service equipment — mounted just below the meter socket. When no water
  // entry is visible, IT carries the assumption label (never silent).
  members.push({
    system: 'electrical',
    role: 'equipment',
    dims: [0.1, 0.08, 0.04],
    length: 0.1,
    position: [mx, Math.max(0.3, my - 0.45), mz],
    rotation: [0, meter.rotationY, 0],
    material: 'steel',
    sourceId: 'ges-ibt',
    label: `Intersystem bonding termination — ≥3 terminals at the service (NEC 250.94)${
      waterEntry
        ? ''
        : '; ⚠ water-pipe bond not modeled — no water service entry visible (NEC 250.104)'
    }`,
  })

  return members
}
