import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  CeilingNode,
  mergeQuantityRows,
  type QuantityContext,
  SlabNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { ceilingQuantities } from '../ceiling/quantities'
import { slabQuantities } from '../slab/quantities'
import { wallQuantities } from '../wall/quantities'
import { zoneQuantities } from '../zone/quantities'
import { countQuantities } from './count-quantities'
import { planPolygonArea, planPolygonNetArea, planPolygonPerimeter } from './plan-polygon-area'

const ctx: QuantityContext = { nodes: {} as Record<AnyNodeId, AnyNode> }

const lineFor = (
  contribution: { rows: Array<{ key: string; value: number; group?: string }> } | null,
  key: string,
  group?: string,
) =>
  mergeQuantityRows((contribution?.rows ?? []) as never).find(
    (line) => line.key === key && (group === undefined || line.group === group),
  )

const SQUARE: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]

describe('planPolygonArea', () => {
  test('measures a square', () => {
    expect(planPolygonArea(SQUARE)).toBe(16)
  })

  test('is winding-independent — a takeoff cannot depend on trace direction', () => {
    expect(planPolygonArea([...SQUARE].reverse())).toBe(16)
  })

  test('a degenerate polygon has no area', () => {
    expect(planPolygonArea([[0, 0]])).toBe(0)
    expect(
      planPolygonArea([
        [0, 0],
        [1, 1],
      ]),
    ).toBe(0)
  })

  test('holes subtract, and cannot drive the area negative', () => {
    const hole: Array<[number, number]> = [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ]
    expect(planPolygonNetArea(SQUARE, [hole])).toBe(12)
    expect(planPolygonNetArea(hole, [SQUARE])).toBe(0)
  })

  test('perimeter closes the ring', () => {
    expect(planPolygonPerimeter(SQUARE)).toBe(16)
  })
})

describe('wallQuantities', () => {
  const wall = (patch: Partial<WallNode> = {}) =>
    WallNode.parse({ start: [0, 0], end: [5, 0], height: 3, thickness: 0.2, ...patch })

  test('reports centreline length, both faces, and volume', () => {
    const contribution = wallQuantities([wall()], ctx)

    expect(lineFor(contribution, 'length')?.value).toBeCloseTo(5, 6)
    // Both sides get painted, so the face area counts both.
    expect(lineFor(contribution, 'face-area')?.value).toBeCloseTo(30, 6)
    expect(lineFor(contribution, 'volume')?.value).toBeCloseTo(3, 6)
  })

  test('sums across walls and remembers how many fed the total', () => {
    const contribution = wallQuantities([wall(), wall({ end: [3, 0] })], ctx)
    const length = lineFor(contribution, 'length')

    expect(length?.value).toBeCloseTo(8, 6)
    expect(length?.nodeCount).toBe(2)
  })

  test('no walls means no section at all', () => {
    expect(wallQuantities([], ctx)).toBeNull()
  })
})

describe('slabQuantities', () => {
  const slab = (patch: Partial<SlabNode> = {}) =>
    SlabNode.parse({ polygon: SQUARE, thickness: 0.2, ...patch })

  test('reports surface, perimeter and poured volume', () => {
    const contribution = slabQuantities([slab()], ctx)

    expect(lineFor(contribution, 'area')?.value).toBe(16)
    expect(lineFor(contribution, 'perimeter')?.value).toBe(16)
    expect(lineFor(contribution, 'volume')?.value).toBeCloseTo(3.2, 6)
  })

  test('a hole is concrete nobody pours — it leaves both area and volume', () => {
    const holed = slab({
      holes: [
        [
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
        ],
      ],
    })
    const contribution = slabQuantities([holed], ctx)

    expect(lineFor(contribution, 'area')?.value).toBe(12)
    expect(lineFor(contribution, 'volume')?.value).toBeCloseTo(2.4, 6)
  })

  test('a degenerate slab contributes nothing rather than a zero row', () => {
    expect(slabQuantities([slab({ polygon: [[0, 0]] })], ctx)).toBeNull()
  })
})

describe('ceilingQuantities', () => {
  test('reports surface and perimeter', () => {
    const contribution = ceilingQuantities([CeilingNode.parse({ polygon: SQUARE })], ctx)

    expect(lineFor(contribution, 'area')?.value).toBe(16)
    expect(lineFor(contribution, 'perimeter')?.value).toBe(16)
  })
})

describe('zoneQuantities', () => {
  test('splits per room so the panel reads as a room schedule', () => {
    const contribution = zoneQuantities(
      [
        ZoneNode.parse({ polygon: SQUARE, name: 'Kitchen', ceilingHeight: 2.7 }),
        ZoneNode.parse({ polygon: SQUARE, name: 'Bedroom', ceilingHeight: 3 }),
      ],
      ctx,
    )

    expect(lineFor(contribution, 'area', 'Kitchen')?.value).toBe(16)
    expect(lineFor(contribution, 'volume', 'Kitchen')?.value).toBeCloseTo(43.2, 6)
    expect(lineFor(contribution, 'volume', 'Bedroom')?.value).toBeCloseTo(48, 6)
  })

  test('a blank name still gets a line rather than an empty group', () => {
    const contribution = zoneQuantities([ZoneNode.parse({ polygon: SQUARE, name: '  ' })], ctx)
    expect(lineFor(contribution, 'area', 'Unnamed zone')?.value).toBe(16)
  })
})

describe('countQuantities', () => {
  const item = (id: string, kind: string) =>
    ({ object: 'node', id, type: 'door', metadata: {}, doorType: kind }) as unknown as AnyNode

  test('tallies without grouping', () => {
    const contribution = countQuantities('Doors')([item('a', 'hinged'), item('b', 'sliding')], ctx)
    expect(lineFor(contribution, 'count')?.value).toBe(2)
  })

  test('splits the tally when a group is supplied', () => {
    const contribution = countQuantities<AnyNode>(
      'Doors',
      (node) => (node as unknown as { doorType: string }).doorType,
    )([item('a', 'hinged'), item('b', 'hinged'), item('c', 'sliding')], ctx)

    expect(lineFor(contribution, 'count', 'hinged')?.value).toBe(2)
    expect(lineFor(contribution, 'count', 'sliding')?.value).toBe(1)
  })

  test('nothing to count means no section', () => {
    expect(countQuantities('Doors')([], ctx)).toBeNull()
  })
})
