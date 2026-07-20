import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  DoorNode,
  type GeometryContext,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import {
  buildLevelWallConstructionDimensionPlan,
  buildWallConstructionDimensions,
  formatConstructionLength,
  renderPlannedConstructionDimensions,
} from './construction-dimensions'

function wall(overrides: Partial<WallNode> = {}) {
  return WallNode.parse({
    id: 'wall_main',
    parentId: 'level_main',
    start: [0, 0],
    end: [10, 0],
    thickness: 0.2,
    frontSide: 'exterior',
    backSide: 'interior',
    ...overrides,
  })
}

function context(
  children: GeometryContext['children'] = [],
  siblings: GeometryContext['siblings'] = [],
) {
  return {
    resolve: () => undefined,
    children,
    siblings,
    parent: null,
  } satisfies GeometryContext
}

describe('formatConstructionLength', () => {
  test('formats U.S. architectural feet, inches, and reduced sixteenths', () => {
    expect(formatConstructionLength(12 * 0.3048, 'imperial')).toBe(`12'-0"`)
    expect(formatConstructionLength((7 * 12 + 5.5) * 0.0254, 'imperial')).toBe(`7'-5 1/2"`)
    expect(formatConstructionLength((2 * 12 + 3.1875) * 0.0254, 'imperial')).toBe(`2'-3 3/16"`)
  })

  test('rounds to the nearest sixteenth and carries into the next foot', () => {
    expect(formatConstructionLength((11 + 0.99) * 0.0254, 'imperial')).toBe(`1'-0"`)
    expect(formatConstructionLength(-0.5 * 0.0254, 'imperial')).toBe(`-0 1/2"`)
  })

  test('keeps metric output concise', () => {
    expect(formatConstructionLength(3.456, 'metric')).toBe('3.46m')
    expect(formatConstructionLength(Number.NaN, 'metric')).toBe('--')
  })
})

describe('buildWallConstructionDimensions', () => {
  test('builds a jamb-by-jamb chain plus a farther wall span', () => {
    const door = DoorNode.parse({
      id: 'door_entry',
      parentId: 'wall_main',
      position: [2, 1.05, 0],
      width: 1,
    })
    const window = WindowNode.parse({
      id: 'window_front',
      parentId: 'wall_main',
      position: [6, 1.5, 0],
      width: 2,
    })

    const dimensions = buildWallConstructionDimensions(wall(), context([door, window]), {
      unit: 'metric',
    })

    expect(dimensions).toHaveLength(6)
    expect(dimensions.map((entry) => entry.kind)).toEqual(Array(6).fill('dimension'))
    expect(dimensions.map((entry) => (entry.kind === 'dimension' ? entry.text : null))).toEqual([
      '1.5m',
      '1m',
      '2.5m',
      '2m',
      '3m',
      '10m',
    ])
    expect(dimensions.at(-1)).toMatchObject({
      kind: 'dimension',
      offsetNormal: [0, 1],
      offsetDistance: 0.82,
    })
  })

  test('uses the exterior wall face as the dimension side', () => {
    const dimensions = buildWallConstructionDimensions(
      wall({ frontSide: 'interior', backSide: 'exterior' }),
      context(),
      { unit: 'metric' },
    )

    expect(dimensions).toHaveLength(1)
    expect(dimensions[0]).toMatchObject({
      kind: 'dimension',
      offsetNormal: [0, -1],
      start: [0, -0.1],
      end: [10, -0.1],
    })
  })

  test('never dimensions a classified interior wall', () => {
    const interior = wall({ frontSide: 'interior', backSide: 'interior' })
    expect(buildWallConstructionDimensions(interior, context(), { unit: 'metric' })).toEqual([])
  })

  test('does not invent straight strings for curved walls', () => {
    expect(
      buildWallConstructionDimensions(wall({ curveOffset: 1 }), context(), { unit: 'metric' }),
    ).toEqual([])
  })
})

describe('buildLevelWallConstructionDimensionPlan', () => {
  test('coordinates opening widths, centers, partition references, and overall extent', () => {
    const exterior = wall()
    const partition = wall({
      id: 'wall_partition',
      start: [4, 0],
      end: [4, -4],
      frontSide: 'interior',
      backSide: 'interior',
    })
    const door = DoorNode.parse({
      id: 'door_entry',
      parentId: exterior.id,
      position: [2, 1.05, 0],
      width: 1,
    })
    const window = WindowNode.parse({
      id: 'window_front',
      parentId: exterior.id,
      position: [6, 1.5, 0],
      width: 2,
    })
    const nodes = { [door.id]: door, [window.id]: window } satisfies Record<string, AnyNode>

    const plan = buildLevelWallConstructionDimensionPlan([exterior, partition], nodes)
    const planned = plan.get(exterior.id)
    const exteriorPlanned = planned ?? []
    expect(exteriorPlanned.map((entry) => entry.tier)).toEqual([
      'opening-widths',
      'opening-widths',
      'openings',
      'openings',
      'openings',
      'partitions',
      'partitions',
      'overall',
    ])
    expect(exteriorPlanned.map((entry) => entry.offsetDistance)).toEqual([
      0.18, 0.18, 0.45, 0.45, 0.45, 0.93, 0.93, 1.41,
    ])
    expect(
      renderPlannedConstructionDimensions(exteriorPlanned, 'metric').map((entry) =>
        entry.kind === 'dimension' ? entry.text : null,
      ),
    ).toEqual(['1m', '2m', '2m', '4m', '4m', '4m', '6m', '10m'])
    expect(exteriorPlanned.at(-1)).toMatchObject({
      start: [0, 0.1],
      end: [10, 0.1],
      offsetNormal: [0, 1],
    })
  })

  test('combines collinear exterior wall segments into one facade run', () => {
    const first = wall({ id: 'wall_a', end: [5, 0] })
    const second = wall({ id: 'wall_b', start: [5, 0] })
    const opening = WindowNode.parse({
      id: 'window_b',
      parentId: second.id,
      position: [2, 1.5, 0],
      width: 1,
    })

    const plan = buildLevelWallConstructionDimensionPlan([second, first], { [opening.id]: opening })
    const exteriorPlanned = plan.get(first.id) ?? []

    expect([...plan.keys()]).toEqual([first.id])
    expect(
      renderPlannedConstructionDimensions(exteriorPlanned, 'metric').map((entry) =>
        entry.kind === 'dimension' ? entry.text : null,
      ),
    ).toEqual(['1m', '7m', '3m', '10m'])
  })

  test('omits interior measurements from the level plan', () => {
    const exterior = wall()
    const partition = wall({
      id: 'wall_partition',
      start: [4, 0],
      end: [4, -4],
      frontSide: 'interior',
      backSide: 'interior',
    })

    const plan = buildLevelWallConstructionDimensionPlan([exterior, partition], {})
    const tiers = [...plan.values()].flat().map((entry) => entry.tier)

    expect(tiers).toEqual(['partitions', 'partitions', 'overall'])
    expect(tiers).not.toContain('interior')
  })

  test('keeps disconnected collinear facade runs independent', () => {
    const first = wall({ id: 'wall_a', end: [4, 0] })
    const second = wall({ id: 'wall_b', start: [8, 0], end: [12, 0] })
    const firstPartition = wall({
      id: 'wall_partition_a',
      start: [2, 0],
      end: [2, -2],
      frontSide: 'interior',
      backSide: 'interior',
    })
    const secondPartition = wall({
      id: 'wall_partition_b',
      start: [10, 0],
      end: [10, -2],
      frontSide: 'interior',
      backSide: 'interior',
    })

    const plan = buildLevelWallConstructionDimensionPlan(
      [first, second, firstPartition, secondPartition],
      {},
    )

    expect([...plan.keys()]).toEqual([first.id, second.id])
    expect(plan.get(first.id)?.find((entry) => entry.tier === 'overall')).toMatchObject({
      start: [0, 0.1],
      end: [4, 0.1],
    })
    expect(plan.get(second.id)?.find((entry) => entry.tier === 'overall')).toMatchObject({
      start: [8, 0.1],
      end: [12, 0.1],
    })
  })

  test('places a back-side exterior facade beyond the back face', () => {
    const exterior = wall({ frontSide: 'interior', backSide: 'exterior' })
    const planned = buildLevelWallConstructionDimensionPlan([exterior], {}).get(exterior.id)

    expect(planned?.find((entry) => entry.tier === 'overall')).toMatchObject({
      start: [10, -0.1],
      end: [0, -0.1],
      offsetNormal: [0, -1],
      offsetDistance: 1.41,
    })
  })

  test('does not automatically dimension walls without an exterior classification', () => {
    const plan = buildLevelWallConstructionDimensionPlan(
      [wall({ frontSide: 'interior', backSide: 'interior' })],
      {},
    )

    expect(plan.size).toBe(0)
  })
})
