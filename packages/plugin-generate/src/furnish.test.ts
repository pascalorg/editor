import { describe, expect, test } from 'bun:test'
import type { PlanEdge, RoomKind } from './document'
import {
  type CatalogAsset,
  DOOR_SWING,
  edgeYaw,
  extents,
  type FurnishEdge,
  type FurnishOpening,
  type FurnishRoom,
  furnishRooms,
  type Pt,
  yawToward,
} from './furnish'
import { FIXTURE_CATALOG } from './furnish.fixture'

const IN = 0.0254
const M_TO_IN = 1 / IN
const HALF_INT = 2.25 // a 2x4 partition's half thickness, inches
const HALF_EXT = 3.25 // a 2x6 exterior wall's

type Openings = Partial<Record<PlanEdge, FurnishOpening[]>>

/** A room rectangle (inches) with exterior edges named and openings by edge. */
function room(
  name: string,
  kind: RoomKind,
  rect: [number, number, number, number],
  exterior: PlanEdge[] = [],
  openings: Openings = {},
  open: PlanEdge[] = [],
): FurnishRoom {
  const edge = (e: PlanEdge): FurnishEdge => ({
    exterior: exterior.includes(e),
    halfIn: open.includes(e) ? 0 : exterior.includes(e) ? HALF_EXT : HALF_INT,
    openings: openings[e] ?? [],
    ...(open.includes(e) ? { open: true } : {}),
  })
  return {
    name,
    kind,
    u0: rect[0],
    v0: rect[1],
    u1: rect[2],
    v1: rect[3],
    edges: { front: edge('front'), back: edge('back'), left: edge('left'), right: edge('right') },
  }
}

const door = (centre: number, width = 32): FurnishOpening => ({
  a: centre - width / 2,
  b: centre + width / 2,
  kind: 'door',
})
const window = (centre: number, width = 48, sillIn = 36): FurnishOpening => ({
  a: centre - width / 2,
  b: centre + width / 2,
  kind: 'window',
  sillIn,
})

let counter = 0
const identity = (p: Pt): Pt => [p[0] * IN, p[1] * IN]
const run = (rooms: FurnishRoom[], catalog: readonly CatalogAsset[] = FIXTURE_CATALOG, rng?: () => number) =>
  furnishRooms({
    rng,
    rooms,
    catalog,
    levelId: 'level_1',
    ids: () => `item_${++counter}`,
    toLocal: identity,
    generatedBy: 'test',
  })

type Item = {
  id: string
  name: string
  position: [number, number, number]
  rotation: [number, number, number]
  asset: CatalogAsset
  metadata: { furnish: { room: string; kind: RoomKind; role: string } }
}
const items = (r: ReturnType<typeof run>) => r.ops.map((op) => op.node as unknown as Item)
const byRole = (r: ReturnType<typeof run>, role: string) =>
  items(r).filter((i) => i.metadata.furnish.role === role)
/** The item's plan rectangle in inches. */
const rectOf = (i: Item) => {
  // the node's scale is part of its footprint (a vanity narrowed to its wall)
  const d = i.asset.dimensions
  const sc = i.scale ?? [1, 1, 1]
  const ext = extents({ ...i.asset, dimensions: [d[0] * sc[0], d[1] * sc[1], d[2] * sc[2]] }, i.rotation[1])
  const u = i.position[0] / IN
  const v = i.position[2] / IN
  return { u0: u - ext.u / 2, v0: v - ext.v / 2, u1: u + ext.u / 2, v1: v + ext.v / 2 }
}
const insideRoom = (i: Item, rm: FurnishRoom) => {
  const r = rectOf(i)
  return r.u0 >= rm.u0 - 0.6 && r.u1 <= rm.u1 + 0.6 && r.v0 >= rm.v0 - 0.6 && r.v1 <= rm.v1 + 0.6
}
// pieces laid back to back touch — a hundredth of an inch in is an overlap
const overlap = (a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>) =>
  a.u0 < b.u1 - 0.01 && a.u1 > b.u0 + 0.01 && a.v0 < b.v1 - 0.01 && a.v1 > b.v0 + 0.01

describe('facing', () => {
  test('an item against an edge faces the room: its front (+z) along the inward normal', () => {
    // rotating by θ maps local +z to (sin θ, cos θ)
    for (const [edge, inward] of [
      ['front', [0, 1]],
      ['back', [0, -1]],
      ['left', [1, 0]],
      ['right', [-1, 0]],
    ] as const) {
      const yaw = edgeYaw(edge)
      expect(Math.sin(yaw)).toBeCloseTo(inward[0], 9)
      expect(Math.cos(yaw)).toBeCloseTo(inward[1], 9)
    }
    expect(Math.sin(yawToward([0, 0], [3, 0]))).toBeCloseTo(1, 9)
    expect(Math.cos(yawToward([0, 0], [0, -3]))).toBeCloseTo(-1, 9)
  })

  test('a quarter turn swaps an item\'s plan extents', () => {
    const sofa = FIXTURE_CATALOG.find((a) => a.id === 'sofa')!
    expect(extents(sofa, 0).u).toBeCloseTo(2.06 / IN, 6)
    expect(extents(sofa, Math.PI / 2).u).toBeCloseTo(1.01 / IN, 6)
  })
})

describe('bedroom', () => {
  // 12 x 12 ft, door in the front wall near the left corner, window in the back wall
  const bed = room('BED 1', 'bed', [0, 0, 144, 144], ['back', 'left'], {
    front: [door(100)],
    back: [window(72)],
  })

  test('the bed heads the wall without the door or window, nightstands beside it, dresser elsewhere', () => {
    const r = run([bed])
    const beds = byRole(r, 'bed')
    expect(beds).toHaveLength(1)
    const b = beds[0]!
    expect(b.asset.id).toBe('double-bed')
    // the back wall has the window, the front the door → a side wall; the left is exterior
    // (no door, no window) or the right — either way not the front or the back
    expect(['left', 'right']).toContain(
      Math.abs(Math.sin(b.rotation[1])) > 0.5 ? (Math.sin(b.rotation[1]) > 0 ? 'left' : 'right') : 'none',
    )
    const rb = rectOf(b)
    // its back on the wall's inner face
    const onLeft = Math.sin(b.rotation[1]) > 0
    expect(onLeft ? rb.u0 : 144 - rb.u1).toBeCloseTo(onLeft ? HALF_EXT : HALF_INT, 1)
    expect(byRole(r, 'nightstand')).toHaveLength(2)
    expect(byRole(r, 'dresser')).toHaveLength(1)
    for (const i of items(r)) expect(insideRoom(i, bed)).toBe(true)
    // nothing stands in the door's swing
    const swing = { u0: 84 - 6, v0: 0, u1: 116 + 6, v1: DOOR_SWING + HALF_EXT }
    for (const i of items(r)) expect(overlap(rectOf(i), swing)).toBe(false)
    // nothing overlaps anything
    const rects = items(r).map(rectOf)
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i]!, rects[j]!)).toBe(false)
  })

  test('a narrow bedroom gets the single bed', () => {
    const small = room('BED 3', 'bed', [0, 0, 108, 132], ['back'], { front: [door(54)] })
    const r = run([small])
    expect(byRole(r, 'bed')[0]!.asset.id).toBe('single-bed')
  })
})

describe('bath', () => {
  test('a 5 x 8 bath: toilet and shower on the wet wall and across the end, the 72 in vanity narrowed to the wall', () => {
    // door on the front (short) wall, hung beside the vanity's end so its
    // swing clears it; the long walls are left / right
    const bath = room('BATH', 'bath', [0, 0, 60, 96], ['right'], { front: [door(46, 24)] })
    const r = run([bath])
    const roles = items(r).map((i) => i.metadata.furnish.role)
    expect(roles).toContain('toilet')
    expect(roles).toContain('shower')
    expect(roles).toContain('vanity')
    const vanity = byRole(r, 'vanity')[0]!
    // the same catalog piece, scaled to a stock width along its own length
    expect(vanity.asset.id).toBe('bathroom-sink')
    expect(vanity.scale[0]).toBeLessThan(1)
    expect([48, 36, 30].some((w) => Math.abs(vanity.scale[0] * 1.83 * M_TO_IN - w) < 0.5)).toBe(true)
    expect(r.warnings.some((w) => w.includes('vanity') && w.includes('BATH'))).toBe(false)
    // the same bath with the door centred on the end: its swing takes the
    // vanity's only spot, even at 30 in — said so
    const centred = run([room('BATH', 'bath', [0, 0, 60, 96], ['right'], { front: [door(30, 30)] })])
    expect(byRole(centred, 'vanity')).toHaveLength(0)
    expect(centred.warnings.some((w) => w.includes('vanity') && w.includes('BATH'))).toBe(true)
    const shower = byRole(r, 'shower')[0]!
    // across the far end: its back on the back wall
    expect(rectOf(shower).v1).toBeCloseTo(96 - HALF_INT, 1)
    const toilet = byRole(r, 'toilet')[0]!
    // on a long (wet) wall, facing across the room
    expect(Math.abs(Math.sin(toilet.rotation[1]))).toBeGreaterThan(0.99)
    for (const i of items(r)) expect(insideRoom(i, bath)).toBe(true)
    expect(overlap(rectOf(shower), rectOf(toilet))).toBe(false)
  })

  test('a 13 x 9 bath takes the vanity next to the toilet on the wet wall; the 9 ft end wall takes the tub', () => {
    const bath = room('MASTER BATH', 'bath', [0, 0, 156, 108], ['back'], { front: [door(78, 30)] })
    const r = run([bath])
    const roles = items(r).map((i) => i.metadata.furnish.role)
    expect(roles).toContain('toilet')
    expect(roles).toContain('vanity')
    // the end wall (left or right, 96 in) takes the 92 in tub
    expect(roles).toContain('tub')
    for (const i of items(r)) expect(insideRoom(i, bath)).toBe(true)
    const rects = items(r).map(rectOf)
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i]!, rects[j]!)).toBe(false)
  })
})

describe('kitchen', () => {
  test('the run sits under the window with the sink centred on it, the range and the fridge either side, facing the room', () => {
    const kitchen = room('KITCHEN', 'kitchen', [0, 0, 192, 144], ['back', 'right'], {
      back: [window(96, 48, 42)],
      front: [{ a: 20, b: 92, kind: 'open' }],
    })
    const r = run([kitchen])
    const sink = byRole(r, 'sink')[0]!
    expect(sink).toBeDefined()
    expect(sink.position[0] / IN).toBeCloseTo(96, 1)
    // back against the back wall, facing the front
    expect(rectOf(sink).v1).toBeCloseTo(144 - HALF_EXT, 1)
    expect(Math.cos(sink.rotation[1])).toBeCloseTo(-1, 9)
    const ids = items(r).map((i) => i.asset.id)
    expect(ids).toContain('stove')
    expect(ids).toContain('fridge')
    expect(ids).toContain('dishwasher-movn72ls')
    const floor = items(r).filter((i) => !i.metadata.furnish.floating)
    for (const i of floor) expect(insideRoom(i, kitchen)).toBe(true)
    // the sink, the dishwasher beside it and the fridge stand on the run; a
    // 16 ft run with the sink centred has 47 in a side, so the range turns
    // the corner onto the wall at the dishwasher's end — the left (an L)
    for (const role of ['sink', 'dishwasher', 'fridge']) {
      expect(rectOf(byRole(r, role)[0]!).v1).toBeCloseTo(144 - HALF_EXT, 1)
    }
    const dw = rectOf(byRole(r, 'dishwasher')[0]!)
    const sk = rectOf(sink)
    expect(Math.min(Math.abs(dw.u0 - sk.u1), Math.abs(dw.u1 - sk.u0))).toBeLessThan(1)
    const stove = rectOf(byRole(r, 'stove')[0]!)
    expect(stove.u0).toBeCloseTo(HALF_INT, 1) // the left wall is a partition
    // the hood hangs over the range, off the floor
    const hood = byRole(r, 'hood')[0]!
    expect(hood.position[1]).toBeCloseTo(1.55, 6)
    expect(hood.position[0]).toBeCloseTo(byRole(r, 'stove')[0]!.position[0], 6)
    const rects = floor.map(rectOf)
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i]!, rects[j]!)).toBe(false)
  })

  test('a kitchen open to the great room: nothing backs onto the open edge — the range keeps to a wall', () => {
    // no wall on the front: the room runs into the great room; the run goes
    // on the window wall, the range that turns the corner finds the walled
    // side, and the sofa next door never gets a range at its back
    const kitchen = room('KITCHEN', 'kitchen', [0, 0, 192, 144], ['back', 'right'], { back: [window(96, 48, 42)] }, ['front'])
    const r = run([kitchen], FIXTURE_CATALOG, () => 0.9)
    for (const i of items(r).filter((x) => !x.metadata.furnish.floating)) {
      expect(insideRoom(i, kitchen)).toBe(true)
      // nothing within a foot of the open edge with its back to it
      const rc = rectOf(i)
      if (rc.v0 < 12) expect(Math.cos(i.rotation[1])).not.toBeCloseTo(1, 3)
    }
    const stove = byRole(r, 'stove')[0]!
    expect(stove).toBeDefined()
    const st = rectOf(stove)
    const onWall =
      Math.abs(st.v1 - (144 - HALF_EXT)) < 1 || Math.abs(st.u1 - (192 - HALF_EXT)) < 1 || Math.abs(st.u0 - HALF_INT) < 1
    expect(onWall).toBe(true)
  })

  test('a big kitchen with a willing roll takes an island with 42 in aisles and an L on the return wall', () => {
    const kitchen = room('KITCHEN', 'kitchen', [0, 0, 240, 204], ['back', 'right'], {
      back: [window(120, 48, 42)],
      front: [{ a: 20, b: 92, kind: 'open' }],
    })
    const r = run([kitchen], FIXTURE_CATALOG, () => 0.1)
    const island = byRole(r, 'island')[0]!
    expect(island).toBeDefined()
    const isl = rectOf(island)
    const counterDepth = 0.63 * M_TO_IN
    // 42 in clear between the run's counter front and the island's back
    expect(204 - HALF_EXT - counterDepth - isl.v1).toBeCloseTo(42, 0)
    // the L: a counter on the right wall, its back on that wall
    const leg = items(r).find(
      (i) => i.asset.id === 'kitchen-counter' && Math.abs(rectOf(i).u1 - (240 - HALF_EXT)) < 1,
    )
    expect(leg).toBeDefined()
    const rects = items(r).filter((i) => !i.metadata.furnish.floating).map(rectOf)
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i]!, rects[j]!)).toBe(false)
    // and a roll that says no: neither
    const plain = run([kitchen], FIXTURE_CATALOG, () => 0.9)
    expect(byRole(plain, 'island')).toHaveLength(0)
  })

  test('the fridge never stands in front of a window it would block', () => {
    // a low window on the only door-free wall: the run goes there, the fridge (1.92 m) keeps clear of the glass
    const kitchen = room('KITCHEN', 'kitchen', [0, 0, 168, 120], ['back'], {
      back: [window(84, 48, 42)],
      front: [door(30)],
      left: [door(60)],
      right: [door(60)],
    })
    const r = run([kitchen])
    const fridge = items(r).find((i) => i.asset.id === 'fridge')
    if (fridge) {
      const f = rectOf(fridge)
      expect(f.u1 <= 60 || f.u0 >= 108).toBe(true)
    }
  })
})

describe('living, dining, office, laundry', () => {
  test('the TV on a blank interior wall, the sofa facing it, the coffee table between', () => {
    const living = room('LIVING', 'living', [0, 0, 192, 168], ['front', 'left'], {
      front: [window(60, 36), window(132, 36)],
      right: [door(84)],
    })
    const r = run([living])
    const tv = byRole(r, 'tv')[0]!
    const sofa = byRole(r, 'sofa')[0]!
    const coffee = byRole(r, 'coffee-table')[0]!
    expect(tv).toBeDefined()
    expect(sofa).toBeDefined()
    expect(coffee).toBeDefined()
    // the back wall is the blank interior one
    expect(rectOf(tv).v1).toBeCloseTo(168 - HALF_INT, 1)
    // the sofa faces the TV
    const toTv = yawToward(
      [sofa.position[0] / IN, sofa.position[2] / IN],
      [tv.position[0] / IN, tv.position[2] / IN],
    )
    expect(sofa.rotation[1]).toBeCloseTo(toTv, 6)
    expect(coffee.position[2]).toBeGreaterThan(sofa.position[2])
    expect(coffee.position[2]).toBeLessThan(tv.position[2])
    for (const i of items(r)) expect(insideRoom(i, living)).toBe(true)
  })

  test('the dining table centred with four chairs facing it', () => {
    const dining = room('DINING', 'dining', [0, 0, 144, 132], ['left'], { right: [door(66)] })
    const r = run([dining])
    const table = byRole(r, 'table')[0]!
    expect(table).toBeDefined()
    // centred across the room, shifted off the right-hand door's swing along its length
    expect(table.position[2] / IN).toBeCloseTo((HALF_INT + 132 - HALF_INT) / 2, 1)
    expect(rectOf(table).u1).toBeLessThanOrEqual(144 - HALF_INT - DOOR_SWING + 0.01)
    const chairs = byRole(r, 'chair')
    expect(chairs).toHaveLength(4)
    for (const c of chairs) {
      // facing the table's long axis
      const facing: Pt = [Math.sin(c.rotation[1]), Math.cos(c.rotation[1])]
      const toTable: Pt = [table.position[0] - c.position[0], table.position[2] - c.position[2]]
      expect(facing[0] * toTable[0] + facing[1] * toTable[1]).toBeGreaterThan(0)
      expect(insideRoom(c, dining)).toBe(true)
    }
  })

  test('the desk under the office window, the bookshelf on another wall; the washer in the laundry', () => {
    const office = room('OFFICE', 'office', [0, 0, 120, 120], ['back'], {
      back: [window(60, 36)],
      front: [door(30)],
    })
    const laundry = room('LAUNDRY', 'laundry', [0, 0, 72, 84], ['back'], { front: [door(36, 30)] })
    const r = run([office, laundry])
    const desk = byRole(r, 'desk')[0]!
    expect(desk.position[0] / IN).toBeCloseTo(60, 1)
    expect(rectOf(desk).v1).toBeCloseTo(120 - HALF_EXT, 1)
    expect(byRole(r, 'bookshelf')).toHaveLength(1)
    expect(byRole(r, 'washer')).toHaveLength(1)
    expect(insideRoom(byRole(r, 'washer')[0]!, laundry)).toBe(true)
  })
})

describe('the item nodes', () => {
  test('level items with the catalog entry as their asset, positioned through toLocal, tagged with their room and role', () => {
    const bed = room('BED 2', 'bed', [120, 0, 264, 144], ['back'], { front: [door(150)] })
    const r = run([bed])
    expect(r.placed).toBe(r.ops.length)
    for (const op of r.ops) {
      expect(op.parentId).toBe('level_1')
      const n = op.node as unknown as Item & { type: string; parentId: string }
      expect(n.type).toBe('item')
      expect(n.parentId).toBe('level_1')
      expect(n.position[1]).toBe(0)
      expect((n.asset as { tool?: string }).tool).toBeUndefined()
      expect(n.asset.src).toContain(n.asset.id)
      expect(n.metadata.furnish.room).toBe('BED 2')
      expect(n.metadata.furnish.kind).toBe('bed')
    }
  })

  test('a catalog missing an item says so once and places the rest; halls and closets get nothing, a garage its car', () => {
    const catalog = FIXTURE_CATALOG.filter((a) => a.id !== 'bedside-table')
    const bed = room('BED 1', 'bed', [0, 0, 144, 144], ['back'], { front: [door(30)] })
    const hall = room('HALL', 'hall', [144, 0, 192, 144], [], { left: [door(72)] })
    const garage = room('GARAGE', 'garage', [192, 0, 432, 288], ['front', 'back', 'right'], {
      front: [door(312, 192)],
    })
    const r = run([bed, hall, garage], catalog)
    expect(r.warnings.filter((w) => w.includes('bedside-table'))).toHaveLength(1)
    expect(byRole(r, 'bed')).toHaveLength(1)
    expect(
      items(r).every((i) => i.metadata.furnish.room === 'BED 1' || i.metadata.furnish.room === 'GARAGE'),
    ).toBe(true)
    // the car nose-in from the garage door, its length square to that wall
    const car = byRole(r, 'car')[0]!
    expect(car).toBeDefined()
    expect(Math.abs(Math.cos(car.rotation[1]))).toBeGreaterThan(0.99)
    expect(byRole(r, 'ev-charger')[0]!.position[1]).toBeCloseTo(1.2, 6)
  })
})
