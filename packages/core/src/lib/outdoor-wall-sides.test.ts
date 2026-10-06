import { describe, expect, test } from 'bun:test'
import { applyAgentOutcome } from '../agent-operations/apply-outcome'
import { AGENT_OPERATIONS, applySceneChanges } from '../agent-operations/index'
import { sceneViewPlan } from '../agent-operations/scene-view'
import { addWallOpening } from '../agent-operations/wall-opening'
import { facadeLoopTargets } from '../building/facade-scope'
import { doorFacing } from '../building/wall-openings'
import {
  type AnyNode,
  type AnyNodeId,
  generateId,
  LevelNode,
  SeparatorNode,
  WallNode,
  type ZoneNode,
} from '../schema'
import { reconcileSceneStructure } from './structure-reconcile'

/**
 * Run 4 (L66): the agent made the porch an outdoor room, so the house wall behind it had a room
 * on both faces and knew no outside. Its front door faced the house, view_scene showed its
 * "outside" from the hall, and the porch face took the inside finish. What goes wrong, written
 * first: a wall between a room and an outdoor room is interior on both faces; an indoor room
 * that only lost its ceiling, or a kitchen open to a terrace, turns outside; the answer depends on
 * the way the walls were drawn (each case runs both windings).
 */

type Point = [number, number]
type Nodes = Record<string, AnyNode>
const LEVEL = 'level_outdoor'

const reconcile = (nodes: Nodes) =>
  reconcileSceneStructure({ nodes, mintId: (kind) => generateId(kind) }).nodes as Nodes

function levelScene(): Nodes {
  const level = LevelNode.parse({ id: LEVEL, children: [] })
  return { [level.id]: level }
}

function createRoom(nodes: Nodes, input: Record<string, unknown>) {
  let after = nodes
  const result = applyAgentOutcome(
    AGENT_OPERATIONS.create_room(after, { levelId: LEVEL, ...input } as never, {
      activeLevelId: LEVEL,
    }),
    {
      getNodes: () => after,
      applyChanges: (changes) => {
        after = applySceneChanges(after, changes)
      },
      reconcile: () => {
        after = reconcile(after)
      },
    },
  ) as { zoneId: string; wallIds: (string | null)[] }
  return { nodes: after, ...result }
}

/** Walls and separators drawn by hand, then reconciled into rooms. */
function boundaries(
  nodes: Nodes,
  edges: { kind: 'wall' | 'separator'; start: Point; end: Point }[],
): Nodes {
  const next = { ...nodes }
  const level = next[LEVEL] as LevelNode
  const ids: string[] = []
  for (const { kind, start, end } of edges) {
    const node =
      kind === 'wall'
        ? WallNode.parse({ id: generateId('wall'), parentId: LEVEL, start, end, thickness: 0.2 })
        : SeparatorNode.parse({ id: generateId('separator'), parentId: LEVEL, start, end })
    next[node.id] = node
    ids.push(node.id)
  }
  next[LEVEL] = { ...level, children: [...level.children, ...ids] } as LevelNode
  return reconcile(next)
}

const zoneAt = (nodes: Nodes, point: Point) =>
  Object.values(nodes).find(
    (node): node is ZoneNode => node.type === 'zone' && inside(point, node.polygon as Point[]),
  )!

function inside([x, z]: Point, polygon: Point[]) {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!
    const [xj, zj] = polygon[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit
  }
  return hit
}

/** A ceiling taken off a room, as the editor's "remove ceiling" does. */
function withoutCeiling(nodes: Nodes, point: Point) {
  const zone = zoneAt(nodes, point)
  return reconcile({ ...nodes, [zone.id]: { ...zone, hasCeiling: false } as ZoneNode })
}

const wallOn = (nodes: Nodes, a: Point, b: Point) =>
  Object.values(nodes).find(
    (node): node is WallNode =>
      node.type === 'wall' &&
      [node.start, node.end].every((p) =>
        [a, b].some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6),
      ),
  )!

/** The wall's side toward a point: front is the +normal, perp(end - start) = (-dz, dx). */
function sideToward(wall: WallNode, [x, z]: Point) {
  const [mx, mz] = [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2]
  const [nx, nz] = [-(wall.end[1] - wall.start[1]), wall.end[0] - wall.start[0]]
  return (x - mx) * nx + (z - mz) * nz > 0 ? wall.frontSide : wall.backSide
}

/** Whether a door on the wall faces the point (its front, rotated by doorFacing). */
function doorFaces(wall: WallNode, [x, z]: Point) {
  const { rotation } = doorFacing(wall)
  const sign = Math.abs(rotation[1]) > Math.PI / 2 ? -1 : 1
  const [mx, mz] = [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2]
  const [nx, nz] = [-(wall.end[1] - wall.start[1]) * sign, (wall.end[0] - wall.start[0]) * sign]
  return (x - mx) * nx + (z - mz) * nz > 0
}

const ccw = (points: Point[]) => points
const cw = (points: Point[]) => [points[0]!, ...points.slice(1).reverse()]

for (const [winding, order] of [
  ['counter-clockwise', ccw],
  ['clockwise', cw],
] as const) {
  describe(`outdoor rooms, house drawn ${winding}`, () => {
    test("a porch's wall is outside on the porch face: the door faces it, the facade fills it", () => {
      const house = createRoom(levelScene(), {
        name: 'Living',
        polygon: order([
          [0, 0],
          [6, 0],
          [6, 5],
          [0, 5],
        ]),
      })
      const { nodes } = createRoom(house.nodes, {
        name: 'Porch',
        outdoor: true,
        polygon: [
          [1, 5],
          [4, 5],
          [4, 7],
          [1, 7],
        ],
      })
      const wall = wallOn(nodes, [0, 5], [6, 5])
      expect(sideToward(wall, [3, 6])).toBe('exterior')
      expect(sideToward(wall, [3, 2])).toBe('interior')
      expect(doorFaces(wall, [3, 6])).toBe(true)
      const street = wallOn(nodes, [0, 0], [6, 0])
      expect([sideToward(street, [3, -1]), sideToward(street, [3, 1])]).toEqual([
        'exterior',
        'interior',
      ])
      const { targets } = facadeLoopTargets(nodes as Record<AnyNodeId, AnyNode>, street, 'exterior')
      const porchFace = sideToward(wall, [3, 6]) === wall.frontSide ? 'front' : 'back'
      expect(targets[wall.id]).toEqual({ surface: 'exterior', face: porchFace })
      // add_door's placement on every surface, and view_scene's close-up from the door's outside.
      const door = addWallOpening(nodes, { kind: 'door', wallId: wall.id, t: 0.5, style: 'modern' })
      const withDoor = applySceneChanges(nodes, door.changes)
      const { pose } = sceneViewPlan(withDoor, { target: door.result.doorId })
      expect(pose.position[2]).toBeGreaterThan(5)
    })

    // Held out: not tuned on run 4's porch.
    test("an alfresco in an L's inside corner is outside on both house walls", () => {
      const house = createRoom(levelScene(), {
        name: 'House',
        polygon: order([
          [0, 0],
          [8, 0],
          [8, 4],
          [4, 4],
          [4, 8],
          [0, 8],
        ]),
      })
      const { nodes } = createRoom(house.nodes, {
        name: 'Alfresco',
        outdoor: true,
        polygon: [
          [4, 4],
          [8, 4],
          [8, 8],
          [4, 8],
        ],
      })
      for (const [a, b] of [
        [
          [4, 4],
          [8, 4],
        ],
        [
          [4, 4],
          [4, 8],
        ],
      ] as [Point, Point][]) {
        const wall = wallOn(nodes, a, b)
        expect(sideToward(wall, [6, 6])).toBe('exterior')
        expect(doorFaces(wall, [6, 6])).toBe(true)
      }
    })

    test('a room that only lost its ceiling keeps its inside faces', () => {
      const living = createRoom(levelScene(), {
        name: 'Living',
        polygon: order([
          [0, 0],
          [6, 0],
          [6, 5],
          [0, 5],
        ]),
      })
      const nodes = withoutCeiling(living.nodes, [3, 2])
      expect(zoneAt(nodes, [3, 2]).hasCeiling).toBe(false)
      const wall = wallOn(nodes, [0, 5], [6, 5])
      expect([sideToward(wall, [3, 2]), sideToward(wall, [3, 6])]).toEqual(['interior', 'exterior'])
    })

    // A limit, written down so a later rule shows here: a courtyard walled on every side, with no
    // separator out, reads as a room open to the sky, not as outside.
    test('a courtyard walled on every side stays inside', () => {
      const house = createRoom(levelScene(), {
        name: 'Living',
        polygon: order([
          [0, 0],
          [6, 0],
          [6, 5],
          [0, 5],
        ]),
      })
      const court = createRoom(house.nodes, {
        name: 'Courtyard',
        polygon: order([
          [6, 0],
          [9, 0],
          [9, 5],
          [6, 5],
        ]),
      })
      const nodes = withoutCeiling(court.nodes, [7.5, 2.5])
      expect(zoneAt(nodes, [7.5, 2.5]).hasCeiling).toBe(false)
      const wall = wallOn(nodes, [6, 0], [6, 5])
      expect([sideToward(wall, [3, 2]), sideToward(wall, [7.5, 2.5])]).toEqual([
        'interior',
        'interior',
      ])
    })

    test('a kitchen with a ceiling, open to a terrace, stays inside', () => {
      const kitchen = order([
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ])
      const edges = kitchen.map((start, i) => ({ start, end: kitchen[(i + 1) % 4]! }))
      const open = (e: { start: Point; end: Point }) => e.start[1] === 4 && e.end[1] === 4
      let nodes = boundaries(
        levelScene(),
        edges.map((e) => ({ kind: open(e) ? 'separator' : 'wall', ...e })),
      )
      nodes = createRoom(nodes, {
        name: 'Terrace',
        outdoor: true,
        polygon: [
          [0, 4],
          [4, 4],
          [4, 7],
          [0, 7],
        ],
      }).nodes
      expect(zoneAt(nodes, [2, 2]).hasCeiling).not.toBe(false)
      expect(zoneAt(nodes, [2, 6]).hasCeiling).toBe(false)
      const wall = wallOn(nodes, [4, 0], [4, 4])
      expect([sideToward(wall, [2, 2]), sideToward(wall, [5, 2])]).toEqual(['interior', 'exterior'])
    })

    // What a carport does, written down: a garage without a ceiling and with an open side is
    // outside, so its walls are exterior on the carport faces, and the house wall it leans on is
    // exterior on that face too.
    test('a carport, a garage open on one side without a ceiling, is outside', () => {
      const house = createRoom(levelScene(), {
        name: 'Living',
        polygon: order([
          [0, 0],
          [6, 0],
          [6, 5],
          [0, 5],
        ]),
      })
      let nodes = boundaries(house.nodes, [
        { kind: 'wall', start: [6, 0], end: [9, 0] },
        { kind: 'wall', start: [6, 5], end: [9, 5] },
        { kind: 'separator', start: [9, 0], end: [9, 5] },
      ])
      nodes = withoutCeiling(nodes, [7.5, 2.5])
      expect(zoneAt(nodes, [7.5, 2.5]).hasCeiling).toBe(false)
      const shared = wallOn(nodes, [6, 0], [6, 5])
      expect([sideToward(shared, [3, 2]), sideToward(shared, [7.5, 2.5])]).toEqual([
        'interior',
        'exterior',
      ])
      const side = wallOn(nodes, [6, 0], [9, 0])
      expect([sideToward(side, [7.5, 2.5]), sideToward(side, [7.5, -1])]).toEqual([
        'exterior',
        'exterior',
      ])
    })
  })
}
