import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  generateId,
  LevelNode,
  railingWallDefaults,
  WallNode,
  type ZoneNode,
} from '../schema'
import { railingFencedRoomIds } from './railing-rooms'
import type { BoundarySpan } from './room-topology-index'
import { reconcileSceneStructure } from './structure-reconcile'

type Point = [number, number]
type Nodes = Record<string, AnyNode>
const LEVEL = 'level_railing'

const span = (roomId: string, boundaryId: string, face: 'a' | 'b', t0 = 0, t1 = 1) =>
  ({ roomId, boundaryId, kind: 'wall', face, t0, t1 }) satisfies BoundarySpan

/** Walls drawn by hand (a railing where `railing` is set), reconciled into rooms. */
function drawn(edges: { start: Point; end: Point; railing?: boolean }[]): Nodes {
  const level = LevelNode.parse({ id: LEVEL, children: [] })
  const nodes: Nodes = {}
  for (const { start, end, railing } of edges) {
    const wall = WallNode.parse({
      id: generateId('wall'),
      parentId: LEVEL,
      start,
      end,
      thickness: 0.2,
      ...(railing ? railingWallDefaults() : {}),
    })
    nodes[wall.id] = wall
    level.children.push(wall.id)
  }
  nodes[level.id] = level
  return reconcileSceneStructure({ nodes, mintId: (kind) => generateId(kind) }).nodes as Nodes
}

const ring = (corners: Point[], railing = false) =>
  corners.map((start, index) => ({ start, end: corners[(index + 1) % corners.length]!, railing }))

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

describe('rooms a railing fences', () => {
  test('a room is fenced where nothing stands behind some stretch of its railing', () => {
    const railings = new Set(['wall_rail'])
    expect(railingFencedRoomIds([span('deck', 'wall_rail', 'a')], railings)).toEqual(
      new Set(['deck']),
    )
    // A room behind the whole railing (round a stair well) leaves both inside…
    expect(
      railingFencedRoomIds(
        [span('hall', 'wall_rail', 'a'), span('well', 'wall_rail', 'b')],
        railings,
      ),
    ).toEqual(new Set())
    // …a room behind only part of it does not.
    expect(
      railingFencedRoomIds(
        [span('deck', 'wall_rail', 'a'), span('nook', 'wall_rail', 'b', 0, 0.5)],
        railings,
      ),
    ).toEqual(new Set(['deck']))
    // A solid wall fences nothing.
    expect(railingFencedRoomIds([span('hall', 'wall_solid', 'a')], railings)).toEqual(new Set())
  })

  test("a deck fenced by railings off the house is outside: the house wall's deck face is exterior", () => {
    const nodes = drawn([
      ...ring([
        [0, 0],
        [6, 0],
        [6, 5],
        [0, 5],
      ]),
      { start: [1, 5], end: [1, 7], railing: true },
      { start: [1, 7], end: [4, 7], railing: true },
      { start: [4, 7], end: [4, 5], railing: true },
    ])
    const zones = Object.values(nodes).filter((node): node is ZoneNode => node.type === 'zone')
    expect(zones).toHaveLength(2)
    const house = wallOn(nodes, [6, 5], [0, 5])
    expect(sideToward(house, [2.5, 6])).toBe('exterior')
    expect(sideToward(house, [3, 2])).toBe('interior')
    const guard = wallOn(nodes, [1, 7], [4, 7])
    expect([guard.frontSide, guard.backSide]).toEqual(['exterior', 'exterior'])
  })

  test('a railing round a stair well inside a room leaves the room inside', () => {
    const nodes = drawn([
      ...ring([
        [0, 0],
        [8, 0],
        [8, 6],
        [0, 6],
      ]),
      ...ring(
        [
          [3, 2],
          [5, 2],
          [5, 4],
          [3, 4],
        ],
        true,
      ),
    ])
    const outer = wallOn(nodes, [0, 0], [8, 0])
    expect(sideToward(outer, [4, 1])).toBe('interior')
    const guard = wallOn(nodes, [3, 2], [5, 2])
    expect([guard.frontSide, guard.backSide]).toEqual(['interior', 'interior'])
  })
})
