import { describe, expect, test } from 'bun:test'
import { healSceneNodes, healScenePlanCoordinates } from './scene-migrations'

const ring = [
  [1, 2],
  [4, 2],
  [4, 6],
]
const wallCases = [
  { start: { x: 1, z: 2 }, end: { x: 4, z: 6 } },
  { start: { x: 1, y: 9, z: 2 }, end: { x: 4, y: 9, z: 6 } },
  { start: { x: 1, y: 2 }, end: { x: 4, y: 6 }, height: 3 },
  { start: [1, 9, 2], end: [4, 9, 6] },
  {
    points: [
      [1, 2],
      [4, 6],
    ],
  },
]

describe('healScenePlanCoordinates', () => {
  test.each(wallCases)('normalizes wall endpoints: %j', (geometry) => {
    const node = { type: 'wall', ...geometry, children: ['door_a'], metadata: { retained: true } }
    const input = { wall_a: node }
    const snapshot = structuredClone(input)
    const healed = healScenePlanCoordinates(input)
    expect(healed.wall_a).toEqual({ ...node, start: [1, 2], end: [4, 6] })
    expect(input).toEqual(snapshot)
    expect(healScenePlanCoordinates(healed)).toBe(healed)
  })

  test.each([
    { polygon: { points: ring } },
    { polygon: { type: 'polygon', points: ring } },
    { polygon: [ring] },
    { polygon: { points: [ring] } },
    { points: ring },
    { vertices: ring },
    { polygon: ring.map(([x, z]) => ({ x, z })) },
    { points: ring.map(([x, y]) => ({ x, y })), thickness: 0.25 },
    { polygon: ring.map(([x, z]) => [x, 9, z]) },
  ])('recovers a slab ring: %j', (geometry) => {
    const node = { type: 'slab', ...geometry, holes: [], parentId: 'level_a' }
    const input = { slab_a: node }
    const snapshot = structuredClone(input)
    const healed = healScenePlanCoordinates(input)
    expect(healed.slab_a).toEqual({ ...node, polygon: ring })
    expect(input).toEqual(snapshot)
    expect(healScenePlanCoordinates(healed)).toBe(healed)
  })

  test.each([
    { type: 'wall', start: { x: 1, y: 2 }, end: { x: 4, y: 6 } },
    { type: 'wall', start: { x: 1, z: '2' }, end: [4, 6], height: 3 },
    { type: 'wall', start: { x: 1, y: 2, z: null }, end: [4, 6], height: 3 },
    { type: 'wall', start: [1, Number.NaN, 2], end: [4, 9, 6] },
    { type: 'wall', start: [1, 2], end: [4, Number.POSITIVE_INFINITY] },
    { type: 'wall', points: ring },
    {
      type: 'wall',
      start: null,
      points: [
        [1, 2],
        [4, 6],
      ],
    },
    { type: 'slab', polygon: { coordinates: ring } },
    { type: 'slab', polygon: [ring, ring] },
    { type: 'slab', polygon: [[ring]] },
    { type: 'slab', polygon: ring.map(([x, y]) => ({ x, y })) },
    {
      type: 'slab',
      polygon: [
        [1, 2],
        [4, 6],
      ],
    },
    { type: 'slab', polygon: null, points: ring },
    {
      type: 'slab',
      polygon: [
        [1, 2],
        [4, 6],
        [7, '8'],
      ],
    },
    { type: 'item', start: { x: 1, z: 2 }, end: { x: 4, z: 6 } },
  ])('leaves unknown or ambiguous shapes untouched: %j', (node) => {
    const input = { node }
    expect(healScenePlanCoordinates(input)).toBe(input)
  })

  test('preserves canonical nodes and unrelated fields by reference', () => {
    const input = {
      wall_a: { type: 'wall', start: [1, 2], end: [4, 6] },
      slab_a: { type: 'slab', polygon: ring, elevation: 0.1 },
      unknown: null,
    }
    expect(healScenePlanCoordinates(input)).toBe(input)
  })

  test('the loader heal normalizes 3D endpoints before checking zero length', () => {
    const input = { wall_a: { type: 'wall', start: [1, 0, 2], end: [1, 0, 6] } }
    const healed = healSceneNodes(input)
    expect(healed.nodes.wall_a).toEqual({ type: 'wall', start: [1, 2], end: [1, 6] })
    expect(healed.droppedWallIds).toEqual([])
    expect(healed.repairedCoordinates).toBe(1)
    expect(healSceneNodes(healed.nodes)).toEqual({ ...healed, repairedCoordinates: 0 })
  })

  test('reports repaired nodes once each for coordinate-only changes', () => {
    const input = {
      wall_a: { type: 'wall', start: { x: 1, z: 2 }, end: { x: 4, z: 6 } },
      slab_a: { type: 'slab', polygon: { points: ring } },
      wall_b: { type: 'wall', start: [0, 0], end: [1, 0] },
    }
    const healed = healSceneNodes(input)
    expect(healed).toMatchObject({
      repairedCoordinates: 2,
      droppedWallIds: [],
      strippedChildRefs: 0,
      strippedStaleChildRefs: 0,
      repairedParentLinkNodeIds: [],
    })
    expect(healSceneNodes(healed.nodes)).toEqual({ ...healed, repairedCoordinates: 0 })
  })

  test('does not report coordinate repairs for unknown representations', () => {
    const input = { wall_a: { type: 'wall', start: { u: 1, v: 2 }, end: { u: 4, v: 6 } } }
    expect(healSceneNodes(input).repairedCoordinates).toBe(0)
  })
})
