import { describe, expect, test } from 'bun:test'
import type { LayoutPlan } from './layout-plan'
import {
  executeLayoutPlan,
  exteriorSegments,
  findHostWall,
  swingToward,
  type WallSegment,
} from './scene-executor'

// Two-room plan on an 8×5 footprint: living (0,0)-(5,5) with the entry,
// bedroom (5,0)-(8,5), one connecting door on the shared x=5 boundary.
const twoRoomPlan: LayoutPlan = {
  footprint: { width: 8, depth: 5 },
  entry: { roomId: 'living-1' },
  rooms: [
    {
      id: 'living-1',
      name: '客厅',
      type: 'living',
      polygon: [[0, 0], [5, 0], [5, 5], [0, 5]],
      requiresExteriorWindow: true,
    },
    {
      id: 'bedroom-1',
      name: '主卧',
      type: 'bedroom',
      polygon: [[5, 0], [8, 0], [8, 5], [5, 5]],
      requiresExteriorWindow: true,
    },
  ],
  connections: [{ from: 'living-1', to: 'bedroom-1', type: 'door' }],
}

// Post-dedupe wall set for the plan above: every boundary once, the shared
// x=5 boundary held by a single wall.
const twoRoomWalls: WallSegment[] = [
  { id: 'w-a-bottom', start: [0, 0], end: [5, 0] },
  { id: 'w-shared', start: [5, 0], end: [5, 5] },
  { id: 'w-a-top', start: [5, 5], end: [0, 5] },
  { id: 'w-a-left', start: [0, 5], end: [0, 0] },
  { id: 'w-b-bottom', start: [5, 0], end: [8, 0] },
  { id: 'w-b-right', start: [8, 0], end: [8, 5] },
  { id: 'w-b-top', start: [8, 5], end: [5, 5] },
]

type RecordedCall = { name: string; args: Record<string, unknown> }

// Minimal fake of the MCP surface the executor touches. `failures` makes a
// tool fail its next N invocations (thrown), to exercise the retry path.
function makeMockMcp(options: {
  walls?: WallSegment[]
  zoneAreas?: Record<string, number>
  failures?: Record<string, number>
} = {}) {
  const calls: RecordedCall[] = []
  const failures = { ...(options.failures ?? {}) }
  const zonePolygons = new Map<string, Array<[number, number]>>()
  let counter = 0
  const callMcp = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args })
    if ((failures[name] ?? 0) > 0) {
      failures[name] = failures[name]! - 1
      throw new Error(`injected ${name} failure`)
    }
    const wrap = (payload: Record<string, unknown>) => ({ structuredContent: payload })
    switch (name) {
      case 'create_room': {
        counter++
        const zoneId = `zone-${counter}`
        zonePolygons.set(zoneId, args.polygon as Array<[number, number]>)
        return wrap({ zoneId, slabId: `slab-${counter}`, ceilingId: `ceil-${counter}`, wallIds: [], areaSqMeters: 0 })
      }
      case 'get_walls':
        return wrap({ walls: options.walls ?? twoRoomWalls })
      case 'add_door':
        counter++
        return wrap({ doorId: `door-${counter}` })
      case 'add_window':
        counter++
        return wrap({ windowId: `window-${counter}` })
      case 'get_zones':
        return wrap({
          zones: [...zonePolygons.entries()].map(([id, polygon]) => ({ id, name: id, polygon })),
        })
      default:
        throw new Error(`unexpected tool ${name}`)
    }
  }
  return { callMcp, calls }
}

function callsNamed(calls: RecordedCall[], name: string): RecordedCall[] {
  return calls.filter(call => call.name === name)
}

describe('executeLayoutPlan', () => {
  test('builds rooms, dedupes, then places connection door / entry door / windows with zero issues', async () => {
    const { callMcp, calls } = makeMockMcp()
    let dedupeCalls = 0
    const report = await executeLayoutPlan({
      plan: twoRoomPlan,
      levelId: 'level-1',
      callMcp,
      dedupeSharedWalls: async () => {
        dedupeCalls++
        // Dedupe must run after all rooms and before any wall read.
        expect(callsNamed(calls, 'create_room')).toHaveLength(2)
        expect(callsNamed(calls, 'get_walls')).toHaveLength(0)
      },
    })

    expect(report.executionIssues).toEqual([])
    expect(dedupeCalls).toBe(1)
    expect(report.rooms.map(r => r.zoneId)).toEqual(['zone-1', 'zone-2'])

    const doors = callsNamed(calls, 'add_door')
    expect(doors).toHaveLength(2)
    // Connection door sits on the shared wall at its midpoint.
    expect(doors[0]!.args.wallId).toBe('w-shared')
    expect(doors[0]!.args.position).toBeCloseTo(0.5)
    // Swing faces the larger room (the living room).
    expect(doors[0]!.args.swingDirection).toBe('inward')
    // Entry door lands on one of the entry room's exterior walls.
    expect(['w-a-bottom', 'w-a-top', 'w-a-left']).toContain(doors[1]!.args.wallId as string)

    const windows = callsNamed(calls, 'add_window')
    expect(windows).toHaveLength(2)
    // The living-room window must not share the entry door's wall.
    expect(windows[0]!.args.wallId).not.toBe(doors[1]!.args.wallId)
    // Bedroom window on its longest exterior edge (the right footprint edge).
    expect(windows[1]!.args.wallId).toBe('w-b-right')
    for (const window of windows) {
      const position = window.args.position as number
      expect(position).toBeGreaterThanOrEqual(0)
      expect(position).toBeLessThanOrEqual(1)
    }

    expect(report.openings).toHaveLength(4)
    expect(report.openings.every(opening => opening.nodeId !== null)).toBe(true)
  })

  test('retries a failed create_room once and succeeds without recording an issue', async () => {
    const { callMcp, calls } = makeMockMcp({ failures: { create_room: 1 } })
    const report = await executeLayoutPlan({
      plan: twoRoomPlan,
      levelId: 'level-1',
      callMcp,
      dedupeSharedWalls: async () => {},
    })
    expect(report.executionIssues).toEqual([])
    expect(callsNamed(calls, 'create_room')).toHaveLength(3) // 1 failed + 2 ok
    expect(report.rooms.every(room => room.zoneId !== null)).toBe(true)
  })

  test('records an issue and keeps going when a call fails twice', async () => {
    const { callMcp } = makeMockMcp({ failures: { add_door: 4 } })
    const report = await executeLayoutPlan({
      plan: twoRoomPlan,
      levelId: 'level-1',
      callMcp,
      dedupeSharedWalls: async () => {},
    })
    // Both doors failed (2 attempts each), windows still placed.
    expect(report.executionIssues).toHaveLength(2)
    expect(report.openings.filter(o => o.kind === 'window' && o.nodeId !== null)).toHaveLength(2)
  })

  test('reports a missing host wall instead of throwing', async () => {
    // Wall list without the shared wall — as if dedupe deleted both copies.
    const walls = twoRoomWalls.filter(wall => wall.id !== 'w-shared')
    const { callMcp, calls } = makeMockMcp({ walls })
    const report = await executeLayoutPlan({
      plan: twoRoomPlan,
      levelId: 'level-1',
      callMcp,
      dedupeSharedWalls: async () => {},
    })
    expect(report.executionIssues.some(issue => issue.includes('找不到承载'))).toBe(true)
    // Only the entry door was placed.
    expect(callsNamed(calls, 'add_door')).toHaveLength(1)
  })

  test('flags built area drifting beyond tolerance from the plan', async () => {
    const { callMcp } = makeMockMcp()
    const report = await executeLayoutPlan({
      plan: twoRoomPlan,
      levelId: 'level-1',
      callMcp: async (name, args) => {
        if (name === 'get_zones') {
          return {
            structuredContent: {
              zones: [
                { id: 'zone-1', name: '客厅', polygon: [[0, 0], [5, 0], [5, 5], [0, 5]] },
                // Bedroom zone came back 40% smaller than planned.
                { id: 'zone-2', name: '主卧', polygon: [[5, 0], [8, 0], [8, 3], [5, 3]] },
              ],
            },
          }
        }
        return callMcp(name, args)
      },
      dedupeSharedWalls: async () => {},
    })
    expect(report.executionIssues.some(issue => issue.includes('偏差超过'))).toBe(true)
    const bedroom = report.rooms.find(room => room.planRoomId === 'bedroom-1')
    expect(bedroom?.builtAreaSqm).toBeCloseTo(9)
  })
})

describe('geometry helpers', () => {
  test('findHostWall matches the nearest wall containing the projection', () => {
    expect(findHostWall(twoRoomWalls, [5, 2.5])?.id).toBe('w-shared')
    expect(findHostWall(twoRoomWalls, [2.5, 0])?.id).toBe('w-a-bottom')
    // Off every wall line → null.
    expect(findHostWall(twoRoomWalls, [4, 2.5])).toBeNull()
    // Beyond a wall's extent → not that wall.
    expect(findHostWall([{ id: 'w', start: [0, 0], end: [1, 0] }], [3, 0])).toBeNull()
  })

  test('swingToward flips with the side of the wall the room center is on', () => {
    const wall: WallSegment = { id: 'w', start: [5, 0], end: [5, 5] }
    const left = swingToward(wall, [2.5, 2.5])
    const right = swingToward(wall, [7, 2.5])
    expect(left).not.toBe(right)
  })

  test('exteriorSegments returns footprint-boundary runs longest first', () => {
    const segments = exteriorSegments(twoRoomPlan.rooms[1]!, twoRoomPlan.footprint)
    expect(segments).toHaveLength(3)
    const lengths = segments.map(seg => Math.hypot(seg.end[0] - seg.start[0], seg.end[1] - seg.start[1]))
    expect(lengths[0]).toBeCloseTo(5) // right footprint edge
    expect(lengths[1]).toBeCloseTo(3)
  })
})
