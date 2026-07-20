import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  ColumnNode,
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
    expect(exteriorPlanned.map((entry) => Number(entry.offsetDistance.toFixed(2)))).toEqual([
      0.18, 0.18, 0.66, 0.66, 0.66, 1.14, 1.14, 1.62,
    ])
    expect(
      renderPlannedConstructionDimensions(exteriorPlanned, 'metric').map((entry) =>
        entry.kind === 'dimension' ? entry.text : null,
      ),
    ).toEqual(['1m', '2m', '2m', '4m', '4m', '3.9m', '6.1m', '10m'])
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
    const planned = [...plan.values()].flat()
    const tiers = planned.map((entry) => entry.tier)

    expect(tiers).toEqual(['partitions', 'partitions', 'overall'])
    expect(tiers).not.toContain('interior')
    expect(planned.map((entry) => Number(entry.offsetDistance.toFixed(2)))).toEqual([
      0.45, 0.45, 0.93,
    ])
  })

  test('locates partitions from a consistent face of stud', () => {
    const exterior = wall()
    const thinPartition = wall({
      id: 'wall_partition_thin',
      start: [3, 0],
      end: [3, -3],
      thickness: 0.1,
      frontSide: 'interior',
      backSide: 'interior',
    })
    const thickPartition = wall({
      id: 'wall_partition_thick',
      start: [7, 0],
      end: [7, -3],
      thickness: 0.4,
      frontSide: 'interior',
      backSide: 'interior',
    })

    const planned =
      buildLevelWallConstructionDimensionPlan([exterior, thinPartition, thickPartition], {}).get(
        exterior.id,
      ) ?? []

    expect(
      renderPlannedConstructionDimensions(
        planned.filter((entry) => entry.tier === 'partitions'),
        'metric',
      ).map((entry) => (entry.kind === 'dimension' ? entry.text : null)),
    ).toEqual(['2.95m', '3.85m', '3.2m'])
  })

  test('chains stepped facade projections on one exterior baseline', () => {
    const lower = wall({ id: 'wall_lower', end: [4, 0] })
    const step = wall({
      id: 'wall_step',
      start: [4, 0],
      end: [4, 1],
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const upper = wall({ id: 'wall_upper', start: [4, 1], end: [10, 1] })

    const planned =
      buildLevelWallConstructionDimensionPlan([lower, step, upper], {}).get(lower.id) ?? []
    const rendered = renderPlannedConstructionDimensions(planned, 'metric')

    expect(planned.map((entry) => entry.tier)).toEqual(['jogs', 'jogs', 'overall'])
    expect(rendered.map((entry) => (entry.kind === 'dimension' ? entry.text : null))).toEqual([
      '4m',
      '6m',
      '10m',
    ])
    expect(planned.filter((entry) => entry.tier === 'jogs')).toEqual([
      expect.objectContaining({
        start: [0, 0.1],
        end: [4, 1.1],
        dimensionStart: [0, 1.55],
        dimensionEnd: [4, 1.55],
      }),
      expect.objectContaining({
        start: [4, 1.1],
        end: [10, 1.1],
        dimensionStart: [4, 1.55],
        dimensionEnd: [10, 1.55],
      }),
    ])
  })

  test('dimensions an exterior column row by structural centerline', () => {
    const top = wall({ id: 'wall_top' })
    const right = wall({
      id: 'wall_right',
      start: [10, 0],
      end: [10, -6],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const bottom = wall({
      id: 'wall_bottom',
      start: [10, -6],
      end: [0, -6],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const left = wall({
      id: 'wall_left',
      start: [0, -6],
      end: [0, 0],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const columns = [-1, 5, 11].map((x, index) =>
      ColumnNode.parse({
        id: `column_${index}`,
        parentId: 'level_main',
        position: [x, 0, 2],
        crossSection: 'square',
      }),
    )
    const nodes = Object.fromEntries(columns.map((column) => [column.id, column]))

    const plan = buildLevelWallConstructionDimensionPlan([top, right, bottom, left], nodes)
    const planned = plan.get(top.id) ?? []

    expect(plan.size).toBe(4)
    expect(planned.map((entry) => entry.tier)).toEqual([
      'structure',
      'structure',
      'overall',
      'structural-overall',
    ])
    expect(
      renderPlannedConstructionDimensions(planned, 'metric').map((entry) =>
        entry.kind === 'dimension' ? entry.text : null,
      ),
    ).toEqual(['6m', '6m', '10m', '12m'])
    expect(planned[0]).toMatchObject({
      start: [-1, 2],
      end: [5, 2],
    })
    expect(planned[0]?.dimensionStart?.[0]).toBe(-1)
    expect(planned[0]?.dimensionEnd?.[0]).toBe(5)
    expect(planned[0]?.dimensionStart?.[1]).toBeCloseTo(2.7712)
    expect(planned[0]?.dimensionEnd?.[1]).toBeCloseTo(2.7712)
  })

  test('does not stretch interior column references to an exterior dimension string', () => {
    const top = wall({ id: 'wall_top' })
    const right = wall({
      id: 'wall_right',
      start: [10, 0],
      end: [10, -6],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const bottom = wall({
      id: 'wall_bottom',
      start: [10, -6],
      end: [0, -6],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const left = wall({
      id: 'wall_left',
      start: [0, -6],
      end: [0, 0],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const columns = [2, 8].map((x, index) =>
      ColumnNode.parse({
        id: `column_interior_${index}`,
        parentId: 'level_main',
        position: [x, 0, -2],
        crossSection: 'square',
      }),
    )
    const nodes = Object.fromEntries(columns.map((column) => [column.id, column]))

    const planned =
      buildLevelWallConstructionDimensionPlan([top, right, bottom, left], nodes).get(top.id) ?? []

    expect(planned.map((entry) => entry.tier)).toEqual(['overall'])
  })

  test('does not stretch interior doors or windows to exterior opening strings', () => {
    const top = wall({ id: 'wall_top' })
    const right = wall({
      id: 'wall_right',
      start: [10, 0],
      end: [10, -6],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const bottom = wall({
      id: 'wall_bottom',
      start: [10, -6],
      end: [0, -6],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const left = wall({
      id: 'wall_left',
      start: [0, -6],
      end: [0, 0],
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const interiorDoorWall = wall({
      id: 'wall_interior_door',
      start: [4, -2],
      end: [10, -2],
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const door = DoorNode.parse({
      id: 'door_interior',
      parentId: interiorDoorWall.id,
      position: [3, 1.05, 0],
      width: 1,
    })
    const window = WindowNode.parse({
      id: 'window_interior',
      parentId: interiorDoorWall.id,
      position: [1.5, 1.2, 0],
      width: 1,
    })

    const plan = buildLevelWallConstructionDimensionPlan(
      [top, right, bottom, left, interiorDoorWall],
      { [door.id]: door, [window.id]: window },
    )
    const bottomDimensions = plan.get(bottom.id) ?? []

    expect(bottomDimensions.map((entry) => entry.tier)).toEqual(['overall'])
    expect(plan.get(interiorDoorWall.id)).toBeUndefined()
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

    const overall = planned?.find((entry) => entry.tier === 'overall')
    expect(overall).toMatchObject({
      start: [10, -0.1],
      end: [0, -0.1],
      offsetNormal: [0, -1],
      dimensionStart: [10, -0.55],
      dimensionEnd: [0, -0.55],
    })
    expect(overall?.offsetDistance).toBeCloseTo(0.45)
  })

  test('keeps angled exterior dimensions aligned and reports their true length', () => {
    const angled = wall({ end: [3, 4] })
    const planned = buildLevelWallConstructionDimensionPlan([angled], {}).get(angled.id) ?? []

    expect(
      renderPlannedConstructionDimensions(planned, 'imperial').map((entry) =>
        entry.kind === 'dimension' ? entry.text : null,
      ),
    ).toEqual([`16'-4 7/8"`])
    expect(planned[0]).toMatchObject({
      tier: 'overall',
      offsetNormal: [-0.8, 0.6],
    })
    expect(
      Math.hypot(
        planned[0]!.dimensionEnd![0] - planned[0]!.dimensionStart![0],
        planned[0]!.dimensionEnd![1] - planned[0]!.dimensionStart![1],
      ),
    ).toBeCloseTo(5)
  })

  test('does not automatically dimension walls without an exterior classification', () => {
    const plan = buildLevelWallConstructionDimensionPlan(
      [wall({ frontSide: 'interior', backSide: 'interior' })],
      {},
    )

    expect(plan.size).toBe(0)
  })
})
