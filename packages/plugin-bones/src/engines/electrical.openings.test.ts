import { describe, expect, test } from 'bun:test'
import type { Fixture, Member, OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import { layoutElectrical, panelMountU, routeWiring } from './electrical'
import { cableConnects, endpointsOf, unreachableDevices } from './electrical.test-helpers'

/**
 * Prod report (2026-08-15): drop a low window or a door on a wall and the
 * wires bored straight through the rough opening; a switch box could land on
 * the glass. INVARIANT — nothing electrical occupies ANY rough opening:
 *  - no wire-run passes through an RO volume (detour over header/under sill),
 *  - no device box mounts inside an RO,
 *  - the panel never mounts across an RO,
 *  - and every detour still leaves the circuit physically continuous.
 * Also in review/CHECKLIST.md as invariant E1.
 */

function makeWall(overrides: Partial<WallSlice> = {}): WallSlice {
  const start = overrides.start ?? [0, 0]
  const end = overrides.end ?? [4, 0]
  const dx = (end[0] ?? 0) - (start[0] ?? 0)
  const dz = (end[1] ?? 0) - (start[1] ?? 0)
  const length = Math.hypot(dx, dz)
  return {
    id: 'wall',
    start,
    end,
    dir: [dx / length, dz / length],
    length,
    thickness: 0.114,
    height: 2.5,
    exterior: true,
    openings: [],
    curved: false,
    ...overrides,
  }
}

const opening = (
  kind: 'door' | 'window',
  u: number,
  roughWidth: number,
  sillHeight: number,
  roughHeight: number,
): OpeningSlice => ({
  id: `${kind}_${u}`,
  kind,
  u,
  width: roughWidth - 0.05,
  roughWidth,
  height: roughHeight - 0.05,
  roughHeight,
  sillHeight,
})

const room = (category: RoomSlice['category'], polygon: [number, number][]): RoomSlice => ({
  id: `room_${category}`,
  name: category,
  category,
  polygon,
  boundaryWallIds: [],
  ceilingHeight: 2.7,
})

/** RO boxes in world space, deflated 2 cm so edge-riding detours don't trip. */
type RoBox = { min: [number, number, number]; max: [number, number, number] }
const EPS = 0.02
function roBoxes(walls: WallSlice[]): RoBox[] {
  const out: RoBox[] = []
  for (const w of walls) {
    for (const o of w.openings) {
      const lo = o.u - o.roughWidth / 2 + EPS
      const hi = o.u + o.roughWidth / 2 - EPS
      if (hi <= lo) continue
      const a = [w.start[0] + w.dir[0] * lo, w.start[1] + w.dir[1] * lo] as const
      const b = [w.start[0] + w.dir[0] * hi, w.start[1] + w.dir[1] * hi] as const
      // lateral half-extent: the wall body only — face-mounted box stubs
      // (thickness/2 + FACE_OFFSET) sit outside the RO plane by design
      const lat = w.thickness / 2 + 0.005
      const nx = -w.dir[1]
      const nz = w.dir[0]
      out.push({
        min: [
          Math.min(a[0], b[0]) - Math.abs(nx) * lat,
          o.sillHeight + EPS,
          Math.min(a[1], b[1]) - Math.abs(nz) * lat,
        ],
        max: [
          Math.max(a[0], b[0]) + Math.abs(nx) * lat,
          o.sillHeight + o.roughHeight - EPS,
          Math.max(a[1], b[1]) + Math.abs(nz) * lat,
        ],
      })
    }
  }
  return out
}

const inBox = (p: [number, number, number], b: RoBox): boolean =>
  p[0] > b.min[0] && p[0] < b.max[0] && p[1] > b.min[1] && p[1] < b.max[1] && p[2] > b.min[2] && p[2] < b.max[2]

/** Wire segments sampled every 5 cm against every RO box. */
function wiresThroughOpenings(members: Member[], walls: WallSlice[]): string[] {
  const boxes = roBoxes(walls)
  const bad: string[] = []
  for (const m of members) {
    if (m.role !== 'wire-run') continue
    if (m.label?.includes('⚠')) continue // flagged degenerate runs are exempt
    const [a, b] = endpointsOf(m)
    const steps = Math.max(2, Math.ceil(a.distanceTo(b) / 0.05))
    for (let i = 0; i <= steps; i++) {
      const p: [number, number, number] = [
        a.x + ((b.x - a.x) * i) / steps,
        a.y + ((b.y - a.y) * i) / steps,
        a.z + ((b.z - a.z) * i) / steps,
      ]
      if (boxes.some((box) => inBox(p, box))) {
        bad.push(`${m.label ?? m.role} @ ${p.map((v) => v.toFixed(2)).join(',')}`)
        break
      }
    }
  }
  return bad
}

function devicesInOpenings(fixtures: Fixture[], walls: WallSlice[]): string[] {
  const boxes = roBoxes(walls)
  return fixtures
    .filter((f) => f.kind !== 'light' && f.kind !== 'smoke-alarm')
    .filter((f) => boxes.some((b) => inBox([f.position[0], f.position[1], f.position[2]], b)))
    .map((f) => `${f.kind}@${f.position.join(',')}`)
}

const RECT: [number, number][] = [
  [0, 0],
  [8, 0],
  [8, 4],
  [0, 4],
]

describe('electrical vs rough openings (prod 2026-08-15)', () => {
  test('low picture window: wires detour, no box in the glass, still connected', () => {
    // sill 0.2 m — the 18" drill plane runs straight through it pre-fix
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [8, 0], openings: [opening('window', 4, 2.4, 0.2, 1.8)] }),
      makeWall({ id: 'w_e', start: [8, 0], end: [8, 4] }),
      makeWall({ id: 'w_n', start: [8, 4], end: [0, 4] }),
      makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
    ]
    const rooms = [room('bedroom', RECT)]
    const fixtures = layoutElectrical(walls, rooms)
    const members = routeWiring(fixtures, walls)
    expect(devicesInOpenings(fixtures, walls)).toEqual([])
    expect(wiresThroughOpenings(members, walls)).toEqual([])
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })

  test('normal-sill window still gets receptacles beneath it (NEC 210.52(A)(2)(2))', () => {
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [8, 0], openings: [opening('window', 4, 1.5, 0.9, 1.2)] }),
      makeWall({ id: 'w_e', start: [8, 0], end: [8, 4] }),
      makeWall({ id: 'w_n', start: [8, 4], end: [0, 4] }),
      makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
    ]
    const rooms = [room('bedroom', RECT)]
    const fixtures = layoutElectrical(walls, rooms)
    const members = routeWiring(fixtures, walls)
    // a receptacle SHOULD land under the window — fixed glass counts as wall space
    const under = fixtures.filter(
      (f) => f.kind.startsWith('receptacle') && f.sourceId === 'w_s' && Math.abs(f.position[0] - 4) < 1.5,
    )
    expect(under.length).toBeGreaterThan(0)
    expect(wiresThroughOpenings(members, walls)).toEqual([])
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })

  test('window butted to the door latch side: the switch box moves off the glass', () => {
    const walls = [
      makeWall({
        id: 'w_s',
        start: [0, 0],
        end: [8, 0],
        openings: [opening('door', 2.5, 0.95, 0, 2.15), opening('window', 4.2, 2.0, 0.3, 1.9)],
      }),
      makeWall({ id: 'w_e', start: [8, 0], end: [8, 4] }),
      makeWall({ id: 'w_n', start: [8, 4], end: [0, 4] }),
      makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
    ]
    const rooms = [room('bedroom', RECT)]
    const fixtures = layoutElectrical(walls, rooms)
    const members = routeWiring(fixtures, walls)
    expect(devicesInOpenings(fixtures, walls)).toEqual([])
    expect(wiresThroughOpenings(members, walls)).toEqual([])
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })

  test('full-height glazing: the crossing is flagged, never silent', () => {
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [8, 0], openings: [opening('window', 4, 3.0, 0, 2.48)] }),
      makeWall({ id: 'w_e', start: [8, 0], end: [8, 4] }),
      makeWall({ id: 'w_n', start: [8, 4], end: [0, 4] }),
      makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
    ]
    const rooms = [room('bedroom', RECT)]
    const fixtures = layoutElectrical(walls, rooms)
    const members = routeWiring(fixtures, walls)
    // unflagged wires stay out; if anything crosses it carries the ⚠ label
    expect(wiresThroughOpenings(members, walls)).toEqual([])
    expect(devicesInOpenings(fixtures, walls)).toEqual([])
  })

  test('window over the wall midpoint pushes the panel aside', () => {
    const wall = makeWall({
      id: 'w_s',
      start: [0, 0],
      end: [8, 0],
      openings: [opening('window', 4, 2.0, 0.8, 1.4)], // crosses panel height 60" AFF
    })
    const u = panelMountU(wall)
    expect(Math.abs(u - 4) > 1.0).toBe(true)
  })

  test('transom above the door: detour ducks the transom too', () => {
    const walls = [
      makeWall({
        id: 'w_s',
        start: [0, 0],
        end: [8, 0],
        height: 3.0,
        openings: [opening('door', 4, 0.95, 0, 2.15), opening('window', 4, 0.95, 2.25, 0.5)],
      }),
      makeWall({ id: 'w_e', start: [8, 0], end: [8, 4], height: 3.0 }),
      makeWall({ id: 'w_n', start: [8, 4], end: [0, 4], height: 3.0 }),
      makeWall({ id: 'w_w', start: [0, 4], end: [0, 0], height: 3.0 }),
    ]
    const rooms = [room('bedroom', RECT)]
    const fixtures = layoutElectrical(walls, rooms)
    const members = routeWiring(fixtures, walls)
    expect(wiresThroughOpenings(members, walls)).toEqual([])
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })
})

describe('service cable vs rough openings (E1, skeptic 2026-08-16)', () => {
  // The old routeServiceCable drew the meter→panel feed as straight
  // Manhattan legs: through the garage-door RO at socket height (y≈1.5) on
  // one scene, and as a 3.6 m member flying through room air after a panel
  // drag on another. The feed now rides the wall graph like every circuit.

  /** Plan distance from a point to the nearest wall centerline segment. */
  const distToWalls = (p: [number, number], walls: WallSlice[]): number => {
    let best = Number.POSITIVE_INFINITY
    for (const w of walls) {
      const [ax, az] = w.start
      const t = Math.max(0, Math.min(w.length, (p[0] - ax) * w.dir[0] + (p[1] - az) * w.dir[1]))
      best = Math.min(best, Math.hypot(ax + w.dir[0] * t - p[0], az + w.dir[1] * t - p[1]))
    }
    return best
  }

  const garageWalls = () => [
    makeWall({
      id: 'w_s',
      start: [0, 0],
      end: [8, 0],
      // 16' garage door: RO 1.55..6.45, sill 0, head 2.2 — the socket-height
      // feed plane (y≈1.4–1.5) runs straight through it pre-fix
      openings: [opening('door', 4, 4.9, 0, 2.2)],
    }),
    makeWall({ id: 'w_e', start: [8, 0], end: [8, 4] }),
    makeWall({ id: 'w_n', start: [8, 4], end: [0, 4] }),
    makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
  ]

  test('garage-door scene: the feed detours the RO — E1 harness clean', () => {
    const walls = garageWalls()
    const rooms = [room('garage', RECT)]
    // meter and panel straddle the garage door on the same wall
    const fixtures = layoutElectrical(walls, rooms, {
      panel: { wallId: 'w_s', wallT: 0.09, position: [0, 0, 0] },
      electricMeter: { wallId: 'w_s', wallT: 0.9, position: [0, 0, 0] },
    })
    const members = routeWiring(fixtures, walls)
    expect(wiresThroughOpenings(members, walls)).toEqual([])
    const feed = members.filter(
      (m) => m.sourceId === 'service-entrance' && m.label?.includes('meter → panel feed'),
    )
    expect(feed.length).toBeGreaterThan(0)
    // the detour actually rises over the 2.2 m header inside the wall
    expect(feed.some((m) => endpointsOf(m).some((e) => e.y > 2.2))).toBe(true)
    // and the chain stays continuous street → meter → panel
    const meter = fixtures.find((f) => f.kind === 'electric-meter') as Fixture
    const panel = fixtures.find((f) => f.kind === 'panel') as Fixture
    expect(
      cableConnects(members, [
        [meter.position[0], meter.position[1], meter.position[2]],
        [panel.position[0], panel.position[1], panel.position[2]],
      ]),
    ).toBe(true)
  })

  test('post-drag scene: panel on ANOTHER wall — the feed follows walls, never room air', () => {
    const walls = garageWalls()
    const rooms = [room('garage', RECT)]
    const fixtures = layoutElectrical(walls, rooms, {
      panel: { wallId: 'w_e', wallT: 0.5, position: [0, 0, 0] },
    })
    const members = routeWiring(fixtures, walls)
    expect(wiresThroughOpenings(members, walls)).toEqual([])
    const feed = members.filter(
      (m) => m.sourceId === 'service-entrance' && m.label?.includes('meter → panel feed'),
    )
    expect(feed.length).toBeGreaterThan(0)
    // every unflagged feed member hugs a wall body — the old route flew a
    // straight 3.6 m member through the middle of the room
    for (const m of feed) {
      if (m.label?.includes('⚠')) continue
      for (const e of endpointsOf(m)) {
        expect(distToWalls([e.x, e.z], walls)).toBeLessThan(0.2)
      }
    }
    const meter = fixtures.find((f) => f.kind === 'electric-meter') as Fixture
    const panel = fixtures.find((f) => f.kind === 'panel') as Fixture
    expect(
      cableConnects(members, [
        [meter.position[0], meter.position[1], meter.position[2]],
        [panel.position[0], panel.position[1], panel.position[2]],
      ]),
    ).toBe(true)
  })

  test('street lateral + riser get sampled too: a socket forced into glazing is flagged', () => {
    // meter override dead-center of a full-height window — the riser has
    // nowhere to detour, so it must carry the ⚠, never cross silently
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [8, 0], openings: [opening('window', 4, 3.0, 0, 2.48)] }),
      makeWall({ id: 'w_e', start: [8, 0], end: [8, 4] }),
      makeWall({ id: 'w_n', start: [8, 4], end: [0, 4] }),
      makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
    ]
    const rooms = [room('bedroom', RECT)]
    const fixtures = layoutElectrical(walls, rooms, {
      electricMeter: { wallId: 'w_s', wallT: 0.5, position: [0, 0, 0] },
    })
    const members = routeWiring(fixtures, walls)
    // the E1 harness stays clean: whatever crosses carries the flag
    expect(wiresThroughOpenings(members, walls)).toEqual([])
    const flaggedOrClear = members
      .filter((m) => m.sourceId === 'service-entrance')
      .every((m) => m.label !== undefined)
    expect(flaggedOrClear).toBe(true)
  })
})

describe('panel edge clearance (prod 2026-08-16)', () => {
  test('a door overlapping the mount point by a sliver still pushes the panel clear', () => {
    // door RO ends 5 cm past the wall midpoint — the panel CENTER is
    // outside the RO but the 16in enclosure would overlap the jamb
    const wallSliver = makeWall({
      id: 'w_s',
      start: [0, 0],
      end: [8, 0],
      openings: [opening('door', 3.55, 0.95, 0, 2.15)], // RO: 3.075..4.025
    })
    const u = panelMountU(wallSliver)
    const halfW = 0.2032 // 8in
    const lo = 3.075
    const hi = 4.025
    // enclosure edge (u ± 8in) plus 6in clearance stays out of the RO
    expect(u + halfW < lo || u - halfW > hi).toBe(true)
    expect(Math.min(Math.abs(u - lo), Math.abs(u - hi))).toBeGreaterThan(halfW + 0.1)
  })
})
