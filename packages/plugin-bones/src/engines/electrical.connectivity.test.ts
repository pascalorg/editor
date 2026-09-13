import { describe, expect, test } from 'bun:test'
import { Vector3 } from 'three'
import type { Fixture, OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import { layoutElectrical, routeWiring } from './electrical'
import { DEVICE_TOL, endpointsOf, unreachableDevices } from './electrical.test-helpers'

/**
 * Round-12 Phase 0: GLOBAL panel-to-device reachability (the harness the
 * round-12 reviewer demanded before any other electrical work).
 *
 * Every routed circuit must be physically continuous cable: a union-find
 * over wire-member endpoints (2 cm merge, 3 cm endpoint-to-segment attach)
 * must connect the panel to EVERY device. Three verified bugs used to pass
 * the old proximity-only tests while stranding devices:
 *  - B1: panel mounted inside a door RO → 22/22 devices unreachable;
 *  - B2: tee junction snapped out of a door RO → unbridged 0.52 m hop;
 *  - M1: junctions within JUNCTION_TOL but not coincident → 5–25 cm gaps.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeWall(overrides: Partial<WallSlice> = {}): WallSlice {
  const start = overrides.start ?? [0, 0]
  const end = overrides.end ?? [4, 0]
  const dx = (end[0] ?? 0) - (start[0] ?? 0)
  const dz = (end[1] ?? 0) - (start[1] ?? 0)
  const length = Math.hypot(dx, dz)
  return {
    id: 'wall_c',
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

const door = (u: number, roughWidth = 0.95): OpeningSlice => ({
  id: `door_${u}`,
  kind: 'door',
  u,
  width: roughWidth - 0.05,
  roughWidth,
  height: 2.1,
  roughHeight: 2.15,
  sillHeight: 0,
})

function room(
  category: RoomSlice['category'],
  polygon: [number, number][],
  overrides: Partial<RoomSlice> = {},
): RoomSlice {
  return {
    id: `room_${category}`,
    name: category,
    category,
    polygon,
    boundaryWallIds: [],
    ceilingHeight: 2.7,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scenarios — (b), (c), (d) reproduced the three round-12 blockers pre-fix
// ---------------------------------------------------------------------------

describe('panel-to-device reachability (round-12 phase 0)', () => {
  test('(a) clean two-room plan: every device reaches the panel', () => {
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [8, 0] }),
      makeWall({ id: 'w_e', start: [8, 0], end: [8, 4] }),
      makeWall({ id: 'w_n', start: [8, 4], end: [0, 4] }),
      makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
      makeWall({ id: 'w_div', start: [4, 0], end: [4, 4], exterior: false, openings: [door(2)] }),
    ]
    const rooms = [
      room('kitchen', [[0, 0], [4, 0], [4, 4], [0, 4]]),
      room('bedroom', [[4, 0], [8, 0], [8, 4], [4, 4]], { id: 'room_bed' }),
    ]
    const fixtures = layoutElectrical(walls, rooms)
    const members = routeWiring(fixtures, walls)
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })

  test('(b) B1: door spanning the panel wall midpoint no longer strands the plan', () => {
    // Garage wall (longest) with the door dead-center — the old placePanel
    // mounted INSIDE the RO and 22/22 devices were unreachable.
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [8, 0], openings: [door(4, 0.95)] }),
      makeWall({ id: 'w_e', start: [8, 0], end: [8, 4] }),
      makeWall({ id: 'w_n', start: [8, 4], end: [0, 4] }),
      makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
      makeWall({ id: 'w_div', start: [4, 0], end: [4, 4], exterior: false, openings: [door(2)] }),
    ]
    const rooms = [
      room('garage', [[0, 0], [4, 0], [4, 4], [0, 4]], { boundaryWallIds: ['w_s', 'w_div', 'w_w'] }),
      room('kitchen', [[4, 0], [8, 0], [8, 4], [4, 4]]),
    ]
    const fixtures = layoutElectrical(walls, rooms)
    const panel = fixtures.find((f) => f.kind === 'panel')
    expect(panel).toBeDefined()
    // panel mounted OUTSIDE the door RO
    const p = panel as Fixture
    const u = Math.hypot(p.position[0] - 0, p.position[2] - 0)
    expect(Math.abs(u - 4) > 0.95 / 2).toBe(true)
    const members = routeWiring(fixtures, walls)
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })

  test('(b2) 16-ft overhead garage door variant', () => {
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [8, 0], openings: [door(4, 4.9)] }),
      makeWall({ id: 'w_e', start: [8, 0], end: [8, 4] }),
      makeWall({ id: 'w_n', start: [8, 4], end: [0, 4] }),
      makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
    ]
    const rooms = [
      room('garage', [[0, 0], [8, 0], [8, 4], [0, 4]], { boundaryWallIds: ['w_s'] }),
    ]
    const fixtures = layoutElectrical(walls, rooms)
    const members = routeWiring(fixtures, walls)
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })

  test('(c) B2: tee landing in a door RO gets a junction jumper, not a silent gap', () => {
    // Divider tees into the south wall exactly where a door sits: the
    // junction snaps out of the RO — the jumper must bridge the hop.
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [8, 0], openings: [door(3)] }),
      makeWall({ id: 'w_e', start: [8, 0], end: [8, 4] }),
      makeWall({ id: 'w_n', start: [8, 4], end: [0, 4] }),
      makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
      makeWall({ id: 'w_div', start: [3, 0], end: [3, 4], exterior: false }),
    ]
    const rooms = [
      room('kitchen', [[0, 0], [3, 0], [3, 4], [0, 4]]),
      room('bedroom', [[3, 0], [8, 0], [8, 4], [3, 4]], { id: 'room_bed' }),
    ]
    const fixtures = layoutElectrical(walls, rooms)
    const members = routeWiring(fixtures, walls)
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })

  test('(d) M1: a divider stopping short of the perimeter still connects', () => {
    // Tee wall ends 0.2 m short of both perimeter walls (within
    // JUNCTION_TOL) — the old graph accepted the junction without bridging.
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [8, 0] }),
      makeWall({ id: 'w_e', start: [8, 0], end: [8, 4] }),
      makeWall({ id: 'w_n', start: [8, 4], end: [0, 4] }),
      makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
      makeWall({ id: 'w_div', start: [4, 0.2], end: [4, 3.8], exterior: false }),
    ]
    const rooms = [
      room('kitchen', [[0, 0], [4, 0], [4, 4], [0, 4]]),
      room('laundry', [[4, 0], [8, 0], [8, 4], [4, 4]]),
    ]
    const fixtures = layoutElectrical(walls, rooms)
    const members = routeWiring(fixtures, walls)
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })

  test('box stubs: every wall device position touches a wire endpoint (2 cm)', () => {
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [6, 0] }),
      makeWall({ id: 'w_e', start: [6, 0], end: [6, 4] }),
      makeWall({ id: 'w_n', start: [6, 4], end: [0, 4] }),
      makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
    ]
    const rooms = [room('bedroom', [[0, 0], [6, 0], [6, 4], [0, 4]])]
    const fixtures = layoutElectrical(walls, rooms)
    const members = routeWiring(fixtures, walls).filter((m) => m.role === 'wire-run')
    const wallDevices = fixtures.filter(
      (f) =>
        f.kind !== 'panel' &&
        f.kind !== 'light' &&
        f.kind !== 'smoke-alarm' &&
        typeof f.meta?.circuit === 'string',
    )
    expect(wallDevices.length).toBeGreaterThan(0)
    for (const d of wallDevices) {
      const p = new Vector3(...d.position)
      const touched = members.some((m) => {
        const [a, b] = endpointsOf(m)
        return p.distanceTo(a) < DEVICE_TOL || p.distanceTo(b) < DEVICE_TOL
      })
      expect(touched).toBe(true)
    }
  })
})
