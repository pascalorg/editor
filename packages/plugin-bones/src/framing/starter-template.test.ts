import { describe, expect, test } from 'bun:test'
import { classifyRoom, extractRooms } from '../core/wall-model'
import type { Fixture, Member, RoomSlice, SlabSlice } from '../core/types'
import {
  characteristicsRows,
  computeCharacteristics,
  NO_CONDITIONED_NA,
  NO_SLAB_NA,
} from '../engines/characteristics'
import { buildPlanSet } from '../plans/plan-set'
import { buildServicePointNodes } from '../service/place'
import { computeLevel } from './compute'
import { FramingNode } from './schema'

/**
 * STARTER-TEMPLATE PINNED GATE (prod report 2026-08-22: "I don't see the
 * heat pump standing outside the house like it used to be").
 *
 * The editor's starter templates (private-editor editor/packages/mcp/src/
 * templates — garden-house is `create_house_from_brief`'s default) ship
 * walls with BOTH faces 'unknown', zones, and NO slab. That scene shape
 * defeated the exterior-wall election end-to-end:
 *
 *  1. applyExteriorFallback (core/wall-model.ts) probes SLAB coverage; with
 *     zero slabs every wall read 'uncovered on both sides' → the whole
 *     shell framed INTERIOR (the `slabs.length === 0 && !hasRooms` blanket
 *     branch is gated off by the zones);
 *  2. placeHeatPumpSpot → nearestExteriorExit → null → the condenser-always
 *     fallback anchor: pad + cabinet ⚠-flagged at the tie-break wall, NO
 *     disconnect, AIR-RUN line-set, no outdoor receptacles (B14), no
 *     sheathing/WRB/cladding — and no heat-pump service point seeded;
 *  3. the outdoor 'Back garden' zone classified 'other' → HABITABLE: a
 *     supply register floated in the yard and the garden's 72 m² inflated
 *     the tonnage (3.5 t for a 96 m² house).
 *
 * The fix: probeSlabsFor treats INDOOR zone polygons as declared floor
 * coverage when the building has no flooring anywhere (outdoor zones never
 * count), and the HVAC engine serves indoor rooms only ('outdoor' room
 * category). These gates pin the healed compose ON THE ACTUAL TEMPLATE
 * SHAPE at the computeLevel level — the 1500-compose condenser-always
 * invariant (hvac.condensers.test.ts) stays green through the whole story
 * because it feeds layoutHvac PRE-CLASSIFIED WallSlices and can never see
 * an election failure; this file covers exactly the class it misses.
 */

// ---------------------------------------------------------------------------
// Fixtures — faithful to the editor templates' node shapes (faces 'unknown',
// openings' u in position[0], zones without boundaryWallIds, no slab).
// ---------------------------------------------------------------------------

const HOUSE_W = 6 // half-width (12 m total), matches garden-house
const HOUSE_D = 4 // half-depth (8 m total)
const GARDEN_DEPTH = 6

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  children: string[] = [],
): Record<string, unknown> {
  return {
    id,
    type: 'wall',
    parentId: 'level_0',
    start,
    end,
    thickness: 0.15,
    height: 2.7,
    frontSide: 'unknown',
    backSide: 'unknown',
    children,
  }
}

function door(id: string, u: number, width = 1.0): Record<string, unknown> {
  return { id, type: 'door', position: [u, 1.05, 0], width, height: 2.1 }
}

function win(id: string, u: number, width = 1.2): Record<string, unknown> {
  return { id, type: 'window', position: [u, 1.2, 0], width, height: 1.2 }
}

function zone(
  id: string,
  name: string,
  polygon: [number, number][],
): Record<string, unknown> {
  return { id, type: 'zone', parentId: 'level_0', name, polygon }
}

/** The garden-house starter template: 12×8 shell, indoor living zone,
 * OUTDOOR back-garden zone to the north, privacy fences, no slab. */
function starterTemplateScene(): Record<string, Record<string, unknown>> {
  const fence = (id: string, start: [number, number], end: [number, number]) => ({
    id,
    type: 'fence',
    parentId: 'level_0',
    start,
    end,
    height: 1.8,
    thickness: 0.08,
  })
  return {
    site_g: { id: 'site_g', type: 'site', children: ['building_g'] },
    building_g: {
      id: 'building_g',
      type: 'building',
      parentId: 'site_g',
      children: ['level_0'],
    },
    level_0: {
      id: 'level_0',
      type: 'level',
      parentId: 'building_g',
      level: 0,
      height: 2.7,
    },
    door_front: door('door_front', 2),
    door_garden: door('door_garden', 3, 1.6),
    window_s1: win('window_s1', 8),
    window_e: win('window_e', 4, 1.0),
    window_w: win('window_w', 4, 1.0),
    wall_n: wall('wall_n', [-HOUSE_W, -HOUSE_D], [HOUSE_W, -HOUSE_D], ['door_garden']),
    wall_e: wall('wall_e', [HOUSE_W, -HOUSE_D], [HOUSE_W, HOUSE_D], ['window_e']),
    wall_s: wall('wall_s', [HOUSE_W, HOUSE_D], [-HOUSE_W, HOUSE_D], ['door_front', 'window_s1']),
    wall_w: wall('wall_w', [-HOUSE_W, HOUSE_D], [-HOUSE_W, -HOUSE_D], ['window_w']),
    zone_living: zone('zone_living', 'Living', [
      [-HOUSE_W, -HOUSE_D],
      [HOUSE_W, -HOUSE_D],
      [HOUSE_W, HOUSE_D],
      [-HOUSE_W, HOUSE_D],
    ]),
    zone_garden: zone('zone_garden', 'Back garden', [
      [-HOUSE_W, -HOUSE_D - GARDEN_DEPTH],
      [HOUSE_W, -HOUSE_D - GARDEN_DEPTH],
      [HOUSE_W, -HOUSE_D],
      [-HOUSE_W, -HOUSE_D],
    ]),
    fence_n: fence('fence_n', [-HOUSE_W, -HOUSE_D - GARDEN_DEPTH], [HOUSE_W, -HOUSE_D - GARDEN_DEPTH]),
    fence_e: fence('fence_e', [HOUSE_W, -HOUSE_D - GARDEN_DEPTH], [HOUSE_W, -HOUSE_D]),
    fence_w: fence('fence_w', [-HOUSE_W, -HOUSE_D], [-HOUSE_W, -HOUSE_D - GARDEN_DEPTH]),
  }
}

/** The all-indoor no-slab class (two-bedroom / empty-studio shape): 10×8
 * shell + partition, two indoor zones, faces 'unknown', no slab. */
function indoorNoSlabScene(): Record<string, Record<string, unknown>> {
  return {
    level_0: { id: 'level_0', type: 'level', level: 0, height: 2.7 },
    door_front: door('door_front', 2),
    wall_n: wall('wall_n', [-5, -4], [5, -4]),
    wall_e: wall('wall_e', [5, -4], [5, 4]),
    wall_s: wall('wall_s', [5, 4], [-5, 4], ['door_front']),
    wall_w: wall('wall_w', [-5, 4], [-5, -4]),
    wall_part: wall('wall_part', [0, -4], [0, 4]),
    zone_living: zone('zone_living', 'Living / Kitchen', [
      [-5, -4],
      [0, -4],
      [0, 4],
      [-5, 4],
    ]),
    zone_bed: zone('zone_bed', 'Bedroom 1', [
      [0, -4],
      [5, -4],
      [5, 4],
      [0, 4],
    ]),
  }
}

function config(): FramingNode {
  return FramingNode.parse({
    id: 'bonesframing_starter',
    parentId: 'level_0',
    jurisdiction: 'INTL',
    detail: '400',
    studSpacingIn: 16,
    showWalls: true,
    showFloor: true,
    showRoof: true,
    showFoundation: true,
    showElectrical: true,
    showPlumbing: true,
    showHvac: true,
  })
}

// ---------------------------------------------------------------------------
// Shared helpers (chainConnects mirrors hvac.lineset.test.ts — E2 union-find)
// ---------------------------------------------------------------------------

const condensersOf = (fixtures: Fixture[]): Fixture[] =>
  fixtures.filter((f) => f.kind === 'equipment' && f.meta?.equipment === 'condenser')

const padsOf = (members: Member[]): Member[] =>
  members.filter((m) => m.label?.startsWith('Condenser pad'))

const cabinetsOf = (members: Member[]): Member[] =>
  members.filter((m) => m.label?.includes('outdoor unit'))

type Endpoint = { x: number; y: number; z: number }

function endpointsOf(m: Member): [Endpoint, Endpoint] {
  if (m.rotation[1] === 0 && m.dims[1] === m.length) {
    return [
      { x: m.position[0], y: m.position[1] - m.length / 2, z: m.position[2] },
      { x: m.position[0], y: m.position[1] + m.length / 2, z: m.position[2] },
    ]
  }
  const yaw = m.rotation[1]
  const hx = (m.dims[0] / 2) * Math.cos(yaw)
  const hz = -(m.dims[0] / 2) * Math.sin(yaw)
  return [
    { x: m.position[0] - hx, y: m.position[1], z: m.position[2] - hz },
    { x: m.position[0] + hx, y: m.position[1], z: m.position[2] + hz },
  ]
}

const TOL = 0.06

function chainConnects(
  members: Member[],
  from: readonly [number, number],
  to: readonly [number, number],
): boolean {
  const pts: Endpoint[] = []
  const owner: number[] = []
  members.forEach((m, i) => {
    for (const e of endpointsOf(m)) {
      pts.push(e)
      owner.push(i)
    }
  })
  const parent = pts.map((_, i) => i)
  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r] as number
    let c = i
    while (parent[c] !== c) {
      const nxt = parent[c] as number
      parent[c] = r
      c = nxt
    }
    return r
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i] as Endpoint
      const b = pts[j] as Endpoint
      if (owner[i] === owner[j]) {
        union(i, j)
        continue
      }
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < TOL) union(i, j)
    }
  }
  const at = (p: readonly [number, number]): number => {
    let best = -1
    let bestD = Number.POSITIVE_INFINITY
    for (let i = 0; i < pts.length; i++) {
      const e = pts[i] as Endpoint
      const d = Math.hypot(e.x - p[0], e.z - p[1])
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return bestD < TOL ? best : -1
  }
  const i0 = at(from)
  const i1 = at(to)
  return i0 >= 0 && i1 >= 0 && find(i0) === find(i1)
}

/** Plan distance from p to the segment a→b. */
function segDist(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const abx = b[0] - a[0]
  const abz = b[1] - a[1]
  const len2 = abx * abx + abz * abz
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / len2)) : 0
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + abz * t))
}

const inRect = (p: readonly [number, number], x0: number, x1: number, z0: number, z1: number) =>
  p[0] > x0 && p[0] < x1 && p[1] > z0 && p[1] < z1

/** The 9.5px body-text lines of a schedules SVG (characteristics block +
 * takeoff rows) — raw content, entities included, for width pins. */
const textLines95 = (svg: string): string[] =>
  [...svg.matchAll(/<text[^>]*font-size="9\.5"[^>]*>([^<]*)<\/text>/g)].map(
    (m) => m[1] as string,
  )

// ---------------------------------------------------------------------------
// 0. Room classification — outdoor names
// ---------------------------------------------------------------------------

describe('classifyRoom — outdoor zones', () => {
  test('garden/patio/yard names classify outdoor; indoor names untouched', () => {
    for (const name of [
      'Back garden',
      'Garden',
      'Front yard',
      'Patio',
      'Terrace',
      'Terrasse',
      'Roof deck',
      'Porch',
      'Balcony',
      'Lanai',
      'Jardin',
      'Roof terrace',
      'Outdoor kitchen', // LEADING outdoor qualifier beats the kitchen word
    ]) {
      expect(classifyRoom(name)).toBe('outdoor')
    }
    expect(classifyRoom('Kitchen')).toBe('kitchen')
    expect(classifyRoom('Living / Kitchen')).toBe('kitchen')
    expect(classifyRoom('Bathroom')).toBe('bathroom')
    expect(classifyRoom('Bedroom 1')).toBe('bedroom')
    expect(classifyRoom('Hall')).toBe('hallway')
    expect(classifyRoom('Living')).toBe('other')
  })

  test('material adjectives never read as terraces (skeptic round-1 harm class)', () => {
    // /terra(c|ss|z)/ ate 'Terrazzo'/'Terracotta' — a Terrazzo bathroom
    // silently lost its plumbing stubs, exhaust fan and wet-GFCI
    expect(classifyRoom('Terrazzo bathroom')).toBe('bathroom')
    expect(classifyRoom('Terracotta kitchen')).toBe('kitchen')
    // …and WITHOUT an indoor word the anchoring itself is the only guard
    // (the compound-precedence rule can't help a 'Terrazzo entry')
    expect(classifyRoom('Terrazzo entry')).toBe('other')
    expect(classifyRoom('Terracotta foyer')).toBe('other')
  })

  test('compound names: the HEAD NOUN wins unless the outdoor word LEADS', () => {
    // 'Garden bedroom' is a bedroom — it keeps its R314 smoke alarm
    expect(classifyRoom('Garden bedroom')).toBe('bedroom')
    expect(classifyRoom('Patio kitchen')).toBe('kitchen')
    expect(classifyRoom('Garden bath')).toBe('bathroom')
    expect(classifyRoom('Terrace bedroom')).toBe('bedroom')
    // leading qualifier flips outdoors
    expect(classifyRoom('Outdoor kitchen')).toBe('outdoor')
    expect(classifyRoom('Exterior hall')).toBe('outdoor')
    // outdoor word with NO indoor category word stays outdoor — the
    // documented conservatory class: unconditioned glass space until the
    // user renames or re-zones it
    expect(classifyRoom('Winter garden')).toBe('outdoor')
    expect(classifyRoom('Garden room')).toBe('outdoor')
  })

  test('head-noun tie-break (day-9 misfire list): a trailing outdoor word IS the room', () => {
    // both directions of the compound class: the LAST matching word is the
    // thing the room is — a 'Master terrace' is a terrace (open air; the
    // R314 warning speaks for the dropped alarm, gated below), a
    // 'Garden bedroom' a bedroom (pinned above)
    expect(classifyRoom('Master terrace')).toBe('outdoor')
    expect(classifyRoom('Bedroom terrace')).toBe('outdoor')
    expect(classifyRoom('Bedroom balcony')).toBe('outdoor')
    expect(classifyRoom('Kitchen garden')).toBe('outdoor') // the vegetable plot
    // the indoor CATEGORY keeps ROOM_PATTERNS order, not name order
    expect(classifyRoom('Master bath')).toBe('bathroom')
  })

  test('Italian terrazza is an anchored terrace form; Terrazzo still is not', () => {
    expect(classifyRoom('Terrazza')).toBe('outdoor')
    expect(classifyRoom('Terrazza coperta')).toBe('outdoor')
    expect(classifyRoom('Terrazzo entry')).toBe('other') // material adjective
  })

  test('garden/yard are word-anchored — substrings never classify (day-9 traps)', () => {
    expect(classifyRoom('Kindergarden')).toBe('other') // a child's room, not a garden
    expect(classifyRoom('Vineyard cellar')).toBe('other') // a cellar, not a yard
    expect(classifyRoom('Gardenia room')).toBe('other')
    // …while the legitimate one-word compounds + plurals keep matching
    expect(classifyRoom('Courtyard')).toBe('outdoor')
    expect(classifyRoom('Backyard')).toBe('outdoor')
    expect(classifyRoom('Gardens')).toBe('outdoor')
  })

  test('a Garden bedroom KEEPS its smoke alarms in the compose (R314 pin)', () => {
    const nodes = indoorNoSlabScene()
    ;(nodes.zone_bed as Record<string, unknown>).name = 'Garden bedroom'
    const result = computeLevel(nodes, config())
    const alarms = result.fixtures.filter((f) => f.kind === 'smoke-alarm')
    // in-bedroom + outside-sleeping-area proxy — identical to 'Bedroom 1'
    expect(alarms.length).toBe(2)
    expect(alarms.some((a) => a.label?.includes('Garden bedroom'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 1. The starter template composes a REAL outdoor unit (the pinned gate)
// ---------------------------------------------------------------------------

describe('starter template (garden-house shape) — the heat pump stands outside', () => {
  const result = computeLevel(starterTemplateScene(), config())

  test('election: the whole shell frames EXTERIOR from indoor-zone coverage', () => {
    const byId = new Map(result.walls.map((w) => [w.id, w]))
    for (const id of ['wall_n', 'wall_e', 'wall_s', 'wall_w']) {
      expect(byId.get(id)?.exterior).toBe(true)
    }
    // the failure mode's tell-tale warnings are gone
    expect(result.warnings.some((w) => w.includes('no exterior wall'))).toBe(false)
    expect(result.warnings.some((w) => w.includes('AC disconnect + whip not mounted'))).toBe(
      false,
    )
  })

  test('exactly one condenser, UNFLAGGED, on a pad with its cabinet', () => {
    const units = condensersOf(result.fixtures)
    expect(units.length).toBe(1)
    const pads = padsOf(result.members)
    const cabinets = cabinetsOf(result.members)
    expect(pads.length).toBe(1)
    expect(cabinets.length).toBe(1)
    for (const m of [...pads, ...cabinets]) {
      expect(m.flag ?? '').not.toContain('verify condenser placement')
    }
  })

  test('the unit stands OUTSIDE the footprint, clear of every wall, near the house', () => {
    const unit = condensersOf(result.fixtures)[0] as Fixture
    const plan: [number, number] = [unit.position[0], unit.position[2]]
    // outside the wall-centerline rectangle…
    expect(inRect(plan, -HOUSE_W, HOUSE_W, -HOUSE_D, HOUSE_D)).toBe(false)
    // …but standing BY the house (a few meters at most), not lost on the site
    expect(inRect(plan, -HOUSE_W - 3, HOUSE_W + 3, -HOUSE_D - 3, HOUSE_D + 3)).toBe(true)
    // clear of every wall centerline per the stand-off convention
    // (condenserStandoff: t/2 + 24" face clearance + cabinet depth/2
    // ≈ 1.16 on 0.15 m walls — gate at 1.0)
    for (const w of result.walls) {
      expect(segDist(plan, w.start, w.end)).toBeGreaterThan(1.0)
    }
  })

  test('NEC 440.14: disconnect within sight (≤ 1.5 m plan) + whip present', () => {
    // Plan reach = the grid-snapped stand-off (condenserStandoff 1.1596 on
    // the 0.15 m template walls, ceil-snapped outward to 1.5 — HP polish)
    // minus the box's wall-face offset ≈ 1.4 m ("within sight" is a
    // visibility rule, ≤ 50 ft — the pin guards proximity sanity).
    const unit = condensersOf(result.fixtures)[0] as Fixture
    const disconnects = result.fixtures.filter((f) => f.kind === 'disconnect')
    expect(disconnects.length).toBe(1)
    const d = disconnects[0] as Fixture
    expect(
      Math.hypot(d.position[0] - unit.position[0], d.position[2] - unit.position[2]),
    ).toBeLessThanOrEqual(1.5)
    expect(result.members.some((m) => m.sourceId.startsWith('ac-whip-'))).toBe(true)
  })

  test('E2 line-set continuity: both pipes chain condenser → air handler, no AIR RUN', () => {
    const unit = condensersOf(result.fixtures)[0] as Fixture
    const handler = result.fixtures.find((f) => f.label?.includes('Air handler')) as Fixture
    expect(handler).toBeDefined()
    for (const pipe of ['lineset-suction-1', 'lineset-liquid-1']) {
      const legs = result.members.filter((m) => m.sourceId === pipe)
      expect(legs.length).toBeGreaterThan(0)
      expect(legs.every((m) => !m.flag?.includes('AIR RUN'))).toBe(true)
      expect(
        chainConnects(
          legs,
          [unit.position[0], unit.position[2]],
          [handler.position[0], handler.position[2]],
        ),
      ).toBe(true)
    }
  })

  test('the garden is OPEN AIR: no HVAC service lands in the outdoor zone', () => {
    // garden rect: z ∈ [-10, -4], x ∈ [-6, 6]
    const inGarden = (f: Fixture) =>
      inRect([f.position[0], f.position[2]], -HOUSE_W, HOUSE_W, -HOUSE_D - GARDEN_DEPTH, -HOUSE_D)
    for (const f of result.fixtures.filter((f) => f.system === 'hvac')) {
      // the outdoor UNIT + its disconnect legitimately stand outside;
      // conditioned-air fixtures must not
      if (f.kind === 'equipment' || f.kind === 'disconnect') continue
      expect(inGarden(f)).toBe(false)
    }
    // no HVAC fixture may SOURCE from the outdoor zone (the garden register
    // class). Electrical still hangs a general ceiling light off the garden
    // zone — same family, different engine, queued as residual (out of this
    // fix's scope); the gate here pins the HVAC contract.
    expect(
      result.fixtures.some((f) => f.system === 'hvac' && f.sourceId === 'zone_garden'),
    ).toBe(false)
    // no supply duct reaches into the garden (register drops died with the
    // habitable-garden bug — a boot at z < -4 would be open-air tin)
    for (const m of result.members.filter((m) => m.system === 'hvac' && m.role === 'duct-run')) {
      expect(m.position[2]).toBeGreaterThan(-HOUSE_D)
    }
  })

  test('tonnage sizes from INDOOR area only (96 m², not 168 m² with the garden)', () => {
    const handler = result.fixtures.find((f) => f.label?.includes('Air handler')) as Fixture
    expect(handler.meta?.conditionedSqft).toBe(Math.round(96 * 10.7639))
    const unit = condensersOf(result.fixtures)[0] as Fixture
    expect(unit.meta?.totalTons).toBe(2)
  })

  test('A4 seeding parity: the heat-pump service point seeds outside the footprint', () => {
    const seeded = buildServicePointNodes(starterTemplateScene(), 'level_0')
    const hp = seeded.find((n) => n.serviceType === 'heat-pump')
    expect(hp).toBeDefined()
    const p = hp?.position as [number, number, number]
    expect(inRect([p[0], p[2]], -HOUSE_W, HOUSE_W, -HOUSE_D, HOUSE_D)).toBe(false)
  })

  test('BUILDING CHARACTERISTICS prints the CONDITIONED figure (examiner round-1)', () => {
    // The schedules sheet printed 'Floor area 168.0 m²' (house + garden) on
    // the same page where the condenser reads 2 tons from 96 m² conditioned.
    const c = result.characteristics
    expect(c).not.toBeNull()
    expect(c?.floorAreaM2).toBeCloseTo(96, 9)
    expect(c?.volumeM3).toBeCloseTo(96 * 2.7, 9)
    // the basis is STATED, never silent
    expect(
      c?.notes.some((n) => n.includes('CONDITIONED space') && n.includes('72.0 m²')),
    ).toBe(true)
    // and the figure the sheet prints is the conditioned one
    // the block bottom-anchors on the LAST schedules page — scan them all
    const svg = buildPlanSet(result.members, result.fixtures, {
      characteristics: c ?? undefined,
    })
      .filter((s) => s.title.startsWith('Schedules'))
      .map((s) => s.svg)
      .join('\n')
    expect(svg).toContain('BUILDING CHARACTERISTICS')
    expect(svg).toContain('Floor area 96.0 m²')
    expect(svg).not.toContain('168.0 m²')
  })

  test('cross-feature seam guard: B14 outdoor receptacles + meter compose here too', () => {
    // the same election starves outdoor receptacles and the meter-anchored
    // machinery — pin them so a future election change can't silently
    // re-open the whole class
    expect(result.fixtures.filter((f) => f.kind === 'receptacle-wr-gfci').length).toBe(2)
    expect(result.fixtures.some((f) => f.kind === 'electric-meter')).toBe(true)
    expect(
      result.warnings.some((w) => w.includes('outdoor receptacles')),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. The all-indoor no-slab class (two-bedroom / empty-studio shape)
// ---------------------------------------------------------------------------

describe('all-indoor zones without a slab (two-bedroom / studio templates)', () => {
  const result = computeLevel(indoorNoSlabScene(), config())

  test('perimeter frames exterior, the partition stays interior', () => {
    const byId = new Map(result.walls.map((w) => [w.id, w]))
    for (const id of ['wall_n', 'wall_e', 'wall_s', 'wall_w']) {
      expect(byId.get(id)?.exterior).toBe(true)
    }
    expect(byId.get('wall_part')?.exterior).toBe(false)
  })

  test('one unflagged condenser outside the footprint, disconnect mounted', () => {
    const units = condensersOf(result.fixtures)
    expect(units.length).toBe(1)
    const unit = units[0] as Fixture
    expect(inRect([unit.position[0], unit.position[2]], -5, 5, -4, 4)).toBe(false)
    for (const m of [...padsOf(result.members), ...cabinetsOf(result.members)]) {
      expect(m.flag ?? '').not.toContain('verify condenser placement')
    }
    expect(result.fixtures.filter((f) => f.kind === 'disconnect').length).toBe(1)
    expect(result.warnings.some((w) => w.includes('no exterior wall'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. Outdoor-only level — honesty guard (no AH ⇒ no unit, nothing invented)
// ---------------------------------------------------------------------------

describe('outdoor-only level (a garden with fences, no house)', () => {
  test('no air handler is invented, so no condenser either — and no crash', () => {
    const nodes: Record<string, Record<string, unknown>> = {
      level_0: { id: 'level_0', type: 'level', level: 0, height: 2.7 },
      zone_garden: zone('zone_garden', 'Garden', [
        [-6, -6],
        [6, -6],
        [6, 6],
        [-6, 6],
      ]),
    }
    const result = computeLevel(nodes, config())
    expect(result.fixtures.some((f) => f.label?.includes('Air handler'))).toBe(false)
    expect(condensersOf(result.fixtures).length).toBe(0)
  })

  test('outdoor-only rooms + a slab: the patio slab is NOT conditioned floor (skeptic r2 blocker)', () => {
    // computeCharacteristics([], [144 m² outdoor garden], [24 m² patio slab])
    // used to book the OUTDOOR slab as conditioned (floorAreaM2 = 24) while
    // printing BOTH a false 'no rooms/zones drawn' note (a zone IS drawn)
    // AND a false '…excluded' note (the printed figure WAS outdoor slab).
    const garden: RoomSlice = {
      id: 'z_garden',
      name: 'Garden',
      category: 'outdoor',
      polygon: [
        [-6, -6],
        [6, -6],
        [6, 6],
        [-6, 6],
      ],
      boundaryWallIds: [],
      ceilingHeight: 2.7,
    }
    const patio: SlabSlice = {
      id: 'slab_patio',
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
      holes: [],
      elevation: 0,
      thickness: 0.1,
    }
    const c = computeCharacteristics([], [garden], [patio])
    expect(c).not.toBeNull()
    expect(c?.floorAreaM2).toBe(0)
    expect(c?.volumeM3).toBe(0)
    // ONE truthful note; neither of the two lies
    expect(c?.notes.some((n) => n.includes('No conditioned space on this level'))).toBe(true)
    expect(c?.notes.some((n) => n.includes('no rooms/zones drawn'))).toBe(false)
    expect(c?.notes.some((n) => n.includes('outdoor zones (garden/patio/yard) excluded'))).toBe(
      false,
    )
    // the no-slab outdoor-only path stays on the same truthful note
    const noSlab = computeCharacteristics([], [garden], [])
    expect(noSlab?.floorAreaM2).toBe(0)
    expect(noSlab?.notes.some((n) => n.includes('No conditioned space on this level'))).toBe(
      true,
    )
    // and a room-less slab keeps the legacy fallback verbatim
    const slabOnly = computeCharacteristics([], [], [patio])
    expect(slabOnly?.floorAreaM2).toBeCloseTo(24, 9)
    expect(slabOnly?.notes.some((n) => n.includes('no rooms/zones drawn'))).toBe(true)
  })

  test('the terrace-with-slab n/a states the TRUE reason on paper (round-4 F1)', () => {
    // The zero figure used to route through the no-slab n/a — the schedules
    // sheet printed 'Floor area & volume n/a — no floor slabs (see flags)'
    // while the flag block ON THE SAME PAGE said the level IS slab-on-grade.
    const terrace: RoomSlice = {
      id: 'z_terrace',
      name: 'Roof terrace',
      category: 'outdoor',
      polygon: [
        [-6, -6],
        [6, -6],
        [6, 6],
        [-6, 6],
      ],
      boundaryWallIds: [],
      ceilingHeight: 2.7,
    }
    const slab: SlabSlice = {
      id: 'slab_terrace',
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
      holes: [],
      elevation: 0,
      thickness: 0.1,
    }
    const c = computeCharacteristics([], [terrace], [slab])
    expect(c?.allZonesOutdoor).toBe(true)
    // rows (panel + CSV mint point): the honest reason, never the stale one
    const rows = characteristicsRows(c as NonNullable<typeof c>)
    const rowValue = (metric: string) => rows.find((r) => r.metric === metric)?.value ?? ''
    for (const metric of ['Floor area', 'Volume', 'Cooling estimate (rule of thumb)']) {
      expect(rowValue(metric)).toBe(NO_CONDITIONED_NA)
      expect(rowValue(metric)).not.toContain('no floor slabs')
    }
    // paper (plan-set mint point): the honest n/a coexists with the slab
    // flag, and the contradiction string is gone from the whole sheet
    const svg = buildPlanSet(
      [
        {
          system: 'foundation',
          role: 'slab',
          dims: [6, 0.1, 4],
          length: 6,
          position: [3, -0.05, 2],
          rotation: [0, 0, 0],
          material: 'concrete',
          sourceId: 'slab_terrace',
          label: 'Slab on grade 4"',
        } as Member,
      ],
      [],
      {
        characteristics: c ?? undefined,
        warnings: ['Ground floor is slab-on-grade — footings sized per R403'],
      },
    )
      .filter((s) => s.title.startsWith('Schedules'))
      .map((s) => s.svg)
      .join('\n')
    expect(svg).toContain('BUILDING CHARACTERISTICS')
    expect(svg).toContain('no conditioned space on this level (all zones outdoor)')
    expect(svg).not.toContain('no floor slabs')
    expect(svg).toContain('slab-on-grade') // the flag still prints — no contradiction
    // …and the long n/a WRAPS at the column width instead of striking
    // through the page border (round-5: the 57-char reason made the
    // Cooling line 123 chars, printed UNWRAPPED and clipped at the sheet
    // edge — metric lines now route through wrapRow(…, 100) like the
    // citation line). Raw-SVG lengths include entity expansion (&amp; on
    // 'Floor area & volume'), hence the ~106 ceiling; the block grew: the
    // wrapped Cooling tail is its own line.
    const lines = textLines95(svg)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(106)
    }
    expect(lines.some((l) => l.trimEnd().endsWith('level (all zones outdoor)'))).toBe(true)
  })

  test('sibling pin: a plain no-slab scene keeps the original no-slab n/a', () => {
    // floorAreaM2 0 WITHOUT allZonesOutdoor (walls only, no zones at all)
    // routes through the legacy string verbatim — rows AND sheet.
    const c = computeCharacteristics(
      [
        {
          id: 'w1',
          start: [0, 0],
          end: [6, 0],
          length: 6,
          dir: [1, 0],
          thickness: 0.15,
          height: 2.7,
          exterior: true,
          openings: [],
          curved: false,
        },
      ],
      [],
      [],
    )
    expect(c?.floorAreaM2).toBe(0)
    expect(c?.allZonesOutdoor).toBeUndefined()
    const rows = characteristicsRows(c as NonNullable<typeof c>)
    expect(rows.find((r) => r.metric === 'Floor area')?.value).toBe(NO_SLAB_NA)
    const svg = buildPlanSet(
      [
        {
          system: 'wall-framing',
          role: 'stud',
          dims: [0.04, 2.6, 0.09],
          length: 2.6,
          position: [1, 1.3, 0],
          rotation: [0, 0, 0],
          material: 'lumber',
          sourceId: 'w1',
          label: 'Stud 2x4',
        } as Member,
      ],
      [],
      { characteristics: c ?? undefined },
    )
      .filter((s) => s.title.startsWith('Schedules'))
      .map((s) => s.svg)
      .join('\n')
    expect(svg).toContain('no floor slabs (see flags)')
    expect(svg).not.toContain('no conditioned space')
    // the legacy lines fit the column — wrapRow(…, 100) is a no-op for
    // them by construction (it only splits past the width), pinned anyway:
    // the whole 'Floor area & volume …' metric line stays ONE line.
    expect(
      textLines95(svg).some((l) =>
        l.includes('no floor slabs (see flags) · Envelope'),
      ),
    ).toBe(true)
    for (const line of textLines95(svg)) {
      expect(line.length).toBeLessThanOrEqual(106)
    }
  })
})

// ---------------------------------------------------------------------------
// 4. R314 never drops silently — the leading-qualifier reclassification warns
// ---------------------------------------------------------------------------

describe('R314 open-air warning (round-2 advisory — E6 spirit)', () => {
  test('an "Outdoor bedroom" zone warns that no smoke alarm is placed', () => {
    const nodes = indoorNoSlabScene()
    ;(nodes.zone_bed as Record<string, unknown>).name = 'Outdoor bedroom'
    const result = computeLevel(nodes, config())
    expect(
      result.warnings.some(
        (w) =>
          w.includes('Outdoor bedroom') &&
          w.includes('reads as open-air') &&
          w.includes('R314'),
      ),
    ).toBe(true)
    // the warning tells the truth: no alarm was placed for it
    expect(
      result.fixtures.some(
        (f) => f.kind === 'smoke-alarm' && f.label?.includes('Outdoor bedroom'),
      ),
    ).toBe(false)
  })

  test('a plain "Outdoor kitchen" stays silent — no sleeping word, no warning', () => {
    const nodes = indoorNoSlabScene()
    ;(nodes.zone_bed as Record<string, unknown>).name = 'Outdoor kitchen'
    const result = computeLevel(nodes, config())
    expect(result.warnings.some((w) => w.includes('reads as open-air'))).toBe(false)
  })

  test('a "Master terrace" (head-noun outdoor) SPEAKS: warning fires, alarm honestly gone', () => {
    // the day-9 head-noun tie-break opens a SECOND path to category
    // 'outdoor' with a sleeping word in the name — the warning keys on the
    // RESULT (category + SLEEPING_NAME_RE), so it must fire here too
    const nodes = indoorNoSlabScene()
    ;(nodes.zone_bed as Record<string, unknown>).name = 'Master terrace'
    const result = computeLevel(nodes, config())
    expect(
      result.warnings.some(
        (w) =>
          w.includes('Master terrace') && w.includes('reads as open-air') && w.includes('R314'),
      ),
    ).toBe(true)
    // the warning tells the truth: no alarm was placed for it
    expect(
      result.fixtures.some(
        (f) => f.kind === 'smoke-alarm' && f.label?.includes('Master terrace'),
      ),
    ).toBe(false)
  })

  test('a "Garden bedroom" (head noun indoor) keeps its alarm and stays warning-free', () => {
    const nodes = indoorNoSlabScene()
    ;(nodes.zone_bed as Record<string, unknown>).name = 'Garden bedroom'
    const result = computeLevel(nodes, config())
    expect(result.warnings.some((w) => w.includes('reads as open-air'))).toBe(false)
    expect(
      result.fixtures.some(
        (f) => f.kind === 'smoke-alarm' && f.label?.includes('Garden bedroom'),
      ),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4b. Room-coverage warning is INDOOR-only — a garden needs no slab (M4)
// ---------------------------------------------------------------------------

describe('room-coverage slab warning — outdoor zones excluded (day-9 advisory)', () => {
  /** Garden house WITH a slab under the living zone only: the coverage
   * walk runs (slabs.length > 0) and finds the garden uncovered. */
  function slabbedGardenScene(): Record<string, Record<string, unknown>> {
    const nodes = starterTemplateScene()
    nodes.slab_living = {
      id: 'slab_living',
      type: 'slab',
      parentId: 'level_0',
      polygon: [
        [-HOUSE_W, -HOUSE_D],
        [HOUSE_W, -HOUSE_D],
        [HOUSE_W, HOUSE_D],
        [-HOUSE_W, HOUSE_D],
      ],
      elevation: 0,
      thickness: 0.1,
    }
    return nodes
  }

  test('an OUTDOOR zone without a slab stays warning-free — bare ground is not a defect', () => {
    const result = computeLevel(slabbedGardenScene(), config())
    expect(
      result.warnings.some((w) => w.includes('Back garden') && w.includes('no floor slab')),
    ).toBe(false)
  })

  test('the SAME uncovered polygon under an indoor name still warns — the exclusion is category-scoped', () => {
    const nodes = slabbedGardenScene()
    ;(nodes.zone_garden as Record<string, unknown>).name = 'Storage annex'
    const result = computeLevel(nodes, config())
    expect(
      result.warnings.some((w) => w.includes('Storage annex') && w.includes('no floor slab')),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. Zone-twin dedupe — the false countertop-warning exhibit (S8 class)
// ---------------------------------------------------------------------------

describe('zone-twin dedupe — honesty warnings must not contradict the sheets', () => {
  /** The demo's 'Living / Kitchen' twin: two zone nodes over ONE drawn
   * space, polygons 5 mm apart (host zone re-detection drift). The placed
   * kitchen sink sits 2 mm inside the LARGER twin's south edge — so before
   * the dedupe the sink-less twin fired 'countertop receptacles … not
   * modeled' while the OTHER twin's counter run was drawn on the same
   * sheet (B13's false-traveler root, same duplicate-zone class). */
  function kitchenTwinScene(): Record<string, Record<string, unknown>> {
    return {
      level_0: { id: 'level_0', type: 'level', level: 0, height: 2.7 },
      wall_n: wall('wall_n', [-5, -4], [5, -4]),
      wall_e: wall('wall_e', [5, -4], [5, 4]),
      wall_s: wall('wall_s', [5, 4], [-5, 4]),
      wall_w: wall('wall_w', [-5, 4], [-5, -4]),
      zone_a: zone('zone_a', 'Living / Kitchen', [
        [-5, -4],
        [5, -4],
        [5, 4],
        [-5, 4],
      ]),
      zone_b: zone('zone_b', 'Kitchen', [
        [-5, -4],
        [5, -4],
        [5, 3.995],
        [-5, 3.995],
      ]),
      sink_1: {
        id: 'sink_1',
        type: 'item',
        parentId: 'level_0',
        asset: { id: 'kitchen' },
        position: [1, 0, 3.998],
        rotation: [0, 0, 0],
      },
    }
  }

  test('twins merge: ONE kitchen, counter run drawn, NO contradicting warning, merge stated', () => {
    const nodes = kitchenTwinScene()
    // extraction: one room, the better-named twin kept
    const rooms = extractRooms(nodes, 'level_0')
    expect(rooms).toHaveLength(1)
    expect(rooms[0]?.name).toBe('Living / Kitchen')
    const result = computeLevel(nodes, config())
    // the counter walk ran — boxes at counter height exist
    expect(result.fixtures.filter((f) => f.meta?.counter === true).length).toBeGreaterThan(0)
    // …and NO honesty warning claims the counter is not modeled (pre-fix
    // the sink-less twin printed exactly this beside the drawn run)
    expect(result.warnings.some((w) => w.includes('not modeled'))).toBe(false)
    // the merge itself speaks (P4: it prints in the flag block)
    expect(
      result.warnings.some(
        (w) => w.includes('duplicate zone') && w.includes('Kitchen') && w.includes('merged'),
      ),
    ).toBe(true)
  })

  test('two REAL kitchens (distinct polygons) still warn independently — dedupe never eats them', () => {
    const nodes = kitchenTwinScene()
    // move zone_b to its own space (sink-less): the warning is TRUE there
    ;(nodes.zone_b as Record<string, unknown>).polygon = [
      [-5, -4],
      [0, -4],
      [0, 0],
      [-5, 0],
    ]
    const result = computeLevel(nodes, config())
    expect(
      result.warnings.some((w) => w.includes('Kitchen') && w.includes('not modeled')),
    ).toBe(true)
    expect(result.warnings.some((w) => w.includes('duplicate zone'))).toBe(false)
  })
})
